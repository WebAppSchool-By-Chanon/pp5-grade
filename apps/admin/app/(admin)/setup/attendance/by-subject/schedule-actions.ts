"use server";

import { createAdminClient } from "@pp5/database/admin";
import { getCurrentUser } from "@pp5/database/queries";
import { revalidatePath } from "next/cache";
import { requireWriteAccess } from "@/lib/access";

type SaveResult = { ok: true } | { ok: false; error: string };

async function ensureCanEditSchedule(offeringId: string): Promise<void> {
  const auth = await getCurrentUser();
  if (!auth) throw new Error("ไม่มีสิทธิ์");
  if (auth.profile.role === "admin") return;
  if (auth.profile.role === "teacher") {
    const admin = createAdminClient();
    const { data: teacher } = await admin
      .from("teachers")
      .select("id")
      .eq("user_id", auth.profile.id)
      .maybeSingle();
    if (teacher) {
      const { data: offering } = await admin
        .from("subject_offerings")
        .select("id")
        .eq("id", offeringId)
        .eq("teacher_id", teacher.id)
        .maybeSingle();
      if (offering) return;
    }
  }
  throw new Error("ไม่มีสิทธิ์ — เฉพาะครูที่สอนวิชานี้หรือผู้ดูแลระบบ");
}
function revalidateAttendancePages() {
  revalidatePath("/setup/attendance/by-subject", "layout");
  revalidatePath("/reports/attendance-by-subject", "page");
  revalidatePath("/reports/pp5", "page");
}

/** Save the recurring weekday (1=Mon ... 7=Sun) for every weekly slot. */
export async function saveRecurringSubjectSchedule(
  offeringId: string,
  weekdays: Array<number | null>,
): Promise<SaveResult> {
  try {
    await requireWriteAccess();
    if (!offeringId || weekdays.length < 1 || weekdays.length > 10) {
      throw new Error("ข้อมูลตารางเรียนไม่ถูกต้อง");
    }
    for (const weekday of weekdays) {
      if (weekday !== null && (!Number.isInteger(weekday) || weekday < 1 || weekday > 7)) {
        throw new Error("วันที่เรียนไม่ถูกต้อง");
      }
    }
    await ensureCanEditSchedule(offeringId);

    const admin = createAdminClient();
    const rows = weekdays.flatMap((weekday, index) =>
      weekday === null
        ? []
        : [{ offering_id: offeringId, slot_in_week: index + 1, weekday }],
    );

    // Delete only settings the user cleared or slots no longer used.
    const selectedSlots = rows.map((row) => row.slot_in_week);
    let deleteQuery = admin
      .from("subject_schedule_slots")
      .delete()
      .eq("offering_id", offeringId);
    if (selectedSlots.length > 0) {
      deleteQuery = deleteQuery.not(
        "slot_in_week",
        "in",
        `(${selectedSlots.join(",")})`,
      );
    }
    const { error: deleteError } = await deleteQuery;
    if (deleteError) throw new Error(deleteError.message);

    if (rows.length > 0) {
      const { error: upsertError } = await admin
        .from("subject_schedule_slots")
        .upsert(rows, { onConflict: "offering_id,slot_in_week" });
      if (upsertError) throw new Error(upsertError.message);
    }

    revalidateAttendancePages();
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "บันทึกตารางเรียนไม่สำเร็จ",
    };
  }
}

/** Set one make-up date, or pass null to restore the recurring weekday. */
export async function saveSubjectScheduleOverride(
  offeringId: string,
  week: number,
  slot: number,
  sessionDate: string | null,
): Promise<SaveResult> {
  try {
    await requireWriteAccess();
    if (
      !offeringId ||
      !Number.isInteger(week) ||
      week < 1 ||
      week > 30 ||
      !Number.isInteger(slot) ||
      slot < 1 ||
      slot > 10
    ) {
      throw new Error("ข้อมูลช่องเรียนไม่ถูกต้อง");
    }
    if (sessionDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(sessionDate)) {
      throw new Error("วันที่เรียนชดเชยไม่ถูกต้อง");
    }
    await ensureCanEditSchedule(offeringId);

    const admin = createAdminClient();
    if (sessionDate === null) {
      const { error } = await admin
        .from("subject_schedule_overrides")
        .delete()
        .eq("offering_id", offeringId)
        .eq("week", week)
        .eq("slot_in_week", slot);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await admin.from("subject_schedule_overrides").upsert(
        {
          offering_id: offeringId,
          week,
          slot_in_week: slot,
          session_date: sessionDate,
        },
        { onConflict: "offering_id,week,slot_in_week" },
      );
      if (error) throw new Error(error.message);
    }

    revalidateAttendancePages();
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "บันทึกวันเรียนชดเชยไม่สำเร็จ",
    };
  }
}
