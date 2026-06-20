"use server";

import { createAdminClient } from "@pp5/database/admin";
import { getCurrentUser } from "@pp5/database/queries";
import ExcelJS from "exceljs";
import { revalidatePath } from "next/cache";
import { requireWriteAccess } from "@/lib/access";
import { renumberClassroom } from "../_renumber";

const STUDENT_DOMAIN = "student.pp5.local";

// ============================================================
// Types — shared between parse step and commit step
// ============================================================

export type ImportRow = {
  rowNumber: number;
  student_code: string;
  title: string | null;
  first_name: string;
  last_name: string;
  grade_raw: string;
  room_raw: string;
  classroom_id: string | null;
  classroom_label: string;
  /** Auto-assigned at parse time based on grade.system:
   *    primary   → 0 (year-wide)
   *    secondary → academic_year.current_semester (1 or 2)
   *  Used by commitStudentImportBatch when inserting the enrollment row,
   *  and by renumberClassroom to scope numbering per (classroom, semester). */
  semester: 0 | 1 | 2;
  /** If non-null, a `students` row with this id already exists for this
   *  `student_code` and has NO enrollment in the target (classroom, semester).
   *  commitStudentImportBatch will reuse the existing student record (skip
   *  auth.users + students.insert) and only add the enrollment row.
   *  Use case: admin deleted enrollments earlier (which doesn't delete the
   *  student record — by design, to preserve historical scores) and now
   *  wants to re-enroll the same students. */
  existing_student_id: string | null;
};

export type FailureKind =
  | "missing_fields"
  | "invalid_title"
  | "duplicate_in_db"
  | "duplicate_in_file"
  | "invalid_classroom";

export type ImportFailedRow = ImportRow & {
  kind: FailureKind;
  reason: string;
};

export type PreviewResult =
  | {
      ok: true;
      totalRows: number;
      yearBe: number;
      valid: ImportRow[];
      duplicates: ImportFailedRow[];
      invalidClassroom: ImportFailedRow[];
      missingFields: ImportFailedRow[];
    }
  | { ok: false; error: string };

export type ImportResult = {
  succeeded: number;
  failed: Array<{
    rowNumber: number;
    student_code: string;
    reason: string;
  }>;
};

/** (classroom, semester) pair whose enrollment numbering may need a refresh
 *  after batch commit. Caller dedupes across batches and passes the merged
 *  list to `finalizeStudentImport`. */
export type AffectedScope = {
  classroomId: string;
  semester: 0 | 1 | 2;
};

export type BatchResult = {
  succeeded: number;
  failed: ImportResult["failed"];
  /** (classroom, semester) pairs that received new enrollments in this batch.
   *  Caller passes the deduped list to `finalizeStudentImport` after all
   *  batches finish. */
  affectedScopes: AffectedScope[];
};

// ============================================================
// Helpers
// ============================================================

/**
 * Accept both the full form and common abbreviations. Returns the canonical
 * full form so the DB is consistent with what the single-student form stores.
 */
function normalizeTitle(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  if (t === "เด็กชาย") return "เด็กชาย";
  if (t === "เด็กหญิง") return "เด็กหญิง";
  if (t === "นาย") return "นาย";
  if (t === "นางสาว") return "นางสาว";
  if (t === "นาง") return "นาง";
  // Strip dots/spaces and re-test abbreviations
  const cleaned = t.replace(/[.\s]/g, "");
  if (cleaned === "ดช") return "เด็กชาย";
  if (cleaned === "ดญ") return "เด็กหญิง";
  if (cleaned === "นส") return "นางสาว";
  return null;
}

/** Canonical key for grade lookup — "ป.1"/"ป1"/"ป. 1" all → "ป1". */
function gradeKey(raw: string): string {
  return raw.trim().replace(/[.\s]/g, "");
}

/** Default password for every new student — fixed "123456" (meets Supabase
 *  6-char min). Students change it themselves later in the student app.
 *  User spec 2026-06-05 (was student_code padded). */
function defaultPassword(): string {
  return "123456";
}

/** Get cell value as a clean string (handles number/Date/RichText). */
function cellString(cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  // RichText / Formula / SharedFormula
  const obj = v as { richText?: Array<{ text?: string }>; result?: unknown };
  if (obj.richText && Array.isArray(obj.richText)) {
    return obj.richText.map((r) => r.text ?? "").join("").trim();
  }
  if (obj.result != null) return String(obj.result).trim();
  return String(v).trim();
}

/**
 * Re-number student_number sequentially (1, 2, 3, ...) within a
 * (classroom, semester) scope, sorted by `student_code` ASC. Mirrors the
 * helper in `../actions.ts`.
 *
 * Scoping by semester is required because UNIQUE on `enrollments` is now
 * (classroom_id, semester, student_number) — renumbering across semesters
 * would collide.
 */
async function ensureAdmin(): Promise<string | null> {
  const auth = await getCurrentUser();
  if (!auth || auth.profile.role !== "admin") {
    return "ไม่มีสิทธิ์ในการดำเนินการ";
  }
  return null;
}

// ============================================================
// parseStudentImport — accepts the uploaded file + returns preview
// ============================================================

export async function parseStudentImport(
  formData: FormData,
): Promise<PreviewResult> {
  await requireWriteAccess();
  const authErr = await ensureAdmin();
  if (authErr) return { ok: false, error: authErr };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "ไม่ได้แนบไฟล์" };
  }
  if (file.size > 5 * 1024 * 1024) {
    return { ok: false, error: "ไฟล์ใหญ่เกินไป (จำกัด 5MB)" };
  }

  const admin = createAdminClient();

  // Current academic year — import targets this. We also pull
  // `current_semester` so secondary rows can be auto-tagged to the active
  // term (1 or 2). Primary rows always get semester=0 (year-wide).
  const { data: currentYear } = await admin
    .from("academic_years")
    .select("id, year_be, current_semester")
    .eq("is_current", true)
    .maybeSingle();
  if (!currentYear) {
    return {
      ok: false,
      error: "ยังไม่มีปีการศึกษาปัจจุบัน · ไปตั้งค่าก่อน",
    };
  }
  const currentSemester: 1 | 2 =
    currentYear.current_semester === 2 ? 2 : 1;

  // Build classroom map: "ป.1|1" → { id, label, system }
  // We pull `system` so each row's semester can be derived per (grade) at
  // commit time. Auto-assignment:
  //   primary   → semester=0
  //   secondary → semester=currentSemester
  const { data: classrooms } = await admin
    .from("classrooms")
    .select(
      `id, room_number, grade_level:grade_levels!grade_level_id (name_short, system)`,
    )
    .eq("academic_year_id", currentYear.id);

  type ClassroomInfo = {
    id: string;
    label: string;
    system: "primary" | "secondary";
  };
  const classroomMap = new Map<string, ClassroomInfo>();
  // Track total rooms per grade (for nicer label display: "ป.1" vs "ป.1/2")
  const roomCountByGrade = new Map<string, number>();
  for (const c of classrooms ?? []) {
    const gradeShort = c.grade_level?.name_short ?? "";
    if (!gradeShort) continue;
    roomCountByGrade.set(
      gradeShort,
      (roomCountByGrade.get(gradeShort) ?? 0) + 1,
    );
  }
  // Default classroom for grades with exactly 1 room — used when the user
  // leaves the "ห้อง" column blank in their Excel.
  const defaultClassroomByGrade = new Map<string, ClassroomInfo>();
  for (const c of classrooms ?? []) {
    const gradeShort = c.grade_level?.name_short ?? "";
    const system = c.grade_level?.system;
    if (!gradeShort || (system !== "primary" && system !== "secondary"))
      continue;
    const key = `${gradeKey(gradeShort)}|${c.room_number}`;
    const totalRooms = roomCountByGrade.get(gradeShort) ?? 1;
    const label =
      totalRooms <= 1 ? gradeShort : `${gradeShort}/${c.room_number}`;
    classroomMap.set(key, { id: c.id, label, system });
    if (totalRooms === 1) {
      defaultClassroomByGrade.set(gradeKey(gradeShort), {
        id: c.id,
        label,
        system,
      });
    }
  }
  // Track which grade keys exist at all (for better error messages when the
  // user leaves room blank on a multi-room grade).
  const knownGradeKeys = new Set<string>();
  for (const k of classroomMap.keys()) {
    knownGradeKeys.add(k.split("|")[0]);
  }

  // Existing students — we need `id` too because rows whose student_code
  // already exists in the table may still be importable as a re-enrollment
  // (if they have no enrollment in the target (classroom, semester) yet).
  // Delete-from-list is unlink-only — student records persist for history
  // — so a typical re-import after bulk-delete should succeed by reusing
  // the existing record rather than failing as "duplicate".
  const { data: existingStudents } = await admin
    .from("students")
    .select("id, student_code");
  const studentIdByCode = new Map<string, string>();
  for (const s of existingStudents ?? []) {
    studentIdByCode.set(s.student_code, s.id);
  }

  // For existing students, fetch which (classroom, semester) scopes they're
  // CURRENTLY enrolled in within this academic year. A re-enroll into a
  // scope that's NOT in this set is allowed; into a scope that IS in this
  // set is rejected as a genuine duplicate.
  const studentIds = Array.from(studentIdByCode.values());
  const currentYearClassroomIds = Array.from(classroomMap.values()).map(
    (c) => c.id,
  );
  const enrolledScopeByStudent = new Map<string, Set<string>>();
  if (studentIds.length > 0 && currentYearClassroomIds.length > 0) {
    const { data: enrollmentsThisYear } = await admin
      .from("enrollments")
      .select("student_id, classroom_id, semester")
      .in("student_id", studentIds)
      .in("classroom_id", currentYearClassroomIds);
    for (const e of enrollmentsThisYear ?? []) {
      const key = `${e.classroom_id}|${e.semester}`;
      let set = enrolledScopeByStudent.get(e.student_id);
      if (!set) {
        set = new Set();
        enrolledScopeByStudent.set(e.student_id, set);
      }
      set.add(key);
    }
  }

  // Read the Excel file — pass ArrayBuffer directly (avoids Buffer<ArrayBuffer>
  // generic mismatch with exceljs's older Buffer typing).
  const arrayBuffer = await file.arrayBuffer();
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(arrayBuffer);
  } catch {
    return { ok: false, error: "ไฟล์ Excel เปิดไม่ได้ — ตรวจสอบรูปแบบ .xlsx" };
  }

  // Use the first worksheet — typically the "นักเรียน" sheet from the template
  const ws = wb.worksheets[0];
  if (!ws) return { ok: false, error: "ไม่พบ worksheet ในไฟล์" };

  const valid: ImportRow[] = [];
  const duplicates: ImportFailedRow[] = [];
  const invalidClassroom: ImportFailedRow[] = [];
  const missingFields: ImportFailedRow[] = [];

  // Track student_codes seen inside the file (detects duplicate-in-file)
  const seenCodes = new Map<string, number>();

  let totalRows = 0;

  ws.eachRow((row, rowNumber) => {
    // Skip header (row 1) — by convention from the template
    if (rowNumber === 1) return;

    const student_code = cellString(row.getCell(1));
    const titleRaw = cellString(row.getCell(2));
    const first_name = cellString(row.getCell(3));
    const last_name = cellString(row.getCell(4));
    const grade_raw = cellString(row.getCell(5));
    const room_raw = cellString(row.getCell(6));

    // Skip wholly-blank rows silently (e.g., trailing empty rows)
    if (
      !student_code &&
      !titleRaw &&
      !first_name &&
      !last_name &&
      !grade_raw &&
      !room_raw
    ) {
      return;
    }

    totalRows++;

    // Build the partial row (will be enriched below)
    const partial: ImportRow = {
      rowNumber,
      student_code,
      title: null,
      first_name,
      last_name,
      grade_raw,
      room_raw,
      classroom_id: null,
      classroom_label: "",
      semester: 0, // overwritten once we resolve the classroom (line ~360)
      existing_student_id: null, // set in duplicate check if applicable
    };

    // 1. Missing fields (room is OPTIONAL — handled below based on grade)
    const missing: string[] = [];
    if (!student_code) missing.push("เลขประจำตัว");
    if (!first_name) missing.push("ชื่อ");
    if (!last_name) missing.push("นามสกุล");
    if (!grade_raw) missing.push("ชั้น");
    if (missing.length > 0) {
      missingFields.push({
        ...partial,
        kind: "missing_fields",
        reason: `ขาด: ${missing.join(", ")}`,
      });
      return;
    }

    // 2. Title — required + must be recognized
    if (!titleRaw) {
      missingFields.push({
        ...partial,
        kind: "missing_fields",
        reason: "ขาด: คำนำหน้า",
      });
      return;
    }
    const title = normalizeTitle(titleRaw);
    if (!title) {
      missingFields.push({
        ...partial,
        kind: "invalid_title",
        reason: `คำนำหน้า "${titleRaw}" ไม่รู้จัก`,
      });
      return;
    }
    partial.title = title;

    // 3. Classroom lookup — handle three cases:
    //    a. Room blank → only valid if the grade has exactly 1 room
    //    b. Room is given but isn't a number
    //    c. Room is given as a number — look up directly
    //
    // Once a classroom is resolved we also derive `semester`:
    //   primary   → 0
    //   secondary → currentSemester
    // For secondary rows we append " ภาค N" to the label so the preview
    // makes the destination term obvious.
    let resolvedClassroom: ClassroomInfo | null = null;
    const gKey = gradeKey(grade_raw);
    if (!room_raw) {
      const fallback = defaultClassroomByGrade.get(gKey);
      if (fallback) {
        resolvedClassroom = fallback;
      } else if (knownGradeKeys.has(gKey)) {
        invalidClassroom.push({
          ...partial,
          kind: "invalid_classroom",
          reason: `ชั้น "${grade_raw}" มีหลายห้อง — ต้องระบุห้อง`,
        });
        return;
      } else {
        invalidClassroom.push({
          ...partial,
          kind: "invalid_classroom",
          reason: `ไม่พบชั้น "${grade_raw}" ในปีปัจจุบัน`,
        });
        return;
      }
    } else {
      const roomNum = Number.parseInt(room_raw, 10);
      if (!Number.isFinite(roomNum)) {
        invalidClassroom.push({
          ...partial,
          kind: "invalid_classroom",
          reason: `ห้อง "${room_raw}" ไม่ใช่ตัวเลข`,
        });
        return;
      }
      const classroom = classroomMap.get(`${gKey}|${roomNum}`);
      if (!classroom) {
        invalidClassroom.push({
          ...partial,
          kind: "invalid_classroom",
          reason: `ไม่พบห้องเรียน "${grade_raw}/${roomNum}" ในปีปัจจุบัน`,
        });
        return;
      }
      resolvedClassroom = classroom;
    }
    partial.classroom_id = resolvedClassroom.id;
    partial.semester =
      resolvedClassroom.system === "secondary" ? currentSemester : 0;
    // Append " ภาค N" to the label for secondary rows so the preview shows
    // each row's destination term at a glance.
    partial.classroom_label =
      resolvedClassroom.system === "secondary"
        ? `${resolvedClassroom.label} ภาคเรียนที่ ${partial.semester}`
        : resolvedClassroom.label;

    // 4. Duplicate checks
    //
    // (a) Same code appears twice within the uploaded file — block; the
    //     second occurrence will lose to whichever row came first.
    if (seenCodes.has(student_code)) {
      duplicates.push({
        ...partial,
        kind: "duplicate_in_file",
        reason: `ซ้ำกับแถวที่ ${seenCodes.get(student_code)} ในไฟล์`,
      });
      return;
    }
    seenCodes.set(student_code, rowNumber);

    // (b) Existing student record in DB — two sub-cases:
    //
    //     i. Already enrolled in EXACTLY the target (classroom, semester)
    //        → genuine duplicate, block.
    //    ii. Exists but NOT enrolled in the target scope → re-enrollment:
    //        we'll reuse the student record (no new auth.users / students
    //        insert) and just add the enrollment row at commit time.
    //
    // Case (ii) covers the common workflow of bulk-delete + re-import,
    // since delete is unlink-only by design (preserves historical scores).
    const existingStudentId = studentIdByCode.get(student_code);
    if (existingStudentId && partial.classroom_id) {
      const targetKey = `${partial.classroom_id}|${partial.semester}`;
      const enrolledScopes = enrolledScopeByStudent.get(existingStudentId);
      if (enrolledScopes?.has(targetKey)) {
        duplicates.push({
          ...partial,
          kind: "duplicate_in_db",
          reason: "เลขประจำตัวนี้มีในห้อง/ภาคนี้อยู่แล้ว",
        });
        return;
      }
      // Re-enrollment — student exists but not in this scope. Flag for
      // commit to reuse the record; the row passes preview as a normal
      // valid row (no label decoration per user preference).
      partial.existing_student_id = existingStudentId;
    }

    // 5. Valid!
    valid.push(partial);
  });

  return {
    ok: true,
    totalRows,
    yearBe: currentYear.year_be,
    valid,
    duplicates,
    invalidClassroom,
    missingFields,
  };
}

// ============================================================
// commitStudentImportBatch — process one chunk of rows
//
// The client splits valid rows into small batches (typically 5) and calls
// this action per batch so it can show a progress bar. Renumbering is NOT
// done here — call `finalizeStudentImport` once after all batches finish.
// ============================================================

export async function commitStudentImportBatch(
  rows: ImportRow[],
): Promise<BatchResult> {
  await requireWriteAccess();
  const authErr = await ensureAdmin();
  if (authErr) {
    return {
      succeeded: 0,
      failed: rows.map((r) => ({
        rowNumber: r.rowNumber,
        student_code: r.student_code,
        reason: authErr,
      })),
      affectedScopes: [],
    };
  }

  const admin = createAdminClient();

  // Re-check existing student records server-side (DB may have changed
  // since parse — another admin could have inserted in the gap). We pull
  // `id` too so re-enrollment rows can reuse the existing record without
  // creating a fresh auth.users / students pair.
  const { data: existingStudents } = await admin
    .from("students")
    .select("id, student_code");
  const studentIdByCode = new Map<string, string>();
  for (const s of existingStudents ?? []) {
    studentIdByCode.set(s.student_code, s.id);
  }

  // Cache `max(student_number)` per (classroom, semester) scope to skip
  // repeated queries when many rows go to the same scope. Key format:
  // `${classroomId}|${semester}` so primary (sem=0) and secondary (sem=1|2)
  // don't share numbering.
  const maxByScope = new Map<string, number>();
  const scopeKey = (classroomId: string, semester: 0 | 1 | 2) =>
    `${classroomId}|${semester}`;

  const failed: ImportResult["failed"] = [];
  /** Set of "classroomId|semester" keys touched in this batch. Caller
   *  parses these back into AffectedScope objects in the response. */
  const affectedScopeKeys = new Set<string>();
  let succeeded = 0;

  for (const r of rows) {
    if (!r.classroom_id) {
      failed.push({
        rowNumber: r.rowNumber,
        student_code: r.student_code,
        reason: "ไม่มี classroom_id (ไม่ควรเกิด)",
      });
      continue;
    }

    // Two paths into this loop:
    //   - Re-enrollment: `r.existing_student_id` is set OR `student_code`
    //     was matched in the freshly-fetched map above. Reuse the existing
    //     students row — skip auth.users + students.insert.
    //   - Brand new student: create auth.users → create students row →
    //     enrollment. Cleanup orphaned auth user on failure.
    //
    // We re-check `studentIdByCode` here (not just `r.existing_student_id`)
    // so a row that PARSED as "new" but races against another admin's
    // insert mid-batch still falls into the re-enroll path instead of
    // failing with "user already exists" from the auth API.
    const reuseStudentId =
      r.existing_student_id ?? studentIdByCode.get(r.student_code) ?? null;

    let studentRowId: string;
    let createdAuthUserId: string | null = null; // for rollback on failure

    if (reuseStudentId) {
      // Re-enroll path — student already in DB. Optionally refresh their
      // name fields in case the Excel has corrections (e.g., admin updated
      // a misspelled name). Cheap update, swallow errors.
      await admin
        .from("students")
        .update({
          title: r.title,
          first_name: r.first_name,
          last_name: r.last_name,
        })
        .eq("id", reuseStudentId);
      studentRowId = reuseStudentId;
    } else {
      // Step 1: auth user
      const email = `${r.student_code}@${STUDENT_DOMAIN}`;
      const password = defaultPassword();
      const { data: authData, error: authError } =
        await admin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
        });
      if (authError || !authData.user) {
        failed.push({
          rowNumber: r.rowNumber,
          student_code: r.student_code,
          reason: `auth: ${authError?.message ?? "ไม่สามารถสร้างบัญชี"}`,
        });
        continue;
      }
      createdAuthUserId = authData.user.id;

      // Step 2: students record
      const { data: studentRow, error: studentError } = await admin
        .from("students")
        .insert({
          auth_user_id: createdAuthUserId,
          student_code: r.student_code,
          title: r.title,
          first_name: r.first_name,
          last_name: r.last_name,
        })
        .select("id")
        .single();
      if (studentError || !studentRow) {
        await admin.auth.admin.deleteUser(createdAuthUserId);
        failed.push({
          rowNumber: r.rowNumber,
          student_code: r.student_code,
          reason: `students: ${studentError?.message ?? "บันทึกล้มเหลว"}`,
        });
        continue;
      }
      studentRowId = studentRow.id;
    }

    // Step 3: enrollment — compute next student_number per (classroom, sem)
    // scope, using the cache. UNIQUE on enrollments is now
    // (classroom_id, semester, student_number), so numbering is per-scope.
    const key = scopeKey(r.classroom_id, r.semester);
    let cached = maxByScope.get(key);
    if (cached === undefined) {
      const { data: maxRes } = await admin
        .from("enrollments")
        .select("student_number")
        .eq("classroom_id", r.classroom_id)
        .eq("semester", r.semester)
        .order("student_number", { ascending: false })
        .limit(1)
        .maybeSingle();
      cached = maxRes?.student_number ?? 0;
    }
    const nextNumber = cached + 1;
    maxByScope.set(key, nextNumber);

    const { error: enrollError } = await admin.from("enrollments").insert({
      student_id: studentRowId,
      classroom_id: r.classroom_id,
      student_number: nextNumber,
      semester: r.semester,
    });
    if (enrollError) {
      // Roll back cache. For brand-new rows we also need to clean up the
      // orphaned students + auth user we just created; for re-enroll rows
      // we leave the existing record alone (it was there before this
      // batch and may have other valid enrollments in other scopes).
      maxByScope.set(key, cached);
      if (createdAuthUserId) {
        await admin.from("students").delete().eq("id", studentRowId);
        await admin.auth.admin.deleteUser(createdAuthUserId);
      }
      failed.push({
        rowNumber: r.rowNumber,
        student_code: r.student_code,
        reason: `enrollments: ${enrollError.message}`,
      });
      continue;
    }

    succeeded++;
    // Mark this code as "now in DB" so subsequent rows in the same batch
    // that happen to share the code (shouldn't, but defensively) fall
    // into the re-enroll path rather than re-creating.
    studentIdByCode.set(r.student_code, studentRowId);
    affectedScopeKeys.add(key);
  }

  // Expand the deduped scope keys back into objects for the caller.
  const affectedScopes: AffectedScope[] = Array.from(affectedScopeKeys).map(
    (k) => {
      const [classroomId, semStr] = k.split("|");
      return {
        classroomId,
        semester: Number(semStr) as 0 | 1 | 2,
      };
    },
  );

  return {
    succeeded,
    failed,
    affectedScopes,
  };
}

// ============================================================
// finalizeStudentImport — re-number all affected classrooms + revalidate
// ============================================================

export async function finalizeStudentImport(
  scopes: AffectedScope[],
): Promise<{ ok: boolean }> {
  await requireWriteAccess();
  const authErr = await ensureAdmin();
  if (authErr) return { ok: false };

  const admin = createAdminClient();
  // Each scope is a (classroom, semester) pair — renumber it independently
  // since UNIQUE on enrollments is now per-(classroom, semester).
  for (const s of scopes) {
    await renumberClassroom(admin, s.classroomId, s.semester);
  }

  revalidatePath("/setup/students");
  return { ok: true };
}
