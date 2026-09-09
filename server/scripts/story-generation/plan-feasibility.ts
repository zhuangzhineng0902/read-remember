import { z } from "zod";

function explicitBoolean(value: unknown) {
  if (typeof value !== "string") return value;
  const normalized = value.trim().toLowerCase();
  if (["true", "是", "通过"].includes(normalized)) return true;
  if (["false", "否", "不通过", "未通过"].includes(normalized)) return false;
  return value; // Never interpret unknown prose or the string "false" as truthy.
}

export function normalizeFeasibilityReview(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const review = value as Record<string, unknown>;
  const issues = Array.isArray(review.issues) ? review.issues.flat(2).map((issue) =>
    issue && typeof issue === "object" ? JSON.stringify(issue) : issue,
  ) : review.issues;
  return { ...review, causalValid: explicitBoolean(review.causalValid), languageFeasible: explicitBoolean(review.languageFeasible), issues };
}

export const spineFeasibilitySchema = z.preprocess(normalizeFeasibilityReview, z.object({
  causalValid: z.boolean(),
  languageFeasible: z.boolean(),
  issues: z.array(z.string().trim().min(4).max(2000)).max(12),
  simplification: z.string().trim().max(1200),
}));

export function spineIsFeasible(review: z.infer<typeof spineFeasibilitySchema>) {
  return review.causalValid && review.languageFeasible && review.issues.length === 0;
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

export const feasibilityReviewInstructions = `独立检查这份故事是否值得进入分集写作，不因为它结构完整就判合格。
causalValid：逐条核对失误为何造成后果、异常声音/现象的传播机制、解法为何真的有效。区分玩具拟人设定和不成立的物理因果，不能自行补设定替作者圆场。
languageFeasible：按指定语言档位评估整个任务能否主要用常见名词、动作和简单句讲清。不能依靠大量专业零件、材料性质、多层水路/线路/空间关系、独立场景来解谜；提供熟词表不等于复杂情节就可表达。
低档位保留冒险、误会、角色选择的代价和伙伴合作，但通过一个可见原因、一个验证行动和明确结果完成，不靠专业机制制造悬念。不要以压短文字或删去因果代替简化设计。
返回四字段 JSON：causalValid、languageFeasible 必须是布尔值；issues 是最多三个中文短字符串；simplification 是一段字符串。issues 只列实质缺陷；全部通过才为空。失败时 simplification 给出保留故事吸引力的具体简化方向，而不是要求泛泛润色。`;
