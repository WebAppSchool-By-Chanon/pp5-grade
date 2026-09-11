import { createClient } from "@pp5/database/server";
import Link from "next/link";
import {
  THAI_DOW,
  THAI_MONTH_FULL,
  TERM_MONTHS,
  daysInMonth as calcDaysInMonth,
  resolveCalendarYear,
} from "../../setup/attendance/calendar";
import { AttendanceSummarySection } from "../../setup/attendance/summary-section";
import {
  abbreviateTitle,
  cutGrade,
  overallEvalLevel,
} from "../../setup/score-structure/grading-utils";
import { NumericTable, PrimaryAnnualSummary, PassFailTable } from "../_shared/score-report";
import { EvalSection } from "../pp5/page";
import type { Metadata } from "next";
import { withSchoolPrefix } from "@/lib/school-name";
import {
  currentTermSuffix,
  reportClassroomLabel,
  reportRoomSuffix,
} from "@/lib/current-term";
import { getTeacherScope } from "@/lib/teacher-scope";
import {
  Pp5ClassSelectorForm,
  type ClassroomOption,
} from "./pp5-class-selector-form";

export async function generateMetadata({
  searchParams,
}: Props): Promise<Metadata> {
  const p = await searchParams;
  // Non-embed = the selector page → keep the constant title bar.
  // Embed = the print iframe → its document.title becomes the saved-PDF
  // filename, so name it "<งาน> <ภาคเรียน/ปี>". User spec 2026-05-31.
  if (p.embed !== "1") return {};
  const [suffix, room] = await Promise.all([
    currentTermSuffix(),
    reportClassroomLabel(p.classroom),
  ]);
  return { title: ["ปพ.5 รวมชั้น", room, suffix].filter(Boolean).join(" ") };
}

// ===================================================================
// ปพ.5 รวมชั้น (per-classroom cumulative report)
//
// Step 1 — Cover page only.
// Other sections (attendance, scores per subject, evals) come in later
// steps. The placeholder card the page used to show has been replaced
// with the real data fetch + cover layout matching the standard ปพ.5
// (รวม) school form per user spec 2026-05-19.
// ===================================================================

type Props = {
  searchParams: Promise<{
    classroom?: string;
    /** Section toggle — only "cover" is implemented in Step 1. Later
     *  steps will add "attendance", "scores", "evals". Absent → all. */
    parts?: string;
    /** "1" → render WITHOUT admin chrome (used by iframe preview). */
    embed?: string;
  }>;
};

const GRADE_BUCKETS = [0, 1, 1.5, 2, 2.5, 3, 3.5, 4] as const;

/** Minimum rows in the subject grade-distribution table on the cover.
 *  If a classroom has fewer numeric subjects than this, the table pads
 *  with blank rows (ที่ 1-13 pre-numbered) so the form looks complete
 *  and consistent across classrooms — matches the standard ปพ.5 (รวม)
 *  template (user spec 2026-05-20). */
const MIN_SUBJECT_ROWS = 13;

type AttendanceStatus = "present" | "absent" | "leave" | "sick";

const STATUS_CHAR: Record<AttendanceStatus, string> = {
  present: "/",
  absent: "×",
  leave: "ล",
  sick: "ป",
};

/** Paginated fetch for the attendance table — single classroom's data
 *  across an entire term can easily exceed PostgREST's 1000-row default.
 *  Mirrors the project's standard pagination pattern (see
 *  reference_setup_progress.md "Supabase max-rows pagination"). */
async function fetchAttendanceRange(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  classroomId: string,
  startDate: string,
  endDate: string,
): Promise<Array<{ student_id: string; date: string; status: string }>> {
  const PAGE = 1000;
  const all: Array<{ student_id: string; date: string; status: string }> = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("attendance")
      .select("student_id, date, status")
      .eq("classroom_id", classroomId)
      .gte("date", startDate)
      .lte("date", endDate)
      .order("date")
      .range(from, from + PAGE - 1);
    if (error || !data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

type SectionKey =
  | "cover"
  | "attendance"
  | "scores"
  | "characteristics"
  | "reading"
  | "competency";

function resolveParts(raw: string | undefined): Record<SectionKey, boolean> {
  if (!raw || raw.trim() === "") {
    return {
      cover: true,
      attendance: true,
      scores: true,
      characteristics: true,
      reading: true,
      competency: true,
    };
  }
  const tokens = new Set(raw.split(",").map((s) => s.trim()).filter(Boolean));
  return {
    cover: tokens.has("cover"),
    attendance: tokens.has("attendance"),
    scores: tokens.has("scores"),
    characteristics: tokens.has("characteristics"),
    reading: tokens.has("reading"),
    competency: tokens.has("competency"),
  };
}

export default async function Pp5ClassPage({ searchParams }: Props) {
  const params = await searchParams;
  const classroomId = params.classroom?.trim();
  const isEmbed = params.embed === "1";
  const parts = resolveParts(params.parts);

  if (!classroomId) {
    return <Pp5ClassSelector />;
  }

  // Teacher access guard — only homeroom teachers (and admin) can open
  // ปพ.5 รวมชั้น for a specific classroom. Subject teachers print the
  // per-subject report instead.
  const scope = await getTeacherScope();
  if (scope && !scope.homeroomClassroomIds.has(classroomId)) {
    return notFoundPage("คุณไม่ได้เป็นครูประจำชั้นของห้องนี้");
  }

  const supabase = await createClient();

  // 1. School info — single-tenant
  const { data: school } = await supabase
    .from("schools")
    .select(
      "name_th, district, province, affiliation, logo_url, director_name, director_title, academic_head_name, assessment_officer_name, deputy_director_name",
    )
    .limit(1)
    .maybeSingle();

  // 2. Classroom + grade level + academic year + study plan
  const { data: classroom } = await supabase
    .from("classrooms")
    .select(
      `
      id,
      room_number,
      study_plan_id,
      grade_level:grade_levels!grade_level_id (id, name_th, system),
      academic_year:academic_years!academic_year_id (id, year_be, current_semester)
    `,
    )
    .eq("id", classroomId)
    .maybeSingle();

  if (!classroom?.grade_level || !classroom.academic_year) {
    return notFoundPage("ไม่พบข้อมูลห้องเรียน");
  }

  const isPrimary = classroom.grade_level.system === "primary";
  const yearId = classroom.academic_year.id;
  const yearBe = classroom.academic_year.year_be;
  const semester: 1 | 2 = (classroom.academic_year.current_semester ?? 1) as
    | 1
    | 2;
  const classLabel = `ชั้น${classroom.grade_level.name_th}${await reportRoomSuffix(classroomId)}`;

  // 3. Enrollments — primary uses semester=0 (annual), secondary uses
  //    current term (1 or 2)
  const enrollmentSemester: 0 | 1 | 2 = isPrimary ? 0 : semester;
  const { data: enrolls } = await supabase
    .from("enrollments")
    .select(
      `
      student_number,
      student:students!student_id (id, student_code, title, first_name, last_name, gender)
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
      gender: e.student!.gender as "male" | "female" | null,
      full_label: `${abbreviateTitle(e.student!.title)}${e.student!.first_name} ${e.student!.last_name}`,
    }));
  const studentIds = students.map((s) => s.id);
  const maleCount = students.filter((s) => s.gender === "male").length;
  const femaleCount = students.filter((s) => s.gender === "female").length;

  // 4. Homeroom teachers (both slots — equal status)
  const { data: homerooms } = await supabase
    .from("homeroom_assignments")
    .select(
      `role, teacher:teachers!teacher_id ( user:users!user_id (full_name, title) )`,
    )
    .eq("classroom_id", classroomId)
    .order("role");
  const homeroomNames = (homerooms ?? [])
    .filter((h) => h.teacher?.user)
    .map(
      (h) => `${h.teacher!.user!.title ?? ""}${h.teacher!.user!.full_name}`,
    );

  // 5. Subjects on the cover — pulled from the classroom's STUDY PLAN
  //    (single source of truth for "what subjects this class learns")
  //    rather than from `subject_offerings`. User spec 2026-05-22:
  //    "หน้าปก ปพ.5 รวมชั้น มีแต่วิชาภาษาไทย" — root cause: cover used
  //    to derive subjects from offerings, so any subject WITHOUT a
  //    teacher assignment (no offering row yet) silently vanished. By
  //    sourcing from study_plan_subjects every plan subject shows up,
  //    even before admin runs /setup/teaching.
  //
  //    Offerings are still queried in parallel for grade lookups
  //    (offering_ids are needed to fetch grades/scores below).
  const [planSubjectsResult, offeringsResult] = await Promise.all([
    classroom.study_plan_id
      ? supabase
          .from("study_plan_subjects")
          .select(
            `
            sort_order,
            subject:subjects!subject_id (
              id, code, name_th, category, grading_mode, credit_hours,
              hours_per_year, semester, academic_year_id,
              learning_area:learning_areas!learning_area_id ( sort_order )
            )
          `,
          )
          .eq("study_plan_id", classroom.study_plan_id)
      : Promise.resolve({ data: [] as never[], error: null }),
    supabase
      .from("subject_offerings")
      .select("id, subject_id, semester")
      .eq("classroom_id", classroomId),
  ]);

  // Build subject list from plan — drop subjects belonging to a
  // different academic year (subjects table is per-(year, semester) so
  // stale plan links can point at last year's records) or, for
  // secondary classrooms, a different semester.
  const subjectMap = new Map<
    string,
    {
      id: string;
      code: string;
      name_th: string;
      category: "core" | "additional" | "activity";
      grading_mode: "numeric" | "pass_fail";
      credit_hours: number | null;
      hours_per_year: number | null;
      learningAreaSort: number; // กลุ่มสาระ (1-9) สำหรับเรียงลำดับ
      offeringIds: string[]; // all offerings for this subject in this class
    }
  >();
  for (const ps of planSubjectsResult.data ?? []) {
    // study_plan_subjects.subject is a JOIN; the FK is one-to-one so
    // Supabase resolves it as an OBJECT (not an array). The wider type
    // signature can present as array when the relationship is many —
    // here we treat as the single-row form.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = (ps as any).subject as {
      id: string;
      code: string;
      name_th: string;
      category: "core" | "additional" | "activity";
      grading_mode: "numeric" | "pass_fail";
      credit_hours: number | null;
      hours_per_year: number | null;
      semester: number;
      academic_year_id: string;
      learning_area: { sort_order: number } | null;
    } | null;
    if (!s) continue;
    if (s.academic_year_id !== yearId) continue;
    if (!isPrimary && s.semester !== semester) continue;
    if (subjectMap.has(s.id)) continue;
    subjectMap.set(s.id, {
      id: s.id,
      code: s.code,
      name_th: s.name_th,
      category: s.category,
      grading_mode: s.grading_mode,
      credit_hours: s.credit_hours,
      hours_per_year: s.hours_per_year,
      learningAreaSort: s.learning_area?.sort_order ?? 999,
      offeringIds: [],
    });
  }

  // Attach offering_ids — for primary each subject has 2 offerings
  // (sem 1 + sem 2); both are kept. For secondary, only the current
  // semester's offering is relevant.
  for (const o of offeringsResult.data ?? []) {
    const entry = subjectMap.get(o.subject_id);
    if (!entry) continue;
    if (!isPrimary && o.semester !== semester) continue;
    entry.offeringIds.push(o.id);
  }

  // เรียงวิชา: พื้นฐาน (core) → เพิ่มเติม (additional) → กิจกรรม (activity)
  // ในแต่ละประเภทเรียงตามกลุ่มสาระ (learning_areas.sort_order) แล้วตามรหัสวิชา
  const CATEGORY_ORDER: Record<"core" | "additional" | "activity", number> = {
    core: 0,
    additional: 1,
    activity: 2,
  };
  const subjects = Array.from(subjectMap.values()).sort((a, b) => {
    const byCat = CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category];
    if (byCat !== 0) return byCat;
    if (a.learningAreaSort !== b.learningAreaSort) {
      return a.learningAreaSort - b.learningAreaSort;
    }
    return a.code.localeCompare(b.code, "th");
  });

  // 6. Total instructional hours per year — derivation depends on system:
  //     Primary   → ทุกวิชา (core/additional + activity) เก็บใน
  //                 hours_per_year (ชั่วโมง/ปี) ตรงๆ · sum ทั้งหมด.
  //                 User spec 2026-05-22: "เอาเวลาเรียนของทุกวิชา
  //                 มารวมกัน รวมเวลาวิชากิจกรรมด้วย ตามที่บันทึกใน
  //                 เมนูจัดการรายวิชา".
  //     Secondary → core/additional ใช้ credit_hours × 40 (1 หน่วยกิต
  //                 = 40 ชม./ภาคเรียน × 2 ภาค ทำให้ ÷ 2 × 2 → 40 ชม./ปี).
  //                 activity ใช้ hours_per_year (เก็บเป็น "ชม./ภาค") × 2.
  const totalHoursPerYear = subjects.reduce((sum, s) => {
    if (isPrimary) {
      return sum + (s.hours_per_year ?? 0);
    }
    if (s.grading_mode === "pass_fail") {
      // Secondary activity: hours_per_year column stores per-semester
      // hours; double for annual total.
      return sum + (s.hours_per_year ?? 0) * 2;
    }
    return sum + (s.credit_hours ?? 0) * 40;
  }, 0);

  // 7. Grade distribution per subject (numeric subjects).
  //     - Primary: grades.grading_period='annual' rows
  //     - Secondary: grades.grading_period='semester' rows (current term)
  //     - Activity: pass_fail aggregated separately below.
  const allOfferingIds = subjects.flatMap((s) => s.offeringIds);
  const { data: gradeRows } =
    allOfferingIds.length > 0 && studentIds.length > 0
      ? await supabase
          .from("grades")
          .select(
            "student_id, offering_id, grading_period, grade, pass_fail, is_incomplete, is_no_eligibility",
          )
          .in("offering_id", allOfferingIds)
          .in("student_id", studentIds)
      : { data: [] };

  // Index for quick lookup
  type GradeRow = {
    student_id: string;
    offering_id: string;
    grading_period: "semester" | "annual";
    grade: number | null;
    pass_fail: "pass" | "fail" | null;
    is_incomplete: boolean | null;
    is_no_eligibility: boolean | null;
  };
  const gradeByKey = new Map<string, GradeRow>();
  for (const g of (gradeRows ?? []) as GradeRow[]) {
    gradeByKey.set(`${g.student_id}|${g.offering_id}`, g);
  }

  // For each subject, count students per grade bucket. For primary annual
  // there's 1 row per student per subject (annual). For secondary semester
  // it's 1 row per student per offering. Activity uses pass_fail.
  type SubjectSummary = {
    subject: (typeof subjects)[number];
    studentCount: number; // enrolled in this subject (typically = total class size)
    buckets: Map<number, number>; // grade → count
    rOrMsCount: number; // students with is_incomplete OR is_no_eligibility
    passCount: number;
    failCount: number;
  };
  const subjectSummaries: SubjectSummary[] = subjects.map((subj) => {
    const buckets = new Map<number, number>();
    for (const b of GRADE_BUCKETS) buckets.set(b, 0);
    let rOrMs = 0;
    let pass = 0;
    let fail = 0;
    for (const sid of studentIds) {
      // Find the relevant grade row for this student × subject.
      // For numeric: choose the latest period (annual for primary, semester
      // for secondary). For activity: any pass_fail row counts.
      let row: GradeRow | undefined;
      for (const oid of subj.offeringIds) {
        const r = gradeByKey.get(`${sid}|${oid}`);
        if (!r) continue;
        // Prefer the annual row for primary numeric; for activity use any
        // pass_fail; for secondary use the semester row.
        if (subj.grading_mode === "pass_fail" && r.pass_fail) {
          row = r;
          break;
        }
        if (subj.grading_mode === "numeric") {
          if (isPrimary && r.grading_period === "annual") {
            row = r;
            break;
          }
          if (!isPrimary && r.grading_period === "semester") {
            row = r;
            break;
          }
        }
      }
      if (!row) continue;
      if (row.is_incomplete || row.is_no_eligibility) {
        rOrMs++;
        continue;
      }
      if (subj.grading_mode === "pass_fail") {
        if (row.pass_fail === "pass") pass++;
        else if (row.pass_fail === "fail") fail++;
      } else if (row.grade != null) {
        const g = Number(row.grade);
        if (buckets.has(g)) buckets.set(g, (buckets.get(g) ?? 0) + 1);
      }
    }
    return {
      subject: subj,
      studentCount: studentIds.length,
      buckets,
      rOrMsCount: rOrMs,
      passCount: pass,
      failCount: fail,
    };
  });

  // 8. Eval aggregates (chars / reading-thinking / competency).
  //    Scope: primary = annual (semester=0); secondary = current term.
  const evalSemester: 0 | 1 | 2 = isPrimary ? 0 : semester;

  type EvalBuckets = {
    excellent: number; // ดีเยี่ยม (avg ≥ 2.5)
    good: number; // ดี (avg ≥ 1.5)
    pass: number; // ผ่าน (avg ≥ 0.5)
    fail: number; // ไม่ผ่าน (avg < 0.5)
    total: number; // students with any data
  };
  const emptyEvalBuckets = (): EvalBuckets => ({
    excellent: 0,
    good: 0,
    pass: 0,
    fail: 0,
    total: studentIds.length,
  });
  // ระดับด้วยฐานนิยม (มี 0 = ไม่ผ่าน) แล้ว bucket ตามระดับ 3/2/1/0
  const bucketLevel = (level: number | null, b: EvalBuckets) => {
    if (level == null) return;
    if (level >= 3) b.excellent++;
    else if (level === 2) b.good++;
    else if (level === 1) b.pass++;
    else b.fail++;
  };

  // Characteristics master list (with full fields for the eval section,
  // not just id for cover buckets).
  type CharRow = { id: string; name: string; sort_order: number };
  let characteristicsList: CharRow[] = [];
  // Per-student map: student_id → characteristic_id → score (for Step 4
  // EvalSection rendering). Populated alongside the cover buckets so the
  // section can reuse the same fetch.
  const charEvalMap = new Map<string, Map<string, number>>();

  const charBuckets = emptyEvalBuckets();
  if (studentIds.length > 0) {
    const { data: chars } = await supabase
      .from("characteristics")
      .select("id, name, sort_order")
      .eq("is_active", true)
      .order("sort_order");
    characteristicsList = (chars ?? []) as CharRow[];
    const charIds = characteristicsList.map((c) => c.id);
    if (charIds.length > 0) {
      const { data: evals } = await supabase
        .from("characteristic_evaluations")
        .select("student_id, characteristic_id, score")
        .eq("academic_year_id", yearId)
        .eq("semester", evalSemester)
        .in("student_id", studentIds)
        .in("characteristic_id", charIds);
      const scoresByStudent = new Map<string, number[]>();
      for (const e of evals ?? []) {
        if (e.score == null) continue;
        // Per-student map (for EvalSection)
        let inner = charEvalMap.get(e.student_id);
        if (!inner) {
          inner = new Map();
          charEvalMap.set(e.student_id, inner);
        }
        inner.set(e.characteristic_id, Number(e.score));
        // Collect scores for the mode-based cover distribution
        const arr = scoresByStudent.get(e.student_id) ?? [];
        arr.push(Number(e.score));
        scoresByStudent.set(e.student_id, arr);
      }
      for (const sid of studentIds) {
        bucketLevel(
          overallEvalLevel(scoresByStudent.get(sid) ?? []),
          charBuckets,
        );
      }
    }
  }

  // Reading-thinking-writing — keep per-student map (sub-scores) for
  // EvalSection AND compute the avg-based bucket distribution for cover.
  const rtBuckets = emptyEvalBuckets();
  const readingThinkingByStudent = new Map<
    string,
    { reading: number | null; thinking: number | null; writing: number | null }
  >();
  if (studentIds.length > 0) {
    const { data: evals } = await supabase
      .from("reading_thinking_evaluations")
      .select("student_id, reading_score, thinking_score, writing_score")
      .eq("academic_year_id", yearId)
      .eq("semester", evalSemester)
      .in("student_id", studentIds);
    const byStudent = new Map<string, number>();
    for (const e of evals ?? []) {
      readingThinkingByStudent.set(e.student_id, {
        reading: e.reading_score == null ? null : Number(e.reading_score),
        thinking: e.thinking_score == null ? null : Number(e.thinking_score),
        writing: e.writing_score == null ? null : Number(e.writing_score),
      });
      const level = overallEvalLevel([
        e.reading_score == null ? null : Number(e.reading_score),
        e.thinking_score == null ? null : Number(e.thinking_score),
        e.writing_score == null ? null : Number(e.writing_score),
      ]);
      if (level != null) byStudent.set(e.student_id, level);
    }
    for (const sid of studentIds) {
      bucketLevel(byStudent.get(sid) ?? null, rtBuckets);
    }
  }

  // Competency — same pattern: keep per-student sub-scores for the eval
  // section + compute avg-based bucket distribution for cover.
  const compBuckets = emptyEvalBuckets();
  const competencyByStudent = new Map<
    string,
    {
      communication: number | null;
      thinking: number | null;
      problem_solving: number | null;
      life_skills: number | null;
      technology: number | null;
    }
  >();
  if (studentIds.length > 0) {
    const { data: evals } = await supabase
      .from("competency_evaluations")
      .select(
        "student_id, communication_score, thinking_score, problem_solving_score, life_skills_score, technology_score",
      )
      .eq("academic_year_id", yearId)
      .eq("semester", evalSemester)
      .in("student_id", studentIds);
    const byStudent = new Map<string, number>();
    for (const e of evals ?? []) {
      competencyByStudent.set(e.student_id, {
        communication:
          e.communication_score == null ? null : Number(e.communication_score),
        thinking:
          e.thinking_score == null ? null : Number(e.thinking_score),
        problem_solving:
          e.problem_solving_score == null
            ? null
            : Number(e.problem_solving_score),
        life_skills:
          e.life_skills_score == null ? null : Number(e.life_skills_score),
        technology:
          e.technology_score == null ? null : Number(e.technology_score),
      });
      const level = overallEvalLevel([
        e.communication_score == null ? null : Number(e.communication_score),
        e.thinking_score == null ? null : Number(e.thinking_score),
        e.problem_solving_score == null
          ? null
          : Number(e.problem_solving_score),
        e.life_skills_score == null ? null : Number(e.life_skills_score),
        e.technology_score == null ? null : Number(e.technology_score),
      ]);
      if (level != null) byStudent.set(e.student_id, level);
    }
    for (const sid of studentIds) {
      bucketLevel(byStudent.get(sid) ?? null, compBuckets);
    }
  }

  // 9. Aggregate "activity (pass/fail) summary" — combined across all
  //    activity subjects. A student is overall "pass" if all activities
  //    passed; "fail" if any failed.
  const activitySubjects = subjectSummaries.filter(
    (s) => s.subject.grading_mode === "pass_fail",
  );
  let overallPass = 0;
  let overallFail = 0;
  if (activitySubjects.length > 0) {
    for (const sid of studentIds) {
      let anyFail = false;
      let anyPass = false;
      for (const a of activitySubjects) {
        for (const oid of a.subject.offeringIds) {
          const r = gradeByKey.get(`${sid}|${oid}`);
          if (!r) continue;
          if (r.pass_fail === "fail") anyFail = true;
          else if (r.pass_fail === "pass") anyPass = true;
        }
      }
      if (anyFail) overallFail++;
      else if (anyPass) overallPass++;
    }
  }

  // 10. Attendance — daily check, one printed page per month.
  //    Scope (user spec 2026-05-20: "มัธยมเฉพาะภาคเรียนปัจจุบัน · ประถม
  //    เอามาทุกเดือน"):
  //      - Primary: full academic year (11 months, both terms)
  //      - Secondary: current semester only (5 or 6 months)
  //    Single paginated fetch covers the whole range; we group by month
  //    afterwards so per-month pages don't trigger extra queries.
  const monthsInTerm = isPrimary
    ? [...TERM_MONTHS[1], ...TERM_MONTHS[2]]
    : TERM_MONTHS[semester];
  /** For primary we span both terms — pick the correct term per month
   *  so resolveCalendarYear bumps the CE year for Jan-Mar (term 2 tail). */
  const termForMonth = (m: number): 1 | 2 => (m >= 5 && m <= 10 ? 1 : 2);
  const firstMonth = monthsInTerm[0];
  const lastMonth = monthsInTerm[monthsInTerm.length - 1];
  const firstYearCe = resolveCalendarYear(
    yearBe,
    firstMonth,
    termForMonth(firstMonth),
  );
  const lastYearCe = resolveCalendarYear(
    yearBe,
    lastMonth,
    termForMonth(lastMonth),
  );
  const lastDay = calcDaysInMonth(lastYearCe, lastMonth);
  const semStart = `${firstYearCe}-${String(firstMonth).padStart(2, "0")}-01`;
  const semEnd = `${lastYearCe}-${String(lastMonth).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

  const [workdaysResult, holidaysResult, attendanceRows] = await Promise.all([
    supabase
      .from("workdays")
      .select("date")
      .eq("classroom_id", classroomId)
      .gte("date", semStart)
      .lte("date", semEnd),
    supabase
      .from("holidays")
      .select("date")
      .gte("date", semStart)
      .lte("date", semEnd),
    fetchAttendanceRange(supabase, classroomId, semStart, semEnd),
  ]);

  // Group days into month buckets: month → Set<day-of-month>.
  // Attendance: student_id → month → day → status.
  type MonthAttMap = Map<number, Map<string, Map<number, AttendanceStatus>>>;
  const workdaysByMonth = new Map<number, Set<number>>();
  const holidaysByMonth = new Map<number, Set<number>>();
  const attByMonth: MonthAttMap = new Map();
  for (const m of monthsInTerm) {
    workdaysByMonth.set(m, new Set());
    holidaysByMonth.set(m, new Set());
    attByMonth.set(m, new Map());
  }
  for (const w of workdaysResult.data ?? []) {
    const [, mm, dd] = w.date.split("-").map(Number);
    if (workdaysByMonth.has(mm)) workdaysByMonth.get(mm)!.add(dd);
  }
  for (const h of holidaysResult.data ?? []) {
    const [, mm, dd] = h.date.split("-").map(Number);
    if (holidaysByMonth.has(mm)) holidaysByMonth.get(mm)!.add(dd);
  }
  for (const a of attendanceRows) {
    const [, mm, dd] = a.date.split("-").map(Number);
    if (!attByMonth.has(mm)) continue;
    const monthMap = attByMonth.get(mm)!;
    if (!monthMap.has(a.student_id)) monthMap.set(a.student_id, new Map());
    monthMap.get(a.student_id)!.set(dd, a.status as AttendanceStatus);
  }

  // 11. Score data for Step 3 — fetch score_categories + scores for all
  //    numeric offerings in this classroom, plus grading_scales. Group
  //    by offering_id so per-subject rendering can lookup quickly.
  const numericOfferingIds = subjects
    .filter((s) => s.grading_mode === "numeric")
    .flatMap((s) => s.offeringIds);
  const [
    { data: scoreCategoriesAll },
    { data: scoresAll },
    { data: scalesAll },
  ] = await Promise.all([
    numericOfferingIds.length > 0
      ? supabase
          .from("score_categories")
          .select(
            "id, offering_id, name, sort_order, max_score, is_midterm, is_final",
          )
          .in("offering_id", numericOfferingIds)
      : { data: [] },
    numericOfferingIds.length > 0 && studentIds.length > 0
      ? supabase
          .from("scores")
          .select("student_id, category_id, score")
          .in("category_id", []) // placeholder — replaced below
      : { data: [] },
    supabase
      .from("grade_scales")
      .select("min_score, max_score, grade"),
  ]);
  // The placeholder above couldn't filter by category_id (we didn't know
  // the IDs yet). Refetch using the category IDs we now have.
  type CategoryRow = {
    id: string;
    offering_id: string;
    name: string;
    sort_order: number;
    max_score: number;
    is_midterm: boolean;
    is_final: boolean;
  };
  const allCategoryIds = ((scoreCategoriesAll ?? []) as CategoryRow[]).map(
    (c) => c.id,
  );
  type ScoreRow = {
    student_id: string;
    category_id: string;
    score: number | null;
  };
  let scoresRowsList: ScoreRow[] = [];
  if (allCategoryIds.length > 0 && studentIds.length > 0) {
    // Paginated fetch — scores can be 30 students × ~10 categories × N
    // offerings, easily over 1000.
    const PAGE = 1000;
    let from = 0;
    while (true) {
      const { data: page } = await supabase
        .from("scores")
        .select("student_id, category_id, score")
        .in("category_id", allCategoryIds)
        .in("student_id", studentIds)
        .order("category_id")
        .range(from, from + PAGE - 1);
      if (!page || page.length === 0) break;
      scoresRowsList.push(...(page as ScoreRow[]));
      if (page.length < PAGE) break;
      from += PAGE;
    }
  }
  // Suppress unused-var lint from the placeholder fetch above
  void scoresAll;

  // Index: offering_id → categories[]
  const categoriesByOffering = new Map<string, CategoryRow[]>();
  for (const c of (scoreCategoriesAll ?? []) as CategoryRow[]) {
    if (!categoriesByOffering.has(c.offering_id)) {
      categoriesByOffering.set(c.offering_id, []);
    }
    categoriesByOffering.get(c.offering_id)!.push(c);
  }
  // Index: offering_id → studentId → categoryId → value
  const categoryToOffering = new Map<string, string>();
  for (const c of (scoreCategoriesAll ?? []) as CategoryRow[]) {
    categoryToOffering.set(c.id, c.offering_id);
  }
  const scoresByOffering = new Map<
    string,
    Map<string, Record<string, number>>
  >();
  for (const r of scoresRowsList) {
    const oid = categoryToOffering.get(r.category_id);
    if (!oid || r.score == null) continue;
    if (!scoresByOffering.has(oid)) scoresByOffering.set(oid, new Map());
    const inner = scoresByOffering.get(oid)!;
    if (!inner.has(r.student_id)) inner.set(r.student_id, {});
    inner.get(r.student_id)![r.category_id] = Number(r.score);
  }
  const scales = (scalesAll ?? []) as Array<{
    min_score: number;
    max_score: number;
    grade: number;
  }>;

  // Students with full schema needed for score components (adds
  // student_code which the score tables print as เลขประจำตัว)
  const studentsForScore = (enrolls ?? [])
    .filter((e) => e.student)
    .map((e) => ({
      id: e.student!.id,
      student_number: e.student_number,
      student_code: e.student!.student_code ?? "",
      full_label: `${abbreviateTitle(e.student!.title)}${e.student!.first_name} ${e.student!.last_name}`,
    }));

  return (
    <>
      {isEmbed && (
        <style
          dangerouslySetInnerHTML={{
            __html: `
              aside { display: none !important; }
              .no-print { display: none !important; }
              [class*="max-w-6xl"] { max-width: none !important; padding: 0 !important; }
              /* Hide the iframe document's scrollbar but keep scrolling
                 functional — user spec 2026-05-20: "เอาสกอบาร์ออก แต่ก็
                 สามารถเลื่อนขึ้นลงได้". Three cross-browser declarations
                 cover Firefox, IE/Edge legacy, and WebKit/Blink. */
              html, body {
                scrollbar-width: none;
                -ms-overflow-style: none;
              }
              html::-webkit-scrollbar,
              body::-webkit-scrollbar {
                display: none;
                width: 0;
                height: 0;
              }
              /* Screen-only paper-box layout — mirrors /reports/pp5 (per-
                 subject) so each .pp5-page-content renders as its own
                 white "paper" with shadow + gap, mimicking browser print
                 preview. Print uses the real @page rules below; this
                 paper-box styling is hidden via @media screen so it
                 doesn't appear on paper. User spec 2026-05-20:
                 "หน้าพรีวิวให้แสดงแบบแยกหน้าชัดเจน · ทำแบบหน้า ปพ5.รายวิชา". */
              @media screen {
                body {
                  background: #e2e8f0 !important;
                  padding: 1rem 0 !important;
                }
                .pp5-page {
                  max-width: 210mm;
                  margin: 0 auto;
                  background: transparent !important;
                  padding: 0 !important;
                  box-shadow: none !important;
                  border: none !important;
                }
                .pp5-page-content {
                  background: #ffffff;
                  padding: 14mm 12mm;
                  margin: 0 auto 1.5rem;
                  box-shadow: 0 1px 4px rgba(0,0,0,0.15);
                  border: 1px solid #cbd5e1;
                  min-height: 250mm;
                }
              }
              /* Override the default @page margin for the iframe print
                 context — top 15mm (vs globals.css default 7mm) so logo
                 + header don't crowd the top edge. The CSS Paged Media
                 \`page\` property on inner elements doesn't always apply
                 to the FIRST printed page in Chrome; setting @page here
                 directly (no name) overrides the default and applies
                 to every page in this iframe. User spec 2026-05-20:
                 "ที่แบบพิมพ์ยังอยู่ที่เดิม". */
              @page {
                size: A4 portrait;
                margin: 15mm 12mm 5mm;
              }
            `,
          }}
        />
      )}

      <main className="pp5-page">
        {!isEmbed && (
          <div className="pp5-toolbar no-print">
            <Link href="/reports/pp5-class" className="pp5-back">
              ← เปลี่ยนห้อง
            </Link>
          </div>
        )}

        {parts.cover && (
          <Pp5ClassCover
            school={school}
            classLabel={classLabel}
            yearBe={yearBe}
            totalHoursPerYear={totalHoursPerYear}
            homeroomNames={homeroomNames}
            subjectSummaries={subjectSummaries}
            studentCount={studentIds.length}
            maleCount={maleCount}
            femaleCount={femaleCount}
            charBuckets={charBuckets}
            rtBuckets={rtBuckets}
            compBuckets={compBuckets}
            activityPassCount={overallPass}
            activityFailCount={overallFail}
          />
        )}

        {/* Step 2: Monthly attendance — one printed page per month.
            Primary spans the whole academic year; secondary stays within
            the current term (see monthsInTerm above). `termForMonth`
            ensures Jan-Mar months use yearBe+1's CE year.
            Followed by one summary page (full-year for primary, per-term
            for secondary) that aggregates totals by month using the
            shared AttendanceSummarySection component. */}
        {parts.attendance && (
          <>
            {monthsInTerm.map((month) => (
              <Pp5ClassMonthlyAttendance
                key={month}
                month={month}
                yearBe={yearBe}
                yearCe={resolveCalendarYear(yearBe, month, termForMonth(month))}
                students={students.map((s) => ({
                  id: s.id,
                  student_number: s.student_number,
                  full_label: s.full_label,
                }))}
                workdays={workdaysByMonth.get(month) ?? new Set()}
                holidays={holidaysByMonth.get(month) ?? new Set()}
                attMap={attByMonth.get(month) ?? new Map()}
                classLabel={classLabel}
                schoolName={school?.name_th ?? ""}
              />
            ))}
            <section className="pp5-page-content pp5-class-att-summary">
              <div className="att-page-header">
                <h2 className="att-page-title">
                  สรุปเวลาเรียน {classLabel}
                </h2>
                <p className="att-page-meta">
                  <span>ปีการศึกษา {yearBe}</span>
                  <span>
                    {isPrimary ? "สรุปทั้งปี" : `สรุปภาคเรียนที่ ${semester}`}
                  </span>
                </p>
              </div>
              <AttendanceSummarySection
                classroomId={classroomId}
                yearBe={yearBe}
                term={isPrimary ? undefined : semester}
                padRows={30}
              />
            </section>
          </>
        )}

        {/* Step 3: Score per subject — 1 page per numeric subject.
            - Primary: PrimaryAnnualSummary (sem1 + sem2 aggregated)
            - Secondary: NumericTable (current semester only)
            - Activity: PassFailTable (one row per student with pass/fail)
            Components are reused from /reports/pp5/page.tsx so the
            visual layout matches the per-subject report exactly. */}
        {parts.scores &&
          subjects.map((subj) => (
            <Pp5ClassScoreSection
              key={subj.id}
              subject={subj}
              students={studentsForScore}
              categoriesByOffering={categoriesByOffering}
              scoresByOffering={scoresByOffering}
              scales={scales}
              isPrimary={isPrimary}
              semester={semester}
              classLabel={classLabel}
              yearBe={yearBe}
              gradeByKey={gradeByKey}
            />
          ))}
        {/* Step 4 — evaluation pages (chars / reading-thinking / competency).
            Reuses EvalSection from /reports/pp5/page.tsx which internally
            calls EvalReportPage 3 times — already pads to ≥30 rows AND
            expands if class size > 30 students. Per-section visibility
            mapped from the URL's `parts` toggle. */}
        {(parts.characteristics || parts.reading || parts.competency) &&
          studentIds.length > 0 && (
            <EvalSection
              students={studentsForScore.map((s) => ({
                id: s.id,
                student_number: s.student_number,
                full_label: s.full_label,
              }))}
              characteristics={characteristicsList}
              charEvalMap={charEvalMap}
              readingThinkingByStudent={readingThinkingByStudent}
              competencyByStudent={competencyByStudent}
              info={
                {
                  schoolName: school?.name_th ?? "",
                  affiliation: school?.affiliation ?? "",
                  district: school?.district ?? null,
                  province: school?.province ?? null,
                  logoUrl: school?.logo_url ?? null,
                  directorName: school?.director_name ?? "",
                  directorTitle: school?.director_title ?? "",
                  deputyDirectorName: school?.deputy_director_name ?? null,
                  academicHeadName: school?.academic_head_name ?? null,
                  assessmentOfficerName:
                    school?.assessment_officer_name ?? null,
                  classLabel,
                  gradeShort: "",
                  isPrimaryLevel: isPrimary,
                  isSecondaryLevel: !isPrimary,
                  yearBe,
                  semester,
                  subjectCode: "",
                  subjectName: "",
                  subjectCategory: "core" as const,
                  learningAreaName: null,
                  creditHours: null,
                  hoursPerWeek: 0,
                  totalHoursPerSemester: 0,
                  teacherLabel: "—",
                  homeroomLabel:
                    homeroomNames.length > 0
                      ? homeroomNames.join(" · ")
                      : null,
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                } as any
              }
              signers={[]}
              show={{
                characteristics: parts.characteristics,
                reading: parts.reading,
                competency: parts.competency,
              }}
            />
          )}
      </main>
    </>
  );
}

// ===================================================================
// Pp5ClassScoreSection — one printed page per subject. Dispatches to
// the right rendering based on subject category + grading mode:
//   - Activity (pass_fail) → PassFailTable
//   - Numeric primary → PrimaryAnnualSummary (combined sem1 + sem2)
//   - Numeric secondary → NumericTable (current semester)
// All three components come from /reports/pp5/page.tsx (re-exported)
// so the bundle's per-subject pages match the standalone per-subject
// report exactly. A simple header with subject info renders above.
// ===================================================================

type SubjectShape = {
  id: string;
  code: string;
  name_th: string;
  category: "core" | "additional" | "activity";
  grading_mode: "numeric" | "pass_fail";
  credit_hours: number | null;
  hours_per_year: number | null;
  offeringIds: string[];
};

function Pp5ClassScoreSection({
  subject,
  students,
  categoriesByOffering,
  scoresByOffering,
  scales,
  isPrimary,
  semester,
  classLabel,
  yearBe,
  gradeByKey,
}: {
  subject: SubjectShape;
  students: Array<{
    id: string;
    student_number: number;
    student_code: string;
    full_label: string;
  }>;
  categoriesByOffering: Map<
    string,
    Array<{
      id: string;
      offering_id: string;
      name: string;
      sort_order: number;
      max_score: number;
      is_midterm: boolean;
      is_final: boolean;
    }>
  >;
  scoresByOffering: Map<string, Map<string, Record<string, number>>>;
  scales: Array<{ min_score: number; max_score: number; grade: number }>;
  isPrimary: boolean;
  semester: 1 | 2;
  classLabel: string;
  yearBe: number;
  gradeByKey: Map<
    string,
    {
      student_id: string;
      offering_id: string;
      grading_period: "semester" | "annual";
      grade: number | null;
      pass_fail: "pass" | "fail" | null;
      is_incomplete: boolean | null;
      is_no_eligibility: boolean | null;
    }
  >;
}) {
  // Build a MINIMAL HeaderInfo — only the fields Pp5ScoreHeader actually
  // reads (classLabel, subjectCode, subjectName, semester, yearBe). The
  // rest are typed-required but unused; populating with sensible empties
  // lets us reuse the standalone /reports/pp5 components without a heavy
  // per-subject teacher/learning_area fetch.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const info: any = {
    schoolName: "",
    affiliation: "",
    district: null,
    province: null,
    logoUrl: null,
    directorName: "",
    directorTitle: "",
    deputyDirectorName: null,
    academicHeadName: null,
    assessmentOfficerName: null,
    classLabel,
    gradeShort: "",
    isPrimaryLevel: isPrimary,
    isSecondaryLevel: !isPrimary,
    yearBe,
    semester,
    subjectCode: subject.code,
    subjectName: subject.name_th,
    subjectCategory: subject.category,
    learningAreaName: null,
    creditHours: subject.credit_hours,
    hoursPerWeek: 0,
    totalHoursPerSemester: 0,
    teacherLabel: "—",
    homeroomLabel: null,
  };

  // Activity subjects (pass_fail) — fold each student's pass/fail from
  // any offering's grade row. Any "fail" wins; otherwise pass if any
  // offering has pass; else null.
  if (subject.grading_mode === "pass_fail") {
    const studentRows = students.map((s) => {
      let result: "pass" | "fail" | null = null;
      for (const oid of subject.offeringIds) {
        const r = gradeByKey.get(`${s.id}|${oid}`);
        if (r?.pass_fail === "fail") {
          result = "fail";
          break;
        }
        if (r?.pass_fail === "pass") result = "pass";
      }
      return { ...s, result };
    });
    return <PassFailTable students={studentRows} info={info} />;
  }

  // Numeric — primary aggregates sem1+sem2 with PrimaryAnnualSummary,
  // secondary shows current semester only with NumericTable.
  // NumericTable always renders the standard 5+midterm+5+final structure
  // (per user spec 2026-05-20: "ตารางที่ไม่มีข้อมูลก็ให้แสดงตามปกติ
  // ไม่มีข้อมูลก็ว่างไว้") — empty cells fall through to blank instead
  // of needing an upstream placeholder.
  if (isPrimary) {
    const sem1OfferingId = subject.offeringIds[0] ?? null;
    const sem2OfferingId = subject.offeringIds[1] ?? null;
    const sem1 = {
      categories: (sem1OfferingId
        ? (categoriesByOffering.get(sem1OfferingId) ?? [])
        : []
      ).map((c) => ({ id: c.id, max_score: c.max_score })),
      scoresByStudent:
        (sem1OfferingId ? scoresByOffering.get(sem1OfferingId) : undefined) ??
        new Map<string, Record<string, number>>(),
    };
    const sem2 = {
      categories: (sem2OfferingId
        ? (categoriesByOffering.get(sem2OfferingId) ?? [])
        : []
      ).map((c) => ({ id: c.id, max_score: c.max_score })),
      scoresByStudent:
        (sem2OfferingId ? scoresByOffering.get(sem2OfferingId) : undefined) ??
        new Map<string, Record<string, number>>(),
    };
    return (
      <PrimaryAnnualSummary
        students={students}
        sem1={sem1}
        sem2={sem2}
        scales={scales}
        info={info}
        showHeader={true}
      />
    );
  }

  // Secondary numeric
  const offeringId = subject.offeringIds[0] ?? null;
  const categories = (offeringId
    ? (categoriesByOffering.get(offeringId) ?? [])
    : []
  ).map((c) => ({
    id: c.id,
    name: c.name,
    sort_order: c.sort_order,
    max_score: c.max_score,
    is_midterm: c.is_midterm,
    is_final: c.is_final,
  }));
  const scoresByStudent =
    (offeringId ? scoresByOffering.get(offeringId) : undefined) ??
    new Map<string, Record<string, number>>();
  return (
    <NumericTable
      categories={categories}
      students={students}
      scoresByStudent={scoresByStudent}
      scales={scales}
      isPrimary={false}
      info={info}
    />
  );
}

// ===================================================================
// Pp5ClassMonthlyAttendance — one printed page per month showing daily
// attendance check (มา / ขาด / ลา / ป) for the whole class. Mirrors
// the layout of /reports/attendance's per-month grid, but reuses
// pre-fetched per-month data so the bundle's many sections can share
// one set of network calls.
// ===================================================================

function Pp5ClassMonthlyAttendance({
  month,
  yearBe,
  yearCe,
  students,
  workdays,
  holidays,
  attMap,
  classLabel,
  schoolName,
}: {
  month: number;
  yearBe: number;
  yearCe: number;
  students: Array<{ id: string; student_number: number; full_label: string }>;
  workdays: Set<number>;
  holidays: Set<number>;
  attMap: Map<string, Map<number, AttendanceStatus>>;
  classLabel: string;
  schoolName: string;
}) {
  const dim = calcDaysInMonth(yearCe, month);
  const days = Array.from({ length: dim }, (_, i) => i + 1);
  const dowOf = (day: number): string =>
    THAI_DOW[new Date(yearCe, month - 1, day).getDay()];
  const isWeekend = (day: number): boolean => {
    const dow = new Date(yearCe, month - 1, day).getDay();
    return dow === 0 || dow === 6;
  };

  // Per-student totals — count only workdays
  type Counts = { present: number; absent: number; leave: number; sick: number };
  const totalsOf = (sid: string): Counts => {
    const counts: Counts = { present: 0, absent: 0, leave: 0, sick: 0 };
    const map = attMap.get(sid) ?? new Map<number, AttendanceStatus>();
    for (const d of workdays) {
      const s = map.get(d);
      if (s === "present") counts.present++;
      else if (s === "absent") counts.absent++;
      else if (s === "leave") counts.leave++;
      else if (s === "sick") counts.sick++;
    }
    return counts;
  };

  // Pad to ≥30 rows for binding (matches the per-month attendance
  // report and the cover's subject table convention).
  const PADDED_ROW_COUNT =
    students.length === 0
      ? 30
      : Math.max(30, ...students.map((s) => s.student_number));
  const tableClass = `att-table${PADDED_ROW_COUNT <= 30 ? " att-table--roomy" : ""}`;

  return (
    <section className="pp5-page-content pp5-class-monthly-att">
      <div className="att-page-header">
        <h2 className="att-page-title">
          แบบบันทึกเวลาเรียน — เดือน{THAI_MONTH_FULL[month - 1]} {yearBe}
        </h2>
        <p className="att-page-meta">
          <span>{classLabel}</span>
          {schoolName && <span>{withSchoolPrefix(schoolName)}</span>}
          <span>วันทำการ {workdays.size} วัน</span>
        </p>
      </div>

      <table className={tableClass}>
        <thead>
          <tr>
            <th rowSpan={3} className="att-col-num">ที่</th>
            <th rowSpan={3} className="att-col-name">ชื่อ – สกุล</th>
            <th colSpan={dim} className="att-group">วันที่</th>
            <th colSpan={4} rowSpan={2} className="att-group">สรุป</th>
          </tr>
          <tr>
            {days.map((d) => (
              <th
                key={`dow-${d}`}
                className={dayHeadClass(d, workdays, holidays, isWeekend)}
              >
                {dowOf(d)}
              </th>
            ))}
          </tr>
          <tr>
            {days.map((d) => (
              <th
                key={`day-${d}`}
                className={dayHeadClass(d, workdays, holidays, isWeekend)}
              >
                {d}
              </th>
            ))}
            <th className="att-col-sum">มา</th>
            <th className="att-col-sum">ขาด</th>
            <th className="att-col-sum">ลา</th>
            <th className="att-col-pct">ร้อยละ</th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: PADDED_ROW_COUNT }, (_, i) => {
            const rowNum = i + 1;
            const s = students.find((x) => x.student_number === rowNum) ?? null;
            const counts = s ? totalsOf(s.id) : null;
            const map = s
              ? (attMap.get(s.id) ?? new Map<number, AttendanceStatus>())
              : new Map<number, AttendanceStatus>();
            const pct =
              s && workdays.size > 0 && counts
                ? (counts.present / workdays.size) * 100
                : null;
            return (
              <tr key={`r-${rowNum}`}>
                <td>{rowNum}</td>
                <td className="att-name">{s?.full_label ?? ""}</td>
                {days.map((d) => {
                  const cls = dayCellClass(d, workdays, holidays, isWeekend);
                  const status = s && workdays.has(d) ? map.get(d) : undefined;
                  return (
                    <td key={d} className={cls}>
                      {status ? STATUS_CHAR[status] : ""}
                    </td>
                  );
                })}
                <td>{s && counts ? <strong>{counts.present}</strong> : ""}</td>
                <td>{s && counts ? counts.absent : ""}</td>
                <td>{s && counts ? counts.leave : ""}</td>
                <td>{pct == null ? "" : pct.toFixed(1)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

/** Header cell class for a single day-of-month — tints non-workdays. */
function dayHeadClass(
  day: number,
  workdays: Set<number>,
  holidays: Set<number>,
  isWeekend: (d: number) => boolean,
): string {
  if (workdays.has(day)) return "att-day-head";
  if (holidays.has(day)) return "att-day-head att-holiday";
  if (isWeekend(day)) return "att-day-head att-weekend";
  return "att-day-head att-nonwork";
}

/** Body cell class for a single day-of-month (matches header tint). */
function dayCellClass(
  day: number,
  workdays: Set<number>,
  holidays: Set<number>,
  isWeekend: (d: number) => boolean,
): string {
  if (workdays.has(day)) return "att-day";
  if (holidays.has(day)) return "att-day att-holiday";
  if (isWeekend(day)) return "att-day att-weekend";
  return "att-day att-nonwork";
}

// ===================================================================
// Pp5ClassCover — single A4 portrait page cover for ปพ.5 รวมชั้น.
// Layout based on the standard ปพ.5 (รวม) school form image the user
// shared on 2026-05-19. Contains: school header, class meta, subject
// grade distribution table, 3 eval summary tables + activity summary,
// student gender count, approval signature block.
// ===================================================================

type EvalBucketsT = {
  excellent: number;
  good: number;
  pass: number;
  fail: number;
  total: number;
};

function Pp5ClassCover({
  school,
  classLabel,
  yearBe,
  totalHoursPerYear,
  homeroomNames,
  subjectSummaries,
  studentCount,
  maleCount,
  femaleCount,
  charBuckets,
  rtBuckets,
  compBuckets,
  activityPassCount,
  activityFailCount,
}: {
  school:
    | {
        name_th: string;
        district: string | null;
        province: string | null;
        affiliation: string | null;
        logo_url: string | null;
        director_name: string | null;
        director_title: string | null;
        academic_head_name: string | null;
        assessment_officer_name: string | null;
        deputy_director_name: string | null;
      }
    | null;
  classLabel: string;
  yearBe: number;
  totalHoursPerYear: number;
  homeroomNames: string[];
  subjectSummaries: Array<{
    subject: {
      id: string;
      code: string;
      name_th: string;
      category: "core" | "additional" | "activity";
      grading_mode: "numeric" | "pass_fail";
    };
    studentCount: number;
    buckets: Map<number, number>;
    rOrMsCount: number;
    passCount: number;
    failCount: number;
  }>;
  studentCount: number;
  maleCount: number;
  femaleCount: number;
  charBuckets: EvalBucketsT;
  rtBuckets: EvalBucketsT;
  compBuckets: EvalBucketsT;
  activityPassCount: number;
  activityFailCount: number;
}) {
  // Format numeric subjects (core + additional) into the grade-distribution
  // table. Activity subjects go in the separate pass/fail summary box.
  const numericSubjects = subjectSummaries.filter(
    (s) => s.subject.grading_mode === "numeric",
  );

  return (
    <section
      className={`pp5-page-content pp5-class-cover${
        numericSubjects.length > MIN_SUBJECT_ROWS
          ? " pp5-class-cover--compact"
          : ""
      }`}
    >
      {/* Top header — logo (centered) + "ปพ.5 (รวม)" label (top-right) */}
      <div className="pp5-class-top">
        {school?.logo_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={school.logo_url}
            alt="โลโก้โรงเรียน"
            className="pp5-class-logo"
          />
        )}
        <div className="pp5-class-label">ปพ.5 (รวม)</div>
      </div>

      <h1 className="pp5-class-title">แบบบันทึกผลการพัฒนาคุณภาพผู้เรียน</h1>

      {/* Two-line school header per user spec 2026-05-20:
            Line 1: ชื่อโรงเรียน + อำเภอ + จังหวัด
            Line 2: สังกัด (affiliation) */}
      <p className="pp5-class-school">
        {withSchoolPrefix(school?.name_th) || "—"}
        {school?.district ? `   อำเภอ${school.district}` : ""}
        {school?.province ? `   จังหวัด${school.province}` : ""}
      </p>
      {school?.affiliation && (
        <p className="pp5-class-school">{school.affiliation}</p>
      )}

      <p className="pp5-class-meta">
        <span>{classLabel}</span>
        <span>ปีการศึกษา {yearBe}</span>
        <span>เวลาเรียน {totalHoursPerYear.toLocaleString()} ชั่วโมง/ปี</span>
      </p>

      <p className="pp5-class-meta">
        <span>
          ครูประจำชั้น&nbsp;&nbsp;{homeroomNames.join(", ") || "—"}
        </span>
      </p>

      {/* Subject grade distribution.
          Columns (13 total, widths locked via <colgroup> + table-layout:
          fixed in globals.css):
            ที่ 4% · รหัสวิชา 8% · รายวิชา 30% · จำนวนนักเรียน 9% ·
            8 grade buckets × 5% (40%) · หมายเหตุ 9% = 100%

          Compact modifier kicks in when the numeric subject count
          exceeds the default MIN_SUBJECT_ROWS (13). The table + cell
          font + padding shrink so all rows still fit on a single page.
          User spec 2026-05-22. */}
      <table
        className={`pp5-table pp5-class-subjects${
          numericSubjects.length > MIN_SUBJECT_ROWS
            ? " pp5-class-subjects--compact"
            : ""
        }`}
      >
        <colgroup>
          <col style={{ width: "4%" }} />
          <col style={{ width: "8%" }} />
          <col style={{ width: "30%" }} />
          <col style={{ width: "9%" }} />
          {GRADE_BUCKETS.map((g) => (
            <col key={g} style={{ width: "5%" }} />
          ))}
          <col style={{ width: "9%" }} />
        </colgroup>
        <thead>
          <tr>
            <th rowSpan={2}>ที่</th>
            <th rowSpan={2}>รหัสวิชา</th>
            <th rowSpan={2}>รายวิชา</th>
            <th rowSpan={2}>จำนวนนักเรียน</th>
            <th colSpan={GRADE_BUCKETS.length}>
              สรุปผลการเรียน
              <br />
              <span className="pp5-class-subhead">
                จำนวนนักเรียนที่ได้รับผลการเรียน
              </span>
            </th>
            <th rowSpan={2}>หมายเหตุ</th>
          </tr>
          <tr>
            {GRADE_BUCKETS.map((g) => (
              <th key={g}>
                {g === 0
                  ? "0, ร, มส"
                  : Number.isInteger(g)
                    ? String(g)
                    : g.toFixed(1)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {numericSubjects.map((s, idx) => (
            // Use subject.id as the key — `code` is NOT unique in the DB
            // (some schools genuinely have multiple "ท16101" entries from
            // re-imports or accidental dupes), and React errors on dup keys.
            <tr key={s.subject.id}>
              <td>{idx + 1}</td>
              <td>{s.subject.code}</td>
              <td className="pp5-class-subj-name">{s.subject.name_th}</td>
              <td>{s.studentCount}</td>
              {GRADE_BUCKETS.map((g) => {
                const c = s.buckets.get(g) ?? 0;
                // The "0" bucket now also absorbs ร and มส counts —
                // combined column "0, ร, มส" per user spec 2026-05-20.
                const count = g === 0 ? c + s.rOrMsCount : c;
                return <td key={g}>{count > 0 ? count : "—"}</td>;
              })}
              <td></td>
            </tr>
          ))}
          {/* Pad with blank rows so the table always shows MIN_SUBJECT_ROWS
              (13) rows — ที่ column stays pre-numbered, other cells blank. */}
          {Array.from({
            length: Math.max(0, MIN_SUBJECT_ROWS - numericSubjects.length),
          }).map((_, padIdx) => {
            const rowNumber = numericSubjects.length + padIdx + 1;
            return (
              <tr key={`pad-${padIdx}`}>
                <td>{rowNumber}</td>
                <td></td>
                <td className="pp5-class-subj-name"></td>
                <td></td>
                {GRADE_BUCKETS.map((g) => (
                  <td key={g}></td>
                ))}
                <td></td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Eval summaries — 2-column layout per user spec 2026-05-19:
            LEFT  = คุณลักษณะ + อ่าน คิด วิเคราะห์ เขียน
            RIGHT = สมรรถนะ + กิจกรรม (pass/fail)
          Right replaces the old student-count table position. */}
      <div className="pp5-class-evals-grid">
        <div className="pp5-class-evals-col">
          <table className="pp5-table pp5-class-eval">
            <thead>
              <tr>
                <th colSpan={5} className="pp5-class-eval-title">
                  สรุปผลการประเมินคุณลักษณะอันพึงประสงค์
                </th>
              </tr>
              <tr>
                <th>จำนวนนักเรียนทั้งหมด</th>
                <th>ดีเยี่ยม</th>
                <th>ดี</th>
                <th>ผ่าน</th>
                <th>ไม่ผ่าน</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{charBuckets.total}</td>
                <td>{charBuckets.excellent}</td>
                <td>{charBuckets.good}</td>
                <td>{charBuckets.pass}</td>
                <td>{charBuckets.fail || "—"}</td>
              </tr>
            </tbody>
          </table>

          <table className="pp5-table pp5-class-eval">
            <thead>
              <tr>
                <th colSpan={5} className="pp5-class-eval-title">
                  สรุปผลการประเมินอ่าน คิด วิเคราะห์ เขียน
                </th>
              </tr>
              <tr>
                <th>จำนวนนักเรียนทั้งหมด</th>
                <th>ดีเยี่ยม</th>
                <th>ดี</th>
                <th>ผ่าน</th>
                <th>ไม่ผ่าน</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{rtBuckets.total}</td>
                <td>{rtBuckets.excellent}</td>
                <td>{rtBuckets.good}</td>
                <td>{rtBuckets.pass}</td>
                <td>{rtBuckets.fail || "—"}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="pp5-class-evals-col">
          <table className="pp5-table pp5-class-eval">
            <thead>
              <tr>
                <th colSpan={5} className="pp5-class-eval-title">
                  สรุปผลการประเมินสมรรถนะสำคัญของผู้เรียน
                </th>
              </tr>
              <tr>
                <th>จำนวนนักเรียนทั้งหมด</th>
                <th>ดีเยี่ยม</th>
                <th>ดี</th>
                <th>ผ่าน</th>
                <th>ไม่ผ่าน</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{compBuckets.total}</td>
                <td>{compBuckets.excellent}</td>
                <td>{compBuckets.good}</td>
                <td>{compBuckets.pass}</td>
                <td>{compBuckets.fail || "—"}</td>
              </tr>
            </tbody>
          </table>

          <table className="pp5-table pp5-class-eval">
            <thead>
              <tr>
                <th colSpan={3} className="pp5-class-eval-title">
                  สรุปผลการประเมินกิจกรรมพัฒนาผู้เรียน
                </th>
              </tr>
              <tr>
                <th>จำนวนนักเรียนทั้งหมด</th>
                <th>ผ่าน</th>
                <th>ไม่ผ่าน</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{studentCount}</td>
                <td>{activityPassCount || "—"}</td>
                <td>{activityFailCount || "—"}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Approval signature block — layout per user's image 2026-05-20:
            Section 1 = "การอนุมัติผลการเรียน" — N sigs in a row:
              ครูประจำชั้น1 [+ ครูประจำชั้น2 ถ้ามี] + หัวหน้าวิชาการ
              (grid-template-columns adapts to the cell count so the layout
               stays balanced whether there's 1 or 2 homerooms)
            Section 2 = "เสนอเพื่อพิจารณา" — 2 columns:
              LEFT  = รองผู้อำนวยการ signature
              RIGHT = ☐ อนุมัติ / ☐ ไม่อนุมัติ checkboxes
              followed (with vertical gap) by director signature. */}
      {(() => {
        const approveCells: Array<{ name: string; role: string }> = [];
        // homeroom slot(s) — 1 or 2 depending on actual assignments
        const homeroomsForRow =
          homeroomNames.length > 0 ? homeroomNames.slice(0, 2) : ["—"];
        for (const name of homeroomsForRow) {
          approveCells.push({ name, role: "ครูประจำชั้น" });
        }
        // ปพ.5 แบบรวมชั้นให้หัวหน้าวิชาการเป็นผู้ลงนามในส่วนอนุมัติผลการเรียน
        approveCells.push({
          name: school?.academic_head_name?.trim() || "—",
          role: "หัวหน้าวิชาการ",
        });
        return (
          <div className="pp5-class-approval">
            <p className="pp5-class-approval-section">การอนุมัติผลการเรียน</p>
            <div
              className="pp5-class-approve-row"
              style={{
                gridTemplateColumns: `repeat(${approveCells.length}, 1fr)`,
              }}
            >
              {approveCells.map((cell, i) => (
                <div key={i} className="pp5-class-sig-cell">
                  <p>ลงชื่อ ....................................</p>
                  <p className="pp5-class-sig-name">( {cell.name} )</p>
                  <p className="pp5-class-sig-role">{cell.role}</p>
                </div>
              ))}
            </div>

            <p className="pp5-class-approval-section">เสนอเพื่อพิจารณา</p>
            <div className="pp5-class-propose-row">
              <div className="pp5-class-sig-cell">
                <p>ลงชื่อ ....................................</p>
                <p className="pp5-class-sig-name">
                  ( {school?.deputy_director_name ?? "—"} )
                </p>
                <p className="pp5-class-sig-role">รองผู้อำนวยการโรงเรียน</p>
              </div>
              <div className="pp5-class-decision-cell">
                <p className="pp5-class-decision-line">
                  <span>☐ อนุมัติ</span>
                  <span>☐ ไม่อนุมัติ</span>
                </p>
                <div className="pp5-class-sig-cell pp5-class-sig-director">
                  <p>ลงชื่อ ....................................</p>
                  <p className="pp5-class-sig-name">
                    ( {school?.director_name ?? "—"} )
                  </p>
                  <p className="pp5-class-sig-role">
                    {school?.director_title ?? "ผู้อำนวยการ"}
                    {withSchoolPrefix(school?.name_th)}
                  </p>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </section>
  );
}

// ===================================================================
// Selector — shown when ?classroom is missing.
// Renders the split-pane Pp5ClassSelectorForm (client component) so the
// admin gets a live preview iframe + section toggles + zoom, matching
// the per-subject form's UX (user spec 2026-05-19).
// ===================================================================

async function Pp5ClassSelector() {
  const supabase = await createClient();

  // Filter to ONLY the current academic year — otherwise the dropdown
  // shows duplicate rooms (one row per year-room combo in `classrooms`,
  // so a school with 2 years gets ป.1/1 listed twice). User report
  // 2026-05-20: "ห้อง ป.1/1 ถึงมี 2 อัน".
  const { data: currentYear } = await supabase
    .from("academic_years")
    .select("id")
    .eq("is_current", true)
    .maybeSingle();

  if (!currentYear) {
    return <Pp5ClassSelectorForm classrooms={[]} />;
  }

  // Teacher scope — limit to homeroom classrooms only. ปพ.5 รวมชั้น
  // is a whole-class bundle (every subject + every student), so a
  // teacher should only print it for rooms they're directly responsible
  // for. Subject teachers print ปพ.5 รายวิชา instead.
  const scope = await getTeacherScope();

  const { data: classroomsRaw } = await supabase
    .from("classrooms")
    .select(
      `
      id,
      room_number,
      grade_level:grade_levels!grade_level_id (id, name_th, name_short, sort_order)
    `,
    )
    .eq("academic_year_id", currentYear.id)
    .order("created_at");
  const classrooms = scope
    ? (classroomsRaw ?? []).filter((c) =>
        scope.homeroomClassroomIds.has(c.id),
      )
    : classroomsRaw;
  const raw = (classrooms ?? []).filter((c) => c.grade_level);
  raw.sort((a, b) => {
    const ga = a.grade_level!.sort_order ?? 0;
    const gb = b.grade_level!.sort_order ?? 0;
    if (ga !== gb) return ga - gb;
    return a.room_number - b.room_number;
  });

  // Multi-room detection per grade → label rooms with /N suffix when there
  // are 2+ rooms in the same grade. Single-room grades show the short name
  // alone (e.g. "ป.2" not "ป.2/1") — matches the pattern used in
  // /setup/homerooms.
  const roomCountByGrade = new Map<string, number>();
  for (const c of raw) {
    const k = c.grade_level!.id;
    roomCountByGrade.set(k, (roomCountByGrade.get(k) ?? 0) + 1);
  }

  const opts: ClassroomOption[] = raw.map((c) => {
    const multiRoom = (roomCountByGrade.get(c.grade_level!.id) ?? 0) > 1;
    const short = c.grade_level!.name_short ?? c.grade_level!.name_th;
    return {
      id: c.id,
      label: multiRoom ? `${short}/${c.room_number}` : short,
      grade_id: c.grade_level!.id,
      grade_label: short,
      grade_sort: c.grade_level!.sort_order ?? 0,
    };
  });

  return <Pp5ClassSelectorForm classrooms={opts} />;
}

function notFoundPage(message: string) {
  return (
    <main className="mx-auto max-w-3xl p-8 text-sm text-zinc-700">
      <p>⚠️ {message}</p>
      <p className="mt-2">
        <Link href="/reports/pp5-class" className="font-medium underline">
          กลับไปหน้าเลือกห้อง
        </Link>
      </p>
    </main>
  );
}

// Avoid unused-import warning while feature is in progress.
void cutGrade;
