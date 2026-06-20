import { createClient } from "@pp5/database/server";
import { Card, PageHeader } from "@pp5/ui";
import { GraduationCap, History, Pencil, Upload } from "lucide-react";
import Link from "next/link";
import { requireAdmin } from "@/lib/teacher-scope";
import { FilterNavProvider } from "../_components/filter-nav-context";
import { GradeFilter } from "../_components/grade-filter";
import { RoomFilter } from "../_components/room-filter";
import { DeleteStudentsDialog } from "./delete-dialog";
import { DeleteSingleStudentButton } from "./delete-single-button";
import { NavigationGate } from "./navigation-gate";
import type { NumberMode } from "./_renumber";
import { RenumberClassroomButton } from "./renumber-button";

export const metadata = {
  title: "ระบบบันทึกผลการเรียนออนไลน์",
};

type Props = {
  searchParams: Promise<{
    error?: string;
    grade?: string;
    room?: string;
  }>;
};

export default async function StudentsPage({ searchParams }: Props) {
  await requireAdmin();
  const {
    error: queryError,
    grade: gradeFilter,
    room: roomFilter,
  } = await searchParams;
  const supabase = await createClient();

  // Resolve current academic year — list scopes to it
  const { data: currentYear } = await supabase
    .from("academic_years")
    .select("id, year_be, current_semester")
    .eq("is_current", true)
    .maybeSingle();

  // Parallel: classrooms (for smart-naming counts + grade dropdown) + students with enrollments
  const [classroomsResult, studentsResult] = await Promise.all([
    currentYear
      ? supabase
          .from("classrooms")
          .select(
            `
            id,
            grade_level_id,
            room_number,
            number_mode,
            grade_level:grade_levels!grade_level_id (
              name_short,
              sort_order,
              system
            )
          `,
          )
          .eq("academic_year_id", currentYear.id)
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from("students")
      .select(
        `
        id,
        student_code,
        title,
        first_name,
        last_name,
        enrollments (
          id,
          student_number,
          semester,
          classroom:classrooms!classroom_id (
            id,
            grade_level_id,
            room_number,
            academic_year_id,
            grade_level:grade_levels!grade_level_id (
              name_short,
              sort_order,
              system
            )
          )
        )
      `,
      ),
  ]);

  const { data: students, error } = studentsResult;

  // Count rooms per grade — for smart naming ("ป.3" if 1 room, "ป.3/1" if 2+)
  const roomCountByGrade = new Map<string, number>();
  for (const c of classroomsResult.data ?? []) {
    roomCountByGrade.set(
      c.grade_level_id,
      (roomCountByGrade.get(c.grade_level_id) ?? 0) + 1,
    );
  }

  // Build grade-filter dropdown options from current-year classrooms (unique grades, sorted)
  const gradeOptionMap = new Map<
    string,
    { id: string; label: string; sort: number }
  >();
  for (const c of classroomsResult.data ?? []) {
    if (!gradeOptionMap.has(c.grade_level_id)) {
      gradeOptionMap.set(c.grade_level_id, {
        id: c.grade_level_id,
        label: c.grade_level?.name_short ?? "?",
        sort: c.grade_level?.sort_order ?? 999,
      });
    }
  }
  const gradeOptions = Array.from(gradeOptionMap.values())
    .sort((a, b) => a.sort - b.sort)
    .map(({ id, label }) => ({ id, label }));

  // Resolve the active "view semester" for the page.
  //   Secondary grades → always the school's current semester (no per-page tabs)
  //   Primary grades   → always 0 (year-scoped enrollment)
  const currentSemester: 1 | 2 =
    currentYear?.current_semester === 2 ? 2 : 1;
  const selectedGradeSystem = gradeFilter
    ? ((classroomsResult.data ?? []).find(
        (c) => c.grade_level_id === gradeFilter,
      )?.grade_level?.system ?? "primary")
    : "primary";
  const isSecondaryView = selectedGradeSystem === "secondary";
  const viewSemester: 0 | 1 | 2 = isSecondaryView ? currentSemester : 0;

  // Resolve each student's current-year enrollment (if any) — filtered by
  // the active view semester so the rest of the page just sees one row per
  // student that matches "what the admin is looking at right now".
  type Row = {
    id: string;
    student_code: string;
    title: string | null;
    first_name: string;
    last_name: string;
    enrollment: {
      enrollment_id: string;
      student_number: number;
      classroom_display: string; // e.g. "ป.3" or "ป.3/1"
      classroom_id: string;
      grade_level_id: string;
      grade_order: number;
      room_number: number;
      semester: number;
    } | null;
  };

  const rows: Row[] = (students ?? []).map((s) => {
    const enr = currentYear
      ? s.enrollments?.find(
          (e) =>
            e.classroom?.academic_year_id === currentYear.id &&
            e.semester === viewSemester,
        )
      : null;
    let enrollment: Row["enrollment"] = null;
    if (enr?.classroom) {
      const gradeShort = enr.classroom.grade_level?.name_short ?? "?";
      const totalRooms = roomCountByGrade.get(enr.classroom.grade_level_id) ?? 1;
      const classroom_display =
        totalRooms <= 1 ? gradeShort : `${gradeShort}/${enr.classroom.room_number}`;
      enrollment = {
        enrollment_id: enr.id,
        student_number: enr.student_number,
        classroom_display,
        classroom_id: enr.classroom.id,
        grade_level_id: enr.classroom.grade_level_id,
        grade_order: enr.classroom.grade_level?.sort_order ?? 999,
        room_number: enr.classroom.room_number,
        semester: enr.semester,
      };
    }
    return {
      id: s.id,
      student_code: s.student_code,
      title: s.title,
      first_name: s.first_name,
      last_name: s.last_name,
      enrollment,
    };
  });

  // Per-grade counts for the "ลบรายชื่อ" dropdown. Each grade is counted
  // against ITS OWN effective semester:
  //   - Primary grades → semester = 0
  //   - Secondary grades → semester = school's current semester
  // So the dropdown reflects what would actually be deleted.
  const gradeSystemById = new Map<string, "primary" | "secondary">();
  for (const c of classroomsResult.data ?? []) {
    if (c.grade_level?.system === "secondary") {
      gradeSystemById.set(c.grade_level_id, "secondary");
    } else if (c.grade_level) {
      gradeSystemById.set(c.grade_level_id, "primary");
    }
  }
  const countByGrade = new Map<string, number>();
  for (const s of students ?? []) {
    for (const e of s.enrollments ?? []) {
      if (!e.classroom || e.classroom.academic_year_id !== currentYear?.id)
        continue;
      const gid = e.classroom.grade_level_id;
      const sys = gradeSystemById.get(gid) ?? "primary";
      const effective = sys === "secondary" ? currentSemester : 0;
      if (e.semester !== effective) continue;
      countByGrade.set(gid, (countByGrade.get(gid) ?? 0) + 1);
    }
  }
  const gradeOptionsForDelete = gradeOptions.map((g) => ({
    ...g,
    count: countByGrade.get(g.id) ?? 0,
  }));
  const totalStudentCount = Array.from(countByGrade.values()).reduce(
    (a, b) => a + b,
    0,
  );

  // Rooms in the selected grade — when 2+, force the user to pick a room too
  const roomsInSelectedGrade = gradeFilter
    ? (classroomsResult.data ?? [])
        .filter((c) => c.grade_level_id === gradeFilter)
        .sort((a, b) => a.room_number - b.room_number)
        .map((c) => ({ id: c.id, label: `ห้อง ${c.room_number}` }))
    : [];
  const needsRoomChoice = roomsInSelectedGrade.length > 1;
  const hasRoomChoice = roomFilter && roomFilter.length > 0;

  // Determine whether to show the table:
  //   - No grade selected  → empty (prompt to choose a grade)
  //   - Grade w/ 1 room    → show students in that grade
  //   - Grade w/ 2+ rooms  → require room → show students in that classroom only
  const shouldShowList =
    !!gradeFilter && (!needsRoomChoice || !!hasRoomChoice);

  // The single classroom currently being displayed (for the renumber button)
  let displayedClassroomId: string | null = null;
  let displayedClassroomLabel = "";
  let displayedClassroomMode: NumberMode = "code";
  if (shouldShowList && gradeFilter) {
    const gradeShort = gradeOptions.find((g) => g.id === gradeFilter)?.label ?? "";
    if (needsRoomChoice && roomFilter) {
      const c = (classroomsResult.data ?? []).find((c) => c.id === roomFilter);
      if (c) {
        displayedClassroomId = c.id;
        displayedClassroomLabel = `${gradeShort}/${c.room_number}`;
        displayedClassroomMode = (c.number_mode ?? "code") as NumberMode;
      }
    } else if (!needsRoomChoice && roomsInSelectedGrade.length === 1) {
      const c = (classroomsResult.data ?? []).find(
        (c) => c.id === roomsInSelectedGrade[0].id,
      );
      displayedClassroomId = roomsInSelectedGrade[0].id;
      displayedClassroomLabel = gradeShort;
      displayedClassroomMode = (c?.number_mode ?? "code") as NumberMode;
    }
  }

  const filteredRows = !shouldShowList
    ? []
    : rows.filter((r) => {
        if (r.enrollment?.grade_level_id !== gradeFilter) return false;
        if (needsRoomChoice && r.enrollment?.classroom_id !== roomFilter)
          return false;
        return true;
      });

  // Sort: enrolled first (by grade, room, number), then unenrolled (by student_code)
  filteredRows.sort((a, b) => {
    if (a.enrollment && !b.enrollment) return -1;
    if (!a.enrollment && b.enrollment) return 1;
    if (a.enrollment && b.enrollment) {
      if (a.enrollment.grade_order !== b.enrollment.grade_order)
        return a.enrollment.grade_order - b.enrollment.grade_order;
      if (a.enrollment.room_number !== b.enrollment.room_number)
        return a.enrollment.room_number - b.enrollment.room_number;
      return a.enrollment.student_number - b.enrollment.student_number;
    }
    return a.student_code.localeCompare(b.student_code);
  });

  return (
    // FilterNavProvider wraps the whole page so the ชั้น/ห้อง filters
    // (which call startNav) and the gate (which reads pending) share the
    // same nav state — the table paints a skeleton instantly on change.
    <FilterNavProvider>
      {queryError && (
        <div
          role="alert"
          className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900"
        >
          ❌ {queryError}
        </div>
      )}

      <PageHeader
        icon={GraduationCap}
        iconBg="bg-sky-100 text-sky-700"
        title="จัดการนักเรียน"
        description={
          <>
            เพิ่ม/แก้ไขข้อมูลนักเรียน · จัดเข้าห้องเรียน · เปลี่ยนรหัสผ่าน
            {currentYear && (
              <>
                {" · ปีปัจจุบัน "}
                <strong className="font-mono">{currentYear.year_be}</strong>
              </>
            )}
          </>
        }
        action={
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <DeleteStudentsDialog
              gradeOptions={gradeOptionsForDelete}
              totalCount={totalStudentCount}
              currentSemester={currentSemester}
            />
            <Link
              href={
                isSecondaryView
                  ? "/setup/students/import-previous?mode=semester"
                  : "/setup/students/import-previous?mode=year"
              }
              className="inline-flex items-center gap-1.5 rounded-md border border-emerald-300 bg-white px-4 py-2 text-sm font-medium text-emerald-700 shadow-sm hover:bg-emerald-50"
            >
              <History className="size-4" aria-hidden />
              {isSecondaryView ? "นำเข้าจากเทอมที่แล้ว" : "นำเข้าจากปีที่แล้ว"}
            </Link>
            <Link
              href="/setup/students/import"
              className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 shadow-sm hover:bg-zinc-50"
            >
              <Upload className="size-4" aria-hidden />
              นำเข้าจาก Excel
            </Link>
            <Link
              href="/setup/students/new"
              className="rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-600 focus:ring-offset-1"
            >
              + เพิ่มนักเรียน
            </Link>
          </div>
        }
      />

      {!currentYear && (
        <Card variant="warning" padding="sm" className="mb-4 text-sm text-amber-900">
          ⚠️ ยังไม่มีปีปัจจุบัน · ดูข้อมูลห้องเรียนไม่ได้ ·{" "}
          <Link
            href="/setup/academic-years"
            className="font-medium underline"
          >
            ไปตั้งค่าปีการศึกษา
          </Link>
        </Card>
      )}

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-red-900">
          <p className="font-semibold">❌ Error:</p>
          <pre className="mt-2 text-sm">{error.message}</pre>
        </div>
      )}

      {gradeOptions.length > 0 && (
        <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-wrap items-center gap-4">
            <GradeFilter
              options={gradeOptions}
              current={gradeFilter ?? ""}
              placeholder="— เลือกชั้น —"
              clearParams={["room"]}
            />
            {needsRoomChoice && (
              <RoomFilter
                options={roomsInSelectedGrade}
                current={roomFilter ?? ""}
              />
            )}
          </div>
          {displayedClassroomId && (
            <RenumberClassroomButton
              classroomId={displayedClassroomId}
              classroomLabel={displayedClassroomLabel}
              semester={viewSemester}
              currentMode={displayedClassroomMode}
            />
          )}
        </div>
      )}

      {/* Secondary view: just a small inline label confirming which semester
          the admin is looking at — no tab switcher (to switch semester,
          change it at /setup/academic-years). */}
      {isSecondaryView && shouldShowList && (
        <p className="mb-3 text-xs text-zinc-600">
          กำลังแสดง <strong>ภาคเรียนที่ {viewSemester}</strong>{" "}
          (ภาคเรียนปัจจุบันของโรงเรียน) ·{" "}
          <Link
            href="/setup/academic-years"
            className="font-medium underline hover:text-zinc-900"
          >
            เปลี่ยนภาคเรียนปัจจุบัน
          </Link>
        </p>
      )}

      {/* Skeleton-on-filter-change: the ชั้น/ห้อง dropdowns call startNav()
          in onChange, so the gate paints a table skeleton at 0ms — before
          the new roster is fetched. */}
      {!error && (
        <NavigationGate>
          {!shouldShowList && (
            <Card variant="dashed" padding={false} className="p-12 text-center">
              <p className="text-sm text-zinc-500">
                {!gradeFilter
                  ? "เลือกชั้นเพื่อแสดงรายชื่อนักเรียน"
                  : "เลือกห้องเพื่อแสดงรายชื่อนักเรียน"}
              </p>
            </Card>
          )}

          {shouldShowList && filteredRows.length === 0 && (
            <Card variant="dashed" padding={false} className="p-12 text-center">
              <p className="text-sm text-zinc-500">
                ยังไม่มีนักเรียนใน
                {needsRoomChoice ? "ห้องนี้" : "ระดับชั้นนี้"}
              </p>
              <Link
                href="/setup/students/new"
                className="mt-3 inline-block text-sm font-medium text-zinc-900 underline"
              >
                เพิ่มนักเรียน
              </Link>
            </Card>
          )}

          {shouldShowList && filteredRows.length > 0 && (
            <div className="rounded-md border border-zinc-200 bg-white">
          {/* table-fixed + per-column widths so the table fits the mobile
              viewport WITHOUT horizontal scroll — the name column takes the
              remaining space and truncates with "…" when too long. User spec
              2026-05-31: "จอเล็กไม่ต้องเลื่อนซ้ายขวา · ชื่อยาวทำ ... ต่อท้าย". */}
          <table className="w-full table-fixed text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                {/* Hide "ห้อง" column on mobile — same info is already
                    in the room dropdown filter above the table. User
                    spec 2026-05-22: ไม่ต้องแสดงคอลัมน์ที่ห้อง. */}
                <th className="hidden w-16 whitespace-nowrap px-3 py-2 font-medium md:table-cell">
                  ห้อง
                </th>
                <th className="w-14 whitespace-nowrap px-2 py-2 font-medium sm:px-3">
                  เลขที่
                </th>
                <th className="w-16 whitespace-nowrap px-2 py-2 font-medium sm:w-24 sm:px-3">
                  รหัส
                </th>
                <th className="px-2 py-2 font-medium sm:px-3">ชื่อ-นามสกุล</th>
                <th className="w-20 whitespace-nowrap px-2 py-2 text-right font-medium sm:px-3">
                  จัดการ
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200">
              {filteredRows.map((r) => (
                <tr key={r.id} className="hover:bg-zinc-50">
                  <td className="hidden whitespace-nowrap px-3 py-1 font-medium text-zinc-900 md:table-cell">
                    {r.enrollment ? (
                      <span>{r.enrollment.classroom_display}</span>
                    ) : (
                      <span className="text-xs italic text-zinc-400">
                        (ไม่อยู่ห้อง)
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1 font-mono text-zinc-700 sm:px-3">
                    {r.enrollment?.student_number ?? "—"}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1 font-mono text-xs text-zinc-700 sm:px-3">
                    {r.student_code}
                  </td>
                  <td className="px-2 py-1 sm:px-3">
                    {/* block truncate → ชื่อยาวตัดด้วย "…" (ไม่ดันตารางให้
                        ล้นจอ · table-fixed ให้คอลัมน์นี้กว้างเท่าที่เหลือ) */}
                    <span className="block truncate font-medium text-zinc-900">
                      {r.title}
                      {r.first_name} {r.last_name}
                    </span>
                  </td>
                  <td className="px-2 py-1 text-right sm:px-3">
                    <div className="inline-flex items-center justify-end gap-0.5">
                      <Link
                        href={`/setup/students/${r.id}`}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-primary-600 focus:outline-none focus:ring-2 focus:ring-primary-600 focus:ring-offset-1"
                        title="แก้ไข"
                        aria-label={`แก้ไข ${r.title ?? ""}${r.first_name} ${r.last_name}`}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Link>
                      {r.enrollment ? (
                        <DeleteSingleStudentButton
                          enrollmentId={r.enrollment.enrollment_id}
                          displayName={`${r.title ?? ""}${r.first_name} ${r.last_name}`}
                          classroomLabel={r.enrollment.classroom_display}
                          yearBe={currentYear?.year_be ?? 0}
                          studentId={r.id}
                        />
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
            </div>
          )}
        </NavigationGate>
      )}
    </FilterNavProvider>
  );
}
