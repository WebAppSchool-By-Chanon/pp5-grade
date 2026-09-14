import { createAdminClient } from "@pp5/database/admin";
import { createClient } from "@pp5/database/server";
import { Card, PageHeader } from "@pp5/ui";
import { BookOpen, Loader2 } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { getCurrentTerm } from "@/lib/current-term";
import { loadLinkedSubjectAttendance } from "@/lib/subject-attendance-link";
import { getTeacherScope } from "@/lib/teacher-scope";
import { DirectPrintButton } from "../../../_components/direct-print-button";
import { FilterNavProvider } from "../../_components/filter-nav-context";
import { FilterNavGate } from "../../_components/filter-nav-gate";
import { OptimisticTabs } from "../../_components/optimistic-tabs";
import { BySubjectSelector } from "./selector";
import { SubjectScheduleButton } from "./subject-schedule-button";
import {
  SubjectAttendanceGrid,
  type SubjectStudentRow,
} from "./subject-attendance-grid";
import { formatWeekRangeLabel, resolveAnchorIso } from "./term-weeks";

export const metadata = {
  title: "ระบบบันทึกผลการเรียนออนไลน์",
};

// Force dynamic + no-store on every visit. Without these, navigating away
// and back can serve a Router-Cache snapshot taken BEFORE the user's latest
// save action ran on the server — so the just-recorded ✓/ข/ล cells look like
// they "disappeared" even though the DB row is there. The action also calls
// revalidatePath() + the client calls router.refresh(), but Router Cache for
// the previously-visited URL isn't always cleared by those alone in Next.js 16.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

// Subject category sort order — same as /setup/subjects + /setup/teaching
const CATEGORY_ORDER: Record<string, number> = {
  core: 1,
  additional: 2,
  activity: 3,
};

/** Total weeks per ภาคเรียน per ปพ.5 standard. */
const TOTAL_WEEKS = 20;

/** Each tab covers 5 consecutive weeks → 4 tabs total. */
type WeekTab = "1" | "2" | "3" | "4";

const WEEK_RANGE_BY_TAB: Record<WeekTab, [number, number]> = {
  "1": [1, 5],
  "2": [6, 10],
  "3": [11, 15],
  "4": [16, 20],
};

const TAB_LABEL_BY_TAB: Record<WeekTab, string> = {
  "1": "สัปดาห์ที่ 1-5",
  "2": "สัปดาห์ที่ 6-10",
  "3": "สัปดาห์ที่ 11-15",
  "4": "สัปดาห์ที่ 16-20",
};

function abbreviateTitle(title: string | null | undefined): string {
  if (!title) return "";
  if (title === "เด็กชาย") return "ด.ช.";
  if (title === "เด็กหญิง") return "ด.ญ.";
  if (title === "นางสาว") return "น.ส.";
  return title;
}

type Props = {
  searchParams: Promise<{
    grade?: string;
    room?: string;
    subject?: string;
    tab?: string;
  }>;
};

export default async function BySubjectPage({ searchParams }: Props) {
  const params = await searchParams;
  const supabase = await createClient();

  // 1. Current academic year + current semester + term anchors
  //
  // start_date  = วันเริ่มภาคเรียนที่ 1  (admin-configurable; fallback 16 พ.ค.)
  // end_date    = วันเริ่มภาคเรียนที่ 2  (admin-configurable; fallback 1 พ.ย.)
  // Both feed `resolveAnchorIso` to determine the Monday of week 1.
  const { data: currentYear } = await supabase
    .from("academic_years")
    .select("id, year_be, current_semester, start_date, end_date")
    .eq("is_current", true)
    .maybeSingle();

  if (!currentYear) {
    return (
      <>
        <PageHeader
          icon={BookOpen}
          iconBg="bg-indigo-100 text-indigo-700"
          title="บันทึกเวลาเรียนรายวิชา"
          description="บันทึกการเข้าเรียนต่อ (วิชา × สัปดาห์) ตามมาตรฐาน ปพ.5"
        />
        <Card variant="warning" padding="sm" className="text-sm text-amber-900">
          ⚠️ ยังไม่มีปีการศึกษาปัจจุบัน ·{" "}
          <Link
            href="/setup/academic-years"
            className="font-medium underline"
          >
            ไปตั้งค่าปีการศึกษา
          </Link>
        </Card>
      </>
    );
  }
  const currentTerm = await getCurrentTerm();
  const currentSemester: 1 | 2 = currentTerm?.semester ?? 1;

  // Teacher scope — show only classrooms where teacher has subject offerings.
  const scope = await getTeacherScope();

  // 2. Classrooms in current year (for grade + room selectors)
  //    + study_plan_id so we can list the FULL plan's subjects (not just
  //    those with an offering already).
  const { data: classroomsRaw } = await supabase
    .from("classrooms")
    .select(
      `
      id,
      room_number,
      grade_level_id,
      study_plan_id,
      grade_level:grade_levels!grade_level_id (
        id,
        name_short,
        sort_order,
        system
      )
    `,
    )
    .eq("academic_year_id", currentYear.id);

  const classrooms = scope
    ? (classroomsRaw ?? []).filter((c) =>
        scope.teachingClassroomIds.has(c.id),
      )
    : classroomsRaw;

  type Grade = {
    id: string;
    name_short: string;
    sort_order: number;
    system: "primary" | "secondary";
  };
  const gradeMap = new Map<string, Grade>();
  for (const c of classrooms ?? []) {
    if (c.grade_level && !gradeMap.has(c.grade_level.id)) {
      gradeMap.set(c.grade_level.id, {
        id: c.grade_level.id,
        name_short: c.grade_level.name_short,
        sort_order: c.grade_level.sort_order,
        system:
          c.grade_level.system === "secondary" ? "secondary" : "primary",
      });
    }
  }
  const sortedGrades = Array.from(gradeMap.values()).sort(
    (a, b) => a.sort_order - b.sort_order,
  );

  if (sortedGrades.length === 0) {
    return (
      <>
        <PageHeader
          icon={BookOpen}
          iconBg="bg-indigo-100 text-indigo-700"
          title="บันทึกเวลาเรียนรายวิชา"
          description={`ปีปัจจุบัน ${currentYear.year_be}`}
        />
        <Card variant="dashed" className="p-12 text-center">
          <p className="text-sm text-zinc-500">
            ยังไม่มีห้องเรียนในปีนี้ — สร้างห้อง + จัดครูเข้าสอนก่อน
          </p>
        </Card>
      </>
    );
  }

  // 3. Resolve grade — select-first: no auto-pick, the admin must choose.
  const selectedGrade = params.grade
    ? (sortedGrades.find((g) => g.id === params.grade) ?? null)
    : null;

  // Rooms — single-room auto-picks; multi-room waits.
  const roomsInGrade = selectedGrade
    ? (classrooms ?? [])
        .filter((c) => c.grade_level_id === selectedGrade.id)
        .sort((a, b) => a.room_number - b.room_number)
    : [];
  const selectedClassroom = params.room
    ? (roomsInGrade.find((r) => r.id === params.room) ?? null)
    : roomsInGrade.length === 1
      ? roomsInGrade[0]
      : null;

  // EARLY GUARD — pick ชั้น (+ ห้อง) before fetching subjects/offerings or
  // doing any slot/week math. Everything below depends on a chosen room.
  if (!selectedGrade || !selectedClassroom) {
    return (
      <>
        <PageHeader
          icon={BookOpen}
          iconBg="bg-indigo-100 text-indigo-700"
          title="บันทึกเวลาเรียนรายวิชา"
          description={
            <>
              เช็คเวลาเรียนต่อ (วิชา × สัปดาห์) ตามมาตรฐาน ปพ.5 · ปีปัจจุบัน{" "}
              <strong className="font-mono">{currentYear.year_be}</strong>
            </>
          }
        />
        <FilterNavProvider>
          <Card padding="sm" className="mb-4">
            <BySubjectSelector
              grades={sortedGrades.map((g) => ({ id: g.id, label: g.name_short }))}
              selectedGradeId={selectedGrade?.id ?? ""}
              rooms={roomsInGrade.map((r) => ({
                id: r.id,
                label: `${selectedGrade!.name_short}/${r.room_number}`,
              }))}
              selectedRoomId=""
              subjects={[]}
              selectedSubjectId=""
              tab={
                params.tab === "2" || params.tab === "3" || params.tab === "4"
                  ? (params.tab as WeekTab)
                  : "1"
              }
            />
          </Card>
          <FilterNavGate fallback={<GridLoadingFallback />}>
            <Card variant="dashed" className="p-12 text-center">
              <p className="text-sm text-zinc-500">
                {!selectedGrade ? "เลือกระดับชั้นก่อน" : "เลือกห้องเรียนก่อน"}
              </p>
            </Card>
          </FilterNavGate>
        </FilterNavProvider>
      </>
    );
  }

  // Past this guard, selectedGrade & selectedClassroom are non-null.
  const isPrimary = selectedGrade.system === "primary";
  // Subjects scope: primary → semester=0 (year-wide) · secondary → current
  const effectiveSemester: 0 | 1 | 2 = isPrimary ? 0 : currentSemester;

  // 4. Subjects in this room — fetched from the classroom's PLAN, not via
  //    offerings. This way the dropdown shows EVERY subject the admin added
  //    to the plan, even if no teacher is assigned yet ("ยังไม่จัดครู").
  //    Activity subjects + zero-credit subjects are still excluded
  //    (เวลาเรียนของกิจกรรมใช้ผ่าน/ไม่ผ่าน · 20 สัปดาห์ × ช่อง/สัปดาห์
  //    ต้องคำนวณจากหน่วยกิต).
  const admin = createAdminClient();
  const planId = selectedClassroom.study_plan_id;

  type PlanSubject = {
    id: string;
    code: string;
    name_th: string;
    category: "core" | "additional" | "activity";
    credit_hours: number | null;
    hours_per_year: number | null;
    learning_area_sort: number;
  };

  let planSubjects: PlanSubject[] = [];
  if (planId) {
    const { data: planRows } = await supabase
      .from("study_plan_subjects")
      .select(
        `
        subject:subjects!subject_id (
          id,
          code,
          name_th,
          category,
          credit_hours,
          hours_per_year,
          academic_year_id,
          semester,
          learning_area:learning_areas!learning_area_id (sort_order)
        )
      `,
      )
      .eq("study_plan_id", planId);

    planSubjects = (planRows ?? [])
      .map((r) => r.subject)
      .filter((s): s is NonNullable<typeof s> => !!s)
      .filter((s) => {
        // Keep core/additional only — activity subjects use the
        // separate pass/fail flow.
        if (
          s.academic_year_id !== currentYear.id ||
          s.semester !== effectiveSemester ||
          s.category === "activity"
        ) {
          return false;
        }
        // EITHER credit_hours (secondary) OR hours_per_year (primary)
        // must be set so we have a slot budget. User spec 2026-05-22:
        // ประถมต้องเช็คเวลาเรียนได้เหมือนเดิมหลังย้ายไปใช้ hours_per_year.
        return (
          (s.credit_hours != null && s.credit_hours > 0) ||
          (s.hours_per_year != null && s.hours_per_year > 0)
        );
      })
      .map((s) => ({
        id: s.id,
        code: s.code,
        name_th: s.name_th,
        category: s.category,
        credit_hours: s.credit_hours,
        hours_per_year: s.hours_per_year,
        learning_area_sort: s.learning_area?.sort_order ?? 999,
      }));
  }

  // 4b. Existing offerings at currentSemester for this classroom. STRICT
  //     match (no fallback to other semesters) to avoid stale offerings at
  //     the wrong semester (e.g., legacy data from before subjects became
  //     per-(year, semester)) showing a teacher when the current scope has
  //     none — that would hide the "ยังไม่จัดครูเข้าสอน" badge.
  //
  //     For PRIMARY: teaching's save-side mirrors the teacher across sem 1
  //     and sem 2 → reading at currentSemester returns the right teacher.
  //     For SECONDARY: subject's only valid offering is at currentSemester
  //     (= subject.semester) → other-semester rows are stale, ignore them.
  const { data: allOfferings } = await supabase
    .from("subject_offerings")
    .select("id, subject_id, semester, teacher_id")
    .eq("classroom_id", selectedClassroom.id)
    .eq("semester", currentSemester);

  const offeringBySubject = new Map<
    string,
    { id: string; teacher_id: string | null }
  >();
  for (const o of allOfferings ?? []) {
    offeringBySubject.set(o.subject_id, {
      id: o.id,
      teacher_id: o.teacher_id,
    });
  }

  // Teacher filter — only show subjects the teacher has an offering for
  const teacherFilteredSubjects = scope
    ? planSubjects.filter(
        (s) => offeringBySubject.get(s.id)?.teacher_id === scope.teacherId,
      )
    : planSubjects;

  const sortedSubjects = teacherFilteredSubjects.slice().sort((a, b) => {
    const ac = CATEGORY_ORDER[a.category] ?? 99;
    const bc = CATEGORY_ORDER[b.category] ?? 99;
    if (ac !== bc) return ac - bc;
    if (a.learning_area_sort !== b.learning_area_sort) {
      return a.learning_area_sort - b.learning_area_sort;
    }
    return a.code.localeCompare(b.code, "th");
  });

  const subjectOptions = sortedSubjects.map((s) => ({
    id: s.id,
    label: `[${s.code}] ${s.name_th}`,
    credit_hours: s.credit_hours,
    // hasTeacher = there is BOTH an offering AND a non-null teacher_id.
    // Selector renders "(ยังไม่จัดครู)" suffix when hasTeacher is false.
    hasTeacher: !!offeringBySubject.get(s.id)?.teacher_id,
  }));

  // Resolve selected subject — single auto-picks; multiple wait for a pick.
  const selectedSubject = params.subject
    ? (sortedSubjects.find((s) => s.id === params.subject) ?? null)
    : sortedSubjects.length === 1
      ? sortedSubjects[0]
      : null;

  // 4c. Auto-create offering for the selected subject if missing.
  //     teacher_id stays NULL — admin can record attendance immediately;
  //     teaching page will UPDATE the row with a teacher later.
  //     `semester` matches the school's currentSemester (= subject.semester
  //     for secondary; for primary the OTHER mirror is created lazily when
  //     admin switches term).
  let selectedOfferingId: string | null = null;
  if (selectedSubject) {
    const existing = offeringBySubject.get(selectedSubject.id);
    if (existing) {
      selectedOfferingId = existing.id;
    } else {
      const { data: created, error: createErr } = await admin
        .from("subject_offerings")
        .insert({
          classroom_id: selectedClassroom.id,
          subject_id: selectedSubject.id,
          semester: currentSemester,
          teacher_id: null,
        })
        .select("id")
        .single();
      if (!createErr && created) {
        selectedOfferingId = created.id;
      }
    }
  }

  // 5. Resolve week tab (1: 1-5, 2: 6-10, 3: 11-15, 4: 16-20)
  const tab: WeekTab =
    params.tab === "2" || params.tab === "3" || params.tab === "4"
      ? (params.tab as WeekTab)
      : "1";
  const weekRange = WEEK_RANGE_BY_TAB[tab];

  // 6. Compute slots/week — different units by (system, category).
  //    Activity is filtered out above so only core/additional matters.
  //      secondary core/additional → credit_hours × 2 (1 หน่วยกิต =
  //                                   2 ชม./สัปดาห์ × 20 สัปดาห์)
  //      primary  core/additional → hours_per_year ÷ 40 weeks
  //    e.g., ภาษาไทย ป.1 ที่ตั้ง 200 ชม./ปี → 200/40 = 5 ช่อง/สัปดาห์
  //    เท่ากับเดิมตอนที่ตั้ง credit_hours 2.5 (=5 ช่อง/สัปดาห์ × 20 ภาค).
  //    User spec 2026-05-22.
  const slotsPerWeek = !selectedSubject
    ? 0
    : isPrimary
      ? Math.max(
          1,
          Math.round((selectedSubject.hours_per_year ?? 0) / 40),
        )
      : Math.max(
          1,
          Math.round((selectedSubject.credit_hours ?? 0) * 2),
        );
  const totalSlots = slotsPerWeek * TOTAL_WEEKS;

  // 7. Build date-range labels for the 5 weeks shown in this tab.
  //    e.g., week 1 of ภาค 1 ปี 2569 → "18-22 พ.ค." (if 16 พ.ค. is Saturday)
  //    Anchor uses admin-configured dates from /setup/academic-years
  //    (start_date / end_date) — falls back to 16 พ.ค. / 1 พ.ย. if not set.
  //    The grid renders these directly under each week group header.
  const anchorIso = resolveAnchorIso(
    currentYear.year_be,
    currentSemester,
    {
      start_date: currentYear.start_date,
      end_date: currentYear.end_date,
    },
  );
  const weekLabels: string[] = [];
  for (let w = weekRange[0]; w <= weekRange[1]; w++) {
    weekLabels.push(formatWeekRangeLabel(anchorIso, w));
  }

  // Recurring schedule settings are loaded here for the settings button.
  // Query errors are tolerated so schools that have not run the migration
  // still see the old attendance grid plus a clear migration warning.
  const [scheduleResult, overrideProbe] = selectedOfferingId
    ? await Promise.all([
        supabase
          .from("subject_schedule_slots")
          .select("slot_in_week, weekday")
          .eq("offering_id", selectedOfferingId),
        supabase
          .from("subject_schedule_overrides")
          .select("id")
          .eq("offering_id", selectedOfferingId)
          .limit(1),
      ])
    : [
        { data: [], error: null },
        { data: [], error: null },
      ];
  const scheduleSchemaReady = !scheduleResult.error && !overrideProbe.error;
  const initialWeekdays: Array<number | null> = Array.from(
    { length: slotsPerWeek },
    (_, index) =>
      scheduleResult.data?.find((row) => row.slot_in_week === index + 1)
        ?.weekday ?? null,
  );

  const roomShortLabel =
    roomsInGrade.length > 1
      ? `${selectedGrade.name_short}/${selectedClassroom.room_number}`
      : selectedGrade.name_short;

  // Helper for tab URLs (preserve grade/room/subject context)
  const buildTabUrl = (nextTab: WeekTab) => {
    const p = new URLSearchParams();
    p.set("grade", selectedGrade.id);
    p.set("room", selectedClassroom.id);
    if (selectedSubject) p.set("subject", selectedSubject.id);
    p.set("tab", nextTab);
    return `/setup/attendance/by-subject?${p.toString()}`;
  };

  return (
    <>
      <PageHeader
        icon={BookOpen}
        iconBg="bg-indigo-100 text-indigo-700"
        title="บันทึกเวลาเรียนรายวิชา"
        description={
          <>
            เช็คเวลาเรียนต่อ (วิชา × สัปดาห์) ตามมาตรฐาน ปพ.5 · ปีปัจจุบัน{" "}
            <strong className="font-mono">{currentYear.year_be}</strong>
          </>
        }
      />

      {/* FilterNavProvider wraps the selector + week tabs + grid so changing
          ชั้น/ห้อง/วิชา/สัปดาห์ paints the loading state at 0ms (the grid
          swaps to <GridLoadingFallback> via <FilterNavGate>). */}
      <FilterNavProvider>
      {/* Top selector card */}
      <Card padding="sm" className="mb-4">
        <BySubjectSelector
          grades={sortedGrades.map((g) => ({
            id: g.id,
            label: g.name_short,
          }))}
          selectedGradeId={selectedGrade.id}
          rooms={roomsInGrade.map((r) => ({
            id: r.id,
            label: `${selectedGrade.name_short}/${r.room_number}`,
          }))}
          selectedRoomId={selectedClassroom.id}
          subjects={subjectOptions}
          selectedSubjectId={selectedSubject?.id ?? ""}
          tab={tab}
        />
      </Card>

      {/* For secondary — small bar pointing at /setup/academic-years for
          switching the active term (matches /setup/attendance pattern). */}
      {!isPrimary && (
        <p className="mb-2 text-xs text-zinc-500">
          กำลังแสดง{" "}
          <strong className="text-zinc-700">ภาคเรียนที่ {currentSemester}</strong>{" "}
          (ภาคเรียนปัจจุบันของโรงเรียน) ·{" "}
          <Link
            href="/setup/academic-years"
            className="font-medium text-blue-700 hover:underline"
          >
            เปลี่ยนภาคเรียนปัจจุบัน
          </Link>
        </p>
      )}

      {/* Wrap the entire body in FilterNavGate so selecting a subject
          (or changing grade/room) shows GridLoadingFallback instantly —
          previously only the inner grid branch had the gate, leaving the
          "เลือกวิชาก่อน" cards unresponsive to startNav(). */}
      <FilterNavGate fallback={<GridLoadingFallback />}>
      {/* No subject in this scope */}
      {sortedSubjects.length > 0 && !selectedSubject ? (
        <Card variant="dashed" className="p-12 text-center">
          <p className="text-sm text-zinc-500">เลือกวิชาก่อน</p>
        </Card>
      ) : !selectedSubject || !selectedOfferingId ? (
        <Card variant="dashed" className="p-12 text-center">
          <p className="text-sm text-zinc-500">
            ห้องนี้ยังไม่มีวิชาที่เข้าเงื่อนไข — ต้อง:
          </p>
          <ul className="mt-2 inline-block text-left text-xs text-zinc-500">
            <li>• มีวิชาในแผนของห้อง (ที่ /setup/subjects)</li>
            <li>• กำหนดครูเข้าสอนวิชานั้น (ที่ /setup/teaching)</li>
            <li>• ไม่ใช่วิชา &quot;กิจกรรม&quot; (กิจกรรมใช้ผ่าน/ไม่ผ่าน ไม่นับเวลา)</li>
          </ul>
        </Card>
      ) : (
        <Card padding={false} className="overflow-hidden">
          <div className="flex items-start justify-between gap-3 border-b border-zinc-200 bg-zinc-50 px-4 py-2.5">
            <div>
              <h3 className="text-sm font-semibold text-zinc-900">
                ห้อง <span className="text-indigo-700">{roomShortLabel}</span>
                {" · "}
                <span className="text-indigo-700">
                  [{selectedSubject.code}] {selectedSubject.name_th}
                </span>
              </h3>
              <p className="mt-0.5 text-xs text-zinc-500">
                {isPrimary
                  ? `${selectedSubject.hours_per_year} ชม./ปี`
                  : `${selectedSubject.credit_hours} หน่วยกิต`}{" "}
                · {slotsPerWeek} ช่อง/สัปดาห์ × {TOTAL_WEEKS} สัปดาห์ ={" "}
                {totalSlots} ช่อง/ภาค
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <SubjectScheduleButton
                offeringId={selectedOfferingId}
                slotsPerWeek={slotsPerWeek}
                initialWeekdays={initialWeekdays}
                schemaReady={scheduleSchemaReady}
              />
              <DirectPrintButton
                url={`/reports/attendance-by-subject?classroom=${selectedClassroom.id}&subject=${selectedSubject.id}&semester=${currentSemester}&embed=1`}
                title="พิมพ์ตารางเวลาเรียน 20 สัปดาห์ (ทั้งภาคเรียน)"
              />
            </div>
          </div>

          {!scheduleSchemaReady && (
            <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900">
              ฟังก์ชันเชื่อมเช็กชื่อยังไม่พร้อม — กรุณารันไฟล์ SQL{" "}
              <code className="font-mono font-semibold">
                migrations/20260914_link_daily_subject_attendance.sql
              </code>
              {" "}ใน Supabase ก่อน
            </div>
          )}

          {/* Week-range tabs — 4 tabs ครอบ 5 สัปดาห์/tab */}
          <div className="flex gap-1 border-b border-zinc-200 bg-white px-3 pt-2">
            <OptimisticTabs
              currentTab={tab}
              tabs={(["1", "2", "3", "4"] as WeekTab[]).map((id) => ({
                id,
                label: TAB_LABEL_BY_TAB[id],
                href: buildTabUrl(id),
              }))}
              activeClass="-mb-px border-b-2 border-indigo-600 px-3 py-1.5 text-sm font-semibold text-indigo-700"
              inactiveClass="-mb-px border-b-2 border-transparent px-3 py-1.5 text-sm font-medium text-zinc-600 hover:border-zinc-300 hover:text-zinc-900"
            />
          </div>

          {/* Suspense shows GridLoadingFallback while grid streams in.
              The outer FilterNavGate (above) handles the instant-skeleton
              for grade/room/subject changes. */}
          <Suspense
            key={`${selectedOfferingId}-${tab}`}
            fallback={<GridLoadingFallback />}
          >
            <GridSection
              offeringId={selectedOfferingId}
              classroomId={selectedClassroom.id}
              semester={currentSemester}
              slotsPerWeek={slotsPerWeek}
              weekRange={weekRange}
              weekLabels={weekLabels}
              anchorIso={anchorIso}
              isPrimary={isPrimary}
              totalSlots={totalSlots}
            />
          </Suspense>
        </Card>
      )}
      </FilterNavGate>
      </FilterNavProvider>
    </>
  );
}

function GridLoadingFallback() {
  return (
    <div className="flex items-center justify-center gap-3 p-16 text-zinc-400">
      <Loader2 className="size-6 animate-spin" />
      <span className="text-sm">กำลังโหลดข้อมูล…</span>
    </div>
  );
}

/**
 * Fetches enrolled students for the (classroom, semester) scope + all
 * subject_attendance rows for the offering (across BOTH week ranges, so the
 * "รวม" summary column can show the total without an extra round-trip),
 * then renders the interactive grid.
 */
async function GridSection({
  offeringId,
  classroomId,
  semester,
  slotsPerWeek,
  weekRange,
  weekLabels,
  anchorIso,
  isPrimary,
  totalSlots,
}: {
  offeringId: string;
  classroomId: string;
  semester: 1 | 2;
  slotsPerWeek: number;
  weekRange: [number, number];
  /** Date-range label per week in `weekRange` (5 entries). */
  weekLabels: string[];
  anchorIso: string;
  isPrimary: boolean;
  totalSlots: number;
}) {
  const supabase = await createClient();

  // Enrollment scope: primary → 0 (year-wide), secondary → active term
  const enrollmentSemester: 0 | 1 | 2 = isPrimary ? 0 : semester;

  const enrollResult = await supabase
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

  const studentIds = (enrollResult.data ?? [])
    .filter((entry) => entry.student)
    .map((entry) => entry.student!.id);
  const linked = await loadLinkedSubjectAttendance({
    offeringId,
    classroomId,
    studentIds,
    slotsPerWeek,
    anchorIso,
  });

  const cellsToRecord = (
    cells: Map<string, "present" | "absent" | "leave"> | undefined,
  ) => Object.fromEntries(cells ?? []);

  const students: SubjectStudentRow[] = (enrollResult.data ?? [])
    .filter((e) => e.student)
    .map((e) => ({
      id: e.student!.id,
      student_number: e.student_number,
      full_label: `${abbreviateTitle(e.student!.title)}${e.student!.first_name} ${e.student!.last_name}`,
      statuses: cellsToRecord(linked.cellsByStudent.get(e.student!.id)),
      dailyStatuses: cellsToRecord(
        linked.dailyCellsByStudent.get(e.student!.id),
      ),
      manualKeys: Object.fromEntries(
        Array.from(
          linked.manualCellsByStudent.get(e.student!.id)?.keys() ?? [],
          (key) => [key, true],
        ),
      ),
    }));

  if (students.length === 0) {
    return (
      <div className="p-8 text-center text-sm text-zinc-500">
        ห้องนี้ยังไม่มีนักเรียน —{" "}
        <Link
          href="/setup/students"
          className="font-medium text-zinc-900 underline"
        >
          ไปจัดการนักเรียน
        </Link>
      </div>
    );
  }

  // Remount the optimistic client grid whenever a server refresh brings new
  // daily attendance or a changed session date. useState(initialStudents)
  // intentionally owns local clicks, so a stable key would otherwise keep a
  // stale snapshot after changing the timetable.
  const gridRevision = JSON.stringify({
    dates: Array.from(linked.sessionDates),
    cells: students.map((student) => [student.id, student.statuses]),
  });

  return (
    <div className="p-3">
      <SubjectAttendanceGrid
        key={gridRevision}
        offeringId={offeringId}
        classroomId={classroomId}
        semester={semester}
        slotsPerWeek={slotsPerWeek}
        weekRange={weekRange}
        weekLabels={weekLabels}
        totalSlots={totalSlots}
        students={students}
        sessionDates={Object.fromEntries(linked.sessionDates)}
        baseSessionDates={Object.fromEntries(linked.baseSessionDates)}
        overrideKeys={Array.from(linked.overrideKeys)}
      />
    </div>
  );
}
