import { createClient } from "@pp5/database/server";
import { notFound } from "next/navigation";
import {
  abbreviateTitle,
  averageTwoSemesters,
  cutGrade,
  evalLevelLabel,
  overallEvalLevel,
} from "../../setup/score-structure/grading-utils";
import { type HeaderInfo, Pp5Frame } from "../_shared/score-report";
import type { Metadata } from "next";
import {
  currentTermSuffix,
  reportClassroomLabel,
  reportRoomSuffix,
} from "@/lib/current-term";
import { getTeacherScope } from "@/lib/teacher-scope";
import {
  type ClassroomOption,
  Pp6SelectorForm,
  type StudentOption,
} from "./pp6-selector-form";

// ===================================================================
// /reports/pp6 — ปพ.6 (แบบรายงานผลการพัฒนาคุณภาพผู้เรียนรายบุคคล)
//
// Per-STUDENT academic record. One A4 portrait page per student listing
// every numeric subject (รหัส · ชื่อ · ประเภท · น้ำหนัก · คะแนนรวม · ระดับ
// ผลการเรียน), the activity subjects (ผ่าน/ไม่ผ่าน), and a summary block
// (หน่วยกิต/น้ำหนัก ได้, คุณลักษณะ, อ่าน-คิด-เขียน, กิจกรรม, GPA + อันดับ).
//
// THIS PHASE: route + data fetch + per-student page component only. No
// selector UI and no sidebar menu entry (those come in later phases). The
// page accepts fixed query params and renders.
//
// Data approach (mirrors /reports/pp5-class fetch but pivoted per-student):
//   - one fetch for the whole class (school / classroom / homerooms /
//     enrollments / study-plan subjects / scores / activity grades / evals)
//   - per numeric subject × per student: total = Σ category scores, grade =
//     cutGrade(total). Annual (primary) averages sem1+sem2 totals first.
//   - GPA per student = Σ(grade × weight) / Σ(weight) over numeric subjects.
//   - rank = dense rank of GPA across the whole class (1 = highest, ties
//     share a rank).
// ===================================================================

export async function generateMetadata({
  searchParams,
}: Props): Promise<Metadata> {
  const p = await searchParams;
  if (p.embed !== "1") return {};
  const [suffix, room] = await Promise.all([
    currentTermSuffix(),
    reportClassroomLabel(p.classroom),
  ]);
  return { title: ["ปพ.6", room, suffix].filter(Boolean).join(" ") };
}

type Props = {
  searchParams: Promise<{
    classroom?: string;
    /** "1" | "2" | "annual" — score scope. Secondary ignores "annual" and
     *  always uses the school's current semester. */
    semester?: string;
    /** A single student's id — when present, render ONLY that student. */
    student?: string;
    /** "all" | "individual". `student` presence is what actually decides
     *  single vs. all; this is passed through for URL clarity. */
    scope?: string;
    /** Show GPA rank when "1" (default); never change student-number order. */
    rank?: string;
    /** "1" → rendered inside the selector's preview iframe. Otherwise the
     *  page renders the <Pp6SelectorForm> instead of the report. */
    embed?: string;
  }>;
};

type ScopeParam = "1" | "2" | "annual";

/** สพฐ summary bucket label from an evaluation average (0–3 scale). */
function summaryFromAvg(avg: number | null): string {
  if (avg == null) return "—";
  if (avg >= 2.5) return "ดีเยี่ยม";
  if (avg >= 1.5) return "ดี";
  if (avg >= 0.5) return "ผ่าน";
  return "ไม่ผ่าน";
}

/** Format a weight (หน่วยกิต/น้ำหนัก) — drop trailing ".0" for whole numbers. */
function fmtWeight(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** Integer grade levels have no decimal; retain genuine half grades. */
function fmtGradeLevel(g: number): string {
  return Number.isInteger(g) ? String(g) : g.toFixed(1);
}

type NumericSubject = {
  id: string;
  code: string;
  name_th: string;
  category: "core" | "additional" | "activity";
  /** GPA weight — primary = hours_per_year/40, secondary = credit_hours. */
  weight: number;
  /** น้ำหนัก COLUMN value — primary = raw hours_per_year, secondary =
   *  credit_hours. Display only; never used in GPA math. */
  displayWeight: number;
  /** Raw hours_per_year (primary), used for the time-based summary sums. */
  hoursPerYear: number;
  /** offering ids for THIS subject in this classroom (sem1/sem2 for primary). */
  offeringIds: { sem1: string | null; sem2: string | null };
};

type ActivitySubject = {
  id: string;
  code: string;
  name_th: string;
  hours: number;
  offeringIds: string[];
};

/** Per-student per-subject computed numeric result. */
type StudentSubjectResult = {
  total: number;
  grade: number;
};

export default async function Pp6Page({ searchParams }: Props) {
  const params = await searchParams;
  const classroomId = params.classroom?.trim();
  const isEmbed = params.embed === "1";
  // scope=all forces the whole-class render even if a stray `student` id is
  // present; otherwise the `student` param narrows to one page.
  const scopeMode = params.scope?.trim() === "all" ? "all" : "individual";
  const onlyStudentId =
    scopeMode === "all" ? null : params.student?.trim() || null;
  // แสดงอันดับ — default ON. Only "0" turns it off.
  // Toggle the rank suffix only, never the printing order.
  const showRank = params.rank?.trim() !== "0";

  const scopeRaw = params.semester?.trim();
  const scope: ScopeParam =
    scopeRaw === "2" ? "2" : scopeRaw === "annual" ? "annual" : "1";

  // Not the print iframe → show the selector UI instead of the report.
  // (Render the report only when embed=1, matching pp5-class.)
  if (!isEmbed) {
    return <Pp6Selector />;
  }

  if (!classroomId) {
    notFound();
  }

  const supabase = await createClient();

  // 1. School (single-tenant).
  const { data: school } = await supabase
    .from("schools")
    .select(
      "name_th, affiliation, district, province, logo_url, director_name, director_title, deputy_director_name, academic_head_name, assessment_officer_name",
    )
    .limit(1)
    .maybeSingle();

  // 2. Classroom + grade + academic year + study plan.
  const { data: classroom } = await supabase
    .from("classrooms")
    .select(
      `
      id,
      room_number,
      study_plan_id,
      grade_level:grade_levels!grade_level_id (id, name_short, name_th, system),
      academic_year:academic_years!academic_year_id (id, year_be, current_semester)
    `,
    )
    .eq("id", classroomId)
    .maybeSingle();

  if (!classroom?.grade_level || !classroom.academic_year) {
    notFound();
  }

  const isPrimary = classroom.grade_level.system === "primary";
  const yearId = classroom.academic_year.id;
  const yearBe = classroom.academic_year.year_be;
  const currentSemester: 1 | 2 = (classroom.academic_year.current_semester ??
    1) as 1 | 2;
  const gradeName = classroom.grade_level.name_th;
  const classLabel = `ชั้น${classroom.grade_level.name_th}${await reportRoomSuffix(classroomId)}`;

  // Effective semester for SECONDARY single-semester math (annual is
  // primary-only — secondary always renders its current semester).
  const secondarySemester = currentSemester;

  // 3. Enrollments — primary uses semester=0 (annual), secondary uses
  //    the current term. One page per enrolled student (unless `student`
  //    narrows to one).
  const enrollmentSemester: 0 | 1 | 2 = isPrimary ? 0 : secondarySemester;
  // Honor the student numbering configured by the school in both rank modes.
  const { data: enrolls } = await supabase
    .from("enrollments")
    .select(
      `
      student_number,
      student:students!student_id (id, student_code, title, first_name, last_name)
    `,
    )
    .eq("classroom_id", classroomId)
    .eq("semester", enrollmentSemester)
    .order("student_number");

  const allStudents = (enrolls ?? [])
    .filter((e) => e.student)
    .map((e) => ({
      id: e.student!.id,
      student_number: e.student_number,
      student_code: e.student!.student_code,
      // ปพ.6 prints the FULL (non-abbreviated) title per the meta line spec
      // "ชื่อ-นามสกุล {title+first+last}".
      title: e.student!.title ?? "",
      first_name: e.student!.first_name,
      last_name: e.student!.last_name,
      full_name: `${e.student!.title ?? ""}${e.student!.first_name} ${e.student!.last_name}`,
    }));
  const studentIds = allStudents.map((s) => s.id);

  // 4. Homeroom teachers (both slots — equal status).
  const { data: homerooms } = await supabase
    .from("homeroom_assignments")
    .select(
      `role, teacher:teachers!teacher_id ( user:users!user_id (full_name, title) )`,
    )
    .eq("classroom_id", classroomId)
    .order("role");
  const homeroomNames = (homerooms ?? [])
    .filter((h) => h.teacher?.user)
    // Prefix "ครู" — shorter than นาย/นาง, so the name stays on one line in
    // the tight signature cell even with 2 teachers.
    .map((h) => `ครู${h.teacher!.user!.full_name}`);
  const homeroomLabel =
    homeroomNames.length > 0 ? homeroomNames.join(" · ") : null;

  // 5. Study-plan subjects + offerings (in parallel). Subjects carry the
  //    fields needed for weight (credit_hours / hours_per_year), category
  //    (พื้นฐาน/เพิ่มเติม), grading_mode (numeric vs activity), and
  //    learning_area sort (for the table order).
  const [planSubjectsResult, offeringsResult] = await Promise.all([
    classroom.study_plan_id
      ? supabase
          .from("study_plan_subjects")
          .select(
            `
            subject:subjects!subject_id (
              id, code, name_th, category, grading_mode, credit_hours,
              hours_per_year, semester, academic_year_id,
              learning_area:learning_areas!learning_area_id (sort_order)
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

  // De-dupe subjects (study_plan may list a subject once per semester for
  // primary). Drop subjects from another academic year, and for secondary
  // drop subjects not in the current semester.
  type RawSubject = {
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
  };
  const subjectMap = new Map<string, RawSubject>();
  for (const ps of planSubjectsResult.data ?? []) {
    // FK is one-to-one → Supabase resolves `subject` as a single object.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = (ps as any).subject as RawSubject | null;
    if (!s) continue;
    if (s.academic_year_id !== yearId) continue;
    if (!isPrimary && s.semester !== secondarySemester) continue;
    if (subjectMap.has(s.id)) continue;
    subjectMap.set(s.id, s);
  }

  // Offerings grouped by subject_id → { sem1, sem2 } (primary) or a flat
  // list (activity / secondary).
  const offeringsBySubject = new Map<
    string,
    { sem1: string | null; sem2: string | null; all: string[] }
  >();
  for (const o of offeringsResult.data ?? []) {
    if (!subjectMap.has(o.subject_id)) continue;
    let entry = offeringsBySubject.get(o.subject_id);
    if (!entry) {
      entry = { sem1: null, sem2: null, all: [] };
      offeringsBySubject.set(o.subject_id, entry);
    }
    entry.all.push(o.id);
    if (o.semester === 1) entry.sem1 = o.id;
    else if (o.semester === 2) entry.sem2 = o.id;
  }

  // Split into numeric vs. activity, computing each subject's weight up
  // front. Weight (per spec):
  //   primary  = (hours_per_year ?? 0) / 40   (fallback 1 if zero/null)
  //   secondary= credit_hours ?? 1            (fallback 1 if zero/null)
  const weightOf = (s: RawSubject): number => {
    const raw = isPrimary ? (s.hours_per_year ?? 0) / 40 : (s.credit_hours ?? 1);
    return raw > 0 ? raw : 1;
  };

  const numericSubjects: NumericSubject[] = [];
  const activitySubjects: ActivitySubject[] = [];
  for (const s of subjectMap.values()) {
    const off = offeringsBySubject.get(s.id) ?? {
      sem1: null,
      sem2: null,
      all: [],
    };
    if (s.grading_mode === "pass_fail") {
      activitySubjects.push({
        id: s.id,
        code: s.code,
        name_th: s.name_th,
        // กิจกรรม hours come from hours_per_year per spec.
        hours: s.hours_per_year ?? 0,
        offeringIds: off.all,
      });
    } else {
      numericSubjects.push({
        id: s.id,
        code: s.code,
        name_th: s.name_th,
        category: s.category,
        weight: weightOf(s),
        // Displayed น้ำหนัก: primary shows raw ชั่วโมง/ปี (e.g. 200/160),
        // secondary shows credit_hours. GPA still uses `weight` above.
        displayWeight: isPrimary
          ? (s.hours_per_year ?? 0)
          : (s.credit_hours ?? 0),
        hoursPerYear: s.hours_per_year ?? 0,
        offeringIds: { sem1: off.sem1, sem2: off.sem2 },
      });
    }
  }

  // Sort numeric subjects: category first (พื้นฐาน/core before เพิ่มเติม/
  // additional), THEN learning_area sort, THEN code. Keep the raw subject's
  // learning_area sort in a side map for the comparator.
  const laSortById = new Map<string, number>();
  for (const s of subjectMap.values()) {
    laSortById.set(s.id, s.learning_area?.sort_order ?? 999);
  }
  // core (พื้นฐาน) ranks before additional (เพิ่มเติม).
  const categoryRank = (c: NumericSubject["category"]): number =>
    c === "additional" ? 2 : 1;
  numericSubjects.sort((a, b) => {
    const cat = categoryRank(a.category) - categoryRank(b.category);
    if (cat !== 0) return cat;
    const la = (laSortById.get(a.id) ?? 999) - (laSortById.get(b.id) ?? 999);
    if (la !== 0) return la;
    return a.code.localeCompare(b.code);
  });
  // Activities — order by code for a stable layout.
  activitySubjects.sort((a, b) => a.code.localeCompare(b.code));

  // 6. Scores for all numeric offerings → per-offering, per-student,
  //    per-category lookup. We compute totals FRESH (Σ category scores)
  //    rather than reading the `grades` table.
  const numericOfferingIds = numericSubjects.flatMap((s) =>
    [s.offeringIds.sem1, s.offeringIds.sem2].filter(
      (x): x is string => x != null,
    ),
  );

  // category_id → offering_id (so a flat scores fetch can be bucketed by
  // offering). Categories are needed only to know which offering a score
  // belongs to — the actual sum is over ALL of an offering's categories.
  const { data: categoryRows } =
    numericOfferingIds.length > 0
      ? await supabase
          .from("score_categories")
          .select("id, offering_id")
          .in("offering_id", numericOfferingIds)
      : { data: [] as Array<{ id: string; offering_id: string }> };
  const categoryToOffering = new Map<string, string>();
  for (const c of categoryRows ?? []) {
    categoryToOffering.set(c.id, c.offering_id);
  }
  const allCategoryIds = (categoryRows ?? []).map((c) => c.id);

  // Paginated scores fetch (30 students × ~11 categories × N offerings can
  // exceed PostgREST's 1000-row cap — see pattern_supabase_pagination).
  type ScoreRow = {
    student_id: string;
    category_id: string;
    score: number | null;
  };
  const scoreRows: ScoreRow[] = [];
  if (allCategoryIds.length > 0 && studentIds.length > 0) {
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
      scoreRows.push(...(page as ScoreRow[]));
      if (page.length < PAGE) break;
      from += PAGE;
    }
  }

  // offering_id → student_id → Σ scores. Missing scores count as 0 (same
  // convention as the score grid).
  const totalByOfferingStudent = new Map<string, Map<string, number>>();
  for (const r of scoreRows) {
    const oid = categoryToOffering.get(r.category_id);
    if (!oid || r.score == null) continue;
    let inner = totalByOfferingStudent.get(oid);
    if (!inner) {
      inner = new Map();
      totalByOfferingStudent.set(oid, inner);
    }
    inner.set(r.student_id, (inner.get(r.student_id) ?? 0) + Number(r.score));
  }
  const offeringTotal = (oid: string | null, sid: string): number =>
    oid ? (totalByOfferingStudent.get(oid)?.get(sid) ?? 0) : 0;

  // 7. grade_scales for cutGrade.
  const { data: scalesData } = await supabase
    .from("grade_scales")
    .select("min_score, max_score, grade")
    .order("sort_order");
  const scales = (scalesData ?? []).map((s) => ({
    min_score: Number(s.min_score),
    max_score: Number(s.max_score),
    grade: Number(s.grade),
  }));

  // 8. Activity pass/fail — from the `grades` table. Primary reads the
  //    annual period row; secondary reads the current-semester row.
  const activityOfferingIds = activitySubjects.flatMap((s) => s.offeringIds);
  const activityPeriod: "annual" | "semester" = isPrimary
    ? "annual"
    : "semester";
  const { data: activityGradeRows } =
    activityOfferingIds.length > 0 && studentIds.length > 0
      ? await supabase
          .from("grades")
          .select("student_id, offering_id, grading_period, pass_fail")
          .in("offering_id", activityOfferingIds)
          .in("student_id", studentIds)
      : {
          data: [] as Array<{
            student_id: string;
            offering_id: string;
            grading_period: "semester" | "annual";
            pass_fail: "pass" | "fail" | null;
          }>,
        };
  // offering_id|student_id → pass/fail (only the row matching activityPeriod).
  const passFailByKey = new Map<string, "pass" | "fail">();
  for (const g of activityGradeRows ?? []) {
    if (g.grading_period !== activityPeriod) continue;
    if (g.pass_fail === "pass" || g.pass_fail === "fail") {
      passFailByKey.set(`${g.offering_id}|${g.student_id}`, g.pass_fail);
    }
  }
  const activityResultFor = (
    s: ActivitySubject,
    sid: string,
  ): "pass" | "fail" | null => {
    let sawPass = false;
    for (const oid of s.offeringIds) {
      const r = passFailByKey.get(`${oid}|${sid}`);
      if (r === "fail") return "fail"; // any fail dominates
      if (r === "pass") sawPass = true;
    }
    return sawPass ? "pass" : null;
  };

  // 9. Evaluations — characteristic + reading-thinking → per-student avg →
  //    สพฐ summary level. Primary uses semester=0 (annual); secondary uses
  //    the current term. Mirrors /reports/student-eval's avg→summary map.
  const evalSemester: 0 | 1 | 2 = isPrimary ? 0 : secondarySemester;

  // คุณลักษณะ / อ่าน-คิด-เขียน — สรุประดับด้วย "ฐานนิยม" (มี 0 = ไม่ผ่าน)
  // เก็บเป็น level (0-3) ต่อนักเรียน ไม่ใช่ค่าเฉลี่ย
  const charLevelByStudent = new Map<string, number>();
  if (studentIds.length > 0) {
    const { data: chars } = await supabase
      .from("characteristics")
      .select("id")
      .eq("is_active", true);
    const charIds = (chars ?? []).map((c) => c.id);
    if (charIds.length > 0) {
      const { data: evals } = await supabase
        .from("characteristic_evaluations")
        .select("student_id, score")
        .eq("academic_year_id", yearId)
        .eq("semester", evalSemester)
        .in("student_id", studentIds)
        .in("characteristic_id", charIds);
      const scoresByStudent = new Map<string, number[]>();
      for (const e of evals ?? []) {
        if (e.score == null) continue;
        const arr = scoresByStudent.get(e.student_id) ?? [];
        arr.push(Number(e.score));
        scoresByStudent.set(e.student_id, arr);
      }
      for (const [sid, arr] of scoresByStudent) {
        const level = overallEvalLevel(arr);
        if (level != null) charLevelByStudent.set(sid, level);
      }
    }
  }

  const readingLevelByStudent = new Map<string, number>();
  if (studentIds.length > 0) {
    const { data: evals } = await supabase
      .from("reading_thinking_evaluations")
      .select("student_id, reading_score, thinking_score, writing_score")
      .eq("academic_year_id", yearId)
      .eq("semester", evalSemester)
      .in("student_id", studentIds);
    for (const e of evals ?? []) {
      const level = overallEvalLevel([
        e.reading_score == null ? null : Number(e.reading_score),
        e.thinking_score == null ? null : Number(e.thinking_score),
        e.writing_score == null ? null : Number(e.writing_score),
      ]);
      if (level != null) readingLevelByStudent.set(e.student_id, level);
    }
  }

  // 10. Per-student computed bundle: each numeric subject's total + grade,
  //     GPA, and the per-category breakdown for the summary block.
  //     Numeric grade per subject:
  //       primary annual → cutGrade(avg(sem1 total, sem2 total))
  //       primary "1"/"2" → cutGrade(that semester's offering total)
  //       secondary       → cutGrade(current semester's offering total)
  const subjectGradeFor = (
    subj: NumericSubject,
    sid: string,
  ): StudentSubjectResult => {
    let total: number;
    if (isPrimary) {
      if (scope === "annual") {
        const t1 = offeringTotal(subj.offeringIds.sem1, sid);
        const t2 = offeringTotal(subj.offeringIds.sem2, sid);
        total = averageTwoSemesters(t1, t2);
      } else {
        const oid =
          scope === "2" ? subj.offeringIds.sem2 : subj.offeringIds.sem1;
        total = offeringTotal(oid, sid);
      }
    } else {
      // Secondary — always the current semester's offering (only one exists
      // per subject in this scope). Fall back to sem1/sem2 whichever is set.
      const oid =
        (secondarySemester === 2
          ? subj.offeringIds.sem2
          : subj.offeringIds.sem1) ??
        subj.offeringIds.sem1 ??
        subj.offeringIds.sem2;
      total = offeringTotal(oid, sid);
    }
    return { total, grade: cutGrade(total, scales) };
  };

  type StudentComputed = {
    id: string;
    student_number: number;
    student_code: string;
    full_name: string;
    /** numeric subject id → { total, grade } */
    numeric: Map<string, StudentSubjectResult>;
    gpa: number;
    /** Σ weight of core numeric subjects with grade > 0 (หน่วยกิต — secondary) */
    coreWeight: number;
    /** Σ weight of additional numeric subjects with grade > 0 (หน่วยกิต — secondary) */
    additionalWeight: number;
    /** PRIMARY only — Σ hours_per_year of CORE numeric subjects earned (grade > 0). */
    coreHours: number;
    /** PRIMARY only — Σ hours_per_year of ADDITIONAL numeric subjects earned (grade > 0). */
    additionalHours: number;
    /** PRIMARY only — Σ hours_per_year of ACTIVITY subjects the student passed. */
    activityHours: number;
    charSummary: string;
    readingSummary: string;
    activityResult: "pass" | "fail" | null;
  };

  const computed: StudentComputed[] = allStudents.map((stu) => {
    const numeric = new Map<string, StudentSubjectResult>();
    let weightedGradeSum = 0;
    let weightSum = 0;
    let coreWeight = 0;
    let additionalWeight = 0;
    // PRIMARY time-based sums (Σ hours_per_year of subjects earned). Parallel
    // to the หน่วยกิต sums above but using the raw annual hours.
    let coreHours = 0;
    let additionalHours = 0;
    for (const subj of numericSubjects) {
      const res = subjectGradeFor(subj, stu.id);
      numeric.set(subj.id, res);
      weightedGradeSum += res.grade * subj.weight;
      weightSum += subj.weight;
      if (res.grade > 0) {
        if (subj.category === "additional") {
          additionalWeight += subj.weight;
          additionalHours += subj.hoursPerYear;
        } else {
          coreWeight += subj.weight; // core (พื้นฐาน)
          coreHours += subj.hoursPerYear;
        }
      }
    }
    const gpa = weightSum > 0 ? weightedGradeSum / weightSum : 0;

    // PRIMARY — Σ hours_per_year of ACTIVITY subjects this student passed.
    let activityHours = 0;
    for (const act of activitySubjects) {
      if (activityResultFor(act, stu.id) === "pass") activityHours += act.hours;
    }

    // Overall activity result: ผ่าน only if EVERY activity passed; ไม่ผ่าน if
    // any failed; null if the class has activities but this student has no
    // recorded result, or no activities at all.
    let activityResult: "pass" | "fail" | null = null;
    if (activitySubjects.length > 0) {
      let sawAny = false;
      let allPass = true;
      for (const act of activitySubjects) {
        const r = activityResultFor(act, stu.id);
        if (r == null) continue;
        sawAny = true;
        if (r === "fail") allPass = false;
      }
      activityResult = !sawAny ? null : allPass ? "pass" : "fail";
    }

    return {
      id: stu.id,
      student_number: stu.student_number,
      student_code: stu.student_code,
      full_name: stu.full_name,
      numeric,
      gpa,
      coreWeight,
      additionalWeight,
      coreHours,
      additionalHours,
      activityHours,
      charSummary: evalLevelLabel(charLevelByStudent.get(stu.id) ?? null),
      readingSummary: evalLevelLabel(readingLevelByStudent.get(stu.id) ?? null),
      activityResult,
    };
  });

  // 11. Rank — dense rank over GPA across the WHOLE class (1 = highest;
  //     ties share a rank). Computed even when rendering a single student.
  const gpaDesc = computed
    .map((c) => c.gpa)
    .sort((a, b) => b - a);
  const rankOf = (gpa: number): number => {
    // 1-based index of the first entry equal to this gpa (with a small
    // epsilon for float wobble). Ties share the rank.
    const EPS = 1e-9;
    for (let i = 0; i < gpaDesc.length; i++) {
      if (Math.abs(gpaDesc[i] - gpa) < EPS || gpaDesc[i] <= gpa + EPS) {
        return i + 1;
      }
    }
    return gpaDesc.length;
  };

  // 12. Select students without changing their configured numbering order.
  const base = onlyStudentId
    ? computed.filter((c) => c.id === onlyStudentId)
    : computed;
  if (onlyStudentId && base.length === 0) {
    notFound();
  }
  // Rank is informational only; retain the school's student-number order.
  const rendered = base;

  // HeaderInfo — Pp5Frame only reads `embed`, but the type requires a full
  // object. Populate the fields ปพ.6 actually uses; empties for the rest.
  const headerInfo: HeaderInfo = {
    schoolName: school?.name_th ?? "—",
    affiliation: school?.affiliation ?? "—",
    district: school?.district ?? null,
    province: school?.province ?? null,
    logoUrl: school?.logo_url ?? null,
    directorName: school?.director_name ?? "—",
    directorTitle: school?.director_title ?? "ผู้อำนวยการ",
    deputyDirectorName: school?.deputy_director_name ?? null,
    academicHeadName: school?.academic_head_name ?? null,
    assessmentOfficerName: school?.assessment_officer_name ?? null,
    classLabel,
    gradeShort: classroom.grade_level.name_short,
    isPrimaryLevel: isPrimary,
    isSecondaryLevel: !isPrimary,
    yearBe,
    semester: scope === "2" ? 2 : 1,
    subjectCode: "",
    subjectName: "",
    subjectCategory: "core",
    learningAreaName: null,
    creditHours: null,
    hoursPerWeek: 0,
    totalHoursPerSemester: 0,
    teacherLabel: "—",
    homeroomLabel,
  };

  const directorName = school?.director_name ?? "—";
  const directorTitle = school?.director_title ?? "ผู้อำนวยการ";

  return (
    <Pp5Frame info={headerInfo} embed={isEmbed}>
      {rendered.map((stu) => (
        <Pp6StudentPage
          key={stu.id}
          student={stu}
          isPrimary={isPrimary}
          rank={rankOf(stu.gpa)}
          showRank={showRank}
          numericSubjects={numericSubjects}
          activitySubjects={activitySubjects}
          activityResultFor={(act) => activityResultFor(act, stu.id)}
          schoolName={school?.name_th ?? "—"}
          district={school?.district ?? null}
          province={school?.province ?? null}
          affiliation={school?.affiliation ?? "—"}
          logoUrl={school?.logo_url ?? null}
          yearBe={yearBe}
          gradeName={gradeName}
          homeroomNames={homeroomNames}
          directorName={directorName}
          directorTitle={directorTitle}
          deputyDirectorName={school?.deputy_director_name?.trim() || null}
        />
      ))}
    </Pp5Frame>
  );
}

// ===================================================================
// Pp6StudentPage — one A4 portrait page for a single student.
// Self-contained: takes the pre-computed per-student data and renders the
// ปพ.6 layout (header · meta line · subjects table · activities table ·
// summary).
//
// Each page is its own `.pp5-page-content` block. In print, globals.css
// rule `.pp5-page-content + .pp5-page-content { break-before: page }`
// forces every student after the first onto a fresh page.
// ===================================================================

function Pp6StudentPage({
  student,
  isPrimary,
  rank,
  showRank,
  numericSubjects,
  activitySubjects,
  activityResultFor,
  schoolName,
  district,
  province,
  affiliation,
  logoUrl,
  yearBe,
  gradeName,
  homeroomNames,
  directorName,
  directorTitle,
  deputyDirectorName,
}: {
  student: {
    id: string;
    student_code: string;
    full_name: string;
    numeric: Map<string, { total: number; grade: number }>;
    gpa: number;
    coreWeight: number;
    additionalWeight: number;
    coreHours: number;
    additionalHours: number;
    activityHours: number;
    charSummary: string;
    readingSummary: string;
    activityResult: "pass" | "fail" | null;
  };
  isPrimary: boolean;
  rank: number;
  /** When false (rank=0), omit the "ได้อันดับที่ N ของห้อง" GPA suffix. */
  showRank: boolean;
  numericSubjects: NumericSubject[];
  activitySubjects: ActivitySubject[];
  activityResultFor: (act: ActivitySubject) => "pass" | "fail" | null;
  schoolName: string;
  district: string | null;
  province: string | null;
  affiliation: string;
  logoUrl: string | null;
  yearBe: number;
  gradeName: string;
  homeroomNames: string[];
  directorName: string;
  directorTitle: string;
  deputyDirectorName: string | null;
}) {
  const totalWeight = student.coreWeight + student.additionalWeight;
  // PRIMARY total INCLUDES activity hours (core + additional + activity);
  // SECONDARY total is credit-weight only (no activity row).
  const totalHours =
    student.coreHours + student.additionalHours + student.activityHours;
  const activityOverall =
    student.activityResult === "pass"
      ? "ผ่าน"
      : student.activityResult === "fail"
        ? "ไม่ผ่าน"
        : "—";

  const homeroomJoined =
    homeroomNames.length > 0 ? homeroomNames.join(" / ") : "—";

  // สรุปผลการประเมิน rows — PRIMARY uses time-based wording + ชั่วโมง values
  // (Σ hours_per_year of subjects earned); SECONDARY keeps the หน่วยกิต
  // wording + credit-weight values. The activity-hours row is PRIMARY-only.
  const coreLabel = isPrimary
    ? "เวลาเรียนวิชาพื้นฐานที่ได้"
    : "จำนวนหน่วยกิตวิชาพื้นฐานที่ได้";
  const additionalLabel = isPrimary
    ? "เวลาเรียนวิชาเพิ่มเติมที่ได้"
    : "จำนวนหน่วยกิตวิชาเพิ่มเติมที่ได้";
  const totalLabel = isPrimary ? "รวมเวลาเรียนที่ได้" : "รวมจำนวนหน่วยกิตที่ได้";
  const coreValue = fmtWeight(isPrimary ? student.coreHours : student.coreWeight);
  const additionalValue = fmtWeight(
    isPrimary ? student.additionalHours : student.additionalWeight,
  );
  const totalValue = fmtWeight(isPrimary ? totalHours : totalWeight);

  return (
    <section className="pp5-page-content pp6-page">
      {/* 1. Header — centred title with "ปพ.6" pinned top-right. */}
      <header className="pp6-header">
        <span className="pp6-doc-tag">ปพ.6</span>
        {logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt="โลโก้โรงเรียน" className="pp6-logo" />
        )}
        <h1 className="pp6-title">
          แบบรายงานผลการพัฒนาคุณภาพผู้เรียนรายบุคคล ปีการศึกษา {yearBe}
        </h1>
        <p className="pp6-subtitle">
          {schoolName.startsWith("โรงเรียน") ? schoolName : `โรงเรียน${schoolName}`}
          {district ? `  อำเภอ${district}` : ""}
          {province ? `  จังหวัด${province}` : ""}
        </p>
        <p className="pp6-affiliation">{affiliation}</p>
      </header>

      {/* 2. Meta line. */}
      <p className="pp6-meta">
        <span>เลขประจำตัวนักเรียน {student.student_code}</span>
        <span>ชื่อ-นามสกุล {student.full_name}</span>
        <span>ระดับชั้น {gradeName}</span>
      </p>

      {/* 3. Subjects table (numeric only). Reuses `.pp5-table` for borders +
          header styling; `.pp6-table` only tunes padding/font for the
          denser single-student layout. */}
      <table className="pp5-table pp6-table pp6-subjects">
        <colgroup>
          <col style={{ width: "8%" }} />
          <col style={{ width: "14%" }} />
          <col style={{ width: "38%" }} />
          <col style={{ width: "12%" }} />
          <col style={{ width: "10%" }} />
          <col style={{ width: "10%" }} />
          <col style={{ width: "12%" }} />
        </colgroup>
        <thead>
          <tr>
            <th>ลำดับ</th>
            <th>รหัสวิชา</th>
            <th>ชื่อวิชา</th>
            <th>ประเภท</th>
            <th>
              {isPrimary ? (
                <>
                  เวลาเรียน
                  <br />
                  (ชั่วโมง)
                </>
              ) : (
                <>
                  น้ำหนัก
                  <br />
                  (หน่วยกิต)
                </>
              )}
            </th>
            <th>คะแนนรวม</th>
            <th>ระดับผลการเรียน</th>
          </tr>
        </thead>
        <tbody>
          {/* Always show at least 15 numbered rows so every ปพ.6 page has the
              same height; pad blank rows when a class has < 15 subjects, and
              show all of them when it has more. */}
          {Array.from(
            { length: Math.max(15, numericSubjects.length) },
            (_, i) => {
              const subj = numericSubjects[i];
              if (!subj) {
                return (
                  <tr key={`np-${i}`}>
                    <td>{i + 1}</td>
                    <td></td>
                    <td className="pp6-cell-name"></td>
                    <td></td>
                    <td></td>
                    <td></td>
                    <td></td>
                  </tr>
                );
              }
              const res = student.numeric.get(subj.id) ?? {
                total: 0,
                grade: 0,
              };
              return (
                <tr key={subj.id}>
                  <td>{i + 1}</td>
                  <td>{subj.code}</td>
                  <td className="pp6-cell-name">{subj.name_th}</td>
                  <td>
                    {subj.category === "additional" ? "เพิ่มเติม" : "พื้นฐาน"}
                  </td>
                  <td>{fmtWeight(subj.displayWeight)}</td>
                  <td>{fmtScoreInt(res.total)}</td>
                  <td>{fmtGradeLevel(res.grade)}</td>
                </tr>
              );
            },
          )}
        </tbody>
      </table>

      {/* 4. Activities table (กิจกรรมพัฒนาผู้เรียน). */}
      <h2 className="pp6-section-title">กิจกรรมพัฒนาผู้เรียน</h2>
      <table className="pp5-table pp6-table pp6-activities">
        <colgroup>
          <col style={{ width: "8%" }} />
          <col style={{ width: "16%" }} />
          <col style={{ width: "46%" }} />
          <col style={{ width: "14%" }} />
          <col style={{ width: "16%" }} />
        </colgroup>
        <thead>
          <tr>
            <th>ลำดับ</th>
            <th>รหัส</th>
            <th>ชื่อกิจกรรม</th>
            <th>จำนวนชั่วโมง</th>
            <th>ผลการประเมิน</th>
          </tr>
        </thead>
        <tbody>
          {/* Pad to at least 4 numbered rows for a consistent layout; show
              all when a class has more than 4 activities. */}
          {Array.from(
            { length: Math.max(4, activitySubjects.length) },
            (_, i) => {
              const act = activitySubjects[i];
              if (!act) {
                return (
                  <tr key={`ap-${i}`}>
                    <td>{i + 1}</td>
                    <td></td>
                    <td className="pp6-cell-name"></td>
                    <td></td>
                    <td></td>
                  </tr>
                );
              }
              const r = activityResultFor(act);
              return (
                <tr key={act.id}>
                  <td>{i + 1}</td>
                  <td>{act.code}</td>
                  <td className="pp6-cell-name">{act.name_th}</td>
                  <td>{act.hours > 0 ? act.hours : ""}</td>
                  <td>
                    {r === "pass" ? "ผ่าน" : r === "fail" ? "ไม่ผ่าน" : "—"}
                  </td>
                </tr>
              );
            },
          )}
        </tbody>
      </table>

      {/* 5. Summary block — left = สรุปผลการประเมิน table, right = signatures. */}
      <div className="pp6-summary">
        <div className="pp6-summary-left">
          <h2 className="pp6-section-title">สรุปผลการประเมิน</h2>
          <table className="pp6-summary-table">
            <tbody>
              <tr>
                <td>{coreLabel}</td>
                <td className="pp6-summary-val">{coreValue}</td>
              </tr>
              <tr>
                <td>{additionalLabel}</td>
                <td className="pp6-summary-val">{additionalValue}</td>
              </tr>
              {/* PRIMARY activity-hours row comes BEFORE the total row, and
                  the total (totalValue) already folds these hours in. */}
              {isPrimary && (
                <tr>
                  <td>เวลาเรียนวิชากิจกรรมพัฒนาผู้เรียนที่ได้</td>
                  <td className="pp6-summary-val">
                    {fmtWeight(student.activityHours)}
                  </td>
                </tr>
              )}
              <tr>
                <td>{totalLabel}</td>
                <td className="pp6-summary-val">{totalValue}</td>
              </tr>
              <tr>
                <td>คุณลักษณะอันพึงประสงค์</td>
                <td className="pp6-summary-val">{student.charSummary}</td>
              </tr>
              <tr>
                <td>การอ่าน คิด วิเคราะห์และเขียน</td>
                <td className="pp6-summary-val">{student.readingSummary}</td>
              </tr>
              <tr>
                <td>กิจกรรมพัฒนาผู้เรียน</td>
                <td className="pp6-summary-val">{activityOverall}</td>
              </tr>
              <tr>
                <td colSpan={2} className="pp6-summary-gpa">
                  ผลการเรียนเฉลี่ย (GPA) {student.gpa.toFixed(2)}
                  {showRank ? ` ได้อันดับที่ ${rank} ของห้อง` : ""}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className={`pp6-summary-right${deputyDirectorName ? " pp6-summary-right--with-deputy" : ""}`}>
          <div className="pp6-sig-block">
            <p className="pp6-sig-line">
              {homeroomNames.length > 1
                ? "................................................................."
                : ".................................."}
            </p>
            <p>( {homeroomJoined} )</p>
            <p>ครูประจำชั้น{gradeName}</p>
          </div>
          {deputyDirectorName && (
            <div className="pp6-sig-block">
              <p className="pp6-sig-line">..................................</p>
              <p>( {deputyDirectorName} )</p>
              <p>รองผู้อำนวยการโรงเรียน</p>
            </div>
          )}
          <div className="pp6-sig-block">
            <p className="pp6-sig-line">..................................</p>
            <p>( {directorName} )</p>
            <p>
              {directorTitle} {schoolName.startsWith("โรงเรียน") ? schoolName : `โรงเรียน${schoolName}`}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

/** Format คะแนนรวม — integer scores plain, fractional to 1 decimal. */
function fmtScoreInt(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

// ===================================================================
// Pp6Selector — shown when NOT embed (i.e. the admin opens the menu).
// Renders the split-pane <Pp6SelectorForm> with a live preview iframe.
// Resolves the SAME grade→room→classroom-id mapping as pp5-class, plus
// the enrolled-student roster per room (for the รายบุคคล dropdown).
// ===================================================================
async function Pp6Selector() {
  const supabase = await createClient();

  // Current academic year only — otherwise the dropdown shows duplicate
  // rooms (one classrooms row per year-room combo). Mirrors pp5-class.
  const { data: currentYear } = await supabase
    .from("academic_years")
    .select("id, current_semester")
    .eq("is_current", true)
    .maybeSingle();

  if (!currentYear) {
    return <Pp6SelectorForm classrooms={[]} />;
  }
  const currentSemester: 1 | 2 = (currentYear.current_semester ?? 1) as 1 | 2;

  // Teacher scope — limit to homeroom classrooms only (same guard rationale
  // as ปพ.5 รวมชั้น: ปพ.6 is a per-student whole-record bundle).
  const scope = await getTeacherScope();

  const { data: classroomsRaw } = await supabase
    .from("classrooms")
    .select(
      `
      id,
      room_number,
      grade_level:grade_levels!grade_level_id (id, name_th, name_short, sort_order, system)
    `,
    )
    .eq("academic_year_id", currentYear.id)
    .order("created_at");
  const classroomsScoped = scope
    ? (classroomsRaw ?? []).filter((c) => scope.homeroomClassroomIds.has(c.id))
    : classroomsRaw;
  const raw = (classroomsScoped ?? []).filter((c) => c.grade_level);
  raw.sort((a, b) => {
    const ga = a.grade_level!.sort_order ?? 0;
    const gb = b.grade_level!.sort_order ?? 0;
    if (ga !== gb) return ga - gb;
    return a.room_number - b.room_number;
  });

  // Multi-room detection per grade → "/N" suffix only when 2+ rooms share a
  // grade (matches pp5-class + /setup/homerooms labelling).
  const roomCountByGrade = new Map<string, number>();
  for (const c of raw) {
    const k = c.grade_level!.id;
    roomCountByGrade.set(k, (roomCountByGrade.get(k) ?? 0) + 1);
  }

  // Enrolled students per room (for the รายบุคคล dropdown). One query for
  // ALL rooms, then bucket per classroom. Primary rooms enrol at semester=0
  // (year-wide); secondary at the current semester — so we fetch BOTH and
  // pick the right one per room's system when bucketing.
  const classroomIds = raw.map((c) => c.id);
  const systemByClassroom = new Map<string, "primary" | "secondary">();
  for (const c of raw) {
    systemByClassroom.set(
      c.id,
      c.grade_level!.system === "primary" ? "primary" : "secondary",
    );
  }
  const studentsByClassroom = new Map<string, StudentOption[]>();
  if (classroomIds.length > 0) {
    const { data: enrolls } = await supabase
      .from("enrollments")
      .select(
        `
        classroom_id,
        semester,
        student_number,
        student:students!student_id (id, title, first_name, last_name)
      `,
      )
      .in("classroom_id", classroomIds)
      .in("semester", [0, currentSemester])
      .order("student_number");
    for (const e of enrolls ?? []) {
      if (!e.student) continue;
      const wantSemester =
        systemByClassroom.get(e.classroom_id) === "primary"
          ? 0
          : currentSemester;
      if (e.semester !== wantSemester) continue;
      const list = studentsByClassroom.get(e.classroom_id) ?? [];
      list.push({
        id: e.student.id,
        student_number: e.student_number,
        label: `${e.student_number}. ${abbreviateTitle(e.student.title)}${e.student.first_name} ${e.student.last_name}`,
      });
      studentsByClassroom.set(e.classroom_id, list);
    }
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
      is_primary: c.grade_level!.system === "primary",
      students: studentsByClassroom.get(c.id) ?? [],
    };
  });

  return <Pp6SelectorForm classrooms={opts} />;
}
