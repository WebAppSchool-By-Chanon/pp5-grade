import assert from "node:assert/strict";
import test from "node:test";
import { coverScore, resolveCoverPeriod } from "./pp5-cover-period.ts";
import { cutGrade } from "../app/(admin)/setup/score-structure/grading-utils.ts";

test("defaults preserve primary annual / secondary current term; explicit terms override", () => {
  assert.equal(resolveCoverPeriod(undefined, true, 1), "annual");
  assert.equal(resolveCoverPeriod(undefined, false, 2), "2");
  assert.equal(resolveCoverPeriod("1", false, 2), "1");
  assert.equal(resolveCoverPeriod("2", true, 1), "2");
  assert.equal(resolveCoverPeriod("annual", false, 2), "2");
});
test("term 1 can be submitted without term 2, and does not include its score", () => {
  assert.equal(coverScore("1", 80, null), 80);
  assert.equal(coverScore("1", 80, 40), 80);
  assert.equal(coverScore("2", 80, 40), 40);
  assert.equal(coverScore("2", 80, null), null);
});
test("annual grade uses average score rather than average grade", () => {
  const scales = [{ min_score: 80, max_score: 100, grade: 4 }, { min_score: 70, max_score: 74, grade: 3 }, { min_score: 0, max_score: 49, grade: 0 }];
  assert.equal(coverScore("annual", 100, 40), 70);
  assert.equal(cutGrade(coverScore("annual", 100, 40), scales), 3); // averaging grades (4 + 0) / 2 would incorrectly give 2
  assert.equal(coverScore("annual", null, null), null);
  assert.equal(coverScore("annual", 80, null), 40);
  assert.equal(coverScore("1", 0, null), 0);
});
