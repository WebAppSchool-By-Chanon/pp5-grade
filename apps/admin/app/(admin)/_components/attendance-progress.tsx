import { createClient } from "@pp5/database/server";
import { getCurrentUser } from "@pp5/database/queries";
import Link from "next/link";
import { loadLinkedSubjectAttendance } from "@/lib/subject-attendance-link";
import { recordingProgress, progressPercent } from "@/lib/attendance-progress";
import { resolveAnchorIso } from "../setup/attendance/by-subject/term-weeks";

type Year = { id: string; year_be: number; current_semester: number; start_date: string | null; end_date: string | null };
type Row = { label: string; href: string; filled: number; expected: number; note?: string };

function ProgressSection({ title, rows }: { title: string; rows: Row[] }) {
  const filled = rows.reduce((n, r) => n + r.filled, 0);
  const expected = rows.reduce((n, r) => n + r.expected, 0);
  const percent = progressPercent(filled, expected);
  const incompleteSetup = rows.filter(r => r.note).length;
  return (
    <details className="border-t border-zinc-200">
      <summary className="cursor-pointer px-4 py-4 text-sm font-medium">
        {title} · {percent == null ? "ยังไม่มีรายการที่ถึงกำหนด" : `${percent}%`}
        {incompleteSetup > 0 && <span className="ml-2 text-amber-700">({incompleteSetup} รายการต้องตรวจสอบการตั้งค่า)</span>}
        <span className="mt-1 block text-xs font-normal text-zinc-500">บันทึกแล้ว {filled.toLocaleString()} / {expected.toLocaleString()} ช่อง · คลิกเพื่อดูรายละเอียด</span>
      </summary>
      <ul className="divide-y divide-zinc-100 bg-zinc-50">
        {rows.map(row => {
          const pct = progressPercent(row.filled, row.expected);
          return <li key={row.href}>
            <Link href={row.href} className="flex items-center justify-between gap-4 px-4 py-3 text-sm hover:bg-blue-50">
              <span>{row.label}<span className="block text-xs text-zinc-500">{row.note ?? `${row.filled.toLocaleString()} / ${row.expected.toLocaleString()} ช่อง`}</span></span>
              <span className={pct === 100 ? "text-emerald-700" : "text-blue-700"}>{pct == null ? "—" : `${pct}%`}</span>
            </Link>
          </li>;
        })}
        {rows.length === 0 && <li className="p-4 text-sm text-zinc-500">ไม่มีรายการในภาคเรียนนี้</li>}
      </ul>
    </details>
  );
}

export async function AttendanceProgress({ year }: { year: Year }) {
  const auth = await getCurrentUser();
  if (auth?.profile.role !== "admin") return null;
  const db = await createClient();
  const semester = year.current_semester === 2 ? 2 : 1;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const ce = year.year_be - 543;
  // Same month scope as the daily recording screen.
  const start = semester === 1 ? `${ce}-05-01` : `${ce}-11-01`;
  const end = semester === 1 ? `${ce}-10-31` : `${ce + 1}-03-31`;
  const cutoff = today < end ? today : end;
  const daily: Row[] = [];
  const subjects: Row[] = [];
  try {
    const rooms = await db.from("classrooms").select("id, room_number, grade_level_id, study_plan_id, grade:grade_levels!grade_level_id(name_short, system, sort_order)").eq("academic_year_id", year.id);
    if (rooms.error) throw rooms.error;
    const sortedRooms = (rooms.data ?? []).sort((a, b) => (a.grade?.sort_order ?? 0) - (b.grade?.sort_order ?? 0) || a.room_number - b.room_number);
    for (const room of sortedRooms) {
      const primary = room.grade?.system === "primary";
      const enrollmentSemester = primary ? 0 : semester;
      const roster = await db.from("enrollments").select("student_id").eq("classroom_id", room.id).eq("semester", enrollmentSemester);
      if (roster.error) throw roster.error;
      const ids = [...new Set((roster.data ?? []).map(r => r.student_id))];
      if (!ids.length) continue;
      const label = `${room.grade?.name_short ?? "ห้อง"}/${room.room_number}`;
      const query = new URLSearchParams({ grade: room.grade_level_id, room: room.id });
      const href = `/setup/attendance?${query}`;
      const workdays = await db.from("workdays").select("date").eq("classroom_id", room.id).gte("date", start).lte("date", cutoff);
      if (workdays.error) throw workdays.error;
      const dates = new Set((workdays.data ?? []).map(r => r.date));
      const cells = new Map<string, Map<string, unknown>>();
      // Explicit pagination: a classroom's term can easily exceed 1,000 cells.
      for (let from = 0; dates.size; from += 1000) {
        const result = await db.from("attendance").select("student_id, date, status").eq("classroom_id", room.id).gte("date", start).lte("date", cutoff).order("date").order("student_id").range(from, from + 999);
        if (result.error) throw result.error;
        for (const row of result.data ?? []) {
          if (!cells.has(row.student_id)) cells.set(row.student_id, new Map());
          cells.get(row.student_id)!.set(row.date, row.status);
        }
        if ((result.data?.length ?? 0) < 1000) break;
      }
      daily.push({ label, href, ...recordingProgress(ids, dates, cells), ...(dates.size ? {} : { note: "ยังไม่มีวันเปิดเรียนที่ถึงกำหนด" }) });
      if (!room.study_plan_id) {
        subjects.push({ label, href: `/setup/attendance/by-subject?${query}`, filled: 0, expected: 0, note: "ยังไม่ได้กำหนดแผนการเรียน" });
        continue;
      }
      const [plan, offerings] = await Promise.all([
        db.from("study_plan_subjects").select("subject:subjects!subject_id(id, code, name_th, category, semester, academic_year_id, credit_hours, hours_per_year)").eq("study_plan_id", room.study_plan_id),
        db.from("subject_offerings").select("id, subject_id").eq("classroom_id", room.id).eq("semester", semester),
      ]);
      if (plan.error || offerings.error) throw plan.error ?? offerings.error;
      const offeringMap = new Map((offerings.data ?? []).map(o => [o.subject_id, o.id]));
      const planItems = plan.data ?? [];
      // Bound parallel reads to four subjects rather than serializing every
      // subject, or flooding the database with the entire school's queries.
      for (let offset = 0; offset < planItems.length; offset += 4) {
      const batch = await Promise.all(planItems.slice(offset, offset + 4).map(async (item): Promise<Row | null> => {
        const subject = item.subject;
        if (!subject || subject.academic_year_id !== year.id || subject.semester !== enrollmentSemester || subject.category === "activity" || !((subject.credit_hours ?? 0) > 0 || (subject.hours_per_year ?? 0) > 0)) return null;
        const row: Row = { label: `${label} · ${subject.code} ${subject.name_th}`, href: `/setup/attendance/by-subject?${query}&subject=${subject.id}`, filled: 0, expected: 0 };
        const offeringId = offeringMap.get(subject.id);
        if (!offeringId) return { ...row, note: "ยังไม่ได้ตั้งวันสอน" };
        const slotsPerWeek = Math.max(1, Math.round(primary ? (subject.hours_per_year ?? 0) / 40 : (subject.credit_hours ?? 0) * 2));
        const linked = await loadLinkedSubjectAttendance({ offeringId, classroomId: room.id, studentIds: ids, slotsPerWeek, anchorIso: resolveAnchorIso(year.year_be, semester, year), strict: true });
        if (!linked.schemaReady) return { ...row, note: "อ่านตารางวันสอนไม่ได้ กรุณาตรวจสอบการอัปเดตฐานข้อมูล" };
        const dueKeys = [...linked.sessionDates].filter(([, date]) => date <= today).map(([key]) => key);
        const missingSchedule = linked.scheduleWeekdays.size < slotsPerWeek;
        return { ...row, ...recordingProgress(ids, dueKeys, linked.cellsByStudent), ...(missingSchedule ? { note: "ตั้งวันสอนยังไม่ครบ — คำนวณเฉพาะคาบที่มีวันที่" } : {}) };
      }));
      subjects.push(...batch.filter((row): row is Row => row !== null));
      }
    }
  } catch {
    return <section className="mb-8 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">ความคืบหน้าการบันทึกเวลาเรียน: โหลดข้อมูลไม่สำเร็จ กรุณาลองใหม่ (ยังไม่สรุปเปอร์เซ็นต์เพื่อป้องกันข้อมูลคลาดเคลื่อน)</section>;
  }
  return <section className="mb-8 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
    <div className="bg-blue-50 px-4 py-3">
      <h2 className="font-semibold text-blue-900">ความคืบหน้าการบันทึกเวลาเรียน · ภาคเรียนที่ {semester} ปี {year.year_be}</h2>
      <p className="mt-1 text-xs text-blue-800">ถึงวันที่ {today} · นับทุกสถานะ มา/ขาด/ลา/ป่วย ไม่ใช่อัตราการมาเรียน · รายวิชารวมข้อมูลจากรายวันและวันชดเชย</p>
    </div>
    <ProgressSection title="รายวัน" rows={daily} />
    <ProgressSection title="รายวิชา (เฉพาะคาบที่ตั้งวันสอน)" rows={subjects} />
  </section>;
}
