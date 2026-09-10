import assert from "node:assert/strict";
import test from "node:test";
import { recurringPlanWords, spineIsFeasible, spineFeasibilitySchema, rememberPlanReview, planningHistorySchema, planningFailureBrief, feasibilityReviewInstructions } from "../scripts/story-generation/plan-feasibility";

test("only explicit blockers reject a plan; improvement suggestions do not", () => {
  const pass = { blockingIssues: [], suggestions: ["可以补一句空间过渡"], simplification: "" };
  assert.equal(spineIsFeasible(pass), true);
  assert.equal(spineIsFeasible({ ...pass, blockingIssues: ["解法无法解释异常"] }), false);
  assert.equal(spineFeasibilitySchema.safeParse({ issues: [] }).success, false);
});

test("nested issue notes recover without defaulting absent blockers to a pass", () => {
  const review = spineFeasibilitySchema.parse({ blockingIssues: [["材料翻面不能补上原来的破口", { reason: "声音相似不能独立证明来源" }]], suggestions: [], simplification: "简化为直接可观察的因果" });
  assert.equal(spineIsFeasible(review), false);
  assert.match(review.blockingIssues[1], /声音相似/);
  assert.equal(spineFeasibilitySchema.safeParse({ causalValid: "probably", languageFeasible: true, issues: [], simplification: "" }).success, false);
});

test("planning history survives serialization, is bounded and feeds only diagnosed blockers forward", () => {
  const spine = { wholeStory: "两个伙伴寻找走散的朋友，先观察脚印再呼喊，朋友回应后一起回家，担心的伙伴终于恢复精神。", hiddenCause: "伙伴因担心走散的朋友而发抖。", resolutionMechanism: "朋友回应并重逢后，它放下担心恢复精神。" };
  const review = { blockingIssues: ["必须说明主角如何得知朋友被困"], suggestions: ["可以增加一个笑点"], simplification: "待验证建议" };
  let history = rememberPlanReview([], spine, review);
  history = rememberPlanReview(history, spine, review);
  assert.equal(history.length, 1);
  for (let index = 0; index < 8; index++) history = rememberPlanReview(history, { ...spine, wholeStory: spine.wholeStory + index }, review);
  const restored = planningHistorySchema.parse(JSON.parse(JSON.stringify(history)));
  assert.equal(restored.length, 6);
  assert.match(planningFailureBrief(restored), /如何得知朋友被困/);
  assert.doesNotMatch(planningFailureBrief(restored), /增加一个笑点/);
  assert.match(feasibilityReviewInstructions, /这是中文季纲，不是英文正文/);
  assert.match(feasibilityReviewInstructions, /区分情感动机、修辞表达与客观机制/);
  assert.doesNotMatch(feasibilityReviewInstructions, /玩具|电路|发抖|重逢/);
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
