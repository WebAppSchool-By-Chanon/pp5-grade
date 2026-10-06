import type { EvalLabel } from "@/lib/curriculum-eval-utils";

/** Annual eight-domain assessment from the school's 2568 workbook. */
export const ABILITY_COLUMNS = [
  { field: "art_score", label: "ด้านศิลปะ" },
  { field: "language_score", label: "ด้านภาษา" },
  { field: "music_score", label: "ด้านดนตรี" },
  { field: "sports_score", label: "ด้านกีฬา" },
  { field: "computer_score", label: "ด้านคอมพิวเตอร์" },
  { field: "interpersonal_score", label: "ด้านมนุษยสัมพันธ์" },
  { field: "self_understanding_score", label: "ด้านเข้าใจตนเอง" },
  { field: "nature_score", label: "ด้านธรรมชาติ" },
] as const;

export type AbilityField = (typeof ABILITY_COLUMNS)[number]["field"];

/**
 * Preserve the workbook's total thresholds, with the user's correction that
 * a zero in ANY of the eight domains forces failure. Blank assessments are
 * pending rather than being counted as failed.
 */
export function summarizeAbility(
  scores: Array<number | null | undefined>,
): EvalLabel | null {
  if (scores.length !== ABILITY_COLUMNS.length || scores.some((s) => s == null)) {
    return null;
  }
  if (scores.some((s) => s === 0)) return "ไม่ผ่าน";
  const total = scores.reduce<number>((sum, score) => sum + (score ?? 0), 0);
  if (total >= 15) return "ดีเยี่ยม";
  if (total >= 9) return "ดี";
  if (total >= 1) return "ผ่าน";
  return "ไม่ผ่าน";
}

export function abilityTotal(
  scores: Array<number | null | undefined>,
): number | null {
  if (scores.length !== ABILITY_COLUMNS.length || scores.some((s) => s == null)) {
    return null;
  }
  return scores.reduce<number>((sum, score) => sum + (score ?? 0), 0);
}
