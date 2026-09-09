import assert from "node:assert/strict";
import test from "node:test";
import { recurringPlanWords, spineIsFeasible, spineFeasibilitySchema } from "../scripts/story-generation/plan-feasibility";

test("both causal and language feasibility must pass before splitting", () => {
  const pass = { causalValid: true, languageFeasible: true, issues: [], simplification: "" };
  assert.equal(spineIsFeasible(pass), true);
  assert.equal(spineIsFeasible({ ...pass, causalValid: false }), false);
  assert.equal(spineIsFeasible({ ...pass, languageFeasible: false }), false);
  assert.equal(spineIsFeasible({ ...pass, issues: ["解法无法解释异常"] }), false);
  assert.equal(spineFeasibilitySchema.safeParse({ issues: [] }).success, false);
});

test("explicit boolean strings and nested issue notes recover without treating false as true", () => {
  const review = spineFeasibilitySchema.parse({ causalValid: "false", languageFeasible: "否", issues: [["材料翻面不能补上原来的破口", { reason: "声音相似不能独立证明来源" }]], simplification: "简化为直接可观察的因果" });
  assert.equal(spineIsFeasible(review), false);
  assert.equal(review.causalValid, false);
  assert.match(review.issues[1], /声音相似/);
  assert.equal(spineFeasibilitySchema.safeParse({ causalValid: "probably", languageFeasible: true, issues: [], simplification: "" }).success, false);
});

test("replanning needs recurring vocabulary across separate batches, not repeated tokens", () => {
  const batch = { episode: 1, words: ["tin", "pipe", "bin", "tin"] };
  assert.deepEqual(recurringPlanWords([batch], 1), []);
  assert.deepEqual(recurringPlanWords([batch, { episode: 1, words: ["TIN", "pipe", "bin", "roof"] }], 1), ["tin", "pipe", "bin"]);
  assert.deepEqual(recurringPlanWords([batch, { episode: 1, words: ["tin", "tin", "pipe"] }], 1), []);
});

test("recurrence is episode-local and based on the two most recent batches", () => {
  const batch = { episode: 1, words: ["tin", "pipe", "bin"] };
  assert.deepEqual(recurringPlanWords([batch, { ...batch, episode: 2 }], 2), []);
  assert.deepEqual(recurringPlanWords([batch, batch, { episode: 1, words: ["stone", "gate", "rope"] }], 1), []);
});
