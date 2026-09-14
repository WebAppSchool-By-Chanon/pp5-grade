"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button, Field, Input } from "@pp5/ui";
import { School } from "lucide-react";
import { loginAction, type LoginState } from "./actions";

const initialState: LoginState = { error: null };

export type LoginFormSchool = {
  nameTh: string;
  affiliation: string | null;
  logoUrl: string | null;
};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" pending={pending} className="w-full py-2.5">
      {pending ? "กำลังเข้าสู่ระบบ..." : "เข้าสู่ระบบ"}
    </Button>
  );
}

/**
 * Login card — white background with blue accent bar on top + school
 * identity block (logo, ชื่อ, สังกัด) above the system header.
 *
 * If the school row doesn't exist yet (fresh install) the identity
 * block is hidden entirely — falling back to the system header so the
 * page still looks intentional rather than half-rendered.
 *
 * Design tokens:
 *   - Accent bar: primary-600 (sky-600)
 *   - Card: bg-white + soft shadow + ring-primary-100
 *   - Logo frame: circle with primary-50 inner + primary-200 ring
 */
export function LoginForm({ school }: { school: LoginFormSchool | null }) {
  const [state, formAction] = useActionState(loginAction, initialState);

  return (
    <div className="overflow-hidden rounded-2xl bg-white shadow-xl ring-1 ring-primary-100">
      {/* Blue accent strip — subtle brand cue at the top of the card. */}
      <div className="h-1.5 bg-gradient-to-r from-primary-500 via-primary-600 to-primary-700" />

      <div className="px-6 pt-8 pb-7 sm:px-8">
        {/* School identity (logo + name + affiliation). Hidden if no
            school row exists yet — the system header below stands on
            its own. */}
        {school && (
          <div className="mb-6 flex flex-col items-center text-center">
            <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-full bg-primary-50 ring-2 ring-primary-200">
              {school.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={school.logoUrl}
                  alt="โลโก้โรงเรียน"
                  className="max-h-full max-w-full object-contain p-1"
                />
              ) : (
                <School className="h-9 w-9 text-primary-600" aria-hidden />
              )}
            </div>
            <h2 className="mt-3 text-base font-semibold text-zinc-900 sm:text-lg">
              {school.nameTh}
            </h2>
            {school.affiliation && (
              <p className="mt-0.5 text-xs text-zinc-500 sm:text-sm">
                {school.affiliation}
              </p>
            )}
          </div>
        )}

        {/* Divider — only when the identity block is present, so a fresh
            install doesn't get a stray hairline. */}
        {school && (
          <div className="mb-6 h-px bg-gradient-to-r from-transparent via-primary-100 to-transparent" />
        )}

        {/* System header */}
        <div className="mb-6 text-center">
          <h1 className="text-xl font-bold text-zinc-900 sm:text-2xl">
            ระบบบันทึกผลการเรียน
          </h1>
          <p className="mt-1 text-sm text-zinc-500">สำหรับผู้ดูแลและครู</p>
        </div>

        <form action={formAction} className="space-y-4">
          <Field label="ชื่อผู้ใช้หรืออีเมล">
            <Input
              id="username"
              name="username"
              autoComplete="username"
              required
              autoFocus
              placeholder="เช่น admin หรือ school@gmail.com"
            />
          </Field>

          <Field label="รหัสผ่าน">
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              placeholder="••••••••"
            />
          </Field>

          {state.error && (
            <div
              role="alert"
              className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900"
            >
              {state.error}
            </div>
          )}

          <SubmitButton />
        </form>
      </div>
    </div>
  );
}
