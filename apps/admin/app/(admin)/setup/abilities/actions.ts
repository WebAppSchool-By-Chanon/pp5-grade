"use server";

import { createAdminClient } from "@pp5/database/admin";
import { revalidatePath } from "next/cache";
import { requireWriteAccess } from "@/lib/access";
import { ABILITY_COLUMNS, type AbilityField } from "@/lib/ability-eval";
import { getCurrentTerm } from "@/lib/current-term";
import {
  ensureCanEditAsHomeroom,
} from "@/lib/teacher-scope";

type AdminClient = ReturnType<typeof createAdminClient>;

function parseScore(raw: string): number | null {
  if (raw === "") return null;
  if (!/^[0-3]$/.test(raw)) throw new Error("คะแนนต้องเป็น 0–3");
  return Number(raw);
}

function parseField(raw: string): AbilityField {
  const field = ABILITY_COLUMNS.find((column) => column.field === raw)?.field;
  if (!field) throw new Error("ด้านความสามารถไม่ถูกต้อง");
  return field;
}

async function requireCurrentYear(yearId: string) {
  const term = await getCurrentTerm();
  if (!term || yearId !== term.yearId) {
    throw new Error("บันทึกได้เฉพาะปีการศึกษาปัจจุบัน");
  }
  return term;
}

/** Insert only a missing row. If another save created it first, update just
 * this field so concurrent edits to other domains are not overwritten. */
async function insertMissingScore(
  admin: AdminClient,
  studentId: string,
  yearId: string,
  field: AbilityField,
  score: number | null,
): Promise<void> {
  if (score === null) return;
  const { error } = await admin.from("ability_evaluations").insert({
    student_id: studentId,
    academic_year_id: yearId,
    [field]: score,
  });
  if (!error) return;
  if (error.code !== "23505") throw new Error(error.message);
  const { data: updated, error: retryError } = await admin
    .from("ability_evaluations")
    .update({ [field]: score })
    .eq("student_id", studentId)
    .eq("academic_year_id", yearId)
    .select("student_id");
  if (retryError) throw new Error(retryError.message);
  if (!updated?.length) throw new Error("ไม่สามารถบันทึกคะแนนนักเรียนได้");
}

/** Save one student's score in one of the eight annual domains. */
export async function saveAbilityScore(formData: FormData): Promise<void> {
  await requireWriteAccess();
  const studentId = String(formData.get("student_id") ?? "").trim();
  const classroomId = String(formData.get("classroom_id") ?? "").trim();
  const yearId = String(formData.get("year_id") ?? "").trim();
  const field = parseField(String(formData.get("field") ?? "").trim());
  const score = parseScore(String(formData.get("score") ?? "").trim());
  if (!studentId || !classroomId || !yearId) throw new Error("ไม่พบนักเรียน ห้อง หรือปีการศึกษา");
  const term = await requireCurrentYear(yearId);

  const admin = createAdminClient();
  await ensureCanEditAsHomeroom(admin, classroomId);
  const { data: classroom, error: classroomError } = await admin
    .from("classrooms")
    .select("academic_year_id, grade_level:grade_levels!grade_level_id(system)")
    .eq("id", classroomId)
    .maybeSingle();
  if (classroomError) throw new Error(classroomError.message);
  if (!classroom || classroom.academic_year_id !== yearId) {
    throw new Error("ห้องเรียนไม่ตรงกับปีการศึกษาปัจจุบัน");
  }
  const semester = classroom.grade_level?.system === "secondary" ? term.semester : 0;
  const { data: enrollment, error: enrollmentError } = await admin
    .from("enrollments")
    .select("id")
    .eq("student_id", studentId)
    .eq("classroom_id", classroomId)
    .eq("semester", semester)
    .maybeSingle();
  if (enrollmentError) throw new Error(enrollmentError.message);
  if (!enrollment) {
    throw new Error("นักเรียนไม่ได้อยู่ในห้องเรียนนี้");
  }

  const { data: updated, error } = await admin
    .from("ability_evaluations")
    .update({ [field]: score })
    .eq("student_id", studentId)
    .eq("academic_year_id", yearId)
    .select("student_id");
  if (error) throw new Error(error.message);
  if (!updated?.length) {
    await insertMissingScore(admin, studentId, yearId, field, score);
  }
  revalidatePath("/setup/abilities");
}

/** Set or clear one domain for the students shown in a classroom. */
export async function setAllAbilitiesForColumn(
  formData: FormData,
): Promise<void> {
  await requireWriteAccess();
  const classroomId = String(formData.get("classroom_id") ?? "").trim();
  const yearId = String(formData.get("year_id") ?? "").trim();
  const field = parseField(String(formData.get("field") ?? "").trim());
  const score = parseScore(String(formData.get("value") ?? "").trim());
  if (!classroomId || !yearId) throw new Error("ไม่พบห้องหรือปีการศึกษา");
  const term = await requireCurrentYear(yearId);

  const admin = createAdminClient();
  await ensureCanEditAsHomeroom(admin, classroomId);
  const { data: classroom, error: classroomError } = await admin
    .from("classrooms")
    .select("academic_year_id, grade_level:grade_levels!grade_level_id(system)")
    .eq("id", classroomId)
    .maybeSingle();
  if (classroomError) throw new Error(classroomError.message);
  if (!classroom || classroom.academic_year_id !== yearId) {
    throw new Error("ห้องเรียนไม่ตรงกับปีการศึกษาปัจจุบัน");
  }

  const semester = classroom.grade_level?.system === "secondary" ? term.semester : 0;
  const { data: enrollments, error: enrollmentError } = await admin
    .from("enrollments")
    .select("student_id")
    .eq("classroom_id", classroomId)
    .eq("semester", semester);
  if (enrollmentError) throw new Error(enrollmentError.message);
  const studentIds = Array.from(new Set<string>(
    (enrollments ?? []).map((row: { student_id: string }) => row.student_id),
  ));
  if (studentIds.length === 0) return;

  const { data: updated, error } = await admin
    .from("ability_evaluations")
    .update({ [field]: score })
    .eq("academic_year_id", yearId)
    .in("student_id", studentIds)
    .select("student_id");
  if (error) throw new Error(error.message);
  const updatedIds = new Set<string>(
    (updated ?? []).map((row: { student_id: string }) => row.student_id),
  );
  const missingIds = studentIds.filter((id) => !updatedIds.has(id));
  // Keep the request burst bounded for large classrooms.
  for (let index = 0; index < missingIds.length; index += 8) {
    await Promise.all(
      missingIds.slice(index, index + 8).map((id) =>
        insertMissingScore(admin, id, yearId, field, score),
      ),
    );
  }
  revalidatePath("/setup/abilities");
}
