import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { z } from "zod";
import { evidenceCandidates, evidenceSelectionSchema, phraseQuoteSchema, passageQuoteSchema } from "./evidence-selection";
import {
  localRepairAttemptsSchema,
  chooseRepairKind,
  canAttemptRepair,
  onlyMetadataBlocks,
  lexicalFloorPassed,
  storyIssueSchema,
  type StoryIssue,
} from "./repair-routing";
import type { ExamId, InterestId, Question } from "../../../client/src/types";
import { createDatabase } from "../../src/database";
import { importArticles } from "../../src/content-import";
import { openEcdict } from "../../src/ecdict";
import {
  narrativeCompletionTokenBudget,
  storyEpisodeAttemptBudget,
} from "./attempt-policy";
import { StoryGenerationFailure, storyGenerationPolicy } from "./generation-policy";
import { compressionDriftIssues, lexicalEditDriftIssues, lexicalEditWordBudget, trimTinyNarrativeOverflow } from "./edit-guards";
import { isTransientModelCapacityError } from "./model-errors";
import { spineFeasibilitySchema, spineIsFeasible, feasibilityReviewInstructions,
  lexicalFailureBatchSchema, recurringPlanWords, planningFailureBrief, planningHistorySchema,
  rememberPlanReview, type PlanningHistory } from "./plan-feasibility";
import { seasonSpineSchema, entryBridgeSchema, publishedNarrativeHash,
  groundedEntryBridge, serialReadingContext, serialSeamContext, groundedSerialAuditSchema, episodeEndingInstruction, reviewEvidenceRules, reconcileClueLedger, type PublishedNarrative } from "./serial-narrative";
import { readingDifficulty, readingLanguageBrief } from "./reading-difficulty";
import {
  buildNarrativeCraftBrief,
  classicSources,
  readerStages,
  storyGuideFor,
  storyInterestIds,
  type ClassicSourceId,
  type ReaderStageId,
  type ResolvedReaderStageId,
  type StoryInterestId,
  type StorySourceMode,
} from "./catalog";
import {
  callStructured,
  creativeDraftModelPolicy,
  modelRequestError,
  modelTokenBudgets,
  semanticPlanningModelPolicy,
  semanticRewriteModelPolicy,
  type ModelCallPolicy,
} from "./model-client";
import {
  jsonParseFailure,
  ModelJsonParseError,
  parseJson,
  structuredJsonValues,
  structuredValueShape,
} from "./model-response";

export { narrativeCompletionTokenBudget, storyEpisodeAttemptBudget } from "./attempt-policy";
export { StoryGenerationFailure, storyGenerationPolicy } from "./generation-policy";
export { compressionDriftIssues, lexicalEditDriftIssues, trimTinyNarrativeOverflow } from "./edit-guards";
export { isTransientModelCapacityError } from "./model-errors";
export {
  buildNarrativeCraftBrief,
  type ClassicSourceId,
  type ReaderStageId,
  type StorySourceMode,
} from "./catalog";
export {
  callStructured,
  creativeDraftModelPolicy,
  readStreamingModelContent,
  recoverStructuredComposite,
  semanticPlanningModelPolicy,
  semanticRewriteModelPolicy,
  structureModelForAttempt,
} from "./model-client";
export {
  ModelJsonParseError,
  parseJson,
  structuredJsonValues,
} from "./model-response";

const storyBibleSchema = z.object({
  worldRules: z.array(z.string().trim().min(8).max(300)).min(3).max(8),
  fixedTerms: z.array(z.object({
    concept: z.string().trim().min(2).max(100),
    english: z.string().trim().min(1).max(100),
  })).min(3).max(16),
  characterArcs: z.array(z.object({
    name: z.string().trim().min(1).max(50),
    wants: z.string().trim().min(4).max(200),
    fear: z.string().trim().min(4).max(200),
    voice: z.string().trim().min(4).max(200),
    growth: z.string().trim().min(8).max(300),
  })).min(3).max(8),
});

const episodeBeatSchema = z.object({
  entryBridge: entryBridgeSchema.optional(),
  number: z.number().int().min(1).max(100),
  title: z.string().trim().min(3).max(160),
  episodeMission: z.string().trim().min(10).max(500),
  newInformation: z.array(z.string().trim().min(6).max(300)).min(1).max(3),
  irreversibleChange: z.string().trim().min(8).max(400),
  mustNotRepeat: z.array(z.string().trim().min(6).max(300)).max(5),
  openingHook: z.string().trim().min(10).max(500),
  goal: z.string().trim().min(8).max(400),
  obstacle: z.string().trim().min(8).max(400),
  choice: z.string().trim().min(8).max(400),
  consequence: z.string().trim().min(8).max(400),
  newQuestion: z.string().trim().min(8).max(400),
  problem: z.string().trim().min(10).max(500),
  clue: z.string().trim().min(5).max(500),
  teamworkTurn: z.string().trim().min(10).max(500),
  emotionalBeat: z.string().trim().min(10).max(500),
  cliffhanger: z.string().trim().min(10).max(500),
});

export const episodePlanPatchSchema = episodeBeatSchema.omit({
  entryBridge: true,
  number: true,
  mustNotRepeat: true,
});

export const continuityEpisodePatchSchema = episodePlanPatchSchema.omit({
  title: true,
  episodeMission: true,
  newInformation: true,
  irreversibleChange: true,
});

const clueLedgerEntrySchema = z.object({
  id: z.string().trim().regex(/^C\d+$/),
  clue: z.string().trim().min(5).max(400),
  introducedIn: z.number().int().min(1).max(100),
  misdirection: z.string().trim().min(5).max(400),
  usedIn: z.number().int().min(1).max(100),
  payoffIn: z.number().int().min(1).max(100),
  payoff: z.string().trim().min(8).max(500),
});

export const clueLedgerPatchSchema = clueLedgerEntrySchema.pick({
  id: true,
  clue: true,
  misdirection: true,
  payoff: true,
});

const clueLedgerPatchListSchema = z.array(clueLedgerPatchSchema);

export const continuityRepairPatchSchema = z.preprocess((value) => {
  if (continuityEpisodePatchSchema.safeParse(value).success) return { episode: value };
  if (!Array.isArray(value)) return value;
  const episode = value.find((item) => continuityEpisodePatchSchema.safeParse(item).success);
  const clueLedger = value.find((item) => clueLedgerPatchListSchema.safeParse(item).success);
  return episode ? { episode, ...(clueLedger ? { clueLedger } : {}) } : value;
}, z.object({
  episode: continuityEpisodePatchSchema,
  clueLedger: clueLedgerPatchListSchema.default([]),
}));

export const continuityRepairRootTemplate = JSON.stringify({
  episode: {
    openingHook: "中文",
    goal: "中文",
    obstacle: "中文",
    choice: "中文",
    consequence: "中文",
    newQuestion: "中文",
    problem: "中文",
    clue: "中文",
    teamworkTurn: "中文",
    emotionalBeat: "中文",
    cliffhanger: "中文",
  },
  clueLedger: [{ id: "C1", clue: "中文", misdirection: "中文", payoff: "中文" }],
});

const planObjectSchema = z.object({
  narrativeSpine: seasonSpineSchema.optional(),
  seriesTitle: z.string().trim().min(3).max(120),
  premise: z.string().trim().min(30).max(1000),
  cast: z.array(
    z.object({
      name: z.string().trim().min(1).max(50),
      role: z.string().trim().min(2).max(200),
      strength: z.string().trim().min(2).max(200),
      flaw: z.string().trim().min(2).max(200),
    }),
  ).min(3).max(8),
  seasonMystery: z.string().trim().min(20).max(1000),
  storyBible: storyBibleSchema,
  clueLedger: z.array(clueLedgerEntrySchema).min(2).max(30),
  episodes: z.array(episodeBeatSchema).min(2).max(30),
});

function objectArray(value: unknown) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return Object.values(value as Record<string, unknown>);
  return value;
}

function boundedArray(value: unknown, maximum: number) {
  const normalized = objectArray(value);
  return Array.isArray(normalized) ? normalized.slice(0, maximum) : normalized;
}

function integerLike(value: unknown) {
  return typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value) : value;
}

function normalizeEpisodeBeat(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const episode = value as Record<string, unknown>;
  return {
    ...episode,
    number: integerLike(episode.number),
    newInformation: boundedArray(episode.newInformation, 3),
    mustNotRepeat: boundedArray(episode.mustNotRepeat, 5),
  };
}

function normalizeClueLedgerEntry(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const clue = value as Record<string, unknown>;
  return {
    ...clue,
    introducedIn: integerLike(clue.introducedIn),
    usedIn: integerLike(clue.usedIn),
    payoffIn: integerLike(clue.payoffIn),
  };
}

export function normalizeSeriesPlan(value: unknown) {
  let candidate = value;
  while (Array.isArray(candidate) && candidate.length === 1) candidate = candidate[0];
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return candidate;
  let plan = candidate as Record<string, unknown>;
  for (const key of ["plan", "data", "result"] as const) {
    const nested = plan[key];
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      const nestedRecord = nested as Record<string, unknown>;
      if ("seriesTitle" in nestedRecord || "episodes" in nestedRecord) {
        plan = nestedRecord;
        break;
      }
    }
  }
  const storyBibleRecord = plan.storyBible && typeof plan.storyBible === "object" && !Array.isArray(plan.storyBible)
    ? plan.storyBible as Record<string, unknown>
    : null;
  const rawEpisodes = Array.isArray(objectArray(plan.episodes))
    ? (boundedArray(plan.episodes, 30) as unknown[]).map(normalizeEpisodeBeat)
    : objectArray(plan.episodes);
  const episodes = Array.isArray(rawEpisodes)
    ? rawEpisodes.map((episode, index) => {
        if (!episode || typeof episode !== "object" || Array.isArray(episode)) return episode;
        if (index === 0) return { ...episode, mustNotRepeat: [] };
        const previous = rawEpisodes[index - 1];
        if (!previous || typeof previous !== "object" || Array.isArray(previous)) return episode;
        const previousBeat = previous as Record<string, unknown>;
        const previousFacts = Array.isArray(previousBeat.newInformation)
          ? previousBeat.newInformation.filter((item): item is string => typeof item === "string").slice(0, 2)
          : [];
        const irreversibleChange = typeof previousBeat.irreversibleChange === "string"
          ? previousBeat.irreversibleChange
          : "";
        return {
          ...episode,
          mustNotRepeat: [
            ...previousFacts.map((fact) => `允许用一句话承接当前状态，但不得把以下已知事实再次写成新发现、主要目标或重新解决的冲突：${fact}`),
            ...(irreversibleChange
              ? [`允许说明以下结果仍然存在，但不得重新表演或重新完成这项上一集已经发生的变化：${irreversibleChange}`]
              : []),
          ].slice(0, 3),
        };
      })
    : rawEpisodes;
  return {
    ...plan,
    cast: boundedArray(plan.cast, 8),
    storyBible: storyBibleRecord
      ? {
          ...storyBibleRecord,
          worldRules: boundedArray(storyBibleRecord.worldRules, 8),
          fixedTerms: boundedArray(storyBibleRecord.fixedTerms, 16),
          characterArcs: Array.isArray(boundedArray(storyBibleRecord.characterArcs, 8))
            ? (boundedArray(storyBibleRecord.characterArcs, 8) as unknown[]).map((arc) => {
                if (!arc || typeof arc !== "object" || Array.isArray(arc)) return arc;
                const record = arc as Record<string, unknown>;
                return {
                  ...record,
                  // Voice is editorial guidance rather than story state. A
                  // missing value can be filled safely without regenerating a
                  // complete season plan.
                  voice: typeof record.voice === "string" && record.voice.trim()
                    ? record.voice
                    : "使用简短自然的句子表达观察、选择和感受",
                };
              })
            : boundedArray(storyBibleRecord.characterArcs, 8),
        }
      : plan.storyBible,
    clueLedger: Array.isArray(objectArray(plan.clueLedger))
      ? (boundedArray(plan.clueLedger, 30) as unknown[]).map(normalizeClueLedgerEntry)
      : objectArray(plan.clueLedger),
    episodes,
  };
}

const planSchema = z.preprocess(normalizeSeriesPlan, planObjectSchema);

function generatedPlanSchema(options: Pick<StoryRunOptions, "examId" | "readerStage" | "episodes">) {
  return z.preprocess(
    normalizeSeriesPlan,
    planObjectSchema.superRefine((plan, context) => {
      try {
        validateSeriesPlan(plan, options.episodes);
      } catch (error) {
        context.addIssue({
          code: "custom",
          message: error instanceof Error ? error.message : "故事季纲不符合容量约束",
        });
      }
      const capacity = storyPlanCapacity(options);
      if (plan.cast.length > capacity.maximumMainCharacters) {
        context.addIssue({
          code: "custom",
          path: ["cast"],
          message: `当前阅读档位最多 ${capacity.maximumMainCharacters} 位主要角色，实际 ${plan.cast.length} 位`,
        });
      }
      if (plan.clueLedger.length > capacity.maximumSeasonClues) {
        context.addIssue({
          code: "custom",
          path: ["clueLedger"],
          message: `当前篇幅最多 ${capacity.maximumSeasonClues} 条整季线索，实际 ${plan.clueLedger.length} 条`,
        });
      }
      if (plan.storyBible.worldRules.length > capacity.maximumWorldRules) {
        context.addIssue({
          code: "custom",
          path: ["storyBible", "worldRules"],
          message: `当前阅读档位最多 ${capacity.maximumWorldRules} 条世界规则，实际 ${plan.storyBible.worldRules.length} 条`,
        });
      }
      for (const [episodeIndex, episode] of plan.episodes.entries()) {
        if (episode.newInformation.length > capacity.maximumNewFactsPerEpisode) {
          context.addIssue({
            code: "custom",
            path: ["episodes", episodeIndex, "newInformation"],
            message: `当前篇幅每集最多 ${capacity.maximumNewFactsPerEpisode} 条核心新事实`,
          });
        }
      }
    }),
  );
}

const planSelectionSchema = z.object({
  selectedCandidate: z.preprocess(
    integerLike,
    z.number().int().min(1).max(4),
  ),
  rationale: z.preprocess(
    (value) => typeof value === "string" ? value.trim().slice(0, 800) : value,
    z.string().min(8).max(800),
  ),
});

const questionSchema = z.object({
  prompt: z.string().trim().min(8).max(500),
  options: z.array(z.string().trim().min(1).max(500)).length(4),
  answer: z.number().int().min(0).max(3),
  explanation: z.string().trim().min(4).max(1000),
  skill: z.enum(["detail", "inference", "cause_effect"]),
  evidenceQuote: z.string().trim().min(8).max(300),
});

const groundedQuestionReviewSchema = z.object({
  reviews: z.array(z.object({
    questionIndex: z.preprocess(integerLike, z.number().int().min(0).max(1)),
    supported: z.boolean(),
    uniqueAnswer: z.boolean(),
    issues: z.array(z.string().trim().min(2).max(300)).max(4),
  })).length(2),
}).superRefine((value, context) => {
  if (new Set(value.reviews.map((review) => review.questionIndex)).size !== 2) {
    context.addIssue({ code: "custom", path: ["reviews"], message: "必须分别审核第 0、1 题" });
  }
});

const qualityEvidenceSchema = z.object({
  idiomaticPhrase: phraseQuoteSchema,
  sensoryQuote: passageQuoteSchema,
  causalLinks: z.array(z.object({
    causeQuote: passageQuoteSchema,
    effectQuote: passageQuoteSchema,
  })).min(1).max(5),
  clueEvidence: z.array(z.object({
    clueId: z.string().trim().regex(/^C\d+$/),
    action: z.enum(["plant", "use", "payoff"]),
    evidenceQuote: passageQuoteSchema,
  })).min(1).max(8),
  progression: z.object({
    obstacleQuote: passageQuoteSchema,
    choiceQuote: passageQuoteSchema,
    consequenceQuote: passageQuoteSchema,
    newInformationQuote: passageQuoteSchema,
  }),
});

export function normalizeTargetWords(value: unknown) {
  if (!Array.isArray(value)) return value;
  const stopWords = new Set(["a", "an", "the", "to"]);
  const normalized = value.flatMap((item) => {
    const raw = typeof item === "string"
      ? item
      : item && typeof item === "object"
        ? String((item as Record<string, unknown>).word ?? (item as Record<string, unknown>).term ?? "")
        : "";
    if (!raw || /\[a-z\]/i.test(raw)) return [];
    const head = raw
      .replace(/^\s*(?:\d+|[-*])[\s.)、-]*/, "")
      .split(/[:：=\/(（]|(?:\s+[—–-]\s+)/, 1)[0];
    const words = head.match(/[A-Za-z]+(?:['-][A-Za-z]+)*/g) ?? [];
    const meaningful = words.filter((word) => !stopWords.has(word.toLowerCase()));
    const selected = meaningful.at(-1) ?? words.at(-1);
    return selected ? [selected.toLowerCase()] : [];
  });
  return [...new Set(normalized)].slice(0, 10);
}

export function selectNarrativeTargetWords(
  paragraphs: string[], maximum: number, preferred: string[] = [], excluded: string[] = [],
) {
  const stop = new Set(("a an the to of in on at for from with and or but so because is am are was were be been being do does did have has had i you he she it we they me him her us them my your his its our their this that these those who what when where why how not no yes as if then than too very just can could will would should must".split(" ")));
  for (const name of excluded) for (const token of name.toLowerCase().match(/[a-z]+/g) ?? []) stop.add(token);
  const counts = new Map<string, number>();
  for (const token of paragraphs.join(" ").replace(/[’‘]/g, "'").match(/[A-Za-z]+(?:['-][A-Za-z]+)*/g) ?? []) {
    const word = token.toLowerCase();
    if (word.length < 3 || word.includes("'") || stop.has(word)) continue;
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  const ranked = [...counts.keys()].sort((a, b) => counts.get(b)! - counts.get(a)! || a.localeCompare(b));
  return [...new Set([...preferred.map((word) => word.toLowerCase()).filter((word) => counts.has(word)), ...ranked])]
    .slice(0, Math.max(4, Math.min(10, maximum)));
}

export function normalizeContinuitySummary(value: unknown) {
  if (typeof value !== "string") return value;
  const normalized = value.trim();
  if (normalized.length <= 1200) return normalized;
  const limited = normalized.slice(0, 1200);
  const sentenceEnd = Math.max(
    limited.lastIndexOf("。"),
    limited.lastIndexOf("！"),
    limited.lastIndexOf("？"),
    limited.lastIndexOf("；"),
  );
  return sentenceEnd >= 600 ? limited.slice(0, sentenceEnd + 1) : limited;
}

const episodeNarrativeSchema = z.object({
  title: z.string().trim().min(3).max(160),
  // Paragraph count is normalized after generation. Accepting up to 8 makes model
  // output resilient to an accidental extra scene break before the four-card
  // writing contract is enforced.
  paragraphs: z.array(z.string().trim().min(2).max(3000)).min(3).max(8),
});

const fourParagraphNarrativeSchema = z.preprocess(
  (value) => normalizeFourParagraphNarrative(value),
  episodeNarrativeSchema.extend({
    paragraphs: z.array(z.string().trim().min(2).max(3000)).length(4),
  }),
);

const episodeMetadataSchema = z.object({
  targetWords: z.preprocess(
    normalizeTargetWords,
    z.array(z.string().trim().regex(/^[a-z][a-z'-]*$/i)).min(4).max(10),
  ),
  continuitySummary: z.preprocess(
    normalizeContinuitySummary,
    z.string().trim().min(20).max(1200),
  ),
  storyState: z.object({
    characterPositions: z.array(z.string().trim().min(4).max(240)).min(1).max(12),
    knownFacts: z.array(z.string().trim().min(4).max(240)).min(1).max(16),
    unresolvedQuestions: z.array(z.string().trim().min(4).max(240)).min(1).max(12),
    items: z.preprocess(
      (value) => Array.isArray(value)
        ? value.filter((item) => typeof item === "string" && item.trim().length >= 2)
        : value,
      z.array(z.string().trim().min(2).max(200)).max(16),
    ),
    relationshipChanges: z.array(z.string().trim().min(4).max(240)).max(12),
  }),
  qualityEvidence: qualityEvidenceSchema,
});

const episodeContentSchema = episodeNarrativeSchema.extend(episodeMetadataSchema.shape);

function paragraphText(value: unknown): string | null {
  if (typeof value === "string") return value.trim();
  if (!Array.isArray(value)) return null;
  const parts = value.map(paragraphText);
  if (parts.some((part) => part === null)) return null;
  return parts.filter(Boolean).join(" ").trim();
}

function balancedNarrativeParagraphs(paragraphs: string[]) {
  if (paragraphs.length >= 3) return paragraphs;
  const text = paragraphs.join(" ").replace(/\s+/g, " ").trim();
  const words = text.match(/[A-Za-z]+(?:['-][A-Za-z]+)*/g) ?? [];
  const targetCount = Math.max(3, Math.min(5, Math.round(words.length / 70) || 3));
  const sentences = narrativeSentences(text);
  if (sentences.length >= targetCount) {
    const sentenceWordCounts = sentences.map(
      (sentence) => sentence.match(/[A-Za-z]+(?:['-][A-Za-z]+)*/g)?.length ?? 0,
    );
    const totalWords = sentenceWordCounts.reduce((total, count) => total + count, 0);
    const result: string[] = [];
    let sentenceIndex = 0;
    let consumedWords = 0;
    for (let groupIndex = 0; groupIndex < targetCount; groupIndex++) {
      const groupsLeft = targetCount - groupIndex;
      const maxEnd = sentences.length - (groupsLeft - 1);
      const desiredWords = (totalWords - consumedWords) / groupsLeft;
      let end = sentenceIndex + 1;
      let groupWords = sentenceWordCounts[sentenceIndex] ?? 0;
      while (end < maxEnd) {
        const nextWords = sentenceWordCounts[end] ?? 0;
        if (groupWords >= desiredWords * 0.8 && groupWords + nextWords > desiredWords * 1.2) break;
        groupWords += nextWords;
        end++;
      }
      result.push(sentences.slice(sentenceIndex, end).join(" "));
      sentenceIndex = end;
      consumedWords += groupWords;
    }
    return result;
  }

  // 极少数模型会把整篇正文写成一两个超长句。此时按空白词元均分，
  // 仍只改变展示分段，不增删词元；后续质量门禁会检查句子和证据。
  const tokens = text.split(/\s+/).filter(Boolean);
  if (tokens.length < targetCount) return paragraphs;
  const result: string[] = [];
  let offset = 0;
  for (let index = 0; index < targetCount; index++) {
    const groupsLeft = targetCount - index;
    const size = Math.ceil((tokens.length - offset) / groupsLeft);
    result.push(tokens.slice(offset, offset + size).join(" "));
    offset += size;
  }
  return result;
}

export function normalizeEpisodeNarrative(value: unknown, fallbackTitle = "") {
  let candidate = value;
  while (Array.isArray(candidate) && candidate.length === 1) candidate = candidate[0];
  if (!candidate || typeof candidate !== "object") return value;
  const record = candidate as Record<string, unknown>;
  const title = typeof record.title === "string" && record.title.trim()
    ? record.title.trim()
    : fallbackTitle.trim();
  const rawParagraphs = typeof record.paragraphs === "string"
    ? [record.paragraphs]
    : Array.isArray(record.paragraphs)
      ? record.paragraphs
      : null;
  if (!title || !rawParagraphs?.length) return value;
  const paragraphs = rawParagraphs.map(paragraphText);
  if (paragraphs.some((paragraph) => !paragraph)) return value;
  return {
    ...record,
    title,
    paragraphs: balancedNarrativeParagraphs(paragraphs as string[]),
  };
}

export function normalizeFourParagraphNarrative(value: unknown, fallbackTitle = "") {
  const normalized = normalizeEpisodeNarrative(value, fallbackTitle);
  if (!normalized || typeof normalized !== "object") return normalized;
  const record = normalized as Record<string, unknown>;
  if (!Array.isArray(record.paragraphs)) return normalized;
  const paragraphs = record.paragraphs.filter(
    (paragraph): paragraph is string => typeof paragraph === "string" && Boolean(paragraph.trim()),
  );
  if (paragraphs.length === 4) return { ...record, paragraphs };

  const sentences = paragraphs.flatMap((paragraph) => narrativeSentences(paragraph));
  const units = sentences.length >= 4
    ? sentences
    : paragraphs.join(" ").split(/\s+/).filter(Boolean);
  if (units.length < 4) return normalized;

  const weights = units.map(
    (unit) => unit.match(/[A-Za-z]+(?:['-][A-Za-z]+)*/g)?.length ?? 1,
  );
  const totalWeight = weights.reduce((total, count) => total + count, 0);
  const result: string[] = [];
  let unitIndex = 0;
  let consumedWeight = 0;
  for (let paragraphIndex = 0; paragraphIndex < 4; paragraphIndex++) {
    const paragraphsLeft = 4 - paragraphIndex;
    const maxEnd = units.length - (paragraphsLeft - 1);
    const targetWeight = (totalWeight - consumedWeight) / paragraphsLeft;
    let end = unitIndex + 1;
    let paragraphWeight = weights[unitIndex] ?? 0;
    while (end < maxEnd) {
      const nextWeight = weights[end] ?? 0;
      if (
        paragraphWeight >= targetWeight * 0.8
        && paragraphWeight + nextWeight > targetWeight * 1.2
      ) break;
      paragraphWeight += nextWeight;
      end += 1;
    }
    result.push(units.slice(unitIndex, end).join(" "));
    unitIndex = end;
    consumedWeight += paragraphWeight;
  }

  return { ...record, paragraphs: result };
}

export function mergeEpisodeStructure(narrative: unknown, metadata: unknown) {
  const parsedNarrative = episodeNarrativeSchema.safeParse(normalizeEpisodeNarrative(narrative));
  const parsedMetadata = episodeMetadataSchema.safeParse(metadata);
  if (!parsedNarrative.success || !parsedMetadata.success) return null;
  return episodeContentSchema.parse({ ...parsedNarrative.data, ...parsedMetadata.data });
}

const episodeSchema = episodeContentSchema.extend({
  questions: z.array(questionSchema).min(2).max(3),
});

const groundedQuestionSetSchema = z.object({
  questions: z.array(questionSchema).min(2).max(3),
});

const critiqueDimensionSchema = z.object({
  score: z.number().min(0).max(10),
  issues: z.array(z.string()).transform((items) => items.slice(0, 8)),
});

const storyCritiqueObjectSchema = z.object({
  plot: critiqueDimensionSchema,
  childAppeal: critiqueDimensionSchema,
  gradedLanguage: critiqueDimensionSchema,
  continuity: critiqueDimensionSchema,
  rewritePriorities: z.array(z.string().trim().min(4).max(300))
    .min(1)
    .transform((items) => items.slice(0, 8)),
});

const critiqueArtifactDimensions = ["plot", "childAppeal", "gradedLanguage", "continuity"] as const;

export function normalizeStoryCritique(value: unknown) {
  let candidate = value;
  while (Array.isArray(candidate) && candidate.length === 1) candidate = candidate[0];
  if (!Array.isArray(candidate)) return candidate;

  const merged: Record<string, unknown> = {};
  for (const item of candidate) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const namedDimension = typeof record.dimension === "string"
      && critiqueArtifactDimensions.includes(record.dimension as (typeof critiqueArtifactDimensions)[number])
      ? record.dimension
      : typeof record.name === "string"
        && critiqueArtifactDimensions.includes(record.name as (typeof critiqueArtifactDimensions)[number])
        ? record.name
        : null;
    if (namedDimension && "score" in record && "issues" in record) {
      merged[namedDimension] = { score: record.score, issues: record.issues };
    }
    for (const key of [...critiqueArtifactDimensions, "rewritePriorities"] as const) {
      if (key in record) merged[key] = record[key];
    }
  }
  const hasAllDimensions = critiqueArtifactDimensions.every((dimension) => dimension in merged);
  if (!hasAllDimensions) return candidate;
  if (!("rewritePriorities" in merged)) {
    const priorities = critiqueArtifactDimensions.flatMap((dimension) => {
      const result = merged[dimension];
      if (!result || typeof result !== "object" || Array.isArray(result)) return [];
      const issues = (result as Record<string, unknown>).issues;
      return Array.isArray(issues) ? issues.filter((issue): issue is string => typeof issue === "string") : [];
    });
    merged.rewritePriorities = priorities.length
      ? [...new Set(priorities)].slice(0, 8)
      : ["保持当前结构和语言质量"];
  }
  return merged;
}

const storyCritiqueSchema = z.preprocess(normalizeStoryCritique, storyCritiqueObjectSchema);

export function continuityEvidenceProblems(
  issues: readonly string[],
  previousParagraphs: readonly string[],
  currentParagraphs: readonly string[],
) {
  const previousText = previousParagraphs.join("\n");
  const currentText = currentParagraphs.join("\n");
  return issues.flatMap((issue, index) => {
    const citation = issue.match(/^【(前文|当前)证据：([^】]{4,})】/u);
    if (!citation) return [`continuity.issues.${index}: 必须以逐字证据标记开头`];
    const [, source, quote] = citation;
    if (/(?:上一集|前文|已发布)/u.test(issue) && source !== "前文") {
      return [`continuity.issues.${index}: 涉及上一集的判断必须引用前文`];
    }
    const sourceText = source === "前文" ? previousText : currentText;
    return sourceText.includes(quote)
      ? []
      : [`continuity.issues.${index}: 引文不在${source}正文中`];
  });
}

function groundedContinuityDimension(
  review: z.infer<typeof critiqueDimensionSchema>,
  previousParagraphs: readonly string[],
  currentParagraphs: readonly string[],
) {
  const issues = review.issues.filter((issue) =>
    continuityEvidenceProblems([issue], previousParagraphs, currentParagraphs).length === 0);
  return { ...review, score: issues.length ? review.score : Math.max(8, review.score), issues };
}

export function groundStoryCritiqueEvidence(
  review: z.infer<typeof storyCritiqueSchema>,
  previousParagraphs: readonly string[],
  currentParagraphs: readonly string[],
) {
  const continuity = groundedContinuityDimension(review.continuity, previousParagraphs, currentParagraphs);
  const rewritePriorities = [
    ...review.plot.issues,
    ...review.childAppeal.issues,
    ...review.gradedLanguage.issues,
    ...continuity.issues,
  ].slice(0, 8);
  return {
    ...review,
    continuity,
    rewritePriorities: rewritePriorities.length ? rewritePriorities : ["保持当前结构和语言质量"],
  };
}

function groundedStoryCritiqueSchema(
  previousParagraphs: readonly string[],
  currentParagraphs: readonly string[],
) {
  return storyCritiqueSchema.transform((review) =>
    groundStoryCritiqueEvidence(review, previousParagraphs, currentParagraphs));
}

function groundedContinuityDimensionSchema(
  previousParagraphs: readonly string[],
  currentParagraphs: readonly string[],
) {
  return critiqueDimensionSchema.transform((review) =>
    groundedContinuityDimension(review, previousParagraphs, currentParagraphs));
}

export function normalizePlanningArtifact(value: unknown) {
  let candidate = value;
  while (Array.isArray(candidate) && candidate.length === 1) candidate = candidate[0];
  if (Array.isArray(candidate)) return { sections: candidate };
  return candidate;
}

// Planning artifacts are transient model-to-model context, not persisted
// business data. Accept richer field layouts instead of wasting a request on
// renaming keys; strict schemas remain on the final narrative and critique.
const planningArtifactSchema = z.preprocess(
  normalizePlanningArtifact,
  z.record(z.string(), z.unknown()).refine(
    (value) => Object.keys(value).length >= 2,
    "策划对象至少需要两个有效部分",
  ),
);

const semanticRewritePlanSchema = planningArtifactSchema;
const draftSynthesisPlanSchema = planningArtifactSchema;

const candidateCritiqueSchema = storyCritiqueObjectSchema.extend({
  candidateIndex: z.preprocess(
    (value) => typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value,
    z.number().int().min(0).max(4),
  ),
});

export function normalizeCandidateCritiqueBatch(value: unknown) {
  let candidate = value;
  while (Array.isArray(candidate) && candidate.length === 1) candidate = candidate[0];
  if (Array.isArray(candidate)) return { reviews: candidate };
  if (!candidate || typeof candidate !== "object") return value;
  const record = candidate as Record<string, unknown>;
  if (Array.isArray(record.reviews)) return { reviews: record.reviews };
  if (record.reviews && typeof record.reviews === "object") return { reviews: [record.reviews] };
  for (const key of ["data", "result", "candidates", "items"]) {
    const nested = record[key];
    if (Array.isArray(nested)) return { reviews: nested };
  }
  if ("candidateIndex" in record) return { reviews: [record] };
  const keyedReviews = Object.entries(record)
    .filter(([key, nested]) => /^\d+$/.test(key) && nested && typeof nested === "object")
    .map(([key, nested]) => ({ candidateIndex: Number(key), ...(nested as Record<string, unknown>) }));
  return keyedReviews.length ? { reviews: keyedReviews } : value;
}

const candidateCritiqueBatchSchema = z.preprocess(
  normalizeCandidateCritiqueBatch,
  z.object({ reviews: z.array(candidateCritiqueSchema).min(1).max(5) }),
);

function groundedCandidateCritiqueBatchSchema(
  previousParagraphs: readonly string[],
  candidates: Array<Pick<GeneratedStoryContent, "paragraphs">>,
) {
  return candidateCritiqueBatchSchema.transform((batch) => ({
    reviews: batch.reviews.map((review) => {
      const candidate = candidates[review.candidateIndex];
      return candidate
        ? { ...review, ...groundStoryCritiqueEvidence(review, previousParagraphs, candidate.paragraphs) }
        : review;
    }),
  }));
}

export type SeriesPlan = z.infer<typeof planSchema>;
export type GeneratedStoryContent = z.infer<typeof episodeContentSchema>;
export type GeneratedStoryEpisode = z.infer<typeof episodeSchema>;
export type StoryCritique = z.infer<typeof storyCritiqueSchema>;

export type StoryGenerationProgressStage =
  | "queued"
  | "planning"
  | "selecting_plan"
  | "drafting"
  | "reviewing"
  | "editing"
  | "quality_check"
  | "repairing"
  | "saving"
  | "completed"
  | "failed";

export type StoryGenerationProgress = {
  stage: StoryGenerationProgressStage;
  message: string;
  percent: number;
};

export type StoryEpisodeImported = {
  articleId: string;
  episodeNumber: number;
  totalEpisodes: number;
  seriesTitle: string;
};

export type StoryRunOptions = {
  planningHistory?: PlanningHistory;
  onPlanningHistory?: (history: PlanningHistory) => void;
  planningContext?: string;
  onLexicalBatchFailure?: (episode: number, words: string[]) => void;
  /** Per-run, read-only published prose supplied to serial checks. Never user instructions. */
  publishedStoryContext?: PublishedNarrative[];
  databasePath: string;
  ecdictPath: string;
  baseUrl: string;
  apiPath: string;
  apiKey: string;
  model: string;
  reviewModel: string;
  structureRepairModel: string;
  interest: StoryInterestId;
  customInterestName: string;
  customInterestSubtitle: string;
  customInterestEmoji: string;
  customInterestColor: string;
  customInterestPrompt: string;
  customActivityPrompt: string;
  examId: ExamId;
  sourceMode: StorySourceMode;
  classicId: ClassicSourceId | "";
  sourceTitle: string;
  sourceNotes: string;
  readerStage: ReaderStageId;
  episodes: number;
  importNamespace: string;
  planCandidates: number;
  episodeCandidates: number;
  minLexicalCoverage: number;
  temperature: number;
  reviewTemperature: number;
  timeoutMs: number;
  rewriteTimeoutMs: number;
  networkRetries: number;
  structureRetries: number;
  dryRun: boolean;
  force: boolean;
  log: (message: string) => void;
  onProgress?: (progress: StoryGenerationProgress) => void;
  checkpoint?: StoryGenerationCheckpointInput | null;
  onCheckpoint?: (checkpoint: StoryGenerationCheckpoint) => void;
  onEpisodeImported?: (episode: StoryEpisodeImported) => void;
};

export type StoryQuality = {
  score: number;
  wordCount: number;
  averageSentenceWords: number;
  lexicalCoverage: number | null;
  unfamiliarWords: string[];
  issues: string[];
  blockingIssues: string[];
  issueDetails?: StoryIssue[];
  blockingIssueDetails?: StoryIssue[];
};

export async function runOptionalStage<T>(
  fallback: T,
  operation: () => Promise<T>,
  onFailure: (error: unknown) => void,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    onFailure(error);
    return fallback;
  }
}

const activeEpisodeStages = [
  "draft_selected",
  "edited",
  "mechanical_repaired",
  "semantic_reviewed",
  "semantic_rewritten",
] as const;

const currentReviewCalibrationVersion = "independent-single-final-v4-calibrated-7-7.5";
const currentStoryContractVersion = "feasible-serial-contract-v13";

const storyQualityCheckpointSchema = z.object({
  score: z.number().min(0).max(100),
  wordCount: z.number().int().nonnegative(),
  averageSentenceWords: z.number().nonnegative(),
  lexicalCoverage: z.number().min(0).max(1).nullable(),
  unfamiliarWords: z.array(z.string()),
  issues: z.array(z.string()),
  blockingIssues: z.array(z.string()).default([]),
  issueDetails: z.array(storyIssueSchema).optional(),
  blockingIssueDetails: z.array(storyIssueSchema).optional(),
});

const completedEpisodeCheckpointSchema = z.object({
  episode: episodeSchema,
  quality: storyQualityCheckpointSchema,
  semanticReview: storyCritiqueSchema.optional(),
});

const stagedEpisodeCountersSchema = z.object({
  fullRewriteCount: z.number().int().min(0).max(4),
  mechanicalRepairUsed: z.boolean(),
  semanticRewriteUsed: z.boolean(),
  lexicalRepairExhausted: z.boolean().optional(),
  localRepairAttempts: localRepairAttemptsSchema.optional(),
});

const stagedEpisodeCheckpointSchema = z.discriminatedUnion("stage", [
  stagedEpisodeCountersSchema.extend({
    index: z.number().int().min(0).max(29),
    stage: z.literal("metadata_pending"),
    narrative: episodeNarrativeSchema,
    critique: storyCritiqueSchema,
    semanticReview: storyCritiqueSchema.optional(),
    textHash: z.string().regex(/^[a-f0-9]{64}$/),
    source: z.enum(["selected", "optional_optimization", "required_repair"]),
  }),
  stagedEpisodeCountersSchema.extend({
    index: z.number().int().min(0).max(29),
    stage: z.literal("questions_pending"),
    episode: episodeContentSchema,
    quality: storyQualityCheckpointSchema,
    critique: storyCritiqueSchema.optional(),
    semanticReview: storyCritiqueSchema,
    textHash: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  stagedEpisodeCountersSchema.extend({
    index: z.number().int().min(0).max(29),
    stage: z.literal("ready_to_publish"),
    episode: episodeSchema,
    quality: storyQualityCheckpointSchema,
    semanticReview: storyCritiqueSchema,
    textHash: z.string().regex(/^[a-f0-9]{64}$/),
  }),
]);

const legacyStoryGenerationCheckpointSchema = z.object({
  version: z.literal(1),
  plan: planSchema,
  episodes: z.array(completedEpisodeCheckpointSchema).max(30),
});

const currentStoryGenerationCheckpointSchema = z.object({
  version: z.literal(2),
  plan: planSchema,
  episodes: z.array(completedEpisodeCheckpointSchema).max(30),
  reviewCalibrationVersion: z.string().trim().min(1).max(80).optional(),
  storyContractVersion: z.string().trim().min(1).max(80).optional(),
  replannedEpisodes: z.array(z.number().int().min(1).max(30)).max(30).optional(),
  lexicalFailureBatches: z.array(lexicalFailureBatchSchema).max(12).optional(),
  lexicalPlanRevisions: z.array(z.number().int().min(1).max(30)).max(30).optional(),
  discardedDraftLessons: z.array(z.string().trim().min(4).max(500)).max(20).optional(),
  rejectedElite: z.object({
    index: z.number().int().min(0).max(29),
    narrative: episodeNarrativeSchema,
    critique: storyCritiqueSchema,
  }).optional(),
  stagedEpisode: stagedEpisodeCheckpointSchema.optional(),
  activeEpisode: z.object({
    index: z.number().int().min(0).max(29),
    stage: z.enum(activeEpisodeStages),
    episode: episodeContentSchema,
    quality: storyQualityCheckpointSchema.optional(),
    critique: storyCritiqueSchema.optional(),
    semanticReview: storyCritiqueSchema.optional(),
    fullRewriteCount: z.number().int().min(0).max(4),
    mechanicalRepairUsed: z.boolean(),
    semanticRewriteUsed: z.boolean(),
    lexicalRepairExhausted: z.boolean().optional(),
    localRepairAttempts: localRepairAttemptsSchema.optional(),
  }).optional(),
});

export const storyGenerationCheckpointSchema = z.union([
  currentStoryGenerationCheckpointSchema,
  legacyStoryGenerationCheckpointSchema,
]);

export type StoryGenerationCheckpointInput = z.infer<typeof storyGenerationCheckpointSchema>;
export type StoryGenerationCheckpoint = z.infer<typeof currentStoryGenerationCheckpointSchema>;
export type ActiveEpisodeCheckpoint = NonNullable<StoryGenerationCheckpoint["activeEpisode"]>;
export type StagedEpisodeCheckpoint = NonNullable<StoryGenerationCheckpoint["stagedEpisode"]>;
type RejectedElite = NonNullable<StoryGenerationCheckpoint["rejectedElite"]>;

export function episodeNarrativeHash(narrative: Pick<GeneratedStoryContent, "title" | "paragraphs">) {
  return createHash("sha256").update(JSON.stringify({
    title: narrative.title,
    paragraphs: narrative.paragraphs,
  })).digest("hex");
}

export function buildDiscardedDraftLessons(
  active: ActiveEpisodeCheckpoint,
  quality: StoryQuality,
  previous: string[] = [],
) {
  const dimensionLabels: Record<(typeof critiqueDimensions)[number], string> = {
    plot: "剧情逻辑",
    childAppeal: "儿童吸引力",
    gradedLanguage: "分级英语",
    continuity: "连续性",
  };
  const review = active.semanticReview ?? active.critique;
  const currentLessons = [
    ...(review
      ? critiqueDimensions.flatMap((dimension) => {
          const result = review[dimension];
          if (result.score >= 8 && !result.issues.length) return [];
          const issues = result.issues.slice(0, 3).join("；") || "未达到发布标准";
          return [`${dimensionLabels[dimension]} ${result.score.toFixed(1)} 分：${issues}`];
        })
      : []),
    ...(review?.rewritePriorities.slice(0, 6).map((priority) => `优先改进：${priority}`) ?? []),
    ...quality.blockingIssues.slice(0, 6).map((issue) => `自动门禁：${issue}`),
  ];
  return [...new Set([...previous, ...currentLessons].map((lesson) => lesson.trim()).filter(Boolean))]
    .slice(-20)
    .map((lesson) => lesson.slice(0, 500));
}

export function selectDraftLessonsForPrompt(lessons: string[], maximum = 6) {
  const categoryCounts = new Map<string, number>();
  const selected: string[] = [];
  for (const lesson of [...lessons].reverse()) {
    const category = ["剧情逻辑", "儿童吸引力", "分级英语", "连续性", "优先改进", "自动门禁"]
      .find((prefix) => lesson.startsWith(prefix))
      ?? lesson.match(/^([^：:]{2,12})[：:]/)?.[1]
      ?? "其他";
    const categoryLimit = 1;
    const count = categoryCounts.get(category) ?? 0;
    if (count >= categoryLimit) continue;
    const compact = lesson
      .replace(/\s+/g, " ")
      .split(/；(?=.{80,})/, 1)[0]
      .trim()
      .slice(0, 160);
    if (!compact) continue;
    selected.push(compact);
    categoryCounts.set(category, count + 1);
    if (selected.length >= maximum) break;
  }
  return selected.reverse();
}

export function parseStoryGenerationCheckpoint(value: unknown): StoryGenerationCheckpoint | null {
  const current = currentStoryGenerationCheckpointSchema.safeParse(value);
  if (current.success) return current.data;
  const legacy = legacyStoryGenerationCheckpointSchema.safeParse(value);
  return legacy.success
    ? { version: 2 as const, plan: legacy.data.plan, episodes: legacy.data.episodes }
    : null;
}

export type LexicalRankLookup = (word: string) => number | null;
export type LexicalFamiliarityLookup = (word: string) => boolean;

function reportProgress(
  options: StoryRunOptions,
  stage: StoryGenerationProgressStage,
  message: string,
  percent: number,
) {
  options.onProgress?.({
    stage,
    message,
    percent: Math.max(0, Math.min(100, Math.round(percent))),
  });
}

function episodeProgress(options: StoryRunOptions, index: number, fraction: number) {
  return 20 + ((index + fraction) / options.episodes) * 74;
}

const examGuide: Record<
  ExamId,
  {
    audience: string;
    firstWords: [number, number];
    laterWords: [number, number];
    publishMax: number;
    maxSentenceWords: number;
    difficulty: number;
  }
> = {
  middle: { audience: "初中生", firstWords: [180, 280], laterWords: [220, 310], publishMax: 310, maxSentenceWords: 15, difficulty: 2 },
  high: { audience: "高中生", firstWords: [220, 280], laterWords: [260, 320], publishMax: 320, maxSentenceWords: 20, difficulty: 3 },
  toefl: { audience: "托福学习者", firstWords: [450, 600], laterWords: [600, 800], publishMax: 800, maxSentenceWords: 24, difficulty: 4 },
  ielts: { audience: "雅思学习者", firstWords: [400, 520], laterWords: [520, 700], publishMax: 700, maxSentenceWords: 23, difficulty: 4 },
  toeic: { audience: "托业学习者", firstWords: [200, 250], laterWords: [240, 300], publishMax: 300, maxSentenceWords: 19, difficulty: 3 },
};

export function storyWordLimits(
  options: Pick<StoryRunOptions, "examId"> & Partial<Pick<StoryRunOptions, "readerStage">>,
  episodeNumber: number,
) {
  const level = examGuide[options.examId];
  const starterMiddle = options.examId === "middle" && options.readerStage === "starter";
  const targetRange: [number, number] = starterMiddle
    ? (episodeNumber === 1 ? [180, 240] : [200, 260])
    : (episodeNumber === 1 ? level.firstWords : level.laterWords);
  // Later middle-school episodes still aim for 220+ words, but a coherent
  // 180-219 word chapter should reach semantic review instead of being thrown
  // away over a tiny mechanical shortfall. The upper publication cap remains
  // strict because overlong text directly changes the reading load.
  const publishMinimum = options.examId === "middle"
    ? level.firstWords[0]
    : targetRange[0];
  return {
    targetRange,
    publishRange: [publishMinimum, Math.max(targetRange[1], level.publishMax)] as [number, number],
  };
}

const automaticReaderStages: Record<ExamId, ResolvedReaderStageId> = {
  middle: "stage1",
  high: "stage3",
  toefl: "stage4",
  ielts: "stage4",
  toeic: "stage3",
};

export function resolveReaderProfile(options: Pick<StoryRunOptions, "examId" | "readerStage">) {
  const id = options.readerStage === "auto" ? automaticReaderStages[options.examId] : options.readerStage;
  return { id, ...readerStages[id] };
}

export function storyPlanCapacity(
  options: Pick<StoryRunOptions, "examId" | "readerStage" | "episodes">,
) {
  const stage = resolveReaderProfile(options).id;
  const byStage: Record<ResolvedReaderStageId, { maximumMainCharacters: number; maximumSeasonClues: number; maximumWorldRules: number; maximumNewFactsPerEpisode: number }> = {
    starter: { maximumMainCharacters: 3, maximumSeasonClues: 3, maximumWorldRules: 5, maximumNewFactsPerEpisode: 2 },
    stage1: { maximumMainCharacters: 4, maximumSeasonClues: 4, maximumWorldRules: 6, maximumNewFactsPerEpisode: 2 },
    stage2: { maximumMainCharacters: 4, maximumSeasonClues: 5, maximumWorldRules: 7, maximumNewFactsPerEpisode: 3 },
    stage3: { maximumMainCharacters: 5, maximumSeasonClues: 6, maximumWorldRules: 8, maximumNewFactsPerEpisode: 3 },
    stage4: { maximumMainCharacters: 5, maximumSeasonClues: 7, maximumWorldRules: 8, maximumNewFactsPerEpisode: 3 },
    stage5: { maximumMainCharacters: 5, maximumSeasonClues: 7, maximumWorldRules: 8, maximumNewFactsPerEpisode: 3 },
    stage6: { maximumMainCharacters: 5, maximumSeasonClues: 7, maximumWorldRules: 8, maximumNewFactsPerEpisode: 3 },
  };
  const capacity = byStage[stage];
  return {
    maximumMainCharacters: capacity.maximumMainCharacters,
    maximumSeasonClues: Math.min(capacity.maximumSeasonClues, Math.max(2, options.episodes)),
    maximumWorldRules: capacity.maximumWorldRules,
    maximumNewFactsPerEpisode: capacity.maximumNewFactsPerEpisode,
  };
}

export async function repairObjectFields(
  schema: z.ZodObject,
  value: unknown,
  repair: (fieldSchema: z.ZodType, value: unknown, path: string[]) => Promise<unknown>,
  path: string[] = [],
): Promise<Record<string, unknown>> {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
  const entries = await Promise.all(Object.entries(schema.shape).map(async ([key, field]) => {
    const fieldSchema = field as z.ZodType;
    const parsed = fieldSchema.safeParse(record[key]);
    if (parsed.success) return [key, parsed.data] as const;
    const fieldPath = [...path, key];
    const recovered = fieldSchema instanceof z.ZodObject && record[key] && typeof record[key] === "object"
      ? await repairObjectFields(fieldSchema, record[key], repair, fieldPath)
      : await repair(fieldSchema, record[key], fieldPath);
    return [key, fieldSchema.parse(recovered)] as const;
  }));
  return Object.fromEntries(entries);
}

export function relevantEvidenceCandidates(
  candidates: ReturnType<typeof evidenceCandidates>,
  semanticHint: string,
  maximum = 48,
) {
  const hintWords = new Set((semanticHint.toLowerCase().match(/[a-z]+/g) ?? []).filter((word) => word.length > 2));
  const normalizedHint = normalizedEvidence(semanticHint);
  return candidates
    .map((candidate, sourceOrder) => {
      const candidateWords = new Set((candidate.quote.toLowerCase().match(/[a-z]+/g) ?? []).filter((word) => word.length > 2));
      const overlap = [...hintWords].filter((word) => candidateWords.has(word)).length;
      const exact = normalizedEvidence(candidate.quote) === normalizedHint ? 1 : 0;
      return { candidate, sourceOrder, score: exact * 10_000 + overlap * 100 - candidateWords.size };
    })
    .sort((left, right) => right.score - left.score || left.sourceOrder - right.sourceOrder)
    .slice(0, maximum)
    .map(({ candidate }, id) => ({ ...candidate, id }));
}

async function completeEpisodeMetadata(
  options: StoryRunOptions,
  plan: SeriesPlan,
  episodeNumber: number,
  previousEpisode: GeneratedStoryEpisode | null,
  narrative: z.infer<typeof episodeNarrativeSchema>,
) {
  const readerProfile = resolveReaderProfile(options);
  const contract = buildEpisodeWritingContract(options, plan, episodeNumber);
  const requiredClueActions = contract.requiredClueActions;
  const metadataModelSchema = episodeMetadataSchema.omit({ targetWords: true });
  const targetWords = selectNarrativeTargetWords(narrative.paragraphs, readerProfile.maxNewWords,
    draftVocabulary(options, plan, narrative).unfamiliarWords, plan.cast.map((character) => character.name));
  if (targetWords.length < 4) throw new Error("正文缺少至少四个可选学习词，请检查正文内容；不调用模型反复补词");
  const metadataFields = await callStructured(
    options,
    metadataModelSchema,
    "你只输出合法 JSON。你是故事数据整理编辑，只为已经定稿的英文正文补齐结构化元数据，绝不改写或重复正文。",
    `本集写作合同：${JSON.stringify(contract)}\n`
      + `本集必须且只能返回的线索动作：${JSON.stringify(requiredClueActions)}\n`
      + `上一集状态：${previousEpisode ? JSON.stringify(previousEpisode.storyState) : "第一集"}\n`
      + `已定稿标题与正文：${JSON.stringify(narrative)}\n\n`
      + "只根据这份最终正文生成 continuitySummary、storyState、qualityEvidence。"
      + `targetWords 已由程序从正文选定为 ${JSON.stringify(targetWords)}，不要生成或修改此字段；continuitySummary 用 80-300 个中文字符记录结尾状态、关键发现和未解问题；`
      + "storyState 使用中文字符串数组；qualityEvidence 的所有英文 quote 必须逐字存在于 paragraphs，因果和 progression 顺序必须与正文一致；"
      + "progression 四个 quote 必须互不相同并按 obstacle、choice、consequence、newInformation 的正文顺序出现；"
      + "clueEvidence 必须逐项且只覆盖上面列出的线索动作，不得改变 action、漏项或增加其他动作。本次禁止返回 title、paragraphs、questions。\n\n"
      + "只返回：{\"continuitySummary\":\"中文\",\"storyState\":{\"characterPositions\":[\"中文\"],\"knownFacts\":[\"中文\"],\"unresolvedQuestions\":[\"中文\"],\"items\":[\"中文\"],\"relationshipChanges\":[\"中文\"]},\"qualityEvidence\":{\"idiomaticPhrase\":\"exact quote\",\"sensoryQuote\":\"exact quote\",\"causalLinks\":[{\"causeQuote\":\"exact earlier quote\",\"effectQuote\":\"exact later quote\"}],\"clueEvidence\":[{\"clueId\":\"C1\",\"action\":\"plant\",\"evidenceQuote\":\"exact quote\"}],\"progression\":{\"obstacleQuote\":\"exact quote\",\"choiceQuote\":\"exact quote\",\"consequenceQuote\":\"exact quote\",\"newInformationQuote\":\"exact quote\"}}}",
    options.structureRepairModel || options.reviewModel || options.model,
    Math.min(options.reviewTemperature, 0.15),
    {
      timeoutMs: options.timeoutMs,
      networkRetries: options.networkRetries,
      structureRetries: options.structureRetries,
      maxCompletionTokens: 4096,
      disableThinking: true,
      recoverPartial: async (value) => repairObjectFields(metadataModelSchema, value, async (fieldSchema, current, fieldPath) => {
        const key = fieldPath.at(-1)!;
        const wrapper = z.object({ [key]: fieldSchema });
        const result = await callStructured(
          options, wrapper,
          "你只补齐一个元数据字段，输出合法 JSON，所有英文证据必须逐字来自已定稿正文。",
          `字段路径：${fieldPath.join(".")}；当前值：${JSON.stringify(current)}\n正文：${JSON.stringify(narrative)}\n必须返回的线索动作：${JSON.stringify(requiredClueActions)}\n上一集状态：${JSON.stringify(previousEpisode?.storyState ?? {})}\n仅返回 {"${key}": 对应字段值}。storyState 使用中文字符串数组；progression 包含 obstacleQuote、choiceQuote、consequenceQuote、newInformationQuote 四个正文原文引用；causalLinks 包含 causeQuote/effectQuote；clueEvidence 包含 clueId/action/evidenceQuote。不得输出正文或其他根字段。`,
          options.structureRepairModel || options.reviewModel || options.model,
          Math.min(options.reviewTemperature, 0.15),
          { timeoutMs: options.timeoutMs, networkRetries: 1, structureRetries: 2, maxCompletionTokens: 2048, disableThinking: true },
        );
        options.log(`[${episodeNumber}/${options.episodes}] 已单独恢复元数据 ${fieldPath.join(".")}，保留其他有效字段和正文。`);
        return result[key];
      }),
    },
  );
  const metadata = { ...metadataFields, targetWords };
  options.log(`[${episodeNumber}/${options.episodes}] 已从正文确定 ${targetWords.length} 个学习词，不消耗模型字段纠错重试。`);
  // Free-form metadata describes the intended meaning, but it never becomes
  // source evidence directly. Every final quote is selected by ID from spans
  // extracted locally from the immutable narrative.
  const evidenceFields: Array<{ path: string[]; quote: string }> = [];
  const visit = (value: unknown, path: string[]) => {
    if (typeof value === "string") {
      evidenceFields.push({ path, quote: value });
    } else if (Array.isArray(value)) {
      value.forEach((entry, index) => visit(entry, [...path, String(index)]));
    } else if (value && typeof value === "object") {
      for (const [key, entry] of Object.entries(value)) {
        if (key !== "clueId" && key !== "action") visit(entry, [...path, key]);
      }
    }
  };
  visit(metadata.qualityEvidence, []);
  if (evidenceFields.length) {
    const catalogs = {
      phrase: evidenceCandidates(narrative.paragraphs, true),
      passage: evidenceCandidates(narrative.paragraphs, false),
    };
    const choices = evidenceFields.map((item) => relevantEvidenceCandidates(
      item.path[0] === "idiomaticPhrase" ? catalogs.phrase : catalogs.passage,
      item.quote,
    ));
    const replacementsSchema = evidenceSelectionSchema(choices);
    const fixed = await callStructured(options, replacementsSchema,
      "你是证据核对员，只选择程序提供的原文候选编号，不输出或改写引用文字。",
      `正文：${JSON.stringify(narrative.paragraphs)}\n证据语境：${JSON.stringify(metadata.qualityEvidence)}\n线索合同：${JSON.stringify(continuityUsageContract(plan, episodeNumber))}\n待选择字段：${JSON.stringify(evidenceFields.map((item, index) => ({ index, field: item.path.join("."), semanticIntent: item.quote, candidates: choices[index] })))}\n每个字段只能从其 candidates 选择真正支持其含义的最短充分片段；不能仅因字面相似就选择。因果和推进引用须保持正文顺序。没有合适证据则 candidateId=null，不得编造或强选。只返回 {"replacements":[{"index":0,"candidateId":0}]}。`,
      options.structureRepairModel || options.reviewModel || options.model, 0,
      { timeoutMs: options.timeoutMs, networkRetries: 1, structureRetries: 2, maxCompletionTokens: 2048, disableThinking: true });
    for (const item of fixed.replacements) {
      if (item.candidateId === null) throw new StoryGenerationFailure("正文引用候选中没有足够的语义证据，保留正文等待元数据修复", "METADATA_EVIDENCE_GATE", "metadata", "same_text");
      const path = evidenceFields[item.index].path;
      let parent: any = metadata.qualityEvidence;
      for (const key of path.slice(0, -1)) parent = parent[key];
      parent[path.at(-1)!] = choices[item.index].find((candidate) => candidate.id === item.candidateId)!.quote;
    }
    options.log(`[${episodeNumber}/${options.episodes}] 已按原文候选编号落定 ${evidenceFields.length} 项证据；原文存在性、长度和编号均由程序校验。`);
  }
  return { ...metadata, qualityEvidence: qualityEvidenceSchema.parse(metadata.qualityEvidence) };
}

async function callEpisodeContent(
  options: StoryRunOptions,
  plan: SeriesPlan,
  episodeNumber: number,
  previousEpisode: GeneratedStoryEpisode | null,
  system: string,
  user: string,
  model = options.model,
  temperature = options.temperature,
  policy: ModelCallPolicy = {},
) {
  return callStructured(
    options,
    episodeContentSchema,
    system,
    user,
    model,
    temperature,
    {
      ...policy,
      recoverPartial: async (value, issues) => {
        const normalizedNarrative = normalizeEpisodeNarrative(value);
        const narrative = episodeNarrativeSchema.safeParse(normalizedNarrative);
        if (!narrative.success) return null;
        const originalParagraphCount = value && typeof value === "object"
          && Array.isArray((value as Record<string, unknown>).paragraphs)
          ? ((value as Record<string, unknown>).paragraphs as unknown[]).length
          : null;
        if (originalParagraphCount !== null && originalParagraphCount < 3) {
          options.log(
            `[${episodeNumber}/${options.episodes}] 模型正文只有 ${originalParagraphCount} 段，`
            + `已按完整句子和词数在本地均衡拆分为 ${narrative.data.paragraphs.length} 段。`,
          );
        }
        options.log(
          `[${episodeNumber}/${options.episodes}] 模型已返回完整 title/paragraphs，但附属字段不完整（${issues}）；`
          + "保留正文，正在单独补齐连续性状态、目标词和质量证据…",
        );
        const metadata = await completeEpisodeMetadata(
          options,
          plan,
          episodeNumber,
          previousEpisode,
          narrative.data,
        );
        const merged = mergeEpisodeStructure(narrative.data, metadata);
        if (merged) {
          options.log(`[${episodeNumber}/${options.episodes}] 已保留模型正文并完成缺失附属字段补齐。`);
        }
        return merged;
      },
    },
  );
}

async function callEpisodeNarrative(
  options: StoryRunOptions,
  system: string,
  user: string,
  model = options.model,
  temperature = options.temperature,
  policy: ModelCallPolicy = {},
) {
  return callStructured(
    options,
    z.preprocess((value) => normalizeEpisodeNarrative(value), episodeNarrativeSchema),
    system,
    user,
    model,
    temperature,
    policy,
  );
}

export function draftSentenceBudgetIssues(
  contract: EpisodeWritingContract,
  narrative: Pick<GeneratedStoryContent, "paragraphs">,
) {
  const issues: string[] = [];
  for (const [index, card] of contract.paragraphCards.entries()) {
    const sentences = narrativeSentences(narrative.paragraphs[index] ?? "");
    if (Math.abs(sentences.length - card.targetSentences) > 1) {
      issues.push(`第 ${index + 1} 段句子数 ${sentences.length}，目标 ${card.targetSentences}`);
    }
    const longest = Math.max(
      0,
      ...sentences.map((sentence) => sentence.match(/[A-Za-z]+(?:['-][A-Za-z]+)*/g)?.length ?? 0),
    );
    if (longest > card.maxWordsPerSentence + 2) {
      issues.push(`第 ${index + 1} 段最长句 ${longest} 词，预算 ${card.maxWordsPerSentence}`);
    }
  }
  return issues;
}

export function draftSevereSentenceBudgetIssues(
  contract: EpisodeWritingContract,
  narrative: Pick<GeneratedStoryContent, "paragraphs">,
) {
  const issues: string[] = [];
  for (const [index, card] of contract.paragraphCards.entries()) {
    const sentences = narrativeSentences(narrative.paragraphs[index] ?? "");
    if (Math.abs(sentences.length - card.targetSentences) > 5
      && sentences.filter((sentence) => (sentence.match(/[A-Za-z]+(?:['-][A-Za-z]+)*/g)?.length ?? 0) > 4).length > card.targetSentences + 5) {
      issues.push(`第 ${index + 1} 段句子数 ${sentences.length}，严重偏离目标 ${card.targetSentences}`);
    }
    const longest = Math.max(
      0,
      ...sentences.map((sentence) => sentence.match(/[A-Za-z]+(?:['-][A-Za-z]+)*/g)?.length ?? 0),
    );
    // A paragraph card is an aiming target, not a readability cliff. In the
    // middle-school contract the target can be 12 words while the level guide
    // permits an average near 15. Rejecting an otherwise coherent draft at 19
    // words caused repeated whole-draft rewrites. Keep 13-22 word outliers as
    // review signals and reserve the hard gate for genuinely overloaded lines.
    if (longest > card.maxWordsPerSentence + storyGenerationPolicy.length.severeSentenceExtraWords) {
      issues.push(`第 ${index + 1} 段最长句 ${longest} 词，严重超过预算 ${card.maxWordsPerSentence}`);
    }
  }
  return issues;
}

function splitSeverelyOverlongSentences(
  contract: EpisodeWritingContract,
  narrative: z.infer<typeof fourParagraphNarrativeSchema>,
) {
  let changed = false;
  const paragraphs = narrative.paragraphs.map((paragraph, paragraphIndex) => {
    const card = contract.paragraphCards[paragraphIndex];
    if (!card) return paragraph;
    const hardMaximum = card.maxWordsPerSentence + storyGenerationPolicy.length.severeSentenceExtraWords;
    return narrativeSentences(paragraph).map((sentence) => {
      const wordCount = sentence.match(/[A-Za-z]+(?:['-][A-Za-z]+)*/g)?.length ?? 0;
      if (wordCount <= hardMaximum || /["“”]/.test(sentence)) return sentence;
      const punctuation = sentence.match(/[.!?]+$/)?.[0] ?? ".";
      const body = sentence.slice(0, sentence.length - (sentence.match(/[.!?]+$/)?.[0]?.length ?? 0));
      const candidates = [...body.matchAll(/[,;:]\s+/g)]
        .map((match) => {
          const left = body.slice(0, match.index).trim();
          const right = body.slice((match.index ?? 0) + match[0].length).trim();
          const leftWords = left.match(/[A-Za-z]+(?:['-][A-Za-z]+)*/g)?.length ?? 0;
          const rightWords = right.match(/[A-Za-z]+(?:['-][A-Za-z]+)*/g)?.length ?? 0;
          return { left, right, leftWords, rightWords, distance: Math.abs(leftWords - rightWords) };
        })
        .filter(({ leftWords, rightWords }) => leftWords >= 5 && rightWords >= 5)
        .sort((left, right) => left.distance - right.distance);
      const split = candidates[0];
      if (!split) return sentence;
      changed = true;
      const right = split.right.replace(/^([a-z])/, (letter) => letter.toUpperCase());
      return `${split.left}. ${right}${punctuation}`;
    }).join(" ");
  });
  return changed ? { ...narrative, paragraphs } : narrative;
}

let narrativeContentRepairQueue: Promise<void> = Promise.resolve();
let narrativeContentRepairBlockedUntil = 0;

function runSerializedNarrativeContentRepair<T>(operation: () => Promise<T>) {
  const pending = narrativeContentRepairQueue
    .catch(() => undefined)
    .then(async () => {
      if (Date.now() < narrativeContentRepairBlockedUntil) {
        throw new Error("模型服务繁忙，已停止本批后续长度校正请求");
      }
      try {
        return await operation();
      } catch (error) {
        if (isTransientModelCapacityError(error)) {
          narrativeContentRepairBlockedUntil = Date.now() + 60_000;
        }
        throw error;
      }
    });
  narrativeContentRepairQueue = pending.then(() => undefined, () => undefined);
  return pending;
}

async function callFourParagraphNarrative(
  options: StoryRunOptions,
  system: string,
  user: string,
  model: string,
  temperature: number,
  policy: ModelCallPolicy,
) {
  return callStructured(
    options,
    fourParagraphNarrativeSchema,
    system,
    user,
    model,
    temperature,
    policy,
  );
}

async function callBudgetedEpisodeNarrative(
  options: StoryRunOptions,
  plan: SeriesPlan,
  index: number,
  previousEpisode: GeneratedStoryEpisode | null,
  system: string,
  user: string,
  model: string,
  temperature: number,
  policy: ModelCallPolicy,
) {
  const episodeNumber = index + 1;
  const contract = buildEpisodeWritingContract(options, plan, episodeNumber);
  const requestedWords = contract.paragraphCards.reduce(
    (total, card) => total + card.targetWords[1],
    0,
  );
  const maxCompletionTokens = narrativeCompletionTokenBudget(requestedWords);
  let narrative = await callFourParagraphNarrative(
    options,
    system,
    user,
    model,
    temperature,
    { ...policy, maxCompletionTokens },
  );
  narrative = splitSeverelyOverlongSentences(contract, narrative);
  narrative = trimTinyNarrativeOverflow(
    narrative,
    contract.publishWordRange[1],
    storyGenerationPolicy.length.tinyOverflowWords,
  );
  let completedContentRepairs = 0;
  for (let contentAttempt = 0; contentAttempt < 2; contentAttempt++) {
    const hardIssues = [
      ...narrativePreflightIssues(options, plan, episodeNumber, narrative),
      ...draftSevereSentenceBudgetIssues(contract, narrative),
    ];
    const sentenceIssues = draftSentenceBudgetIssues(contract, narrative);
    if (!hardIssues.length && !sentenceIssues.length) {
      options.log(
        `[${episodeNumber}/${options.episodes}] ${completedContentRepairs > 0 ? `第 ${completedContentRepairs} 次定长校正` : "首稿"}`
        + `一次命中长度与句子预算：${narrativeWordCount(narrative)} 词。`,
      );
      return narrative;
    }
    if (!hardIssues.length) {
      options.log(
        `[${episodeNumber}/${options.episodes}] ${completedContentRepairs > 0 ? `第 ${completedContentRepairs} 次定长校正稿` : "首稿"}`
        + `已在词数范围内（${narrativeWordCount(narrative)} 词）；句子预算存在轻微偏差（${sentenceIssues.join("；")}），`
        + "保留正文交给独立质量评审，避免为机械格式重写好稿。",
      );
      return narrative;
    }
    options.log(
      `[${episodeNumber}/${options.episodes}] 首稿内容预算未通过（${hardIssues.join("；")}）；`
      + `正在用仅含当前稿的短提示做第 ${contentAttempt + 1}/2 次定长校正。`,
    );
    narrative = await runSerializedNarrativeContentRepair(() => callFourParagraphNarrative(
      options,
      "你只输出 title 和 paragraphs 的合法 JSON。你是定长编辑，只缩短或补足当前稿，不增加事件，不改变四段顺序。paragraphs 必须是四个段落字符串。",
      `四段句子与词数预算：${JSON.stringify(contract.paragraphCards)}\n`
        + `全文硬范围：${contract.publishWordRange[0]}-${contract.publishWordRange[1]} 英文词。\n`
        + `必须保留的四项事件：${JSON.stringify(contract.requiredEvents)}\n`
        + `必须保留的线索动作：${JSON.stringify(contract.requiredClueActions)}\n`
        + `当前唯一可编辑稿：${JSON.stringify(narrative)}\n`
        + `当前问题：${hardIssues.join("；")}。\n`
        + "paragraphs 必须恰好包含四个段落字符串；每段的完整句子数按对应 targetSentences 控制。只返回修正后的单一 JSON 对象。",
      options.structureRepairModel || options.reviewModel || model,
      0.1,
      {
        timeoutMs: options.timeoutMs,
        networkRetries: 1,
        structureRetries: 1,
        maxCompletionTokens,
        disableThinking: true,
      },
    ));
    narrative = splitSeverelyOverlongSentences(contract, narrative);
    narrative = trimTinyNarrativeOverflow(
      narrative,
      contract.publishWordRange[1],
      storyGenerationPolicy.length.tinyOverflowWords,
    );
    completedContentRepairs += 1;
  }
  const remaining = [
    ...narrativePreflightIssues(options, plan, episodeNumber, narrative),
    ...draftSevereSentenceBudgetIssues(contract, narrative),
  ];
  if (remaining.length) {
    throw new StoryGenerationFailure(
      `第 ${episodeNumber} 集两次定长校正后仍不合法：${remaining.join("；")}`,
      "NARRATIVE_LENGTH_BUDGET",
      "narrative",
      "top_candidate",
    );
  }
  return narrative;
}

function sourceBrief(
  options: Pick<StoryRunOptions, "sourceMode" | "classicId" | "sourceTitle" | "sourceNotes">,
) {
  if (options.sourceMode === "classic") {
    const source = classicSources[options.classicId as ClassicSourceId];
    if (!source) throw new Error("classic 模式必须选择内置公版名著");
    return `选材模式：公版名著分级改写。
原作：${source.title}，${source.author}。
故事核心：${source.storyCore}。
儿童吸引点：${source.childAppeal}。
应保留公版原作的人名、关键关系和标志性事件，但必须基于原作事实独立重述；不得复制 Oxford Bookworms、影视版、现代译本或其他简写本的句子、章节结构和新增设定。把长支线压缩为清晰的因果链，每集只推进一个主要冲突，同时保留原作的情感核心。兴趣分类只决定节奏、幽默浓度和推荐人群，不要把虎小满、猫成成或机甲等分类角色强行放进原作。`;
  }
  if (options.sourceMode === "favorite") {
    return `选材模式：根据孩子喜欢的故事类型创作全新故事。
兴趣参照名称：${options.sourceTitle || "未指定具体作品"}。
孩子喜欢的元素：${options.sourceNotes || "冒险、幽默、伙伴与解谜"}。
只提取节奏、情绪、题材和吸引点，不得使用参照作品的角色名、专有设定、世界规则、标志性道具、台词或情节组合。最终角色、世界和谜题必须可独立识别为原创。`;
  }
  return `选材模式：完全原创。可以使用神话、探险、校园、动物伙伴等通用故事原型，但不得复刻任何现有作品的角色、世界观或情节组合。`;
}

function gradedReadingBrief(options: Pick<StoryRunOptions, "examId" | "readerStage">) {
  const profile = resolveReaderProfile(options);
  const audience = examGuide[options.examId].audience;
  return `分级阅读档位：${profile.label}，CEFR ${profile.cefr}，以约 ${profile.headwords} 个核心高频词为词汇控制参考。
这个档位控制英语和表达难度，不代表读者年龄；题材、人物选择和幽默仍须面向${audience}，Starter 也不能写成 3-6 岁幼儿故事。推理应清楚可见，不用复杂术语增加理解负担。
${readingLanguageBrief(profile.id)}
采用成熟分级读物的方法，但不模仿任何具体书虫文本：约 95% 正文使用该档高频、具体、易成像的词；同一人物、地点和关键物件保持固定称呼；少用同义替换；难概念先用动作或情境铺垫；每集最多引入 ${profile.maxNewWords} 个值得学习的新词，并让词义可从上下文猜出。输出前逐词检查拼写和空格，禁止把 maybe stealing 写成 maybest ealing 一类粘连、断词或漏字母形式；角色口癖也必须由正确英文单词组成。`;
}

export function buildSeriesPlanPrompt(
  options: Pick<
      StoryRunOptions,
      "interest" | "examId" | "episodes" | "sourceMode" | "classicId" | "sourceTitle" | "sourceNotes" | "readerStage"
    > &
    Partial<
      Pick<StoryRunOptions, "customInterestName" | "customInterestPrompt">
    >,
) {
  const guide = storyGuideFor(options);
  const level = examGuide[options.examId];
  const planCapacity = storyPlanCapacity(options);
  const classicMode = options.sourceMode === "classic";
  return `你是儿童与青少年英语连续故事的总编剧。请设计一个 ${options.episodes} 集的英文连续分级故事季。

栏目方向：${guide.label}
题材承诺：${classicMode ? `${guide.label}只作为阅读节奏与幽默风格参考，故事内容忠实简化指定公版原作` : guide.promise}
核心角色结构：${classicMode ? "使用原作核心人物，合并不必要的次要人物，但不能改变关键人物关系" : guide.cast}
幽默来源：${guide.humor}
读者：${level.audience}
${sourceBrief(options)}
${gradedReadingBrief(options)}
${buildNarrativeCraftBrief(options)}

硬性质量标准：
1. 每集开头两句内出现异常事件、具体目标或好笑的麻烦，不做背景说明堆砌。
2. 每集至少有一次有效线索、一次合理误判或反转、一次由团队合作真正解决的困难。
3. 友情通过行动、分歧、互相补位和承认错误体现，不用说教台词总结价值观。
4. 对手要有能理解的动机；谜题答案必须由前文线索支持，禁止突然出现万能道具。
5. 非终集结尾解决当前小目标并留下公平的新悬念；终集解决主问题并完成情感收束，不强制新增悬念。
6. 整季有主谜题、角色成长和线索回收；笑点来自人物性格，不靠网络热梗。
7. 严格遵守上面的选材模式：公版名著可忠实简化原作；其余模式不得使用现有影视、动漫、小说或游戏的受保护表达。
8. 场景不能写成事件清单。每集选一个主要场景，用角色能看到、听到、闻到、尝到或触到的具体细节让空间可感，并用清楚的因果过渡连接行动。
9. 英文正文和题目必须是自然、地道、适龄的英语，不得夹杂中文。每集自然放入一个从语境可理解的常用英语表达，不堆砌俚语或生硬直译中文。
10. 整季最多 ${planCapacity.maximumMainCharacters} 位主要角色、最多 ${planCapacity.maximumSeasonClues} 条线索、最多 ${planCapacity.maximumWorldRules} 条世界规则；每集最多 ${planCapacity.maximumNewFactsPerEpisode} 条核心新事实。角色和线索必须少而深，不得用增加人物、物件和谜题数量制造虚假复杂度。
11. choice 必须让角色冒一个具体风险或放弃一项容易方案；consequence 必须是该选择立刻造成的麻烦、代价、计划失败或关系摩擦，不能只写“看到、听到、找到、意识到一条线索”。线索发现另写在 newInformation。每集至少有一个由角色性格造成、又需要伙伴补位的可视小意外或幽默失误。

每套策划还必须完成：
- 故事圣经：3-${planCapacity.maximumWorldRules} 条不可随意改变的世界规则；固定人物、地点和物件的英文称呼；每位主要角色的欲望、恐惧、说话特征和整季成长。
- 线索账本：每条线索用 C1、C2……编号，明确在哪一集埋下、误导、使用和回收；埋下不得晚于使用，最后一集前回收主线线索。
- 每集按“目标→阻碍→角色作出艰难选择→产生后果→出现新问题”构成因果链，不能只罗列事件。
- consequence 只写选择立刻造成的一次可见代价、挫折或计划失败；不能只写角色看见、听见或找到线索。irreversibleChange 必须写该代价随后留下的持久新状态，不能换一种说法重复同一次碰撞、触发、发现或决定。
- 非终集 cliffhanger 须体现本集带来的新信息，不重复开场问题；终集该字段记录完整收束画面，不引入新的待解任务。
- 每集写一份独立任务合同：episodeMission 说明这一集在整季中不可替代的作用；newInformation 最多 ${planCapacity.maximumNewFactsPerEpisode} 条，按“背景事实在前、本集改变局面的核心发现放最后”排序；irreversibleChange 写明结尾后无法回到本集开头的状态变化。mustNotRepeat 由程序根据前一集事实自动推导，你必须返回空数组 []，不得自行填写，避免与本集任务冲突。
- 每集最多安排 2 个需要独立场景、明确证据或完整解释的核心线索动作。同一场景顺带出现、共同指向同一结论，或在最终解释中一并回收的其他线索只能作为辅助细节，不得在 episodeMission 中逐条罗列成额外任务；程序会自动选出每集最重要的 2 个核心动作。
- 相邻两集不能用相同事件换地点重演。第二集必须扩大冲突或推翻一个判断，最终集必须用前文证据解决主问题；每集至少有一个新的行动结果，而不只是再次观察已知异常。
- 每集最多推进 2-3 个主要事件；人物换地点、获得信息或改变计划时必须写出原因。伏笔先以不起眼但可记住的感官细节出现，后续回收时让读者能回想起原文证据。

只返回一套策划 JSON，不要附加说明：
{"seriesTitle":"英文系列名","premise":"中文策划说明","cast":[{"name":"英文名","role":"中文角色作用","strength":"优点","flaw":"缺点"}],"seasonMystery":"中文主谜题","storyBible":{"worldRules":["中文"],"fixedTerms":[{"concept":"中文概念","english":"固定英文称呼"}],"characterArcs":[{"name":"英文名","wants":"中文","fear":"中文","voice":"中文","growth":"中文"}]},"clueLedger":[{"id":"C1","clue":"中文","introducedIn":1,"misdirection":"中文","usedIn":2,"payoffIn":3,"payoff":"中文"}],"episodes":[{"number":1,"title":"英文标题","episodeMission":"本集不可替代的叙事任务","newInformation":["本集新增事实"],"irreversibleChange":"本集结束后的不可逆变化","mustNotRepeat":[],"openingHook":"中文","goal":"中文","obstacle":"中文","choice":"中文","consequence":"中文","newQuestion":"中文","problem":"中文","clue":"中文","teamworkTurn":"中文","emotionalBeat":"中文","cliffhanger":"中文"}]}`;
}

function episodePlanContext(plan: SeriesPlan, episodeNumber: number) {
  return {
    seriesTitle: plan.seriesTitle,
    premise: plan.premise,
    cast: plan.cast,
    seasonMystery: plan.seasonMystery,
    storyBible: plan.storyBible,
    episode: plan.episodes[episodeNumber - 1],
    relevantClues: plan.clueLedger.filter(
      (clue) => [clue.introducedIn, clue.usedIn, clue.payoffIn].includes(episodeNumber),
    ),
  };
}

function continuityUsageContract(plan: SeriesPlan, episodeNumber: number) {
  const beat = plan.episodes[episodeNumber - 1];
  const requiredActions = requiredEpisodeClueActions(plan, episodeNumber);
  return {
    entryBridge: beat?.entryBridge ?? null,
    narrativeSpine: plan.narrativeSpine ?? null,
    knownFactsMayBeReferencedOnce: beat?.mustNotRepeat ?? [],
    requiredClueProgression: requiredActions.map((action) => ({
      ...action,
      clue: plan.clueLedger.find((clue) => clue.id === action.clueId)?.clue ?? action.clueId,
      payoff: plan.clueLedger.find((clue) => clue.id === action.clueId)?.payoff ?? "",
    })),
    rule: "已知事实可以用一句承接，但不能伪装成首次发现；当 requiredClueProgression 要求 use/payoff 时，必须引用旧证据并增加新的原因、后果或解释，这不算重复。",
  };
}

type EpisodeClueAction = {
  clueId: string;
  action: "plant" | "use" | "payoff";
};

function episodeClueActions(plan: SeriesPlan, episodeNumber: number): EpisodeClueAction[] {
  const plantedOrPaidOff = plan.clueLedger.flatMap((clue) => [
    ...(clue.introducedIn === episodeNumber
      ? [{ clueId: clue.id, action: "plant" as const }]
      : []),
    ...(clue.payoffIn === episodeNumber
      ? [{ clueId: clue.id, action: "payoff" as const }]
      : []),
  ]);
  if (plantedOrPaidOff.length) {
    return plantedOrPaidOff;
  }
  return plan.clueLedger
    .filter((clue) => clue.usedIn === episodeNumber)
    .slice(0, 1)
    .map((clue) => ({ clueId: clue.id, action: "use" as const }));
}

function requiredEpisodeClueActions(plan: SeriesPlan, episodeNumber: number): EpisodeClueAction[] {
  // A clue ledger describes the whole season and may legitimately plant or
  // resolve several related details in one scene. The episode contract only
  // promotes the first two to hard requirements; the rest remain supporting
  // evidence instead of invalidating an otherwise coherent season plan.
  return episodeClueActions(plan, episodeNumber)
    .slice(0, storyGenerationPolicy.clues.maximumHardActionsPerEpisode);
}

export function seriesPlanClueCapacityAdjustments(plan: SeriesPlan) {
  return plan.episodes.flatMap((episode) => {
    const all = episodeClueActions(plan, episode.number);
    const maximum = storyGenerationPolicy.clues.maximumHardActionsPerEpisode;
    if (all.length <= maximum) return [];
    return [{
      episodeNumber: episode.number,
      primary: all.slice(0, maximum),
      supporting: all.slice(maximum),
    }];
  });
}

export type EpisodeWritingContract = {
  endingMode: "resolution" | "cliffhanger";
  editorialRules: string;
  wordRange: [number, number];
  publishWordRange: [number, number];
  paragraphCards: Array<{
    paragraph: number;
    targetWords: [number, number];
    targetSentences: number;
    maxWordsPerSentence: number;
    purpose: string;
  }>;
  requiredClueActions: EpisodeClueAction[];
  requiredEvents: string[];
  optionalIfSpace: string[];
  mustNotRepeat: string[];
};

export function episodeWritingContractCapacityIssues(contract: EpisodeWritingContract) {
  const issues: string[] = [];
  if (contract.paragraphCards.length !== 4) issues.push("每集必须恰好分配四张段落任务卡");
  if (contract.requiredEvents.length > 4) issues.push("每集硬叙事任务不得超过四项");
  if (contract.requiredClueActions.length > 2) issues.push("每集强制线索动作不得超过两项");
  return issues;
}

export function buildEpisodeWritingContract(
  options: Pick<StoryRunOptions, "examId"> & Partial<Pick<StoryRunOptions, "readerStage">>,
  plan: SeriesPlan,
  episodeNumber: number,
): EpisodeWritingContract {
  const beat = plan.episodes[episodeNumber - 1];
  if (!beat) throw new Error(`季纲缺少第 ${episodeNumber} 集任务合同`);
  const { targetRange: range, publishRange } = storyWordLimits(options, episodeNumber);
  const preferredMin = range[0] + Math.min(12, Math.floor((range[1] - range[0]) / 4));
  const preferredMax = range[1] - Math.min(12, Math.floor((range[1] - range[0]) / 4));
  const average = Math.floor((preferredMin + preferredMax) / 8);
  // Models regularly overshoot requested prose length. Aim each paragraph at
  // the lower half of the legal range so a modest overrun still passes the
  // hard preflight instead of wasting an entire critique round.
  const paragraphMin = Math.ceil(preferredMin / 4);
  const paragraphMax = Math.ceil(preferredMax / 4);
  const initialSentenceMaximum = Math.min(examGuide[options.examId].maxSentenceWords - 2,
    readingDifficulty(resolveReaderProfile({ ...options, readerStage: options.readerStage ?? "auto" }).id).averageSentenceWords + 2);
  const preferredTotal = Math.floor((preferredMin + preferredMax) / 2);
  const sentenceTotal = Math.max(12, Math.ceil(preferredTotal / Math.max(9, initialSentenceMaximum - 1)));
  const maximumWordsPerSentence = Math.max(
    9,
    Math.min(initialSentenceMaximum, Math.floor(preferredMax / sentenceTotal)),
  );
  const paragraphSentenceCounts = Array.from(
    { length: 4 },
    (_, index) => Math.floor(sentenceTotal / 4) + (index < sentenceTotal % 4 ? 1 : 0),
  );
  // Select the discovery from the episode's required clue progression, not
  // the arbitrary position of background/side-plot facts in an array.
  const primaryDiscovery = requiredEpisodeClueActions(plan, episodeNumber)
    .map((action) => {
      const clue = plan.clueLedger.find((clue) => clue.id === action.clueId);
      return action.action === "payoff" ? clue?.payoff : clue?.clue;
    })
    .filter(Boolean).join("；") || beat.clue;
  const contract: EpisodeWritingContract = {
    endingMode: episodeNumber === plan.episodes.length ? "resolution" : "cliffhanger",
    editorialRules: "本合同优先于通用写作建议。endingMode=resolution 时，写作、融合和评审都以解决主谜题、可见救助结果、幽默或友情收束为目标，不能要求新谜题或下一集钩子。以上一集实际正文为事实；不复述旧物件不等于矛盾，两种有效感官即达标，不强制口头禅，段落卡可按因果跨段完成，支线事实可省略。线索回收必须展示可观察的验证，不能凭多个物件同时出现就推断身份或动机。",
    wordRange: range,
    publishWordRange: publishRange,
    paragraphCards: [
      {
        paragraph: 1,
        targetWords: [paragraphMin, paragraphMax],
        targetSentences: paragraphSentenceCounts[0],
        maxWordsPerSentence: maximumWordsPerSentence,
        purpose: `用立即发生的画面或对话完成钩子，并让读者明白唯一目标：${beat.goal}`,
      },
      {
        paragraph: 2,
        targetWords: [paragraphMin, paragraphMax],
        targetSentences: paragraphSentenceCounts[1],
        maxWordsPerSentence: maximumWordsPerSentence,
        purpose: `把阻碍场景化，让伙伴们不得不作出选择：阻碍=${beat.obstacle}；选择=${beat.choice}`,
      },
      {
        paragraph: 3,
        targetWords: [paragraphMin, paragraphMax],
        targetSentences: paragraphSentenceCounts[2],
        maxWordsPerSentence: maximumWordsPerSentence,
        purpose: `展示选择导致的可见后果，通过动作发现一条核心新信息：后果=${beat.consequence}；核心新信息=${primaryDiscovery}`,
      },
      {
        paragraph: 4,
        targetWords: [paragraphMin, paragraphMax],
        targetSentences: paragraphSentenceCounts[3],
        maxWordsPerSentence: maximumWordsPerSentence,
        purpose: `从上一段后果已经发生后的状态继续，绝不重演触发动作；只展示该后果留下的持久变化，再用带有新证据或新风险的可视悬念结束：持久变化=${beat.irreversibleChange}；原始悬念=${beat.cliffhanger}`,
      },
    ],
    requiredClueActions: requiredEpisodeClueActions(plan, episodeNumber),
    requiredEvents: [
      `钩子与唯一中心目标：${beat.goal}`,
      `主要阻碍、角色选择与伙伴合作：${beat.obstacle}；${beat.choice}；${beat.teamworkTurn}`,
      `选择的可见后果与一条核心新信息：${beat.consequence}；${primaryDiscovery}`,
      `承接上一段后果，不得重复其触发动作；用持续状态体现不可逆变化，并让结尾悬念比开场目标多出一项具体新证据或新风险：${beat.irreversibleChange}；${beat.cliffhanger}`,
    ],
    optionalIfSpace: [
      ...beat.newInformation,
      beat.emotionalBeat,
      beat.clue,
    ].filter(Boolean),
    mustNotRepeat: beat.mustNotRepeat.slice(0, 3),
  };
  const capacityIssues = episodeWritingContractCapacityIssues(contract);
  if (contract.endingMode === "resolution") {
    const resolution = `这是终集：完成当前中心目标，交代可见结果和伙伴关系的回报。持久状态参考：${beat.irreversibleChange}。不强制采用旧 cliffhanger，不新增身份谜题、威胁、下一集或未知旁观者；温暖或幽默的完整收束优先。`;
    contract.paragraphCards[3].purpose = resolution;
    contract.requiredEvents[3] = resolution;
  }
  if (capacityIssues.length) {
    throw new Error(`第 ${episodeNumber} 集任务合同超出文章容量：${capacityIssues.join("；")}`);
  }
  return contract;
}

export function reviewEpisodeWritingContract(contract: EpisodeWritingContract) {
  return {
    endingMode: contract.endingMode,
    wordRange: contract.wordRange,
    publishWordRange: contract.publishWordRange,
    requiredClueActions: contract.requiredClueActions,
    narrativeFunctions: [
      "开头建立当前问题和唯一目标",
      "阻碍迫使角色作出有代价的选择，伙伴合作改变结果",
      "选择产生可见后果，并让线索获得新的用途、解释或关系影响",
      contract.endingMode === "resolution" ? "解决中心问题并完成情感收束" : "从后果推进到一个具体的新问题或风险",
    ],
    mustNotRepeat: contract.mustNotRepeat,
  };
}

function episodePrompt(
  options: StoryRunOptions,
  plan: SeriesPlan,
  episodeIndex: number,
  previousEpisode: GeneratedStoryEpisode | null,
  includePreviousText = true,
  strictParagraphOutput = false,
) {
  const level = examGuide[options.examId];
  const readerProfile = resolveReaderProfile(options);
  const beat = plan.episodes[episodeIndex];
  const contract = buildEpisodeWritingContract(options, plan, beat.number);
  const range = contract.wordRange;
  const publishRange = contract.publishWordRange;
  return `根据故事季策划，写第 ${beat.number} 集英文分级阅读文章。

本集经词数容量检查后的写作合同：${JSON.stringify(contract)}
${contract.endingMode === "resolution" ? "最高优先级结尾规则：本集是终集，必须解决主谜题并完成情绪回报；后文所有关于新悬念、新风险、下一集的通用建议均不适用于本集。" : "本集继续推进故事，结尾留下公平悬念。"}
故事圣经：${JSON.stringify(plan.storyBible)}
本集涉及的线索原始设定：${JSON.stringify(plan.clueLedger.filter((clue) => contract.requiredClueActions.some((required) => required.clueId === clue.id)))}
上一集事实交接（只有 sourceEnding/immediateSituation 是已发生事实，nextAction 是本集目标）：${JSON.stringify(beat.entryBridge ?? null)}
连续性使用合同：${JSON.stringify(continuityUsageContract(plan, beat.number))}
${serialReadingContext(options.publishedStoryContext ?? (previousEpisode ? [previousEpisode] : []), beat.number === options.episodes)}
上一集最终英文正文：${previousEpisode ? (includePreviousText ? JSON.stringify(previousEpisode.paragraphs) : "已包含在上方‘已发布整季正文’中") : "第一集尚无正文"}
${sourceBrief(options)}
${gradedReadingBrief(options)}
${buildNarrativeCraftBrief(options, beat.number)}

语言控制：
- 正文目标 ${range[0]}-${range[1]} 个英文词，允许的发布硬范围为 ${publishRange[0]}-${publishRange[1]} 词；写成恰好 4 个自然段。
- title、paragraphs 和 qualityEvidence 中的原文证据只能使用英语，严禁出现任何中文汉字；中文只允许出现在 continuitySummary 和 storyState。
- 面向${level.audience}，优先使用约 ${readerProfile.headwords} 词档的核心高频词；只设置 4-${readerProfile.maxNewWords} 个可从语境猜出的 targetWords。
- 平均句长不超过约 ${Math.min(level.maxSentenceWords, readingDifficulty(readerProfile.id).averageSentenceWords)} 词；关键动作使用短句。
- 对话简短自然，使用英语母语者在该场景中会说的表达；自然加入一个适龄常用表达（例如请求、犹豫、安慰或承认错误），通过上下文让意思清楚，禁止堆砌俚语或直译中文成语。
- 不为追求“文学感”频繁替换同义词；相同事物尽量沿用相同称呼，让孩子凭上下文建立词义。

叙事控制：
- 前两句必须形成钩子。
- 严格按 paragraphCards 写成恰好 4 段，每段只完成该卡的一个叙事任务。每段不得超过对应 targetWords 的上限；写完一段后先在内部累计英文词数，达到上限就停止该段，不输出计数过程。targetSentences 是建议值，允许上下浮动 1 句；maxWordsPerSentence 是多数句子的可读性目标，不要为了机械拆句破坏自然英语。全文发布词数和 requiredEvents 才是硬约束。用 because、so、but、when、after 等自然关系或明确动作写清“为什么发生”和“因此发生什么”。
- 至少写入两种五感中的具体细节，用声音、光线、气味、味道、温度、触感或身体反应帮助读者看懂人物在哪里、危险从哪来；感官描写必须服务线索或情绪，不能堆形容词。
- requiredEvents 是本集全部硬任务，必须在四段内以可见动作完成“目标→阻碍→选择→后果→新问题”；选择必须有代价，后果必须由选择引起。optionalIfSpace 不是必写项，只能在不增加新场景、不超词数时自然融入，绝不得为了塞满旧季纲而牺牲因果。
- 第 3 段只发生一次关键选择及其即时后果；第 4 段从后果已经发生后的状态继续，只展示持久影响，不得换一种说法再次表演同一碰撞、触发、发现或决定。结尾必须新增一个开场尚不知道的可见证据、风险或问题，不能只把开场的 who/where/what 原样再问一次。
- 与上一集最终正文逐段比较：不得重复相同的解释、动作顺序或悬念；每段必须至少推进一次新行动、新判断或新后果。允许用一句话承接已知线索；若本集要求 use/payoff，承接后必须立即增加新的因果解释或可见后果，不能把旧线索再次写成首次发现。
- 线索先以自然细节出现，之后才能使用或回收；合作必须改变结果；结尾必须是公平悬念。按 clueLedger 准确标注本集是 plant、use 还是 payoff。
- 遵守 storyBible 的固定称呼、人物声音和世界规则，不得让角色忘记已知事实或无故获得物件。
- 文章本身要精彩，不要用“这告诉我们团队合作很重要”之类说教句。

输出前静默执行一次硬门禁自检，不要输出自检过程：
- 逐段核对词数、句子数和句长，再核对全文；任何一段超过 targetWords 上限时先删去装饰语，全文词数必须落在 ${range[0]}-${range[1]} 内，最好离上下限各留 15 个词余量；每段句子数允许比 targetSentences 多或少 1，绝大多数句子控制在 maxWordsPerSentence 附近；除带引号短对话外，不超过 4 词的叙述句不得超过全部叙述句的 30%。
- 本阶段只生成 title 和 paragraphs，不要生成 targetWords、continuitySummary、storyState、qualityEvidence 或 questions；这些会在最佳正文选出后单独生成。

只返回 JSON：
${strictParagraphOutput
    ? `{"title":"English title","paragraphs":["paragraph 1","paragraph 2","paragraph 3","paragraph 4"]}。这是结构示例，不得照抄占位文字。paragraphs 必须恰好是四个段落字符串，不要在顶层逐句展开；每段内部的完整句子数遵守对应 paragraphCard.targetSentences。`
    : '{"title":"English title","paragraphs":["paragraph 1","paragraph 2","paragraph 3","paragraph 4"]}'}`;
}

function critiquePrompt(
  options: StoryRunOptions,
  plan: SeriesPlan,
  episode: Pick<GeneratedStoryContent, "title" | "paragraphs">,
  episodeNumber: number,
  previousEpisode: GeneratedStoryEpisode | null,
) {
  const contract = buildEpisodeWritingContract(options, plan, episodeNumber);
  const reviewContract = reviewEpisodeWritingContract(contract);
  return `你是由四位编辑组成的儿童英语故事审稿组，只诊断问题，不重写正文。

本集评审合同（只含叙事功能，不含指定写法）：${JSON.stringify(reviewContract)}
故事圣经：${JSON.stringify(plan.storyBible)}
上一集最终正文：${previousEpisode ? JSON.stringify(previousEpisode.paragraphs) : "第一集"}
事实交接（只有 sourceEnding/immediateSituation 是上一集事实；nextAction 是当前候选可完成的本集目标）：${JSON.stringify(plan.episodes[episodeNumber - 1]?.entryBridge ?? null)}
第 ${episodeNumber} 集待审稿（共 ${episode.paragraphs.length} 段）：${JSON.stringify(episode)}
${reviewEvidenceRules}
${serialReadingContext(options.publishedStoryContext ?? (previousEpisode ? [previousEpisode] : []), episodeNumber === options.episodes)}
${sourceBrief(options)}
${gradedReadingBrief(options)}
${buildNarrativeCraftBrief(options, episodeNumber)}

四个视角分别按 0-10 分审查：
1. plot：逐段追踪目标、阻碍、选择、后果，检查每次移动、发现和计划改变是否有原因；线索是否先埋后用、后续解释是否回收前文，而不是事件清单或突然跳转。检查身份、称呼和因果时，必须使用相同语义维度及正文证据；相关性和时间顺序本身不证明因果，不得引入正文未建立的前提。评审合同的 narrativeFunctions 未真正完成时不得超过 7 分。
2. childAppeal：前两句钩子、自然笑点、具体冒险、伙伴互动和至少两种服务剧情的五感描写是否吸引读者。非终集检查续读期待，终集检查解决结果和情感回报。若角色只是观察、等待、移动和听解释，没有承担代价或改变结果，不得超过 7 分。
3. gradedLanguage：正文是否纯英文且自然地道；句子、词汇、指代是否适龄；是否有中式英语、不必要难词、碎片句、抽象解释和同义词漂移。对初中读者，若依赖多个未解释的虚构专名、抽象规则或读者无法从动作推知的世界设定，即使单词短也要扣分。
4. continuity：是否遵守故事圣经、线索账本和上一集人物/物件/已知事实状态；开头用一至两句必要的状态承接是连续故事的必需项，不得因此扣分；requiredClueProgression 要求 use/payoff 时，引用旧证据并给出新的原因、后果或解释属于正确回收，不得判为重复。只有把旧事实重新当成首次发现、主要目标、主要冲突，或重新表演已完成动作时才算重复。禁止补写正文没有的地图、对话、动机或动作。

连续性证据格式（程序会逐字校验）：continuity.issues 的每一项必须以 【前文证据：逐字短引文】 或 【当前证据：逐字短引文】 开头。涉及“上一集、前文、已发布”的判断只能使用前文证据；引文必须连续出现在对应英文正文中，不能转述、拼接或引用季纲。没有可引用正文的判断必须删除，不得扣分。向新角色首次展示或验证旧证据不能写成重复问题。

评分必须严格校准：7 分代表结构成立、只有可在后续局部修整的小问题；8 分代表无需结构性修改即可发布；9 分代表明显优秀，10 分只给几乎没有可执行问题的稿件。只要 issues 中存在会改变事件顺序、人物动机、核心线索或主要场景的结构性问题，对应维度就不能给 7 分以上。

证据与容量校准（必须执行）：上一集已发布英文正文优先于季纲预想；季纲与成稿不同不能算本集矛盾。旧线索可以驱动新的行动、推理或验证；未复述旧物件位置不等于丢失物件。叙事功能可跨段完成，不得仅因跨段而判顺序错误。故事圣经的 voice/growth 是风格与整季成长参考，不要求每集复述所有口头禅或完成整季成长。narrativeFunctions 按语义完成即可，不要求照搬某种中文细节、动作顺序或指定句数。两种有效感官已满足要求，不得再要求第三种。plant 只需公平展示证据，不要求提前 payoff。每维最多 3 条有正文证据的实质问题；不要把正面评价、偏好性的扩写建议或未被正文支持的猜测列为扣分理由。输出前检查每条 issues 是否自相矛盾，删除自相矛盾的理由并重算分数。

只返回 JSON：
{"plot":{"score":8,"issues":["中文问题"]},"childAppeal":{"score":8,"issues":["中文问题"]},"gradedLanguage":{"score":8,"issues":["中文问题"]},"continuity":{"score":8,"issues":["【当前证据：exact prose quote】中文问题"]},"rewritePriorities":["按重要性排序的中文修改动作"]}`;
}

function candidateCritiqueBatchPrompt(
  options: StoryRunOptions,
  plan: SeriesPlan,
  candidates: Array<Pick<GeneratedStoryContent, "title" | "paragraphs">>,
  episodeNumber: number,
  previousEpisode: GeneratedStoryEpisode | null,
) {
  const contract = buildEpisodeWritingContract(options, plan, episodeNumber);
  const reviewContract = reviewEpisodeWritingContract(contract);
  return `你是儿童英语连续故事的多维候选评审组。一次比较全部候选，但必须分别给每份候选独立评分，不能因为相对更好就放宽绝对质量线。

本集评审合同（只含叙事功能，不含指定写法）：${JSON.stringify(reviewContract)}
故事圣经：${JSON.stringify(plan.storyBible)}
上一集最终正文：${previousEpisode ? JSON.stringify(previousEpisode.paragraphs) : "第一集"}
事实交接（只有 sourceEnding/immediateSituation 是上一集事实；nextAction 是当前候选可完成的本集目标）：${JSON.stringify(plan.episodes[episodeNumber - 1]?.entryBridge ?? null)}
候选初稿（candidateIndex 必须沿用这里的编号）：${JSON.stringify(candidates.map((episode, candidateIndex) => ({ candidateIndex, paragraphCount: episode.paragraphs.length, episode })))}
${reviewEvidenceRules}
${serialReadingContext(options.publishedStoryContext ?? (previousEpisode ? [previousEpisode] : []), episodeNumber === options.episodes)}
${sourceBrief(options)}
${gradedReadingBrief(options)}
${buildNarrativeCraftBrief(options, episodeNumber)}

每份候选都按以下四个维度 0-10 分评审：
1. plot：目标、阻碍、选择、后果的因果是否完整，评审合同的 narrativeFunctions 是否真正完成。
2. childAppeal：开头钩子、伙伴互动、幽默、五感和冒险是否吸引读者；非终集检查续读期待，终集检查完整收束与情感回报。
3. gradedLanguage：是否纯英文、自然地道、词汇句长适龄，避免碎片句、中式英语和生僻同义词。
4. continuity：是否遵守故事圣经、线索账本和上一集状态，是否避免重复或凭空补信息。

连续性证据格式（程序会逐字校验）：每条 continuity.issues 必须以 【前文证据：逐字短引文】 或 【当前证据：逐字短引文】 开头；凡声称上一集、前文或已发布正文存在某事实，只能引用前文。引文必须连续存在于对应英文正文；不能引用季纲、摘要或改写建议。没有有效引文就删除该问题并重算连续性分数。向新角色首次展示或验证读者已知证据属于新后果，不是重复发现。

7 分代表结构成立且只有局部问题，8 分代表不需结构性修改即可发布；存在会改变事件顺序、人物动机或核心线索的结构性问题时不得超过 6 分。每个 issues 最多保留 3 个最重要问题，rewritePriorities 最多 4 项，保持精炼以免输出被截断。必须为每个 candidateIndex 恰好返回一份评审。

只返回：{"reviews":[{"candidateIndex":0,"plot":{"score":8,"issues":["中文问题"]},"childAppeal":{"score":8,"issues":["中文问题"]},"gradedLanguage":{"score":8,"issues":["中文问题"]},"continuity":{"score":8,"issues":["【当前证据：exact prose quote】中文问题"]},"rewritePriorities":["中文修改动作"]}]}`;
}

export function candidateReviewMode(candidateCount: number) {
  if (candidateCount <= 0) return "skip" as const;
  if (candidateCount === 1) return "single" as const;
  return "batch" as const;
}

async function reviewCandidateDrafts(
  options: StoryRunOptions,
  plan: SeriesPlan,
  candidates: Array<z.infer<typeof episodeNarrativeSchema>>,
  episodeNumber: number,
  previousEpisode: GeneratedStoryEpisode | null,
) {
  const mode = candidateReviewMode(candidates.length);
  if (mode === "skip") {
    options.log(`[${episodeNumber}/${options.episodes}] 本轮没有通过前检的新稿，跳过批评审 HTTP 调用。`);
    return [];
  }
  if (mode === "single") {
    options.log(`[${episodeNumber}/${options.episodes}] 本轮只有 1 份新稿，直接执行单稿独立评审，不伪装成多稿批评审。`);
    try {
      return [await reviewEpisodeSemantics(options, plan, candidates[0], episodeNumber, previousEpisode)];
    } catch (error) {
      options.log(`[${episodeNumber}/${options.episodes}] 唯一新稿的独立评审不可用：${modelRequestError(error)}`);
      return [null];
    }
  }
  try {
    const batch = await callStructured(
      options,
      groundedCandidateCritiqueBatchSchema(previousEpisode?.paragraphs ?? [], candidates),
      "你只输出合法 JSON。你是儿童英语连续故事候选评审组；用同一把尺子紧凑评分，不重写正文、不输出分析过程。",
      candidateCritiqueBatchPrompt(options, plan, candidates, episodeNumber, previousEpisode),
      options.reviewModel || options.model,
      Math.min(options.reviewTemperature, 0.1),
      {
        timeoutMs: options.timeoutMs,
        networkRetries: 1,
        structureRetries: 2,
        maxCompletionTokens: modelTokenBudgets.critique,
        disableThinking: true,
      },
    );
    const byIndex = new Map(batch.reviews.map((review) => [review.candidateIndex, review]));
    if (candidates.some((_candidate, index) => !byIndex.has(index))) {
      throw new Error(`业务约束校验失败：批量评审缺少候选编号，预期 0-${candidates.length - 1}`);
    }
    options.log(`[${episodeNumber}/${options.episodes}] 已用一次紧凑批评审完成 ${candidates.length} 份候选评分。`);
    return candidates.map((_candidate, index) => {
      const review = byIndex.get(index)!;
      return storyCritiqueSchema.parse(review);
    });
  } catch (error) {
    options.log(
      `[${episodeNumber}/${options.episodes}] 紧凑批评审不可用，回退为逐篇独立评分：${modelRequestError(error)}`,
    );
    const results = await Promise.allSettled(candidates.map((draft) => reviewEpisodeSemantics(
      options,
      plan,
      draft,
      episodeNumber,
      previousEpisode,
    )));
    return results.map((result, candidateIndex) => {
      if (result.status === "fulfilled") return result.value;
      options.log(
        `[${episodeNumber}/${options.episodes}] 候选 ${candidateIndex + 1} 的独立评分不可用，`
        + `该稿不会成为主骨架：${modelRequestError(result.reason)}`,
      );
      return null;
    });
  }
}

function reviewPrompt(
  options: StoryRunOptions,
  plan: SeriesPlan,
  episode: GeneratedStoryContent,
  critique: z.infer<typeof storyCritiqueSchema>,
  episodeNumber: number,
  previousEpisode: GeneratedStoryEpisode | null,
) {
  const level = {
    ...examGuide[options.examId],
    maxSentenceWords: Math.min(examGuide[options.examId].maxSentenceWords,
      readingDifficulty(resolveReaderProfile(options).id).averageSentenceWords),
  };
  const contract = buildEpisodeWritingContract(options, plan, episodeNumber);
  const range = contract.wordRange;
  const publishRange = contract.publishWordRange;
  return `你是严格的儿童英语故事编辑。请重写并提升下面这一集，而不是只写评语。

本集经容量检查后的写作合同：${JSON.stringify(contract)}
故事圣经：${JSON.stringify(plan.storyBible)}
上一集状态：${previousEpisode ? JSON.stringify(previousEpisode.storyState) : "第一集"}
上一集最终正文：${previousEpisode ? JSON.stringify(previousEpisode.paragraphs) : "第一集"}
连续性使用合同：${JSON.stringify(continuityUsageContract(plan, episodeNumber))}
待审稿：${JSON.stringify(episode)}
四维审稿意见：${JSON.stringify(critique)}
${sourceBrief(options)}
${gradedReadingBrief(options)}
${buildNarrativeCraftBrief(options, episodeNumber)}

按 rewritePriorities 逐项定向修复，但只把 writing contract 的 requiredEvents 当作硬任务；optionalIfSpace 不得导致增加场景或超词数。严格按 paragraphCards 保持 4 段，完成清楚的逐段因果、线索先埋后收、团队合作、情绪变化和一个集中悬念。正文以 ${range[0]}-${range[1]} 词为目标，发布硬范围为 ${publishRange[0]}-${publishRange[1]} 词；语言适合${level.audience}，平均句长约不超过 ${level.maxSentenceWords} 词。title 和 paragraphs 必须纯英文。逐词修正审稿指出的拼写、粘词、断词、漏字母和生造表达，禁止在重写中重新引入此类错误。删除说教、事件清单、突然解法、无来源信息和不必要难词。本阶段只改正文，不生成 targetWords、continuitySummary、storyState、qualityEvidence 或 questions；正文独立复核通过后再由后续步骤生成这些数据。

只返回 {"title":"英文标题","paragraphs":["第1段","第2段","第3段","第4段"]}，不要附加评论。`;
}

async function groundQuestions(
  options: StoryRunOptions,
  episode: GeneratedStoryContent,
  episodeNumber: number,
) {
  const result = await callStructured(
    options,
    groundedQuestionSetSchema,
    "你只输出合法 JSON。你是英语分级阅读题目终审，只能依据给出的最终正文命题，绝不补写正文没有的信息。",
    `这是第 ${episodeNumber} 集已经通过全部正文质量门禁的最终英文正文：\n${JSON.stringify(episode.paragraphs)}\n\n现在首次为它生成题目。硬性要求：\n1. 只生成 2 道四选一题：一道 detail，一道 inference 或 cause_effect。\n2. 每题 evidenceQuote 必须逐字复制上面 paragraphs 中连续存在的 3-25 个英文词，不能概括、改变时态或发明地图、动作、对话、动机。\n3. prompt、options、evidenceQuote 只能使用自然英语；选项不带 A/B/C/D 编号。\n4. 正确选项必须由 evidenceQuote 和正文上下文唯一推出；推断题只允许一步合理推断。\n5. 中文 explanation 先说明 evidenceQuote 的含义，再解释为什么正确选项成立；不得引用故事季纲、storyState 或正文外知识。\n6. 四个选项语法形式一致、长度接近；错误项可信但能被正文排除。\n\n只返回：{"questions":[{"prompt":"English question","options":["...","...","...","..."],"answer":0,"explanation":"中文解释","skill":"detail","evidenceQuote":"exact English quote"}]}`,
    options.structureRepairModel || options.reviewModel || options.model,
    0.1,
    { maxCompletionTokens: modelTokenBudgets.questions, disableThinking: true },
  );
  return result.questions;
}

async function reviewGroundedQuestions(
  options: StoryRunOptions,
  episode: GeneratedStoryContent,
  questions: z.infer<typeof questionSchema>[],
  episodeNumber: number,
) {
  return callStructured(
    options,
    groundedQuestionReviewSchema,
    "你只输出合法 JSON。你是独立阅读理解命题审核员，不为命题模型背书；只判断题目能否被正文证据严格支持。",
    `最终英文正文：${JSON.stringify(episode.paragraphs)}\n待审核题目：${JSON.stringify(questions)}\n\n`
      + "逐题检查：正确选项是否由 evidenceQuote 与相邻上下文直接陈述或通过一步必然推断得到；"
      + "不要把时间相邻、物品同时出现、左右手差异、气味相似或人物猜测误当成因果；"
      + "题干询问的主体、动作和时间必须与证据一致；四个选项中只能有一个成立。"
      + "detail 题必须直接陈述，inference/cause_effect 题不得补充正文没有的机制、动机或身份。"
      + "只返回 {\"reviews\":[{\"questionIndex\":0,\"supported\":true,\"uniqueAnswer\":true,\"issues\":[]}]}，"
      + "reviews 必须恰好包含第 0、1 题。",
    options.structureRepairModel || options.reviewModel || options.model,
    Math.min(options.reviewTemperature, 0.1),
    {
      timeoutMs: options.timeoutMs,
      networkRetries: 1,
      structureRetries: 2,
      maxCompletionTokens: 1536,
      disableThinking: true,
    },
  );
}

const cjkPattern = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const sensoryPattern = /\b(?:bright|dim|dark|glow(?:ed|ing)?|light|shadow|flash(?:ed|ing)?|spark(?:ed|ing)?|red|blue|green|silver|golden|hear(?:d|ing)?|sound(?:ed)?|voice|whisper(?:ed|ing)?|shout(?:ed|ing)?|ring|rang|echo(?:ed|ing)?|buzz(?:ed|ing)?|hum(?:med|ming)?|crack(?:ed|ing)?|rustle(?:d|ing)?|silent|silence|smell(?:ed|ing)?|scent|odor|air|smoke|dust|sweet|bitter|sour|salty|taste(?:d|ing)?|warm|hot|cold|cool|rough|smooth|soft|hard|wet|dry|sticky|sharp|heavy|light|hurt|pain|shiver(?:ed|ing)?|tremble(?:d|ing)?|heartbeat|breath)\b/i;

function normalizedEvidence(value: string) {
  return value
    .normalize("NFKC")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function evidenceLocation(text: string, quote: string) {
  return normalizedEvidence(text).indexOf(normalizedEvidence(quote));
}

function narrativeSentences(text: string) {
  return (text.match(/[^.!?]+(?:[.!?]+(?:["”’'](?=\s|$))?|$)/g) ?? [])
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

export function fragmentSentenceRatio(text: string) {
  const sentences = narrativeSentences(text);
  const eligible = sentences.filter((sentence) => {
    const wordCount = sentence.match(/[A-Za-z]+(?:['-][A-Za-z]+)*/g)?.length ?? 0;
    const quotedShortDialogue = wordCount > 0
      && wordCount <= 4
      && /^["“‘']/.test(sentence);
    return !quotedShortDialogue;
  });
  if (!eligible.length) return 0;
  const fragments = eligible.filter(
    (sentence) => {
      const wordCount = sentence.match(/[A-Za-z]+(?:['-][A-Za-z]+)*/g)?.length ?? 0;
      return wordCount > 0 && wordCount <= 4;
    },
  );
  return fragments.length / eligible.length;
}

const critiqueDimensions = ["plot", "childAppeal", "gradedLanguage", "continuity"] as const;

function critiqueAverage(critique: StoryCritique) {
  return critiqueDimensions.reduce((total, dimension) => total + critique[dimension].score, 0)
    / critiqueDimensions.length;
}

function weightedCritiqueScore(critique: StoryCritique) {
  return critique.plot.score * 0.35
    + critique.childAppeal.score * 0.3
    + critique.continuity.score * 0.2
    + critique.gradedLanguage.score * 0.15;
}

function isCritiqueBetter(candidate: StoryCritique, original: StoryCritique) {
  const averageDelta = critiqueAverage(candidate) - critiqueAverage(original);
  return averageDelta > 0.01
    || (Math.abs(averageDelta) <= 0.01
      && weightedCritiqueScore(candidate) > weightedCritiqueScore(original) + 0.01);
}

export function isBorderlineStoryCritique(
  critique: StoryCritique,
) {
  // Borderline is an absolute routing decision. Comparing it with an unusually
  // strong first episode made a 7.25 draft ineligible for the repair path that
  // exists specifically to lift it to the 7.5 publication gate.
  return semanticScoreIssues(
    critique,
    null,
    storyGenerationPolicy.review.minimumDimension,
    storyGenerationPolicy.review.borderlineAverage,
    storyGenerationPolicy.review.maximumDimensionDropFromFirst,
    storyGenerationPolicy.review.maximumAverageDropFromFirst,
  ).length === 0;
}

export function selectBestStoryCritique(critiques: StoryCritique[]) {
  if (!critiques.length) throw new Error("至少需要一份故事评审结果");
  return critiques.reduce((bestIndex, critique, index) => {
    const best = critiques[bestIndex];
    return weightedCritiqueScore(critique) > weightedCritiqueScore(best) ? index : bestIndex;
  }, 0);
}

export function selectBackboneStoryCritique(critiques: Array<StoryCritique | null>) {
  const available = critiques
    .map((critique, candidateIndex) => critique ? { critique, candidateIndex } : null)
    .filter((item): item is { critique: StoryCritique; candidateIndex: number } => Boolean(item));
  if (!available.length) throw new Error("至少需要一份可用的故事评审结果");
  return available.reduce((best, item) =>
    weightedCritiqueScore(item.critique) > weightedCritiqueScore(best.critique) ? item : best
  ).candidateIndex;
}

export function semanticQualityIssues(
  critique: StoryCritique,
  firstEpisodeBaseline?: StoryCritique | null,
) {
  return semanticScoreIssues(
    critique,
    firstEpisodeBaseline,
    storyGenerationPolicy.review.minimumDimension,
    storyGenerationPolicy.review.minimumAverage,
    storyGenerationPolicy.review.maximumDimensionDropFromFirst,
    storyGenerationPolicy.review.maximumAverageDropFromFirst,
  );
}

export function isStrictStoryCritique(
  critique: StoryCritique,
  firstEpisodeBaseline?: StoryCritique | null,
) {
  return semanticQualityIssues(critique, firstEpisodeBaseline).length === 0;
}

export function isStoryCritiqueImprovement(
  candidate: StoryCritique,
  original: StoryCritique,
  firstEpisodeBaseline?: StoryCritique | null,
) {
  return isStrictStoryCritique(candidate, firstEpisodeBaseline)
    && critiqueAverage(candidate) > critiqueAverage(original) + 0.01;
}

export function isSemanticRepairProgress(
  candidate: StoryCritique,
  original: StoryCritique,
  firstEpisodeBaseline?: StoryCritique | null,
) {
  if (critiqueDimensions.some((dimension) =>
    original[dimension].score >= storyGenerationPolicy.review.minimumDimension
    && candidate[dimension].score < storyGenerationPolicy.review.minimumDimension
  )) return false;
  const candidateIssues = semanticQualityIssues(candidate, firstEpisodeBaseline);
  const originalIssues = semanticQualityIssues(original, firstEpisodeBaseline);
  if (!candidateIssues.length) return true;
  if (candidateIssues.length !== originalIssues.length) {
    return candidateIssues.length < originalIssues.length;
  }
  const candidateMinimum = Math.min(...critiqueDimensions.map((dimension) => candidate[dimension].score));
  const originalMinimum = Math.min(...critiqueDimensions.map((dimension) => original[dimension].score));
  if (candidateMinimum !== originalMinimum) return candidateMinimum > originalMinimum;
  return critiqueAverage(candidate) > critiqueAverage(original) + 0.01;
}

function hasEditorialOpportunities(critique: StoryCritique) {
  return critiqueDimensions.some((dimension) => critique[dimension].issues.length > 0);
}

function semanticPublishIssues(
  critique: StoryCritique,
  firstEpisodeBaseline?: StoryCritique | null,
) {
  return semanticScoreIssues(
    critique,
    firstEpisodeBaseline,
    storyGenerationPolicy.review.minimumDimension,
    storyGenerationPolicy.review.minimumAverage,
    storyGenerationPolicy.review.maximumDimensionDropFromFirst,
    1,
  );
}

function semanticScoreIssues(
  critique: StoryCritique,
  firstEpisodeBaseline: StoryCritique | null | undefined,
  minimumScore: number,
  minimumAverageScore: number,
  maximumDimensionDrop: number,
  maximumAverageDrop: number,
) {
  const labels: Record<(typeof critiqueDimensions)[number], string> = {
    plot: "剧情逻辑",
    childAppeal: "儿童吸引力",
    gradedLanguage: "分级英语",
    continuity: "连续性",
  };
  const issues: string[] = [];
  for (const dimension of critiqueDimensions) {
    const current = critique[dimension].score;
    if (current < minimumScore) {
      issues.push(`${labels[dimension]} ${current.toFixed(1)} < ${minimumScore}`);
    }
    const baseline = firstEpisodeBaseline?.[dimension].score;
    if (baseline !== undefined && current < baseline - maximumDimensionDrop) {
      issues.push(`${labels[dimension]}比第一集低 ${(baseline - current).toFixed(1)} 分`);
    }
  }
  const average = critiqueAverage(critique);
  if (average < minimumAverageScore) {
    issues.push(`四维平均分 ${average.toFixed(1)} < ${minimumAverageScore}`);
  }
  if (
    firstEpisodeBaseline
    && critiqueAverage(critique) < critiqueAverage(firstEpisodeBaseline) - maximumAverageDrop
  ) {
    issues.push(
      `四维平均分比第一集低 ${(critiqueAverage(firstEpisodeBaseline) - critiqueAverage(critique)).toFixed(1)} 分`,
    );
  }
  return issues;
}

function narrativeWords(value: string) {
  return (value.toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) ?? [])
    .filter((word) => !new Set([
      "a", "an", "the", "and", "or", "but", "to", "of", "in", "on", "at", "for", "with",
      "is", "was", "were", "are", "be", "been", "it", "he", "she", "they", "his", "her", "their",
    ]).has(word));
}

const alwaysFamiliarLexicalWords = new Set([
  "a", "an", "the", "and", "or", "but", "so", "because", "to", "of", "in", "on", "at", "for", "from", "with",
  "is", "am", "are", "was", "were", "be", "been", "being", "do", "does", "did", "have", "has", "had",
  "i", "you", "he", "she", "it", "we", "they", "me", "him", "her", "us", "them", "my", "your", "his", "its", "our", "their",
  "this", "that", "these", "those", "who", "what", "when", "where", "why", "how", "not", "no", "yes",
]);

export function normalizeLexicalToken(value: string) {
  return value
    .toLowerCase()
    .replace(/^'+|'+$/g, "")
    .replace(/(?:'s|’s)$/, "");
}

export function measureNarrativeVocabulary(
  paragraphs: string[], headwords: number,
  lexical: { lookup: LexicalRankLookup; isFamiliar?: LexicalFamiliarityLookup; allowedWords?: string[] },
) {
  const words = paragraphs.join(" ").match(/[A-Za-z]+(?:['-][A-Za-z]+)*/g) ?? [];
  const allowed = new Set((lexical.allowedWords ?? []).map(normalizeLexicalToken));
  const counts = new Map<string, number>();
  for (const word of words) {
    const normalized = normalizeLexicalToken(word);
    const rank = lexical.lookup(normalized);
    if (alwaysFamiliarLexicalWords.has(normalized) || allowed.has(normalized)
      || lexical.isFamiliar?.(normalized) || (rank !== null && rank <= headwords * 3)) continue;
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
  }
  return {
    wordCount: words.length,
    lexicalCoverage: words.length ? Number((1 - [...counts.values()].reduce((a, b) => a + b, 0) / words.length).toFixed(3)) : null,
    unfamiliarWords: [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 12).map(([word]) => word),
  };
}

function draftVocabulary(options: StoryRunOptions, plan: SeriesPlan, narrative: { paragraphs: string[] }) {
  const dictionary = openEcdict(options.ecdictPath);
  if (!dictionary) return { wordCount: narrativeWordCount(narrative), lexicalCoverage: null, unfamiliarWords: [] as string[] };
  try {
    const profile = resolveReaderProfile(options);
    return measureNarrativeVocabulary(narrative.paragraphs, profile.headwords, {
      lookup: (word) => dictionary.frequencyRank(word),
      isFamiliar: (word) => dictionary.hasVocabularyTag(word, examVocabularyTags(options.examId, profile.id)),
      allowedWords: lexicalAllowedWords(plan),
    });
  } finally { dictionary.close(); }
}

export function candidateVocabularyIsReviewable(
  quality: { lexicalCoverage: number | null; wordCount: number },
  targetCoverage: number,
) {
  return lexicalFloorPassed(quality, targetCoverage)
    || quality.lexicalCoverage !== null
      && quality.lexicalCoverage >= Math.max(0.8, Math.min(targetCoverage, 0.9) - 0.05);
}

function vocabularyWritingGuide(options: StoryRunOptions) {
  const dictionary = openEcdict(options.ecdictPath);
  if (!dictionary) return "";
  try {
    const profile = resolveReaderProfile(options);
    const bank = dictionary.familiarWordBank(profile.headwords * 3, examVocabularyTags(options.examId, profile.id));
    return `\n当前程序已确认的熟词参考表（不是必须全部使用的词；优先使用这些词及其正确屈折形式）：${bank.join(", ")}\n`
      + "用这个词表表达动作与物件，不要只是把难词换成另一个同样超纲的近义词。允许自然的简单短语解释；保留剧情，不要堆砌词表。";
  } finally { dictionary.close(); }
}

function wordSimilarity(left: string, right: string) {
  const leftWords = new Set(narrativeWords(left));
  const rightWords = new Set(narrativeWords(right));
  if (leftWords.size < 5 || rightWords.size < 5) return 0;
  const shared = [...leftWords].filter((word) => rightWords.has(word)).length;
  return shared / Math.min(leftWords.size, rightWords.size);
}

export function repeatedNarrativeIssues(
  episode: GeneratedStoryContent | GeneratedStoryEpisode,
  previousEpisode?: GeneratedStoryEpisode | null,
) {
  if (!previousEpisode) return [];
  const issues: string[] = [];
  for (const [paragraphIndex, paragraph] of episode.paragraphs.entries()) {
    const sentences = paragraph.split(/(?<=[.!?])\s+/).filter(Boolean);
    for (const sentence of sentences) {
      const repeated = previousEpisode.paragraphs
        .flatMap((previous) => previous.split(/(?<=[.!?])\s+/).filter(Boolean))
        .find((previous) => wordSimilarity(sentence, previous) >= 0.82);
      if (repeated) {
        issues.push(`第 ${paragraphIndex + 1} 段近似重复上一集句子：${sentence.slice(0, 80)}`);
        break;
      }
    }
  }
  return issues.slice(0, 3);
}

export function assessStoryQuality(
  episode: GeneratedStoryContent | GeneratedStoryEpisode,
  options: Pick<StoryRunOptions, "examId" | "readerStage"> & Partial<Pick<StoryRunOptions, "minLexicalCoverage">>,
  episodeNumber: number,
  lexical?: {
    lookup: LexicalRankLookup;
    isFamiliar?: LexicalFamiliarityLookup;
    allowedWords?: string[];
  },
  plan?: SeriesPlan,
  previousEpisode?: GeneratedStoryEpisode | null,
): StoryQuality {
  const level = examGuide[options.examId];
  const readerProfile = resolveReaderProfile(options);
  const { targetRange: range, publishRange } = storyWordLimits(options, episodeNumber);
  const text = episode.paragraphs.join(" ");
  const questions = "questions" in episode ? episode.questions : null;
  const words = text.match(/[A-Za-z]+(?:['-][A-Za-z]+)*/g) ?? [];
  const sentences = narrativeSentences(text);
  const averageSentenceWords = sentences.length ? words.length / sentences.length : words.length;
  const longestSentenceWords = Math.max(
    0,
    ...sentences.map((sentence) => sentence.match(/[A-Za-z]+(?:['-][A-Za-z]+)*/g)?.length ?? 0),
  );
  const issues: string[] = [];
  const blockingIssues: string[] = [];
  const issueDetails: StoryIssue[] = [];
  const blockingIssueDetails: StoryIssue[] = [];
  const block = (
    code: string,
    domain: StoryIssue["domain"],
    message: string,
    field?: string,
    evidence?: string,
  ) => {
    const detail = storyIssueSchema.parse({ code, domain, message, field, evidence });
    issues.push(message);
    blockingIssues.push(message);
    issueDetails.push(detail);
    blockingIssueDetails.push(detail);
  };
  let lexicalCoverage: number | null = null;
  let unfamiliarWords: string[] = [];
  if (words.length < range[0]) block("NARRATIVE_TOO_SHORT", "narrative", `正文过短：${words.length} < ${range[0]}`, "paragraphs");
  if (words.length > range[1]) {
    const issue = words.length > publishRange[1]
      ? `正文过长：${words.length} > 发布硬上限 ${publishRange[1]}`
      : `正文略超 ${range[1]} 词目标：${words.length} 词，仍在 ${publishRange[1]} 词发布上限内`;
    if (words.length > publishRange[1]) block("NARRATIVE_TOO_LONG", "narrative", issue, "paragraphs");
    else issues.push(issue);
  }
  const languageLimits = readingDifficulty(readerProfile.id);
  if (averageSentenceWords > Math.min(level.maxSentenceWords, languageLimits.averageSentenceWords) + 2) block("LANGUAGE_AVERAGE_SENTENCE_TOO_LONG", "language", `平均句长过高：${averageSentenceWords.toFixed(1)}`, "paragraphs");
  const sentenceMaximum = Math.min(level.maxSentenceWords + 6, languageLimits.maximumSentenceWords);
  if (longestSentenceWords > sentenceMaximum) {
    block("LANGUAGE_SENTENCE_TOO_LONG", "language", `最长句过长：${longestSentenceWords} > ${sentenceMaximum}`, "paragraphs");
  }
  const fragmentRatio = fragmentSentenceRatio(text);
  if (fragmentRatio > 0.3) block("LANGUAGE_FRAGMENTED", "language", `碎片化短句过多：${(fragmentRatio * 100).toFixed(0)}% 的句子不超过 4 词`, "paragraphs");
  if (!/[“”"']/.test(text)) block("NARRATIVE_DIALOGUE_MISSING", "narrative", "缺少自然对话或人物声音", "paragraphs");
  // Whether cooperation truly changes the outcome is semantic, not lexical.
  // A keyword gate rejects valid prose such as “Brin held the door while Korr
  // pulled Aelith through”. Keep this as an editorial signal and let the
  // independent four-dimension review enforce the actual teamwork contract.
  if (!/(together|friend|team|shared|helped|agreed|asked|while|handed|held|pulled|pushed|warned|caught|joined|side by side)/i.test(text)) {
    issues.push("自动词面检查未确认伙伴协作；由独立语义评审核验合作是否真正改变结果");
  }
  const englishOnlyFields = [
    episode.title,
    ...episode.paragraphs,
    episode.qualityEvidence.idiomaticPhrase,
    episode.qualityEvidence.sensoryQuote,
    ...episode.qualityEvidence.causalLinks.flatMap((link) => [link.causeQuote, link.effectQuote]),
    ...episode.qualityEvidence.clueEvidence.map((clue) => clue.evidenceQuote),
    episode.qualityEvidence.progression.obstacleQuote,
    episode.qualityEvidence.progression.choiceQuote,
    episode.qualityEvidence.progression.consequenceQuote,
    episode.qualityEvidence.progression.newInformationQuote,
    ...(questions?.flatMap((question) => [question.prompt, ...question.options, question.evidenceQuote]) ?? []),
  ];
  if (englishOnlyFields.some((field) => cjkPattern.test(field))) {
    block("LANGUAGE_MIXED_SCRIPT", "language", "英文正文、题目或证据中夹杂中文或其他中日韩文字");
  }
  if (episode.targetWords.length < 4 || episode.targetWords.length > readerProfile.maxNewWords) {
    block("METADATA_TARGET_WORD_COUNT", "metadata", `目标词数量应为 4-${readerProfile.maxNewWords} 个`, "targetWords");
  }
  const missingTargetWords = episode.targetWords.filter(
    (word) => !new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text),
  );
  if (missingTargetWords.length) block("METADATA_TARGET_WORD_MISSING", "metadata", `目标词未出现在正文：${missingTargetWords.join(", ")}`, "targetWords", missingTargetWords.join(", "));
  if (questions?.some((question) => question.options.length !== 4 || question.answer > 3)) block("QUESTION_OPTIONS_INVALID", "questions", "题目选项或答案索引不合法", "questions");

  const idiomaticPhraseWords = episode.qualityEvidence.idiomaticPhrase.match(/[A-Za-z]+(?:['-][A-Za-z]+)*/g) ?? [];
  if (idiomaticPhraseWords.length < 2 || evidenceLocation(text, episode.qualityEvidence.idiomaticPhrase) < 0) {
    block("METADATA_IDIOM_EVIDENCE_INVALID", "metadata", "地道英语表达未逐字出现在正文，或表达过短", "qualityEvidence.idiomaticPhrase");
  }
  if (evidenceLocation(text, episode.qualityEvidence.sensoryQuote) < 0) {
    block("METADATA_SENSORY_EVIDENCE_INVALID", "metadata", "五感描写证据未逐字出现在正文", "qualityEvidence.sensoryQuote");
  } else if (!sensoryPattern.test(episode.qualityEvidence.sensoryQuote)) {
    issues.push("感官引用已定位；词面未确认感官类型，由独立语义评审与连读审查判断，不据关键词否决正文");
  }
  if (episode.qualityEvidence.causalLinks.length < 2) {
    block("METADATA_CAUSAL_EVIDENCE_INSUFFICIENT", "metadata", "因果证据不足：至少需要 2 组正文内可定位的原因与结果", "qualityEvidence.causalLinks");
  }
  for (const [index, link] of episode.qualityEvidence.causalLinks.entries()) {
    const causeLocation = evidenceLocation(text, link.causeQuote);
    const effectLocation = evidenceLocation(text, link.effectQuote);
    if (causeLocation < 0 || effectLocation < 0) {
      block("METADATA_CAUSAL_EVIDENCE_INVALID", "metadata", `第 ${index + 1} 组因果证据未逐字出现在正文`, `qualityEvidence.causalLinks.${index}`);
    } else if (causeLocation >= effectLocation) {
      block("METADATA_CAUSAL_ORDER_INVALID", "metadata", `第 ${index + 1} 组因果顺序不清：原因必须先于结果出现`, `qualityEvidence.causalLinks.${index}`);
    }
  }
  for (const clue of episode.qualityEvidence.clueEvidence) {
    if (evidenceLocation(text, clue.evidenceQuote) < 0) {
      block("METADATA_CLUE_EVIDENCE_INVALID", "metadata", `线索 ${clue.clueId} 的 ${clue.action} 证据未逐字出现在正文`, "qualityEvidence.clueEvidence", clue.clueId);
    }
  }
  const progression = episode.qualityEvidence.progression;
  const obstacleLocation = evidenceLocation(text, progression.obstacleQuote);
  const choiceLocation = evidenceLocation(text, progression.choiceQuote);
  const consequenceLocation = evidenceLocation(text, progression.consequenceQuote);
  const newInformationLocation = evidenceLocation(text, progression.newInformationQuote);
  if ([obstacleLocation, choiceLocation, consequenceLocation, newInformationLocation].some((location) => location < 0)) {
    block("METADATA_PROGRESSION_EVIDENCE_INVALID", "metadata", "本集阻碍、选择、后果或新信息的推进证据未逐字出现在正文", "qualityEvidence.progression");
  } else if (!(obstacleLocation < choiceLocation && choiceLocation < consequenceLocation)) {
    block("METADATA_PROGRESSION_ORDER_INVALID", "metadata", "本集推进顺序不清：阻碍必须先于角色选择，角色选择必须先于实际后果", "qualityEvidence.progression");
  }
  if (new Set([
    progression.obstacleQuote,
    progression.choiceQuote,
    progression.consequenceQuote,
    progression.newInformationQuote,
  ].map(normalizedEvidence)).size < 4) {
    block("METADATA_PROGRESSION_DUPLICATE", "metadata", "本集阻碍、选择、后果和新信息不能复用同一段证据", "qualityEvidence.progression");
  }
  for (const issue of repeatedNarrativeIssues(episode, previousEpisode)) block("NARRATIVE_REPEATED_CONTENT", "narrative", issue, "paragraphs");
  if (plan) {
    for (const evidence of episode.qualityEvidence.clueEvidence) {
      const plannedClue = plan.clueLedger.find((clue) => clue.id === evidence.clueId);
      const expectedEpisode = plannedClue
        ? evidence.action === "plant"
          ? plannedClue.introducedIn
          : evidence.action === "use"
            ? plannedClue.usedIn
            : plannedClue.payoffIn
        : null;
      if (!plannedClue) {
        block("METADATA_CLUE_UNKNOWN", "metadata", `线索证据引用了季纲中不存在的 ${evidence.clueId}`, "qualityEvidence.clueEvidence", evidence.clueId);
      } else if (expectedEpisode !== episodeNumber) {
        block("METADATA_CLUE_EPISODE_MISMATCH", "metadata", `线索 ${evidence.clueId} 的 ${evidence.action} 应发生在第 ${expectedEpisode} 集，而不是第 ${episodeNumber} 集`, "qualityEvidence.clueEvidence", evidence.clueId);
      }
    }
    const requiredClueActions = requiredEpisodeClueActions(plan, episodeNumber);
    for (const required of requiredClueActions) {
      if (!episode.qualityEvidence.clueEvidence.some(
        (clue) => clue.clueId === required.clueId && clue.action === required.action,
      )) {
        block("METADATA_CLUE_REQUIRED_MISSING", "metadata", `线索 ${required.clueId} 缺少 ${required.action} 原文证据`, "qualityEvidence.clueEvidence", required.clueId);
      }
    }
  }
  if (questions) {
    const questionSkills = new Set(questions.map((question) => question.skill));
    if (!questionSkills.has("detail")) block("QUESTION_DETAIL_MISSING", "questions", "题目缺少一道人物、动作或线索细节题", "questions");
    if (!questionSkills.has("inference") && !questionSkills.has("cause_effect")) {
      block("QUESTION_INFERENCE_MISSING", "questions", "题目缺少一道有原文依据的推断或因果题", "questions");
    }
    for (const [index, question] of questions.entries()) {
      if (evidenceLocation(text, question.evidenceQuote) < 0) {
        block("QUESTION_EVIDENCE_INVALID", "questions", `第 ${index + 1} 题的原文证据不存在于正文`, `questions.${index}.evidenceQuote`);
      }
      if ((question.evidenceQuote.match(/[A-Za-z]+(?:['-][A-Za-z]+)*/g) ?? []).length < 3) {
        block("QUESTION_EVIDENCE_TOO_SHORT", "questions", `第 ${index + 1} 题的原文证据过短，无法支撑答案`, `questions.${index}.evidenceQuote`);
      }
      if (question.options.some((option) => /^\s*[A-D][).:：]\s*/i.test(option))) {
        block("QUESTION_OPTION_LABEL_DUPLICATED", "questions", `第 ${index + 1} 题选项不应重复包含 A/B/C/D 编号`, `questions.${index}.options`);
      }
      if (new Set(question.options.map((option) => normalizedEvidence(option))).size !== question.options.length) {
        block("QUESTION_OPTIONS_DUPLICATED", "questions", `第 ${index + 1} 题包含重复选项`, `questions.${index}.options`);
      }
    }
  }
  if (lexical && words.length) {
    const measured = measureNarrativeVocabulary(episode.paragraphs, readerProfile.headwords, lexical);
    lexicalCoverage = measured.lexicalCoverage;
    unfamiliarWords = measured.unfamiliarWords;
    const minimum = options.minLexicalCoverage ?? 0.95;
    if (lexicalCoverage !== null && lexicalCoverage < minimum) {
      issues.push(
        `高频词覆盖率不足：${(lexicalCoverage * 100).toFixed(1)}% < ${(minimum * 100).toFixed(0)}%；优先简化 ${unfamiliarWords.slice(0, 8).join(", ")}`,
      );
      issueDetails.push(storyIssueSchema.parse({
        code: "LEXICAL_COVERAGE_LOW",
        domain: "lexical",
        field: "paragraphs",
        message: issues.at(-1)!,
        evidence: unfamiliarWords.slice(0, 8).join(", ") || undefined,
      }));
    }
  }
  return {
    score: Math.max(0, 100 - issues.length * 12),
    wordCount: words.length,
    averageSentenceWords: Number(averageSentenceWords.toFixed(1)),
    lexicalCoverage: lexicalCoverage === null ? null : Number(lexicalCoverage.toFixed(3)),
    unfamiliarWords,
    issues,
    blockingIssues,
    issueDetails,
    blockingIssueDetails,
  };
}

export function validateSeriesPlan(plan: SeriesPlan, expectedEpisodes: number) {
  if (plan.episodes.length !== expectedEpisodes) {
    throw new Error(`故事策划返回 ${plan.episodes.length} 集，预期 ${expectedEpisodes} 集`);
  }
  const episodeNumbers = plan.episodes.map((episode) => episode.number);
  const expectedNumbers = Array.from({ length: expectedEpisodes }, (_, index) => index + 1);
  if (episodeNumbers.some((number, index) => number !== expectedNumbers[index])) {
    throw new Error(`故事集数必须从 1 连续编号，实际为 ${episodeNumbers.join(", ")}`);
  }
  const normalizedMissions = plan.episodes.map((episode) => normalizedEvidence(episode.episodeMission));
  if (new Set(normalizedMissions).size !== normalizedMissions.length) {
    throw new Error("每集必须有不同且不可替代的 episodeMission");
  }
  for (const [index, episode] of plan.episodes.entries()) {
    if (index > 0 && !episode.mustNotRepeat.length) {
      throw new Error(`第 ${episode.number} 集必须声明不得重复的既有信息`);
    }
    if (episode.newInformation.some((item) => episode.mustNotRepeat.some(
      (previous) => normalizedEvidence(item) === normalizedEvidence(previous),
    ))) {
      throw new Error(`第 ${episode.number} 集的新信息与 mustNotRepeat 冲突`);
    }
  }
  const clueIds = new Set<string>();
  for (const clue of plan.clueLedger) {
    if (clueIds.has(clue.id)) throw new Error(`线索编号重复：${clue.id}`);
    clueIds.add(clue.id);
    if (clue.introducedIn > clue.usedIn || clue.usedIn > clue.payoffIn) {
      throw new Error(`线索 ${clue.id} 的埋设、使用、回收顺序不合法`);
    }
    if (clue.payoffIn > expectedEpisodes) {
      throw new Error(`线索 ${clue.id} 在系列结束后才回收`);
    }
  }
  if (!plan.clueLedger.some((clue) => clue.introducedIn < clue.payoffIn)) {
    throw new Error("至少一条主线伏笔必须在前一集埋下，并在后续集回收解释");
  }
  for (const episodeNumber of expectedNumbers) {
    if (!plan.clueLedger.some(
      (clue) => [clue.introducedIn, clue.usedIn, clue.payoffIn].includes(episodeNumber),
    )) {
      throw new Error(`第 ${episodeNumber} 集没有对应的线索埋设、使用或回收动作`);
    }
  }
  return plan;
}

export function loadStoryEngagementBrief(
  databasePath: string,
  interest: string,
  examId: ExamId,
) {
  if (!existsSync(databasePath)) return "暂无历史阅读反馈，按栏目承诺和读者档位创作。";
  const db = createDatabase(databasePath);
  try {
    const row = db.prepare(
      `SELECT
         (SELECT COUNT(*) FROM daily_choices c JOIN articles a ON a.id = c.article_id
          WHERE a.interest_id = ? AND a.exam_id = ?) AS selected,
         (SELECT COUNT(*) FROM article_progress p JOIN articles a ON a.id = p.article_id
          WHERE a.interest_id = ? AND a.exam_id = ?) AS completed,
         (SELECT AVG(CASE WHEN p.total > 0 THEN p.score * 1.0 / p.total END)
          FROM article_progress p JOIN articles a ON a.id = p.article_id
          WHERE a.interest_id = ? AND a.exam_id = ?) AS quizAccuracy,
         (SELECT AVG(s.ratio) FROM article_reading_states s JOIN articles a ON a.id = s.article_id
          WHERE a.interest_id = ? AND a.exam_id = ?) AS readingRatio,
         (SELECT AVG(s.reading_seconds) FROM article_reading_states s JOIN articles a ON a.id = s.article_id
          WHERE a.interest_id = ? AND a.exam_id = ?) AS readingSeconds,
         (SELECT COUNT(*) FROM vocabulary v JOIN articles a ON a.id = v.article_id
          WHERE a.interest_id = ? AND a.exam_id = ?) AS savedWords,
         (SELECT AVG(CASE WHEN EXISTS (
             SELECT 1 FROM articles next
             JOIN article_progress next_progress ON next_progress.article_id = next.id AND next_progress.user_id = p.user_id
             WHERE next.series_title = a.series_title AND next.episode_number = a.episode_number + 1
           ) THEN 1.0 ELSE 0.0 END)
          FROM article_progress p JOIN articles a ON a.id = p.article_id
          WHERE a.interest_id = ? AND a.exam_id = ? AND a.series_title IS NOT NULL) AS continuationRate`,
    ).get(
      interest, examId, interest, examId, interest, examId, interest, examId,
      interest, examId, interest, examId, interest, examId,
    ) as {
      selected: number;
      completed: number;
      quizAccuracy: number | null;
      readingRatio: number | null;
      readingSeconds: number | null;
      savedWords: number;
      continuationRate: number | null;
    };
    if (!row.selected && !row.completed) return "暂无历史阅读反馈，按栏目承诺和读者档位创作。";
    const percent = (value: number | null) => value === null ? "暂无" : `${(value * 100).toFixed(0)}%`;
    return `本栏目已有聚合反馈：被选择 ${row.selected} 次，完成 ${row.completed} 次，平均阅读进度 ${percent(row.readingRatio)}，答题正确率 ${percent(row.quizAccuracy)}，下一集续读率 ${percent(row.continuationRate)}，平均阅读 ${Math.round(row.readingSeconds ?? 0)} 秒，收藏生词 ${row.savedWords} 次。策划时保留有效的吸引点；若续读率或阅读进度偏低，强化前两句钩子、中段选择与结尾悬念；若正确率偏低或生词过多，降低信息密度和词汇难度。不要在故事中提及这些统计。`;
  } finally {
    db.close();
  }
}

async function approveNarrativeSpine(options: StoryRunOptions, initial: z.infer<typeof seasonSpineSchema>) {
  let spine = initial;
  for (let attempt = 0; attempt < 2; attempt++) {
    const review = await callStructured(options, spineFeasibilitySchema,
      feasibilityReviewInstructions,
      `审查对象是中文主线，不是英文成文。目标档位：${resolveReaderProfile(options).label} / ${resolveReaderProfile(options).cefr}；仅判断概念能否用简单英语表达。\n完整故事：${JSON.stringify(spine)}\n已发布正文及修改边界：${options.planningContext ?? "尚无已发布正文"}`,
      options.reviewModel || options.model, options.reviewTemperature,
      { ...semanticPlanningModelPolicy(options), networkRetries: 1, structureRetries: 2, maxCompletionTokens: 2048 });
    options.planningHistory = rememberPlanReview(options.planningHistory ?? [], spine, review);
    options.onPlanningHistory?.(options.planningHistory);
    if (spineIsFeasible(review)) {
      options.log("整季主线已通过独立因果与分级表达可行性检查，允许进入分集策划。");
      return spine;
    }
    options.log(`整季主线存在阻断问题：${review.blockingIssues.join("；")}；待验证的修改建议：${review.simplification}`);
    if (attempt === 1) throw new StoryGenerationFailure("整季主线经一次简化仍不具备因果或语言可行性，未生成分集正文", "PLAN_FEASIBILITY_GATE", "narrative", "new_candidates");
    spine = await callStructured(options, seasonSpineSchema,
      "你是分级故事策划编辑。修改完整主线的设计，不是压缩摘要。只返回 JSON。",
      `${gradedReadingBrief(options)}${vocabularyWritingGuide(options)}\n原主线：${JSON.stringify(spine)}\n独立检查：${JSON.stringify(review)}\n修改边界：${options.planningContext ?? "尚无已发布正文"}\n只返回 wholeStory、hiddenCause、resolutionMechanism。只解决 blockingIssues，suggestions 不要求全部执行。simplification 只是待验证假设，发现建议引入错误因果就不用它，选择更小且成立的修改。保留合理拟人、情感动机和已有正确剧情，不强改成物理解谜。清楚说明为什么发生、为何解决，禁止靠删掉因果过关。`,
      options.reviewModel || options.model, options.reviewTemperature,
      { ...semanticPlanningModelPolicy(options), networkRetries: 1, structureRetries: 2, maxCompletionTokens: 3072 });
  }
  throw new Error("主线可行性检查未完成");
}

async function verifySplitPlanFeasibility(options: StoryRunOptions, plan: SeriesPlan) {
  const review = await callStructured(options, spineFeasibilitySchema, feasibilityReviewInstructions,
    `中文季纲，非英文正文。目标档位 ${resolveReaderProfile(options).label} / ${resolveReaderProfile(options).cefr}。请检查拆集是否仍符合主线，是否增加了不可替代的复杂机制或不成立的解法；不要检查中文句长或假想英文难词。\n季纲：${JSON.stringify(plan)}\n已发布事实边界：${options.planningContext ?? "尚无"}`,
    options.reviewModel || options.model, options.reviewTemperature,
    { ...semanticPlanningModelPolicy(options), networkRetries: 1, structureRetries: 2, maxCompletionTokens: 2048 });
  if (plan.narrativeSpine) {
    options.planningHistory = rememberPlanReview(options.planningHistory ?? [], plan.narrativeSpine, review);
    options.onPlanningHistory?.(options.planningHistory);
  }
  if (!spineIsFeasible(review)) throw new StoryGenerationFailure(`分集季纲存在阻断问题：${review.blockingIssues.join("；")}；${review.simplification}`, "PLAN_FEASIBILITY_GATE", "narrative", "new_candidates");
}

async function generatePlan(options: StoryRunOptions, engagementBrief: string) {
  const basePrompt = `${buildSeriesPlanPrompt(options)}\n\n真实使用反馈（仅供策划）：${engagementBrief}\n${options.planningContext ?? ""}\n${planningFailureBrief(options.planningHistory ?? [])}`;
  reportProgress(
    options,
    "planning",
    `正在生成 ${options.planCandidates} 套候选故事方案`,
    4,
  );
  options.log(`正在并行生成 ${options.planCandidates} 套候选季纲…`);
  const candidateResults = await Promise.allSettled(
    Array.from({ length: options.planCandidates }, async (_, index) => {
      const initialSpine = await callStructured(options, seasonSpineSchema,
        "先把一个完整故事讲通，再拆集。只返回 JSON，不输出章节列表。",
        `${basePrompt}${vocabularyWritingGuide(options)}\n先不生成季纲字段。只返回 wholeStory、hiddenCause、resolutionMechanism 三个中文字符串。wholeStory 连贯讲清人物想要什么、为何遇阻、选择造成什么后果、伙伴如何合作解决；hiddenCause 说明异常真正原因；resolutionMechanism 说明如何验证原因并实际解决。不要把物件同时出现当因果，不使用终集才发明的规则。避免罗列事件，所有支线围绕一个主目标。必须能用该档位简单英语表达，避免专业零件、材料属性和多层传导机制。`,
        options.reviewModel || options.model, options.reviewTemperature,
        { ...semanticPlanningModelPolicy(options), maxCompletionTokens: 3072 });
      const spine = await approveNarrativeSpine(options, initialSpine);
      const value = await callStructured(
        options,
        generatedPlanSchema(options),
        "你只输出合法 JSON。你擅长原创、连续、适龄、可读性高的儿童英语冒险故事策划。",
        `${basePrompt}\n先前已经讲通的完整故事：${JSON.stringify(spine)}\n将它拆成 ${options.episodes} 集，不要逐集重新发明谜题或改换原因。每集末尾的眼前危险/疑问必须由下一集开头接住；终集验证并解决 hiddenCause。\n这是候选方案 ${index + 1}/${options.planCandidates}。严格控制人物与线索容量；少而深优先于多而杂。`,
        options.model,
        options.temperature,
        { maxCompletionTokens: modelTokenBudgets.plan, disableThinking: true },
      );
      const candidate = validateSeriesPlan({ ...value, narrativeSpine: spine }, options.episodes);
      await verifySplitPlanFeasibility(options, candidate);
      return candidate;
    }),
  );
  const candidates = candidateResults.flatMap((result, index) => {
    if (result.status === "fulfilled") return [result.value];
    options.log(
      `候选季纲 ${index + 1}/${options.planCandidates} 在本地归一化和结构恢复后仍不可用，`
      + `已隔离该方案并继续使用其他候选：${modelRequestError(result.reason)}`,
    );
    return [];
  });
  if (!candidates.length) {
    const feasibilityFailure = candidateResults.find((result) => result.status === "rejected" && result.reason instanceof StoryGenerationFailure);
    if (feasibilityFailure?.status === "rejected") throw feasibilityFailure.reason;
    throw new Error("所有候选季纲均不可用；模型未能提供至少一套完整故事方案");
  }
  const logCapacityNormalization = (plan: SeriesPlan) => {
    for (const adjustment of seriesPlanClueCapacityAdjustments(plan)) {
      const describe = (action: EpisodeClueAction) => `${action.clueId}:${action.action}`;
      options.log(
        `季纲第 ${adjustment.episodeNumber} 集线索容量已自动归一化：核心动作 `
        + `${adjustment.primary.map(describe).join(", ")}；辅助线索 `
        + `${adjustment.supporting.map(describe).join(", ")} 不再作为正文硬任务。`,
      );
    }
  };
  if (candidates.length === 1) {
    options.log("仅有 1 套候选季纲通过完整性校验，直接采用；不再要求模型重写巨型季纲 JSON。");
    logCapacityNormalization(candidates[0]);
    return candidates[0];
  }
  reportProgress(options, "selecting_plan", "候选方案已完成，正在选择最终故事主线", 14);
  try {
    const selection = await callStructured(
      options,
      planSelectionSchema,
      "你只输出合法 JSON。你是儿童分级连续故事总编，只负责从已通过结构校验的候选方案中选出最强的一套，不重写季纲。",
      `以下是 ${candidates.length} 套已通过完整性校验的候选季纲：\n${JSON.stringify(candidates)}\n\n比较开篇吸引力、整季因果链、角色成长、线索公平性、笑点潜力和连续追读欲。角色或线索越多不代表越好，优先选择少而深、在目标篇幅内能清楚讲完的一套；Starter 只降低英语难度，不能写成低龄幼儿题材。任何一集若把“看到、听到、找到线索”本身当作 choice 的 consequence，而没有具体麻烦、代价、计划失败或关系摩擦，则该方案必须降级，不能因线索数量多而获选。只返回 {"selectedCandidate":1,"rationale":"选择理由"}，selectedCandidate 使用从 1 开始的候选编号。`,
      options.reviewModel || options.model,
      options.reviewTemperature,
      {
        maxCompletionTokens: modelTokenBudgets.questions,
        networkRetries: 1,
        structureRetries: 2,
        disableThinking: true,
      },
    );
    const selected = candidates[Math.min(selection.selectedCandidate, candidates.length) - 1] ?? candidates[0];
    options.log(
      `总编选择候选季纲 ${Math.min(selection.selectedCandidate, candidates.length)}/${candidates.length}：`
      + selection.rationale,
    );
    logCapacityNormalization(selected);
    return selected;
  } catch (error) {
    options.log(
      `候选季纲的轻量选优响应不可用，已采用第一套完整候选，避免再次生成大型 JSON：${modelRequestError(error)}`,
    );
    logCapacityNormalization(candidates[0]);
    return candidates[0];
  }
}

export function narrativePreflightIssues(
  options: Pick<StoryRunOptions, "examId" | "readerStage">,
  plan: SeriesPlan,
  episodeNumber: number,
  narrative: Pick<GeneratedStoryContent, "title" | "paragraphs">,
) {
  const contract = buildEpisodeWritingContract(options, plan, episodeNumber);
  const wordCount = narrative.paragraphs.join(" ").match(/[A-Za-z]+(?:['-][A-Za-z]+)*/g)?.length ?? 0;
  const issues: string[] = [];
  if (narrative.paragraphs.length !== 4) issues.push(`正文必须恰好 4 段，实际 ${narrative.paragraphs.length} 段`);
  if (wordCount < contract.publishWordRange[0] || wordCount > contract.publishWordRange[1]) {
    issues.push(
      `正文词数 ${wordCount} 不在发布硬范围 ${contract.publishWordRange[0]}-${contract.publishWordRange[1]}`,
    );
  }
  if (cjkPattern.test(`${narrative.title} ${narrative.paragraphs.join(" ")}`)) {
    issues.push("标题或正文夹杂中文、日文或韩文");
  }
  if (!/[.!?…]["'”’)]*$/.test(narrative.paragraphs.at(-1)?.trim() ?? "")) {
    issues.push("正文结尾不完整，疑似截断；必须补齐最后一句和结尾事件，不能只补标点");
  }
  return issues;
}

function lessonsFromCritique(critique: StoryCritique, previous: string[]) {
  const labels: Record<(typeof critiqueDimensions)[number], string> = {
    plot: "剧情逻辑",
    childAppeal: "儿童吸引力",
    gradedLanguage: "分级英语",
    continuity: "连续性",
  };
  const fresh = critiqueDimensions.flatMap((dimension) =>
    critique[dimension].issues.map((issue) => `${labels[dimension]}：${issue}`),
  );
  fresh.push(...critique.rewritePriorities.map((priority) => `优先改进：${priority}`));
  return [...new Set([...previous, ...fresh])].slice(-20);
}

type EpisodeDraftDiagnostics = {
  rawWordCounts: number[];
  preflightRejected: number;
  reviewed: number;
  bestReview: StoryCritique | null;
};

function narrativeWordCount(narrative: Pick<GeneratedStoryContent, "paragraphs">) {
  return narrative.paragraphs.join(" ").match(/[A-Za-z]+(?:['-][A-Za-z]+)*/g)?.length ?? 0;
}

function recordDraftReview(diagnostics: EpisodeDraftDiagnostics, review: StoryCritique | null) {
  if (!review) return;
  diagnostics.reviewed++;
  if (!diagnostics.bestReview || isCritiqueBetter(review, diagnostics.bestReview)) {
    diagnostics.bestReview = review;
  }
}

export function episodeDraftFailureSummary(diagnostics: EpisodeDraftDiagnostics) {
  const overlong = diagnostics.rawWordCounts.length
    ? `原始候选词数 ${Math.min(...diagnostics.rawWordCounts)}-${Math.max(...diagnostics.rawWordCounts)}`
    : "没有可计数的原始候选";
  const best = diagnostics.bestReview;
  const score = best
    ? `最佳四维：剧情 ${best.plot.score.toFixed(1)}、吸引力 ${best.childAppeal.score.toFixed(1)}、`
      + `分级语言 ${best.gradedLanguage.score.toFixed(1)}、连续性 ${best.continuity.score.toFixed(1)}，`
      + `均分 ${critiqueAverage(best).toFixed(2)}`
    : "没有可用的四维评分";
  return `${overlong}；前置硬门禁淘汰 ${diagnostics.preflightRejected} 稿；已完成 ${diagnostics.reviewed} 次独立评分；${score}`;
}

async function prepareNarrativeForStrictReview(
  options: StoryRunOptions,
  plan: SeriesPlan,
  episodeNumber: number,
  previousEpisode: GeneratedStoryEpisode | null,
  narrative: z.infer<typeof episodeNarrativeSchema>,
) {
  const issues = narrativePreflightIssues(options, plan, episodeNumber, narrative);
  if (!issues.length) return narrative;
  const onlyOverlong = issues.length === 1 && issues[0].startsWith("正文词数");
  const wordCount = narrative.paragraphs.join(" ").match(/[A-Za-z]+(?:['-][A-Za-z]+)*/g)?.length ?? 0;
  const contract = buildEpisodeWritingContract(options, plan, episodeNumber);
  if (!onlyOverlong || wordCount <= contract.publishWordRange[1]) return null;

  const compressionSafetyMargin = Math.max(
    30,
    Math.round((contract.wordRange[1] - contract.wordRange[0]) * 0.3),
  );
  const compressionTargetMax = Math.max(
    contract.wordRange[0],
    contract.wordRange[1] - compressionSafetyMargin,
  );
  options.log(
    `[${episodeNumber}/${options.episodes}] 候选正文 ${wordCount} 词，仅长度越界；`
    + "在四维评审前先用无思考模式做一次定长压缩。",
  );
  let current = narrative;
  for (let contentAttempt = 1; contentAttempt <= 2; contentAttempt++) {
    try {
      const compressed = await callEpisodeNarrative(
        options,
        "你只输出 title 和 paragraphs 的合法 JSON。你是分级故事删减编辑，只能删除或缩短，不得新增、换序或重新设计剧情。",
        `四段写作合同：${JSON.stringify(contract)}\n`
          + `当前唯一可编辑正文：${JSON.stringify(current)}\n\n`
          + `压缩为恰好 4 段、目标总计 ${contract.wordRange[0]}-${compressionTargetMax} 个英文单词；`
          + `绝不能超过 ${contract.publishWordRange[1]}。逐段遵守 targetSentences、maxWordsPerSentence 和 targetWords。`
          + "优先原样保留完成 requiredEvents、requiredClueActions、人物选择、因果连接和结尾悬念的句子；"
          + "只删除 optionalIfSpace、重复解释、不改变结果的对话和装饰词。尽量复制原句，不用同义改写，不得加入原文没有的新名词、地点、物件或动作。"
          + "只返回 {\"title\":\"...\",\"paragraphs\":[\"...\",\"...\",\"...\",\"...\"]}。",
        options.structureRepairModel || options.reviewModel || options.model,
        0.1,
        {
          timeoutMs: options.timeoutMs,
          networkRetries: 1,
          structureRetries: 1,
          maxCompletionTokens: narrativeCompletionTokenBudget(contract.publishWordRange[1]),
          disableThinking: true,
        },
      );
      const compressedIssues = narrativePreflightIssues(options, plan, episodeNumber, compressed);
      if (compressedIssues.length) {
        options.log(
          `[${episodeNumber}/${options.episodes}] 第 ${contentAttempt}/2 次定长压缩内容仍不合格：${compressedIssues.join("；")}。`,
        );
        current = compressed;
        continue;
      }
      const driftIssues = compressionDriftIssues(narrative, compressed);
      if (driftIssues.length) {
        options.log(
          `[${episodeNumber}/${options.episodes}] 第 ${contentAttempt}/2 次压缩触发防改写检查：${driftIssues.join("；")}。`,
        );
        current = narrative;
        continue;
      }
      options.log(
        `[${episodeNumber}/${options.episodes}] 候选已在评审前压缩到 ${narrativeWordCount(compressed)} 词，`
        + "并通过逐段词汇保真检查。",
      );
      return compressed;
    } catch (error) {
      options.log(
        `[${episodeNumber}/${options.episodes}] 第 ${contentAttempt}/2 次定长压缩的 JSON 结构或网络请求失败：${modelRequestError(error)}`,
      );
    }
  }
  options.log(`[${episodeNumber}/${options.episodes}] 两次定长压缩均未通过内容门禁，直接淘汰该稿。`);
  return null;
}

async function rescueStrongOverlongNarrative(
  options: StoryRunOptions,
  plan: SeriesPlan,
  episodeNumber: number,
  previousEpisode: GeneratedStoryEpisode | null,
  firstCompression: z.infer<typeof episodeNarrativeSchema>,
  compressionReview: StoryCritique,
) {
  const contract = buildEpisodeWritingContract(options, plan, episodeNumber);
  const targetMax = Math.max(contract.wordRange[0], contract.wordRange[1] - 35);
  options.log(
    `[${episodeNumber}/${options.episodes}] 高分原稿仅因超长未能直通；`
    + "正在只编辑第一次短稿做最后一次保守压缩，不混入原长稿或其他候选事件。",
  );
  try {
    const rescued = await callEpisodeNarrative(
      options,
      "你只输出 title 和 paragraphs 的合法 JSON。你是保守压缩编辑：只压缩高分原稿，不融合、不新增、不改写主线。",
      `本集四段写作合同：${JSON.stringify(contract)}\n`
        + `上一集状态：${previousEpisode ? JSON.stringify(previousEpisode.storyState) : "第一集"}\n`
        + `唯一允许编辑的第一次压缩稿：${JSON.stringify(firstCompression)}\n`
        + `第一次压缩后评审：${JSON.stringify(compressionReview)}\n\n`
        + "只能修改第一次压缩稿，不能尝试恢复、猜测或补写未出现在该稿与合同中的长稿细节。以该稿的四段事件顺序为唯一事实源。"
        + "逐段保留 contract.requiredEvents 对应的目标、阻碍与选择、后果与核心新信息、不可逆变化与悬念；"
        + "保留 requiredClueActions、人物位置、关键物件归属和因果连接。只删除 optionalIfSpace、重复解释、第二个感官修饰和不推动结果的对话；"
        + "第一次压缩评审指出缺失的核心关系，必须通过替换低优先级句子恢复，不能靠增加新事件修补。"
        + `恰好 4 段，每段不得超过 ${Math.ceil(targetMax / 4)} 词，总词数 ${contract.wordRange[0]}-${targetMax}，`
        + `绝不能超过 ${contract.publishWordRange[1]}；达到上限立即停止，不写总结句。`
        + "输出前逐项核对四个 requiredEvents 仍有明确原文证据；只返回 title 和 paragraphs。",
      options.reviewModel || options.model,
      0.1,
      {
        ...semanticRewriteModelPolicy(options),
        structureRetries: 1,
        maxCompletionTokens: narrativeCompletionTokenBudget(contract.publishWordRange[1]),
      },
    );
    const hardIssues = narrativePreflightIssues(options, plan, episodeNumber, rescued);
    const driftIssues = compressionDriftIssues(firstCompression, rescued);
    if (hardIssues.length || driftIssues.length) {
      options.log(
        `[${episodeNumber}/${options.episodes}] 高分短稿保守压缩未通过：${[...hardIssues, ...driftIssues].join("；")}`,
      );
      return null;
    }
    return rescued;
  } catch (error) {
    options.log(
      `[${episodeNumber}/${options.episodes}] 高分原稿的保守压缩不可用：${modelRequestError(error)}`,
    );
    return null;
  }
}

async function synthesizeEpisodeDrafts(
  options: StoryRunOptions,
  plan: SeriesPlan,
  index: number,
  previousEpisode: GeneratedStoryEpisode | null,
  drafts: Array<z.infer<typeof episodeNarrativeSchema>>,
  draftReviews: Array<StoryCritique | null>,
  backboneCandidateIndex: number,
  editorialBaseNarrative: z.infer<typeof episodeNarrativeSchema>,
  editorialBaseReview: StoryCritique,
  synthesisAttempt: number,
  failureLessons: string[],
) {
  const episodeNumber = index + 1;
  const contract = buildEpisodeWritingContract(options, plan, episodeNumber);
  const lengthMargin = Math.max(30, Math.round((contract.wordRange[1] - contract.wordRange[0]) * 0.3));
  const preferredWordRange: [number, number] = [
    contract.wordRange[0],
    contract.wordRange[1] - lengthMargin,
  ];
  const paragraphWordRange: [number, number] = [
    Math.floor(preferredWordRange[0] / 4),
    Math.ceil(preferredWordRange[1] / 4),
  ];
  const compactLessons = selectDraftLessonsForPrompt(failureLessons);
  const lessonBrief = compactLessons.length
    ? `\n上一份融合稿未达标，必须针对性规避：${JSON.stringify(compactLessons)}`
    : "";
  const scoreBrief = draftReviews.map((review, candidateIndex) => ({
    candidateIndex,
    ...(review ? {
      plot: review.plot.score,
      childAppeal: review.childAppeal.score,
      gradedLanguage: review.gradedLanguage.score,
      continuity: review.continuity.score,
      weightedScore: Number(weightedCritiqueScore(review).toFixed(2)),
    } : { unavailable: true }),
  }));
  options.log(
    `[${episodeNumber}/${options.episodes}] 已按统一规则选定候选 ${backboneCandidateIndex + 1} 为最高分主骨架；`
    + `正在从 ${drafts.length} 份初稿提炼局部优点（本轮唯一融合 ${synthesisAttempt}/1）。`,
  );
  const synthesisPlan = await callStructured(
    options,
    draftSynthesisPlanSchema,
    "你只输出合法 JSON。你是儿童连续故事总编；全面比较多篇素材稿并制定一份精炼融合蓝图。本阶段不写正文、不输出分析过程。",
    `本集写作合同：${JSON.stringify(contract)}\n`
      + `故事圣经：${JSON.stringify(plan.storyBible)}\n`
      + `上一集状态：${previousEpisode ? JSON.stringify(previousEpisode.storyState) : "第一集"}\n`
      + `上一集正文：${previousEpisode ? JSON.stringify(previousEpisode.paragraphs) : "第一集"}\n`
      + `统一评审得分：${JSON.stringify(scoreBrief)}\n`
      + `程序锁定的最高分主骨架编号：${backboneCandidateIndex}\n`
      + `本次必须保守修改的编辑底稿：${JSON.stringify(editorialBaseNarrative)}\n`
      + `编辑底稿评分与问题：${JSON.stringify(editorialBaseReview)}\n`
      + `素材初稿：${JSON.stringify(drafts.map((draft, candidateIndex) => ({ candidateIndex, draft })))}\n`
      + `${lessonBrief}\n\n`
      + `这些初稿只是素材。backboneCandidateIndex 必须固定为 ${backboneCandidateIndex}，不得改选；`
      + "保留编辑底稿的事件顺序、人物动机、物件来源和有效句子作为唯一主骨架。其他全部初稿合计最多吸收两个不会增加新场景的局部亮点，"
      + "只能用于修复编辑底稿评分中明确指出的问题，可选更好的钩子、伙伴互动、感官细节、自然英语或悬念；"
      + "但只建立一条统一的目标→阻碍→选择→后果→新信息因果线。冲突设定、重复事件、无来源物件和较弱桥段必须写入 rejectElements。"
      + `禁止把 ${drafts.length} 篇事件全部并列塞入正文；融合蓝图必须像从一开始就只设计过一个故事。只返回融合蓝图 JSON。`,
    options.reviewModel || options.model,
    Math.max(options.reviewTemperature, 0.3),
    semanticPlanningModelPolicy(options),
  );
  const lockedSynthesisPlan = {
    ...synthesisPlan,
    backboneCandidateIndex,
    backboneLockedByProgram: true,
  };
  const synthesized = await callBudgetedEpisodeNarrative(
    options,
    plan,
    index,
    previousEpisode,
    "你只输出 title 和 paragraphs 的合法 JSON。你是儿童分级故事主编；对编辑底稿做保守增量修改，不重新拼装故事，不输出分析过程。paragraphs 必须是四个段落字符串。",
    `${episodePrompt(options, plan, index, previousEpisode, false, true)}\n\n`
      + `融合蓝图：${JSON.stringify(lockedSynthesisPlan)}\n`
      + `程序锁定的最高分主骨架编号：${backboneCandidateIndex}\n`
      + `必须保守修改并完整返回的编辑底稿：${JSON.stringify(editorialBaseNarrative)}\n`
      + `编辑底稿评分与问题：${JSON.stringify(editorialBaseReview)}\n`
      + `${lessonBrief}\n\n`
      + `修改这篇底稿：候选 ${backboneCandidateIndex} 的事件顺序仍是唯一骨架，不得重新设计主线、逐段拼接或改选骨架。`
      + "融合蓝图最多允许两个局部增强；没有被评分问题直接指出的正确句子和事件默认保留。每个段落只能服务统一因果线。"
      + "只在必要处重写衔接，使人物动机、物件来源和线索顺序一致。"
      + "先保证 requiredEvents 和因果完整，再删 optionalIfSpace、解释句和装饰细节；不要加入 rejectElements。"
      + `必须恰好 4 段，每段尽量控制在 ${paragraphWordRange[0]}-${paragraphWordRange[1]} 个英文单词，`
      + `总词数优先控制在 ${preferredWordRange[0]}-${preferredWordRange[1]}，发布硬范围是 ${contract.publishWordRange[0]}-${contract.publishWordRange[1]}，绝不能超过发布上限。`
      + "paragraphs 必须恰好包含四个段落字符串；每段内部句子数遵守对应 paragraphCard.targetSentences。只返回 title 和 paragraphs。",
    options.reviewModel || options.model,
    Math.max(options.reviewTemperature, 0.25),
    semanticRewriteModelPolicy(options),
  );
  return prepareNarrativeForStrictReview(
    options,
    plan,
    episodeNumber,
    previousEpisode,
    synthesized,
  );
}

async function generateEpisodeDraft(
  options: StoryRunOptions,
  plan: SeriesPlan,
  index: number,
  previousEpisode: GeneratedStoryEpisode | null,
  firstEpisodeBaseline: StoryCritique | null = null,
  discardedDraftLessons: string[] = [],
  strictRound = 1,
  eliteRejected: Pick<RejectedElite, "narrative" | "critique"> | null = null,
  onLessons?: (
    lessons: string[],
    elite: Pick<RejectedElite, "narrative" | "critique"> | null,
  ) => void,
  diagnostics: EpisodeDraftDiagnostics = {
    rawWordCounts: [],
    preflightRejected: 0,
    reviewed: 0,
    bestReview: null,
  },
) {
  const episodeNumber = index + 1;
  // One queue attempt owns exactly one fresh candidate batch and one fusion.
  if (eliteRejected && (narrativePreflightIssues(options, plan, episodeNumber, eliteRejected.narrative).length
    || !canReuseLexicalElite(draftVocabulary(options, plan, eliteRejected.narrative), options.minLexicalCoverage))) {
    options.log(`[${episodeNumber}/${options.episodes}] 历史精英稿未通过正文完整性或词汇门禁，已隔离，不能继续作为编辑底稿。`);
    eliteRejected = null;
    onLessons?.(discardedDraftLessons, null);
  }
  // Quality retries are persisted and budgeted by CustomStoryService; keeping
  // a second hidden batch here used to multiply one visible retry into many
  // generations and made interrupted tasks look as if they were looping.
  const maximumStrictRounds = storyEpisodeAttemptBudget.candidateBatchesPerQueueAttempt;
  const maximumSynthesisAttempts = storyEpisodeAttemptBudget.synthesisDraftsPerQueueAttempt;
  const freshCandidateCount = Math.min(
    options.episodeCandidates,
    eliteRejected
      ? storyEpisodeAttemptBudget.supplementalCandidates
      : storyEpisodeAttemptBudget.initialCandidates,
  );
  const promptLessons = selectDraftLessonsForPrompt(discardedDraftLessons);
  const vocabularyGuide = vocabularyWritingGuide(options);
  const directDraftModel = options.structureRepairModel || options.reviewModel || options.model;
  const failureLessonBrief = (promptLessons.length
    ? `\n\n以前被质量门禁作废的稿件留下了以下精简经验。它们不是故事事实，禁止在正文中提及“评审、分数、旧稿或失败”；动笔前逐条转换为预防动作：\n${promptLessons.map((lesson, lessonIndex) => `${lessonIndex + 1}. ${lesson}`).join("\n")}`
    : "") + vocabularyGuide;
  reportProgress(
    options,
    "drafting",
    eliteRejected
      ? `第 ${episodeNumber}/${options.episodes} 集已有精英底稿，正在补充 ${freshCandidateCount} 份新候选（严选第 ${strictRound}/${maximumStrictRounds} 轮）`
      : `正在用 ${directDraftModel} 直接输出模式生成第 ${episodeNumber}/${options.episodes} 集的 ${freshCandidateCount} 份候选初稿（严选第 ${strictRound}/${maximumStrictRounds} 轮）`,
    episodeProgress(options, index, 0),
  );
  const generateCandidate = (candidateIndex: number) =>
    callBudgetedEpisodeNarrative(
      options,
      plan,
      index,
      previousEpisode,
      "你只输出包含 title 和 paragraphs 的合法 JSON。你是擅长悬念、幽默、伙伴感与分级英语的儿童故事作家。",
      `${episodePrompt(options, plan, index, previousEpisode, false, true)}${failureLessonBrief}\n\n这是候选初稿 ${candidateIndex + 1}/${freshCandidateCount}。第一句必须直接展示正在发生的具体异常、动作或对话，禁止先写夜色、天气、地点大小或安静气氛。第 2-3 段必须让角色的计划因其性格出现一次可视失误，造成具体代价，再由伙伴用不同能力补位；不能把连续“观察—移动—发现—陈述”当成冒险。${episodeEndingInstruction(episodeNumber === options.episodes)}请用与其他候选不同但符合季纲的具体阻碍、角色互动和感官细节完成本集任务合同。长度合同优先于补充更多细节。`,
      directDraftModel,
      Math.min(options.temperature, 0.5),
      creativeDraftModelPolicy(options),
    );
  const candidateResults = await Promise.allSettled(Array.from({ length: freshCandidateCount }, (_, candidateIndex) => generateCandidate(candidateIndex)));
  // Retry only failed slots once; keep successful drafts from this batch.
  for (const [candidateIndex, result] of candidateResults.entries()) {
    if (result.status !== "rejected") continue;
    options.log(`[${episodeNumber}/${options.episodes}] 候选 ${candidateIndex + 1} 失败，保留其余稿件，仅补跑该候选一次。`);
    candidateResults[candidateIndex] = (await Promise.allSettled([generateCandidate(candidateIndex)]))[0];
  }
  let freshDrafts = candidateResults.flatMap((result, candidateIndex) => {
    if (result.status === "fulfilled") return [result.value];
    options.log(
      `第 ${episodeNumber} 集素材初稿 ${candidateIndex + 1} 在自动恢复后仍不可用，`
      + `已隔离该稿并继续聚合其他素材：${modelRequestError(result.reason)}`,
    );
    return [];
  });
  diagnostics.rawWordCounts.push(...freshDrafts.map(narrativeWordCount));
  const vocabularyChecks = freshDrafts.map((draft) => draftVocabulary(options, plan, draft));
  const publishableVocabulary = vocabularyChecks.map((quality) => lexicalFloorPassed(quality, options.minLexicalCoverage));
  const reviewableVocabulary = vocabularyChecks.map((quality) => candidateVocabularyIsReviewable(quality, options.minLexicalCoverage));
  for (const [candidateIndex, quality] of vocabularyChecks.entries()) {
    if (publishableVocabulary[candidateIndex]) continue;
    const lesson = `候选词汇提前检查未通过：${((quality.lexicalCoverage ?? 0) * 100).toFixed(1)}%；先简化 ${quality.unfamiliarWords.join(", ")}，不要保护未发布的教学目标词。`;
    options.log(`[${episodeNumber}/${options.episodes}] 候选 ${candidateIndex + 1} ${lesson}${reviewableVocabulary[candidateIndex] ? " 该稿仍保留作剧情评审素材，最终发布前必须完成词汇修复。" : ""}`);
    discardedDraftLessons = [...discardedDraftLessons, lesson].slice(-20);
  }
  // One bounded rescue per batch, before any semantic review or metadata.
  // If another candidate already passes, do not spend a model call on bad ones.
  if (freshDrafts.length && !publishableVocabulary.some(Boolean)) {
    const best = vocabularyChecks.reduce((winner, value, index) =>
      (value.lexicalCoverage ?? 1) > (vocabularyChecks[winner].lexicalCoverage ?? 1) ? index : winner, 0);
    options.log(`[${episodeNumber}/${options.episodes}] 本批词汇均未过线，仅对覆盖率最高的候选执行一次前置换词，不生成元数据。`);
    freshDrafts[best] = await simplifyNarrativeVocabulary(options, plan, episodeNumber, freshDrafts[best], vocabularyChecks[best].unfamiliarWords, previousEpisode);
    const repairedVocabulary = draftVocabulary(options, plan, freshDrafts[best]);
    publishableVocabulary[best] = lexicalFloorPassed(repairedVocabulary, options.minLexicalCoverage);
    reviewableVocabulary[best] = candidateVocabularyIsReviewable(repairedVocabulary, options.minLexicalCoverage);
  }
  freshDrafts = freshDrafts.filter((_, candidateIndex) => reviewableVocabulary[candidateIndex]);
  onLessons?.(discardedDraftLessons, eliteRejected);
  if (vocabularyChecks.length && !freshDrafts.length && !eliteRejected) {
    options.onLexicalBatchFailure?.(episodeNumber, [...new Set(vocabularyChecks.flatMap((quality) => quality.unfamiliarWords))].slice(0, 36));
    throw new StoryGenerationFailure(`第 ${episodeNumber} 集候选词汇门禁未通过；一次前置换词后仍未达标，已停止评审和元数据生成，保留难词经验供下一批使用`,
      "CANDIDATE_LEXICAL_GATE", "lexical", "new_candidates");
  }
  const drafts = eliteRejected
    ? [...freshDrafts, eliteRejected.narrative]
    : freshDrafts;
  if (!drafts.length) {
    const capacityFailures = candidateResults.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected" && isTransientModelCapacityError(result.reason),
    ).length;
    if (capacityFailures > 0) {
      throw new Error(
        `模型服务繁忙导致本批只有 ${drafts.length} 份可用候选（${capacityFailures} 个请求被限流或过载）；`
        + "已停止本次任务，未将基础设施错误计为稿件质量失败，请稍后手动重试",
      );
    }
    if (strictRound < maximumStrictRounds) {
      options.log(
        `[${episodeNumber}/${options.episodes}] 本轮只有 ${freshDrafts.length} 份可用新初稿，不足以做多稿聚合；正在换一批素材。`,
      );
      return generateEpisodeDraft(
        options,
        plan,
        index,
        previousEpisode,
        firstEpisodeBaseline,
        discardedDraftLessons,
        strictRound + 1,
        eliteRejected,
        onLessons,
        diagnostics,
      );
    }
    throw new StoryGenerationFailure(
      `第 ${episodeNumber} 集候选初稿连续未达到编辑底线：没有至少 ${storyEpisodeAttemptBudget.minimumCandidatePool} 份可用素材稿`,
      "CANDIDATE_POOL_TOO_SMALL",
      "narrative",
      "new_candidates",
    );
  }
  if (eliteRejected) {
    options.log(
      `[${episodeNumber}/${options.episodes}] 已把上一轮最高分未过线融合稿作为第 ${drafts.length} 份精英候选；`
      + `本轮仍保留 ${freshDrafts.length} 份全新初稿。`,
    );
    if (freshDrafts.length === 0) {
      options.log(
        `[${episodeNumber}/${options.episodes}] 本轮无新稿通过前检，直接复用已保存精英稿及其独立评分；`
        + "不会发起空批评审，也不会把单稿称为多稿融合。",
      );
    }
  }

  reportProgress(
    options,
    "reviewing",
    `第 ${episodeNumber} 集 ${drafts.length} 份素材已完成，正在用统一四维规则并行评分并确定主骨架`,
    episodeProgress(options, index, 0.3),
  );
  const draftReviews = await reviewCandidateDrafts(
    options,
    plan,
    freshDrafts,
    episodeNumber,
    previousEpisode,
  );
  // Batch scores are relative screening signals and must not be reported as
  // independently verified quality in the final failure summary.
  if (eliteRejected) draftReviews.push(eliteRejected.critique);
  options.log(
    `[${episodeNumber}/${options.episodes}] 本轮候选计数：生成成功 ${candidateResults.filter((result) => result.status === "fulfilled").length}，`
    + `前检保留 ${freshDrafts.length}，有效初筛评分 ${draftReviews.filter(Boolean).length}，`
    + `保存精英 ${eliteRejected ? 1 : 0}。`,
  );
  if (!draftReviews.some(Boolean)) {
    if (strictRound < maximumStrictRounds) {
      options.log(`[${episodeNumber}/${options.episodes}] 本轮候选评分全部失败，正在换一批全新素材。`);
      return generateEpisodeDraft(
        options,
        plan,
        index,
        previousEpisode,
        firstEpisodeBaseline,
        discardedDraftLessons,
        strictRound + 1,
        eliteRejected,
        onLessons,
        diagnostics,
      );
    }
    throw new Error(`第 ${episodeNumber} 集候选初稿连续未达到编辑底线：统一评分全部不可用`);
  }
  const backboneCandidateIndex = selectBackboneStoryCritique(draftReviews);
  const backboneReview = draftReviews[backboneCandidateIndex]!;
  options.log(
    `[${episodeNumber}/${options.episodes}] 候选 ${backboneCandidateIndex + 1} 以加权分 `
    + `${weightedCritiqueScore(backboneReview).toFixed(2)} 成为唯一主骨架；其余稿件只提供局部亮点。`,
  );

  let narrative: z.infer<typeof episodeNarrativeSchema> | null = null;
  let critique: StoryCritique | null = null;
  let synthesisLessons = discardedDraftLessons;
  let bestRejected = eliteRejected;
  let editorialBaseNarrative = drafts[backboneCandidateIndex];
  let editorialBaseReview = backboneReview;
  let editorialBaseCandidateIndex = backboneCandidateIndex;
  const eliteCandidateIndex = eliteRejected ? drafts.length - 1 : -1;
  const verifiedDrafts = [...drafts];
  const publishReadyCandidateIndices = draftReviews.flatMap((review, candidateIndex) =>
    review && isStrictStoryCritique(review, firstEpisodeBaseline) ? [candidateIndex] : []
  );
  // A persisted elite is the result of a previous single-article review, so it
  // is already trusted and must not be randomly rescored as if it were a fresh
  // batch candidate.
  const independentlyReviewedCandidates = new Set<number>(
    [
      ...(freshDrafts.length === 1 ? [0] : []),
      ...(eliteRejected ? [eliteCandidateIndex] : []),
    ],
  );
  let hadStrictOverlongCandidate = false;
  const sortedDirectCandidateIndices = publishReadyCandidateIndices.sort(
    (left, right) => weightedCritiqueScore(draftReviews[right]!) - weightedCritiqueScore(draftReviews[left]!),
  );
  for (const directCandidateIndex of sortedDirectCandidateIndices) {
    const directCandidate = drafts[directCandidateIndex];
    const directPreflightIssues = narrativePreflightIssues(options, plan, episodeNumber, directCandidate);
    const rawWasOnlyOverlong = directPreflightIssues.length === 1
      && directPreflightIssues[0].startsWith("正文词数")
      && narrativeWordCount(directCandidate) > buildEpisodeWritingContract(options, plan, episodeNumber).publishWordRange[1];
    hadStrictOverlongCandidate ||= rawWasOnlyOverlong;
    const preparedDirectCandidate = await prepareNarrativeForStrictReview(
      options,
      plan,
      episodeNumber,
      previousEpisode,
      directCandidate,
    );
    if (preparedDirectCandidate) {
      // A compact batch review is only a ranking signal. Always independently
      // review even an unchanged top candidate before calling it publishable;
      // otherwise relative batch scoring can produce a false 7.5 "direct pass".
      const directReview = independentlyReviewedCandidates.has(directCandidateIndex)
        ? draftReviews[directCandidateIndex]!
        : await reviewEpisodeSemantics(
            options,
            plan,
            preparedDirectCandidate,
            episodeNumber,
            previousEpisode,
          );
      independentlyReviewedCandidates.add(directCandidateIndex);
      recordDraftReview(diagnostics, directReview);
      if (directCandidateIndex === backboneCandidateIndex) {
        verifiedDrafts[directCandidateIndex] = preparedDirectCandidate;
        if (!eliteRejected || isCritiqueBetter(directReview, eliteRejected.critique)) {
          editorialBaseNarrative = preparedDirectCandidate;
          editorialBaseReview = directReview;
          editorialBaseCandidateIndex = directCandidateIndex;
        } else {
          editorialBaseNarrative = eliteRejected.narrative;
          editorialBaseReview = eliteRejected.critique;
          editorialBaseCandidateIndex = eliteCandidateIndex;
          options.log(
            `[${episodeNumber}/${options.episodes}] 新主骨架的独立复核低于上一轮精英稿；`
            + `已恢复 ${critiqueAverage(eliteRejected.critique).toFixed(2)} 分精英稿为编辑底稿。`,
          );
        }
        draftReviews[directCandidateIndex] = directReview;
      }
      if (isStrictStoryCritique(directReview, firstEpisodeBaseline)) {
        narrative = preparedDirectCandidate;
        critique = directReview;
        options.log(
          `[${episodeNumber}/${options.episodes}] 候选 ${directCandidateIndex + 1} 已通过独立 7/7.5 终审，`
          + `四维均分 ${critiqueAverage(directReview).toFixed(2)}；跳过融合，避免优秀原稿被改差。`,
        );
        break;
      }
      synthesisLessons = lessonsFromCritique(directReview, synthesisLessons);
      if (!bestRejected || isCritiqueBetter(directReview, bestRejected.critique)) {
        bestRejected = { narrative: preparedDirectCandidate, critique: directReview };
      }
      onLessons?.(synthesisLessons, bestRejected);
      if (rawWasOnlyOverlong && preparedDirectCandidate !== directCandidate) {
        const rescued = await rescueStrongOverlongNarrative(
          options,
          plan,
          episodeNumber,
          previousEpisode,
          preparedDirectCandidate,
          directReview,
        );
        if (rescued) {
          const rescuedReview = await reviewEpisodeSemantics(
            options,
            plan,
            rescued,
            episodeNumber,
            previousEpisode,
          );
          recordDraftReview(diagnostics, rescuedReview);
          if (isStrictStoryCritique(rescuedReview, firstEpisodeBaseline)) {
            narrative = rescued;
            critique = rescuedReview;
            options.log(
              `[${episodeNumber}/${options.episodes}] 高分原稿经保守压缩并复核核心事件后通过门禁，`
              + `四维均分 ${critiqueAverage(rescuedReview).toFixed(2)}；跳过融合。`,
            );
            break;
          }
          synthesisLessons = lessonsFromCritique(rescuedReview, synthesisLessons);
          if (!bestRejected || isCritiqueBetter(rescuedReview, bestRejected.critique)) {
            bestRejected = { narrative: rescued, critique: rescuedReview };
          }
          onLessons?.(synthesisLessons, bestRejected);
        }
      }
    } else {
      diagnostics.preflightRejected++;
    }
  }
  if (
    !narrative
    && hadStrictOverlongCandidate
    && !(eliteRejected && isBorderlineStoryCritique(eliteRejected.critique))
  ) {
    if (strictRound < maximumStrictRounds) {
      reportProgress(
        options,
        "drafting",
        `第 ${episodeNumber} 集高分长稿保守压缩后未过线，正在换一批素材，避免融合导致退化`,
        episodeProgress(options, index, 0.5),
      );
      return generateEpisodeDraft(
        options,
        plan,
        index,
        previousEpisode,
        firstEpisodeBaseline,
        synthesisLessons,
        strictRound + 1,
        bestRejected,
        onLessons,
        diagnostics,
      );
    }
    throw new Error(
      `第 ${episodeNumber} 集候选初稿连续未达到编辑底线：高分原稿仅因超长进入保守压缩，`
      + `但本轮仍未通过核心事件复核；已禁止再融合以避免退化；`
      + episodeDraftFailureSummary(diagnostics),
    );
  }
  if (!narrative && !independentlyReviewedCandidates.has(backboneCandidateIndex)) {
    const verifiedBackbone = await reviewEpisodeSemantics(
      options,
      plan,
      verifiedDrafts[backboneCandidateIndex],
      episodeNumber,
      previousEpisode,
    );
    independentlyReviewedCandidates.add(backboneCandidateIndex);
    draftReviews[backboneCandidateIndex] = verifiedBackbone;
    recordDraftReview(diagnostics, verifiedBackbone);
    if (!bestRejected || isCritiqueBetter(verifiedBackbone, bestRejected.critique)) {
      bestRejected = { narrative: verifiedDrafts[backboneCandidateIndex], critique: verifiedBackbone };
      onLessons?.(synthesisLessons, bestRejected);
    }
    if (!eliteRejected || isCritiqueBetter(verifiedBackbone, eliteRejected.critique)) {
      editorialBaseNarrative = verifiedDrafts[backboneCandidateIndex];
      editorialBaseReview = verifiedBackbone;
      editorialBaseCandidateIndex = backboneCandidateIndex;
    } else {
      editorialBaseNarrative = eliteRejected.narrative;
      editorialBaseReview = eliteRejected.critique;
      editorialBaseCandidateIndex = eliteCandidateIndex;
      options.log(
        `[${episodeNumber}/${options.episodes}] 新主骨架独立复核后未超过上一轮精英稿；`
        + `继续使用 ${critiqueAverage(eliteRejected.critique).toFixed(2)} 分精英稿。`,
      );
    }
  }
  if (eliteRejected) recordDraftReview(diagnostics, eliteRejected.critique);
  if (!narrative && isBorderlineStoryCritique(editorialBaseReview)) {
    narrative = editorialBaseNarrative;
    critique = editorialBaseReview;
    options.log(
      `[${episodeNumber}/${options.episodes}] 最高分编辑底稿经独立复核后四项均不少于 7、均分 ${critiqueAverage(editorialBaseReview).toFixed(2)}；`
      + "跳过高退化率融合，保留临界稿进入后续定向增强，最终发布仍须通过 7/7.5 门禁。",
    );
  }
  const hasComplementaryCandidate = draftReviews.some((review, candidateIndex) =>
    candidateIndex !== editorialBaseCandidateIndex
    && review !== null
    && review.plot.score >= 6
    && review.continuity.score >= 6
    && critiqueDimensions.some(
      (dimension) => review[dimension].score >= editorialBaseReview[dimension].score + 1,
    )
  );
  const synthesisDrafts = hasComplementaryCandidate ? verifiedDrafts : [editorialBaseNarrative];
  const synthesisReviews: Array<StoryCritique | null> = hasComplementaryCandidate
    ? draftReviews
    : [editorialBaseReview];
  const synthesisBackboneIndex = hasComplementaryCandidate ? editorialBaseCandidateIndex : 0;
  for (
    let synthesisAttempt = 1;
    !narrative && synthesisAttempt <= maximumSynthesisAttempts;
    synthesisAttempt++
  ) {
    reportProgress(
      options,
      "selecting_plan",
      hasComplementaryCandidate
        ? `第 ${episodeNumber} 集候选存在互补维度，正在执行本轮唯一融合`
        : `第 ${episodeNumber} 集没有可靠互补候选，正在只对最高分底稿做定向修改`,
      episodeProgress(options, index, 0.32 + synthesisAttempt * 0.07),
    );
    let synthesized: z.infer<typeof episodeNarrativeSchema> | null;
    try {
      synthesized = await synthesizeEpisodeDrafts(
        options,
        plan,
        index,
        previousEpisode,
        synthesisDrafts,
        synthesisReviews,
        synthesisBackboneIndex,
        editorialBaseNarrative,
        editorialBaseReview,
        synthesisAttempt,
        synthesisLessons,
      );
    } catch (error) {
      const message = modelRequestError(error);
      if (!message.includes("定长校正后仍不合法")) throw error;
      options.log(
        `[${episodeNumber}/${options.episodes}] 融合稿定长校正失败，已丢弃融合稿并回退到最高分编辑底稿：${message}`,
      );
      synthesized = null;
    }
    if (!synthesized) {
      diagnostics.preflightRejected++;
      options.log(
        `[${episodeNumber}/${options.episodes}] 本轮融合稿未通过前置段数、词数或纯英文硬门禁。`,
      );
      continue;
    }
    reportProgress(
      options,
      "reviewing",
      `第 ${episodeNumber} 集融合稿已完成，正在进行四项至少 7 分且均分 7.5 的独立严选`,
      episodeProgress(options, index, 0.48),
    );
    const reviewed = await reviewEpisodeSemantics(
      options,
      plan,
      synthesized,
      episodeNumber,
      previousEpisode,
    );
    recordDraftReview(diagnostics, reviewed);
    const strictIssues = semanticQualityIssues(reviewed, firstEpisodeBaseline);
    if (!strictIssues.length) {
      narrative = synthesized;
      critique = reviewed;
      options.log(
        `[${episodeNumber}/${options.episodes}] 融合稿通过“四项至少 7 分、均分至少 7.5”严选，`
        + `四维均分 ${critiqueAverage(reviewed).toFixed(2)}。`,
      );
      break;
    }
    synthesisLessons = lessonsFromCritique(reviewed, synthesisLessons);
    if (!bestRejected || isCritiqueBetter(reviewed, bestRejected.critique)) {
      bestRejected = { narrative: synthesized, critique: reviewed };
    }
    if (isCritiqueBetter(reviewed, editorialBaseReview)) {
      options.log(
        `[${episodeNumber}/${options.episodes}] 本次融合虽未过线，但均分从 `
        + `${critiqueAverage(editorialBaseReview).toFixed(2)} 提升到 ${critiqueAverage(reviewed).toFixed(2)}；`
        + "下一次将在这份更好稿上继续做增量修改。",
      );
      editorialBaseNarrative = synthesized;
      editorialBaseReview = reviewed;
    } else {
      options.log(
        `[${episodeNumber}/${options.episodes}] 本次融合均分 ${critiqueAverage(reviewed).toFixed(2)} `
        + `未超过编辑底稿 ${critiqueAverage(editorialBaseReview).toFixed(2)}；`
        + "已丢弃退化稿，下一次继续使用原编辑底稿。",
      );
    }
    onLessons?.(synthesisLessons, bestRejected);
    options.log(
      `[${episodeNumber}/${options.episodes}] 本轮融合稿未达到“四项至少 7 分、均分至少 7.5”：`
      + `${strictIssues.join("；")}。不进入元数据或润色；下次有明确额度的自动重试会吸取本稿问题。`,
    );
  }
  if (!narrative || !critique) {
    if (strictRound < maximumStrictRounds) {
      reportProgress(
        options,
        "drafting",
        `第 ${episodeNumber} 集本轮融合稿未通过 7/7.5 严选，正在生成一批全新素材`,
        episodeProgress(options, index, 0.5),
      );
      return generateEpisodeDraft(
        options,
        plan,
        index,
        previousEpisode,
        firstEpisodeBaseline,
        synthesisLessons,
        strictRound + 1,
        bestRejected,
        onLessons,
        diagnostics,
      );
    }
    throw new StoryGenerationFailure(
      `第 ${episodeNumber} 集候选初稿连续未达到编辑底线：${maximumStrictRounds} 批候选及保守压缩稿均未达到四项至少 7 分且均分至少 7.5；`
      + episodeDraftFailureSummary(diagnostics),
      "CANDIDATE_QUALITY_GATE",
      "narrative",
      "new_candidates",
    );
  }
  const selectedVocabulary = draftVocabulary(options, plan, narrative);
  if (!passesStoryQualityFloor({ ...selectedVocabulary, blockingIssues: [] }, options.minLexicalCoverage)) {
    onLessons?.([...synthesisLessons, `严选后正文仍需简化：${selectedVocabulary.unfamiliarWords.join(", ")}`].slice(-20), null);
    throw new StoryGenerationFailure(`第 ${episodeNumber} 集编辑后的正文词汇门禁未通过，未生成元数据；请简化 ${selectedVocabulary.unfamiliarWords.join(", ")}`,
      "CANDIDATE_LEXICAL_GATE", "lexical", "new_candidates");
  }
  options.log(
    `[${episodeNumber}/${options.episodes}] 严选完成：独立复核 ${independentlyReviewedCandidates.size} 份，`
    + `采用 1 份正文；${narrative === editorialBaseNarrative ? "未做多稿融合" : "采用有界融合稿"}。`,
  );
  return { narrative, critique, discardedDraftLessons: synthesisLessons };
}

export function lexicalRepairProtectedTerms(plan: SeriesPlan, previousEpisode: GeneratedStoryEpisode | null) {
  // Published terminology is a continuity constraint; unpublished teaching
  // words are editable and will be selected again after the prose changes.
  return [...plan.cast.map((character) => character.name),
    ...plan.storyBible.fixedTerms.filter((term) => previousEpisode?.paragraphs.some(
      (paragraph) => paragraph.toLowerCase().includes(term.english.toLowerCase()),
    )).map((term) => term.english)];
}

async function simplifyNarrativeVocabulary(
  options: StoryRunOptions, plan: SeriesPlan, episodeNumber: number,
  originalNarrative: z.infer<typeof episodeNarrativeSchema>, unfamiliarWords: string[],
  previousEpisode: GeneratedStoryEpisode | null,
) {
  const originalWordCount = narrativeWordCount(originalNarrative);
  const publishRange = buildEpisodeWritingContract(options, plan, episodeNumber).publishWordRange;
  const wordBudget = lexicalEditWordBudget(originalWordCount, publishRange[0], publishRange[1]);
  const protectedTerms = lexicalRepairProtectedTerms(plan, previousEpisode);
  const before = draftVocabulary(options, plan, originalNarrative);
  const edited = await callEpisodeNarrative(
    options,
    "你只输出 title 和 paragraphs 的合法 JSON。你是分级英语局部换词编辑，不是摘要员。保留事件、句子和因果，只简化词汇。",
    `${gradedReadingBrief(options)}${vocabularyWritingGuide(options)}\n唯一可编辑正文：${JSON.stringify(originalNarrative)}\n`
      + `优先简化：${JSON.stringify(unfamiliarWords)}\n必须保留的人名和已发布术语：${JSON.stringify(protectedTerms)}\n`
      + `当前程序实测覆盖率 ${((before.lexicalCoverage ?? 0) * 100).toFixed(1)}%，目标 ${(options.minLexicalCoverage * 100).toFixed(0)}%。不是只替换一个词：应检查所有非熟词，尤其重复出现的难词，优先从参考表选择意思正确的表达。`
      + "尚未发布的固定物件称呼和教学目标词可以统一换成常见表达，但不能改变物件身份或剧情事实。后续会重新生成目标词、注释与原文证据，不要为保留旧学习词表而拒绝换词。"
      + `四段、句子数量、动作、对话和结局保持，标题原样保留。正文 ${originalWordCount - wordBudget.maximumRemoved}-${originalWordCount + wordBudget.maximumAdded} 词，不删句、不添加事件。允许把难词展开为简单短语，但不要添加装饰、重复说明或新剧情。只返回 title 和 paragraphs。`,
    options.structureRepairModel || options.reviewModel || options.model, 0.1,
    { timeoutMs: options.timeoutMs, networkRetries: 1, structureRetries: 1,
      maxCompletionTokens: narrativeCompletionTokenBudget(buildEpisodeWritingContract(options, plan, episodeNumber).publishWordRange[1]), disableThinking: true },
  );
  const after = draftVocabulary(options, plan, edited);
  options.log(`[${episodeNumber}/${options.episodes}] 换词实测：${originalWordCount} → ${after.wordCount} 词；覆盖率 ${before.lexicalCoverage} → ${after.lexicalCoverage}；剩余难词：${after.unfamiliarWords.join(", ")}`);
  const issues = [...narrativePreflightIssues(options, plan, episodeNumber, edited),
    ...lexicalEditDriftIssues(originalNarrative, edited, wordBudget)];
  if (issues.length) {
    options.log(`[${episodeNumber}/${options.episodes}] 局部换词越界，保留原稿：${issues.join("；")}`);
    return originalNarrative;
  }
  if (before.lexicalCoverage !== null && after.lexicalCoverage !== null && after.lexicalCoverage <= before.lexicalCoverage) {
    options.log(`[${episodeNumber}/${options.episodes}] 局部换词未提高覆盖率，保留原稿。`);
    return originalNarrative;
  }
  return edited;
}

async function repairEpisode(
  options: StoryRunOptions,
  plan: SeriesPlan,
  episode: GeneratedStoryContent,
  episodeNumber: number,
  quality: StoryQuality,
  previousEpisode: GeneratedStoryEpisode | null,
  onNarrativeReady?: (narrative: z.infer<typeof episodeNarrativeSchema>) => void,
) {
  const contract = buildEpisodeWritingContract(options, plan, episodeNumber);
  const range = contract.wordRange;
  const publishRange = contract.publishWordRange;
  const relevantClues = plan.clueLedger.filter((clue) =>
    contract.requiredClueActions.some((required) => required.clueId === clue.id),
  );
  const requiredClueActions = contract.requiredClueActions;
  const preferredWordRange: [number, number] = [
    Math.max(range[0], range[1] - 50),
    range[1] - 25,
  ];
  const repairKind = chooseRepairKind(quality, options.minLexicalCoverage);
  const onlyMetadataIsBlocking = repairKind === "metadata";
  if (onlyMetadataIsBlocking) {
    const narrative = episodeNarrativeSchema.parse({ title: episode.title, paragraphs: episode.paragraphs });
    const metadata = await completeEpisodeMetadata(
      options,
      plan,
      episodeNumber,
      previousEpisode,
      narrative,
    );
    const merged = mergeEpisodeStructure(narrative, metadata);
    if (!merged) throw new Error(`第 ${episodeNumber} 集正文与修复后的元数据合并失败`);
    options.log(
      `[${episodeNumber}/${options.episodes}] 正文无需重写，已单独重建目标词、线索与质量证据。`,
    );
    return merged;
  }
  const onlyLexicalCoverageBlocksPublication = repairKind === "lexical";
  if (onlyLexicalCoverageBlocksPublication) {
    const originalNarrative = episodeNarrativeSchema.parse({
      title: episode.title,
      paragraphs: episode.paragraphs,
    });
    options.log(
      `[${episodeNumber}/${options.episodes}] 剧情已通过，优先修复词汇覆盖率，再按新正文重建证据；`
      + "执行一次保守局部换词，禁止删减剧情。",
    );
    const editedNarrative = await simplifyNarrativeVocabulary(options, plan, episodeNumber, originalNarrative, quality.unfamiliarWords, previousEpisode);
    if (editedNarrative === originalNarrative) return episode;
    onNarrativeReady?.(editedNarrative);
    const metadata = await completeEpisodeMetadata(
      options,
      plan,
      episodeNumber,
      previousEpisode,
      editedNarrative,
    );
    const merged = mergeEpisodeStructure(editedNarrative, metadata);
    if (!merged) throw new Error(`第 ${episodeNumber} 集局部换词正文与元数据合并失败`);
    return merged;
  }
  const blockingCodes = new Set(quality.blockingIssueDetails?.map((issue) => issue.code) ?? []);
  const needsLengthCompression = blockingCodes.size
    ? blockingCodes.has("NARRATIVE_TOO_LONG")
    : quality.blockingIssues.some((issue) => issue.startsWith("正文过长"));
  const needsLengthExpansion = blockingCodes.size
    ? blockingCodes.has("NARRATIVE_TOO_SHORT")
    : quality.blockingIssues.some((issue) => issue.startsWith("正文过短"));
  if (needsLengthCompression || needsLengthExpansion) {
    const lengthAction = needsLengthCompression ? "压缩" : "扩写";
    const compressedNarrativeSchema = episodeNarrativeSchema.superRefine((value, context) => {
      const paragraphWordCounts = value.paragraphs.map(
        (paragraph) => paragraph.match(/[A-Za-z]+(?:['-][A-Za-z]+)*/g)?.length ?? 0,
      );
      const totalWords = paragraphWordCounts.reduce((total, count) => total + count, 0);
      if (value.paragraphs.length !== 4) {
        context.addIssue({ code: "custom", path: ["paragraphs"], message: `必须恰好 4 段，实际 ${value.paragraphs.length} 段` });
      }
      if (totalWords < publishRange[0] || totalWords > publishRange[1]) {
        context.addIssue({
          code: "custom",
          path: ["paragraphs"],
          message: `正文总计必须在发布硬范围 ${publishRange[0]}-${publishRange[1]} 词，实际 ${totalWords} 词`,
        });
      }
    });
    const adjustedNarrative = await callStructured(
      options,
      compressedNarrativeSchema,
      `你只输出包含 title 和 paragraphs 的合法 JSON。你是儿童分级故事${lengthAction}编辑；只${lengthAction}表达，不改变事件、因果、线索或人物选择。禁止输出其他字段。`,
      `本集精简写作合同：${JSON.stringify(contract)}\n本集必须保留的线索动作：${JSON.stringify(requiredClueActions)}\n上一集状态：${previousEpisode ? JSON.stringify(previousEpisode.storyState) : "第一集"}\n待${lengthAction}稿：${JSON.stringify({ title: episode.title, paragraphs: episode.paragraphs })}\n\n把正文${lengthAction}为恰好 4 个英文段落，优先控制在 ${preferredWordRange[0]}-${preferredWordRange[1]} 词，发布硬范围为 ${publishRange[0]}-${publishRange[1]} 词。paragraphCards.targetWords 只用于分配篇幅，不作为逐段拒绝条件。每段只保留或补足推动“阻碍 → 选择 → 后果 → 新信息”的动作、必要对话、一个感官细节和必要线索。只有 requiredEvents 和 requiredClueActions 是硬任务；optionalIfSpace 只能在不影响主因果时使用。title 和 paragraphs 必须纯英文。只返回 {"title":"...","paragraphs":["...","...","...","..."]}，不要返回其他字段。`,
      options.reviewModel || options.model,
      0.1,
      {
        timeoutMs: options.rewriteTimeoutMs,
        networkRetries: 1,
        structureRetries: 2,
        maxCompletionTokens: 3072,
        disableThinking: true,
        recoverPartial: async (value) => {
          const joinParagraphParts = (part: unknown): string | null => {
            if (typeof part === "string") return part.trim();
            if (!Array.isArray(part)) return null;
            const pieces = part.map(joinParagraphParts);
            if (pieces.some((piece) => piece === null)) return null;
            return pieces.filter(Boolean).join(" ");
          };
          const candidate = Array.isArray(value)
            ? { title: episode.title, paragraphs: value }
            : value && typeof value === "object"
              ? value as Record<string, unknown>
              : null;
          const rawParagraphs = candidate?.paragraphs;
          if (Array.isArray(rawParagraphs) && rawParagraphs.length === 4) {
            const paragraphs = rawParagraphs.map(joinParagraphParts);
            if (paragraphs.some((paragraph) => !paragraph)) return null;
            options.log(
              `[${episodeNumber}/${options.episodes}] ${lengthAction}模型返回了非标准段落包装，`
              + "已在本地拼合嵌套句子并规范为 title/paragraphs 对象。",
            );
            return {
              title: typeof candidate?.title === "string" ? candidate.title : episode.title,
              paragraphs,
            };
          }
          return null;
        },
      },
    );
    onNarrativeReady?.(adjustedNarrative);
    const metadata = await completeEpisodeMetadata(
      options,
      plan,
      episodeNumber,
      previousEpisode,
      adjustedNarrative,
    );
    const merged = mergeEpisodeStructure(adjustedNarrative, metadata);
    if (!merged) throw new Error(`第 ${episodeNumber} 集${lengthAction}正文与元数据合并失败`);
    options.log(
      `[${episodeNumber}/${options.episodes}] 专用${lengthAction}正文已通过统一发布词数校验，并完成元数据补齐。`,
    );
    return merged;
  }
  const repairedNarrative = await callEpisodeNarrative(
    options,
    "你只输出 title 和 paragraphs 的合法 JSON。你是分级阅读终审编辑，只修复自动质量检测指出的问题，并保持精彩情节和原有结构。",
    `故事圣经：${JSON.stringify(plan.storyBible)}\n本集精简写作合同：${JSON.stringify(contract)}\n本集相关线索：${JSON.stringify(relevantClues)}\n本集必须且只能提供的线索动作：${JSON.stringify(requiredClueActions)}\n上一集结构化状态：${previousEpisode ? JSON.stringify(previousEpisode.storyState) : "第一集"}\n待修正文：${JSON.stringify({ title: episode.title, paragraphs: episode.paragraphs })}\n自动检测问题：${quality.issues.join("；")}\n超纲或未识别词：${quality.unfamiliarWords.join(", ")}\n\n正文目标范围是 ${range[0]}-${range[1]} 词，发布硬范围是 ${publishRange[0]}-${publishRange[1]} 词，优先控制在 ${preferredWordRange[0]}-${preferredWordRange[1]} 词。严格保留 contract.requiredEvents 和 requiredClueActions；optionalIfSpace 可以删除，不得因为补旧季纲而超词数。title 和 paragraphs 必须纯英文，不引入新的生僻同义词。把跳跃事件改成可跟随的因果链，保留五感细节、适龄地道表达、角色选择的后果和集中悬念。后续阶段会根据新正文重新生成目标词、状态和全部原文证据；本阶段只返回 {"title":"...","paragraphs":["...","...","...","..."]}。`,
    options.reviewModel || options.model,
    0.1,
    {
      timeoutMs: options.rewriteTimeoutMs,
      networkRetries: 1,
      structureRetries: 1,
      maxCompletionTokens: modelTokenBudgets.episode,
      disableThinking: true,
    },
  );
  onNarrativeReady?.(repairedNarrative);
  const metadata = await completeEpisodeMetadata(
    options, plan, episodeNumber, previousEpisode, repairedNarrative,
  );
  const merged = mergeEpisodeStructure(repairedNarrative, metadata);
  if (!merged) throw new Error(`第 ${episodeNumber} 集终审正文与元数据合并失败`);
  return merged;
}

async function reviewEpisodeSemantics(
  options: StoryRunOptions,
  plan: SeriesPlan,
  episode: Pick<GeneratedStoryContent, "title" | "paragraphs">,
  episodeNumber: number,
  previousEpisode: GeneratedStoryEpisode | null,
) {
  const fullPrompt = critiquePrompt(options, plan, episode, episodeNumber, previousEpisode);
  try {
    return await callStructured(
      options,
      groundedStoryCritiqueSchema(previousEpisode?.paragraphs ?? [], episode.paragraphs),
      "你只输出合法 JSON。你是独立终审，不为之前的生成或修稿背书；必须严格判断这篇文章是否真的逻辑清楚、吸引孩子且比上一集有实质推进。",
      fullPrompt,
      options.reviewModel || options.model,
      options.reviewTemperature,
      { maxCompletionTokens: modelTokenBudgets.critique, disableThinking: true },
    );
  } catch (holisticError) {
    options.log(
      `[${episodeNumber}/${options.episodes}] 四维整包评审连续无法形成完整对象，`
      + "已保留正文并切换为四个独立小 JSON 并行评分，不重新生成文章。",
    );
    try {
      const dimensionResults = await Promise.all(critiqueDimensions.map(async (dimension) => {
        const label = {
          plot: "剧情逻辑",
          childAppeal: "儿童吸引力",
          gradedLanguage: "分级英语",
          continuity: "连续性",
        }[dimension];
        const dimensionSchema = dimension === "continuity"
          ? groundedContinuityDimensionSchema(previousEpisode?.paragraphs ?? [], episode.paragraphs)
          : critiqueDimensionSchema;
        const result = await callStructured(
          options,
          dimensionSchema,
          `你只负责儿童英语故事终审中的“${label}”一个维度。只输出包含 score 和 issues 的合法 JSON 对象。`,
          `${fullPrompt}\n\n恢复模式：忽略上面的完整四维输出格式，本次只评审 ${dimension}（${label}）。`
            + "继续使用相同的 0-10 标尺和所有硬规则。只返回一个小对象："
            + (dimension === "continuity"
              ? `{"score":8,"issues":["【当前证据：exact prose quote】${label}的中文问题"]}。`
              : `{"score":8,"issues":["${label}的中文问题"]}。`)
            + "不得返回维度键名、其他维度、rewritePriorities、Markdown 或第二个对象。",
          options.structureRepairModel || options.reviewModel || options.model,
          Math.min(options.reviewTemperature, 0.1),
          {
            timeoutMs: options.timeoutMs,
            networkRetries: 1,
            structureRetries: 2,
            maxCompletionTokens: 1536,
            disableThinking: true,
          },
        );
        return [dimension, result] as const;
      }));
      const dimensions = Object.fromEntries(dimensionResults) as Record<
        (typeof critiqueDimensions)[number],
        z.infer<typeof critiqueDimensionSchema>
      >;
      const priorities = critiqueDimensions.flatMap((dimension) => dimensions[dimension].issues);
      const recovered = storyCritiqueObjectSchema.parse({
        ...dimensions,
        rewritePriorities: priorities.length
          ? [...new Set(priorities)].slice(0, 8)
          : ["保持当前结构和语言质量"],
      });
      options.log(
        `[${episodeNumber}/${options.episodes}] 四维独立评分已合并为完整评审对象，正文无需重跑。`,
      );
      return recovered;
    } catch (dimensionError) {
      throw new Error(
        `四维整包评审失败后，独立维度恢复也未完成：${modelRequestError(dimensionError)}；`
        + `原始错误：${modelRequestError(holisticError)}`,
      );
    }
  }
}

async function rewriteEpisodeSemanticsWithPlan(
  options: StoryRunOptions,
  plan: SeriesPlan,
  episode: GeneratedStoryContent,
  critique: StoryCritique,
  episodeNumber: number,
  previousEpisode: GeneratedStoryEpisode | null,
) {
  const contract = buildEpisodeWritingContract(options, plan, episodeNumber);
  const focusedCritique: StoryCritique = {
    plot: { ...critique.plot, issues: critique.plot.issues.slice(0, 2) },
    childAppeal: { ...critique.childAppeal, issues: critique.childAppeal.issues.slice(0, 2) },
    gradedLanguage: { ...critique.gradedLanguage, issues: critique.gradedLanguage.issues.slice(0, 2) },
    continuity: { ...critique.continuity, issues: critique.continuity.issues.slice(0, 2) },
    rewritePriorities: critique.rewritePriorities.slice(0, 3),
  };
  const nearGate = isBorderlineStoryCritique(critique);
  const editScope = nearGate
    ? "当前稿四项已经达到 7 分，只差均分门禁。以保留为主：锁定正确的角色、场景、事件顺序和原句，只修前三项优先问题；不得重构未被指出的问题，也不得增加新支线。"
    : "保留评审未指出问题的角色、场景和正确因果，只重构导致未达标的核心段落；不要借机全面换写。";
  options.log(
    `[${episodeNumber}/${options.episodes}] 剧情语义优化先由 M3 直接生成精炼重构蓝图；`
    + "蓝图完成后再独立执行正文 JSON。",
  );
  const rewritePlan = await callStructured(
    options,
    semanticRewritePlanSchema,
    "你只输出合法 JSON。你是儿童连续故事的剧情重构策划师；直接给执行编辑一份短而明确的重构蓝图，不输出推理过程，本阶段绝不重写正文。",
    `本集写作合同：${JSON.stringify(contract)}\n`
      + `故事圣经：${JSON.stringify(plan.storyBible)}\n`
      + `上一集状态：${previousEpisode ? JSON.stringify(previousEpisode.storyState) : "第一集"}\n`
      + `上一集正文：${previousEpisode ? JSON.stringify(previousEpisode.paragraphs) : "第一集"}\n`
      + `当前正文：${JSON.stringify({ title: episode.title, paragraphs: episode.paragraphs })}\n`
      + `严格评审的精简高优先级问题：${JSON.stringify(focusedCritique)}\n`
      + `编辑范围：${editScope}\n\n`
      + "规划如何真正修复评审问题，而不是换同义词。逐段明确必须保留什么、删除或改变什么，以及阻碍→选择→后果→新信息的因果。"
      + "不得增加 writing contract 之外的新设定，不得重复上一集发现，不得让物件或答案凭空出现。只返回重构蓝图 JSON。",
    options.reviewModel || options.model,
    Math.max(options.reviewTemperature, 0.25),
    semanticPlanningModelPolicy(options),
  );
  return callBudgetedEpisodeNarrative(
    options,
    plan,
    episodeNumber - 1,
    previousEpisode,
    "你只输出 title 和四个 paragraphs 的合法 JSON。你是儿童连续故事执行编辑；严格执行已经完成的重构蓝图，不再展开长推理，不输出元数据。",
    `${reviewPrompt(options, plan, episode, focusedCritique, episodeNumber, previousEpisode)}\n\n`
      + `已完成的重构蓝图：${JSON.stringify(rewritePlan)}\n\n`
      + `编辑范围：${editScope}\n`
      + "逐项执行蓝图；若蓝图与 writing contract 冲突，以 writing contract 为准。"
      + "不得只做措辞润色，必须落实蓝图中的因果、连续性、伙伴互动和结尾回报。"
      + "只返回 title 和恰好四个 paragraphs；不要返回目标词、连续性状态、证据或题目。",
    options.reviewModel || options.model,
    options.reviewTemperature,
    semanticRewriteModelPolicy(options),
  );
}

async function materializeReviewedNarrative(
  options: StoryRunOptions,
  plan: SeriesPlan,
  narrative: z.infer<typeof episodeNarrativeSchema>,
  episodeNumber: number,
  previousEpisode: GeneratedStoryEpisode | null,
) {
  const metadata = await completeEpisodeMetadata(
    options,
    plan,
    episodeNumber,
    previousEpisode,
    narrative,
  );
  const episode = mergeEpisodeStructure(narrative, metadata);
  if (!episode) throw new Error(`第 ${episodeNumber} 集复核通过的正文与元数据合并失败`);
  return episode;
}

export function lexicalAllowedWords(plan: SeriesPlan) {
  return [
    ...plan.cast.flatMap((character) => character.name.match(/[A-Za-z]+(?:['-][A-Za-z]+)*/g) ?? []),
  ];
}

export function examVocabularyTags(examId: ExamId, stage?: ResolvedReaderStageId) {
  if (stage === "starter" || stage === "stage1") return ["zk"];
  // ECDICT's zk list is narrower than the vocabulary used in natural junior-
  // high stories: ordinary words such as jar, sealed, slipped, whispered and
  // calm are tagged gk only. Treat both school lists as familiar for publishing
  // while retaining the stricter reader-stage frequency target for prompting.
  if (examId === "middle") return ["zk", "gk"];
  if (examId === "high") return ["zk", "gk"];
  if (examId === "toefl") return ["toefl"];
  if (examId === "ielts") return ["ielts"];
  return ["zk", "gk", "cet4", "cet6"];
}

function meetsQualityTarget(quality: StoryQuality, targetCoverage: number) {
  return quality.blockingIssues.length === 0
    && quality.score >= 80
    && (quality.lexicalCoverage === null || quality.lexicalCoverage >= targetCoverage);
}

export function passesStoryQualityFloor(quality: Pick<StoryQuality, "lexicalCoverage" | "wordCount" | "blockingIssues">, targetCoverage: number) {
  return quality.blockingIssues.length === 0
    // Coverage is ultimately a whole-word count, while the checkpoint stores a
    // rounded ratio. Permit one token of dictionary/rounding uncertainty so a
    // 268-word story at 89.7% cannot loop merely to cross a floating threshold.
    && lexicalFloorPassed(quality, targetCoverage);
}

export function canReuseLexicalElite(
  quality: Pick<StoryQuality, "lexicalCoverage" | "wordCount">,
  targetCoverage: number, repairExhausted = false,
) {
  return !repairExhausted && passesStoryQualityFloor({ ...quality, blockingIssues: [] }, targetCoverage);
}

export function prioritizeTargetWords(
  episode: Pick<GeneratedStoryContent, "paragraphs" | "targetWords">,
  quality: StoryQuality,
  maximum: number,
  isBaseFamiliar: (word: string) => boolean = () => false,
) {
  const text = episode.paragraphs.join(" ");
  const counts = new Map<string, number>();
  for (const token of text.match(/[A-Za-z]+(?:['-][A-Za-z]+)*/g) ?? []) {
    const normalized = normalizeLexicalToken(token);
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
  }
  const unique = (words: string[]) => words
    .map(normalizeLexicalToken)
    .filter((word, index, values) => Boolean(word) && values.indexOf(word) === index && counts.has(word));
  const difficult = unique([...quality.unfamiliarWords, ...episode.targetWords])
    .filter((word) => !isBaseFamiliar(word))
    .sort((left, right) => (counts.get(right) ?? 0) - (counts.get(left) ?? 0));
  const fallback = unique(episode.targetWords).filter((word) => !difficult.includes(word));
  return [...difficult, ...fallback].slice(0, maximum);
}

function assessRuntimeStoryQuality(
  episode: GeneratedStoryContent | GeneratedStoryEpisode,
  options: StoryRunOptions,
  episodeNumber: number,
  lexical: {
    lookup: LexicalRankLookup;
    isFamiliar?: LexicalFamiliarityLookup;
    allowedWords?: string[];
  } | undefined,
  plan: SeriesPlan,
  previousEpisode: GeneratedStoryEpisode | null,
) {
  const quality = assessStoryQuality(episode, options, episodeNumber, lexical, plan, previousEpisode);
  if (
    lexical
    && quality.lexicalCoverage !== null
    && quality.lexicalCoverage < options.minLexicalCoverage
    && quality.unfamiliarWords.length
  ) {
    const maximum = resolveReaderProfile(options).maxNewWords;
    const rankCutoff = resolveReaderProfile(options).headwords * 3;
    const allowed = new Set((lexical.allowedWords ?? []).map(normalizeLexicalToken));
    const prioritized = prioritizeTargetWords(
      episode,
      quality,
      maximum,
      (word) => alwaysFamiliarLexicalWords.has(word)
        || allowed.has(word)
        || lexical.isFamiliar?.(word) === true
        || ((lexical.lookup(word) ?? Number.POSITIVE_INFINITY) <= rankCutoff),
    );
    if (
      prioritized.length >= 4
      && prioritized.join("|") !== episode.targetWords.map(normalizeLexicalToken).join("|")
    ) {
      episode.targetWords = prioritized;
      options.log(`[${episodeNumber}/${options.episodes}] 已选择 ${prioritized.length} 个正文生词用于学习；选择目标词不改变真实词汇覆盖率。`);
    }
  }
  return assessStoryQuality(episode, options, episodeNumber, lexical, plan, previousEpisode);
}

function hasOnlyMetadataBlockingIssues(quality: StoryQuality) {
  return onlyMetadataBlocks(quality);
}

export function shouldAdoptMechanicalRepair(
  before: StoryQuality,
  after: StoryQuality,
  targetCoverage: number,
) {
  const afterBlockingCodes = new Set(after.blockingIssueDetails?.map((issue) => issue.code) ?? []);
  if (afterBlockingCodes.size
    ? afterBlockingCodes.has("NARRATIVE_TOO_SHORT") || afterBlockingCodes.has("NARRATIVE_TOO_LONG")
    : after.blockingIssues.some((issue) => /^正文过(?:短|长)/.test(issue))) return false;
  if (after.blockingIssues.length > before.blockingIssues.length) return false;
  if (passesStoryQualityFloor(after, targetCoverage)) return true;
  const publishableCoverage = Math.min(targetCoverage, 0.9);
  const coverageGap = (quality: StoryQuality) => quality.lexicalCoverage === null
    ? 0
    : Math.max(0, publishableCoverage - quality.lexicalCoverage);
  const beforeGap = coverageGap(before);
  const afterGap = coverageGap(after);
  return after.blockingIssues.length < before.blockingIssues.length
    || afterGap + 0.001 < beforeGap
    || (afterGap <= beforeGap + 0.001 && after.score > before.score);
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}

function ensureStoryInterestCategory(db: ReturnType<typeof createDatabase>, options: StoryRunOptions) {
  const isCustomStory = options.interest === "custom-story";
  const isKnownPublicInterest = storyInterestIds
    .filter((interest) => interest !== "custom-story")
    .includes(options.interest as Exclude<(typeof storyInterestIds)[number], "custom-story">);
  if (isKnownPublicInterest) return;

  db.prepare(
    `INSERT INTO interest_categories(
       id, name, subtitle, emoji, color, activity_prompt, story_prompt
     ) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       subtitle = excluded.subtitle,
       emoji = excluded.emoji,
       color = excluded.color,
       activity_prompt = excluded.activity_prompt,
       story_prompt = excluded.story_prompt,
       active = 1,
       updated_at = CURRENT_TIMESTAMP`,
  ).run(
    options.interest,
    isCustomStory ? "定制故事" : options.customInterestName,
    isCustomStory ? "用户自己的连续故事" : options.customInterestSubtitle,
    isCustomStory ? "✨" : options.customInterestEmoji,
    isCustomStory ? "#55766D" : options.customInterestColor,
    isCustomStory ? "预测下一集，并说出支持预测的线索。" : options.customActivityPrompt,
    isCustomStory ? "根据用户灵感创作原创、适龄、精彩的连续故事。" : options.customInterestPrompt,
  );
}

function storySourceMetadata(options: StoryRunOptions, plan: SeriesPlan) {
  const guide = storyGuideFor(options);
  const classicSource = options.sourceMode === "classic"
    ? classicSources[options.classicId as ClassicSourceId]
    : null;
  return {
    seriesSlug: slug(plan.seriesTitle) || `${options.interest}-series`,
    sourceName: classicSource
      ? `拾词 AI 公版名著分级改写 · ${classicSource.title}`
      : options.sourceMode === "favorite"
        ? `拾词 AI 原创兴趣故事 · ${options.sourceTitle || guide.label}`
        : `拾词 AI 原创连续故事 · ${guide.label}`,
    licenseNote: classicSource
      ? `基于公版原作 ${classicSource.title} 独立生成的分级重述；未复制任何商业简写本、现代译本或影视改编文本`
      : options.sourceMode === "favorite"
        ? "仅参考用户提供的题材偏好，角色、设定、语言与具体情节由模型原创，并经过第二遍审校"
        : "由项目配置的生成模型原创生成，并经过第二遍故事质量审校",
    eyebrow: classicSource ? "GRADED CLASSIC ADVENTURE" : "ORIGINAL SERIAL ADVENTURE",
  };
}

function importStoryEpisode(
  db: ReturnType<typeof createDatabase>,
  options: StoryRunOptions,
  plan: SeriesPlan,
  episode: GeneratedStoryEpisode,
  quality: StoryQuality,
  index: number,
  notifyImported = true,
) {
  const metadata = storySourceMetadata(options, plan);
  const [articleId] = importArticles(db, {
    examId: options.examId,
    sourceName: metadata.sourceName,
    sourceUrl: null,
    licenseNote: metadata.licenseNote,
    rightsConfirmed: true,
    articles: [{
      externalId: `${options.importNamespace ? `${slug(options.importNamespace)}-` : ""}${options.interest}-${metadata.seriesSlug}-${index + 1}`,
      year: new Date().getFullYear(),
      title: episode.title,
      eyebrow: metadata.eyebrow,
      readMinutes: Math.max(3, Math.ceil(quality.wordCount / 95)),
      difficulty: examGuide[options.examId].difficulty,
      contentKind: "interest" as const,
      interestId: options.interest as InterestId,
      seriesTitle: plan.seriesTitle,
      episodeNumber: index + 1,
      paragraphs: episode.paragraphs,
      questions: episode.questions.map(({ prompt, options, answer, explanation }) => ({
        prompt,
        options,
        answer,
        explanation,
      })) as Question[],
    }],
  });
  if (!articleId) throw new Error(`第 ${index + 1} 集入库后没有返回文章 ID`);
  if (notifyImported) {
    options.onEpisodeImported?.({
      articleId,
      episodeNumber: index + 1,
      totalEpisodes: options.episodes,
      seriesTitle: plan.seriesTitle,
    });
  }
  return articleId;
}

export async function runStoryGeneration(options: StoryRunOptions) {
  options = { ...options, publishedStoryContext: [], planningHistory: planningHistorySchema.parse(options.planningHistory ?? []) };
  if (options.dryRun) {
    options.log(buildSeriesPlanPrompt(options));
    return { generated: 0, imported: 0, articleIds: [] as string[], seriesTitle: "", qualities: [] as StoryQuality[] };
  }
  if (!options.baseUrl || !options.model) throw new Error("需要配置 baseUrl 和 model");
  const engagementBrief = loadStoryEngagementBrief(options.databasePath, options.interest, options.examId);
  options.log(engagementBrief);
  let restored = parseStoryGenerationCheckpoint(options.checkpoint);
  let upgradedStoryContract = false;
  if (restored) {
    try {
      validateSeriesPlan(restored.plan, options.episodes);
      if (restored.episodes.length > options.episodes) throw new Error("检查点章节数超过任务集数");
      if (
        restored.activeEpisode
        && (restored.activeEpisode.index !== restored.episodes.length
          || restored.activeEpisode.index >= options.episodes)
      ) {
        throw new Error("检查点中的进行中章节位置不一致");
      }
      if (
        restored.stagedEpisode
        && (restored.stagedEpisode.index !== restored.episodes.length
          || restored.stagedEpisode.index >= options.episodes)
      ) {
        throw new Error("检查点中的分阶段章节位置不一致");
      }
      if (restored.activeEpisode && restored.stagedEpisode) {
        throw new Error("检查点不能同时包含 activeEpisode 和 stagedEpisode");
      }
      if (restored.stagedEpisode) {
        const stagedNarrative = restored.stagedEpisode.stage === "metadata_pending"
          ? restored.stagedEpisode.narrative
          : restored.stagedEpisode.episode;
        if (episodeNarrativeHash(stagedNarrative) !== restored.stagedEpisode.textHash) {
          throw new Error("分阶段章节的正文哈希不一致");
        }
      }
      if (restored.rejectedElite && restored.rejectedElite.index !== restored.episodes.length) {
        throw new Error("检查点中的精英废稿章节位置不一致");
      }
    } catch (error) {
      options.log(`检查点无法继续，将重新生成：${error instanceof Error ? error.message : "内容不合法"}`);
      restored = null;
    }
  }
  if (restored && restored.storyContractVersion !== currentStoryContractVersion) {
    if (!restored.episodes.length) {
      options.log(
        "检测到第一集尚未发布的旧版故事合同：旧季纲可能把即时后果与持久变化写成同一事件，"
        + "或让结尾重复开场问题；已丢弃未发布季纲和草稿，按新合同重新策划，避免继续修补不可达标的结构。",
      );
      restored = null;
    } else {
      options.log(
        "检测到旧版故事合同：已保留完成章节和季纲，丢弃当前集旧稿、旧评分及其冲突经验，"
        + "改用统一发布长度、语义协作判断、自动目标词和单调修稿的新合同继续生成。",
      );
      restored = {
        ...restored,
        storyContractVersion: currentStoryContractVersion,
        discardedDraftLessons: undefined,
        rejectedElite: undefined,
        stagedEpisode: undefined,
        activeEpisode: undefined,
      };
      upgradedStoryContract = true;
    }
  }
  let plan = restored?.plan ?? await generatePlan(options, engagementBrief);
  const generated: GeneratedStoryEpisode[] = restored?.episodes.map((item) => item.episode) ?? [];
  const qualities: StoryQuality[] = restored?.episodes.map((item) => item.quality) ?? [];
  const semanticReviews: Array<StoryCritique | undefined> = restored?.episodes.map(
    (item) => item.semanticReview,
  ) ?? [];
  let activeEpisode = restored?.activeEpisode;
  let stagedEpisode = restored?.stagedEpisode;
  let localRepairAttempts = {
    ...(activeEpisode?.localRepairAttempts ?? stagedEpisode?.localRepairAttempts ?? { metadata: 0, lexical: 0 }),
  };
  let discardedDraftLessons = restored?.discardedDraftLessons ?? [];
  let rejectedElite = restored?.rejectedElite;
  const replannedEpisodes = new Set(restored?.replannedEpisodes ?? []);
  let lexicalFailureBatches = restored?.lexicalFailureBatches ?? [];
  const lexicalPlanRevisions = new Set(restored?.lexicalPlanRevisions ?? []);
  let reviewCalibrationVersion = restored?.reviewCalibrationVersion ?? "";
  const checkpointEpisodes = () => generated.map((savedEpisode, savedIndex) => ({
    episode: savedEpisode,
    quality: qualities[savedIndex],
    semanticReview: semanticReviews[savedIndex],
  }));
  const saveCheckpoint = (active?: ActiveEpisodeCheckpoint) => {
    if (active) active = { ...active, localRepairAttempts: { ...localRepairAttempts } };
    activeEpisode = active;
    if (active) stagedEpisode = undefined;
    options.onCheckpoint?.({
      version: 2,
      plan,
      episodes: checkpointEpisodes(),
      storyContractVersion: currentStoryContractVersion,
      replannedEpisodes: [...replannedEpisodes],
      lexicalFailureBatches,
      lexicalPlanRevisions: [...lexicalPlanRevisions],
      ...(reviewCalibrationVersion ? { reviewCalibrationVersion } : {}),
      ...(discardedDraftLessons.length ? { discardedDraftLessons } : {}),
      ...(rejectedElite ? { rejectedElite } : {}),
      ...(stagedEpisode ? { stagedEpisode } : {}),
      ...(active ? { activeEpisode: active } : {}),
    });
  };
  const saveStagedEpisode = (staged: StagedEpisodeCheckpoint) => {
    stagedEpisode = { ...staged, localRepairAttempts: { ...localRepairAttempts } };
    activeEpisode = undefined;
    saveCheckpoint();
  };
  options.onLexicalBatchFailure = (episode, words) => {
    lexicalFailureBatches = [...lexicalFailureBatches, { episode, words }].slice(-12);
    saveCheckpoint(activeEpisode);
  };
  if (upgradedStoryContract) saveCheckpoint();
  let previousEpisode: GeneratedStoryEpisode | null = generated.at(-1) ?? null;
  if (restored) {
    const nextEpisode = generated.length + 1;
    options.log(
      `已从检查点恢复《${plan.seriesTitle}》和 ${generated.length} 集成稿`
      + (activeEpisode
        ? `，第 ${activeEpisode.index + 1} 集恢复到 ${activeEpisode.stage} 阶段。`
        : stagedEpisode
          ? `，第 ${stagedEpisode.index + 1} 集恢复到 ${stagedEpisode.stage} 阶段。`
          : "。"),
    );
    reportProgress(
      options,
      generated.length >= options.episodes ? "saving" : "drafting",
      generated.length >= options.episodes
        ? `已恢复全部 ${options.episodes} 集，正在保存到故事书架`
        : generated.length
          ? `已恢复前 ${generated.length} 集，正在从第 ${nextEpisode} 集继续`
          : activeEpisode || stagedEpisode
            ? `已恢复第 ${(activeEpisode ?? stagedEpisode)!.index + 1} 集的阶段成果，正在继续创作`
            : `已恢复故事方案《${plan.seriesTitle}》，正在生成第 1 集初稿`,
      generated.length >= options.episodes
        ? 94
        : episodeProgress(options, generated.length, 0),
    );
  } else {
    options.log(`系列策划完成：${plan.seriesTitle}`);
    saveCheckpoint();
    reportProgress(options, "drafting", `故事方案《${plan.seriesTitle}》已完成，正在生成第 1 集初稿`, 20);
  }
  if (
    generated.length > 0
    && generated.length < options.episodes
    && reviewCalibrationVersion !== currentReviewCalibrationVersion
  ) {
    reportProgress(
      options,
      "reviewing",
      "正在用当前统一四维规则重新校准第 1 集评分基线（只执行一次）",
      episodeProgress(options, generated.length, 0),
    );
    const calibratedFirstReview = await reviewEpisodeSemantics(
      options,
      plan,
      generated[0],
      1,
      null,
    );
    semanticReviews[0] = calibratedFirstReview;
    reviewCalibrationVersion = currentReviewCalibrationVersion;
    saveCheckpoint(activeEpisode);
    options.log(
      `[1/${options.episodes}] 第一集已按当前统一规则重评：`
      + `剧情 ${calibratedFirstReview.plot.score.toFixed(1)}、`
      + `吸引力 ${calibratedFirstReview.childAppeal.score.toFixed(1)}、`
      + `分级语言 ${calibratedFirstReview.gradedLanguage.score.toFixed(1)}、`
      + `连续性 ${calibratedFirstReview.continuity.score.toFixed(1)}。后续集统一使用该基线。`,
    );
  }
  const db = createDatabase(options.databasePath);
  const articleIds: string[] = [];
  try {
    ensureStoryInterestCategory(db, options);
    if (options.force) {
      db.prepare(
        `DELETE FROM articles WHERE exam_id = ? AND content_kind = 'interest'
         AND interest_id = ? AND series_title = ?`,
      ).run(options.examId, options.interest, plan.seriesTitle);
    }
    for (let index = 0; index < generated.length; index++) {
      // A restored episode is imported idempotently to ensure its article row
      // exists, but it is not a newly completed episode. Replaying this callback
      // would reset the next episode's persisted retry budget on every resume.
      articleIds.push(importStoryEpisode(db, options, plan, generated[index], qualities[index], index, false));
    }

    const dictionary = openEcdict(options.ecdictPath);
    if (!dictionary) options.log(`未找到 ECDICT，跳过词频覆盖率检测：${options.ecdictPath}`);
    const lexical = dictionary
      ? {
          lookup: (word: string) => dictionary.frequencyRank(word),
          isFamiliar: (word: string) => dictionary.hasVocabularyTag(word, examVocabularyTags(options.examId, resolveReaderProfile(options).id)),
          allowedWords: lexicalAllowedWords(plan),
        }
      : undefined;
    const completeQuestions = async (
      index: number,
      episode: GeneratedStoryContent,
      semanticReview: StoryCritique,
      previous: GeneratedStoryEpisode | null,
    ) => {
      const episodeNumber = index + 1;
      let completedEpisode: GeneratedStoryEpisode | null = null;
      let completedQuality: StoryQuality | null = null;
      for (let questionAttempt = 1; questionAttempt <= 2; questionAttempt++) {
        const questions = await groundQuestions(options, episode, episodeNumber);
        const candidate = { ...episode, questions };
        const candidateQuality = assessRuntimeStoryQuality(
          candidate, options, episodeNumber, lexical, plan, previous,
        );
        if (passesStoryQualityFloor(candidateQuality, options.minLexicalCoverage)) {
          try {
            const questionReview = await reviewGroundedQuestions(options, episode, questions, episodeNumber);
            const questionIssues = questionReview.reviews.flatMap((review) =>
              review.supported && review.uniqueAnswer
                ? []
                : [`第 ${review.questionIndex + 1} 题：${review.issues.join("；") || "正文证据不足或答案不唯一"}`]
            );
            if (!questionIssues.length) {
              completedEpisode = candidate;
              completedQuality = candidateQuality;
              break;
            }
            options.log(
              `[${episodeNumber}/${options.episodes}] 第 ${questionAttempt}/2 次命题通过格式检查但未通过独立语义验题：`
              + questionIssues.join("；"),
            );
          } catch (error) {
            options.log(
              `[${episodeNumber}/${options.episodes}] 第 ${questionAttempt}/2 次独立语义验题输出不可用，`
              + `将重新命题而不是中断正文：${modelRequestError(error)}`,
            );
          }
          continue;
        }
        options.log(
          `[${episodeNumber}/${options.episodes}] 第 ${questionAttempt}/2 次独立命题未通过证据检查：${candidateQuality.blockingIssues.join("；")}`,
        );
      }
      if (!completedEpisode || !completedQuality) {
        throw new StoryGenerationFailure(
          `第 ${episodeNumber} 集正文已通过，但独立命题连续 2 次未通过原文证据检查`,
          "QUESTION_EVIDENCE_GATE",
          "questions",
          "same_text",
        );
      }
      return { episode: completedEpisode, quality: completedQuality, semanticReview };
    };
    const finalizeEpisode = (
      index: number,
      completedEpisode: GeneratedStoryEpisode,
      quality: StoryQuality,
      semanticReview: StoryCritique,
    ) => {
      const episodeNumber = index + 1;
      generated.push(completedEpisode);
      qualities.push(quality);
      semanticReviews.push(semanticReview);
      if (index === 0) reviewCalibrationVersion = currentReviewCalibrationVersion;
      previousEpisode = completedEpisode;
      stagedEpisode = undefined;
      activeEpisode = undefined;
      saveCheckpoint();
      articleIds.push(importStoryEpisode(db, options, plan, completedEpisode, quality, index));
      reportProgress(
        options,
        index + 1 === options.episodes ? "saving" : "drafting",
        index + 1 === options.episodes
          ? "全部章节已上架，正在完成故事书架整理"
          : index === 0
            ? `第 1/${options.episodes} 集已上架，可以先读；正在准备下一集`
            : `第 ${index + 1}/${options.episodes} 集已上架，准备生成下一集`,
        episodeProgress(options, index, 1),
      );
      const coverage = quality.lexicalCoverage === null
        ? "未检测词频"
        : `高频词覆盖 ${(quality.lexicalCoverage * 100).toFixed(1)}%`;
      options.log(
        `[${episodeNumber}/${options.episodes}] ${completedEpisode.title} · ${quality.wordCount} 词 · ${coverage}`
        + ` · 结构质量 ${quality.score} · 语义均分 ${critiqueAverage(semanticReview).toFixed(1)}`,
      );
    };
    try {
      for (let index = generated.length; index < options.episodes; index++) {
        const episodeNumber = index + 1;
        const episodePrevious = previousEpisode;
        options.publishedStoryContext = generated.map(({ title, paragraphs }) => ({ title, paragraphs }));
        const savedStaged = stagedEpisode?.index === index ? stagedEpisode : undefined;
        if (savedStaged?.stage === "ready_to_publish") {
          options.log(`[${episodeNumber}/${options.episodes}] 恢复已通过全部门禁的成稿，只执行幂等发布。`);
          finalizeEpisode(index, savedStaged.episode, savedStaged.quality, savedStaged.semanticReview);
          continue;
        }
        if (savedStaged?.stage === "questions_pending") {
          options.log(`[${episodeNumber}/${options.episodes}] 恢复已定稿正文，只继续独立命题与验题。`);
          const completed = await completeQuestions(
            index, savedStaged.episode, savedStaged.semanticReview, episodePrevious,
          );
          saveStagedEpisode({
            ...savedStaged,
            stage: "ready_to_publish",
            episode: completed.episode,
            quality: completed.quality,
          });
          finalizeEpisode(index, completed.episode, completed.quality, completed.semanticReview);
          continue;
        }
        const repeatedWords = recurringPlanWords(lexicalFailureBatches, episodeNumber);
        if (!savedStaged && repeatedWords.length && !lexicalPlanRevisions.has(episodeNumber)) {
          reportProgress(options, "planning", `第 ${episodeNumber} 集多批反复出现同类难词，正在回修未发布季纲（最多一次）`, episodeProgress(options, index, 0));
          const planningContext = `重复难词：${repeatedWords.join(", ")}。两批不同正文仍依赖这些词，需简化任务设计，不是替换近义词或缩短摘要。\n旧季纲：${JSON.stringify(plan)}\n已发布正文（绝不能改动）：${JSON.stringify(options.publishedStoryContext)}\n保留用户题材、人物身份和已发布事实，仅调整未发布情节；删去非必要专业机制和支线，换成可观察的简单行动、选择与合作。不增加集数。`;
          const revisionOptions = { ...options, planCandidates: 1, planningContext };
          const revised = await generatePlan(revisionOptions, engagementBrief);
          if (generated.length) {
            revised.seriesTitle = plan.seriesTitle;
            revised.cast = plan.cast;
            revised.storyBible = plan.storyBible;
            revised.episodes = [...plan.episodes.slice(0, generated.length), ...revised.episodes.slice(generated.length)];
            await verifySplitPlanFeasibility(revisionOptions, revised);
          }
          plan = validateSeriesPlan(revised, options.episodes);
          lexicalPlanRevisions.add(episodeNumber);
          rejectedElite = undefined;
          activeEpisode = undefined;
          discardedDraftLessons = [`已根据重复难词简化未发布季纲：${repeatedWords.join(", ")}；按新季纲写作，不恢复旧专业机制。`];
          if (lexical) lexical.allowedWords = lexicalAllowedWords(plan);
          saveCheckpoint();
          options.log(`[${episodeNumber}/${options.episodes}] 未发布季纲已回修并通过可行性检查；保留 ${generated.length} 集已发布正文，不增加本集自动重试额度。`);
        }
        if (!savedStaged && episodePrevious && (plan.episodes[index].entryBridge?.sourceHash !== publishedNarrativeHash(options.publishedStoryContext)
          || plan.episodes[index].entryBridge?.contractVersion !== "prose-ledger-v2")) {
          reportProgress(options, "planning", `第 ${episodeNumber} 集正在依据已发布正文衔接核心悬念`, episodeProgress(options, index, 0));
          const adapted = await callStructured(options,
            continuityRepairPatchSchema.superRefine((value, context) => {
              if (value.clueLedger.length === 0) return;
              try { reconcileClueLedger(plan.clueLedger, value.clueLedger, episodeNumber); }
              catch (error) { context.addIssue({ code: "custom", path: ["clueLedger"], message: String(error) }); }
            }),
            `你是连续故事编辑，只调整尚未发布的本集季纲，不能改写已发布事实。只返回一个 JSON 对象。${episodeEndingInstruction(episodeNumber === options.episodes)}\n完整根对象模板：${continuityRepairRootTemplate}\n线索原文：${JSON.stringify(plan.clueLedger)}。必须始终返回 episode 和 clueLedger 两个根字段。episode 只能含模板中的 11 个具体行动字段；clueLedger 必须包含全部原线索，每项只能含 id、clue、misdirection、payoff。若线索文字无需修改，就逐项复制这四个允许字段。不得返回 introducedIn、usedIn、payoffIn；章节安排由程序保留。以上文真实动作、位置、已知事实为准校正尚未回收线索的文字描述。已经发生的发现不能重新安排为首次发现；回收应增加解释或解决结果，不重复展示已完成动作。必须同步修改 episode 中依赖这些线索的目标和合作动作，不能只改摘要而留下冲突任务。保留主问题，不引入额外支线。不要返回 handoff，程序会直接从已发布正文建立交接事实。`,
            `${serialReadingContext(options.publishedStoryContext, episodeNumber === options.episodes)}\n整季真实原因与解法：${JSON.stringify(plan.narrativeSpine ?? { premise: plan.premise, seasonMystery: plan.seasonMystery })}\n本集旧季纲：${JSON.stringify(plan.episodes[index])}\n后续计划：${JSON.stringify(plan.episodes.slice(index + 1))}\n严格按完整根对象模板返回。episode 不得返回 title、episodeMission、newInformation、irreversibleChange、number、mustNotRepeat、entryBridge；这些章节分工与交接字段由程序保留并合并。第一段可以直接从上一集结尾后的状态开始，不要求展示人物如何到达季纲预想的位置；只要移动、物件来源和行动原因在本集正文中可理解即可。可以暂缓谜底，但必须保留疑问的明确状态。人物已知事实不可倒退；旧季纲与正文冲突时调整具体行动写法，保留一个中心目标，不能增加分支。`,
            options.reviewModel || options.model, options.reviewTemperature,
            { ...semanticPlanningModelPolicy(options), maxCompletionTokens: 4096 });
          if (adapted.clueLedger.length > 0) {
            plan.clueLedger = reconcileClueLedger(plan.clueLedger, adapted.clueLedger, episodeNumber);
          }
          const nextBeat = { ...plan.episodes[index], ...adapted.episode };
          plan.episodes[index] = {
            ...nextBeat,
            entryBridge: groundedEntryBridge(
              options.publishedStoryContext,
              nextBeat.goal,
            ),
          };
          validateSeriesPlan(plan, options.episodes);
          // Scores and revision advice based on the old contract cannot be reused.
          activeEpisode = undefined;
          rejectedElite = undefined;
          discardedDraftLessons = [];
          saveCheckpoint();
          options.log(`[${episodeNumber}/${options.episodes}] 已同步校正章节季纲与线索账本，并清除旧合同的草稿评分和修稿建议；已发布正文保持不变，续跑按正文指纹与合同版本复用。`);
        }
        let savedActive = activeEpisode?.index === index ? activeEpisode : undefined;
        localRepairAttempts = {
          ...(savedActive?.localRepairAttempts
            ?? savedStaged?.localRepairAttempts
            ?? { metadata: 0, lexical: savedActive?.lexicalRepairExhausted ? 1 : 0 }),
        };
        if (savedStaged?.stage === "metadata_pending") {
          options.log(
            `[${episodeNumber}/${options.episodes}] 恢复已严选正文 ${savedStaged.textHash.slice(0, 12)}，`
            + "跳过候选生成，只继续补齐元数据。",
          );
          const metadata = await completeEpisodeMetadata(
            options, plan, episodeNumber, episodePrevious, savedStaged.narrative,
          );
          const restoredEpisode = mergeEpisodeStructure(savedStaged.narrative, metadata);
          if (!restoredEpisode) throw new Error(`第 ${episodeNumber} 集已保存正文与元数据合并失败`);
          const restoredQuality = assessRuntimeStoryQuality(
            restoredEpisode, options, episodeNumber, lexical, plan, episodePrevious,
          );
          saveCheckpoint({
            index,
            stage: "semantic_reviewed",
            episode: restoredEpisode,
            quality: restoredQuality,
            critique: savedStaged.critique,
            semanticReview: savedStaged.semanticReview ?? savedStaged.critique,
            fullRewriteCount: savedStaged.fullRewriteCount,
            mechanicalRepairUsed: savedStaged.mechanicalRepairUsed,
            semanticRewriteUsed: savedStaged.semanticRewriteUsed,
            lexicalRepairExhausted: savedStaged.lexicalRepairExhausted,
          });
          savedActive = activeEpisode;
        }
        if (!savedActive && !savedStaged && rejectedElite?.index === index
          && (rejectedElite.critique.plot.score < 7 || rejectedElite.critique.continuity.score < 7)
          && !replannedEpisodes.has(episodeNumber)) {
          reportProgress(options, "planning", `第 ${episodeNumber} 集因果或连续性反复未达标，正在校正本集季纲（最多一次）`, episodeProgress(options, index, 0));
          const oldBeat = plan.episodes[index];
          const repaired = await callStructured(options, continuityRepairPatchSchema,
            "你是短篇分级故事总编，只修复尚未发布的一集季纲。不得改变已发布正文、核心人物、已有线索及其真相。",
            `读者：${gradedReadingBrief(options)}\n篇幅：${JSON.stringify(storyWordLimits(options, episodeNumber))}\n已发布章节（唯一事实依据）：${JSON.stringify(generated.map((item) => ({ title: item.title, paragraphs: item.paragraphs })))}\n原系列策划：${JSON.stringify(plan)}\n本集低分评审：${JSON.stringify(rejectedElite.critique)}\n请修复第 ${episodeNumber} 集：压缩为一个中心场景、一个目标、一项有代价的选择、一次可见的合作结果。明确真实因果，不能让旁观者从几个无关物件凭空推知完整真相。需要的人物可以通过观察、直接展示、说话等已建立机制获取信息。所有关键物件的位置以正文为准。把互相依赖的线索合并到同一行动里回收，不安排独立支线和复杂政策/身份解释。必须完成原核心救助或解谜目标，不能靠略去答案过关。终集收束主谜题和人物关系，不强制新增风险。完整根对象模板：${continuityRepairRootTemplate}。必须返回 episode 与 clueLedger；episode 只能含模板中的 11 个具体行动字段，clueLedger 逐项复制原线索的四个允许字段。不得返回 title、episodeMission、newInformation、irreversibleChange、number、mustNotRepeat、entryBridge、introducedIn、usedIn、payoffIn，这些章节分工、交接与排期字段由程序保留并合并。`,
            options.reviewModel || options.model, 0.25,
            { timeoutMs: options.timeoutMs, networkRetries: 1, structureRetries: 2, maxCompletionTokens: 3072, disableThinking: true });
          plan.episodes[index] = { ...oldBeat, ...repaired.episode };
          validateSeriesPlan(plan, options.episodes);
          replannedEpisodes.add(episodeNumber);
          rejectedElite = undefined;
          discardedDraftLessons = [];
          saveCheckpoint();
          options.log(`[${episodeNumber}/${options.episodes}] 已基于已发布正文完成本集唯一一次季纲校正，已保存检查点；保留所有已发布章节和线索账本。`);
        }
        if (savedActive) {
          const exhaustedQuality = assessRuntimeStoryQuality(
            savedActive.episode,
            options,
            episodeNumber,
            lexical,
            plan,
            episodePrevious,
          );
          const exhaustedBaseline = index > 0 ? semanticReviews[0] : null;
          const exhaustedSemanticIssues = savedActive.semanticReview
            ? semanticQualityIssues(savedActive.semanticReview, exhaustedBaseline)
            : [];
          const exhaustedSemanticPublishIssues = savedActive.semanticReview
            ? semanticPublishIssues(savedActive.semanticReview, exhaustedBaseline)
            : [];
          const savedGateReview = savedActive.semanticReview ?? savedActive.critique;
          const rejectedByEarlyStrictGate = Boolean(
            savedGateReview
            && !savedActive.mechanicalRepairUsed
            && !isStrictStoryCritique(savedGateReview, exhaustedBaseline),
          );
          const pendingMechanicalRescue = savedActive.mechanicalRepairUsed
            && !savedActive.lexicalRepairExhausted
            && savedActive.fullRewriteCount < 4
            && !passesStoryQualityFloor(exhaustedQuality, options.minLexicalCoverage)
            && Boolean(savedActive.critique);
          const pendingFinalSemanticReview = savedActive.stage === "mechanical_repaired"
            && passesStoryQualityFloor(exhaustedQuality, options.minLexicalCoverage)
            && Boolean(savedActive.critique);
          const pendingSemanticRescue = savedActive.stage === "semantic_reviewed"
            && exhaustedSemanticIssues.length > 0
            && !savedActive.mechanicalRepairUsed
            && savedActive.fullRewriteCount < 2;
          const savedRepairKind = chooseRepairKind(exhaustedQuality, options.minLexicalCoverage);
          const pendingMetadataRescue = exhaustedSemanticIssues.length === 0
            && (savedRepairKind === "metadata" || savedRepairKind === "lexical")
            && canAttemptRepair(savedRepairKind, localRepairAttempts, savedActive.fullRewriteCount);
          const rejectedAfterRepair = savedActive.stage === "semantic_reviewed"
            && exhaustedSemanticPublishIssues.length > 0
            && (savedActive.semanticRewriteUsed || savedActive.mechanicalRepairUsed)
            && !pendingMechanicalRescue
            && !pendingFinalSemanticReview
            && !pendingSemanticRescue
            && !pendingMetadataRescue;
          const exhaustedRewriteBudget = (
            Boolean(savedActive.lexicalRepairExhausted)
            && !passesStoryQualityFloor(exhaustedQuality, options.minLexicalCoverage)
            && !pendingMetadataRescue
          ) || (
            savedActive.fullRewriteCount >= 4
            && !passesStoryQualityFloor(exhaustedQuality, options.minLexicalCoverage)
            && !pendingMetadataRescue
          ) || (
            savedActive.fullRewriteCount >= 2
            && exhaustedSemanticPublishIssues.length > 0
            && !pendingMechanicalRescue
            && !pendingFinalSemanticReview
            && !pendingMetadataRescue
          );
          if (
            rejectedByEarlyStrictGate
            || rejectedAfterRepair
            || exhaustedRewriteBudget
          ) {
            discardedDraftLessons = buildDiscardedDraftLessons(
              savedActive,
              exhaustedQuality,
              discardedDraftLessons,
            );
            const rejectedNarrative = episodeNarrativeSchema.safeParse({
              title: savedActive.episode.title,
              paragraphs: savedActive.episode.paragraphs,
            });
            const rejectedReview = savedActive.semanticReview ?? savedActive.critique;
            if (savedActive.lexicalRepairExhausted && rejectedElite?.index === index) {
              rejectedElite = undefined;
              options.log(`[${episodeNumber}/${options.episodes}] 已隔离词汇修复耗尽的旧稿，本轮不再将其恢复为精英候选。`);
            }
            if (
              rejectedNarrative.success
              && canReuseLexicalElite(exhaustedQuality, options.minLexicalCoverage, savedActive.lexicalRepairExhausted)
              && rejectedReview
              && (!rejectedElite || rejectedElite.index !== index
                || isCritiqueBetter(rejectedReview, rejectedElite.critique))
            ) {
              rejectedElite = {
                index,
                narrative: rejectedNarrative.data,
                critique: rejectedReview,
              };
              options.log(
                `[${episodeNumber}/${options.episodes}] 本稿虽因词汇或后续门禁未发布，但保留其 `
                + `${critiqueAverage(rejectedReview).toFixed(2)} 分正文作为下一次精英候选，避免丢失好稿。`,
              );
            }
            options.log(
              `[${episodeNumber}/${options.episodes}] 已保存稿修复后仍未通过质量门禁，`
              + `已沉淀 ${discardedDraftLessons.length} 条失败经验；保留前面已完成章节，`
              + `丢弃本集坏稿并重新生成 ${options.episodeCandidates} 份候选。`,
            );
            savedActive = undefined;
            localRepairAttempts = { metadata: 0, lexical: 0 };
            saveCheckpoint();
          }
        }
        let episode: GeneratedStoryContent;
        let quality: StoryQuality;
        let critique: StoryCritique | undefined;
        let semanticReview: StoryCritique | undefined;
        let fullRewriteCount = savedActive?.fullRewriteCount ?? 0;
        let mechanicalRepairUsed = savedActive?.mechanicalRepairUsed ?? false;
        let semanticRewriteUsed = savedActive?.semanticRewriteUsed ?? false;
        let lexicalRepairExhausted = Boolean(savedActive?.lexicalRepairExhausted);
        let resumingMechanicalRescue = false;

        if (savedActive) {
          episode = savedActive.episode;
          critique = savedActive.critique;
          semanticReview = savedActive.semanticReview;
          quality = assessRuntimeStoryQuality(episode, options, episodeNumber, lexical, plan, episodePrevious);
          resumingMechanicalRescue = mechanicalRepairUsed
            && !lexicalRepairExhausted
            && fullRewriteCount < 4
            && !passesStoryQualityFloor(quality, options.minLexicalCoverage)
            && Boolean(critique);
          if (resumingMechanicalRescue && critique) {
            semanticReview = critique;
            options.log(
              `[${episodeNumber}/${options.episodes}] 中间机械稿尚未达标，`
              + "复用修稿前已通过的候选评审，先完成剩余机械修复再做终审。",
            );
          }
          options.log(
            `[${episodeNumber}/${options.episodes}] 从 ${savedActive.stage} 阶段继续，`
            + `已使用完整重写 ${fullRewriteCount}/4 次。`,
          );
        } else {
          const draft = await generateEpisodeDraft(
            options,
            plan,
            index,
            episodePrevious,
            index > 0 ? semanticReviews[0] : null,
            discardedDraftLessons,
            1,
            rejectedElite?.index === index ? rejectedElite : null,
            (lessons, elite) => {
              discardedDraftLessons = lessons;
              rejectedElite = elite ? { index, ...elite } : undefined;
              saveCheckpoint();
            },
          );
          critique = draft.critique;
          // generateEpisodeDraft only returns a direct, borderline, or
          // synthesized narrative after a single-article review. Reuse that
          // verdict for the unchanged text instead of scoring it again and
          // risking random disagreement between identical review calls.
          semanticReview = draft.critique;
          discardedDraftLessons = draft.discardedDraftLessons;
          rejectedElite = undefined;
          saveStagedEpisode({
            index,
            stage: "metadata_pending",
            narrative: draft.narrative,
            critique,
            semanticReview,
            textHash: episodeNarrativeHash(draft.narrative),
            source: "selected",
            fullRewriteCount,
            mechanicalRepairUsed,
            semanticRewriteUsed,
            lexicalRepairExhausted,
          });
          reportProgress(
            options,
            "drafting",
            `第 ${episodeNumber} 集正文已保存，正在单独生成连续性状态和质量证据`,
            episodeProgress(options, index, 0.52),
          );
          const metadata = await completeEpisodeMetadata(
            options, plan, episodeNumber, episodePrevious, draft.narrative,
          );
          const materialized = mergeEpisodeStructure(draft.narrative, metadata);
          if (!materialized) throw new Error(`第 ${episodeNumber} 集最佳正文与元数据合并失败`);
          episode = materialized;
          quality = assessRuntimeStoryQuality(episode, options, episodeNumber, lexical, plan, episodePrevious);
          saveCheckpoint({
            index,
            stage: "semantic_reviewed",
            episode,
            quality,
            critique,
            semanticReview,
            fullRewriteCount,
            mechanicalRepairUsed,
            semanticRewriteUsed,
          });
        }

        if (!semanticReview) {
          reportProgress(
            options,
            "reviewing",
            `第 ${episodeNumber} 集已从候选中选出，正在进行独立剧情与连续性终审`,
            episodeProgress(options, index, 0.58),
          );
          semanticReview = await reviewEpisodeSemantics(
            options,
            plan,
            episode,
            episodeNumber,
            episodePrevious,
          );
          if (!semanticReview) throw new Error(`第 ${episodeNumber} 集检查点缺少初稿评审`);
          saveCheckpoint({
            index,
            stage: "semantic_reviewed",
            episode,
            quality,
            critique,
            semanticReview,
            fullRewriteCount,
            mechanicalRepairUsed,
            semanticRewriteUsed,
          });
        }
        if (!semanticReview) throw new Error(`第 ${episodeNumber} 集检查点缺少语义评审`);

        const firstEpisodeBaseline = index > 0 ? semanticReviews[0] : null;
        let semanticIssues = semanticQualityIssues(semanticReview, firstEpisodeBaseline);
        if (
          !semanticIssues.length
          && !semanticRewriteUsed
          && !mechanicalRepairUsed
          && critiqueAverage(semanticReview) < storyGenerationPolicy.review.skipOptionalOptimizationAtAverage
          && hasEditorialOpportunities(semanticReview)
        ) {
          reportProgress(
            options,
            "editing",
            `第 ${episodeNumber} 集已通过 7/7.5 严选，正在用“思考规划 + 直接执行”尝试一次增益优化`,
            episodeProgress(options, index, 0.66),
          );
          const selectedEpisode = episode;
          const selectedQuality = quality;
          const selectedReview = semanticReview;
          semanticRewriteUsed = true;
          fullRewriteCount += 1;
          // Persist consumption before the optional network path. A restart
          // must not loop on a non-essential enhancement.
          saveCheckpoint({
            index,
            stage: "semantic_reviewed",
            episode: selectedEpisode,
            quality: selectedQuality,
            critique,
            semanticReview: selectedReview,
            fullRewriteCount,
            mechanicalRepairUsed,
            semanticRewriteUsed,
          });
          const optimized = await runOptionalStage(
            {
              episode: selectedEpisode,
              semanticReview: selectedReview,
              quality: selectedQuality,
              adopted: false,
            },
            async () => {
              const optimizedNarrative = await rewriteEpisodeSemanticsWithPlan(
                options,
                plan,
                selectedEpisode,
                selectedReview,
                episodeNumber,
                episodePrevious,
              );
              const optimizedReview = await reviewEpisodeSemantics(
                options,
                plan,
                optimizedNarrative,
                episodeNumber,
                episodePrevious,
              );
              if (!isStoryCritiqueImprovement(optimizedReview, selectedReview, firstEpisodeBaseline)) {
                options.log(
                  `[${episodeNumber}/${options.episodes}] 增益优化未同时满足“仍通过 7/7.5 门禁且均分高于原稿”，`
                  + `已丢弃优化稿并保留严选原稿（原稿 ${critiqueAverage(selectedReview).toFixed(2)}，优化稿 ${critiqueAverage(optimizedReview).toFixed(2)}）。`,
                );
                return {
                  episode: selectedEpisode,
                  semanticReview: selectedReview,
                  quality: selectedQuality,
                  adopted: false,
                };
              }
              saveStagedEpisode({
                index,
                stage: "metadata_pending",
                narrative: optimizedNarrative,
                critique: critique ?? optimizedReview,
                semanticReview: optimizedReview,
                textHash: episodeNarrativeHash(optimizedNarrative),
                source: "optional_optimization",
                fullRewriteCount,
                mechanicalRepairUsed,
                semanticRewriteUsed,
                lexicalRepairExhausted,
              });
              const optimizedEpisode = await materializeReviewedNarrative(
                options,
                plan,
                optimizedNarrative,
                episodeNumber,
                episodePrevious,
              );
              return {
                episode: optimizedEpisode,
                semanticReview: optimizedReview,
                quality: assessRuntimeStoryQuality(optimizedEpisode, options, episodeNumber, lexical, plan, episodePrevious),
                adopted: true,
              };
            },
            (error) => options.log(
              `[${episodeNumber}/${options.episodes}] 可选增益优化失败，已降级保留原有合格稿并继续连读与命题：`
              + modelRequestError(error),
            ),
          );
          episode = optimized.episode;
          semanticReview = optimized.semanticReview;
          quality = optimized.quality;
          if (optimized.adopted) {
            options.log(
              `[${episodeNumber}/${options.episodes}] 增益优化已采用：四维均分从 `
              + `${critiqueAverage(selectedReview).toFixed(2)} 提升到 ${critiqueAverage(semanticReview).toFixed(2)}。`,
            );
          }
          saveCheckpoint({
            index,
            stage: "semantic_reviewed",
            episode,
            quality,
            critique,
            semanticReview,
            fullRewriteCount,
            mechanicalRepairUsed,
            semanticRewriteUsed,
          });
          semanticIssues = semanticQualityIssues(semanticReview, firstEpisodeBaseline);
        }
        while (semanticIssues.length && !mechanicalRepairUsed && fullRewriteCount < 2) {
          if (!semanticReview) throw new Error(`第 ${episodeNumber} 集剧情语义重写前缺少评审`);
          reportProgress(
            options,
            "repairing",
            `第 ${episodeNumber} 集正在先进行第 ${fullRewriteCount + 1}/2 次完整重写（剧情语义）`,
            episodeProgress(options, index, 0.68),
          );
          semanticRewriteUsed = true;
          const episodeBeforeSemanticRepair = episode;
          const qualityBeforeSemanticRepair = quality;
          const reviewBeforeSemanticRepair: StoryCritique = semanticReview;
          const repairedNarrative = await rewriteEpisodeSemanticsWithPlan(
            options,
            plan,
            episode,
            semanticReview,
            episodeNumber,
            episodePrevious,
          );
          fullRewriteCount += 1;
          const repairedReview = await reviewEpisodeSemantics(
            options,
            plan,
            repairedNarrative,
            episodeNumber,
            episodePrevious,
          );
          if (isSemanticRepairProgress(repairedReview, reviewBeforeSemanticRepair, firstEpisodeBaseline)) {
            saveStagedEpisode({
              index,
              stage: "metadata_pending",
              narrative: repairedNarrative,
              critique: critique ?? repairedReview,
              semanticReview: repairedReview,
              textHash: episodeNarrativeHash(repairedNarrative),
              source: "required_repair",
              fullRewriteCount,
              mechanicalRepairUsed,
              semanticRewriteUsed,
              lexicalRepairExhausted,
            });
            episode = await materializeReviewedNarrative(
              options,
              plan,
              repairedNarrative,
              episodeNumber,
              episodePrevious,
            );
            quality = assessRuntimeStoryQuality(
              episode,
              options,
              episodeNumber,
              lexical,
              plan,
              episodePrevious,
            );
            semanticReview = repairedReview;
            options.log(
              `[${episodeNumber}/${options.episodes}] 第 ${fullRewriteCount}/2 次剧情语义重写取得单调改进：`
              + `均分 ${critiqueAverage(reviewBeforeSemanticRepair).toFixed(2)} → ${critiqueAverage(repairedReview).toFixed(2)}。`,
            );
          } else {
            episode = episodeBeforeSemanticRepair;
            quality = qualityBeforeSemanticRepair;
            semanticReview = reviewBeforeSemanticRepair;
            options.log(
              `[${episodeNumber}/${options.episodes}] 第 ${fullRewriteCount}/2 次剧情语义重写没有缩小门禁差距`
              + `（原稿 ${critiqueAverage(reviewBeforeSemanticRepair).toFixed(2)}，新稿 ${critiqueAverage(repairedReview).toFixed(2)}）；`
              + "已丢弃退化稿，下一次仍从当前最佳稿继续。",
            );
          }
          saveCheckpoint({
            index,
            stage: "semantic_reviewed",
            episode,
            quality,
            critique,
            semanticReview,
            fullRewriteCount,
            mechanicalRepairUsed,
            semanticRewriteUsed,
          });
          semanticIssues = semanticQualityIssues(semanticReview, firstEpisodeBaseline);
        }
        if (!semanticReview) throw new Error(`第 ${episodeNumber} 集定稿前缺少语义评审`);
        if (semanticIssues.length) {
          throw new Error(`第 ${episodeNumber} 集语义质量未达标：严格门禁要求四项至少 7 分且均分至少 7.5（${semanticIssues.join("；")}）`);
        }

        while (!passesStoryQualityFloor(quality, options.minLexicalCoverage)) {
          const repairKind = chooseRepairKind(quality, options.minLexicalCoverage);
          const onlyLexicalCoverageBlocksPublication = repairKind === "lexical";
          if (!canAttemptRepair(repairKind, localRepairAttempts, fullRewriteCount)) {
            lexicalRepairExhausted = repairKind === "lexical";
            options.log(
              `[${episodeNumber}/${options.episodes}] ${repairKind} 修复额度已耗尽；停止同稿重复操作，保留正文与独立计数。`,
            );
            saveCheckpoint({
              index,
              stage: "mechanical_repaired",
              episode,
              quality,
              critique,
              semanticReview,
              fullRewriteCount,
              mechanicalRepairUsed,
              semanticRewriteUsed,
              lexicalRepairExhausted,
            });
            break;
          }
          reportProgress(
            options,
            "repairing",
            onlyLexicalCoverageBlocksPublication
              ? `第 ${episodeNumber} 集剧情已通过，正在进行唯一一次等长局部换词`
              : repairKind === "metadata"
                ? `第 ${episodeNumber} 集正在修复元数据（独立额度，不消耗全文重写次数）`
                : `第 ${episodeNumber} 集剧情已通过，正在进行第 ${fullRewriteCount + 1}/4 次完整重写（最终结构与词汇）`,
            episodeProgress(options, index, 0.84),
          );
          mechanicalRepairUsed = true;
          const episodeBeforeMechanicalRepair = episode;
          const qualityBeforeMechanicalRepair = quality;
          const narrativeBeforeMechanicalRepair = JSON.stringify({
            title: episode.title,
            paragraphs: episode.paragraphs,
          });
          const semanticReviewBeforeMechanicalRepair: StoryCritique | undefined = semanticReview;
          // Persist the attempt before the network call so interruption cannot reset it.
          if (repairKind === "metadata" || repairKind === "lexical") localRepairAttempts[repairKind] += 1;
          else fullRewriteCount += 1;
          saveCheckpoint({ index, stage: "semantic_reviewed", episode, quality, critique, semanticReview,
            fullRewriteCount, mechanicalRepairUsed, semanticRewriteUsed, lexicalRepairExhausted });
          const repairCheckpointReview = semanticReview ?? critique;
          if (!repairCheckpointReview) throw new Error(`第 ${episodeNumber} 集机械修复前缺少评审`);
          const repairedEpisode = await repairEpisode(
            options,
            plan,
            episode,
            episodeNumber,
            quality,
            episodePrevious,
            (narrative) => saveStagedEpisode({
              index,
              stage: "metadata_pending",
              narrative,
              critique: critique ?? repairCheckpointReview,
              semanticReview: repairCheckpointReview,
              textHash: episodeNarrativeHash(narrative),
              source: "required_repair",
              fullRewriteCount,
              mechanicalRepairUsed,
              semanticRewriteUsed,
              lexicalRepairExhausted,
            }),
          );
          const repairedQuality = assessRuntimeStoryQuality(
            repairedEpisode,
            options,
            episodeNumber,
            lexical,
            plan,
            episodePrevious,
          );
          if (!shouldAdoptMechanicalRepair(qualityBeforeMechanicalRepair, repairedQuality, options.minLexicalCoverage)) {
            episode = episodeBeforeMechanicalRepair;
            quality = qualityBeforeMechanicalRepair;
            options.log(
              `[${episodeNumber}/${options.episodes}] 本次最终结构与词汇修稿发生退化`
              + `（${repairedQuality.wordCount} 词，覆盖率 ${repairedQuality.lexicalCoverage === null ? "未检测" : `${(repairedQuality.lexicalCoverage * 100).toFixed(1)}%`}）；`
              + `已丢弃修稿并保留原文（${quality.wordCount} 词），不会让坏稿覆盖检查点。`,
            );
            saveCheckpoint({
              index,
              stage: "semantic_reviewed",
              episode,
              quality,
              critique,
              semanticReview,
              fullRewriteCount,
              mechanicalRepairUsed,
              semanticRewriteUsed,
            });
            continue;
          }
          episode = repairedEpisode;
          quality = repairedQuality;
          saveCheckpoint({
            index,
            stage: "mechanical_repaired",
            episode,
            quality,
            critique,
            fullRewriteCount,
            mechanicalRepairUsed,
            semanticRewriteUsed,
          });
          if (passesStoryQualityFloor(quality, options.minLexicalCoverage)) {
            const narrativeAfterMechanicalRepair = JSON.stringify({
              title: episode.title,
              paragraphs: episode.paragraphs,
            });
            if (
              narrativeAfterMechanicalRepair === narrativeBeforeMechanicalRepair
              && semanticReviewBeforeMechanicalRepair
            ) {
              semanticReview = semanticReviewBeforeMechanicalRepair;
              options.log(
                `[${episodeNumber}/${options.episodes}] 本轮只修复元数据，英文正文未变化；`
                + "复用已通过的语义评分，避免同文重复评审产生随机降分。",
              );
            } else {
              reportProgress(
                options,
                "reviewing",
                `第 ${episodeNumber} 集最终结构修稿完成，正在确认剧情未发生退化`,
                episodeProgress(options, index, 0.92),
              );
              semanticReview = await reviewEpisodeSemantics(
                options,
                plan,
                episode,
                episodeNumber,
                episodePrevious,
              );
            }
            if (!semanticReview) throw new Error(`第 ${episodeNumber} 集结构修稿后缺少语义评审`);
            saveCheckpoint({
              index,
              stage: "semantic_reviewed",
              episode,
              quality,
              critique,
              semanticReview,
              fullRewriteCount,
              mechanicalRepairUsed,
              semanticRewriteUsed,
            });
            semanticIssues = semanticQualityIssues(semanticReview, firstEpisodeBaseline);
            if (semanticIssues.length) {
              episode = episodeBeforeMechanicalRepair;
              quality = qualityBeforeMechanicalRepair;
              semanticReview = semanticReviewBeforeMechanicalRepair;
              options.log(
                `[${episodeNumber}/${options.episodes}] 最终结构修稿虽通过机械门禁，但语义复评退化（${semanticIssues.join("；")}）；`
                + "已回退到严选原稿及其原始评分，继续走有界修复，不再把同一篇合格候选误判为坏稿。",
              );
              saveCheckpoint({
                index,
                stage: "semantic_reviewed",
                episode,
                quality,
                critique,
                semanticReview,
                fullRewriteCount,
                mechanicalRepairUsed,
                semanticRewriteUsed,
              });
              continue;
            }
          }
        }

        if (!passesStoryQualityFloor(quality, options.minLexicalCoverage)) {
          const metadataOnly = chooseRepairKind(quality, options.minLexicalCoverage) === "metadata";
          throw new StoryGenerationFailure(
            `第 ${episodeNumber} 集最终结构与词汇修稿后仍未达标：${quality.issues.join("；")}`,
            metadataOnly ? "METADATA_EVIDENCE_GATE" : "FINAL_QUALITY_GATE",
            metadataOnly ? "metadata" : "lexical",
            "same_text",
          );
        }
        if (!meetsQualityTarget(quality, options.minLexicalCoverage)) {
          options.log(
            `[${episodeNumber}/${options.episodes}] 高频词覆盖未达到 ${(options.minLexicalCoverage * 100).toFixed(0)}% 的优化目标，`
            + "但已达到发布底线（含最多 1 个词的词典或舍入容差），保留少量可查目标词并继续。",
          );
        }
        reportProgress(options, "reviewing", `第 ${episodeNumber} 集正在与已发布章节连读，检查核心悬念和因果收束`, episodeProgress(options, index, 0.97));
        const serialIssues = await callStructured(options,
          groundedSerialAuditSchema([...options.publishedStoryContext!, episode]),
          "你是独立连载故事编辑。只报告让读者无法理解主线的实质因果问题，不做文风打分。只返回包含 handoffs 和 issues 数组的 JSON 对象。fromEpisode、episodeNumber、paragraphNumber 必须为整数，handled 必须为布尔值。接缝仅取输入明确列出的相邻章节，不得从季纲推测尚未提供的章节。",
          `${serialReadingContext(options.publishedStoryContext!, episodeNumber === options.episodes)}\n${serialSeamContext([...options.publishedStoryContext!, episode])}\n整季主线：${JSON.stringify(plan.narrativeSpine ?? null)}\n当前稿：${JSON.stringify({ title: episode.title, paragraphs: episode.paragraphs })}\n返回 {handoffs:[],issues:[]}。handoffs 对每个相邻接缝必须返回 {fromEpisode,handled,explanation}；第一集为空数组。核对眼前危险/待办在指定下一集如何处理或明确暂缓，不能用终集替代中间集。只有类似物件或主题不算承接，没有明确证据则 handled=false，禁止自行补过程。其他实质问题放 issues，最多4项 {kind,episodeNumber,paragraphNumber,explanation}；位置从1开始。kind 仅为 dropped_promise、unearned_rule、missing_cause、unproven_resolution、insufficient_sensory。同时从本集完整正文语义核对至少两种服务剧情的感官描写，不能按关键词表计数，也不能已具备两种还要求第三种；若确实不足，返回 insufficient_sensory 并定位真实段落说明缺口。不要抄原文，由程序核对引用位置。不要求背景复述或非终集揭谜；已发布文字不改，只指出当前集应处理的缺口。`,
          options.reviewModel || options.model, options.reviewTemperature,
          { ...semanticPlanningModelPolicy(options), networkRetries: 1, structureRetries: 2, maxCompletionTokens: 4096 });
        if (serialIssues.issues.length) {
          const lessons = serialIssues.issues.map((issue) => `整季连读 ${issue.kind}：${issue.explanation}`);
          discardedDraftLessons = [...discardedDraftLessons, ...lessons].slice(-20);
          rejectedElite = undefined;
          saveCheckpoint();
          throw new StoryGenerationFailure(`第 ${episodeNumber} 集连读未通过：${lessons.join("；")}`, "SERIAL_NARRATIVE_GATE", "narrative", "new_candidates");
        }
        options.log(`[${episodeNumber}/${options.episodes}] 已通过已发布 ${generated.length} 集与当前稿的连读检查。`);
        saveStagedEpisode({
          index,
          stage: "questions_pending",
          episode,
          quality,
          critique,
          semanticReview,
          textHash: episodeNarrativeHash(episode),
          fullRewriteCount,
          mechanicalRepairUsed,
          semanticRewriteUsed,
          lexicalRepairExhausted,
        });
        reportProgress(
          options,
          "reviewing",
          `第 ${episodeNumber} 集正文已定稿，正在单独生成阅读题`,
          episodeProgress(options, index, 0.98),
        );
        const completed = await completeQuestions(index, episode, semanticReview, episodePrevious);
        saveStagedEpisode({
          index,
          stage: "ready_to_publish",
          episode: completed.episode,
          quality: completed.quality,
          semanticReview: completed.semanticReview,
          textHash: episodeNarrativeHash(completed.episode),
          fullRewriteCount,
          mechanicalRepairUsed,
          semanticRewriteUsed,
          lexicalRepairExhausted,
        });
        finalizeEpisode(index, completed.episode, completed.quality, completed.semanticReview);
      }
    } finally {
      dictionary?.close();
    }
    reportProgress(options, "saving", "全部章节已上架，正在完成故事书架整理", 96);
    return {
      generated: generated.length,
      imported: articleIds.length,
      articleIds,
      seriesTitle: plan.seriesTitle,
      qualities,
    };
  } finally {
    db.close();
  }
}
