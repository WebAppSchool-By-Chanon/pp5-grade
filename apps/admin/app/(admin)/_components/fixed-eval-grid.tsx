"use client";

import { Select } from "@pp5/ui";
import { useState, useTransition } from "react";
import { abilityTotal, summarizeAbility } from "@/lib/ability-eval";
import {
  cellColorClass,
  summarize0to3,
  summaryColorClass,
  type EvalLabel,
} from "@/lib/curriculum-eval-utils";

/**
 * Phase 2.7 — generic eval grid for tables with a FIXED set of columns
 * (e.g. reading-thinking has 3 fields, competency has 5).
 *
 * Cell input: native <Select> dropdown with options 0/1/2/3 + empty.
 *
 * Column header includes a bulk button:
 *   - if NOT all students have score=3 → label "ทุกคน 3" (sets all to 3)
 *   - if all students currently have 3   → label "ล้าง"   (clears all)
 *
 * Optimistic updates: per-cell changes show instantly; bulk actions wait
 * for the server to revalidate (since they affect every row).
 */

export type FixedColumn = {
  /** DB column name in the evaluation table (e.g. "reading_score"). */
  field: string;
  /** Display label in the column header. */
  label: string;
};

export type FixedStudentRow = {
  id: string;
  student_number: number;
  full_label: string;
  /** Map field → score (0-3) or null if not evaluated yet. */
  scores: Record<string, number | null>;
};

/** Server action signature for per-cell saves. */
export type FixedSaveAction = (formData: FormData) => Promise<void>;
/** Server action signature for bulk-column toggles. */
export type FixedBulkAction = (formData: FormData) => Promise<void>;

type Props = {
  students: FixedStudentRow[];
  columns: FixedColumn[];
  classroomId: string;
  yearId: string;
  /** 0 = annual (primary) · 1 / 2 = per-semester (secondary). Used as the
   *  scope for read + write of the eval table's `semester` column. */
  semester: 0 | 1 | 2;
  readonly?: boolean;
  summaryRule?: "mode" | "ability";
  showTotal?: boolean;
  saveAction: FixedSaveAction;
  bulkAction: FixedBulkAction;
};

const NUM_W = 48;
const NAME_W = 200;
const CELL_W = 120;
const SUMMARY_W = 96;

const SCORE_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "—" },
  { value: "3", label: "3" },
  { value: "2", label: "2" },
  { value: "1", label: "1" },
  { value: "0", label: "0" },
];

export function FixedEvalGrid({
  students,
  columns,
  classroomId,
  yearId,
  semester,
  readonly = false,
  summaryRule = "mode",
  showTotal = false,
  saveAction,
  bulkAction,
}: Props) {
  const tableMinW = NUM_W + NAME_W + CELL_W * columns.length + SUMMARY_W * (showTotal ? 2 : 1);

  return (
    <div className="overflow-x-auto">
      <table
        className="table-fixed border-separate border-spacing-0 text-sm"
        style={{ minWidth: tableMinW }}
      >
        <colgroup>
          <col style={{ width: NUM_W }} />
          <col style={{ width: NAME_W }} />
          {columns.map((c) => (
            <col key={c.field} style={{ width: CELL_W }} />
          ))}
          {showTotal ? <col style={{ width: SUMMARY_W }} /> : null}
          <col style={{ width: SUMMARY_W }} />
        </colgroup>

        <thead>
          <tr>
            <th
              style={{ left: 0, width: NUM_W, minWidth: NUM_W, maxWidth: NUM_W }}
              className="sticky z-10 border-b border-zinc-200 bg-zinc-100 px-2 py-2 text-center text-xs font-medium text-zinc-600"
            >
              #
            </th>
            <th
              style={{
                left: NUM_W,
                width: NAME_W,
                minWidth: NAME_W,
                maxWidth: NAME_W,
              }}
              className="sticky z-10 border-b border-zinc-200 bg-zinc-100 px-3 py-2 text-left text-xs font-medium text-zinc-600"
            >
              ชื่อ – สกุล
            </th>
            {columns.map((c) => {
              // "all 3" lets the bulk button toggle to a "clear" label
              const allAre3 =
                students.length > 0 &&
                students.every((s) => s.scores[c.field] === 3);
              return (
                <th
                  key={c.field}
                  style={{ width: CELL_W }}
                  className="border-b border-l border-zinc-200 bg-zinc-50 px-2 py-2 text-center text-xs font-medium text-zinc-600"
                >
                  <div className="mb-1.5 line-clamp-2 leading-tight">
                    {c.label}
                  </div>
                  {readonly ? null : (
                    <BulkColumnButton
                      classroomId={classroomId}
                      yearId={yearId}
                      semester={semester}
                      field={c.field}
                      allAre3={allAre3}
                      bulkAction={bulkAction}
                    />
                  )}
                </th>
              );
            })}
            {showTotal ? (
              <th
                style={{ width: SUMMARY_W }}
                className="border-b border-l border-zinc-200 bg-zinc-100 px-2 py-2 text-center text-xs font-medium text-zinc-700"
              >
                รวม
              </th>
            ) : null}
            <th
              style={{ width: SUMMARY_W }}
              className="border-b border-l border-zinc-200 bg-zinc-100 px-2 py-2 text-center text-xs font-medium text-zinc-700"
            >
              สรุป
            </th>
          </tr>
        </thead>

        <tbody>
          {students.map((s, i) => (
            // Include the per-row scores in the key so bulk-column changes
            // (which mutate every row's prop) force a re-mount and the
            // dropdowns re-init with the fresh values.
            <Row
              key={`${s.id}|${columns.map((c) => s.scores[c.field] ?? "").join(",")}`}
              student={s}
              columns={columns}
              classroomId={classroomId}
              yearId={yearId}
              semester={semester}
              readonly={readonly}
              summaryRule={summaryRule}
              showTotal={showTotal}
              saveAction={saveAction}
              alt={i % 2 === 0}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ===================================================================
// Header bulk-toggle button — "ทุกคน 3" / "ล้าง"
// ===================================================================

function BulkColumnButton({
  classroomId,
  yearId,
  semester,
  field,
  allAre3,
  bulkAction,
}: {
  classroomId: string;
  yearId: string;
  /** 0 = annual (primary) · 1 / 2 = per-semester (secondary). Used as the
   *  scope for read + write of the eval table's `semester` column. */
  semester: 0 | 1 | 2;
  field: string;
  allAre3: boolean;
  bulkAction: FixedBulkAction;
}) {
  const [isPending, startTransition] = useTransition();

  const handleClick = () => {
    const fd = new FormData();
    fd.set("classroom_id", classroomId);
    fd.set("year_id", yearId);
    fd.set("semester", String(semester));
    fd.set("field", field);
    fd.set("value", allAre3 ? "" : "3");
    startTransition(async () => {
      try {
        await bulkAction(fd);
      } catch (err) {
        console.error("bulk action failed:", err);
        alert(
          `บันทึกไม่สำเร็จ: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    });
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending}
      className={
        allAre3
          ? "inline-flex w-full justify-center rounded bg-zinc-200 px-2 py-0.5 text-[10px] font-medium text-zinc-700 hover:bg-zinc-300 disabled:opacity-60"
          : "inline-flex w-full justify-center rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700 hover:bg-emerald-200 disabled:opacity-60"
      }
      title={
        allAre3
          ? "ล้างค่าทั้งคอลัมน์ของห้องนี้"
          : "ตั้งทุกคนในห้องเป็น 3 (กดอีกที = ล้าง)"
      }
    >
      {isPending ? "..." : allAre3 ? "ล้าง" : "ทุกคน 3"}
    </button>
  );
}

// ===================================================================
// Row — dropdowns per column + summary cell
// ===================================================================

function Row({
  student,
  columns,
  classroomId,
  yearId,
  semester,
  readonly,
  summaryRule,
  showTotal,
  saveAction,
  alt,
}: {
  student: FixedStudentRow;
  columns: FixedColumn[];
  classroomId: string;
  yearId: string;
  /** 0 = annual (primary) · 1 / 2 = per-semester (secondary). Used as the
   *  scope for read + write of the eval table's `semester` column. */
  semester: 0 | 1 | 2;
  readonly: boolean;
  summaryRule: "mode" | "ability";
  showTotal: boolean;
  saveAction: FixedSaveAction;
  alt: boolean;
}) {
  // Optimistic per-cell overrides — instant feedback while server saves.
  // Cleared on success (the prop catches up after revalidate).
  const [pending, setPending] = useState<Record<string, number | null>>({});
  const [isPending, startTransition] = useTransition();

  const view = (field: string): number | null =>
    field in pending ? pending[field] : (student.scores[field] ?? null);

  const rowScores = columns.map((c) => view(c.field));
  const summary: EvalLabel | null =
    summaryRule === "ability"
      ? summarizeAbility(rowScores)
      : summarize0to3(rowScores);
  const total = showTotal ? abilityTotal(rowScores) : null;

  const handleChange = (field: string, raw: string) => {
    if (readonly) return;
    const next: number | null =
      raw === ""
        ? null
        : raw === "0" || raw === "1" || raw === "2" || raw === "3"
          ? (Number.parseInt(raw, 10) as 0 | 1 | 2 | 3)
          : null;

    const prevValue = view(field);
    setPending((p) => ({ ...p, [field]: next }));

    const fd = new FormData();
    fd.set("student_id", student.id);
    fd.set("classroom_id", classroomId);
    fd.set("year_id", yearId);
    fd.set("semester", String(semester));
    fd.set("field", field);
    fd.set("score", next == null ? "" : String(next));
    startTransition(async () => {
      try {
        await saveAction(fd);
        // Server revalidated → prop will now match. Clear the override.
        setPending((p) => {
          const rest = { ...p };
          delete rest[field];
          return rest;
        });
      } catch (err) {
        console.error("save failed:", err);
        alert(
          `บันทึกไม่สำเร็จ: ${err instanceof Error ? err.message : String(err)}`,
        );
        // Revert optimistic value
        setPending((p) => ({ ...p, [field]: prevValue }));
      }
    });
  };

  const rowBg = alt
    ? "bg-white hover:bg-zinc-50"
    : "bg-zinc-50/50 hover:bg-zinc-100/60";

  return (
    <tr>
      <td
        style={{ left: 0, width: NUM_W, minWidth: NUM_W, maxWidth: NUM_W }}
        className={`sticky z-10 border-b border-zinc-200 px-2 py-1.5 text-center text-xs tabular-nums text-zinc-600 ${rowBg}`}
      >
        {student.student_number}
      </td>
      <td
        style={{
          left: NUM_W,
          width: NAME_W,
          minWidth: NAME_W,
          maxWidth: NAME_W,
        }}
        className={`sticky z-10 border-b border-zinc-200 ${rowBg}`}
      >
        <div
          className="truncate px-3 py-1.5 text-zinc-900"
          title={student.full_label}
        >
          {student.full_label}
        </div>
      </td>
      {columns.map((c) => {
        const v = view(c.field);
        const tint = cellColorClass(v);
        return (
          <td
            key={c.field}
            style={{ width: CELL_W }}
            className="border-b border-l border-zinc-200 px-1.5 py-1 text-center"
          >
            <Select
              value={v == null ? "" : String(v)}
              onChange={(e) => handleChange(c.field, e.target.value)}
              disabled={readonly || isPending}
              className={`w-full text-center font-semibold tabular-nums ${tint}`}
            >
              {SCORE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </td>
        );
      })}
      {showTotal ? (
        <td
          style={{ width: SUMMARY_W }}
          className="border-b border-l border-zinc-200 px-2 py-1 text-center font-medium tabular-nums"
        >
          {total ?? "—"}
        </td>
      ) : null}
      <td
        style={{ width: SUMMARY_W }}
        className="border-b border-l border-zinc-200 px-2 py-1 text-center"
      >
        <span
          className={`inline-flex min-w-[4rem] justify-center rounded-md px-2 py-0.5 text-xs font-semibold ${summaryColorClass(summary)}`}
        >
          {summary ?? "—"}
        </span>
      </td>
    </tr>
  );
}
