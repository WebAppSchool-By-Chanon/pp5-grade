"use client";

import { CalendarDays, Loader2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { saveRecurringSubjectSchedule } from "./schedule-actions";

const WEEKDAYS = [
  { value: 1, label: "วันจันทร์" },
  { value: 2, label: "วันอังคาร" },
  { value: 3, label: "วันพุธ" },
  { value: 4, label: "วันพฤหัสบดี" },
  { value: 5, label: "วันศุกร์" },
  { value: 6, label: "วันเสาร์" },
  { value: 7, label: "วันอาทิตย์" },
] as const;

export function SubjectScheduleButton({
  offeringId,
  slotsPerWeek,
  initialWeekdays,
  schemaReady,
}: {
  offeringId: string;
  slotsPerWeek: number;
  initialWeekdays: Array<number | null>;
  schemaReady: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [weekdays, setWeekdays] = useState(initialWeekdays);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const save = () => {
    setError(null);
    startTransition(async () => {
      const result = await saveRecurringSubjectSchedule(offeringId, weekdays);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setWeekdays(initialWeekdays);
          setError(null);
          setOpen(true);
        }}
        disabled={!schemaReady}
        title={
          schemaReady
            ? "กำหนดว่าวิชานี้เรียนวันใดในแต่ละช่อง"
            : "ต้องรัน SQL Migration ก่อนใช้งาน"
        }
        className="inline-flex items-center gap-1.5 rounded-md border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100 disabled:cursor-not-allowed disabled:border-zinc-200 disabled:bg-zinc-100 disabled:text-zinc-400"
      >
        <CalendarDays className="size-3.5" aria-hidden />
        ตั้งค่าวันเรียน
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="subject-schedule-title"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !pending) setOpen(false);
          }}
        >
          <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl">
            <div className="flex items-start justify-between border-b border-zinc-200 px-5 py-4">
              <div>
                <h2 id="subject-schedule-title" className="font-semibold text-zinc-900">
                  ตั้งค่าวันเรียนประจำ
                </h2>
                <p className="mt-1 text-xs text-zinc-500">
                  ตั้งครั้งเดียวต่อห้อง วิชา และภาคเรียน · เลือกวันซ้ำกันได้
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={pending}
                className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
                aria-label="ปิด"
              >
                <X className="size-5" />
              </button>
            </div>

            <div className="max-h-[60vh] space-y-3 overflow-y-auto px-5 py-4">
              {Array.from({ length: slotsPerWeek }, (_, index) => (
                <label
                  key={index}
                  className="grid grid-cols-[6rem_1fr] items-center gap-3"
                >
                  <span className="text-sm font-medium text-zinc-700">
                    ช่องที่ {index + 1}
                  </span>
                  <select
                    value={weekdays[index] ?? ""}
                    onChange={(event) => {
                      const value = event.target.value
                        ? Number(event.target.value)
                        : null;
                      setWeekdays((previous) => {
                        const next = [...previous];
                        next[index] = value;
                        return next;
                      });
                    }}
                    disabled={pending}
                    className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-800 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                  >
                    <option value="">— ยังไม่กำหนด —</option>
                    {WEEKDAYS.map((day) => (
                      <option key={day.value} value={day.value}>
                        {day.label}
                      </option>
                    ))}
                  </select>
                </label>
              ))}

              <div className="rounded-lg bg-blue-50 px-3 py-2 text-xs leading-5 text-blue-800">
                หลังบันทึก ระบบจะแสดงวันที่จริงใต้หัวช่อง และดึงข้อมูลเช็กชื่อรายวันมาเป็นค่าเริ่มต้น
                โดยข้อมูลที่ครูรายวิชาแก้เองจะไม่ถูกเขียนทับ
              </div>
              {error && (
                <p role="alert" className="text-sm text-red-700">
                  {error}
                </p>
              )}
            </div>

            <div className="flex justify-end gap-2 border-t border-zinc-200 px-5 py-4">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={pending}
                className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-60"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={save}
                disabled={pending}
                className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-wait disabled:opacity-60"
              >
                {pending && <Loader2 className="size-4 animate-spin" />}
                {pending ? "กำลังบันทึก..." : "บันทึกวันเรียน"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
