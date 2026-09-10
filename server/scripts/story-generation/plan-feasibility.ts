import { z } from "zod";
import { seasonSpineSchema } from "./serial-narrative";

export function normalizeFeasibilityReview(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const review = value as Record<string, unknown>;
  const normalizeNotes = (notes: unknown) => Array.isArray(notes) ? notes.flat(2).map((issue) =>
    issue && typeof issue === "object" ? JSON.stringify(issue) : issue,
  ) : notes;
  return { ...review, blockingIssues: normalizeNotes(review.blockingIssues), suggestions: normalizeNotes(review.suggestions) };
}

export const spineFeasibilitySchema = z.preprocess(normalizeFeasibilityReview, z.object({
  blockingIssues: z.array(z.string().trim().min(4).max(2000)).max(6),
  suggestions: z.array(z.string().trim().min(4).max(2000)).max(6),
  simplification: z.string().trim().max(1200),
}));

export function spineIsFeasible(review: z.infer<typeof spineFeasibilitySchema>) {
  return review.blockingIssues.length === 0;
}

export const planningHistorySchema = z.array(z.object({
  spine: seasonSpineSchema,
  review: spineFeasibilitySchema,
})).max(6);
export type PlanningHistory = z.infer<typeof planningHistorySchema>;

export function rememberPlanReview(history: PlanningHistory, spine: z.infer<typeof seasonSpineSchema>, review: z.infer<typeof spineFeasibilitySchema>): PlanningHistory {
  return [...history.filter((entry) => JSON.stringify(entry.spine) !== JSON.stringify(spine)), { spine, review }].slice(-6);
}

export function planningFailureBrief(history: PlanningHistory) {
  const blockers = [...new Set(history.flatMap((entry) => entry.review.blockingIssues))].slice(-6);
  return blockers.length ? `此前策划失败依据（仅作预防，不是本故事事实）：${JSON.stringify(blockers)}\n修复建议是待验证的假设，不得当作已成立的因果关系直接照搬。仅在新方案具有相同缺陷时参考，不能把旧故事细节变成新故事要求。新方案必须独立解释原因与解法。` : "";
}

export const lexicalFailureBatchSchema = z.object({
  episode: z.number().int().min(1).max(30),
  words: z.array(z.string().min(1).max(80)).max(36),
});

export function recurringPlanWords(batches: z.infer<typeof lexicalFailureBatchSchema>[], episode: number) {
  const recent = batches.filter((batch) => batch.episode === episode).slice(-2);
  if (recent.length < 2) return [];
  const first = new Set(recent[0].words.map((word) => word.toLowerCase()));
  const repeated = [...new Set(recent[1].words.map((word) => word.toLowerCase()))].filter((word) => first.has(word));
  return repeated.length >= 3 ? repeated : [];
}

export const feasibilityReviewInstructions = `这是中文季纲，不是英文正文。只检查故事设计能否写成当前档位的英语，不检查尚不存在的英文句长、单词覆盖率、中英混杂或假想的英译词。个别名词可用常见短语解释，不因此否决。
按作品已建立的世界规则与叙事类型判断因果。区分情感动机、修辞表达与客观机制：情感变化应有动机依据，客观结果应有成立的原因；不得把一种因果类型的解释要求强加给另一种，也不得要求作品改换题材。未明确写出的机制不能由评审自行假设后再否决。
blockingIssues 仅列没有解决就无法理解主线的明确缺陷：关键选择到后果缺因果、解法依赖未建立的规则或不成立的机制、核心目标/悬念被丢弃；或主线必须解释大量不可替代的专业机制，无法用简单动作表达。每项说明原计划中的具体因果双方及缺少的连接，不能泛称不够可见或太复杂。
suggestions 是非阻断建议，如措辞、补一句空间过渡、笑点、次要场景和可替换名词。只要主线成立，存在这些建议仍可通过。不要为追求零建议而反复重写。
simplification 只提出解决已列阻断问题的最小设计改动。建议本身也要有成立的因果，不能增加未经验证的新机制、材料、线索或支线。保留原题材、核心冲突和已成立的情节，不要重新设计整篇故事。
只返回三个字段 JSON：blockingIssues、suggestions 均为最多三个中文短字符串的数组，simplification 为一个字符串。没有阻断问题时 blockingIssues=[]，不要输出布尔评分字段。`;
