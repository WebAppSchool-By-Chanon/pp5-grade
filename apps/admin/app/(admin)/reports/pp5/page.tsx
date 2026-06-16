import { createAdminClient } from "@pp5/database/admin";
import { createClient } from "@pp5/database/server";
import Link from "next/link";
import { Fragment } from "react";
import { ensureCategorySlots, ensureSecondaryCategorySlots } from "../../setup/score-structure/actions";
import {
  abbreviateTitle,
  averageTwoSemesters,
  cutGrade,
  evalLevelLabel,
  overallEvalLevel,
} from "../../setup/score-structure/grading-utils";
import { type HeaderInfo, Pp5Frame, NumericTable, PrimaryAnnualSummary, PassFailTable, Pp5SimpleHeader, Pp5Footer } from "../_shared/score-report";
import { Pp5SelectorForm } from "./pp5-selector-form";
import type { Metadata } from "next";
import {
  currentTermSuffix,
  reportClassroomLabel,
  reportRoomSuffix,
} from "@/lib/current-term";
import { withSchoolPrefix } from "@/lib/school-name";
import { getTeacherScope } from "@/lib/teacher-scope";

export async function generateMetadata({
  searchParams,
}: Props): Promise<Metadata> {
  const p = await searchParams;
  if (p.embed !== "1") return {};
  const [suffix, room] = await Promise.all([
    currentTermSuffix(),
    reportClassroomLabel(p.classroom),
  ]);
  // Score-only print now has its OWN /reports/score-table route, so this pp5
  // route only ever serves the full ปพ.5 เล่ม — always "ปพ.5 รายวิชา".
  return { title: ["ปพ.5 รายวิชา", room, suffix].filter(Boolean).join(" ") };
}

type Props = {
  searchParams: Promise<{
    classroom?: string;
    subject?: string;
    semester?: string;
    /** Comma-separated section keys to include — e.g. "cover,scores,reading".
     *  Absent or empty = include ALL sections (backward compat with existing
     *  print-from-score-structure buttons). */
    parts?: string;
    /** "1" when this page is loaded INSIDE the selector's preview iframe —
     *  the toolbar is hidden so the iframe stays clean (admin prints via
     *  the parent page's "พิมพ์" button which calls iframe.print()). */
    embed?: string;
  }>;
};

type SectionKey =
  | "cover"
  | "weeklyGrid"
  | "attendance"
  | "scores"
  | "characteristics"
  | "reading"
  | "competency";

function resolveParts(raw: string | undefined): Record<SectionKey, boolean> {
  // No `parts` query param → show everything (legacy behaviour)
  if (!raw || raw.trim() === "") {
    return {
      cover: true,
      weeklyGrid: true,
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
    weeklyGrid: tokens.has("weeklyGrid"),
    attendance: tokens.has("attendance"),
    scores: tokens.has("scores"),
    characteristics: tokens.has("characteristics"),
    reading: tokens.has("reading"),
    competency: tokens.has("competency"),
  };
}

/**
 * Phase 3 — ปพ.5 (แบบบันทึกผลการเรียนประจำรายวิชา)
 *
 * Per-(classroom × subject × semester) report. Renders a print-optimized HTML
 * page; admin uses browser's Ctrl+P to save as PDF or print on paper.
 *
 * Layout adapts:
 *   - subject.grading_mode='numeric'      → score table (10+1 primary, 12 secondary)
 *   - subject.grading_mode='pass_fail'    → pass/fail table
 */
export default async function Pp5Page({ searchParams }: Props) {
  const params = await searchParams;
  const classroomId = params.classroom?.trim();
  const subjectId = params.subject?.trim();
  const semRaw = params.semester?.trim();
  const semester: 1 | 2 = semRaw === "2" ? 2 : 1;
  const parts = resolveParts(params.parts);
  const isEmbed = params.embed === "1";

  if (!classroomId || !subjectId) {
    return <Pp5Selector />;
  }

  // Teacher access guard — teachers can only open per-subject reports
  // for offerings they're assigned to.
  //
  // We scope by `semester` too. Without it, an activity subject (which has
  // one offering row per semester) returns BOTH rows when the teacher
  // teaches both halves → `.maybeSingle()` errors on >1 row and yields
  // null, falsely blocking the print. (classroom_id, subject_id, semester)
  // is unique in subject_offerings so semester-scoped query returns at
  // most one row.
  const teacherScope = await getTeacherScope();
  if (teacherScope) {
    const supabase = await createClient();
    const { data: offeringMatch } = await supabase
      .from("subject_offerings")
      .select("id")
      .eq("classroom_id", classroomId)
      .eq("subject_id", subjectId)
      .eq("semester", semester)
      .eq("teacher_id", teacherScope.teacherId)
      .maybeSingle();
    if (!offeringMatch) {
      return notFoundPage("คุณไม่ได้เป็นครูผู้สอนของวิชานี้");
    }
  }

  const supabase = await createClient();

  // 1. School info (single-tenant)
  const { data: school } = await supabase
    .from("schools")
    .select(
      "name_th, affiliation, district, province, logo_url, director_name, director_title, deputy_director_name, academic_head_name, assessment_officer_name",
    )
    .limit(1)
    .maybeSingle();

  // 2. Classroom + grade + academic year
  const { data: classroom } = await supabase
    .from("classrooms")
    .select(
      `
      id,
      room_number,
      grade_level:grade_levels!grade_level_id (
        id,
        name_short,
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
    .maybeSingle();

  if (!classroom?.grade_level || !classroom.academic_year) {
    return notFoundPage("ไม่พบข้อมูลห้องเรียน");
  }
  const isPrimary = classroom.grade_level.system === "primary";

  // 3. Subject (+ learning_area name for the cover's "กลุ่มสาระการเรียนรู้")
  const { data: subject } = await supabase
    .from("subjects")
    .select(
      `
      id,
      code,
      name_th,
      category,
      grading_mode,
      credit_hours,
      hours_per_year,
      learning_area:learning_areas!learning_area_id (name_th)
    `,
    )
    .eq("id", subjectId)
    .maybeSingle();
  if (!subject) return notFoundPage("ไม่พบข้อมูลวิชา");

  // 4. Offering (classroom × subject × semester) + teacher
  //
  // Auto-create the offering with teacher_id=NULL if missing — admin can
  // print the form for a subject they haven't assigned a teacher to yet.
  // The teacher line on the page just shows "—" in that case.
  let { data: offering } = await supabase
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
    const admin = createAdminClient();
    const { data: created } = await admin
      .from("subject_offerings")
      .insert({
        classroom_id: classroomId,
        subject_id: subjectId,
        semester,
        teacher_id: null,
      })
      .select(
        `
        id,
        teacher:teachers!teacher_id (
          user:users!user_id (full_name, title)
        )
      `,
      )
      .single();
    offering = created;
  }

  if (!offering) {
    return notFoundPage("ไม่สามารถสร้างบันทึกวิชาได้");
  }

  const teacherUser = offering.teacher?.user;
  const teacherLabel = teacherUser
    ? `${teacherUser.title ?? ""}${teacherUser.full_name}`
    : "—";

  // 5. Homeroom teachers (both slots — equal status per user spec).
  //    Used on the cover's meta row "ครูประจำชั้น: A · B" — both names
  //    shown together when both slots are filled. Joined with " · ".
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
      (h) =>
        `${h.teacher!.user!.title ?? ""}${h.teacher!.user!.full_name}`,
    );
  const homeroomLabel =
    homeroomNames.length > 0 ? homeroomNames.join(" · ") : null;

  // 6. Enrolled students — scoped by semester:
  //    primary  → semester=0 (year-wide)
  //    secondary → semester=N (the requested semester)
  const enrollmentSemester: 0 | 1 | 2 = isPrimary ? 0 : semester;
  const { data: enrolls } = await supabase
    .from("enrollments")
    .select(
      `
      student_number,
      student:students!student_id (
        id,
        student_code,
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
      student_code: e.student!.student_code,
      title: e.student!.title,
      first_name: e.student!.first_name,
      last_name: e.student!.last_name,
      full_label: `${abbreviateTitle(e.student!.title)}${e.student!.first_name} ${e.student!.last_name}`,
    }));
  const studentIds = students.map((s) => s.id);

  // 6b. Eval data (ภาพรวมของนักเรียน — global, per (year, semester))
  //
  //   This is the "B path" from the design discussion: ปพ.5 ประจำวิชา shows
  //   the student's OVERALL eval (not per-subject), labelled "ภาพรวม".
  //   When per-subject eval gets added later, this section can fall back to
  //   subject-specific values when they exist (offering_id IS NOT NULL).
  //
  //   For pass-fail subjects (activity) and for primary subjects: still
  //   show the eval — it's about the student, not the subject.
  const evalYearId = classroom.academic_year ? undefined : undefined;
  // Resolve academic_year_id from classroom for the eval queries below.
  // We pulled `academic_year.year_be` earlier but not the id — quick lookup:
  const { data: yearRow } = await supabase
    .from("academic_years")
    .select("id")
    .eq("year_be", classroom.academic_year.year_be)
    .maybeSingle();
  const academicYearId = yearRow?.id ?? null;

  // Master list of characteristics (active, sorted)
  const { data: characteristicsList } = await supabase
    .from("characteristics")
    .select("id, name, sort_order")
    .eq("is_active", true)
    .order("sort_order");

  type CharEvalMap = Map<string, Map<string, number>>; // student → characteristic_id → score
  const charEvalMap: CharEvalMap = new Map();
  let readingThinkingByStudent = new Map<
    string,
    { reading: number | null; thinking: number | null; writing: number | null }
  >();
  let competencyByStudent = new Map<
    string,
    {
      communication: number | null;
      thinking: number | null;
      problem_solving: number | null;
      life_skills: number | null;
      technology: number | null;
    }
  >();

  // Eval scope mirrors `enrollmentSemester` — primary uses 0 (annual),
  // secondary uses the requested semester (1/2). After migration
  // 20260518a_evals_annual_for_primary.sql, the 3 eval tables accept
  // semester=0 to mean "ทั้งปี" for primary students.
  const evalSemester: 0 | 1 | 2 = isPrimary ? 0 : semester;

  if (academicYearId && studentIds.length > 0) {
    const [{ data: charData }, { data: rtData }, { data: compData }] =
      await Promise.all([
        supabase
          .from("characteristic_evaluations")
          .select("student_id, characteristic_id, score")
          .eq("academic_year_id", academicYearId)
          .eq("semester", evalSemester)
          .in("student_id", studentIds),
        supabase
          .from("reading_thinking_evaluations")
          .select(
            "student_id, reading_score, thinking_score, writing_score",
          )
          .eq("academic_year_id", academicYearId)
          .eq("semester", evalSemester)
          .in("student_id", studentIds),
        supabase
          .from("competency_evaluations")
          .select(
            "student_id, communication_score, thinking_score, problem_solving_score, life_skills_score, technology_score",
          )
          .eq("academic_year_id", academicYearId)
          .eq("semester", evalSemester)
          .in("student_id", studentIds),
      ]);

    for (const row of charData ?? []) {
      if (row.score == null) continue;
      let inner = charEvalMap.get(row.student_id);
      if (!inner) {
        inner = new Map();
        charEvalMap.set(row.student_id, inner);
      }
      inner.set(row.characteristic_id, row.score);
    }
    readingThinkingByStudent = new Map(
      (rtData ?? []).map((r) => [
        r.student_id,
        {
          reading: r.reading_score,
          thinking: r.thinking_score,
          writing: r.writing_score,
        },
      ]),
    );
    competencyByStudent = new Map(
      (compData ?? []).map((c) => [
        c.student_id,
        {
          communication: c.communication_score,
          thinking: c.thinking_score,
          problem_solving: c.problem_solving_score,
          life_skills: c.life_skills_score,
          technology: c.technology_score,
        },
      ]),
    );
  }

  const evalPayload = {
    characteristics: characteristicsList ?? [],
    charEvalMap,
    readingThinkingByStudent,
    competencyByStudent,
  };

  // 6c'. Eval-distribution counts for the cover's "สรุปผลการประเมิน" table.
  //
  // Strategy: average each student's eval scores (per group), then bucket
  // into 3 (ดีเยี่ยม) / 2 (ดี) / 1 (ผ่าน) / 0 (ไม่ผ่าน). Anyone with no
  // recorded eval counts as null (excluded from totals).
  const charDistribution = { d3: 0, d2: 0, d1: 0, d0: 0 };
  const rtDistribution = { d3: 0, d2: 0, d1: 0, d0: 0 };
  const bucket = (
    dist: { d3: number; d2: number; d1: number; d0: number },
    level: number | null,
  ) => {
    if (level === 3) dist.d3++;
    else if (level === 2) dist.d2++;
    else if (level === 1) dist.d1++;
    else if (level === 0) dist.d0++;
  };
  for (const s of students) {
    // คุณลักษณะ — ฐานนิยมของทุกข้อ (มี 0 แม้ข้อเดียว = ไม่ผ่าน)
    const inner = charEvalMap.get(s.id);
    if (inner && inner.size > 0) {
      bucket(charDistribution, overallEvalLevel(Array.from(inner.values())));
    }
    // อ่านคิดเขียน — ฐานนิยมของ 3 ด้าน
    const rt = readingThinkingByStudent.get(s.id);
    if (rt) {
      bucket(
        rtDistribution,
        overallEvalLevel([rt.reading, rt.thinking, rt.writing]),
      );
    }
  }

  // 6c. Subject-attendance summary per student (มา/ขาด/ลา + % ของ totalSlots).
  //     Only meaningful for subjects with credit_hours > 0 (กิจกรรม uses
  //     pass/fail, not weekly attendance). totalSlots = หน่วยกิต × 2 × 20.
  const slotsPerWeek =
    subject.credit_hours && subject.credit_hours > 0
      ? Math.max(1, Math.round(subject.credit_hours * 2))
      : // Primary has no credit_hours → derive slots/week from hours_per_year
        // (÷40 weeks/year ≈ hours/week). User spec 2026-06-01: ประถมต้องเห็น
        // ตารางเวลาเรียน + สรุป ใน ปพ.5 รายวิชา ด้วย.
        isPrimary && subject.hours_per_year && subject.hours_per_year > 0
        ? Math.max(1, Math.round(subject.hours_per_year / 40))
        : 0;
  const totalSlots = slotsPerWeek * 20;

  // Anchor inputs for the weekly-grid month labels. Captured into plain
  // locals here (where the `if (!classroom...) return` narrowing from §2
  // still holds) so the buildOfferingAttendance closure below doesn't need
  // to re-narrow `classroom` — TS doesn't carry the narrowing into a nested
  // function body. start_date/end_date come from the school's configured
  // academic-year dates (fallback handled per-semester inside the helper).
  const yearStartDate = classroom.academic_year.start_date ?? null;
  const yearEndDate = classroom.academic_year.end_date ?? null;
  const academicYearBe = classroom.academic_year.year_be;

  type AttendanceSummary = {
    present: number;
    absent: number;
    leave: number;
    pct: number;
  };

  type OfferingAttendance = {
    weeklyGridPayload: {
      slotsPerWeek: number;
      anchorIso: string;
      cellsByStudent: Map<string, Map<string, "present" | "absent" | "leave">>;
      countsByStudent: Map<string, AttendanceSummary>;
      totalSlots: number;
    };
    attendancePayload: {
      totalSlots: number;
      summaryByStudent: Map<string, AttendanceSummary>;
    };
  };

  // Build the weekly-grid + summary payloads for ONE offering / semester.
  //
  // `slotsPerWeek` / `totalSlots` are SEMESTER-INDEPENDENT (computed once
  // above from credit_hours / hours_per_year) and closed over here. The only
  // per-semester inputs are `offeringId` (which subject_attendance rows to
  // read) and `sem` (which drives the weekly-grid month-label anchor).
  //
  // PRIMARY shows this for BOTH semesters (user spec 2026-06-01); SECONDARY
  // shows it for the single URL semester only.
  async function buildOfferingAttendance(
    offeringId: string,
    sem: 1 | 2,
  ): Promise<OfferingAttendance> {
    const summaryByStudent = new Map<string, AttendanceSummary>();
    // Per-student × (week, slot) status — used by the weekly-grid section
    // to render each cell. Key format: `${week}|${slot}`
    const cellsByStudent = new Map<
      string,
      Map<string, "present" | "absent" | "leave">
    >();
    if (totalSlots > 0 && studentIds.length > 0) {
      // Paginate by .range() — Supabase max-rows defaults to 1000, and a
      // fully-recorded ปพ.5 offering can exceed that (18 students × 80 slots
      // = 1440). Without explicit ranging, the newest cells silently drop
      // out of the SELECT result.
      type SaRow = {
        student_id: string;
        week: number;
        slot_in_week: number;
        status: "present" | "absent" | "leave" | "sick";
      };
      const PAGE = 1000;
      const saRows: SaRow[] = [];
      let from = 0;
      while (true) {
        const { data, error } = await supabase
          .from("subject_attendance")
          .select("student_id, week, slot_in_week, status")
          .eq("offering_id", offeringId)
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
        // Summary counts
        let agg = summaryByStudent.get(row.student_id);
        if (!agg) {
          agg = { present: 0, absent: 0, leave: 0, pct: 0 };
          summaryByStudent.set(row.student_id, agg);
        }
        if (row.status === "present") agg.present++;
        else if (row.status === "absent") agg.absent++;
        else if (row.status === "leave") agg.leave++;

        // Per-cell map (only the 3 UI statuses; skip "sick" if any slipped in)
        if (
          row.status === "present" ||
          row.status === "absent" ||
          row.status === "leave"
        ) {
          const key = `${row.week}|${row.slot_in_week}`;
          let cellMap = cellsByStudent.get(row.student_id);
          if (!cellMap) {
            cellMap = new Map();
            cellsByStudent.set(row.student_id, cellMap);
          }
          cellMap.set(key, row.status);
        }
      }
      // Compute % per student (after counting)
      for (const agg of summaryByStudent.values()) {
        agg.pct = Math.round((agg.present / totalSlots) * 100);
      }
    }

    // Compute anchor for the weekly-grid month labels (uses the school's
    // configured start_date / end_date or fallback Thai standard).
    const anchorIso = (() => {
      const configured = sem === 1 ? yearStartDate : yearEndDate;
      if (configured) return configured;
      const yearCe = academicYearBe - 543;
      return sem === 1 ? `${yearCe}-05-16` : `${yearCe}-11-01`;
    })();

    return {
      weeklyGridPayload: {
        slotsPerWeek,
        anchorIso,
        cellsByStudent,
        countsByStudent: summaryByStudent,
        totalSlots,
      },
      attendancePayload: {
        totalSlots,
        summaryByStudent,
      },
    };
  }

  // Helpers used both in the cover and the existing footer/header:
  //   - "ม.1" → "ตอนต้น" (ม.1-3) · "ม.4-6" → "ตอนปลาย"
  //   - หน่วยกิต = credit_hours
  //   - ชั่วโมง/สัปดาห์ = credit_hours × 2 (per ปพ.5 มัธยม standard)
  //   - รวมเวลาเรียน:
  //       มัธยม → ชม./สัปดาห์ × 20 = "X ชม./ภาค"
  //       ประถม → ชม./สัปดาห์ × 40 = "X ชม./ปี" (= 2 ภาคเรียน)
  const gradeShort = classroom.grade_level.name_short; // "ม.1" / "ป.3"
  // ระดับชั้น (cover checkbox): ประถม / มัธยม based on grade.system
  const isPrimaryLevel = classroom.grade_level.system === "primary";
  const isSecondaryLevel = classroom.grade_level.system === "secondary";
  const hoursPerWeek = subject.credit_hours
    ? subject.credit_hours * 2
    : isPrimaryLevel && subject.hours_per_year
      ? Math.round(subject.hours_per_year / 40)
      : 0;
  const totalHoursPerSemester = hoursPerWeek * 20;

  const headerInfo = {
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
    // Full label per user spec — "ชั้นประถมศึกษาปีที่ 1/1" / "ชั้นมัธยมศึกษาปีที่ 1/1"
    classLabel: `ชั้น${classroom.grade_level.name_th}${await reportRoomSuffix(classroomId)}`,
    gradeShort,
    isPrimaryLevel,
    isSecondaryLevel,
    yearBe: classroom.academic_year.year_be,
    semester,
    subjectCode: subject.code,
    subjectName: subject.name_th,
    subjectCategory: subject.category, // core | additional | activity
    learningAreaName: subject.learning_area?.name_th ?? null,
    creditHours: subject.credit_hours,
    hoursPerWeek,
    totalHoursPerSemester,
    teacherLabel,
    homeroomLabel,
  };

  // Signers list for the eval-section footers (chars / reading / competency).
  // These 3 sections are NOT subject-specific — they're per-class evaluations
  // signed by the homeroom teacher(s). Each filled homeroom slot becomes its
  // own signature block (per user spec — both homeroom teachers have equal
  // status). Mirrors the signer logic in /reports/student-eval/page.tsx so
  // the pp5 bundle prints the same footer the standalone eval pages do.
  type EvalSigner = { name: string; role: string };
  const evalSigners: EvalSigner[] = [];
  if (homeroomNames.length === 0) {
    evalSigners.push({ name: "—", role: "ครูประจำชั้น" });
  } else {
    for (const name of homeroomNames) {
      evalSigners.push({ name, role: "ครูประจำชั้น" });
    }
  }
  if (school?.assessment_officer_name) {
    evalSigners.push({
      name: school.assessment_officer_name,
      role: "หัวหน้างานวัดผล",
    });
  }
  if (school?.deputy_director_name) {
    evalSigners.push({
      name: school.deputy_director_name,
      role: "รองผู้อำนวยการ",
    });
  }
  evalSigners.push({
    name: school?.director_name ?? "—",
    role: school?.director_title ?? "ผู้อำนวยการ",
  });

  // 7. Branch by grading_mode
  // Common cover payload used by both branches (numeric + pass_fail).
  // Grade distribution is filled in per branch below — numeric counts
  // each cut grade (4/3.5/.../0), pass_fail counts pass/fail.
  type GradeBuckets = {
    g4: number;
    g35: number;
    g3: number;
    g25: number;
    g2: number;
    g15: number;
    g1: number;
    g0: number;
    rr: number; // ร = รอผลการเรียน (not auto-computed yet)
    ms: number; // มส = ไม่มีสิทธิ์ (not auto-computed yet)
    pass: number; // ผ่านการประเมิน
    fail: number; // ไม่ผ่านการประเมิน
  };
  const emptyGradeBuckets: GradeBuckets = {
    g4: 0,
    g35: 0,
    g3: 0,
    g25: 0,
    g2: 0,
    g15: 0,
    g1: 0,
    g0: 0,
    rr: 0,
    ms: 0,
    pass: 0,
    fail: 0,
  };

  if (subject.grading_mode === "pass_fail") {
    // Fetch grades.pass_fail for this offering + semester
    const { data: grades } = await supabase
      .from("grades")
      .select("student_id, pass_fail")
      .eq("offering_id", offering.id)
      .eq("grading_period", "semester");
    const passFailMap = new Map<string, "pass" | "fail">();
    for (const g of grades ?? []) {
      if (g.pass_fail === "pass" || g.pass_fail === "fail") {
        passFailMap.set(g.student_id, g.pass_fail);
      }
    }

    // Pass/fail grade distribution for the cover summary
    const pfBuckets: GradeBuckets = { ...emptyGradeBuckets };
    for (const s of students) {
      const r = passFailMap.get(s.id);
      if (r === "pass") pfBuckets.pass++;
      else if (r === "fail") pfBuckets.fail++;
    }
    const coverPayload = {
      info: headerInfo,
      studentCount: students.length,
      gradeBuckets: pfBuckets,
      charDistribution,
      rtDistribution,
    };
    return (
      <Pp5Frame info={headerInfo} embed={isEmbed}>
        {parts.cover && <Pp5Cover {...coverPayload} />}
        {/* No cover requested → render the original Phase 3 "simple header"
            (title + school + info-grid) so the score table still has
            context. Used by `/setup/score-structure`'s "พิมพ์รายงาน"
            button which passes `?parts=scores`. */}
        {!parts.cover && (
          <Pp5SimpleHeader
            info={headerInfo}
            compact={students.length > 30}
            xcompact={students.length > 35}
          />
        )}
        {parts.scores && (
          <PassFailTable
            students={students.map((s) => ({
              ...s,
              result: passFailMap.get(s.id) ?? null,
            }))}
          />
        )}
        {/* Activity subjects use pass/fail — no weekly attendance grid.
            Skip AttendanceSummarySection. */}
        <EvalSection
          students={students}
          {...evalPayload}
          info={headerInfo}
          signers={evalSigners}
          show={{
            characteristics: parts.characteristics,
            reading: parts.reading,
            competency: parts.competency,
          }}
        />
        {/* Final signature row — only when the cover ISN'T rendered (e.g.
            simple-print at /setup/score-structure → ?parts=scores).
            When the cover IS rendered (full bundle), the cover already
            has 2 approval signature blocks ("การอนุมัติผลการเรียน" +
            "เสนอเพื่อพิจารณา") — no need to repeat at the very bottom. */}
        {!parts.cover && (
          <Pp5Footer
            info={headerInfo}
            compact={students.length > 30}
            xcompact={students.length > 35}
          />
        )}
      </Pp5Frame>
    );
  }

  // 8. Numeric — ensure categories + fetch scores + grade_scales
  //
  // For PRIMARY (annual subject = subjects.semester=0) the system maintains
  // TWO offerings per (classroom × subject) — one per semester — each with
  // its own score_categories + scores. The ปพ.5 print bundle therefore
  // shows the score data on THREE pages: ภาคเรียนที่ 1, ภาคเรียนที่ 2, and
  // a สรุปผล (annual) summary. The base `offering` variable above is for
  // the URL-semester offering (used by attendance/grades queries); below
  // we additionally ensure the OTHER semester's offering exists so the
  // pair is always loadable.
  //
  // For SECONDARY the single URL-semester offering is enough (subjects are
  // semester-specific so each subject lives entirely in one semester).
  type SlotCategory = {
    id: string;
    name: string;
    max_score: number;
    sort_order: number;
    is_midterm: boolean;
    is_final: boolean;
  };
  type SemScoreBundle = {
    categories: SlotCategory[];
    scoresByStudent: Map<string, Record<string, number>>;
  };

  // Helper: ensure the (classroom × subject × semester) offering exists,
  // creating with teacher_id=NULL if missing — mirrors the pattern at
  // lines 144-188 above. Returns the offering id.
  //
  // classroomId / subjectId are passed in (rather than closed over the
  // outer scope) because TypeScript doesn't preserve the `if (!classroomId
  // || !subjectId) return` narrowing across function boundaries.
  async function ensureOfferingId(
    cId: string,
    sId: string,
    sem: 1 | 2,
  ): Promise<string> {
    if (sem === semester && offering) return offering.id;
    const { data: found } = await supabase
      .from("subject_offerings")
      .select("id")
      .eq("classroom_id", cId)
      .eq("subject_id", sId)
      .eq("semester", sem)
      .maybeSingle();
    if (found) return found.id;
    const admin = createAdminClient();
    const { data: created } = await admin
      .from("subject_offerings")
      .insert({
        classroom_id: cId,
        subject_id: sId,
        semester: sem,
        teacher_id: null,
      })
      .select("id")
      .single();
    if (!created)
      throw new Error("failed to create offering for primary 3-page bundle");
    return created.id;
  }

  // Load categories + scores for ONE offering. Used for primary (called
  // twice) and secondary (once, branched to secondary slots).
  async function loadSemBundle(
    offeringId: string,
    isPrimaryArg: boolean,
  ): Promise<SemScoreBundle> {
    const cats = isPrimaryArg
      ? await ensureCategorySlots(offeringId)
      : await ensureSecondaryCategorySlots(offeringId);
    const { data: scoresData } = await supabase
      .from("scores")
      .select("student_id, category_id, score")
      .in(
        "category_id",
        cats.map((c) => c.id),
      );
    const map = new Map<string, Record<string, number>>();
    for (const row of scoresData ?? []) {
      if (!map.has(row.student_id)) map.set(row.student_id, {});
      if (row.score != null) {
        map.get(row.student_id)![row.category_id] = Number(row.score);
      }
    }
    return { categories: cats, scoresByStudent: map };
  }

  let primaryBundles: { sem1: SemScoreBundle; sem2: SemScoreBundle } | null =
    null;
  let secondaryBundle: SemScoreBundle | null = null;

  // Attendance (weekly grid + summary) per semester to render. PRIMARY shows
  // BOTH semesters (user spec 2026-06-01); SECONDARY shows only the URL
  // semester. Built here so primary can reuse the offering ids resolved for
  // the scores branch (same offerings back both scores AND attendance).
  const attendanceList: Array<
    { sem: 1 | 2 } & OfferingAttendance
  > = [];

  if (isPrimary) {
    const [sem1Id, sem2Id] = await Promise.all([
      ensureOfferingId(classroomId, subjectId, 1),
      ensureOfferingId(classroomId, subjectId, 2),
    ]);
    const [sem1Bundle, sem2Bundle, sem1Att, sem2Att] = await Promise.all([
      loadSemBundle(sem1Id, true),
      loadSemBundle(sem2Id, true),
      buildOfferingAttendance(sem1Id, 1),
      buildOfferingAttendance(sem2Id, 2),
    ]);
    primaryBundles = { sem1: sem1Bundle, sem2: sem2Bundle };
    attendanceList.push({ sem: 1, ...sem1Att }, { sem: 2, ...sem2Att });
  } else {
    secondaryBundle = await loadSemBundle(offering.id, false);
    attendanceList.push({
      sem: semester,
      ...(await buildOfferingAttendance(offering.id, semester)),
    });
  }

  // Whole-year attendance summary (primary only) — merge both semesters'
  // per-student counts so the bundle can end with a สรุปทั้งปี table.
  // User spec 2026-06-01.
  const annualAttendance =
    isPrimary && attendanceList.length === 2
      ? (() => {
          const merged = new Map<
            string,
            { present: number; absent: number; leave: number; pct: number }
          >();
          for (const a of attendanceList) {
            for (const [sid, c] of a.attendancePayload.summaryByStudent) {
              const m = merged.get(sid) ?? {
                present: 0,
                absent: 0,
                leave: 0,
                pct: 0,
              };
              m.present += c.present;
              m.absent += c.absent;
              m.leave += c.leave;
              merged.set(sid, m);
            }
          }
          const totalSlots = attendanceList.reduce(
            (sum, a) => sum + a.attendancePayload.totalSlots,
            0,
          );
          for (const m of merged.values()) {
            m.pct =
              totalSlots > 0 ? Math.round((m.present / totalSlots) * 100) : 0;
          }
          return { totalSlots, summaryByStudent: merged };
        })()
      : null;

  const { data: scalesData } = await supabase
    .from("grade_scales")
    .select("min_score, max_score, grade")
    .order("sort_order");
  const scales = (scalesData ?? []).map((s) => ({
    min_score: Number(s.min_score),
    max_score: Number(s.max_score),
    grade: Number(s.grade),
  }));

  // Per-student total helper — sums all category scores in a bundle.
  const totalFor = (bundle: SemScoreBundle, sid: string): number => {
    const ss = bundle.scoresByStudent.get(sid) ?? {};
    return bundle.categories.reduce(
      (acc, c) => acc + (ss[c.id] ?? 0),
      0,
    );
  };

  // Numeric-grade distribution per student → bucket counts for the cover.
  //   - PRIMARY  : annual grade = cutGrade(avg(sem1, sem2), scales)
  //   - SECONDARY: semester grade = cutGrade(sem1 total, scales)
  const numericBuckets: GradeBuckets = { ...emptyGradeBuckets };
  const bucketKeyFor = (
    grade: number,
  ):
    | "g4"
    | "g35"
    | "g3"
    | "g25"
    | "g2"
    | "g15"
    | "g1"
    | "g0"
    | null => {
    // grade_scales uses .5 steps — map to one of 8 buckets
    if (grade >= 3.75) return "g4";
    if (grade >= 3.25) return "g35";
    if (grade >= 2.75) return "g3";
    if (grade >= 2.25) return "g25";
    if (grade >= 1.75) return "g2";
    if (grade >= 1.25) return "g15";
    if (grade >= 0.75) return "g1";
    return "g0";
  };
  for (const s of students) {
    let grade: number;
    if (isPrimary && primaryBundles) {
      const t1 = totalFor(primaryBundles.sem1, s.id);
      const t2 = totalFor(primaryBundles.sem2, s.id);
      grade = cutGrade(averageTwoSemesters(t1, t2), scales);
    } else if (secondaryBundle) {
      grade = cutGrade(totalFor(secondaryBundle, s.id), scales);
    } else {
      continue;
    }
    const key = bucketKeyFor(grade);
    if (key) numericBuckets[key]++;
  }

  const coverPayload = {
    info: headerInfo,
    studentCount: students.length,
    gradeBuckets: numericBuckets,
    charDistribution,
    rtDistribution,
  };

  return (
    <Pp5Frame info={headerInfo} embed={isEmbed}>
      {parts.cover && <Pp5Cover {...coverPayload} />}
      {/* No cover requested → render the original Phase 3 "simple header"
          (title + school + info-grid) so the score table still has
          context. Used by `/setup/score-structure`'s "พิมพ์รายงาน"
          button which passes `?parts=scores`. */}
      {!parts.cover && (
        <Pp5SimpleHeader
          info={headerInfo}
          compact={students.length > 30}
          xcompact={students.length > 35}
        />
      )}
      {/* Weekly grid + summary. PRIMARY renders BOTH semesters back-to-back
          (each pair labelled "ภาคเรียนที่ N" via the `semester` prop); each
          semester's summary sits RIGHT after its own weekly grid per user
          spec 2026-05-19 (raw weekly cells → roll-up read together).
          SECONDARY renders exactly one entry (the URL semester) and the
          `semester` prop is the URL semester → output unchanged. */}
      {attendanceList.map((a) => (
        <Fragment key={a.sem}>
          {parts.weeklyGrid && (
            <AttendanceWeeklyGridSection
              students={students}
              info={headerInfo}
              semester={attendanceList.length > 1 ? a.sem : undefined}
              {...a.weeklyGridPayload}
            />
          )}
          {parts.attendance && (
            <AttendanceSummarySection
              students={students}
              info={headerInfo}
              semester={attendanceList.length > 1 ? a.sem : undefined}
              {...a.attendancePayload}
            />
          )}
        </Fragment>
      ))}
      {/* สรุปเวลาเรียนทั้งปี — primary only, merges both semesters into one
          summary table after the per-semester ones. */}
      {parts.attendance && annualAttendance && (
        <AttendanceSummarySection
          students={students}
          info={headerInfo}
          semester="annual"
          totalSlots={annualAttendance.totalSlots}
          summaryByStudent={annualAttendance.summaryByStudent}
        />
      )}
      {parts.scores &&
        (isPrimary && primaryBundles ? (
          // PRIMARY scores — output depends on the print MODE:
          //
          // BUNDLE (parts.cover=true, the full ปพ.5 รายวิชา เล่ม):
          //   → 3 pages: ภาคเรียนที่ 1, ภาคเรียนที่ 2, สรุปทั้งปี
          //   → each page has its own Pp5ScoreHeader (logo-less) so the
          //     section is self-contained beneath the cover.
          //
          // SIMPLE-PRINT (parts.cover=false, e.g. /setup/score-structure
          // → "พิมพ์รายงาน" on a specific semester tab):
          //   → ONE page for the URL semester ONLY. The page that hosts
          //     the click is recording a single semester, so the print
          //     must show ONLY that semester — never bleed sem1's data
          //     into the sem2 printout (user complaint 2026-05-19:
          //     "กดพิมพ์ที่ปุ่มของภาคเรียนใด ก็ให้พิมพ์เฉพาะของภาคเรียนนั้น").
          //   → no per-section header (the document-level Pp5SimpleHeader
          //     at the top already names the semester via info.semester).
          parts.cover ? (
            <>
              <NumericTable
                categories={primaryBundles.sem1.categories}
                students={students}
                scoresByStudent={primaryBundles.sem1.scoresByStudent}
                scales={scales}
                isPrimary
                info={headerInfo}
                termText={`ภาคเรียนที่ 1 ปีการศึกษา ${headerInfo.yearBe}`}
              />
              <NumericTable
                categories={primaryBundles.sem2.categories}
                students={students}
                scoresByStudent={primaryBundles.sem2.scoresByStudent}
                scales={scales}
                isPrimary
                info={headerInfo}
                termText={`ภาคเรียนที่ 2 ปีการศึกษา ${headerInfo.yearBe}`}
              />
              <PrimaryAnnualSummary
                students={students}
                sem1={primaryBundles.sem1}
                sem2={primaryBundles.sem2}
                scales={scales}
                info={headerInfo}
                showHeader
              />
            </>
          ) : (
            // Pick the matching semester's bundle based on the URL.
            <NumericTable
              categories={
                semester === 1
                  ? primaryBundles.sem1.categories
                  : primaryBundles.sem2.categories
              }
              students={students}
              scoresByStudent={
                semester === 1
                  ? primaryBundles.sem1.scoresByStudent
                  : primaryBundles.sem2.scoresByStudent
              }
              scales={scales}
              isPrimary
            />
          )
        ) : secondaryBundle ? (
          // SECONDARY → 1 page for the URL semester (always). In bundle
          // mode the per-section header replaces the cover-only document
          // header for this section; in simple-print mode the top
          // Pp5SimpleHeader carries the heading instead.
          <NumericTable
            categories={secondaryBundle.categories}
            students={students}
            scoresByStudent={secondaryBundle.scoresByStudent}
            scales={scales}
            isPrimary={false}
            info={parts.cover ? headerInfo : undefined}
          />
        ) : null)}
      <EvalSection
        students={students}
        {...evalPayload}
        info={headerInfo}
        signers={evalSigners}
        show={{
          characteristics: parts.characteristics,
          reading: parts.reading,
          competency: parts.competency,
        }}
      />
      {/* Same conditional as the pass_fail branch above — see comment
          there. Skip the final Pp5Footer when the cover is rendered
          (cover has its own approval signatures). */}
      {!parts.cover && (
        <Pp5Footer
          info={headerInfo}
          compact={students.length > 30}
          xcompact={students.length > 35}
        />
      )}
    </Pp5Frame>
  );
}


// ===================================================================
// Pp5Cover — cover page (หน้า 1) for ปพ.5 รายวิชา
//
// Layout matches the standard Thai ปพ.5 cover sheet:
//   - School header (name + อำเภอ จังหวัด)
//   - Subject + class meta (with พื้นฐาน/เพิ่มเติม + ตอนต้น/ตอนปลาย checkboxes)
//   - "สรุปผลการเรียน" — count of students per cut grade + ผ่าน/ไม่ผ่าน
//   - "สรุปผลการประเมิน" — count per characteristic + reading-thinking bucket
//   - "การอนุมัติผลการเรียน" — 3 inline signature blocks (ครูผู้สอน,
//     หัวหน้ากลุ่มสาระฯ, หัวหน้างานวัดผล)
//   - "เสนอเพื่อพิจารณา" — รอง ผอ. signature + อนุมัติ/ไม่อนุมัติ checkboxes
//   - ผู้อำนวยการ signature
//
// Followed by `.pp5-page-break` so the per-student tables start on page 2.
// ===================================================================

type GradeBuckets = {
  g4: number;
  g35: number;
  g3: number;
  g25: number;
  g2: number;
  g15: number;
  g1: number;
  g0: number;
  rr: number;
  ms: number;
  pass: number;
  fail: number;
};

function pct(count: number, total: number): string {
  if (total === 0) return "—";
  return `${Math.round((count / total) * 100)}`;
}

function Pp5Cover({
  info,
  studentCount,
  gradeBuckets,
  charDistribution,
  rtDistribution,
}: {
  info: HeaderInfo;
  studentCount: number;
  gradeBuckets: GradeBuckets;
  charDistribution: { d3: number; d2: number; d1: number; d0: number };
  rtDistribution: { d3: number; d2: number; d1: number; d0: number };
}) {
  const checked = "☑";
  const unchecked = "☐";
  const isCore = info.subjectCategory === "core";
  const isAdditional = info.subjectCategory === "additional";
  // Filler for empty value lines (admin writes by hand on print)
  const blank = "..............................";

  // Build the meta rows as label/value pairs for the table layout
  return (
    <section className="pp5-cover pp5-page-content">
      {/* Document title + school header.
          School block (per user spec):
            1. โรงเรียน <name>
            2. อำเภอ <district>  จังหวัด <province>
            3. สังกัด <affiliation>
          The bottom สังกัด line is shown even when district/province are
          also filled in — gives the full administrative chain on one cover.
          If district/province are missing, fall back to a blank placeholder
          so the layout stays consistent. */}
      <div className="pp5-cover-head">
        {info.logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={info.logoUrl}
            alt="โลโก้โรงเรียน"
            className="pp5-cover-logo"
          />
        )}
        <h1 className="pp5-cover-title">แบบบันทึกผลการเรียนประจำรายวิชา</h1>
        <p className="pp5-cover-school">{withSchoolPrefix(info.schoolName)}</p>
        <p className="pp5-cover-affiliation">
          อำเภอ{info.district ?? blank}
          {"  "}จังหวัด{info.province ?? blank}
        </p>
        <p className="pp5-cover-affiliation">สังกัด {info.affiliation}</p>
      </div>

      {/* Meta info — uses a real table for predictable column widths.
          Row order per user spec 2026-05-19 ("ย้ายแถว ชั้น/ปี/ภาคเรียน
          ไปอยู่ก่อนแถวรายวิชา"):
            1. ชั้น / ปีการศึกษา / ภาคเรียนที่  ← moved to top
            2. รายวิชา / รหัสวิชา
            3. กลุ่มสาระการเรียนรู้
            4. สาระการเรียนรู้ (พื้นฐาน / เพิ่มเติม)
            5. ระดับชั้น (ประถม / มัธยม)
            6. หน่วยกิต / เวลาเรียน / รวมเวลาเรียน
            7. ครูผู้สอน
            8. ครูประจำชั้น */}
      <table className="pp5-cover-meta">
        <tbody>
          <tr>
            <td className="pp5-cover-lbl">ชั้น</td>
            <td className="pp5-cover-val">{info.classLabel}</td>
            <td className="pp5-cover-lbl">ปีการศึกษา</td>
            <td className="pp5-cover-val">{info.yearBe}</td>
            <td className="pp5-cover-lbl">ภาคเรียนที่</td>
            <td className="pp5-cover-val">{info.semester}</td>
          </tr>
          <tr>
            <td className="pp5-cover-lbl">รายวิชา</td>
            <td className="pp5-cover-val" colSpan={3}>
              {info.subjectName}
            </td>
            <td className="pp5-cover-lbl">รหัสวิชา</td>
            <td className="pp5-cover-val">{info.subjectCode}</td>
          </tr>
          <tr>
            <td className="pp5-cover-lbl">กลุ่มสาระการเรียนรู้</td>
            <td className="pp5-cover-val" colSpan={5}>
              {info.learningAreaName ?? blank}
            </td>
          </tr>
          <tr>
            <td className="pp5-cover-lbl">สาระการเรียนรู้</td>
            <td className="pp5-cover-val" colSpan={5}>
              <span className="pp5-cover-check">
                {isCore ? checked : unchecked} พื้นฐาน
              </span>
              <span className="pp5-cover-check">
                {isAdditional ? checked : unchecked} เพิ่มเติม
              </span>
            </td>
          </tr>
          <tr>
            <td className="pp5-cover-lbl">ระดับชั้น</td>
            <td className="pp5-cover-val" colSpan={5}>
              <span className="pp5-cover-check">
                {info.isPrimaryLevel ? checked : unchecked} ประถมศึกษา
              </span>
              <span className="pp5-cover-check">
                {info.isSecondaryLevel ? checked : unchecked} มัธยมศึกษา
              </span>
            </td>
          </tr>
          <tr>
            <td className="pp5-cover-lbl">หน่วยกิต</td>
            <td className="pp5-cover-val">
              {info.creditHours ?? "—"} หน่วย
            </td>
            <td className="pp5-cover-lbl">เวลาเรียน</td>
            <td className="pp5-cover-val">
              {info.hoursPerWeek || "—"} ชม./สัปดาห์
            </td>
            <td className="pp5-cover-lbl">รวมเวลาเรียน</td>
            <td className="pp5-cover-val">
              {/* ประถม นับเวลาเรียนเป็นรายปี (= 2 ภาคเรียน) ส่วนมัธยมนับเป็นรายภาค.
                  totalHoursPerSemester = hoursPerWeek × 20 (1 ภาคเรียน). */}
              {info.isPrimaryLevel
                ? `${info.totalHoursPerSemester * 2 || "—"} ชม./ปี`
                : `${info.totalHoursPerSemester || "—"} ชม./ภาค`}
            </td>
          </tr>
          <tr>
            <td className="pp5-cover-lbl">ครูผู้สอน</td>
            <td className="pp5-cover-val" colSpan={5}>
              {info.teacherLabel}
            </td>
          </tr>
          <tr>
            <td className="pp5-cover-lbl">ครูประจำชั้น</td>
            <td className="pp5-cover-val" colSpan={5}>
              {info.homeroomLabel ?? blank}
            </td>
          </tr>
        </tbody>
      </table>

      {/* สรุปผลการเรียน — grade distribution */}
      <h3 className="pp5-cover-section">สรุปผลการเรียน</h3>
      <table className="pp5-cover-table">
        <thead>
          <tr>
            <th rowSpan={2} className="pp5-cover-rowhead">
              จำนวน
              <br />
              นักเรียน
            </th>
            <th colSpan={10} className="pp5-cover-group">
              จำนวนนักเรียนที่ได้ระดับผลการเรียน
            </th>
            <th rowSpan={2}>
              ผ่าน
              <br />
              การประเมิน
            </th>
            <th rowSpan={2}>
              ไม่ผ่าน
              <br />
              การประเมิน
            </th>
          </tr>
          <tr>
            <th>4</th>
            <th>3.5</th>
            <th>3</th>
            <th>2.5</th>
            <th>2</th>
            <th>1.5</th>
            <th>1</th>
            <th>0</th>
            <th>ร</th>
            <th>มส</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>{studentCount}</td>
            <td>{gradeBuckets.g4}</td>
            <td>{gradeBuckets.g35}</td>
            <td>{gradeBuckets.g3}</td>
            <td>{gradeBuckets.g25}</td>
            <td>{gradeBuckets.g2}</td>
            <td>{gradeBuckets.g15}</td>
            <td>{gradeBuckets.g1}</td>
            <td>{gradeBuckets.g0}</td>
            <td>{gradeBuckets.rr}</td>
            <td>{gradeBuckets.ms}</td>
            <td>{gradeBuckets.pass}</td>
            <td>{gradeBuckets.fail}</td>
          </tr>
          <tr>
            <td className="pp5-cover-pctlabel">คิดเป็นร้อยละ</td>
            <td>{pct(gradeBuckets.g4, studentCount)}</td>
            <td>{pct(gradeBuckets.g35, studentCount)}</td>
            <td>{pct(gradeBuckets.g3, studentCount)}</td>
            <td>{pct(gradeBuckets.g25, studentCount)}</td>
            <td>{pct(gradeBuckets.g2, studentCount)}</td>
            <td>{pct(gradeBuckets.g15, studentCount)}</td>
            <td>{pct(gradeBuckets.g1, studentCount)}</td>
            <td>{pct(gradeBuckets.g0, studentCount)}</td>
            <td>{pct(gradeBuckets.rr, studentCount)}</td>
            <td>{pct(gradeBuckets.ms, studentCount)}</td>
            <td>{pct(gradeBuckets.pass, studentCount)}</td>
            <td>{pct(gradeBuckets.fail, studentCount)}</td>
          </tr>
        </tbody>
      </table>

      {/* สรุปผลการประเมิน — eval distribution */}
      <h3 className="pp5-cover-section">สรุปผลการประเมิน</h3>
      <table className="pp5-cover-table">
        <thead>
          <tr>
            <th rowSpan={2} className="pp5-cover-rowhead">
              จำนวน
              <br />
              นักเรียน
            </th>
            <th colSpan={6} className="pp5-cover-group">
              คุณลักษณะอันพึงประสงค์ของสถานศึกษา
            </th>
            <th colSpan={6} className="pp5-cover-group">
              การอ่าน คิดวิเคราะห์และเขียนสื่อความ
            </th>
          </tr>
          <tr>
            <th>3</th>
            <th>2</th>
            <th>1</th>
            <th>0</th>
            <th>ผ่าน</th>
            <th>ไม่ผ่าน</th>
            <th>3</th>
            <th>2</th>
            <th>1</th>
            <th>0</th>
            <th>ผ่าน</th>
            <th>ไม่ผ่าน</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>{studentCount}</td>
            <td>{charDistribution.d3}</td>
            <td>{charDistribution.d2}</td>
            <td>{charDistribution.d1}</td>
            <td>{charDistribution.d0}</td>
            <td>
              {charDistribution.d3 +
                charDistribution.d2 +
                charDistribution.d1}
            </td>
            <td>{charDistribution.d0}</td>
            <td>{rtDistribution.d3}</td>
            <td>{rtDistribution.d2}</td>
            <td>{rtDistribution.d1}</td>
            <td>{rtDistribution.d0}</td>
            <td>
              {rtDistribution.d3 + rtDistribution.d2 + rtDistribution.d1}
            </td>
            <td>{rtDistribution.d0}</td>
          </tr>
          <tr>
            <td className="pp5-cover-pctlabel">ร้อยละ</td>
            <td>{pct(charDistribution.d3, studentCount)}</td>
            <td>{pct(charDistribution.d2, studentCount)}</td>
            <td>{pct(charDistribution.d1, studentCount)}</td>
            <td>{pct(charDistribution.d0, studentCount)}</td>
            <td>
              {pct(
                charDistribution.d3 +
                  charDistribution.d2 +
                  charDistribution.d1,
                studentCount,
              )}
            </td>
            <td>{pct(charDistribution.d0, studentCount)}</td>
            <td>{pct(rtDistribution.d3, studentCount)}</td>
            <td>{pct(rtDistribution.d2, studentCount)}</td>
            <td>{pct(rtDistribution.d1, studentCount)}</td>
            <td>{pct(rtDistribution.d0, studentCount)}</td>
            <td>
              {pct(
                rtDistribution.d3 + rtDistribution.d2 + rtDistribution.d1,
                studentCount,
              )}
            </td>
            <td>{pct(rtDistribution.d0, studentCount)}</td>
          </tr>
        </tbody>
      </table>

      {/* การอนุมัติผลการเรียน — 3 signers in row */}
      <div className="pp5-cover-approval">
        <h4 className="pp5-cover-approval-title">การอนุมัติผลการเรียน</h4>
        <div className="pp5-cover-sig-row">
          <div className="pp5-cover-sig">
            <p>ลงชื่อ ............................................</p>
            <p className="pp5-cover-sig-name">( {info.teacherLabel} )</p>
            <p>ครูผู้สอน</p>
          </div>
          <div className="pp5-cover-sig">
            <p>ลงชื่อ ............................................</p>
            <p className="pp5-cover-sig-name">
              ( {info.academicHeadName ?? "............................"} )
            </p>
            <p>หัวหน้ากลุ่มสาระการเรียนรู้</p>
          </div>
          <div className="pp5-cover-sig">
            <p>ลงชื่อ ............................................</p>
            <p className="pp5-cover-sig-name">
              ( {info.assessmentOfficerName ?? "............................"} )
            </p>
            <p>หัวหน้างานวัดและประเมินผล</p>
          </div>
        </div>
      </div>

      {/* เสนอเพื่อพิจารณา */}
      {info.deputyDirectorName && (
        <div className="pp5-cover-approval">
          <h4 className="pp5-cover-approval-title">เสนอเพื่อพิจารณา</h4>
          <div className="pp5-cover-sig-row">
            <div className="pp5-cover-sig">
              <p>ลงชื่อ ............................................</p>
              <p className="pp5-cover-sig-name">
                ( {info.deputyDirectorName} )
              </p>
              <p>รองผู้อำนวยการโรงเรียน</p>
            </div>
            <div className="pp5-cover-sig pp5-cover-sig-decision">
              <p>
                <span className="pp5-cover-check">{unchecked} อนุมัติ</span>
                <span className="pp5-cover-check">{unchecked} ไม่อนุมัติ</span>
              </p>
              <p>ลงชื่อ ............................................</p>
              <p className="pp5-cover-sig-name">( {info.directorName} )</p>
              <p>{info.directorTitle}{withSchoolPrefix(info.schoolName)}</p>
            </div>
          </div>
        </div>
      )}

      {/* No deputy director — single ผอ. signature with decision,
          centered instead of stretching full-width (user spec
          2026-06-08: "จัดกึ่งกลางจะสวยครับ") */}
      {!info.deputyDirectorName && (
        <div className="pp5-cover-approval">
          <h4 className="pp5-cover-approval-title">เสนอเพื่อพิจารณา</h4>
          <div className="pp5-cover-sig-row pp5-cover-sig-row--single">
            <div className="pp5-cover-sig pp5-cover-sig-decision">
              <p>
                <span className="pp5-cover-check">{unchecked} อนุมัติ</span>
                <span className="pp5-cover-check">{unchecked} ไม่อนุมัติ</span>
              </p>
              <p>ลงชื่อ ............................................</p>
              <p className="pp5-cover-sig-name">( {info.directorName} )</p>
              <p>{info.directorTitle}{withSchoolPrefix(info.schoolName)}</p>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

// ===================================================================
// Attendance weekly grid — full per (student × week × slot) attendance.
//
// Layout mirrors /reports/attendance-by-subject (the per-subject print
// report) so admin sees the same printable form here in the ปพ.5 bundle:
//   - 2 sub-tables × 10 weeks each (was 4 × 5 — easier on print + cleaner)
//   - 4-row header repeated per sub-table:
//       1. title with class label
//       2. รหัสวิชา · รายวิชา · ภาคเรียน · ปีการศึกษา
//       3. โรงเรียน
//       4. สังกัด
//   - Asymmetric columns to keep the wide grid less squeezed:
//       page 1 → ที่ + ชื่อ-สกุล + 10×slots cells (no summary)
//       page 2 → ที่ + 10×slots cells + สรุป (มา/ขาด/ลา/ร้อยละ)
//   - 30-row pad so the printed grid stays a fixed size even when fewer
//     students are enrolled
//   - Running hour numbers across the term: (week-1)*slotsPerWeek + slot
//
// **No signature footer here** (user spec: "ไม่เอาส่วนท้ายที่ให้ลงชื่อ").
// The cover + eval sections already carry signatures for the whole ปพ.5.
// ===================================================================

const ATTENDANCE_STATUS_LABEL: Record<"present" | "absent" | "leave", string> = {
  present: "/",
  absent: "ข",
  leave: "ล",
};

function AttendanceWeeklyGridSection({
  students,
  info,
  slotsPerWeek,
  anchorIso,
  cellsByStudent,
  countsByStudent,
  totalSlots,
  semester,
}: {
  students: Array<{
    id: string;
    student_number: number;
    student_code: string;
    first_name?: string;
    last_name?: string;
    full_label: string;
  }>;
  info: HeaderInfo;
  slotsPerWeek: number;
  anchorIso: string;
  cellsByStudent: Map<string, Map<string, "present" | "absent" | "leave">>;
  countsByStudent: Map<
    string,
    { present: number; absent: number; leave: number; pct: number }
  >;
  totalSlots: number;
  /** When set (primary 2-semester bundle), the title gets " ภาคเรียนที่ N"
   *  and the meta row shows this semester instead of info.semester. When
   *  undefined (secondary / legacy), renders exactly as before using
   *  info.semester. */
  semester?: 1 | 2;
}) {
  if (slotsPerWeek === 0 || students.length === 0) return null;
  // Effective semester for the meta row — falls back to the document-level
  // info.semester when the per-section prop is absent (legacy / secondary).
  const sectionSemester = semester ?? info.semester;

  // Compute Mon-Fri date range label per week — matches the /setup/attendance/
  // by-subject UI ("18-22 พ.ค." or cross-month "30 พ.ค. - 3 มิ.ย.").
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
  const firstMonday = (() => {
    const [y, m, d] = anchorIso.split("-").map((n) => Number.parseInt(n, 10));
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
    end.setDate(end.getDate() + 4); // Mon + 4 = Fri
    const startMonth = THAI_MONTHS[start.getMonth()];
    const endMonth = THAI_MONTHS[end.getMonth()];
    if (start.getMonth() === end.getMonth()) {
      return `${start.getDate()}-${end.getDate()} ${startMonth}`;
    }
    return `${start.getDate()} ${startMonth} - ${end.getDate()} ${endMonth}`;
  };

  // Page split — usually 2 sub-tables × 10 weeks (40 slots / page at 4
  // slots/week). When slotsPerWeek is very low (≤1, i.e. 0.5 credit_hours)
  // the whole 20 weeks fit comfortably on one A4 page, so we collapse to
  // a single sub-table (user spec 2026-05-19: "ถ้า 0.5 หน่วยกิต รวมเป็น
  // หน้าเดียวได้ไหม"). Single-page mode keeps the name column AND the
  // summary columns on the same page.
  const PAGE_RANGES: Array<[number, number]> =
    slotsPerWeek <= 1
      ? [[1, 20]]
      : [
          [1, 10],
          [11, 20],
        ];

  // Pad student rows to this many — keeps the printed grid a fixed size
  // even when fewer students are enrolled (per user spec). Expand if the
  // class has more than 30 (user spec 2026-05-19).
  const PADDED_ROW_COUNT =
    students.length === 0
      ? 30
      : Math.max(30, ...students.map((s) => s.student_number));
  // Roomy mode for ≤30 students (taller rows; same pattern as score
  // recording tables — user spec 2026-05-19).
  // 5+ slots/week = 50+ slot columns, which overflow the A4 paper-box even at
  // 14px → switch to the dense tier (10px slots + narrower lead cols). User
  // spec 2026-06-01 ("เฉพาะวิชาที่มี 5 ช่อง/สัปดาห์").
  const denseSlots = slotsPerWeek >= 5;
  const attTableClass = `att-table${denseSlots ? " att-table--dense-slots" : ""}${PADDED_ROW_COUNT === 30 ? " att-table--roomy" : ""}`;

  return (
    <>
      {PAGE_RANGES.map(([firstWeek, lastWeek], pageIdx) => {
        const rangeWeeks = Array.from(
          { length: lastWeek - firstWeek + 1 },
          (_, i) => firstWeek + i,
        );
        const rangeSlots = rangeWeeks.length * slotsPerWeek;
        // Page 1 (idx=0): ที่ + ชื่อ-สกุล + slot cells (no summary)
        // Page 2 (idx=1): ที่ only + slot cells + summary (มา/ขาด/ลา/ร้อยละ)
        // Rationale: keep wide grid less squeezed by dropping the ชื่อ column
        //   on page 2 (admin cross-refs with page 1's row order via
        //   student_number) and showing the full-term summary only on the
        //   last page.
        const isLastPage = pageIdx === PAGE_RANGES.length - 1;
        const showNameCol = pageIdx === 0;
        const showSummaryCols = isLastPage;

        return (
          <section
            key={`wkpg-${firstWeek}`}
            className="pp5-page-content pp5-page-content-wide"
          >
            {/* 2-row compact header — user spec 2026-05-19: "ส่วนหัวเอา
                โรงเรียนและสังกัด ออก". The cover page already carries the
                school identity for the whole bundle. */}
            <header className="att-page-header">
              <h1 className="att-page-title">
                แบบบันทึกเวลาเรียนรายวิชา {info.classLabel}
                {semester ? ` ภาคเรียนที่ ${semester}` : ""}
              </h1>
              <div className="att-page-meta">
                <span>
                  รหัสวิชา <strong>{info.subjectCode}</strong>
                </span>
                <span>
                  รายวิชา <strong>{info.subjectName}</strong>
                </span>
                <span>
                  ภาคเรียนที่ <strong>{sectionSemester}</strong>
                </span>
                <span>
                  ปีการศึกษา <strong>{info.yearBe}</strong>
                </span>
              </div>
            </header>

            {(() => {
              // Slot cells stretch when slotsPerWeek is small so the table
              // total stays ~178mm (~673px) on every page — primary (4
              // slots × 10 weeks) and secondary (3 slots × 10 weeks) both
              // fill the same horizontal space (user spec 2026-05-19:
              // "ถ้าหน่วยกิตลดลงให้ขยายช่องแต่ละวัน").
              const TOTAL_TABLE_PX = 673;
              const NUM_PX = 18;
              const NAME_PX = 115;
              const SUM_PX = 24 * 3 + 44; // มา · ขาด · ลา · ร้อยละ
              const slotsArea =
                TOTAL_TABLE_PX -
                NUM_PX -
                (showNameCol ? NAME_PX : 0) -
                (showSummaryCols ? SUM_PX : 0);
              const slotWidthPx = slotsArea / rangeSlots;
              return (
            <table
              className={attTableClass}
              style={{ width: `${TOTAL_TABLE_PX}px` }}
            >
              <colgroup>
                <col style={{ width: `${NUM_PX}px` }} />
                {showNameCol && (
                  <col style={{ width: `${NAME_PX}px` }} />
                )}
                {Array.from({ length: rangeSlots }, (_, i) => (
                  <col
                    key={`slot-${i}`}
                    style={{ width: `${slotWidthPx}px` }}
                  />
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
                    students.find((x) => x.student_number === rowNum) ?? null;
                  const counts = s
                    ? countsByStudent.get(s.id) ?? {
                        present: 0,
                        absent: 0,
                        leave: 0,
                        pct: 0,
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
                        <td className="att-name">{s?.full_label ?? ""}</td>
                      )}
                      {rangeWeeks.map((w) =>
                        Array.from({ length: slotsPerWeek }, (_, si) => {
                          const slot = si + 1;
                          const key = `${w}|${slot}`;
                          const status = s
                            ? cellsByStudent.get(s.id)?.get(key)
                            : undefined;
                          return (
                            <td key={`c-${w}-${slot}`}>
                              {status ? ATTENDANCE_STATUS_LABEL[status] : ""}
                            </td>
                          );
                        }),
                      )}
                      {showSummaryCols && (
                        <>
                          <td>
                            {s ? <strong>{counts?.present ?? 0}</strong> : ""}
                          </td>
                          <td>{s ? counts?.absent ?? 0 : ""}</td>
                          <td>{s ? counts?.leave ?? 0 : ""}</td>
                          <td>{pct == null ? "" : pct.toFixed(1)}</td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
              );
            })()}
            {/* NO signature footer — per user spec ("ไม่เอาส่วนท้ายที่ให้ลงชื่อ").
                The cover + eval sections already carry signatures for the
                whole ปพ.5 bundle. */}
          </section>
        );
      })}
    </>
  );
}

// ===================================================================
// Attendance summary — per student มา / ขาด / ลา / รวม / %
//
// totalSlots = หน่วยกิต × 2 × 20 (= ช่อง/สัปดาห์ × สัปดาห์/ภาค)
// % = present / totalSlots × 100 (เกณฑ์ ปพ.5 ≥ 80% มีสิทธิ์สอบ)
// ===================================================================

function AttendanceSummarySection({
  students,
  totalSlots,
  summaryByStudent,
  info,
  semester,
}: {
  students: Array<{
    id: string;
    student_number: number;
    student_code: string;
    full_label: string;
  }>;
  totalSlots: number;
  summaryByStudent: Map<
    string,
    { present: number; absent: number; leave: number; pct: number }
  >;
  /** Header info — used to render the full att-page-header (title, meta,
   *  school, สังกัด) to match the weekly grid pages right above. */
  info: HeaderInfo;
  /** When set (primary 2-semester bundle), the title gets " ภาคเรียนที่ N"
   *  and the meta row shows this semester instead of info.semester. When
   *  undefined (secondary / legacy), renders exactly as before using
   *  info.semester. `"annual"` = the merged whole-year summary (sem1+sem2). */
  semester?: 1 | 2 | "annual";
}) {
  if (totalSlots === 0 || students.length === 0) return null;
  // Effective semester for the meta row — falls back to the document-level
  // info.semester when the per-section prop is absent (legacy / secondary).
  const sectionSemester = semester ?? info.semester;
  return (
    // Uses pp5-page-content-wide so it inherits `@page pp5-bundle-weekly`
    // (15mm top, 10mm sides) — matches the weekly grid pages it follows.
    <section className="pp5-page-content pp5-page-content-wide">
      {/* Compact 2-row header — matches the weekly grid pages right above.
          School + affiliation dropped per user spec 2026-05-19 (the cover
          page already carries the school identity for the whole bundle). */}
      <header className="att-page-header">
        <h1 className="att-page-title">
          สรุปเวลาเรียนรายวิชา {info.classLabel}
          {semester === "annual"
            ? " (สรุปทั้งปี)"
            : semester
              ? ` ภาคเรียนที่ ${semester}`
              : ""}
        </h1>
        <div className="att-page-meta">
          <span>
            รหัสวิชา <strong>{info.subjectCode}</strong>
          </span>
          <span>
            รายวิชา <strong>{info.subjectName}</strong>
          </span>
          <span>
            {semester === "annual" ? (
              <strong>ทั้งปีการศึกษา</strong>
            ) : (
              <>
                ภาคเรียนที่ <strong>{sectionSemester}</strong>
              </>
            )}
          </span>
          <span>
            ปีการศึกษา <strong>{info.yearBe}</strong>
          </span>
        </div>
      </header>
      {/* Use att-table + roomy/compact modifier same as the weekly grid
          above (user spec 2026-05-19: "ถ้านักเรียนไม่ถึง 30 ให้แสดงแบบ
          เดียวกัน และเกิน 30 คน แสดงยังไง ตรวจสอบและแก้ไขด้วย"):
            ≤30 students → att-table--roomy (22px rows)
            >30 students → att-table (18px rows)
          Padded to ≥30 rows; expands when class >30 so all students show. */}
      {(() => {
        const maxStudentNum =
          students.length === 0
            ? 0
            : Math.max(...students.map((s) => s.student_number));
        const PADDED_ROW_COUNT = Math.max(30, maxStudentNum);
        const summaryTableClass = `att-table att-table--summary${maxStudentNum <= 30 ? " att-table--roomy" : ""}`;
        return (
      <table className={summaryTableClass}>
        {/* 9 columns widening to fill the printable area (~178mm / 673px)
            per user spec 2026-05-19 ("เพิ่มคอลัมภ์เลขประจำตัวนักเรียน +
            ขยายความกว้างของคอลัมภ์ต่างๆ ให้เต็มหน้ากระดาษพอดี"):
              ที่ 22 + รหัส 80 + ชื่อ 200 + มา/ขาด/ลา/เต็ม 55×4
              + % 70 + สิทธิ์สอบ 80 = 672px ≈ 178mm */}
        <colgroup>
          <col style={{ width: "22px" }} />
          <col style={{ width: "80px" }} />
          <col style={{ width: "200px" }} />
          <col style={{ width: "55px" }} />
          <col style={{ width: "55px" }} />
          <col style={{ width: "55px" }} />
          <col style={{ width: "55px" }} />
          <col style={{ width: "70px" }} />
          <col style={{ width: "80px" }} />
        </colgroup>
        <thead>
          <tr>
            <th>ที่</th>
            <th>รหัสประจำตัว</th>
            <th>ชื่อ – สกุล</th>
            <th>มา</th>
            <th>ขาด</th>
            <th>ลา</th>
            <th>เต็ม</th>
            <th>%</th>
            <th>สิทธิ์สอบ</th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: PADDED_ROW_COUNT }, (_, i) => {
            const rowNum = i + 1;
            const s =
              students.find((x) => x.student_number === rowNum) ?? null;
            const sum = s
              ? summaryByStudent.get(s.id) ?? {
                  present: 0,
                  absent: 0,
                  leave: 0,
                  pct: 0,
                }
              : null;
            return (
              <tr key={`r-${rowNum}`}>
                <td>{rowNum}</td>
                <td>{s?.student_code ?? ""}</td>
                <td className="att-name">{s?.full_label ?? ""}</td>
                <td>{s ? sum?.present ?? 0 : ""}</td>
                <td>{s ? sum?.absent ?? 0 : ""}</td>
                <td>{s ? sum?.leave ?? 0 : ""}</td>
                <td>{s ? totalSlots : ""}</td>
                <td>
                  {s ? <strong>{sum?.pct ?? 0}%</strong> : ""}
                </td>
                <td>
                  {s ? (
                    <strong>{(sum?.pct ?? 0) >= 80 ? "มี" : "ไม่มี"}</strong>
                  ) : (
                    ""
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
        );
      })()}
    </section>
  );
}

// ===================================================================
// Eval section — characteristics + reading-thinking + competency
//
// Renders the student's "ภาพรวม" (global) eval data for the current
// (year, semester). Marked "ภาพรวม" in each table header so admin knows
// the score is the student-wide value, not per-subject. When the per-
// subject eval refactor lands (option A), this section will prefer
// offering-bound rows and fall back to global.
// ===================================================================

function scoreToLabel(score: number | null | undefined): string {
  if (score == null) return "—";
  if (score >= 3) return "3";
  if (score >= 2) return "2";
  if (score >= 1) return "1";
  return "0";
}

/** Average → สพฐ summary label */
function summaryFromAvg(avg: number | null): string {
  if (avg == null) return "—";
  if (avg >= 2.5) return "ดีเยี่ยม";
  if (avg >= 1.5) return "ดี";
  if (avg >= 0.5) return "ผ่าน";
  return "ไม่ผ่าน";
}

function avgOf(nums: Array<number | null | undefined>): number | null {
  const valid = nums.filter((n): n is number => typeof n === "number");
  if (valid.length === 0) return null;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

export function EvalSection({
  students,
  characteristics,
  charEvalMap,
  readingThinkingByStudent,
  competencyByStudent,
  info,
  signers,
  show = {
    characteristics: true,
    reading: true,
    competency: true,
  },
}: {
  students: Array<{
    id: string;
    student_number: number;
    full_label: string;
  }>;
  characteristics: Array<{ id: string; name: string; sort_order: number }>;
  charEvalMap: Map<string, Map<string, number>>;
  readingThinkingByStudent: Map<
    string,
    {
      reading: number | null;
      thinking: number | null;
      writing: number | null;
    }
  >;
  competencyByStudent: Map<
    string,
    {
      communication: number | null;
      thinking: number | null;
      problem_solving: number | null;
      life_skills: number | null;
      technology: number | null;
    }
  >;
  /** Header info — used to render the per-section header (school, class,
   *  semester) that mirrors the standalone /reports/student-eval page. */
  info: HeaderInfo;
  /** Footer signer list — built in the parent (homeroom teachers + school
   *  officials). Each filled homeroom slot gets its own signature block. */
  signers: Array<{ name: string; role: string }>;
  /** Per-table visibility — driven by `parts=...` URL param on /reports/pp5.
   *  When a flag is false, that table is skipped entirely. */
  show?: {
    characteristics: boolean;
    reading: boolean;
    competency: boolean;
  };
}) {
  if (students.length === 0) return null;
  if (!show.characteristics && !show.reading && !show.competency) {
    return null;
  }
  return (
    <>
      {/* คุณลักษณะอันพึงประสงค์ — header layout per user spec 2026-05-19:
          line 1 = "ข้อที่ N" (bold, ~10px)
          line 2 = full name (~9px, single line, truncated with … if it
                              exceeds the column width)
          Column widths are governed by EvalReportPage's <colgroup> +
          table-layout: fixed (NOT by headerStyle.width — that would
          conflict with colgroup and cause unequal widths in some browsers).
          headerStyle here only carries the multi-line tweaks. */}
      {show.characteristics && (
        <EvalReportPage
          title="สรุปผลการประเมินคุณลักษณะอันพึงประสงค์"
          info={info}
          signers={signers}
          compact
          students={students}
          columns={characteristics.map((c) => ({
            key: c.id,
            label: (
              <>
                <div style={{ fontSize: "10px", fontWeight: 600 }}>
                  ข้อที่ {c.sort_order}
                </div>
                <div
                  style={{
                    fontSize: "9px",
                    fontWeight: 400,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                  title={c.name}
                >
                  {c.name}
                </div>
              </>
            ),
            headerStyle: {
              verticalAlign: "top",
              lineHeight: 1.2,
            },
          }))}
          scoresByStudent={(() => {
            const out = new Map<string, Array<number | null>>();
            for (const s of students) {
              const inner = charEvalMap.get(s.id);
              out.set(
                s.id,
                characteristics.map((c) => inner?.get(c.id) ?? null),
              );
            }
            return out;
          })()}
        />
      )}

      {/* อ่าน คิดวิเคราะห์ เขียน — widths from colgroup; no headerStyle.width. */}
      {show.reading && (
        <EvalReportPage
          title="สรุปผลการประเมินการอ่าน คิดวิเคราะห์ และเขียน"
          info={info}
          signers={signers}
          compact
          students={students}
          columns={[
            { key: "reading", label: "การอ่าน" },
            { key: "thinking", label: "คิดวิเคราะห์" },
            { key: "writing", label: "การเขียน" },
          ]}
          scoresByStudent={(() => {
            const out = new Map<string, Array<number | null>>();
            for (const s of students) {
              const r = readingThinkingByStudent.get(s.id);
              out.set(s.id, [
                r?.reading ?? null,
                r?.thinking ?? null,
                r?.writing ?? null,
              ]);
            }
            return out;
          })()}
        />
      )}

      {/* สมรรถนะสำคัญ — widths from colgroup; no headerStyle.width. */}
      {show.competency && (
        <EvalReportPage
          title="สรุปผลการประเมินสมรรถนะสำคัญของผู้เรียน"
          info={info}
          signers={signers}
          compact
          students={students}
          columns={[
            { key: "communication", label: "สื่อสาร" },
            { key: "thinking", label: "คิด" },
            { key: "problem_solving", label: "แก้ปัญหา" },
            { key: "life_skills", label: "ทักษะชีวิต" },
            { key: "technology", label: "เทคโนโลยี" },
          ]}
          scoresByStudent={(() => {
            const out = new Map<string, Array<number | null>>();
            for (const s of students) {
              const c = competencyByStudent.get(s.id);
              out.set(s.id, [
                c?.communication ?? null,
                c?.thinking ?? null,
                c?.problem_solving ?? null,
                c?.life_skills ?? null,
                c?.technology ?? null,
              ]);
            }
            return out;
          })()}
        />
      )}
    </>
  );
}

// ===================================================================
// EvalReportPage — one "page" of the evaluation section (chars / reading /
// competency). Mirrors the layout of /reports/student-eval/page.tsx so the
// pp5 bundle prints these evals identically to the standalone print page.
//
// Per user spec (2026-05-19):
//   "การประเมินคุณลักษณะ การอ่าน คิดวิเคราะห์และเขียน และสมรรถนะสำคัญ
//    ยึดตามที่ทำในหน้าการพิมพ์รายงานของแต่ละอัน"
//
// Each call renders one full "page": header block (logo + title + school +
// class/semester line), 30-row padded table, optional legend below, and
// footer with signature blocks. Wrapped in `.pp5-page-content` so it starts
// on a new printed page (CSS `.pp5-page-content + .pp5-page-content`).
// ===================================================================

function EvalReportPage({
  title,
  info,
  signers,
  students,
  columns,
  scoresByStudent,
  legendText,
  compact = false,
}: {
  title: string;
  info: HeaderInfo;
  signers: Array<{ name: string; role: string }>;
  students: Array<{
    id: string;
    student_number: number;
    full_label: string;
  }>;
  columns: Array<{
    key: string;
    label: React.ReactNode;
    /** Inline style applied to the column's <th>. Used by characteristics
     *  to set equal width + multi-line wrapping; other eval types omit. */
    headerStyle?: React.CSSProperties;
  }>;
  /** One score per column per student. `null` = no record. */
  scoresByStudent: Map<string, Array<number | null>>;
  /** Legend text printed below the table — kept for backward compat but
   *  no longer used for characteristics (the column headers now carry the
   *  full names, making the legend redundant). */
  legendText?: string;
  /** When true (used in the ปพ.5 รายวิชา bundle), hide the school logo and
   *  the signature footer. The cover page handles both for the whole
   *  bundle, so repeating them on each eval section is redundant (user
   *  spec 2026-05-19: "เอาโลโก้ และที่ลงชื่อท้ายกระดาษออก (เฉพาะ พิมพ์
   *  ปพ.5 รายวิชานะ)"). Standalone /reports/student-eval passes false. */
  compact?: boolean;
}) {
  // Pad to ≥30 rows for binding; expand to fit if class > 30 students.
  const PADDED_ROW_COUNT =
    students.length === 0
      ? 30
      : Math.max(30, ...students.map((s) => s.student_number));
  // Column width allocation (see colgroup below). Hoisted out of JSX so
  // the value is computed once + the table tree stays flat — earlier we
  // wrapped the table in an IIFE which made React's reconciliation order
  // harder to follow when debugging the print layout.
  const dataPct = columns.length > 0 ? 55 / columns.length : 0;
  return (
    <section
      className={`pp5-page-content${compact ? " pp5-page-content-eval-bundle" : ""}`}
    >
      {/* Header — mirrors the standalone print page exactly: centered
          logo + title + school name, then a meta line with class + scope
          (ทั้งปี for primary, ภาคเรียนที่ N for secondary) + year. */}
      <header className="pp5-header pp5-header--eval">
        <div className="pp5-title">
          {!compact && info.logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={info.logoUrl}
              alt="โลโก้โรงเรียน"
              className="pp5-header-logo"
            />
          )}
          <h1>{title}</h1>
          {!compact && (
            <p className="pp5-school-name">{withSchoolPrefix(info.schoolName)}</p>
          )}
        </div>
        <p className="pp5-meta-line">
          <span>{info.classLabel}</span>
          <span>
            {/* Primary uses annual scope → "ทั้งปี"; secondary shows term. */}
            {info.isPrimaryLevel ? (
              <strong>ทั้งปี</strong>
            ) : (
              <>
                ภาคเรียนที่ <strong>{info.semester}</strong>
              </>
            )}{" "}
            ปีการศึกษา <strong>{info.yearBe}</strong>
          </span>
        </p>
      </header>

      {/* 30-row padded table. Width budget allocated via <colgroup> +
          `table-layout: fixed` so the columns sum to exactly 100% — fixes
          the right-edge overflow the auto-layout caused when the data
          column %s + name min-width together exceeded the table width.
          User spec 2026-05-19: "ช่อง 3 ช่องกว้างเกินไป และช่องสรุปสุดท้าย
          ก็เล็กเกินไปและหลุดออกกระดาษทางขวา".
            # = 5%, ชื่อ-สกุล = 26%, data cols = 55/N % each, สรุป = 14% */}
      <table
        className={`pp5-table${PADDED_ROW_COUNT === 30 ? " pp5-table--roomy" : ""}`}
        style={{ tableLayout: "fixed" }}
      >
        <colgroup>
          <col style={{ width: "5%" }} />
          <col style={{ width: "26%" }} />
          {columns.map((col) => (
            <col key={col.key} style={{ width: `${dataPct}%` }} />
          ))}
          <col style={{ width: "14%" }} />
        </colgroup>
        <thead>
          <tr>
            <th>ที่</th>
            <th>ชื่อ – สกุล</th>
            {columns.map((col) => (
              <th key={col.key} style={col.headerStyle}>
                {col.label}
              </th>
            ))}
            <th>สรุป</th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: PADDED_ROW_COUNT }, (_, i) => {
            const rowNum = i + 1;
            const s =
              students.find((x) => x.student_number === rowNum) ?? null;
            const scores = s
              ? (scoresByStudent.get(s.id) ?? columns.map(() => null))
              : [];
            return (
              <tr key={`r-${rowNum}`}>
                <td>{rowNum}</td>
                <td className="pp5-name">{s?.full_label ?? ""}</td>
                {columns.map((col, idx) => (
                  <td key={col.key}>
                    {s ? scoreToLabel(scores[idx] ?? null) : ""}
                  </td>
                ))}
                <td>
                  {s ? (
                    <strong>{evalLevelLabel(overallEvalLevel(scores))}</strong>
                  ) : (
                    ""
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Legend — characteristics only (table uses numeric headers; full
          names go here). Other eval types have self-explanatory labels. */}
      {legendText && <p className="pp5-legend-small">{legendText}</p>}

      {/* Footer — homeroom teacher(s) + assessment officer + (deputy) +
          director. Same line-up as /reports/student-eval/page.tsx footer.
          Hidden in compact mode (pp5 bundle) — the cover carries the
          bundle's signatures. */}
      {!compact && (
        <footer className="pp5-footer">
          {signers.map((s, i) => (
            <div key={i} className="pp5-sig-block">
              <p>ลงชื่อ .....................................</p>
              <p className="pp5-sig-name">( {s.name} )</p>
              <p>{s.role}</p>
            </div>
          ))}
        </footer>
      )}
    </section>
  );
}

// ===================================================================
// Selector — รับ admin จาก sidebar "พิมพ์เล่มรายงาน → ปพ.5 รายวิชา"
//
// แสดงหน้าเลือก ห้อง × วิชา × ภาค → กดปุ่มเปิดรายงานในแท็บเดียวกัน
// (params ครบจะ render เป็นใบรายงานเลย).
// ===================================================================

async function Pp5Selector() {
  const supabase = await createClient();

  // Teacher scope — Phase 2 filter. Restrict the dropdown to classrooms
  // and subjects the teacher actually teaches. Admin = null = no filter.
  const scope = await getTeacherScope();

  // Build classroom_id → Set of subject_ids the teacher teaches there
  // (used to filter both classroomOptions and per-classroom subjects).
  const teacherSubjectsByClassroom = new Map<string, Set<string>>();
  if (scope) {
    const { data: myOfferings } = await supabase
      .from("subject_offerings")
      .select("classroom_id, subject_id")
      .eq("teacher_id", scope.teacherId);
    for (const o of myOfferings ?? []) {
      if (!teacherSubjectsByClassroom.has(o.classroom_id)) {
        teacherSubjectsByClassroom.set(o.classroom_id, new Set());
      }
      teacherSubjectsByClassroom.get(o.classroom_id)!.add(o.subject_id);
    }
  }

  // current year for default semester display + scope subjects
  const { data: currentYear } = await supabase
    .from("academic_years")
    .select("id, year_be, current_semester")
    .eq("is_current", true)
    .maybeSingle();

  const defaultSemester: 1 | 2 = currentYear?.current_semester === 2 ? 2 : 1;

  // Pull every classroom in the current year with grade info — admin picks
  // grade → room → subject via cascading dropdowns rendered client-side.
  const { data: classroomRows } = currentYear
    ? await supabase
        .from("classrooms")
        .select(
          `
          id,
          room_number,
          study_plan_id,
          grade_level:grade_levels!grade_level_id (
            id,
            name_short,
            sort_order,
            system
          )
        `,
        )
        .eq("academic_year_id", currentYear.id)
    : { data: [] };

  // For each plan, fetch its subjects (scoped to current year + sem) so the
  // selector can show the subject dropdown without an extra round-trip on
  // change. Skip activity subjects (no credit_hours → no attendance grid).
  const planIds = Array.from(
    new Set(
      (classroomRows ?? [])
        .map((c) => c.study_plan_id)
        .filter((id): id is string => !!id),
    ),
  );

  type SubjectInfo = {
    id: string;
    code: string;
    name_th: string;
    semester: 0 | 1 | 2;
    grading_mode: "numeric" | "pass_fail";
    /** Sort key: core=1 · additional=2 · activity=3 */
    category: "core" | "additional" | "activity";
    /** learning_areas.sort_order — ภาษาไทย=1, คณิตศาสตร์=2, ฯลฯ */
    learning_area_sort: number;
  };

  const subjectsByPlan = new Map<string, SubjectInfo[]>();
  if (planIds.length > 0 && currentYear) {
    const { data: planSubjectRows } = await supabase
      .from("study_plan_subjects")
      .select(
        `
        study_plan_id,
        subject:subjects!subject_id (
          id,
          code,
          name_th,
          semester,
          academic_year_id,
          grading_mode,
          category,
          learning_area:learning_areas!learning_area_id (sort_order)
        )
      `,
      )
      .in("study_plan_id", planIds);
    for (const r of planSubjectRows ?? []) {
      if (!r.subject) continue;
      if (r.subject.academic_year_id !== currentYear.id) continue;
      const sem = r.subject.semester;
      if (sem !== 0 && sem !== 1 && sem !== 2) continue;
      const list = subjectsByPlan.get(r.study_plan_id) ?? [];
      list.push({
        id: r.subject.id,
        code: r.subject.code,
        name_th: r.subject.name_th,
        semester: sem as 0 | 1 | 2,
        grading_mode: r.subject.grading_mode,
        category: r.subject.category,
        learning_area_sort: r.subject.learning_area?.sort_order ?? 999,
      });
      subjectsByPlan.set(r.study_plan_id, list);
    }
  }

  // Build classroom → { grade, room, planId, subjects } map
  type ClassroomOption = {
    id: string;
    label: string;
    grade_id: string;
    grade_label: string;
    grade_sort: number;
    system: "primary" | "secondary";
    subjects: SubjectInfo[];
  };

  // Multi-room detection per grade → only suffix "/N" when the grade has 2+
  // rooms, so single-room grades show "ป.1" not "ป.1/1" (matches report
  // headers + pp6/pp5-class selectors). User spec 2026-06-05.
  const roomCountByGrade = new Map<string, number>();
  for (const c of classroomRows ?? []) {
    if (!c.grade_level) continue;
    const k = c.grade_level.id;
    roomCountByGrade.set(k, (roomCountByGrade.get(k) ?? 0) + 1);
  }

  const classroomOptions: ClassroomOption[] = (classroomRows ?? [])
    .filter((c) => c.grade_level)
    .filter((c) => {
      // Teacher filter — drop classrooms where teacher has no offerings
      if (!scope) return true;
      return teacherSubjectsByClassroom.has(c.id);
    })
    .map((c): ClassroomOption => {
      const planSubjects = c.study_plan_id
        ? (subjectsByPlan.get(c.study_plan_id) ?? [])
        : [];
      // Teacher filter — keep only subjects the teacher has an offering for
      const visibleSubjects = scope
        ? planSubjects.filter((s) =>
            teacherSubjectsByClassroom.get(c.id)?.has(s.id),
          )
        : planSubjects;
      return {
        id: c.id,
        label:
          (roomCountByGrade.get(c.grade_level!.id) ?? 0) > 1
            ? `${c.grade_level!.name_short}/${c.room_number}`
            : c.grade_level!.name_short,
        grade_id: c.grade_level!.id,
        grade_label: c.grade_level!.name_short,
        grade_sort: c.grade_level!.sort_order,
        system:
          c.grade_level!.system === "secondary" ? "secondary" : "primary",
        subjects: visibleSubjects,
      };
    })
    .filter((c) => !scope || c.subjects.length > 0) // hide empty classrooms
    .sort((a, b) => {
      if (a.grade_sort !== b.grade_sort) return a.grade_sort - b.grade_sort;
      return a.label.localeCompare(b.label, "th");
    });

  // Full-bleed layout: the selector form provides its own split-pane shell.
  // For the error/empty states we keep a small centered card.
  if (!currentYear) {
    return (
      <main className="mx-auto max-w-3xl p-8">
        <h1 className="text-xl font-bold text-zinc-900">
          พิมพ์รายงาน ปพ.5 รายวิชา
        </h1>
        <div className="mt-6 rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          ⚠️ ยังไม่มีปีการศึกษาปัจจุบัน ·{" "}
          <Link
            href="/setup/academic-years"
            className="font-medium underline"
          >
            ไปตั้งค่าปีการศึกษา
          </Link>
        </div>
      </main>
    );
  }
  if (classroomOptions.length === 0) {
    return (
      <main className="mx-auto max-w-3xl p-8">
        <h1 className="text-xl font-bold text-zinc-900">
          พิมพ์รายงาน ปพ.5 รายวิชา
        </h1>
        <div className="mt-6 rounded-md border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-600">
          ยังไม่มีห้องเรียนในปีนี้
        </div>
      </main>
    );
  }
  return (
    <Pp5SelectorForm
      classrooms={classroomOptions}
      defaultSemester={defaultSemester}
    />
  );
}

// ===================================================================
// Helpers
// ===================================================================

function notFoundPage(message: string) {
  return (
    <main className="mx-auto max-w-3xl p-8 text-sm text-zinc-700">
      <p>⚠️ {message}</p>
      <p className="mt-2">
        <Link
          href="/setup/score-structure"
          className="font-medium underline"
        >
          กลับไปหน้าบันทึกคะแนน
        </Link>
      </p>
    </main>
  );
}
