"use server";

import { createAdminClient } from "@pp5/database/admin";
import { getCurrentUser } from "@pp5/database/queries";
import { revalidatePath } from "next/cache";
import { requireWriteAccess } from "@/lib/access";
import { renumberClassroom } from "../_renumber";

// ============================================================
// Types
// ============================================================

export type PromoteStatus =
  /** Source has next-grade target classroom — eligible to promote */
  | "will_promote"
  /** Source grade is the school's highest (e.g. ม.3) — no target */
  | "will_graduate"
  /** Target grade exists but the matching room is missing in target year */
  | "no_target"
  /** Student already has an enrollment in target year */
  | "already_enrolled";

export type PromoteRow = {
  studentId: string;
  studentCode: string;
  displayName: string;
  /** Sort key — `${gradeOrder}|${roomNumber}|${studentNumber}` */
  sortKey: string;
  sourceClassroomLabel: string; // e.g. "ป.1/1"
  targetClassroomId: string | null;
  targetClassroomLabel: string | null; // null for graduate / no_target / already
  status: PromoteStatus;
};

export type PreviewResult =
  | {
      ok: true;
      source: { id: string; year_be: number; semester: 0 | 1 | 2 };
      target: { id: string; year_be: number; semester: 0 | 1 | 2 };
      rows: PromoteRow[];
    }
  | { ok: false; error: string };

export type CommitInput = {
  studentId: string;
  targetClassroomId: string;
  /** Target semester to write into the new enrollment row. */
  targetSemester: 0 | 1 | 2;
};

export type BatchResult = {
  promoted: number;
  failed: Array<{ studentId: string; reason: string }>;
  affectedClassroomIds: string[];
};

// ============================================================
// Helpers
// ============================================================

async function ensureAdmin(): Promise<string | null> {
  const auth = await getCurrentUser();
  if (!auth || auth.profile.role !== "admin") {
    return "ไม่มีสิทธิ์ในการดำเนินการ";
  }
  return null;
}

function labelOf(
  gradeShort: string,
  roomNumber: number,
  totalRoomsInGrade: number,
): string {
  return totalRoomsInGrade <= 1
    ? gradeShort
    : `${gradeShort}/${roomNumber}`;
}

// ============================================================
// getPromotePreview — compute the per-student mapping
// ============================================================

export async function getPromotePreview(
  sourceYearId: string,
  targetYearId: string,
  sourceSemester: 0 | 1 | 2 = 0,
  targetSemester: 0 | 1 | 2 = 0,
  /** Optional — when set, only preview students from this single source
   *  classroom (faster than scanning the whole source year). */
  sourceClassroomId?: string | null,
): Promise<PreviewResult> {
  await requireWriteAccess();
  const authErr = await ensureAdmin();
  if (authErr) return { ok: false, error: authErr };
  if (!sourceYearId || !targetYearId) {
    return { ok: false, error: "เลือกปีต้นทาง + ปีปลายทาง" };
  }
  // Allow same-year imports only when semester differs (intra-year transition)
  const intraYear = sourceYearId === targetYearId;
  if (intraYear && sourceSemester === targetSemester) {
    return {
      ok: false,
      error: "ภาคเรียนต้นทางและปลายทางต้องไม่ซ้ำกัน (กรณีปีเดียวกัน)",
    };
  }

  const admin = createAdminClient();

  // 1. Verify both years exist
  const { data: years } = await admin
    .from("academic_years")
    .select("id, year_be")
    .in("id", [sourceYearId, targetYearId]);
  const source = years?.find((y) => y.id === sourceYearId);
  const target = years?.find((y) => y.id === targetYearId);
  if (!source || !target) {
    return { ok: false, error: "ไม่พบปีการศึกษา" };
  }

  // 2. Fetch classrooms in BOTH years with grade info (for label + mapping)
  const { data: allClassrooms } = await admin
    .from("classrooms")
    .select(
      `
      id, room_number, academic_year_id,
      grade_level:grade_levels!grade_level_id (id, name_short, sort_order)
    `,
    )
    .in("academic_year_id", [sourceYearId, targetYearId]);

  // 3. Build room-count maps (per year × grade) for nicer labels ("ป.1" vs "ป.1/1")
  const roomCountKey = (yearId: string, gradeId: string) =>
    `${yearId}|${gradeId}`;
  const roomCount = new Map<string, number>();
  for (const c of allClassrooms ?? []) {
    if (!c.grade_level) continue;
    const k = roomCountKey(c.academic_year_id, c.grade_level.id);
    roomCount.set(k, (roomCount.get(k) ?? 0) + 1);
  }

  // 4. Build target classroom lookup: "<sort_order>|<room_number>" → {id, label}
  type TargetEntry = {
    id: string;
    label: string;
    gradeShort: string;
    roomNumber: number;
  };
  const targetByOrderRoom = new Map<string, TargetEntry>();
  // And target grade existence (does `sort_order=N` exist at all in target?)
  const targetGradeShortByOrder = new Map<number, string>();
  for (const c of allClassrooms ?? []) {
    if (c.academic_year_id !== targetYearId || !c.grade_level) continue;
    const totalRooms =
      roomCount.get(roomCountKey(targetYearId, c.grade_level.id)) ?? 1;
    const lbl = labelOf(c.grade_level.name_short, c.room_number, totalRooms);
    targetByOrderRoom.set(`${c.grade_level.sort_order}|${c.room_number}`, {
      id: c.id,
      label: lbl,
      gradeShort: c.grade_level.name_short,
      roomNumber: c.room_number,
    });
    targetGradeShortByOrder.set(
      c.grade_level.sort_order,
      c.grade_level.name_short,
    );
  }

  // 5. Determine the school's highest grade sort_order
  const { data: allGrades } = await admin
    .from("grade_levels")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1);
  const maxSortOrder = allGrades?.[0]?.sort_order ?? 9;

  // 6. Fetch source enrollments with student info — narrow to a single
  //    classroom if the caller specified one.
  const allSourceClassroomIds = (allClassrooms ?? [])
    .filter((c) => c.academic_year_id === sourceYearId)
    .map((c) => c.id);
  let sourceClassroomIds: string[] = allSourceClassroomIds;
  if (sourceClassroomId) {
    if (!allSourceClassroomIds.includes(sourceClassroomId)) {
      return {
        ok: false,
        error: "ห้องเรียนที่เลือกไม่อยู่ในปีต้นทาง",
      };
    }
    sourceClassroomIds = [sourceClassroomId];
  }
  if (sourceClassroomIds.length === 0) {
    return {
      ok: true,
      source: { id: source.id, year_be: source.year_be, semester: sourceSemester },
      target: { id: target.id, year_be: target.year_be, semester: targetSemester },
      rows: [],
    };
  }
  // Filter source enrollments by sourceSemester too
  const { data: sourceEnrollments } = await admin
    .from("enrollments")
    .select(
      `
      student_number, classroom_id,
      classroom:classrooms!classroom_id (
        id, room_number,
        grade_level:grade_levels!grade_level_id (id, name_short, sort_order)
      ),
      student:students!student_id (id, student_code, title, first_name, last_name)
    `,
    )
    .in("classroom_id", sourceClassroomIds)
    .eq("semester", sourceSemester);

  // 7. Pre-fetch target enrollments at the target semester to detect
  //    "already_enrolled" (student already in target year × semester)
  const targetClassroomIds = (allClassrooms ?? [])
    .filter((c) => c.academic_year_id === targetYearId)
    .map((c) => c.id);
  const alreadyEnrolled = new Set<string>();
  if (targetClassroomIds.length > 0) {
    const { data: targetEnr } = await admin
      .from("enrollments")
      .select("student_id")
      .in("classroom_id", targetClassroomIds)
      .eq("semester", targetSemester);
    for (const e of targetEnr ?? []) alreadyEnrolled.add(e.student_id);
  }

  // 8. Build per-student preview rows
  const rows: PromoteRow[] = [];
  for (const enr of sourceEnrollments ?? []) {
    if (!enr.student || !enr.classroom?.grade_level) continue;
    const stu = enr.student;
    const cl = enr.classroom;
    const gl = cl.grade_level;

    const sourceTotalRooms =
      roomCount.get(roomCountKey(sourceYearId, gl.id)) ?? 1;
    const sourceLabel = labelOf(gl.name_short, cl.room_number, sourceTotalRooms);

    let status: PromoteStatus;
    let targetClassroomId: string | null = null;
    let targetClassroomLabel: string | null = null;

    if (alreadyEnrolled.has(stu.id)) {
      status = "already_enrolled";
    } else if (intraYear) {
      // Same year, different semester → keep same classroom (no grade advance)
      status = "will_promote";
      targetClassroomId = cl.id;
      targetClassroomLabel = sourceLabel;
    } else if (gl.sort_order >= maxSortOrder) {
      status = "will_graduate";
    } else {
      const nextOrder = gl.sort_order + 1;
      const target = targetByOrderRoom.get(`${nextOrder}|${cl.room_number}`);
      if (target) {
        status = "will_promote";
        targetClassroomId = target.id;
        targetClassroomLabel = target.label;
      } else {
        status = "no_target";
      }
    }

    rows.push({
      studentId: stu.id,
      studentCode: stu.student_code,
      displayName: `${stu.title ?? ""}${stu.first_name} ${stu.last_name}`,
      sortKey: `${gl.sort_order}|${cl.room_number}|${enr.student_number}`,
      sourceClassroomLabel: sourceLabel,
      targetClassroomId,
      targetClassroomLabel,
      status,
    });
  }

  // 9. Sort: by grade order ↑, room ↑, student_number ↑
  rows.sort((a, b) => a.sortKey.localeCompare(b.sortKey, undefined, { numeric: true }));

  return {
    ok: true,
    source: { id: source.id, year_be: source.year_be, semester: sourceSemester },
    target: { id: target.id, year_be: target.year_be, semester: targetSemester },
    rows,
  };
}

// ============================================================
// commitPromoteBatch — insert new enrollments
// ============================================================

export async function commitPromoteBatch(
  selections: CommitInput[],
): Promise<BatchResult> {
  await requireWriteAccess();
  const authErr = await ensureAdmin();
  if (authErr) {
    return {
      promoted: 0,
      failed: selections.map((s) => ({
        studentId: s.studentId,
        reason: authErr,
      })),
      affectedClassroomIds: [],
    };
  }

  const admin = createAdminClient();
  const failed: BatchResult["failed"] = [];
  const affected = new Set<string>();
  let promoted = 0;

  // Cache max(student_number) per (classroom, semester) to skip queries
  const maxByClassroomSemester = new Map<string, number>();

  for (const sel of selections) {
    const cacheKey = `${sel.targetClassroomId}|${sel.targetSemester}`;
    let max = maxByClassroomSemester.get(cacheKey);
    if (max === undefined) {
      const { data: maxRes } = await admin
        .from("enrollments")
        .select("student_number")
        .eq("classroom_id", sel.targetClassroomId)
        .eq("semester", sel.targetSemester)
        .order("student_number", { ascending: false })
        .limit(1)
        .maybeSingle();
      max = maxRes?.student_number ?? 0;
    }
    const next = max + 1;
    maxByClassroomSemester.set(cacheKey, next);

    const { error: insertErr } = await admin.from("enrollments").insert({
      student_id: sel.studentId,
      classroom_id: sel.targetClassroomId,
      student_number: next,
      semester: sel.targetSemester,
    });
    if (insertErr) {
      maxByClassroomSemester.set(cacheKey, max);
      failed.push({
        studentId: sel.studentId,
        reason: insertErr.message,
      });
      continue;
    }
    promoted++;
    affected.add(sel.targetClassroomId);
  }

  return {
    promoted,
    failed,
    affectedClassroomIds: Array.from(affected),
  };
}

// ============================================================
// finalizePromote — renumber affected classrooms + revalidate
// ============================================================

export async function finalizePromote(
  classroomIds: string[],
  /** Semester scope for the renumber (typically the targetSemester of the
   *  wizard run). Defaults to 0 = primary year-wide. */
  semester: 0 | 1 | 2 = 0,
): Promise<{ ok: boolean }> {
  await requireWriteAccess();
  const authErr = await ensureAdmin();
  if (authErr) return { ok: false };

  const admin = createAdminClient();
  for (const cid of classroomIds) {
    await renumberClassroom(admin, cid, semester);
  }
  revalidatePath("/setup/students");
  return { ok: true };
}

/**
 * Re-number student_number sequentially in a classroom × semester,
 * sorted by student_code. Mirror of the helper in other action files.
 */
