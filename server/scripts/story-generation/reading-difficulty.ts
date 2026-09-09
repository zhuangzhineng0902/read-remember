import type { ResolvedReaderStageId } from "./catalog";

// Reader level controls language; exam category controls topic and length.
export function readingDifficulty(stage: ResolvedReaderStageId) {
  const limits = {
    starter: [8, 18], stage1: [10, 21], stage2: [12, 24],
    stage3: [14, 26], stage4: [16, 28], stage5: [18, 30], stage6: [20, 32],
  } as const;
  const [averageSentenceWords, maximumSentenceWords] = limits[stage];
  return { averageSentenceWords, maximumSentenceWords };
}

export function readingLanguageBrief(stage: ResolvedReaderStageId) {
  const limits = readingDifficulty(stage);
  return `平均句长目标不超过 ${limits.averageSentenceWords} 词，单句不超过 ${limits.maximumSentenceWords} 词。语言档位优先于考试类别，不能因为读者是初中生就假定其已掌握高中词汇。
生词额度包含目标词、场景术语和固定物件名称；固定称呼不等于熟词。核心动作先用常用动词和具体名词，不能靠注释掩盖难度。
${stage === "starter" || stage === "stage1" ? "入门写法：一句主要表达一个动作或观察；优先简单过去时、直接引语和 and/but/because，少用被动语态、分词伴随结构、嵌套从句和多层方位关系。题材可以有冒险和悬念，但每段只推进一个关键动作；明确谁做了什么、为什么以及结果。避免依赖多个专业零件、工具或抽象制度完成解谜，保留一个可见线索，让人物用简单对话解释推理。用孩子熟悉的物件承载题材，保留原有核心事实，不要把文章压成事件摘要。" : "控制从句和抽象概念的密度，关键推理通过可见行动与明确因果展开。"}`;
}
