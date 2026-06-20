"use client";

import { Loader2, ListOrdered } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { renumberClassroomById } from "./actions";
import type { NumberMode } from "./_renumber";

const MODE_OPTIONS: { value: NumberMode; label: string }[] = [
  { value: "code", label: "ตามรหัส" },
  { value: "male_first", label: "ชาย-หญิง" },
  { value: "female_first", label: "หญิง-ชาย" },
];

/**
 * "เรียงเลขที่ใหม่" button with ordering-mode selector.
 *
 * Mode options:
 *   ตามรหัส    — sort by student_code only (default)
 *   ชาย-หญิง  — boys first (เด็กชาย/นาย), then girls, then by code
 *   หญิง-ชาย  — girls first, then boys, then by code
 *
 * "ใช้กับทุกห้อง" checkbox saves the mode and renumbers every classroom
 * in the current academic year, not just the one on screen.
 */
export function RenumberClassroomButton({
  classroomId,
  classroomLabel,
  semester,
  currentMode = "code",
}: {
  classroomId: string;
  classroomLabel: string;
  /** Semester scope for the renumber (0 = primary, 1/2 = secondary). */
  semester: 0 | 1 | 2;
  /** The mode saved on this classroom — pre-selects the pill. */
  currentMode?: NumberMode;
}) {
  const [mode, setMode] = useState<NumberMode>(currentMode);
  const [applyToAll, setApplyToAll] = useState(false);
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<
    { ok: true; text: string } | { ok: false; text: string } | null
  >(null);
  const router = useRouter();

  // Sync pill to whatever the server says on refresh
  useEffect(() => {
    setMode(currentMode);
  }, [currentMode]);

  // Auto-dismiss success feedback
  useEffect(() => {
    if (!feedback?.ok) return;
    const t = setTimeout(() => setFeedback(null), 3500);
    return () => clearTimeout(t);
  }, [feedback]);

  const handleClick = () => {
    setFeedback(null);
    startTransition(async () => {
      const res = await renumberClassroomById(
        classroomId,
        semester,
        mode,
        applyToAll,
      );
      if (res.ok) {
        setFeedback({
          ok: true,
          text: applyToAll
            ? "เรียงเลขที่ทุกห้องแล้ว"
            : `เรียงเลขที่ใหม่แล้ว (${res.count} คน)`,
        });
        router.refresh();
      } else {
        setFeedback({ ok: false, text: res.error });
      }
    });
  };

  return (
    <div className="flex flex-col items-end gap-1.5">
      {/* ── Mode pills ─────────────────────────────────── */}
      <div className="flex items-center gap-0.5 rounded-lg border border-zinc-200 bg-zinc-50 p-0.5">
        {MODE_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => setMode(opt.value)}
            disabled={pending}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-60 ${
              mode === opt.value
                ? "bg-primary-600 text-white shadow-sm"
                : "text-zinc-500 hover:text-zinc-700"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* ── Checkbox + Button ──────────────────────────── */}
      <div className="flex items-center gap-2">
        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-zinc-500 select-none">
          <input
            type="checkbox"
            checked={applyToAll}
            onChange={(e) => setApplyToAll(e.target.checked)}
            disabled={pending}
            className="rounded accent-primary-600"
          />
          ใช้กับทุกห้อง
        </label>
        <button
          type="button"
          onClick={handleClick}
          disabled={pending}
          title={`เรียงเลขที่ใหม่ใน${applyToAll ? "ทุกห้อง" : `ห้อง ${classroomLabel}`}`}
          className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 shadow-sm hover:bg-zinc-50 disabled:cursor-wait disabled:opacity-60"
        >
          {pending ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
          ) : (
            <ListOrdered className="size-3.5" aria-hidden />
          )}
          {pending ? "กำลังเรียง..." : "เรียงเลขที่ใหม่"}
        </button>
      </div>

      {/* ── Scope hint ─────────────────────────────────── */}
      <span className="text-[11px] text-zinc-500">
        {applyToAll ? (
          "ทุกห้องในปีการศึกษานี้"
        ) : (
          <>
            เฉพาะห้อง <strong>{classroomLabel}</strong> เท่านั้น
          </>
        )}
      </span>

      {feedback && (
        <span
          role="status"
          className={
            feedback.ok
              ? "text-[11px] font-medium text-emerald-700"
              : "text-[11px] font-medium text-red-700"
          }
        >
          {feedback.ok ? "✓" : "❌"} {feedback.text}
        </span>
      )}
    </div>
  );
}
