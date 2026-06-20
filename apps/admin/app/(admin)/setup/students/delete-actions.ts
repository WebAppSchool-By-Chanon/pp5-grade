"use server";

import { createAdminClient } from "@pp5/database/admin";
import { getCurrentUser } from "@pp5/database/queries";
import { revalidatePath } from "next/cache";
import { renumberClassroom } from "./_renumber";

// ============================================================
// Behavior note
// ------------------------------------------------------------
// "ลบ" in the students list means **remove from the current academic year**
// — the enrollment row is deleted, but the student record, auth account,
// and historical data (previous years' scores/attendance/etc.) all stay.
//
// To wipe a student entirely, a separate "ลบประวัติทั้งหมด" flow would
// be needed (not built yet).
// ============================================================

export type DeleteCandidates = {
  ok: true;
  /** Enrollment IDs that will be removed. */
  ids: string[];
  /** "ทั้งหมด" or e.g. "ป.1". */
  scopeLabel: string;
};

export type DeleteCandidatesError = { ok: false; error: string };

export type BatchDeleteResult = {
  deleted: number;
  failed: Array<{ id: string; reason: string }>;
  /** Classrooms that had enrollments removed in this batch — caller must
   *  pass these to `finalizeEnrollmentDelete` so the remaining students
   *  get re-numbered (closes the gaps). */
  affectedClassroomIds: string[];
};

// ============================================================
// getEnrollmentsToDelete — resolve the target enrollment IDs
//
// `gradeId`:
//   - "all" → every enrollment in the current academic year
//   - "<uuid>" → enrollments in classrooms of that grade in current year
// ============================================================

export async function getEnrollmentsToDelete(
  gradeId: string,
  /** School's current semester (1 or 2) — used to scope secondary deletes. */
  currentSemester: 1 | 2 = 1,
): Promise<DeleteCandidates | DeleteCandidatesError> {
  const auth = await getCurrentUser();
  if (!auth || auth.profile.role !== "admin") {
    return { ok: false, error: "ไม่มีสิทธิ์ในการดำเนินการ" };
  }

  const admin = createAdminClient();

  // Resolve current year — bulk delete is always scoped to it
  const { data: currentYear } = await admin
    .from("academic_years")
    .select("id, year_be")
    .eq("is_current", true)
    .maybeSingle();
  if (!currentYear) {
    return {
      ok: false,
      error: "ยังไม่มีปีการศึกษาปัจจุบัน",
    };
  }

  if (gradeId === "all") {
    // Get all classrooms with system info so we can filter semester per system
    const { data: classrooms } = await admin
      .from("classrooms")
      .select(`id, grade_level:grade_levels!grade_level_id (system)`)
      .eq("academic_year_id", currentYear.id);

    const primaryClassroomIds: string[] = [];
    const secondaryClassroomIds: string[] = [];
    for (const c of classrooms ?? []) {
      if (c.grade_level?.system === "secondary") {
        secondaryClassroomIds.push(c.id);
      } else {
        primaryClassroomIds.push(c.id);
      }
    }
    if (
      primaryClassroomIds.length === 0 &&
      secondaryClassroomIds.length === 0
    ) {
      return { ok: true, ids: [], scopeLabel: "ทั้งหมด" };
    }

    const ids: string[] = [];

    if (primaryClassroomIds.length > 0) {
      const { data: primEnr, error: e1 } = await admin
        .from("enrollments")
        .select("id")
        .in("classroom_id", primaryClassroomIds)
        .eq("semester", 0);
      if (e1) return { ok: false, error: e1.message };
      for (const e of primEnr ?? []) ids.push(e.id);
    }
    if (secondaryClassroomIds.length > 0) {
      const { data: secEnr, error: e2 } = await admin
        .from("enrollments")
        .select("id")
        .in("classroom_id", secondaryClassroomIds)
        .eq("semester", currentSemester);
      if (e2) return { ok: false, error: e2.message };
      for (const e of secEnr ?? []) ids.push(e.id);
    }

    return { ok: true, ids, scopeLabel: "ทั้งหมด" };
  }

  // Specific grade — resolve its system to pick the right semester scope
  const { data: classrooms } = await admin
    .from("classrooms")
    .select(
      `id, grade_level:grade_levels!grade_level_id (id, name_short, system)`,
    )
    .eq("academic_year_id", currentYear.id)
    .eq("grade_level_id", gradeId);

  if (!classrooms || classrooms.length === 0) {
    return { ok: true, ids: [], scopeLabel: "(ไม่พบชั้นนี้ในปีปัจจุบัน)" };
  }
  const scopeLabel = classrooms[0].grade_level?.name_short ?? "ชั้นที่เลือก";
  const isSecondary = classrooms[0].grade_level?.system === "secondary";
  const semesterScope: 0 | 1 | 2 = isSecondary ? currentSemester : 0;
  const classroomIds = classrooms.map((c) => c.id);

  const { data: enrollments, error } = await admin
    .from("enrollments")
    .select("id")
    .in("classroom_id", classroomIds)
    .eq("semester", semesterScope);
  if (error) return { ok: false, error: error.message };

  return {
    ok: true,
    ids: (enrollments ?? []).map((e) => e.id),
    scopeLabel: isSecondary
      ? `${scopeLabel} (ภาคเรียนที่ ${currentSemester})`
      : scopeLabel,
  };
}

// ============================================================
// deleteEnrollmentsBatch — delete a chunk of enrollment rows
//
// We only delete from `enrollments` — students, auth users, and historical
// data (scores/attendance/grades from prior years) are NOT touched.
// ============================================================

export async function deleteEnrollmentsBatch(
  ids: string[],
): Promise<BatchDeleteResult> {
  const auth = await getCurrentUser();
  if (!auth || auth.profile.role !== "admin") {
    return {
      deleted: 0,
      failed: ids.map((id) => ({ id, reason: "ไม่มีสิทธิ์ในการดำเนินการ" })),
      affectedClassroomIds: [],
    };
  }

  const admin = createAdminClient();

  // Pre-fetch enrollment rows to find affected classrooms (for renumber)
  const { data: enrollRows, error: fetchErr } = await admin
    .from("enrollments")
    .select("id, classroom_id")
    .in("id", ids);
  if (fetchErr) {
    return {
      deleted: 0,
      failed: ids.map((id) => ({ id, reason: fetchErr.message })),
      affectedClassroomIds: [],
    };
  }
  const affected = new Set<string>();
  for (const e of enrollRows ?? []) {
    if (e.classroom_id) affected.add(e.classroom_id);
  }

  const failed: BatchDeleteResult["failed"] = [];
  let deleted = 0;

  for (const id of ids) {
    const { error: delErr } = await admin
      .from("enrollments")
      .delete()
      .eq("id", id);
    if (delErr) {
      failed.push({ id, reason: delErr.message });
      continue;
    }
    deleted++;
  }

  return {
    deleted,
    failed,
    affectedClassroomIds: Array.from(affected),
  };
}

// ============================================================
// finalizeEnrollmentDelete — renumber affected classrooms + revalidate
// ============================================================

export async function finalizeEnrollmentDelete(
  classroomIds: string[] = [],
): Promise<{ ok: boolean }> {
  const auth = await getCurrentUser();
  if (!auth || auth.profile.role !== "admin") return { ok: false };
  const admin = createAdminClient();
  for (const cid of classroomIds) {
    await renumberClassroom(admin, cid);
  }
  revalidatePath("/setup/students");
  return { ok: true };
}

// ============================================================
// deleteSingleEnrollment — convenience wrapper for the per-row trash button
// ============================================================

export async function deleteSingleEnrollment(
  enrollmentId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await getCurrentUser();
  if (!auth || auth.profile.role !== "admin") {
    return { ok: false, error: "ไม่มีสิทธิ์ในการดำเนินการ" };
  }

  const res = await deleteEnrollmentsBatch([enrollmentId]);
  if (res.deleted === 0) {
    return {
      ok: false,
      error: res.failed[0]?.reason ?? "ลบไม่สำเร็จ",
    };
  }

  await finalizeEnrollmentDelete(res.affectedClassroomIds);
  return { ok: true };
}

// ============================================================
// deleteStudentCompletely — hard delete: removes auth.users + students row
//
// Use when the admin wants to re-add a student with the same student_code.
// Deleting from `students` cascades to `enrollments`, scores, attendance, etc.
// This is irreversible.
// ============================================================

export async function deleteStudentCompletely(
  studentId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await getCurrentUser();
  if (!auth || auth.profile.role !== "admin") {
    return { ok: false, error: "ไม่มีสิทธิ์ในการดำเนินการ" };
  }

  const admin = createAdminClient();

  // 1. Fetch the student's auth_user_id so we can remove the auth.users row
  const { data: student, error: fetchErr } = await admin
    .from("students")
    .select("id, auth_user_id")
    .eq("id", studentId)
    .maybeSingle();

  if (fetchErr || !student) {
    return { ok: false, error: fetchErr?.message ?? "ไม่พบนักเรียน" };
  }

  // 2. Remove the auth.users row — this frees up the fake-email address
  //    so the same student_code can be registered again.
  if (student.auth_user_id) {
    const { error: authErr } = await admin.auth.admin.deleteUser(
      student.auth_user_id,
    );
    if (authErr) {
      return {
        ok: false,
        error: `ลบบัญชีผู้ใช้ไม่สำเร็จ: ${authErr.message}`,
      };
    }
  }

  // 3. Delete the students row — CASCADE removes enrollments automatically.
  const { error: delErr } = await admin
    .from("students")
    .delete()
    .eq("id", studentId);
  if (delErr) {
    return {
      ok: false,
      error: `ลบข้อมูลนักเรียนไม่สำเร็จ: ${delErr.message}`,
    };
  }

  revalidatePath("/setup/students");
  return { ok: true };
}

