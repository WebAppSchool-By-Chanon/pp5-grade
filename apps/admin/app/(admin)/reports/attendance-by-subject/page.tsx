import { createClient } from "@pp5/database/server";
import Link from "next/link";
import { resolveAnchorIso } from "../../setup/attendance/by-subject/term-weeks";
import { abbreviateTitle } from "../../setup/score-structure/grading-utils";
import type { Metadata } from "next";
import {
  currentTermSuffix,
  reportClassroomLabel,
  reportRoomSuffix,
} from "@/lib/current-term";
import { PrintButton } from "../pp5/print-button";
import { attendanceStudentNameClass } from "../_shared/student-name-fit";

export async function generateMetadata({
  searchParams,
}: Props): Promise<Metadata> {
  const p = await searchParams;
  if (p.embed !== "1") return {};
  const [suffix, room] = await Promise.all([
    currentTermSuffix(),
    reportClassroomLabel(p.classroom),
  ]);
  return {
    title: ["รายงานเวลาเรียนรายวิชา", room, suffix].filter(Boolean).join(" "),
  };
}

type Props = {
  searchParams: Promise<{
    classroom?: string;
    subject?: string;
    semester?: string;
    /** "1" when loaded inside an iframe (selector preview).
     *  Hides the surrounding admin layout chrome. */
    embed?: string;
  }>;
};

const THAI_MONTHS = [
  "ม.ค.",
  "ก.พ.",
  "มี.ค.",
  "เม.ย.",
  "พ.ค.",
  "มิ.ย.",
  "ก.ค.",
  "ส.ค.",
  "ก.ย.",
  "ต.ค.",
  "พ.ย.",
  "ธ.ค.",
];

const STATUS_CHAR: Record<"present" | "absent" | "leave", string> = {
  present: "/",
  absent: "ข",
  leave: "ล",
};

/**
 * Per-subject attendance report — one classroom × one subject × one term,
 * 20 weeks × slotsPerWeek cells per student plus a มา/ขาด/ลา/ร้อยละ summary.
 *
 * Layout mirrors the per-day attendance report (`/reports/attendance`):
 *   - `.pp5-page .att-page` → portrait A4 with narrow margins, tiny font
 *   - Header: title + school + info grid
 *   - One wide table (auto-shrinks columns to fit page width)
 *   - Footer: 4 signature blocks
 *
 * URL: /reports/attendance-by-subject?classroom=X&subject=Y&semester=Z[&embed=1]
 */
export default async function AttendanceBySubjectReport({ searchParams }: Props) {
  const params = await searchParams;
  const classroomId = params.classroom?.trim();
  const subjectId = params.subject?.trim();
  const semRaw = params.semester?.trim();
  const semester: 1 | 2 = semRaw === "2" ? 2 : 1;
  const isEmbed = params.embed === "1";

  if (!classroomId || !subjectId) {
    return notFoundPage("URL ไม่ถูกต้อง — ต้องระบุ ?classroom และ ?subject");
  }

  const supabase = await createClient();

  // 1. School + classroom + academic year
  const [{ data: school }, { data: classroom }] = await Promise.all([
    supabase
      .from("schools")
      .select(
        "name_th, affiliation, district, province, logo_url, director_name, director_title, deputy_director_name, assessment_officer_name",
      )
      .limit(1)
      .maybeSingle(),
    supabase
      .from("classrooms")
      .select(
        `
        id,
        room_number,
        grade_level:grade_levels!grade_level_id (
          id,
          name_th,
          system
        ),
        academic_year:academic_years!academic_year_id (
          year_be,
          current_semester,
          start_date,
          end_date
        )
      `,
      )
      .eq("id", classroomId)
      .maybeSingle(),
  ]);

  if (!classroom?.grade_level || !classroom.academic_year) {
    return notFoundPage("ไม่พบข้อมูลห้องเรียน");
  }
  const isPrimary = classroom.grade_level.system === "primary";

  // 2. Subject
  const { data: subject } = await supabase
    .from("subjects")
    .select("id, code, name_th, credit_hours, hours_per_year, category")
    .eq("id", subjectId)
    .maybeSingle();
  if (!subject) return notFoundPage("ไม่พบข้อมูลวิชา");
  // Slot-budget validation — different units depending on the
  // (system, category) combo per user spec 2026-05-22 (สพฐ. หลักสูตร
  // แกนกลาง 2551):
  //   secondary core/additional → credit_hours (หน่วยกิต)
  //   primary core/additional   → hours_per_year (ชั่วโมง/ปี)
  //   activity (both systems)   → hours_per_year (annual for ประถม,
  //                                                per-semester for มัธยม)
  const isActivity = subject.category === "activity";
  const usesCredits = !isPrimary && !isActivity;
  if (usesCredits) {
    if (!subject.credit_hours || subject.credit_hours <= 0) {
      return notFoundPage(
        "วิชานี้ไม่มีหน่วยกิต — ตั้งค่าหน่วยกิตในวิชาก่อน",
      );
    }
  } else {
    if (!subject.hours_per_year || subject.hours_per_year <= 0) {
      return notFoundPage(
        "วิชานี้ไม่มีจำนวนชั่วโมงเรียน — ตั้งค่าจำนวนชั่วโมงในวิชาก่อน",
      );
    }
  }

  // 3. Offering (used for attendance data + teacher info)
  const { data: offering } = await supabase
    .from("subject_offerings")
    .select(
      `
      id,
      teacher:teachers!teacher_id (
        user:users!user_id (full_name, title)
      )
    `,
    )
    .eq("classroom_id", classroomId)
    .eq("subject_id", subjectId)
    .eq("semester", semester)
    .maybeSingle();

  if (!offering) {
    return notFoundPage(
      "ไม่พบข้อมูลรายวิชาในห้อง/ภาคนี้ — ลองบันทึกข้อมูลที่ /setup/attendance/by-subject ก่อน",
    );
  }
  const teacherUser = offering.teacher?.user;
  const teacherLabel = teacherUser
    ? `${teacherUser.title ?? ""}${teacherUser.full_name}`
    : "—";

  // (Homeroom fetch removed — this per-subject report uses ครูผู้สอน
  // for the signature, not ครูประจำชั้น. The dead variable used to be
  // here but never referenced.)

  // 5. Enrollment scope: primary → 0, secondary → semester
  const enrollmentSemester: 0 | 1 | 2 = isPrimary ? 0 : semester;
  const { data: enrolls } = await supabase
    .from("enrollments")
    .select(
      `
      student_number,
      student:students!student_id (
        id,
        title,
        first_name,
        last_name
      )
    `,
    )
    .eq("classroom_id", classroomId)
    .eq("semester", enrollmentSemester)
    .order("student_number");

  const students = (enrolls ?? [])
    .filter((e) => e.student)
    .map((e) => ({
      id: e.student!.id,
      student_number: e.student_number,
      full_label: `${abbreviateTitle(e.student!.title)}${e.student!.first_name} ${e.student!.last_name}`,
    }));

  // 6. subject_attendance for this offering
  type Counts = { present: number; absent: number; leave: number };
  const cellsByStudent = new Map<
    string,
    Map<string, "present" | "absent" | "leave">
  >();
  const countsByStudent = new Map<string, Counts>();
  if (students.length > 0) {
    // Paginate with .range() — Supabase max-rows defaults to 1000.
    // For one offering: 30 students × 30 weeks × 10 slots = 9,000 max rows
    // (typically ≤1,440 in practice, but pagination keeps us safe past 1k).
    type SaRow = {
      student_id: string;
      week: number;
      slot_in_week: number;
      status: "present" | "absent" | "leave" | "sick";
    };
    const PAGE = 1000;
    const saRows: SaRow[] = [];
    const studentIds = students.map((s) => s.id);
    let from = 0;
    while (true) {
      const { data, error } = await supabase
        .from("subject_attendance")
        .select("student_id, week, slot_in_week, status")
        .eq("offering_id", offering.id)
        .in("student_id", studentIds)
        .order("week", { ascending: true })
        .order("slot_in_week", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) break;
      if (!data || data.length === 0) break;
      saRows.push(...(data as SaRow[]));
      if (data.length < PAGE) break;
      from += PAGE;
    }
    for (const row of saRows) {
      if (
        row.status !== "present" &&
        row.status !== "absent" &&
        row.status !== "leave"
      ) {
        continue;
      }
      // Cell map (for table cells)
      const key = `${row.week}|${row.slot_in_week}`;
      let cellMap = cellsByStudent.get(row.student_id);
      if (!cellMap) {
        cellMap = new Map();
        cellsByStudent.set(row.student_id, cellMap);
      }
      cellMap.set(key, row.status);
      // Counts (for สรุป)
      let counts = countsByStudent.get(row.student_id);
      if (!counts) {
        counts = { present: 0, absent: 0, leave: 0 };
        countsByStudent.set(row.student_id, counts);
      }
      counts[row.status]++;
    }
  }

  // 7. Slots + anchor + week labels
  //
  // slots/week derivation (see step 2 for the per-(system, category)
  // breakdown):
  //   - secondary core/additional → credit_hours × 2 hours/week
  //     (มาตรฐาน สพฐ. มัธยม: 1 หน่วยกิต = 40 ชม./ภาคเรียน = 2 ชม./สัปดาห์)
  //   - primary core/additional   → hours_per_year ÷ 40 weeks/year
  //   - primary activity          → hours_per_year ÷ 40 (annual)
  //   - secondary activity        → hours_per_year ÷ 20 weeks/term
  //     (สำหรับมัธยม column นี้เก็บค่าเป็น "ชั่วโมง/ภาค")
  // User spec 2026-05-22: "ภาษาไทย ป.1 200 ชม./ปี ก็ให้มี 5 ช่อง/สัปดาห์
  // เหมือนตอนเป็น credit_hours 2.5".
  const slotsPerWeek = usesCredits
    ? Math.max(1, Math.round((subject.credit_hours ?? 0) * 2))
    : Math.max(
        1,
        Math.round((subject.hours_per_year ?? 0) / (isPrimary ? 40 : 20)),
      );
  const TOTAL_WEEKS = 20;
  const totalSlots = slotsPerWeek * TOTAL_WEEKS;
  const anchorIso = resolveAnchorIso(
    classroom.academic_year.year_be,
    semester,
    {
      start_date: classroom.academic_year.start_date,
      end_date: classroom.academic_year.end_date,
    },
  );
  const firstMonday = (() => {
    const [y, m, d] = anchorIso
      .split("-")
      .map((n) => Number.parseInt(n, 10));
    const date = new Date(y, m - 1, d);
    const dow = date.getDay();
    if (dow === 0) date.setDate(date.getDate() + 1);
    else if (dow === 6) date.setDate(date.getDate() + 2);
    else if (dow >= 2) date.setDate(date.getDate() - (dow - 1));
    return date;
  })();
  const weekDateLabel = (weekIndex: number): string => {
    const start = new Date(firstMonday);
    start.setDate(start.getDate() + (weekIndex - 1) * 7);
    const end = new Date(start);
    end.setDate(end.getDate() + 4);
    const startMonth = THAI_MONTHS[start.getMonth()];
    const endMonth = THAI_MONTHS[end.getMonth()];
    if (start.getMonth() === end.getMonth()) {
      return `${start.getDate()}-${end.getDate()} ${startMonth}`;
    }
    return `${start.getDate()} ${startMonth} - ${end.getDate()} ${endMonth}`;
  };

  // Split into 2 sub-tables (10 weeks each) so the grid isn't squeezed.
  // Exception: ≤1 slot/week (e.g. 0.5 credit_hours) fits all 20 weeks on one
  // A4 page — keep it single-page so the name+grid+summary are all together.
  // User spec 2026-06-01.
  const PAGE_RANGES: Array<[number, number]> =
    slotsPerWeek <= 1
      ? [[1, 20]]
      : [
          [1, 10],
          [11, 20],
        ];

  // Fixed table width (px) — the same value used in /reports/pp5 weekly grid.
  // <colgroup> distributes this among num + name + slots + summary so the
  // table stays full-width regardless of how many slot columns there are.
  // Mirrors the TOTAL_TABLE_PX constant in AttendanceWeeklyGridSection.
  const TOTAL_TABLE_PX = 673;
  const NUM_PX = 18;
  const NAME_PX = 115;

  // Pad student rows to this many — keeps the printed grid a fixed size
  // even when fewer students are enrolled. Expand to fit if class > 30
  // (user spec 2026-05-19: "ถ้านักเรียนมากกว่า 30 คุณไม่แสดงเลย").
  const PADDED_ROW_COUNT =
    students.length === 0
      ? 30
      : Math.max(30, ...students.map((s) => s.student_number));
  // 3-tier density (mirrors /reports/pp5 + /reports/student-eval):
  //   ≤30 roomy · 31-35 compact · >35 xcompact
  // User spec 2026-05-22: classes >35 still overflowed after compact
  // tightening, so a 3rd tier extends the trim.
  const isCompact = PADDED_ROW_COUNT > 30;
  const isXCompact = PADDED_ROW_COUNT > 35;
  // Wide-subject modifier — subjects with 5+ slots per week (typically
  // credit_hours ≥ 2.5) pack 50+ slot columns into one printed page and
  // overflow the 190mm content area at the default 14px slot width.
  // The `att-table--dense-slots` class shrinks .att-wk-slot just for
  // these subjects so the right border stays inside the page.
  // User report 2026-05-22: "เส้นขอบขวาของตารางหายในวิชาที่มีช่องเยอะ
  // คือ 5 ช่อง/สัปดาห์".
  const isDenseSlots = slotsPerWeek >= 5;
  const attTableClass = `att-table${
    PADDED_ROW_COUNT === 30
      ? " att-table--roomy"
      : isXCompact
        ? " att-table--xcompact"
        : ""
  }${isDenseSlots ? " att-table--dense-slots" : ""}`;

  const classLabel = `ชั้น${classroom.grade_level.name_th}${await reportRoomSuffix(classroomId)}`;

  return (
    <>
      {/* Embed mode — strip admin layout chrome (sidebar / breadcrumb / etc.) */}
      {isEmbed && (
        <style
          dangerouslySetInnerHTML={{
            __html: `
              aside { display: none !important; }
              .no-print { display: none !important; }
              [class*="max-w-6xl"] {
                max-width: none !important;
                padding: 0 !important;
              }
              body { background: #ffffff !important; }
            `,
          }}
        />
      )}

      <main className="pp5-page att-page">
        {/* Toolbar — hidden on print + embed */}
        {!isEmbed && (
          <div className="pp5-toolbar no-print">
            <Link
              href="/setup/attendance/by-subject"
              className="pp5-back"
            >
              ← กลับไปหน้าบันทึกเวลาเรียนรายวิชา
            </Link>
            <PrintButton />
          </div>
        )}

        {PAGE_RANGES.map(([firstWeek, lastWeek], pageIdx) => {
          const rangeWeeks = Array.from(
            { length: lastWeek - firstWeek + 1 },
            (_, i) => firstWeek + i,
          );
          const rangeSlots = rangeWeeks.length * slotsPerWeek;
          // Page 1 (idx=0): ที่ + ชื่อ-สกุล + slot cells (no summary)
          // Page 2 (idx=1): ที่ only + slot cells + summary (มา/ขาด/ลา/ร้อยละ)
          // Rationale (user spec): keep wide grid less squeezed by dropping
          //   the ชื่อ column on page 2 (admin cross-refs with page 1's
          //   row order via student_number) and showing the full-term
          //   summary only on the last page.
          const isLastPage = pageIdx === PAGE_RANGES.length - 1;
          const showNameCol = pageIdx === 0;
          const showSummaryCols = isLastPage;

          // Distribute TOTAL_TABLE_PX evenly: num + (name?) + slots + (summary?)
          const SUM_PX = 24 * 3 + 44; // มา · ขาด · ลา · ร้อยละ
          const slotsArea =
            TOTAL_TABLE_PX -
            NUM_PX -
            (showNameCol ? NAME_PX : 0) -
            (showSummaryCols ? SUM_PX : 0);
          const slotWidthPx = slotsArea / rangeSlots;

          return (
            <section
              key={`pg-${firstWeek}`}
              className={
                pageIdx === 0
                  ? "att-page-section"
                  : "att-page-section att-page-break"
              }
            >
              {/* Header repeats on each page · uses the same compact layout
                  as the simple-print score header (per user spec — match
                  the style shown in `/reports/pp5?...&parts=scores`):
                    logo (if any) · centered title · school name · one
                    inline meta line (class · code · name · sem/year).
                  Removed: separate "อำเภอ จังหวัด" + "สังกัด" rows. */}
              <header
                className={`pp5-header pp5-header--att-sub${isCompact ? " pp5-header--compact" : ""}${isXCompact ? " pp5-header--xcompact" : ""}`}
              >
                <div className="pp5-title">
                  {school?.logo_url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={school.logo_url}
                      alt="โลโก้โรงเรียน"
                      className="pp5-header-logo"
                    />
                  )}
                  <div className="att-title-text">
                    <h1>แบบบันทึกเวลาเรียนรายวิชา</h1>
                    <p className="pp5-school-name">
                      {school?.name_th?.startsWith("โรงเรียน")
                        ? school.name_th
                        : `โรงเรียน${school?.name_th ?? "—"}`}
                    </p>
                  </div>
                </div>
                <p className="pp5-meta-line">
                  <span>{classLabel}</span>
                  <span>
                    รหัสวิชา <strong>{subject.code}</strong>
                  </span>
                  <span>
                    ชื่อวิชา <strong>{subject.name_th}</strong>
                  </span>
                  <span>
                    ภาคเรียนที่ <strong>{semester}</strong> ปีการศึกษา{" "}
                    <strong>{classroom.academic_year.year_be}</strong>
                  </span>
                </p>
              </header>

              <table
                className={attTableClass}
                data-slots-per-week={slotsPerWeek}
                style={{ width: `${TOTAL_TABLE_PX}px` }}
              >
                <colgroup>
                  <col style={{ width: `${NUM_PX}px` }} />
                  {showNameCol && (
                    <col style={{ width: `${NAME_PX}px` }} />
                  )}
                  {Array.from({ length: rangeSlots }, (_, i) => (
                    <col key={`sl-${i}`} style={{ width: `${slotWidthPx}px` }} />
                  ))}
                  {showSummaryCols && (
                    <>
                      <col style={{ width: "24px" }} />
                      <col style={{ width: "24px" }} />
                      <col style={{ width: "24px" }} />
                      <col style={{ width: "44px" }} />
                    </>
                  )}
                </colgroup>
                <thead>
                  <tr>
                    <th rowSpan={3} className="att-col-num">
                      ที่
                    </th>
                    {showNameCol && (
                      <th rowSpan={3} className="att-col-name">
                        ชื่อ – สกุล
                      </th>
                    )}
                    <th colSpan={rangeSlots} className="att-group">
                      สัปดาห์ที่
                    </th>
                    {showSummaryCols && (
                      <th colSpan={4} rowSpan={2} className="att-group">
                        สรุป (รวมทั้งภาค)
                      </th>
                    )}
                  </tr>
                  <tr>
                    {rangeWeeks.map((w) => (
                      <th
                        key={`wk-${w}`}
                        colSpan={slotsPerWeek}
                        className="att-wk-head"
                      >
                        <div>{w}</div>
                        <div className="att-wk-date">{weekDateLabel(w)}</div>
                      </th>
                    ))}
                  </tr>
                  <tr>
                    {rangeWeeks.map((w) =>
                      Array.from({ length: slotsPerWeek }, (_, si) => {
                        // Running hour count across the term:
                        // week 1, slot 1 → 1 · week 1, slot 4 → 4
                        // week 2, slot 1 → 5 · week 20, slot last → 80
                        const hourNum = (w - 1) * slotsPerWeek + si + 1;
                        return (
                          <th key={`sl-${w}-${si}`} className="att-wk-slot">
                            {hourNum}
                          </th>
                        );
                      }),
                    )}
                    {showSummaryCols && (
                      <>
                        <th className="att-col-sum">มา</th>
                        <th className="att-col-sum">ขาด</th>
                        <th className="att-col-sum">ลา</th>
                        <th className="att-col-pct">ร้อยละ</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {/* Render exactly PADDED_ROW_COUNT rows. Each row is keyed
                      by row index (1..N); a row maps to a student via
                      student_number, or stays blank if no such student. */}
                  {Array.from({ length: PADDED_ROW_COUNT }, (_, i) => {
                    const rowNum = i + 1;
                    const s =
                      students.find((x) => x.student_number === rowNum) ??
                      null;
                    const counts = s
                      ? countsByStudent.get(s.id) ?? {
                          present: 0,
                          absent: 0,
                          leave: 0,
                        }
                      : null;
                    const pct =
                      s && totalSlots > 0
                        ? ((counts?.present ?? 0) / totalSlots) * 100
                        : null;
                    return (
                      <tr key={`r-${rowNum}`}>
                        <td>{rowNum}</td>
                        {showNameCol && (
                          <td
                            className={attendanceStudentNameClass(
                              s?.full_label,
                            )}
                          >
                            {s?.full_label ?? ""}
                          </td>
                        )}
                        {rangeWeeks.map((w) =>
                          Array.from(
                            { length: slotsPerWeek },
                            (_, si) => {
                              const slot = si + 1;
                              const key = `${w}|${slot}`;
                              const status = s
                                ? cellsByStudent.get(s.id)?.get(key)
                                : undefined;
                              return (
                                <td key={`c-${w}-${slot}`}>
                                  {status ? STATUS_CHAR[status] : ""}
                                </td>
                              );
                            },
                          ),
                        )}
                        {showSummaryCols && (
                          <>
                            <td>
                              {s ? <strong>{counts?.present ?? 0}</strong> : ""}
                            </td>
                            <td>{s ? counts?.absent ?? 0 : ""}</td>
                            <td>{s ? counts?.leave ?? 0 : ""}</td>
                            <td>
                              {pct == null ? "" : pct.toFixed(1)}
                            </td>
                          </>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {/* Signatures repeat on every printed page (per user spec).
                  `att-page-footer` adds an extra line gap above the row so
                  the signatures aren't crammed against the table. */}
              <footer
                className={`pp5-footer att-page-footer${isCompact ? " pp5-footer--compact" : ""}${isXCompact ? " pp5-footer--xcompact" : ""}`}
              >
                <div className="pp5-sig-block">
                  <p>ลงชื่อ .....................................</p>
                  <p className="pp5-sig-name">( {teacherLabel} )</p>
                  <p>ครูผู้สอน</p>
                </div>
                {school?.assessment_officer_name && (
                  <div className="pp5-sig-block">
                    <p>ลงชื่อ .....................................</p>
                    <p className="pp5-sig-name">
                      ( {school.assessment_officer_name} )
                    </p>
                    <p>หัวหน้างานวัดผล</p>
                  </div>
                )}
                {school?.deputy_director_name && (
                  <div className="pp5-sig-block">
                    <p>ลงชื่อ .....................................</p>
                    <p className="pp5-sig-name">
                      ( {school.deputy_director_name} )
                    </p>
                    <p>รองผู้อำนวยการ</p>
                  </div>
                )}
                <div className="pp5-sig-block">
                  <p>ลงชื่อ .....................................</p>
                  <p className="pp5-sig-name">
                    ( {school?.director_name ?? "—"} )
                  </p>
                  <p>{school?.director_title ?? "ผู้อำนวยการ"}</p>
                </div>
              </footer>
            </section>
          );
        })}
      </main>
    </>
  );
}

function notFoundPage(message: string) {
  return (
    <main className="mx-auto max-w-3xl p-8 text-sm text-zinc-700">
      <p>⚠️ {message}</p>
      <p className="mt-2">
        <Link
          href="/setup/attendance/by-subject"
          className="font-medium underline"
        >
          กลับไปหน้าบันทึกเวลาเรียนรายวิชา
        </Link>
      </p>
    </main>
  );
}
