import { createHash } from "node:crypto";
import { z } from "zod";

export type PublishedNarrative = { title: string; paragraphs: string[] };

export const seasonSpineSchema = z.object({
  wholeStory: z.string().trim().min(30).max(4000),
  hiddenCause: z.string().trim().min(8).max(800),
  resolutionMechanism: z.string().trim().min(8).max(800),
});

export const handoffTextSchema = z.object({
  immediateSituation: z.string().trim().min(4).max(600),
  unresolvedPromise: z.string().trim().min(4).max(600),
  nextAction: z.string().trim().min(4).max(600),
  whyNow: z.string().trim().min(4).max(600),
});

export const entryBridgeSchema = handoffTextSchema.extend({
  contractVersion: z.enum(["prose-ledger-v1", "prose-ledger-v2"]).optional(),
  sourceHash: z.string().length(64),
  sourceEnding: z.string().min(1).max(3000),
});

export function groundedEntryBridge(
  episodes: readonly PublishedNarrative[],
  nextGoal: string,
) {
  const sourceEnding = episodes.at(-1)?.paragraphs.at(-1);
  if (!sourceEnding) throw new Error("章节交接缺少上一集正文结尾");
  const bounded = (value: string) => value.length <= 600 ? value : `${value.slice(0, 599)}…`;
  return entryBridgeSchema.parse({
    immediateSituation: bounded(`已发布正文结尾（唯一事实）：${sourceEnding}`),
    unresolvedPromise: bounded(`待承接的已发布结尾（不得外推）：${sourceEnding}`),
    nextAction: bounded(`尚未发生的本集目标，可用因果等价的动作完成：${nextGoal}`),
    whyNow: bounded(`行动起点只依据上述已发布结尾；本集计划、季纲和建议均不是已发生事实。`),
    contractVersion: "prose-ledger-v2",
    sourceHash: publishedNarrativeHash(episodes),
    sourceEnding,
  });
}

export function episodeEndingInstruction(finalEpisode: boolean) {
  return finalEpisode
    ? "这是终集：用已建立的证据和行动解决中心目标，展示结果与情感回报，不新增必须由下一集回答的风险或谜题。"
    : "这是非终集：解决当前小目标，以本集行动产生的新信息或未解决问题形成自然的续读期待。";
}

export const reviewEvidenceRules = "评分依据优先级：已发布正文和当前正文高于季纲、摘要及写作建议。entryBridge 的 immediateSituation/sourceEnding 才是上一集已发生事实；nextAction/whyNow 是相对上一集尚未发生、但允许且通常应在当前候选中完成的本集目标，绝不能据此断言上一集已经完成，也不得因当前稿完成它而要求推迟到下一集。合同只按目标、阻碍、选择、后果、线索推进等叙事功能判断；不得要求指定角色、路线、道具、台词、动作顺序或旧方案细节，只要因果等价即可。requiredClueActions 只规定 plant/use/payoff 的功能，不规定具体展示步骤；读者已知证据首次被另一角色亲眼验证、因此改变决定，已经构成新的关系后果，不得判为重复发现，也不得强制添加方向、深度、距离等合同没有要求的新证据。每条扣分须定位到当前候选真实存在的段落及文字，并在输出前核对正文是否已经以同义表达满足要求；不得一边引用满足要求的句子一边声称该要求缺失。缺失项须说明上下文缺口，不能虚构引用或段号。不得把偏好性扩写、已满足要求或正面评价列为扣分理由。终集评价因果解决与情感回报，不以新风险或下一集钩子评分。";

export function reconcileClueLedger<T extends {
  id: string;
  clue: string;
  misdirection: string;
  payoff: string;
  introducedIn: number;
  usedIn: number;
  payoffIn: number;
}>(old: T[], revised: Array<Pick<T, "id" | "clue" | "misdirection" | "payoff">>, episodeNumber: number): T[] {
  if (revised.length !== old.length || old.some((clue) => revised.filter((item) => item.id === clue.id).length !== 1)) {
    throw new Error("线索校正必须保留全部原线索 ID，不得增加、删除或重复");
  }
  return old.map((clue) => {
    const next = revised.find((item) => item.id === clue.id)!;
    return clue.payoffIn < episodeNumber ? clue : { ...clue, ...next };
  });
}

export function publishedNarrativeHash(episodes: readonly PublishedNarrative[]) {
  return createHash("sha256").update(JSON.stringify(episodes.map(({ title, paragraphs }) => ({ title, paragraphs })))).digest("hex");
}

export function serialSeamContext(episodes: readonly PublishedNarrative[]) {
  return `只核对以下实际存在的相邻章节接缝，不得用更晚章节替代紧邻下一集的承接。空列表表示没有跨集承接项，handoffs 必须为 []：${JSON.stringify(episodes.slice(1).map((episode, index) => ({
    fromEpisode: index + 1, toEpisode: index + 2,
    previousEnding: episodes[index].paragraphs.at(-1), nextOpening: episode.paragraphs[0], nextParagraphs: episode.paragraphs,
  })))}`;
}

export function serialReadingContext(episodes: readonly PublishedNarrative[], finalEpisode: boolean) {
  return `已发布整季正文（事实依据，优先于旧季纲及摘要）：${JSON.stringify(episodes)}\n`
    + `本集是否终集：${finalEpisode ? "是" : "否"}。`
    + "把已发布章节和当前稿连起来读。上一集结尾的核心危险、待执行行动或读者疑问必须在本集开头承接、处理，或明确说明暂缓的原因与状态。"
    + "背景物件可以不复述，但不能把核心悬念当成背景省掉。允许同义改称；驱动行动的空间、人物或物件关系发生变化时，必须提供足够依据让读者连得起来，不强制重复某个单词。"
    + "检查角色为什么行动、失败具体由什么造成、伙伴的帮助怎样改变结果。不能让角色无缘无故失去能力，不能凭物件同时出现推断完整真相。"
    + "终集必须展示原因的验证与解决行动，说明它如何解释前文异常；不得在结尾临时发明规则或用旁白宣布谜底。"
    + "只检查读者理解主线必需的因果，不强制复述每件旧物品、增加感官数量或制造新悬念。";
}

// Recover only lossless scalar representations, never infer missing evidence or IDs.
const positiveIndex = z.preprocess((value) =>
  typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value.trim()) : value,
z.number().int().positive().max(Number.MAX_SAFE_INTEGER));
const explicitBoolean = z.preprocess((value) =>
  value === "true" ? true : value === "false" ? false : value, z.boolean());

export const serialAuditSchema = z.object({
  handoffs: z.array(z.object({
    fromEpisode: positiveIndex,
    handled: explicitBoolean,
    explanation: z.string().trim().min(8).max(700),
  })).max(29),
  issues: z.array(z.object({
    kind: z.enum(["dropped_promise", "unearned_rule", "missing_cause", "unproven_resolution", "insufficient_sensory"]),
    evidenceQuote: z.string().trim().min(4).max(700).optional(),
    episodeNumber: positiveIndex.optional(),
    paragraphNumber: positiveIndex.optional(),
    explanation: z.string().trim().min(8).max(700),
  })).max(4),
});

export function groundedSerialAuditSchema(episodes: readonly PublishedNarrative[]) {
  const text = episodes.flatMap((episode) => episode.paragraphs).join("\n");
  return serialAuditSchema.superRefine((review, context) => {
    const expected = episodes.slice(1).map((_, index) => index + 1);
    if (review.handoffs.length !== expected.length || expected.some((number) => review.handoffs.filter((handoff) => handoff.fromEpisode === number).length !== 1)) {
      context.addIssue({ code: "custom", path: ["handoffs"], message: expected.length ? `fromEpisode 必须恰好为 ${JSON.stringify(expected)}，不得漏项、重复或添加不存在的接缝` : "仅有一集正文，没有跨集接缝，handoffs 必须为 []；本集内部因果问题请放入 issues" });
    }
    for (const [index, issue] of review.issues.entries()) {
      const hasReference = issue.episodeNumber !== undefined && issue.paragraphNumber !== undefined
        && Boolean(episodes[issue.episodeNumber - 1]?.paragraphs[issue.paragraphNumber - 1]);
      if (!hasReference && (!issue.evidenceQuote || !text.includes(issue.evidenceQuote))) context.addIssue({
        code: "custom", path: ["issues", index, "evidenceQuote"], message: "必须给出有效的集号和段号（均从1开始），或逐字引用已提供正文",
      });
    }
  }).transform((review) => ({ ...review, issues: [
    ...review.issues,
    ...review.handoffs.filter((handoff) => !handoff.handled).map((handoff) => ({
      kind: "dropped_promise" as const, episodeNumber: handoff.fromEpisode,
      paragraphNumber: episodes[handoff.fromEpisode - 1].paragraphs.length,
      explanation: handoff.explanation,
    })),
  ] }));
}
