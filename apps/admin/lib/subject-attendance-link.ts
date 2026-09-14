import { createClient } from "@pp5/database/server";
import { weekDateRange } from "@/app/(admin)/setup/attendance/by-subject/term-weeks";

export type LinkedAttendanceStatus = "present" | "absent" | "leave";
export type LinkedAttendanceSource = "subject" | "daily";

type ManualRow = {
  student_id: string;
  week: number;
  slot_in_week: number;
  status: "present" | "absent" | "leave" | "sick";
};

type DailyRow = {
  student_id: string;
  date: string;
  status: "present" | "absent" | "leave" | "sick";
};

export type LinkedAttendanceResult = {
  /** Effective value: subject override first, daily attendance second. */
  cellsByStudent: Map<string, Map<string, LinkedAttendanceStatus>>;
  /** Values physically saved in subject_attendance. */
  manualCellsByStudent: Map<string, Map<string, LinkedAttendanceStatus>>;
  /** Values inherited from daily attendance. */
  dailyCellsByStudent: Map<string, Map<string, LinkedAttendanceStatus>>;
  sourcesByStudent: Map<string, Map<string, LinkedAttendanceSource>>;
  /** Date generated from the recurring weekday, before a make-up override. */
  baseSessionDates: Map<string, string>;
  /** Effective date after applying a make-up override. */
  sessionDates: Map<string, string>;
  overrideKeys: Set<string>;
  scheduleWeekdays: Map<number, number>;
  schemaReady: boolean;
  schemaError?: string;
};

export const subjectAttendanceCellKey = (week: number, slot: number) =>
  `${week}|${slot}`;

function toIsoLocal(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
function normalizeStatus(
  status: "present" | "absent" | "leave" | "sick",
): LinkedAttendanceStatus {
  // The subject attendance report has one combined leave column. Daily
  // "sick" therefore inherits as leave without changing the daily record.
  return status === "sick" ? "leave" : status;
}

function setCell(
  target: Map<string, Map<string, LinkedAttendanceStatus>>,
  studentId: string,
  key: string,
  status: LinkedAttendanceStatus,
) {
  let cells = target.get(studentId);
  if (!cells) {
    cells = new Map();
    target.set(studentId, cells);
  }
  cells.set(key, status);
}

async function fetchAllManualRows(
  offeringId: string,
  studentIds: string[],
): Promise<ManualRow[]> {
  if (studentIds.length === 0) return [];
  const supabase = await createClient();
  const rows: ManualRow[] = [];
  const pageSize = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("subject_attendance")
      .select("student_id, week, slot_in_week, status")
      .eq("offering_id", offeringId)
      .in("student_id", studentIds)
      .order("week", { ascending: true })
      .order("slot_in_week", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error || !data || data.length === 0) break;
    rows.push(...(data as ManualRow[]));
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

async function fetchAllDailyRows(
  classroomId: string,
  studentIds: string[],
  dates: Set<string>,
): Promise<DailyRow[]> {
  if (studentIds.length === 0 || dates.size === 0) return [];
  const sortedDates = Array.from(dates).sort();
  const firstDate = sortedDates[0];
  const lastDate = sortedDates[sortedDates.length - 1];
  const studentSet = new Set(studentIds);
  const supabase = await createClient();
  const rows: DailyRow[] = [];
  const pageSize = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("attendance")
      .select("student_id, date, status")
      .eq("classroom_id", classroomId)
      .gte("date", firstDate)
      .lte("date", lastDate)
      .order("date", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error || !data || data.length === 0) break;
    rows.push(
      ...(data as DailyRow[]).filter(
        (row) => dates.has(row.date) && studentSet.has(row.student_id),
      ),
    );
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

/**
 * Resolve one offering's attendance without writing anything:
 *
 *   subject_attendance row (teacher edited) > daily attendance fallback.
 *
 * This keeps historical subject rows untouched and guarantees that editing
 * a subject cell never updates the morning/daily attendance table.
 */
export async function loadLinkedSubjectAttendance({
  offeringId,
  classroomId,
  studentIds,
  slotsPerWeek,
  anchorIso,
  totalWeeks = 20,
}: {
  offeringId: string;
  classroomId: string;
  studentIds: string[];
  slotsPerWeek: number;
  anchorIso: string;
  totalWeeks?: number;
}): Promise<LinkedAttendanceResult> {
  const supabase = await createClient();
  const [slotResult, overrideResult, manualRows] = await Promise.all([
    supabase
      .from("subject_schedule_slots")
      .select("slot_in_week, weekday")
      .eq("offering_id", offeringId),
    supabase
      .from("subject_schedule_overrides")
      .select("week, slot_in_week, session_date")
      .eq("offering_id", offeringId),
    fetchAllManualRows(offeringId, studentIds),
  ]);

  const schemaReady = !slotResult.error && !overrideResult.error;
  const schemaError = slotResult.error?.message ?? overrideResult.error?.message;
  const scheduleWeekdays = new Map<number, number>();
  for (const row of slotResult.data ?? []) {
    if (row.slot_in_week <= slotsPerWeek) {
      scheduleWeekdays.set(row.slot_in_week, row.weekday);
    }
  }

  const baseSessionDates = new Map<string, string>();
  const sessionDates = new Map<string, string>();
  for (let week = 1; week <= totalWeeks; week++) {
    const monday = weekDateRange(anchorIso, week).start;
    for (let slot = 1; slot <= slotsPerWeek; slot++) {
      const weekday = scheduleWeekdays.get(slot);
      if (!weekday) continue;
      const date = new Date(monday);
      date.setDate(date.getDate() + weekday - 1);
      const key = subjectAttendanceCellKey(week, slot);
      const iso = toIsoLocal(date);
      baseSessionDates.set(key, iso);
      sessionDates.set(key, iso);
    }
  }

  const overrideKeys = new Set<string>();
  for (const row of overrideResult.data ?? []) {
    if (row.week > totalWeeks || row.slot_in_week > slotsPerWeek) continue;
    const key = subjectAttendanceCellKey(row.week, row.slot_in_week);
    sessionDates.set(key, row.session_date);
    overrideKeys.add(key);
  }

  const manualCellsByStudent = new Map<
    string,
    Map<string, LinkedAttendanceStatus>
  >();
  for (const row of manualRows) {
    setCell(
      manualCellsByStudent,
      row.student_id,
      subjectAttendanceCellKey(row.week, row.slot_in_week),
      normalizeStatus(row.status),
    );
  }

  const requestedDates = new Set(sessionDates.values());
  const dailyRows = schemaReady
    ? await fetchAllDailyRows(classroomId, studentIds, requestedDates)
    : [];
  const dailyByStudentDate = new Map<string, LinkedAttendanceStatus>();
  for (const row of dailyRows) {
    dailyByStudentDate.set(
      `${row.student_id}|${row.date}`,
      normalizeStatus(row.status),
    );
  }

  const dailyCellsByStudent = new Map<
    string,
    Map<string, LinkedAttendanceStatus>
  >();
  for (const studentId of studentIds) {
    for (const [key, date] of sessionDates) {
      const status = dailyByStudentDate.get(`${studentId}|${date}`);
      if (status) setCell(dailyCellsByStudent, studentId, key, status);
    }
  }

  const cellsByStudent = new Map<
    string,
    Map<string, LinkedAttendanceStatus>
  >();
  const sourcesByStudent = new Map<
    string,
    Map<string, LinkedAttendanceSource>
  >();
  for (const studentId of studentIds) {
    const keys = new Set([
      ...(dailyCellsByStudent.get(studentId)?.keys() ?? []),
      ...(manualCellsByStudent.get(studentId)?.keys() ?? []),
    ]);
    for (const key of keys) {
      const manualStatus = manualCellsByStudent.get(studentId)?.get(key);
      const dailyStatus = dailyCellsByStudent.get(studentId)?.get(key);
      const status = manualStatus ?? dailyStatus;
      if (!status) continue;
      setCell(cellsByStudent, studentId, key, status);
      let sources = sourcesByStudent.get(studentId);
      if (!sources) {
        sources = new Map();
        sourcesByStudent.set(studentId, sources);
      }
      sources.set(key, manualStatus ? "subject" : "daily");
    }
  }

  return {
    cellsByStudent,
    manualCellsByStudent,
    dailyCellsByStudent,
    sourcesByStudent,
    baseSessionDates,
    sessionDates,
    overrideKeys,
    scheduleWeekdays,
    schemaReady,
    ...(schemaError ? { schemaError } : {}),
  };
}

export function countLinkedAttendance(
  cells: Map<string, LinkedAttendanceStatus> | undefined,
  totalSlots: number,
) {
  let present = 0;
  let absent = 0;
  let leave = 0;
  for (const status of cells?.values() ?? []) {
    if (status === "present") present++;
    else if (status === "absent") absent++;
    else if (status === "leave") leave++;
  }
  return {
    present,
    absent,
    leave,
    pct: totalSlots > 0 ? Math.round((present / totalSlots) * 100) : 0,
  };
}
