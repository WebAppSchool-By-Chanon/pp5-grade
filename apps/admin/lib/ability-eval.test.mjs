import assert from "node:assert/strict";
import test from "node:test";
import { abilityTotal, summarizeAbility } from "./ability-eval.ts";

test("annual ability summary uses all eight scores and the workbook cutoffs", () => {
  assert.equal(summarizeAbility(Array(8).fill(1)), "ผ่าน"); // 8
  assert.equal(summarizeAbility([2, 1, 1, 1, 1, 1, 1, 1]), "ดี"); // 9
  assert.equal(summarizeAbility([2, 2, 2, 2, 2, 2, 2, 1]), "ดีเยี่ยม"); // 15
  assert.equal(abilityTotal(Array(8).fill(3)), 24);
});

test("any zero fails, and unfinished rows are not classified", () => {
  assert.equal(summarizeAbility([0, 3, 3, 3, 3, 3, 3, 3]), "ไม่ผ่าน");
  assert.equal(summarizeAbility([3, 3, 3, 0, 3, 3, 3, 3]), "ไม่ผ่าน");
  assert.equal(summarizeAbility([3, 3, 3, 3, 3, 3, 3, null]), null);
  assert.equal(abilityTotal([3, 3, 3, 3, 3, 3, 3, null]), null);
});
