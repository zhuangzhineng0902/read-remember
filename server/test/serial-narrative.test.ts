import assert from "node:assert/strict";
import test from "node:test";
import { entryBridgeSchema, groundedSerialAuditSchema, publishedNarrativeHash, seasonSpineSchema, serialReadingContext, reconcileClueLedger, episodeEndingInstruction, reviewEvidenceRules } from "../scripts/story-generation/serial-narrative";

test("ledger reconciliation preserves resolved clues, identities and episode schedules", () => {
  const old = [
    { id: "C1", introducedIn: 1, usedIn: 1, payoffIn: 1, payoff: "published result" },
    { id: "C2", introducedIn: 1, usedIn: 2, payoffIn: 2, payoff: "old planned result" },
  ];
  const revised = old.map((clue) => ({ ...clue, payoff: "prose-grounded result" }));
  const result = reconcileClueLedger(old, revised, 2);
  assert.deepEqual(result[0], old[0]);
  assert.equal(result[1].payoff, "prose-grounded result");
  assert.equal(old[1].payoff, "old planned result");
  assert.throws(() => reconcileClueLedger(old, revised.slice(1), 2));
  assert.throws(() => reconcileClueLedger(old, [revised[0], revised[0]], 2));
  assert.throws(() => reconcileClueLedger(old, [revised[0], { ...revised[1], payoffIn: 3 }], 2));
});

test("ending and review policies distinguish finale from ongoing episodes without story-specific examples", () => {
  assert.match(episodeEndingInstruction(true), /不新增/);
  assert.match(episodeEndingInstruction(false), /续读期待/);
  assert.match(reviewEvidenceRules, /真实存在的段落/);
  assert.match(reviewEvidenceRules, /不得把指定角色动作/);
  assert.match(reviewEvidenceRules, /终集评价因果解决与情感回报/);
});

const first = { title: "The Hole", paragraphs: ["Dash heard a noise.", "The boards opened. A dark hole lay under Dash."] };
const second = { title: "The Box", paragraphs: ["Dash looked at the box by the wall."] };

test("handoff identity is bound to actual published prose, not just episode titles", () => {
  const hash = publishedNarrativeHash([first]);
  assert.equal(hash, publishedNarrativeHash([structuredClone(first)]));
  assert.notEqual(hash, publishedNarrativeHash([{ ...first, paragraphs: ["The hole closed before Dash moved."] }]));
  assert.notEqual(hash, publishedNarrativeHash([first, second]));
  const handoff = entryBridgeSchema.parse({ sourceHash: hash, sourceEnding: first.paragraphs.at(-1),
    immediateSituation: "Dash 脚下有洞，尚未安全离开", unresolvedPromise: "洞里有什么，如何脱险", nextAction: "先让伙伴帮他退到安全地板", whyNow: "否则他会掉进洞里" });
  assert.equal(handoff.sourceEnding, first.paragraphs.at(-1));
});

test("serial audit requires real prose evidence rather than planning assertions", () => {
  const grounded = groundedSerialAuditSchema([first, second]);
  const schema = { safeParse: (value: { issues: unknown[] }) => grounded.safeParse({ ...value, handoffs: [{ fromEpisode: 1, handled: true, explanation: "此处仅测试证据位置的结构验证。" }] }) };
  assert.ok(schema.safeParse({ issues: [] }).success);
  assert.ok(schema.safeParse({ issues: [{ kind: "dropped_promise", episodeNumber: 1, paragraphNumber: 2, explanation: "下一集没有说明洞口的危险如何处理。" }] }).success);
  assert.equal(schema.safeParse({ issues: [{ kind: "dropped_promise", episodeNumber: 8, paragraphNumber: 2, explanation: "不能引用不存在的章节作为依据。" }] }).success, false);
  assert.ok(schema.safeParse({ issues: [{ kind: "dropped_promise", evidenceQuote: "A dark hole lay under Dash.", explanation: "当前集开头没有交代角色如何离开洞口直接到了箱子旁。" }] }).success);
  assert.equal(schema.safeParse({ issues: [{ kind: "unearned_rule", evidenceQuote: "The moon gave Dash magic powers.", explanation: "不能用未出现的原文作为指控依据。" }] }).success, false);
});

test("serial audit cannot silently skip chapter seams or ignore a failed handoff", () => {
  const schema = groundedSerialAuditSchema([first, second]);
  assert.equal(schema.safeParse({ handoffs: [], issues: [] }).success, false);
  const result = schema.parse({ handoffs: [{ fromEpisode: 1, handled: false, explanation: "上一集脚下的洞未交代如何脱险，下一集直接转向箱子。" }], issues: [] });
  assert.equal(result.issues[0].kind, "dropped_promise");
});

test("serial audit recovers lossless scalar formats without weakening evidence checks", () => {
  const schema = groundedSerialAuditSchema([first, second]);
  const handoff = { fromEpisode: "1", handled: "false", explanation: "下一集未说明上一集危险如何处理。" };
  const issue = { kind: "missing_cause", episodeNumber: "2", paragraphNumber: "1", explanation: "场景变化没有提供可理解的连接。" };
  const result = schema.parse({ handoffs: [handoff], issues: [issue] });
  assert.equal(result.handoffs[0].fromEpisode, 1);
  assert.equal(result.handoffs[0].handled, false);
  assert.equal(result.issues.length, 2);
  for (const invalid of ["", "1x", "1.5", null, true, "9007199254740992", "0"]) {
    assert.equal(schema.safeParse({ handoffs: [{ ...handoff, fromEpisode: invalid }], issues: [] }).success, false);
  }
  assert.equal(schema.safeParse({ handoffs: [{ ...handoff, handled: "maybe" }], issues: [] }).success, false);
  assert.equal(schema.safeParse({ handoffs: [handoff], issues: [{ ...issue, paragraphNumber: "9" }] }).success, false);
  assert.equal(schema.safeParse({ issues: [] }).success, false);
});

test("first episode has no invented handoff and receives actionable correction", () => {
  const schema = groundedSerialAuditSchema([first]);
  assert.equal(schema.safeParse({ handoffs: [], issues: [] }).success, true);
  const result = schema.safeParse({ handoffs: [{ fromEpisode: "1", handled: true, explanation: "错误地给单集文章添加承接检查。" }], issues: [] });
  assert.equal(result.success, false);
  if (!result.success) assert.match(result.error.message, /handoffs 必须为 \[\]/);
});

test("whole-season reading includes earlier chapters and distinguishes core promises from scenery", () => {
  const prompt = serialReadingContext([first, second], true);
  assert.ok(prompt.includes(first.paragraphs[1]));
  assert.ok(prompt.includes(second.paragraphs[0]));
  assert.match(prompt, /本集是否终集：是/);
  assert.match(prompt, /背景物件可以不复述/);
  assert.match(prompt, /不能把核心悬念当成背景省掉/);
  assert.match(prompt, /终集必须展示原因的验证与解决行动/);
});

test("a season spine describes a complete cause and resolution before episode splitting", () => {
  assert.ok(seasonSpineSchema.safeParse({ wholeStory: "伙伴发现洞口，先互相帮助脱险，再追踪声音找到被困的小车，验证声音来源并合作把它救出。",
    hiddenCause: "被困小车推地板寻找出口，因此地板打开了。", resolutionMechanism: "伙伴先听见回应，再看到小车推板，合力打开出口救出它。" }).success);
  assert.equal(seasonSpineSchema.safeParse({ wholeStory: "列出三个场景" }).success, false);
});
