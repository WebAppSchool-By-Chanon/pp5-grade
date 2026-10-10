import { getCurrentUser } from "@pp5/database/queries";
import { createClient } from "@pp5/database/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AttendanceProgress } from "../_components/attendance-progress";

export default async function AttendanceProgressPage() {
  const auth = await getCurrentUser();
  if (!auth) redirect("/login");
  if (auth.profile.role !== "admin") redirect("/");

  const db = await createClient();
  const { data: year, error } = await db
    .from("academic_years")
    .select("id, year_be, current_semester, start_date, end_date")
    .eq("is_current", true)
    .maybeSingle();

  return (
    <>
      <Link href="/" prefetch={false} className="mb-4 inline-flex text-sm font-medium text-blue-700 hover:underline">
        ← กลับหน้าหลัก
      </Link>
      <h1 className="mb-4 text-xl font-semibold">ความคืบหน้าการบันทึกเวลาเรียน</h1>
      {error ? (
        <p role="alert" className="text-sm text-amber-800">โหลดปีการศึกษาไม่สำเร็จ กรุณาลองใหม่</p>
      ) : year ? (
        <Suspense fallback={<p role="status" className="text-sm text-zinc-500">กำลังคำนวณความคืบหน้ารายวันและรายวิชา…</p>}>
          <AttendanceProgress year={year} />
        </Suspense>
      ) : (
        <p className="text-sm text-zinc-500">ยังไม่ได้กำหนดปีการศึกษาปัจจุบัน</p>
      )}
    </>
  );
}
