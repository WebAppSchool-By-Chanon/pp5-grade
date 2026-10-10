export type CoverPeriod = "1" | "2" | "annual";

export function resolveCoverPeriod(raw: string | undefined, primary: boolean, currentSemester: number): CoverPeriod {
  if (raw === "1" || raw === "2") return raw;
  return primary ? "annual" : currentSemester === 2 ? "2" : "1";
}

/** Whole-year primary decisions use the mean of scores, never of grades.
 * A wholly unrecorded subject stays blank. A missing other term counts as
 * zero in annual mode, matching the existing score-grid convention. */
export function coverScore(period: CoverPeriod, term1: number | null, term2: number | null): number | null {
  if (period === "1") return term1;
  if (period === "2") return term2;
  if (term1 == null && term2 == null) return null;
  return ((term1 ?? 0) + (term2 ?? 0)) / 2;
}
