"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button, Field, Input, Select } from "@pp5/ui";
import { enrollExistingStudent, type StudentFormState } from "./actions";
import { ThaiDateInput } from "./thai-date-input";

const initialState: StudentFormState = { error: null };

type Action = (
  prev: StudentFormState,
  formData: FormData,
) => Promise<StudentFormState>;

export type ClassroomOption = {
  id: string;
  display_name: string;
  /** "primary" or "secondary" — used to show the semester picker on secondary. */
  system: "primary" | "secondary";
};

type DefaultValues = {
  id?: string;
  student_code?: string;
  title?: string | null;
  first_name?: string;
  last_name?: string;
  gender?: "male" | "female" | null;
  birth_date?: string | null;
  national_id?: string | null;
  classroom_id?: string | null;
  /** Pre-fill the semester picker (1 or 2). */
  semester?: 1 | 2;
};

type Props = {
  action: Action;
  defaultValues?: DefaultValues;
  /** Show password field — true for create, false for edit (separate reset flow). */
  showPassword?: boolean;
  /** When editing, student_code can't be changed (it's the auth identity). */
  lockStudentCode?: boolean;
  submitLabel?: string;
  classrooms: ClassroomOption[];
  /** School's current semester — default for the semester picker on secondary. */
  currentSemester: 1 | 2;
};

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" pending={pending}>
      {pending ? "กำลังบันทึก..." : label}
    </Button>
  );
}

const TITLE_OPTIONS = ["เด็กชาย", "เด็กหญิง", "นาย", "นางสาว"];

export function StudentForm({
  action,
  defaultValues,
  showPassword = true,
  lockStudentCode = false,
  submitLabel = "บันทึก",
  classrooms,
  currentSemester,
}: Props) {
  const [state, formAction] = useActionState(action, initialState);
  // Second action state — used when an existing student is found
  const [enrollState, enrollFormAction] = useActionState(
    enrollExistingStudent,
    initialState,
  );
  // Track the currently-selected classroom so we can show the semester
  // picker only when it's a secondary one.
  const [selectedClassroomId, setSelectedClassroomId] = useState<string>(
    defaultValues?.classroom_id ?? "",
  );
  const selectedClassroom = classrooms.find(
    (c) => c.id === selectedClassroomId,
  );
  const isSecondary = selectedClassroom?.system === "secondary";

  // Classroom selector state for the re-enrollment form
  const [enrollClassroomId, setEnrollClassroomId] = useState("");
  const enrollClassroom = classrooms.find((c) => c.id === enrollClassroomId);
  const isEnrollSecondary = enrollClassroom?.system === "secondary";

  // ── Existing student found: show re-enrollment form ───────────────────────
  if (state.existingStudent && !lockStudentCode) {
    const s = state.existingStudent;
    return (
      <div className="space-y-5">
        {/* Info card */}
        <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <span className="mt-0.5 text-lg text-amber-500" aria-hidden>⚠️</span>
          <div>
            <p className="font-semibold text-amber-900">พบนักเรียนรหัสนี้ในระบบแล้ว</p>
            <p className="mt-1 text-sm text-zinc-700">
              {s.title ?? ""}{s.first_name} {s.last_name}{" "}
              <span className="font-mono text-xs text-zinc-500">({s.student_code})</span>
            </p>
            <p className="mt-1 text-xs text-amber-700">
              นักเรียนนี้ถูกลบออกจากห้องก่อนหน้า · เลือกห้องเรียนเพื่อจัดเข้าใหม่
            </p>
          </div>
        </div>

        {/* Re-enrollment form */}
        <form action={enrollFormAction} className="space-y-4">
          <input type="hidden" name="student_id" value={s.id} />

          <fieldset className="space-y-4">
            <legend className="text-sm font-semibold text-zinc-900">ห้องเรียน</legend>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field
                label="เลือกห้อง"
                required
                hint={
                  classrooms.length === 0
                    ? "ยังไม่มีห้องในปีปัจจุบัน"
                    : "เลือก → ระบบ assign เลขที่ถัดไปอัตโนมัติ"
                }
              >
                <Select
                  name="classroom_id"
                  value={enrollClassroomId}
                  onChange={(e) => setEnrollClassroomId(e.target.value)}
                  required
                  disabled={classrooms.length === 0}
                >
                  <option value="">— เลือกห้อง —</option>
                  {classrooms.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.display_name}
                      {c.system === "secondary" ? " (มัธยม)" : ""}
                    </option>
                  ))}
                </Select>
              </Field>

              {isEnrollSecondary && (
                <Field
                  label="ภาคเรียน"
                  hint="มัธยมเก็บแยกรายภาคเรียน"
                >
                  <Select
                    name="semester"
                    defaultValue={String(currentSemester)}
                  >
                    <option value="1">ภาคเรียนที่ 1</option>
                    <option value="2">ภาคเรียนที่ 2</option>
                  </Select>
                </Field>
              )}
            </div>
          </fieldset>

          {enrollState.error && (
            <div
              role="alert"
              className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900"
            >
              ❌ {enrollState.error}
            </div>
          )}

          <div className="flex items-center gap-3 border-t border-zinc-200 pt-4">
            <SubmitButton label="จัดเข้าห้องเรียน" />
            <Link
              href="/setup/students/new"
              className="text-sm font-medium text-zinc-700 hover:text-zinc-900"
            >
              กรอกใหม่
            </Link>
          </div>
        </form>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-8">
      {defaultValues?.id && (
        <input type="hidden" name="id" value={defaultValues.id} />
      )}

      <fieldset className="space-y-4">
        <legend className="text-sm font-semibold text-zinc-900">
          ข้อมูลบัญชี
        </legend>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            label="รหัสนักเรียน"
            required
            error={state.fieldErrors?.student_code}
            hint={
              lockStudentCode
                ? "ไม่สามารถแก้ได้หลังสร้าง"
                : "a-z, 0-9 เท่านั้น · ใช้ login ใน apps/parent"
            }
          >
            <Input
              name="student_code"
              required
              autoComplete="off"
              defaultValue={defaultValues?.student_code ?? ""}
              readOnly={lockStudentCode}
              autoFocus={!lockStudentCode}
              placeholder="เช่น 66012345"
              invalid={!!state.fieldErrors?.student_code}
            />
          </Field>

          {showPassword && (
            <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-800">
              รหัสผ่านเริ่มต้น{" "}
              <strong className="font-mono">123456</strong> — นักเรียนเปลี่ยนเองได้ภายหลังในแอปนักเรียน
            </div>
          )}
        </div>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="text-sm font-semibold text-zinc-900">
          ข้อมูลส่วนตัว
        </legend>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          <Field label="คำนำหน้า">
            <Select name="title" defaultValue={defaultValues?.title ?? ""}>
              <option value="">—</option>
              {TITLE_OPTIONS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="ชื่อ" required error={state.fieldErrors?.first_name}>
            <Input
              name="first_name"
              required
              defaultValue={defaultValues?.first_name ?? ""}
              placeholder="ชื่อจริง"
            />
          </Field>

          <Field
            label="นามสกุล"
            required
            error={state.fieldErrors?.last_name}
          >
            <Input
              name="last_name"
              required
              defaultValue={defaultValues?.last_name ?? ""}
              placeholder="นามสกุล"
            />
          </Field>

          <Field label="เพศ">
            <Select name="gender" defaultValue={defaultValues?.gender ?? ""}>
              <option value="">—</option>
              <option value="male">ชาย</option>
              <option value="female">หญิง</option>
            </Select>
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="วันเกิด">
            <ThaiDateInput
              name="birth_date"
              defaultValue={defaultValues?.birth_date}
            />
          </Field>
          <Field
            label="เลขประจำตัวประชาชน"
            error={state.fieldErrors?.national_id}
            hint="13 หลัก · optional"
          >
            <Input
              name="national_id"
              inputMode="numeric"
              maxLength={13}
              defaultValue={defaultValues?.national_id ?? ""}
              placeholder="optional"
              invalid={!!state.fieldErrors?.national_id}
            />
          </Field>
        </div>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="text-sm font-semibold text-zinc-900">
          ห้องเรียน
        </legend>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            label="เลือกห้อง"
            hint={
              classrooms.length === 0
                ? "ยังไม่มีห้องในปีปัจจุบัน · ไปเพิ่มที่ /setup/classrooms ก่อน"
                : "เลือก → ระบบ assign เลขที่ถัดไปอัตโนมัติ"
            }
          >
            <Select
              name="classroom_id"
              value={selectedClassroomId}
              onChange={(e) => setSelectedClassroomId(e.target.value)}
              disabled={classrooms.length === 0}
            >
              <option value="">— ไม่ระบุห้อง —</option>
              {classrooms.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.display_name}
                  {c.system === "secondary" ? " (มัธยม)" : ""}
                </option>
              ))}
            </Select>
          </Field>

          {isSecondary && (
            <Field
              label="ภาคเรียน"
              hint="มัธยมเก็บแยกรายภาคเรียน · ประถมระบบจะใช้ทั้งปีให้อัตโนมัติ"
            >
              <Select
                name="semester"
                defaultValue={String(defaultValues?.semester ?? currentSemester)}
              >
                <option value="1">ภาคเรียนที่ 1</option>
                <option value="2">ภาคเรียนที่ 2</option>
              </Select>
            </Field>
          )}
        </div>
      </fieldset>

      {state.error && !state.fieldErrors && (
        <div
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900"
        >
          {state.error}
        </div>
      )}

      <div className="flex items-center gap-3 border-t border-zinc-200 pt-4">
        <SubmitButton label={submitLabel} />
        <Link
          href="/setup/students"
          className="text-sm font-medium text-zinc-700 hover:text-zinc-900"
        >
          ยกเลิก
        </Link>
      </div>
    </form>
  );
}
