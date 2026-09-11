import { z } from "zod";

export const evidenceQuoteLimits = {
  phrase: { min: 3, max: 100 },
  passage: { min: 8, max: 300 },
};
export const phraseQuoteSchema = z.string().trim().min(evidenceQuoteLimits.phrase.min).max(evidenceQuoteLimits.phrase.max);
export const passageQuoteSchema = z.string().trim().min(evidenceQuoteLimits.passage.min).max(evidenceQuoteLimits.passage.max);
export type EvidenceCandidate = { id: number; paragraph: number; quote: string };

// Extract original spans only. Never truncate model prose or join distant text.
export function evidenceCandidates(paragraphs: string[], phrase: boolean): EvidenceCandidate[] {
  const limits = phrase ? evidenceQuoteLimits.phrase : evidenceQuoteLimits.passage;
  const candidates: EvidenceCandidate[] = [];
  const seen = new Set<string>();
  const add = (quote: string, paragraph: number) => {
    quote = quote.trim();
    if (quote.length < limits.min || quote.length > limits.max || seen.has(quote)) return;
    seen.add(quote);
    candidates.push({ id: candidates.length, paragraph, quote });
  };
  paragraphs.forEach((text, index) => {
    const sentences = [...text.matchAll(/[^.!?]+(?:[.!?]+["”’']*|$)/g)];
    for (let i = 0; i < sentences.length; i++) {
      add(sentences[i][0], index + 1);
      if (!phrase && sentences[i + 1]) add(text.slice(sentences[i].index!, sentences[i + 1].index! + sentences[i + 1][0].length), index + 1);
    }
    for (const clause of text.matchAll(/[^,;:!?\.]+[,;:!?\.]?/g)) add(clause[0], index + 1);
    // Short phrases need sub-sentence choices; long sentences need bounded spans.
    const words = [...text.matchAll(/\S+/g)];
    const widths = phrase ? [2, 3, 4, 5, 6, 8] : [8, 16, 24];
    for (let start = 0; start < words.length; start += phrase ? 1 : 4) {
      for (const width of widths) {
        const end = words[start + width - 1];
        if (end) add(text.slice(words[start].index!, end.index! + end[0].length), index + 1);
      }
    }
  });
  return candidates;
}

const indexSchema = z.preprocess((value) => typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value) : value,
  z.number().int().nonnegative());

export function evidenceSelectionSchema(choices: EvidenceCandidate[][]) {
  return z.object({ replacements: z.array(z.object({ index: indexSchema, candidateId: indexSchema.nullable() })).length(choices.length) })
    .superRefine(({ replacements }, ctx) => {
      if (new Set(replacements.map((item) => item.index)).size !== choices.length) ctx.addIssue({ code: "custom", message: "每个字段必须恰好选择一次" });
      for (const item of replacements) {
        if (!choices[item.index] || (item.candidateId !== null && !choices[item.index].some((candidate) => candidate.id === item.candidateId))) {
          ctx.addIssue({ code: "custom", message: `字段 ${item.index} 的 candidateId 不在对应候选表内` });
        }
      }
    });
}
