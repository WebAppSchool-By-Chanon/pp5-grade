"use server";

import { createAdminClient } from "@pp5/database/admin";
import { getCurrentUser } from "@pp5/database/queries";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireWriteAccess } from "@/lib/access";
import { renumberClassroom, type NumberMode } from "./_renumber";

const STUDENT_DOMAIN = "student.pp5.local";

/** Default password for every new student (single-add + Excel import).
 *  Students change it themselves later in the student app. User spec 2026-06-05. */
const DEFAULT_STUDENT_PASSWORD = "123456";

export type StudentFormState = {
  error: string | null;
  /**
   * Set when the submitted student_code already exists in `students`.
   * The form switches to a re-enrollment view instead of showing an error.
   */
  existingStudent?: {
    id: string;
    student_code: string;
    title: string | null;
    first_name: string;
    last_name: string;
  };
  fieldErrors?: {
    student_code?: string;
    password?: string;
    first_name?: string;
    last_name?: string;
    national_id?: string;
  };
};

type ParsedStudent = {
  student_code: string;
  password: string;
  title: string | null;
  first_name: string;
  last_name: string;
  gender: "male" | "female" | null;
  birth_date: string | null;
  national_id: string | null;
  classroom_id: string | null;
  /** 1 or 2 (only used when classroom is secondary). Primary always uses 0. */
  semester: 1 | 2;
};

function parseForm(formData: FormData, requirePassword: boolean):
  | { ok: true; values: ParsedStudent }
  | { ok: false; state: StudentFormState } {
  const student_code = String(formData.get("student_code") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const title = String(formData.get("title") ?? "").trim() || null;
  const first_name = String(formData.get("first_name") ?? "").trim();
  const last_name = String(formData.get("last_name") ?? "").trim();
  const genderStr = String(formData.get("gender") ?? "").trim();
  const gender =
    genderStr === "male" || genderStr === "female" ? genderStr : null;
  const birth_date = String(formData.get("birth_date") ?? "").trim() || null;
  const national_id = String(formData.get("national_id") ?? "").trim() || null;
  const classroom_id =
    String(formData.get("classroom_id") ?? "").trim() || null;
  const semesterRaw = String(formData.get("semester") ?? "1").trim();
  const semester: 1 | 2 = semesterRaw === "2" ? 2 : 1;

  const fieldErrors: StudentFormState["fieldErrors"] = {};

  if (!student_code) fieldErrors.student_code = "กรุณากรอกรหัสนักเรียน";
  else if (!/^[a-zA-Z0-9]{1,20}$/.test(student_code))
    fieldErrors.student_code = "ใช้ a-z, 0-9 เท่านั้น (สูงสุด 20 ตัว)";

  if (requirePassword) {
    if (!password) fieldErrors.password = "กรุณากรอกรหัสผ่าน";
    else if (password.length < 6) fieldErrors.password = "อย่างน้อย 6 ตัว";
  }

  if (!first_name) fieldErrors.first_name = "กรุณากรอกชื่อ";
  if (!last_name) fieldErrors.last_name = "กรุณากรอกนามสกุล";

  if (national_id && !/^\d{13}$/.test(national_id))
    fieldErrors.national_id = "ต้องเป็นเลข 13 หลัก";

  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, state: { error: "ข้อมูลไม่ถูกต้อง", fieldErrors } };
  }

  return {
    ok: true,
    values: {
      student_code,
      password,
      title,
      first_name,
      last_name,
      gender,
      birth_date,
      national_id,
      classroom_id,
      semester,
    },
  };
}

async function ensureAdmin(): Promise<StudentFormState | null> {
  const auth = await getCurrentUser();
  if (!auth || auth.profile.role !== "admin") {
    return { error: "ไม่มีสิทธิ์ในการดำเนินการ" };
  }
  return null;
}

/**
 * Manually re-number student_number for a single classroom × semester.
 * Used by the "เรียงเลขที่ใหม่" button on the students list page.
 *
 * @param mode       Sort order: 'code' | 'male_first' | 'female_first'
 * @param applyToAll When true, saves the mode + renumbers ALL classrooms
 *                   in the same academic year (not just this room).
 */
export async function renumberClassroomById(
  classroomId: string,
  semester: 0 | 1 | 2 = 0,
  mode: NumberMode = "code",
  applyToAll: boolean = false,
): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  await requireWriteAccess();
  const auth = await getCurrentUser();
  if (!auth || auth.profile.role !== "admin") {
    return { ok: false, error: "ไม่มีสิทธิ์ในการดำเนินการ" };
  }
  if (!classroomId) {
    return { ok: false, error: "ไม่ระบุห้องเรียน" };
  }
  const admin = createAdminClient();

  if (applyToAll) {
    // Resolve academic year from this classroom
    const { data: thisRoom } = await admin
      .from("classrooms")
      .select("academic_year_id")
      .eq("id", classroomId)
      .maybeSingle();
    const yearId = thisRoom?.academic_year_id;
    if (!yearId) return { ok: false, error: "ไม่พบห้องเรียน" };

    // School's current semester — needed for secondary classrooms
    const { data: currentYear } = await admin
      .from("academic_years")
      .select("current_semester")
      .eq("id", yearId)
      .maybeSingle();
    const schoolSemester: 1 | 2 =
      currentYear?.current_semester === 2 ? 2 : 1;

    // Save mode to every classroom in this year
    await admin
      .from("classrooms")
      .update({ number_mode: mode })
      .eq("academic_year_id", yearId);

    // Fetch all classrooms + grade system for semester scoping
    const { data: allRooms } = await admin
      .from("classrooms")
      .select("id, grade_level:grade_levels!grade_level_id (system)")
      .eq("academic_year_id", yearId);

    for (const room of allRooms ?? []) {
      const sem: 0 | 1 | 2 =
        (room.grade_level as { system?: string } | null)?.system ===
        "secondary"
          ? schoolSemester
          : 0;
      await renumberClassroom(admin, room.id, sem);
    }
  } else {
    // Save mode to this classroom only
    await admin
      .from("classrooms")
      .update({ number_mode: mode })
      .eq("id", classroomId);
    await renumberClassroom(admin, classroomId, semester);
  }

  // Count for UI feedback (always the originally-requested classroom)
  const { count, error: countErr } = await admin
    .from("enrollments")
    .select("id", { count: "exact", head: true })
    .eq("classroom_id", classroomId)
    .eq("semester", semester);
  if (countErr) {
    return { ok: false, error: countErr.message };
  }

  revalidatePath("/setup/students");
  return { ok: true, count: count ?? 0 };
}

/**
 * Create a student. Coordinates up to 3 records:
 *   1. auth.users (via service-role admin API)
 *   2. public.students (with auth_user_id link)
 *   3. public.enrollments (only if a classroom is selected; auto student_number = max+1)
 *
 * Note: students table doesn't have a separate extension table (unlike teachers)
 * so this is 2-3 steps instead of 3.
 *
 * Cleanup on failure prevents orphan auth users / orphan students.
 */
export async function createStudent(
  _prev: StudentFormState,
  formData: FormData,
): Promise<StudentFormState> {
  await requireWriteAccess();
  const guard = await ensureAdmin();
  if (guard) return guard;

  const parsed = parseForm(formData, false);
  if (!parsed.ok) return parsed.state;
  const v = parsed.values;

  const admin = createAdminClient();

  // Pre-check: if student_code already exists → return existing student info
  // so the form can offer re-enrollment instead of a hard error.
  const { data: existingByCode } = await admin
    .from("students")
    .select("id, student_code, title, first_name, last_name")
    .eq("student_code", v.student_code)
    .maybeSingle();
  if (existingByCode) {
    return {
      error: null,
      existingStudent: {
        id: existingByCode.id,
        student_code: existingByCode.student_code,
        title: existingByCode.title,
        first_name: existingByCode.first_name,
        last_name: existingByCode.last_name,
      },
    };
  }

  // Step 1: auth user
  const email = `${v.student_code}@${STUDENT_DOMAIN}`;
  const { data: authData, error: authError } =
    await admin.auth.admin.createUser({
      email,
      password: DEFAULT_STUDENT_PASSWORD,
      email_confirm: true,
    });

  if (authError || !authData.user) {
    const msg = authError?.message ?? "ไม่สามารถสร้างบัญชี auth";
    if (msg.toLowerCase().includes("already") || msg.includes("registered")) {
      return {
        error: `รหัสนักเรียน "${v.student_code}" ถูกใช้แล้ว`,
        fieldErrors: { student_code: "รหัสนี้ถูกใช้แล้ว" },
      };
    }
    return { error: msg };
  }

  const authUserId = authData.user.id;

  // Step 2: students
  const { data: studentRow, error: studentError } = await admin
    .from("students")
    .insert({
      auth_user_id: authUserId,
      student_code: v.student_code,
      title: v.title,
      first_name: v.first_name,
      last_name: v.last_name,
      gender: v.gender,
      birth_date: v.birth_date,
      national_id: v.national_id,
    })
    .select("id")
    .single();

  if (studentError || !studentRow) {
    // Cleanup orphan auth user
    await admin.auth.admin.deleteUser(authUserId);
    if (studentError?.code === "23505") {
      // Could be student_code or national_id — guess by message
      if (studentError.message.includes("national_id")) {
        return {
          error: "เลขประจำตัวประชาชนถูกใช้แล้ว",
          fieldErrors: { national_id: "เลขนี้ถูกใช้แล้ว" },
        };
      }
      return {
        error: `รหัสนักเรียน "${v.student_code}" ถูกใช้แล้ว`,
        fieldErrors: { student_code: "รหัสนี้ถูกใช้แล้ว" },
      };
    }
    return { error: studentError?.message ?? "ไม่สามารถสร้างข้อมูลนักเรียน" };
  }

  // Step 3: enrollment (only if classroom selected)
  if (v.classroom_id) {
    // Look up classroom's grade.system to pick the right semester scope:
    // primary → semester=0 (year-wide), secondary → semester=1|2 from form.
    const { data: classroomInfo } = await admin
      .from("classrooms")
      .select(`grade_level:grade_levels!grade_level_id (system)`)
      .eq("id", v.classroom_id)
      .maybeSingle();
    const effectiveSemester: 0 | 1 | 2 =
      classroomInfo?.grade_level?.system === "secondary" ? v.semester : 0;

    const { data: maxResult } = await admin
      .from("enrollments")
      .select("student_number")
      .eq("classroom_id", v.classroom_id)
      .eq("semester", effectiveSemester)
      .order("student_number", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextNumber = (maxResult?.student_number ?? 0) + 1;

    const { error: enrollError } = await admin.from("enrollments").insert({
      student_id: studentRow.id,
      classroom_id: v.classroom_id,
      student_number: nextNumber,
      semester: effectiveSemester,
    });
    if (enrollError) {
      // Cleanup: delete student + auth user
      await admin.from("students").delete().eq("id", studentRow.id);
      await admin.auth.admin.deleteUser(authUserId);
      return { error: `ไม่สามารถลงทะเบียนเข้าห้อง: ${enrollError.message}` };
    }

    // Re-sort by student_code so the new student lands at the right position
    await renumberClassroom(admin, v.classroom_id, effectiveSemester);
  }

  revalidatePath("/setup/students");
  redirect("/setup/students");
}

/**
 * Enroll an EXISTING student (already in `students` table) into a classroom.
 * Used when the admin tries to create a student whose code already exists —
 * e.g. after a soft-delete (removed from enrollment, record kept).
 *
 * Does NOT create a new auth user or students row.
 */
export async function enrollExistingStudent(
  _prev: StudentFormState,
  formData: FormData,
): Promise<StudentFormState> {
  await requireWriteAccess();
  const guard = await ensureAdmin();
  if (guard) return guard;

  const studentId = String(formData.get("student_id") ?? "").trim();
  const classroomId = String(formData.get("classroom_id") ?? "").trim();
  const semesterRaw = String(formData.get("semester") ?? "1");
  const semester: 1 | 2 = semesterRaw === "2" ? 2 : 1;

  if (!studentId) return { error: "ไม่ระบุนักเรียน" };
  if (!classroomId) return { error: "กรุณาเลือกห้องเรียน" };

  const admin = createAdminClient();

  // Resolve effective semester (primary = 0, secondary = 1|2)
  const { data: classroomInfo } = await admin
    .from("classrooms")
    .select(`grade_level:grade_levels!grade_level_id (system)`)
    .eq("id", classroomId)
    .maybeSingle();
  const effectiveSemester: 0 | 1 | 2 =
    classroomInfo?.grade_level?.system === "secondary" ? semester : 0;

  // Guard: already enrolled in this classroom × semester?
  const { data: alreadyEnrolled } = await admin
    .from("enrollments")
    .select("id")
    .eq("student_id", studentId)
    .eq("classroom_id", classroomId)
    .eq("semester", effectiveSemester)
    .maybeSingle();
  if (alreadyEnrolled) {
    return { error: "นักเรียนอยู่ในห้องนี้แล้ว" };
  }

  // Assign next student_number
  const { data: maxResult } = await admin
    .from("enrollments")
    .select("student_number")
    .eq("classroom_id", classroomId)
    .eq("semester", effectiveSemester)
    .order("student_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextNumber = (maxResult?.student_number ?? 0) + 1;

  const { error: enrollError } = await admin.from("enrollments").insert({
    student_id: studentId,
    classroom_id: classroomId,
    student_number: nextNumber,
    semester: effectiveSemester,
  });
  if (enrollError) {
    return { error: `ไม่สามารถลงทะเบียนเข้าห้อง: ${enrollError.message}` };
  }

  // Renumber using the classroom's saved number_mode
  await renumberClassroom(admin, classroomId, effectiveSemester);

  revalidatePath("/setup/students");
  redirect("/setup/students");
}

export type ResetPasswordState = {
  error: string | null;
  success: boolean;
  fieldErrors?: { password?: string };
};

/**
 * Update student info + enrollment in current academic year.
 *
 * NOT updated here:
 * - student_code (locked — it's the auth identity)
 * - password (separate reset flow)
 *
 * Enrollment handling for the current academic year:
 * - If the form's classroom_id differs from existing → delete old + create new
 * - If form has no classroom (empty) but existing has one → just delete
 * - student_number is auto-assigned as max+1 in the target classroom
 * - Enrollments in OTHER years (past/future) are left untouched
 */
export async function updateStudent(
  _prev: StudentFormState,
  formData: FormData,
): Promise<StudentFormState> {
  await requireWriteAccess();
  const guard = await ensureAdmin();
  if (guard) return guard;

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "ไม่พบ id ของนักเรียน" };

  const parsed = parseForm(formData, false); // password not required for edit
  if (!parsed.ok) return parsed.state;
  const v = parsed.values;

  const admin = createAdminClient();

  // Update students table
  const { error: studentError } = await admin
    .from("students")
    .update({
      title: v.title,
      first_name: v.first_name,
      last_name: v.last_name,
      gender: v.gender,
      birth_date: v.birth_date,
      national_id: v.national_id,
    })
    .eq("id", id);

  if (studentError) {
    if (studentError.code === "23505") {
      if (studentError.message.includes("national_id")) {
        return {
          error: "เลขประจำตัวประชาชนถูกใช้แล้ว",
          fieldErrors: { national_id: "เลขนี้ถูกใช้แล้ว" },
        };
      }
    }
    return { error: `ไม่สามารถบันทึก: ${studentError.message}` };
  }

  // Handle classroom enrollment for current year
  const { data: currentYear } = await admin
    .from("academic_years")
    .select("id")
    .eq("is_current", true)
    .maybeSingle();

  if (currentYear) {
    // Find existing current-year enrollment — picks the first match
    // (semester-aware edits come in Phase 1E.2 for secondary)
    const { data: existingEnrollments } = await admin
      .from("enrollments")
      .select(
        `id, classroom_id, semester, classroom:classrooms!classroom_id (academic_year_id, grade_level:grade_levels!grade_level_id (system))`,
      )
      .eq("student_id", id);

    const currentEnr = (existingEnrollments ?? []).find(
      (e) => e.classroom?.academic_year_id === currentYear.id,
    );

    const newClassroomId = v.classroom_id;

    // Delete old if classroom changes (or removed)
    if (currentEnr && newClassroomId !== currentEnr.classroom_id) {
      const oldClassroomId = currentEnr.classroom_id;
      const oldSemester = (currentEnr.semester ?? 0) as 0 | 1 | 2;
      const { error: delError } = await admin
        .from("enrollments")
        .delete()
        .eq("id", currentEnr.id);
      if (delError) {
        return { error: `ไม่สามารถลบ enrollment เก่า: ${delError.message}` };
      }
      // Close the gap left by the removed student in its semester
      await renumberClassroom(admin, oldClassroomId, oldSemester);
    }

    // Create new if needed (no existing, or classroom changed)
    if (
      newClassroomId &&
      (!currentEnr || newClassroomId !== currentEnr.classroom_id)
    ) {
      // Look up destination classroom's system to scope semester
      const { data: newClassroomInfo } = await admin
        .from("classrooms")
        .select(`grade_level:grade_levels!grade_level_id (system)`)
        .eq("id", newClassroomId)
        .maybeSingle();
      const newSemester: 0 | 1 | 2 =
        newClassroomInfo?.grade_level?.system === "secondary"
          ? v.semester
          : 0;

      const { data: maxResult } = await admin
        .from("enrollments")
        .select("student_number")
        .eq("classroom_id", newClassroomId)
        .eq("semester", newSemester)
        .order("student_number", { ascending: false })
        .limit(1)
        .maybeSingle();
      const nextNumber = (maxResult?.student_number ?? 0) + 1;

      const { error: enrollError } = await admin.from("enrollments").insert({
        student_id: id,
        classroom_id: newClassroomId,
        student_number: nextNumber,
        semester: newSemester,
      });
      if (enrollError) {
        return {
          error: `ไม่สามารถลงทะเบียนเข้าห้องใหม่: ${enrollError.message}`,
        };
      }

      // Re-sort the destination so the student lands at the right position
      await renumberClassroom(admin, newClassroomId, newSemester);
    }
  }

  revalidatePath("/setup/students");
  redirect("/setup/students");
}

/**
 * Reset a student's password using the Supabase Admin API.
 * Same pattern as the teachers' reset (see Phase 1.9.6).
 */
export async function resetStudentPassword(
  _prev: ResetPasswordState,
  formData: FormData,
): Promise<ResetPasswordState> {
  await requireWriteAccess();
  const guard = await ensureAdmin();
  if (guard) return { ...guard, success: false };

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "ไม่พบ id ของนักเรียน", success: false };

  const password = String(formData.get("password") ?? "");
  if (!password) {
    return {
      error: "กรุณากรอกรหัสผ่านใหม่",
      success: false,
      fieldErrors: { password: "ต้องกรอก" },
    };
  }
  if (password.length < 6) {
    return {
      error: "รหัสผ่านไม่ถูกต้อง",
      success: false,
      fieldErrors: { password: "อย่างน้อย 6 ตัว" },
    };
  }

  const admin = createAdminClient();

  const { data: student, error: findError } = await admin
    .from("students")
    .select("auth_user_id")
    .eq("id", id)
    .maybeSingle();
  if (findError) return { error: findError.message, success: false };
  if (!student?.auth_user_id) {
    return {
      error: "ไม่พบบัญชี auth ของนักเรียนคนนี้",
      success: false,
    };
  }

  const { error: updateError } = await admin.auth.admin.updateUserById(
    student.auth_user_id,
    { password },
  );
  if (updateError) {
    return {
      error: `ไม่สามารถเปลี่ยนรหัสผ่าน: ${updateError.message}`,
      success: false,
    };
  }

  return { error: null, success: true };
}
