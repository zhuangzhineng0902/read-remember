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
  sourceHash: z.string().length(64),
  sourceEnding: z.string().min(1).max(3000),
});

export function publishedNarrativeHash(episodes: readonly PublishedNarrative[]) {
  return createHash("sha256").update(JSON.stringify(episodes.map(({ title, paragraphs }) => ({ title, paragraphs })))).digest("hex");
}

export function serialSeamContext(episodes: readonly PublishedNarrative[]) {
  return `逐项核对相邻集，严禁用第三集替代第二集回答第一集的承接：${JSON.stringify(episodes.slice(1).map((episode, index) => ({
    fromEpisode: index + 1, toEpisode: index + 2,
    previousEnding: episodes[index].paragraphs.at(-1), nextOpening: episode.paragraphs[0], nextParagraphs: episode.paragraphs,
  })))}`;
}

export function serialReadingContext(episodes: readonly PublishedNarrative[], finalEpisode: boolean) {
  return `已发布整季正文（事实依据，优先于旧季纲及摘要）：${JSON.stringify(episodes)}\n`
    + `本集是否终集：${finalEpisode ? "是" : "否"}。`
    + "把已发布章节和当前稿连起来读。上一集结尾的核心危险、待执行行动或读者疑问必须在本集开头承接、处理，或明确说明暂缓的原因与状态。"
    + "背景物件可以不复述，但不能把核心悬念当成背景省掉。允许同义改称，但洞、裂缝、箱子等空间或物件关系若驱动行动，必须用动作或一句说明让读者连得起来；不强制重复某个单词。"
    + "检查角色为什么行动、失败具体由什么造成、伙伴的帮助怎样改变结果。不能让角色无缘无故失去能力，不能凭物件同时出现推断完整真相。"
    + "终集必须展示原因的验证与解决行动，说明它如何解释前文异常；不得在结尾临时发明规则或用旁白宣布谜底。"
    + "只检查读者理解主线必需的因果，不强制复述每件旧物品、增加感官数量或制造新悬念。";
}

export const serialAuditSchema = z.object({
  handoffs: z.array(z.object({
    fromEpisode: z.number().int().positive(),
    handled: z.boolean(),
    explanation: z.string().trim().min(8).max(700),
  })).max(29),
  issues: z.array(z.object({
    kind: z.enum(["dropped_promise", "unearned_rule", "missing_cause", "unproven_resolution"]),
    evidenceQuote: z.string().trim().min(4).max(700).optional(),
    episodeNumber: z.number().int().positive().optional(),
    paragraphNumber: z.number().int().positive().optional(),
    explanation: z.string().trim().min(8).max(700),
  })).max(4),
});

export function groundedSerialAuditSchema(episodes: readonly PublishedNarrative[]) {
  const text = episodes.flatMap((episode) => episode.paragraphs).join("\n");
  return serialAuditSchema.superRefine((review, context) => {
    const expected = episodes.slice(1).map((_, index) => index + 1);
    if (review.handoffs.length !== expected.length || expected.some((number) => review.handoffs.filter((handoff) => handoff.fromEpisode === number).length !== 1)) {
      context.addIssue({ code: "custom", path: ["handoffs"], message: `必须逐一核对所有章节接缝：${expected.join(",")}，不得漏项或重复` });
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
