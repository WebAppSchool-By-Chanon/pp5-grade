"use client";

import { CalendarClock, Check, Loader2, RotateCcw, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  saveSubjectAttendance,
  setSubjectAttendanceForSlot,
  type SubjectAttendanceStatus,
} from "./actions";
import { saveSubjectScheduleOverride } from "./schedule-actions";

export type SubjectStudentRow = {
  id: string;
  student_number: number;
  full_label: string;
  /** Map "week|slot_in_week" → status. */
  statuses: Record<string, SubjectAttendanceStatus | undefined>;
  /** Daily values retained separately so clearing a manual value falls back. */
  dailyStatuses: Record<string, SubjectAttendanceStatus | undefined>;
  /** True when the effective cell is physically saved for this subject. */
  manualKeys: Record<string, boolean | undefined>;
};

type Props = {
  offeringId: string;
  classroomId: string;
  semester: 1 | 2;
  /** ช่อง/สัปดาห์ (= credit_hours × 2) */
  slotsPerWeek: number;
  /** Range of weeks rendered in this tab — e.g., [1,5] or [6,10] */
  weekRange: [number, number];
  /** Compact Thai date-range label per week in `weekRange`, e.g.,
   *  ["16-20 พ.ค.", "23-27 พ.ค.", "30 พ.ค. - 3 มิ.ย.", ...].
   *  length === (weekRange[1] - weekRange[0] + 1) */
  weekLabels: string[];
  /** Total slots across the WHOLE term (= slotsPerWeek × 20) — used to
   *  compute % attendance in the summary column. */
  totalSlots: number;
  students: SubjectStudentRow[];
  /** Effective dates after make-up overrides, keyed by "week|slot". */
  sessionDates: Record<string, string | undefined>;
  /** Recurring dates before overrides, used by "restore". */
  baseSessionDates: Record<string, string | undefined>;
  overrideKeys: string[];
};

const STATUS_LABEL: Record<SubjectAttendanceStatus, string> = {
  present: "/",
  absent: "ข",
  leave: "ล",
};

const STATUS_CLASS: Record<SubjectAttendanceStatus, string> = {
  present: "bg-emerald-50 text-emerald-700",
  absent: "bg-red-50 text-red-700",
  leave: "bg-amber-50 text-amber-700",
};

/** Cast a raw `<select>` value back into a typed status (or undefined). */
function parseStatus(
  raw: string,
): SubjectAttendanceStatus | undefined {
  if (raw === "present" || raw === "absent" || raw === "leave") return raw;
  return undefined;
}

// Sticky column geometry — keep widths explicit so the slot-column
// scroll-under behavior is consistent across browsers (some browsers
// don't enforce column alignment with border-separate when widths are
// only declared via Tailwind utility classes on the THEAD row).
const STICKY_WIDTH = {
  num: 48, // matches w-12
  name: 192, // matches min-w-[12rem]
} as const;
const STICKY_LEFT = {
  num: 0,
  name: STICKY_WIDTH.num, // ชื่อ starts right after ที่
} as const;

export function SubjectAttendanceGrid({
  offeringId,
  classroomId,
  semester,
  slotsPerWeek,
  weekRange,
  weekLabels,
  totalSlots,
  students: initialStudents,
  sessionDates,
  baseSessionDates,
  overrideKeys,
}: Props) {
  // Local optimistic state — server action updates first, then state mirrors.
  // (Matches the per-day grid pattern.)
  const [students, setStudents] =
    useState<SubjectStudentRow[]>(initialStudents);
  const [, startTransition] = useTransition();
  const [overridePending, startOverrideTransition] = useTransition();
  const [editingSession, setEditingSession] = useState<{
    week: number;
    slot: number;
    date: string;
  } | null>(null);
  const [overrideError, setOverrideError] = useState<string | null>(null);
  const router = useRouter();

  const [firstWeek, lastWeek] = weekRange;
  const weekCount = lastWeek - firstWeek + 1;

  const cellKey = (week: number, slot: number) => `${week}|${slot}`;

  /**
   * Targeted rollback — overwrite ONE student's ONE cell with the value we
   * believe the server still holds (`prevStatus`). Avoids the previous
   * pattern of `setStudents(initialStudents)` which wiped every successful
   * click in the session.
   */
  const rollbackCell = (
    studentId: string,
    week: number,
    slot: number,
    prevStatus: SubjectAttendanceStatus | undefined,
    wasManual: boolean,
  ) => {
    setStudents((prev) =>
      prev.map((s) => {
        if (s.id !== studentId) return s;
        const k = cellKey(week, slot);
        const nextStatuses = { ...s.statuses };
        if (prevStatus) nextStatuses[k] = prevStatus;
        else delete nextStatuses[k];
        const nextManualKeys = { ...s.manualKeys };
        if (wasManual) nextManualKeys[k] = true;
        else delete nextManualKeys[k];
        return { ...s, statuses: nextStatuses, manualKeys: nextManualKeys };
      }),
    );
  };

  const handleCellChange = (
    studentId: string,
    week: number,
    slot: number,
    rawValue: string,
  ) => {
    const newStatus = parseStatus(rawValue); // undefined when user picks "—"
    // Snapshot the cell's previous value BEFORE the optimistic update — used
    // for targeted rollback if the server save fails (instead of resetting
    // the entire grid to initialStudents and wiping every other click).
    const prevStatus =
      students.find((s) => s.id === studentId)?.statuses[cellKey(week, slot)];
    const wasManual =
      students.find((s) => s.id === studentId)?.manualKeys[cellKey(week, slot)] ===
      true;

    setStudents((prev) =>
      prev.map((s) => {
        if (s.id !== studentId) return s;
        const k = cellKey(week, slot);
        const nextStatuses = { ...s.statuses };
        const nextManualKeys = { ...s.manualKeys };
        if (newStatus) {
          nextStatuses[k] = newStatus;
          nextManualKeys[k] = true;
        } else {
          const dailyStatus = s.dailyStatuses[k];
          if (dailyStatus) nextStatuses[k] = dailyStatus;
          else delete nextStatuses[k];
          delete nextManualKeys[k];
        }
        return { ...s, statuses: nextStatuses, manualKeys: nextManualKeys };
      }),
    );

    startTransition(async () => {
      try {
        const fd = new FormData();
        fd.set("offering_id", offeringId);
        fd.set("student_id", studentId);
        fd.set("week", String(week));
        fd.set("slot_in_week", String(slot));
        // Server treats empty string as "clear the cell" (DELETE row)
        fd.set("status", newStatus ?? "");
        await saveSubjectAttendance(fd);
        // Force the Router Cache to refetch this route's server data on the
        // next navigation back. Without this, leaving the tab + coming back
        // may render the pre-save (or rolled-back) snapshot from cache —
        // making the cell *look* empty even though the row is in the DB.
        router.refresh();
      } catch (e) {
        // Targeted rollback — only the failing cell, not the whole grid.
        rollbackCell(studentId, week, slot, prevStatus, wasManual);
        const msg = e instanceof Error ? e.message : String(e);
        console.error("saveSubjectAttendance failed", { studentId, week, slot, status: newStatus, error: e });
        alert(`บันทึกไม่สำเร็จ: ${msg}`);
      }
    });
  };

  const handleBulkCheckSlot = (week: number, slot: number) => {
    // Compute if EVERY student already has "present" for this slot —
    // toggle behavior: if all present → clear; otherwise → set all present.
    const allPresent =
      students.length > 0 &&
      students.every(
        (s) =>
          s.statuses[cellKey(week, slot)] === "present" &&
          s.manualKeys[cellKey(week, slot)] === true,
      );
    const setPresent = !allPresent;
    // Snapshot the whole-column prev state for targeted rollback on failure.
    const prevColumn = new Map(
      students.map((s) => [
        s.id,
        {
          status: s.statuses[cellKey(week, slot)],
          manual: s.manualKeys[cellKey(week, slot)] === true,
        },
      ]),
    );

    setStudents((prev) =>
      prev.map((s) => {
        const k = cellKey(week, slot);
        const nextStatuses = { ...s.statuses };
        const nextManualKeys = { ...s.manualKeys };
        if (setPresent) {
          nextStatuses[k] = "present";
          nextManualKeys[k] = true;
        } else {
          const dailyStatus = s.dailyStatuses[k];
          if (dailyStatus) nextStatuses[k] = dailyStatus;
          else delete nextStatuses[k];
          delete nextManualKeys[k];
        }
        return { ...s, statuses: nextStatuses, manualKeys: nextManualKeys };
      }),
    );

    startTransition(async () => {
      try {
        const fd = new FormData();
        fd.set("offering_id", offeringId);
        fd.set("classroom_id", classroomId);
        fd.set("semester", String(semester));
        fd.set("week", String(week));
        fd.set("slot_in_week", String(slot));
        fd.set("set_present", setPresent ? "true" : "false");
        await setSubjectAttendanceForSlot(fd);
        // See router.refresh() comment in handleCellChange — bulk-check
        // suffers the same Router-Cache-staleness problem on navigation back.
        router.refresh();
      } catch (e) {
        // Targeted rollback — restore only this slot's column from snapshot.
        setStudents((prev) =>
          prev.map((s) => {
            const k = cellKey(week, slot);
            const nextStatuses = { ...s.statuses };
            const previous = prevColumn.get(s.id);
            if (previous?.status) nextStatuses[k] = previous.status;
            else delete nextStatuses[k];
            const nextManualKeys = { ...s.manualKeys };
            if (previous?.manual) nextManualKeys[k] = true;
            else delete nextManualKeys[k];
            return { ...s, statuses: nextStatuses, manualKeys: nextManualKeys };
          }),
        );
        const msg = e instanceof Error ? e.message : String(e);
        console.error("setSubjectAttendanceForSlot failed", { week, slot, setPresent, error: e });
        alert(`บันทึกไม่สำเร็จ: ${msg}`);
      }
    });
  };

  const formatSessionDate = (iso: string) => {
    const [, month, day] = iso.split("-");
    return `${Number(day)}/${Number(month)}`;
  };

  const saveSessionDate = (restore = false) => {
    if (!editingSession) return;
    setOverrideError(null);
    startOverrideTransition(async () => {
      const result = await saveSubjectScheduleOverride(
        offeringId,
        editingSession.week,
        editingSession.slot,
        restore ? null : editingSession.date,
      );
      if (!result.ok) {
        setOverrideError(result.error);
        return;
      }
      setEditingSession(null);
      router.refresh();
    });
  };

  // Per-student totals computed across ALL weeks (not just the visible range)
  // so the rightmost column reflects the whole term.
  const computeTotals = (s: SubjectStudentRow) => {
    let present = 0;
    let absent = 0;
    let leave = 0;
    for (const v of Object.values(s.statuses)) {
      if (v === "present") present++;
      else if (v === "absent") absent++;
      else if (v === "leave") leave++;
    }
    const recorded = present + absent + leave;
    // % เวลาเรียน ตัด ปพ.5 = (present / totalSlots) × 100
    // ลา/ขาด นับเหมือนกัน (ขาดเรียน) สำหรับเกณฑ์ 80%
    const pct =
      totalSlots > 0 ? Math.round((present / totalSlots) * 100) : 0;
    return { present, absent, leave, recorded, pct };
  };

  return (
    <div>
      {/* Only the TABLE scrolls horizontally — the legend below sits
          outside this wrapper so it stays locked in place. */}
      <div className="overflow-x-auto">
      {/* border-separate (not collapse) — sticky cells with border-collapse
          can leak scrolled content through their right edge in some browsers.
          border-spacing-0 keeps the visual identical to collapse mode. */}
      <table className="w-full border-separate border-spacing-0 text-sm">
        <thead className="bg-zinc-50">
          {/* Header row 1: week group headers */}
          <tr>
            <th
              rowSpan={2}
              className="sticky border-b border-r border-zinc-200 px-2 py-1.5 text-xs font-medium text-zinc-500"
              style={{
                left: STICKY_LEFT.num,
                width: STICKY_WIDTH.num,
                minWidth: STICKY_WIDTH.num,
                maxWidth: STICKY_WIDTH.num,
                backgroundColor: "#f4f4f5",
                zIndex: 30,
              }}
            >
              ที่
            </th>
            <th
              rowSpan={2}
              className="sticky border-b border-r border-zinc-200 px-3 py-1.5 text-left text-xs font-medium text-zinc-500"
              style={{
                left: STICKY_LEFT.name,
                width: STICKY_WIDTH.name,
                minWidth: STICKY_WIDTH.name,
                backgroundColor: "#f4f4f5",
                zIndex: 30,
              }}
            >
              ชื่อ-นามสกุล
            </th>
            {Array.from({ length: weekCount }, (_, i) => {
              const week = firstWeek + i;
              const dateLabel = weekLabels[i] ?? "";
              return (
                <th
                  key={`wk-${week}`}
                  colSpan={slotsPerWeek}
                  className="border-b border-r border-zinc-200 px-1 py-1 text-center text-xs font-semibold text-zinc-600"
                >
                  <div>สัปดาห์ {week}</div>
                  {dateLabel && (
                    <div className="mt-0.5 text-[10px] font-normal text-zinc-500">
                      {dateLabel}
                    </div>
                  )}
                </th>
              );
            })}
            {/* "รวม" is NOT sticky — it scrolls with the grid (only ที่/ชื่อ
                stay pinned on the left). User spec 2026-05-31. */}
            <th
              rowSpan={2}
              className="min-w-[6rem] border-b border-l border-zinc-200 bg-zinc-50 px-2 py-1.5 text-center text-xs font-medium text-zinc-500"
            >
              รวม
            </th>
          </tr>
          {/* Header row 2: slot numbers + bulk-check buttons */}
          <tr>
            {Array.from({ length: weekCount }, (_, wi) => {
              const week = firstWeek + wi;
              return Array.from({ length: slotsPerWeek }, (_, si) => {
                const slot = si + 1;
                const key = cellKey(week, slot);
                const sessionDate = sessionDates[key];
                const isOverride = overrideKeys.includes(key);
                const allPresent =
                  students.length > 0 &&
                  students.every(
                    (s) =>
                      s.statuses[key] === "present" &&
                      s.manualKeys[key] === true,
                  );
                return (
                  <th
                    key={`sl-${week}-${slot}`}
                    className="border-b border-r border-zinc-200 bg-zinc-50/60 px-0.5 py-1 text-center text-[10px] font-medium text-zinc-500"
                  >
                    <button
                      type="button"
                      onClick={() => handleBulkCheckSlot(week, slot)}
                      title={
                        allPresent
                          ? "คลิกเพื่อล้างทั้งห้อง"
                          : "คลิกเพื่อให้ทั้งห้องมาเรียนช่องนี้"
                      }
                      className={
                        allPresent
                          ? "inline-flex h-5 w-5 items-center justify-center rounded text-emerald-600 hover:bg-emerald-100"
                          : "inline-flex h-5 w-5 items-center justify-center rounded text-zinc-400 hover:bg-zinc-200 hover:text-zinc-700"
                      }
                    >
                      <Check className="h-3 w-3" />
                    </button>
                    {/* Running hour number across the whole term, e.g.
                        week 1 → 1..N · week 2 → N+1..2N · ... */}
                    <div className="leading-none">
                      {(week - 1) * slotsPerWeek + slot}
                    </div>
                    {sessionDate && (
                      <button
                        type="button"
                        onClick={() => {
                          setOverrideError(null);
                          setEditingSession({ week, slot, date: sessionDate });
                        }}
                        title={
                          isOverride
                            ? "วันเรียนชดเชย — คลิกเพื่อแก้ไขหรือคืนวันเดิม"
                            : "วันที่เรียน — คลิกเพื่อย้ายวันเฉพาะสัปดาห์นี้"
                        }
                        className={
                          "mt-1 inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[9px] leading-none hover:bg-indigo-100 " +
                          (isOverride
                            ? "bg-amber-100 font-semibold text-amber-800"
                            : "text-indigo-600")
                        }
                      >
                        <CalendarClock className="size-2.5" />
                        {formatSessionDate(sessionDate)}
                      </button>
                    )}
                  </th>
                );
              });
            })}
          </tr>
        </thead>
        <tbody>
          {students.map((s) => {
            const totals = computeTotals(s);
            return (
              <tr key={s.id} className="hover:bg-zinc-50/50">
                <td
                  className="sticky border-b border-r border-zinc-200 px-2 py-1 text-center font-mono text-xs text-zinc-500"
                  style={{
                    left: STICKY_LEFT.num,
                    width: STICKY_WIDTH.num,
                    minWidth: STICKY_WIDTH.num,
                    maxWidth: STICKY_WIDTH.num,
                    backgroundColor: "#ffffff",
                    zIndex: 30,
                  }}
                >
                  {s.student_number}
                </td>
                <td
                  className="sticky border-b border-r border-zinc-200 px-3 py-1 text-zinc-900"
                  style={{
                    left: STICKY_LEFT.name,
                    width: STICKY_WIDTH.name,
                    minWidth: STICKY_WIDTH.name,
                    backgroundColor: "#ffffff",
                    zIndex: 30,
                  }}
                >
                  {s.full_label}
                </td>
                {Array.from({ length: weekCount }, (_, wi) => {
                  const week = firstWeek + wi;
                  return Array.from({ length: slotsPerWeek }, (_, si) => {
                    const slot = si + 1;
                    const k = cellKey(week, slot);
                    const status = s.statuses[k];
                    const inheritedFromDaily =
                      !!status && s.manualKeys[k] !== true && !!s.dailyStatuses[k];
                    return (
                      <td
                        key={k}
                        className="border-b border-r border-zinc-200 p-0 text-center"
                      >
                        {/* Native <select> per cell — no click-to-cycle.
                            `appearance-none` hides the browser's dropdown arrow
                            so the cell visually matches the per-day grid.
                            Clicking the cell opens the option list directly. */}
                        <select
                          value={status ?? ""}
                          onChange={(e) =>
                            handleCellChange(
                              s.id,
                              week,
                              slot,
                              e.target.value,
                            )
                          }
                          aria-label={`สัปดาห์ ${week} ช่อง ${slot} ของ ${s.full_label}`}
                          title={
                            inheritedFromDaily
                              ? "ดึงจากเช็กชื่อรายวัน · เลือกค่าใหม่เพื่อแก้เฉพาะรายวิชา"
                              : s.manualKeys[k]
                                ? "ครูรายวิชาบันทึกแล้ว"
                                : "ยังไม่ได้บันทึก"
                          }
                          className={
                            "h-7 w-7 cursor-pointer appearance-none border-0 px-0 text-center text-sm font-semibold leading-none transition-colors hover:bg-zinc-100 focus:outline-none focus:ring-1 focus:ring-indigo-400 " +
                            (status ? STATUS_CLASS[status] : "bg-transparent text-zinc-300") +
                            (inheritedFromDaily ? " ring-1 ring-inset ring-blue-400" : "")
                          }
                        >
                          <option value="">
                            {s.dailyStatuses[k] ? "ใช้ค่ารายวัน" : "—"}
                          </option>
                          <option value="present">{STATUS_LABEL.present}</option>
                          <option value="absent">{STATUS_LABEL.absent}</option>
                          <option value="leave">{STATUS_LABEL.leave}</option>
                        </select>
                      </td>
                    );
                  });
                })}
                <td
                  className="border-b border-l border-zinc-200 bg-white px-2 py-1 text-center text-xs"
                >
                  <div className="font-mono font-semibold text-zinc-900">
                    {totals.present}/{totalSlots}
                  </div>
                  <div
                    className={
                      "text-[10px] " +
                      (totals.pct >= 80
                        ? "text-emerald-700"
                        : totals.pct >= 60
                          ? "text-amber-700"
                          : "text-red-700")
                    }
                  >
                    {totals.pct}%
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>

      {/* Legend — outside the horizontal scroll so it stays locked while the
          grid scrolls left/right. User spec 2026-05-31. */}
      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-zinc-600">
        <span className="font-medium">ความหมายช่อง:</span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-flex h-5 w-5 items-center justify-center rounded bg-emerald-50 font-semibold text-emerald-700">
            /
          </span>{" "}
          มา
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-flex h-5 w-5 items-center justify-center rounded bg-red-50 font-semibold text-red-700">
            ข
          </span>{" "}
          ขาด
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-flex h-5 w-5 items-center justify-center rounded bg-amber-50 font-semibold text-amber-700">
            ล
          </span>{" "}
          ลา
        </span>
        <span className="text-zinc-400">·</span>
        <span className="inline-flex items-center gap-1 text-blue-700">
          <span className="inline-flex h-5 w-5 items-center justify-center rounded bg-blue-50 ring-1 ring-inset ring-blue-400">
            / ข ล
          </span>
          ขอบน้ำเงิน = ดึงจากเช็กชื่อรายวัน
        </span>
        <span className="text-zinc-400">·</span>
        <span className="text-zinc-500">
          คลิกช่องเพื่อแก้เฉพาะรายวิชา · คลิกวันที่ใต้หัวช่องเมื่อต้องย้ายวันเรียน
        </span>
      </div>

      {editingSession && (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="makeup-date-title"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !overridePending) {
              setEditingSession(null);
            }
          }}
        >
          <div className="w-full max-w-sm rounded-2xl bg-white shadow-2xl">
            <div className="flex items-start justify-between border-b border-zinc-200 px-5 py-4">
              <div>
                <h2 id="makeup-date-title" className="font-semibold text-zinc-900">
                  เปลี่ยนวันที่เรียนเฉพาะครั้ง
                </h2>
                <p className="mt-1 text-xs text-zinc-500">
                  สัปดาห์ที่ {editingSession.week} · ช่องที่ {editingSession.slot}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingSession(null)}
                disabled={overridePending}
                className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
                aria-label="ปิด"
              >
                <X className="size-5" />
              </button>
            </div>
            <div className="space-y-3 px-5 py-4">
              <label className="block text-sm font-medium text-zinc-700">
                วันที่เรียนจริง
                <input
                  type="date"
                  value={editingSession.date}
                  onChange={(event) =>
                    setEditingSession((current) =>
                      current ? { ...current, date: event.target.value } : current,
                    )
                  }
                  disabled={overridePending}
                  className="mt-1.5 block w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                />
              </label>
              <p className="text-xs leading-5 text-zinc-500">
                ระบบจะดึงเช็กชื่อรายวันของวันที่ใหม่นี้ โดยไม่แก้ข้อมูลเช็กชื่อช่วงเช้า
              </p>
              {overrideError && (
                <p role="alert" className="text-sm text-red-700">
                  {overrideError}
                </p>
              )}
            </div>
            <div className="flex items-center justify-between gap-2 border-t border-zinc-200 px-5 py-4">
              <div>
                {overrideKeys.includes(
                  cellKey(editingSession.week, editingSession.slot),
                ) && baseSessionDates[cellKey(editingSession.week, editingSession.slot)] && (
                  <button
                    type="button"
                    onClick={() => saveSessionDate(true)}
                    disabled={overridePending}
                    className="inline-flex items-center gap-1 text-xs font-medium text-zinc-600 hover:text-zinc-900 disabled:opacity-60"
                  >
                    <RotateCcw className="size-3.5" />
                    คืนวันตามตาราง
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => saveSessionDate(false)}
                disabled={overridePending || !editingSession.date}
                className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-wait disabled:opacity-60"
              >
                {overridePending && <Loader2 className="size-4 animate-spin" />}
                {overridePending ? "กำลังบันทึก..." : "บันทึกวันที่"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
