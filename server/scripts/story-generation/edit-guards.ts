export type NarrativeText = {
  title?: string;
  paragraphs: string[];
};

function narrativeWords(value: string) {
  return (value.toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) ?? [])
    .filter((word) => !new Set([
      "a", "an", "the", "and", "or", "but", "to", "of", "in", "on", "at", "for", "with",
      "is", "was", "were", "are", "be", "been", "it", "he", "she", "they", "his", "her", "their",
    ]).has(word));
}

function narrativeWordCount(narrative: NarrativeText) {
  return narrative.paragraphs.join(" ").match(/[A-Za-z]+(?:['-][A-Za-z]+)*/g)?.length ?? 0;
}

export function trimTinyNarrativeOverflow<T extends NarrativeText>(
  narrative: T,
  maximumWords: number,
  toleranceWords = 3,
): T {
  const overflow = narrativeWordCount(narrative) - maximumWords;
  if (overflow <= 0 || overflow > toleranceWords) return narrative;
  const removable = /\b(?:very|really|quite|rather|suddenly|softly|slowly|quickly)\b/i;
  const paragraphs = [...narrative.paragraphs];
  let remaining = overflow;
  for (let index = paragraphs.length - 1; index >= 0 && remaining > 0; index--) {
    while (remaining > 0 && removable.test(paragraphs[index])) {
      paragraphs[index] = paragraphs[index]
        .replace(removable, "")
        .replace(/\s+([,.;!?])/g, "$1")
        .replace(/ {2,}/g, " ")
        .trim();
      remaining--;
    }
  }
  return remaining === 0 ? { ...narrative, paragraphs } : narrative;
}

export function compressionDriftIssues(original: NarrativeText, compressed: NarrativeText) {
  const issues: string[] = [];
  const originalWordCount = narrativeWordCount(original);
  const compressedWordCount = narrativeWordCount(compressed);
  if (compressedWordCount >= originalWordCount) {
    issues.push(`压缩稿没有变短：${originalWordCount} → ${compressedWordCount} 词`);
  }
  for (let index = 0; index < Math.min(original.paragraphs.length, compressed.paragraphs.length); index++) {
    const sourceWords = new Set(narrativeWords(original.paragraphs[index]));
    const outputWords = narrativeWords(compressed.paragraphs[index]);
    if (!outputWords.length) continue;
    const retained = outputWords.filter((word) => sourceWords.has(word)).length / outputWords.length;
    if (retained < 0.68) {
      issues.push(`第 ${index + 1} 段与原段词汇重合仅 ${(retained * 100).toFixed(0)}%，疑似改写或新增情节`);
    }
  }
  return issues;
}

export function lexicalEditWordBudget(originalWords: number, publishMinimum: number, publishMaximum: number) {
  // Explaining one hard word may require several easy words. Keep the
  // anti-summary deletion budget small, independently of bounded expansion.
  return {
    maximumRemoved: Math.max(0, Math.min(originalWords - publishMinimum, Math.max(6, Math.round(originalWords * 0.025)))),
    maximumAdded: Math.max(0, Math.min(publishMaximum - originalWords, Math.max(6, Math.ceil(originalWords * 0.08)))),
  };
}

export function lexicalEditDriftIssues(
  original: NarrativeText & { title: string },
  edited: NarrativeText & { title: string },
  maximumWordDelta: number | ReturnType<typeof lexicalEditWordBudget> = 6,
) {
  const issues: string[] = [];
  const originalWordCount = narrativeWordCount(original);
  const editedWordCount = narrativeWordCount(edited);
  if (original.title.trim() !== edited.title.trim()) issues.push("词汇简化不应修改标题");
  if (edited.paragraphs.length !== original.paragraphs.length) {
    issues.push(`词汇简化改变了段数：${original.paragraphs.length} → ${edited.paragraphs.length}`);
  }
  const removed = typeof maximumWordDelta === "number" ? maximumWordDelta : maximumWordDelta.maximumRemoved;
  const added = typeof maximumWordDelta === "number" ? maximumWordDelta : maximumWordDelta.maximumAdded;
  if (editedWordCount < originalWordCount - removed || editedWordCount > originalWordCount + added) {
    issues.push(
      `词汇简化改变正文长度过多：${originalWordCount} → ${editedWordCount} 词，最多删 ${removed} 词、增 ${added} 词`,
    );
  }
  for (let index = 0; index < Math.min(original.paragraphs.length, edited.paragraphs.length); index++) {
    const sourceWords = new Set(narrativeWords(original.paragraphs[index]));
    const outputWords = narrativeWords(edited.paragraphs[index]);
    if (!outputWords.length) continue;
    const retained = outputWords.filter((word) => sourceWords.has(word)).length / outputWords.length;
    if (retained < 0.78) {
      issues.push(`第 ${index + 1} 段词汇重合仅 ${(retained * 100).toFixed(0)}%，超出局部换词范围`);
    }
  }
  return issues;
}
