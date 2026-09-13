import { readFileSync } from "node:fs";
import { z } from "zod";
import type { Question } from "../../../client/src/types";
import { createDatabase } from "../../src/database";
import { importArticles } from "../../src/content-import";
import type { StoryGenerationProgress, StoryRunOptions } from "./pipeline";
import { callStructured } from "./model-client";
import {
  ClassicPipelineError,
  loadClassicAsset,
  projectReferencePath,
  resolveClassicProfile,
  sha256,
  type ClassicAsset,
  type ClassicProfile,
} from "./classic-assets";

const chapterSchema = z.object({
  title: z.string().trim().min(2).max(160),
  paragraphs: z.array(z.string().trim().min(10).max(12_000)).min(1).max(20),
}).strict();

export const classicNarrativeSchema = z.object({
  title: z.string().trim().min(2).max(160),
  chapters: z.array(chapterSchema).min(1).max(12),
}).strict();

function finalChapterEndingIssue(narrative: z.infer<typeof classicNarrativeSchema>) {
  const last = narrative.chapters.at(-1)?.paragraphs.at(-1)?.trim() ?? "";
  if (/\b(?:to be continued|continued)\b\s*[.!…]*$/i.test(last)) return "The final chapter must resolve the selected source range, not continue later.";
  if (/[,;:][”"']?\s*$/.test(last)) return "The final paragraph ends with dangling punctuation and must be completed.";
  return "";
}

export const classicPublishableNarrativeSchema = classicNarrativeSchema.superRefine((narrative, context) => {
  const issue = finalChapterEndingIssue(narrative);
  if (issue) context.addIssue({ code: "custom", path: ["chapters", narrative.chapters.length - 1, "paragraphs"], message: issue });
});

const sourceConflictSchema = z.object({
  error: z.object({
    code: z.literal("SOURCE_CONFLICT"),
    message: z.string().trim().min(8).max(1000),
  }).strict(),
}).strict();

export const classicEditorProviderSchema = z.object({
  title: classicNarrativeSchema.shape.title.optional(),
  chapters: classicNarrativeSchema.shape.chapters.optional(),
  error: sourceConflictSchema.shape.error.optional(),
}).strict();

const editedNarrativeSchema = z.union([classicPublishableNarrativeSchema, sourceConflictSchema]);

const generatedQuestionSchema = z.object({
  type: z.enum(["detail", "inference", "cause_effect"]),
  prompt: z.string().trim().min(3).max(500),
  options: z.array(z.string().trim().min(1).max(300)).length(4),
  answer: z.number().int().min(0).max(3),
  explanation: z.string().trim().min(3).max(1000),
  evidence: z.string().trim().min(3).max(1000),
}).strict();

const learningSchema = z.object({
  chapters: z.array(z.object({
    chapterNumber: z.number().int().min(1).max(12),
    questions: z.array(generatedQuestionSchema).length(2),
  }).strict()).min(1).max(12),
}).strict();

const classicStageSchema = z.enum(["source_ready", "drafted", "edited", "learning_ready", "published"]);
export type ClassicStage = z.infer<typeof classicStageSchema>;

const referencesSchema = z.object({
  storyBibleHash: z.string().length(64),
  storyBibleExcerpt: z.string().min(20),
  demoHash: z.string().length(64),
  demoTitle: z.string().min(1),
  demoExcerpt: z.string().min(20),
}).strict();

export const classicCheckpointSchema = z.object({
  type: z.literal("classic-adaptation"),
  pipelineVersion: z.literal("classic-v1"),
  workId: z.string().min(1),
  unitId: z.string().min(1),
  sourceVersion: z.string().min(1),
  sourceHash: z.string().length(64),
  baseVersion: z.string().min(1),
  readerStage: z.string().min(1),
  episodeCount: z.number().int().min(1),
  minWords: z.number().int().min(1),
  maxWords: z.number().int().min(1),
  references: referencesSchema,
  stage: classicStageSchema,
  draft: classicNarrativeSchema.optional(),
  final: classicNarrativeSchema.optional(),
  finalTextHash: z.string().length(64).optional(),
  learning: learningSchema.optional(),
  recoveryAttempts: z.object({ adaptation: z.number().int().min(0), editor: z.number().int().min(0), learning: z.number().int().min(0) }).strict(),
  failure: z.object({ code: z.string(), message: z.string() }).strict().optional(),
}).strict().superRefine((checkpoint, context) => {
  const stages = ["source_ready", "drafted", "edited", "learning_ready", "published"] as const;
  const atLeast = (stage: typeof stages[number]) => stages.indexOf(checkpoint.stage) >= stages.indexOf(stage);
  if (atLeast("drafted") && !checkpoint.draft) {
    context.addIssue({ code: "custom", path: ["draft"], message: "draft is required after drafted" });
  }
  if (atLeast("edited") && (!checkpoint.final || !checkpoint.finalTextHash)) {
    context.addIssue({ code: "custom", path: ["final"], message: "final and finalTextHash are required after edited" });
  }
  if (atLeast("learning_ready") && !checkpoint.learning) {
    context.addIssue({ code: "custom", path: ["learning"], message: "learning is required after learning_ready" });
  }
});

export type ClassicCheckpoint = z.infer<typeof classicCheckpointSchema>;

export type ClassicRunOptions = Omit<StoryRunOptions, "checkpoint" | "onCheckpoint" | "onEpisodeImported"> & {
  sourceMode: "classic";
  classicId: StoryRunOptions["classicId"];
  classicUnitId: string;
  checkpoint?: ClassicCheckpoint | null;
  onCheckpoint?: (checkpoint: ClassicCheckpoint) => void;
};

function narrativeRootExample(chapterCount: number) {
  return JSON.stringify({
    title: "The English Story Title",
    chapters: Array.from({ length: chapterCount }, (_, index) => ({
      title: index === chapterCount - 1 ? "The Final Chapter" : `Chapter ${index + 1}`,
      paragraphs: [index === chapterCount - 1
        ? "A complete English paragraph that resolves the selected source range."
        : "A complete English paragraph with clear source-based action."],
    })),
  }, null, 2);
}

function editorRootExamples(chapterCount: number) {
  return `${narrativeRootExample(chapterCount)}\nOR\n${JSON.stringify({
    error: { code: "SOURCE_CONFLICT", message: "A specific conflict that cannot be repaired without changing the source." },
  }, null, 2)}`;
}

function learningRootExample(chapterNumbers: number[]) {
  return JSON.stringify({
    chapters: chapterNumbers.map((chapterNumber) => ({
      chapterNumber,
      questions: [{
      type: "detail",
      prompt: "What did the character do?",
      options: ["Option A", "Option B", "Option C", "Option D"],
      answer: 0,
      explanation: "The final story directly says this.",
      evidence: "An exact short quote from this chapter.",
      }, {
        type: "cause_effect",
        prompt: "Why did the character act?",
        options: ["Option A", "Option B", "Option C", "Option D"],
        answer: 1,
        explanation: "The action follows from the stated cause.",
        evidence: "Another exact short quote from this chapter.",
      }],
    })),
  }, null, 2);
}

function readReferences() {
  try {
    const storyBible = readFileSync(projectReferencePath("story-bible.md"), "utf8");
    const demo = readFileSync(projectReferencePath("good-story-demo.md"), "utf8");
    const languageStart = storyBible.indexOf("## 好故事写作输入如下：");
    const serialStart = storyBible.indexOf("## 分集故事吸引人技巧");
    const part1 = demo.indexOf("Part 1: The Strange Signal");
    const part2 = demo.indexOf("Part 2: The Locked Door");
    const part3 = demo.indexOf("Part 3: The Vent Trap");
    if ([languageStart, serialStart, part1, part2, part3].some((index) => index < 0)) {
      throw new Error("required headings or Part markers are missing");
    }
    const storyBibleExcerpt = `${storyBible.slice(languageStart, storyBible.indexOf("## 故事模式：")).trim()}\n\n${storyBible.slice(serialStart).trim()}`;
    const part1Text = demo.slice(part1, part2).trim().split("\n");
    const part2Text = demo.slice(part2, part3).trim().split("\n");
    const seam = [...part1Text.slice(-3), ...part2Text.slice(0, 4)].join("\n");
    return {
      storyBibleHash: sha256(storyBible),
      storyBibleExcerpt,
      demoHash: sha256(demo),
      demoTitle: "Serial example seam: Part 1 to Part 2",
      demoExcerpt: `Chapter-function summary: each chapter completes a concrete action; the next chapter starts from the prior result; the final chapter resolves the central source event. Do not copy the example's danger, countdown, setting, characters, or twist.\n\nActual adjacent seam used only to study continuity:\n${seam}`,
    };
  } catch (error) {
    throw new ClassicPipelineError(
      "REFERENCE_UNAVAILABLE",
      `Project writing references cannot be fixed for this task: ${error instanceof Error ? error.message : error}`,
    );
  }
}

export function parseClassicCheckpoint(value: unknown): ClassicCheckpoint | null {
  if (!value) return null;
  const parsed = classicCheckpointSchema.safeParse(value);
  if (!parsed.success) {
    throw new ClassicPipelineError("OUTPUT_SCHEMA", `Classic checkpoint is invalid: ${parsed.error.issues.map((issue) => issue.path.join(".")).join(", ")}`);
  }
  return parsed.data;
}

function checkpointFor(asset: ClassicAsset, profile: ClassicProfile): ClassicCheckpoint {
  return {
    type: "classic-adaptation",
    pipelineVersion: "classic-v1",
    workId: asset.manifest.workId,
    unitId: asset.manifest.unitId,
    sourceVersion: asset.manifest.sourceVersion,
    sourceHash: asset.manifest.sourceHash,
    baseVersion: asset.manifest.baseVersion,
    readerStage: profile.readerStage,
    episodeCount: profile.episodeCount,
    minWords: profile.minWords,
    maxWords: profile.maxWords,
    references: readReferences(),
    stage: "source_ready",
    recoveryAttempts: { adaptation: 0, editor: 0, learning: 0 },
  };
}

export function prepareClassicTask(workId: string, unitId: string, readerStage: StoryRunOptions["readerStage"], episodeCount: number) {
  const asset = loadClassicAsset(workId, unitId);
  const profile = resolveClassicProfile(asset, readerStage, episodeCount);
  return { asset, profile, checkpoint: checkpointFor(asset, profile) };
}

function validateCheckpoint(checkpoint: ClassicCheckpoint, asset: ClassicAsset, profile: ClassicProfile) {
  const expected = [
    checkpoint.workId === asset.manifest.workId,
    checkpoint.unitId === asset.manifest.unitId,
    checkpoint.sourceVersion === asset.manifest.sourceVersion,
    checkpoint.sourceHash === asset.manifest.sourceHash,
    checkpoint.baseVersion === asset.manifest.baseVersion,
    checkpoint.readerStage === profile.readerStage,
    checkpoint.episodeCount === profile.episodeCount,
    checkpoint.minWords === profile.minWords,
    checkpoint.maxWords === profile.maxWords,
  ];
  if (expected.some((matches) => !matches)) {
    throw new ClassicPipelineError("SOURCE_CONFLICT", "The saved classic checkpoint does not match the selected immutable source, base, or reading profile.");
  }
}

function words(narrative: z.infer<typeof classicNarrativeSchema>) {
  return narrative.chapters.flatMap((chapter) => chapter.paragraphs).join(" ").match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g)?.length ?? 0;
}

function validateNarrative(narrative: z.infer<typeof classicNarrativeSchema>, profile: ClassicProfile, requireLength: boolean) {
  if (narrative.chapters.length !== profile.episodeCount) {
    throw new ClassicPipelineError("OUTPUT_SCHEMA", `Expected ${profile.episodeCount} chapters but received ${narrative.chapters.length}.`);
  }
  const wordCount = words(narrative);
  if (requireLength && (wordCount < profile.minWords || wordCount > profile.maxWords)) {
    throw new ClassicPipelineError("CONTENT_REJECTED", `Edited story has ${wordCount} words; approved range is ${profile.minWords}-${profile.maxWords}.`);
  }
  const endingIssue = requireLength ? finalChapterEndingIssue(narrative) : "";
  if (endingIssue) {
    throw new ClassicPipelineError("CONTENT_REJECTED", endingIssue);
  }
  return wordCount;
}

function stageError(error: unknown, fallback: ClassicPipelineError["code"]) {
  if (error instanceof ClassicPipelineError) return error;
  const message = error instanceof Error ? error.message : String(error);
  const code = /finish=length|truncat|maximum context|token limit/i.test(message)
    ? "OUTPUT_TRUNCATED"
    : /JSON|parse/i.test(message)
      ? "OUTPUT_PARSE"
      : /Schema|字段|结构|shape/i.test(message)
        ? "OUTPUT_SCHEMA"
        : /429|529|timeout|fetch|socket|capacity|overload/i.test(message)
          ? "MODEL_UNAVAILABLE"
          : fallback;
  return new ClassicPipelineError(code, message);
}

function progress(options: ClassicRunOptions, stage: StoryGenerationProgress["stage"], message: string, percent: number) {
  options.onProgress?.({ stage, message, percent });
  options.log(message);
}

function fixedContext(checkpoint: ClassicCheckpoint, asset: ClassicAsset, profile: ClassicProfile) {
  return `SOURCE (immutable ${asset.manifest.sourceVersion}, sha256 ${asset.manifest.sourceHash}):\n${asset.source}\n\nVERIFIED EDITORIAL BASE (${asset.manifest.baseVersion}):\n${JSON.stringify(asset.base, null, 2)}\n\nREADING PROFILE: ${profile.readerStage}; exactly ${profile.episodeCount} chapters; ${profile.minWords}-${profile.maxWords} total words.\n\nPROJECT WRITING PRINCIPLES (${checkpoint.references.storyBibleHash}):\n${checkpoint.references.storyBibleExcerpt}\n\nNARRATIVE EXAMPLE GUIDANCE (${checkpoint.references.demoHash}; ${checkpoint.references.demoTitle}):\n${checkpoint.references.demoExcerpt}`;
}

function adaptationPrompt(checkpoint: ClassicCheckpoint, asset: ClassicAsset, profile: ClassicProfile) {
  return `${fixedContext(checkpoint, asset, profile)}\n\nAdapt the complete selected source range into clear, engaging English for this profile. Preserve people, motives, event order, causes, consequences, and ending. You may simplify wording and omit only items allowed by the verified base. Do not import events, characters, a countdown, danger, or a twist from the example. Each chapter must advance an actual source event; the final chapter must resolve this source range. Readability and accurate expression are primary. Difficult-word and sentence-length statistics are diagnostics, not quotas. Return only this complete root object:\n${narrativeRootExample(profile.episodeCount)}`;
}

function editorPrompt(checkpoint: ClassicCheckpoint, asset: ClassicAsset, profile: ClassicProfile) {
  return `${fixedContext(checkpoint, asset, profile)}\n\nDRAFT TO EDIT:\n${JSON.stringify(checkpoint.draft, null, 2)}\n\nPerform the one allowed whole-story edit. Directly fix source fidelity, cause and effect, chapter continuity, summary-like gaps, unclear references, age suitability, and genuinely hard or unnatural language. Preserve clear expressions and worthwhile learning words; do not chase vocabulary coverage. Do not add requirements from the example. Return the complete edited story, even if no changes are needed. Only if source and verified base materially conflict in a way one edit cannot solve, return the error object. Return exactly one of these complete root objects:\n${editorRootExamples(profile.episodeCount)}`;
}

function normalized(value: string) {
  return value.toLowerCase().replace(/[“”‘’]/g, "'").replace(/\s+/g, " ").trim();
}

function invalidLearningChapters(value: z.infer<typeof learningSchema>, narrative: z.infer<typeof classicNarrativeSchema>) {
  const invalid = new Set<number>();
  const expected = narrative.chapters.map((_, index) => index + 1);
  const actual = value.chapters.map((chapter) => chapter.chapterNumber).sort((a, b) => a - b);
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    for (const number of expected) invalid.add(number);
  }
  for (const item of value.chapters) {
    if (!narrative.chapters[item.chapterNumber - 1]) {
      invalid.add(item.chapterNumber);
      continue;
    }
    const text = normalized(narrative.chapters[item.chapterNumber - 1].paragraphs.join(" "));
    for (const question of item.questions) {
      if (!text.includes(normalized(question.evidence))) {
        invalid.add(item.chapterNumber);
      }
      if (new Set(question.options.map(normalized)).size !== 4) {
        invalid.add(item.chapterNumber);
      }
    }
  }
  return [...invalid].filter((number) => expected.includes(number)).sort((a, b) => a - b);
}

function validateLearning(value: z.infer<typeof learningSchema>, narrative: z.infer<typeof classicNarrativeSchema>) {
  const invalid = invalidLearningChapters(value, narrative);
  if (invalid.length) throw new ClassicPipelineError("LEARNING_INVALID", `Invalid final-story evidence or chapter coverage in chapters: ${invalid.join(", ")}.`);
}

function learningPrompt(narrative: z.infer<typeof classicNarrativeSchema>) {
  const chapterNumbers = narrative.chapters.map((_, index) => index + 1);
  return `Create exactly two four-option reading questions for every chapter of this FINAL STORY:\n${JSON.stringify(narrative, null, 2)}\n\nUse only the final story. Prefer one detail and one inference or cause-effect question; if inference is unsupported, use detail. Each answer must be unique. evidence must be a short exact quote from that same chapter. Cover every chapter exactly once. Return only this complete root object:\n${learningRootExample(chapterNumbers)}`;
}

function learningRepairPrompt(
  narrative: z.infer<typeof classicNarrativeSchema>,
  failedChapters: number[],
) {
  const selected = failedChapters.map((chapterNumber) => ({
    chapterNumber,
    ...narrative.chapters[chapterNumber - 1],
  }));
  return `Repair questions only for these failed FINAL STORY chapters:\n${JSON.stringify(selected, null, 2)}\n\nReturn each requested chapter exactly once with two questions. Use only its final text; evidence must be an exact short quote. Do not return successful chapters. Complete root shape:\n${learningRootExample(failedChapters)}`;
}

const difficultyByExam = { middle: 2, high: 3, toefl: 4, ielts: 4, toeic: 3 } as const;

export async function runClassicAdaptation(options: ClassicRunOptions) {
  const asset = loadClassicAsset(String(options.classicId), options.classicUnitId);
  const profile = resolveClassicProfile(asset, options.readerStage, options.episodes);
  let checkpoint = options.checkpoint ?? checkpointFor(asset, profile);
  validateCheckpoint(checkpoint, asset, profile);
  const save = (next: ClassicCheckpoint) => {
    checkpoint = next;
    options.onCheckpoint?.(next);
  };
  const protocolRecovery = (stage: keyof ClassicCheckpoint["recoveryAttempts"]) => ({
    protocolRecoveryBudget: Math.max(0, 1 - checkpoint.recoveryAttempts[stage]),
    onProtocolRecovery: () => save({
      ...checkpoint,
      recoveryAttempts: {
        ...checkpoint.recoveryAttempts,
        [stage]: checkpoint.recoveryAttempts[stage] + 1,
      },
    }),
  });
  if (!options.checkpoint) save(checkpoint);

  if (options.dryRun) {
    options.log(adaptationPrompt(checkpoint, asset, profile));
    return { seriesTitle: asset.manifest.unitTitle, generated: 0, imported: 0, articleIds: [] as string[] };
  }

  if (checkpoint.stage === "source_ready") {
    progress(options, "drafting", "正在依据已核对原作进行整篇分级改编", 20);
    try {
      const draft = await callStructured(
        options,
        classicNarrativeSchema,
        "You adapt a specified public-domain source faithfully. Output JSON only and obey the supplied root shape.",
        adaptationPrompt(checkpoint, asset, profile),
        options.model,
        options.temperature,
        { stage: "classic-adaptation", structureRetries: 2, networkRetries: Math.min(2, options.networkRetries), maxCompletionTokens: 12_288, timeoutMs: options.rewriteTimeoutMs, disableThinking: true, ...protocolRecovery("adaptation") },
      );
      validateNarrative(draft, profile, false);
      save({ ...checkpoint, stage: "drafted", draft, failure: undefined });
    } catch (error) {
      throw stageError(error, "CONTENT_REJECTED");
    }
  }

  if (checkpoint.stage === "drafted") {
    progress(options, "editing", "正在进行唯一一次整篇编辑检查", 50);
    try {
      const edited = await callStructured(
        options,
        editedNarrativeSchema,
        "You are the sole whole-story editor. Preserve source truth, repair the draft once, and output JSON only.",
        editorPrompt(checkpoint, asset, profile),
        options.reviewModel || options.model,
        options.reviewTemperature,
        { stage: "classic-editor", providerSchema: classicEditorProviderSchema, structureRetries: 2, networkRetries: Math.min(2, options.networkRetries), maxCompletionTokens: 12_288, timeoutMs: options.rewriteTimeoutMs, disableThinking: true, ...protocolRecovery("editor") },
      );
      if ("error" in edited) throw new ClassicPipelineError("SOURCE_CONFLICT", edited.error.message);
      const wordCount = validateNarrative(edited, profile, true);
      const sentenceCount = edited.chapters.flatMap((chapter) => chapter.paragraphs).join(" ").split(/[.!?]+/).filter((item) => item.trim()).length;
      options.log(`编辑稿机械检查通过：${wordCount} words，平均句长约 ${sentenceCount ? (wordCount / sentenceCount).toFixed(1) : "-"}；词汇覆盖率仅作诊断，不触发重写。`);
      save({ ...checkpoint, stage: "edited", final: edited, finalTextHash: sha256(JSON.stringify(edited)), failure: undefined });
    } catch (error) {
      throw stageError(error, "CONTENT_REJECTED");
    }
  }

  if (checkpoint.stage === "edited") {
    progress(options, "reviewing", "正文已定稿，正在为全部章节生成学习内容", 75);
    try {
      let learning = checkpoint.learning;
      if (!learning) {
        learning = await callStructured(
          options,
          learningSchema,
          "Create evidence-grounded reading questions from the supplied final story only. Output JSON only.",
          learningPrompt(checkpoint.final!),
          options.model,
          options.reviewTemperature,
          { stage: "classic-learning", structureRetries: 2, networkRetries: Math.min(2, options.networkRetries), maxCompletionTokens: 8_192, timeoutMs: options.timeoutMs, disableThinking: true, ...protocolRecovery("learning") },
        );
        save({ ...checkpoint, learning, failure: undefined });
      }
      const failedChapters = invalidLearningChapters(learning, checkpoint.final!);
      if (failedChapters.length) {
        if (checkpoint.recoveryAttempts.learning >= 1) {
          throw new ClassicPipelineError("LEARNING_INVALID", `Question repair was already used; chapters ${failedChapters.join(", ")} still need editorial correction.`);
        }
        save({
          ...checkpoint,
          recoveryAttempts: { ...checkpoint.recoveryAttempts, learning: 1 },
          failure: { code: "LEARNING_INVALID", message: `Repairing chapters ${failedChapters.join(", ")}` },
        });
        const repaired = await callStructured(
          options,
          learningSchema,
          "Repair only the requested final-story chapter questions. Output JSON only.",
          learningRepairPrompt(checkpoint.final!, failedChapters),
          options.model,
          options.reviewTemperature,
          { structureRetries: 2, networkRetries: Math.min(2, options.networkRetries), maxCompletionTokens: 4_096, timeoutMs: options.timeoutMs, disableThinking: true, protocolRecoveryBudget: 0 },
        );
        const replacements = new Map(repaired.chapters.map((item) => [item.chapterNumber, item]));
        learning = {
          chapters: learning.chapters
            .filter((item) => !failedChapters.includes(item.chapterNumber))
            .concat(failedChapters.flatMap((number) => replacements.get(number) ? [replacements.get(number)!] : []))
            .sort((a, b) => a.chapterNumber - b.chapterNumber),
        };
        save({ ...checkpoint, learning, failure: undefined });
      }
      validateLearning(learning, checkpoint.final!);
      save({ ...checkpoint, stage: "learning_ready", learning, failure: undefined });
    } catch (error) {
      throw stageError(error, "LEARNING_INVALID");
    }
  }

  if (checkpoint.stage === "published") {
    const db = createDatabase(options.databasePath);
    try {
      const seriesKey = options.seriesVersionId ?? `${asset.manifest.workId}:${asset.manifest.unitId}:${profile.readerStage}`;
      const ids = (db.prepare("SELECT id FROM articles WHERE series_key = ? ORDER BY episode_number").all(seriesKey) as Array<{ id: string }>).map((row) => row.id);
      return { seriesTitle: checkpoint.final!.title, generated: checkpoint.episodeCount, imported: ids.length, articleIds: ids };
    } finally {
      db.close();
    }
  }

  progress(options, "saving", "正在一次性保存全部名著改写章节", 92);
  const final = checkpoint.final!;
  const questionsByChapter = new Map(checkpoint.learning!.chapters.map((item) => [item.chapterNumber, item.questions]));
  const db = createDatabase(options.databasePath);
  try {
    db.prepare(
      `INSERT INTO interest_categories(
        id, name, subtitle, emoji, color, activity_prompt, story_prompt, active
       ) VALUES ('custom-story', '定制故事', '用户自己的英语故事', '✨', '#55766D',
         '说出本章中支持答案的一处原文。', '原创或名著改写故事。', 1)
       ON CONFLICT(id) DO UPDATE SET active = 1, updated_at = CURRENT_TIMESTAMP`,
    ).run();
    const articleIds = importArticles(db, {
      examId: options.examId,
      sourceName: `拾词 AI 名著改写 · ${asset.manifest.title} · ${asset.manifest.unitTitle}`,
      sourceUrl: asset.manifest.sourceUrl,
      licenseNote: `${asset.manifest.usageBasis}; adapted from ${asset.manifest.edition}; scope: ${asset.manifest.scope}`,
      rightsConfirmed: true,
      articles: final.chapters.map((chapter, index) => ({
        externalId: `classic-${options.seriesVersionId ?? `${asset.manifest.workId}-${asset.manifest.unitId}`}-${index + 1}`,
        year: new Date().getFullYear(),
        title: chapter.title,
        eyebrow: "GRADED CLASSIC",
        readMinutes: Math.max(2, Math.ceil((chapter.paragraphs.join(" ").match(/[A-Za-z]+/g)?.length ?? 0) / 95)),
        difficulty: difficultyByExam[options.examId],
        contentKind: "interest",
        interestId: "custom-story",
        seriesTitle: final.title,
        seriesKey: options.seriesVersionId ?? `${asset.manifest.workId}:${asset.manifest.unitId}:${profile.readerStage}`,
        episodeNumber: index + 1,
        paragraphs: chapter.paragraphs,
        questions: (questionsByChapter.get(index + 1) ?? []).map(({ prompt, options: choices, answer, explanation }) => ({
          prompt, options: choices, answer, explanation,
        })) as Question[],
      })),
    });
    save({ ...checkpoint, stage: "published", failure: undefined });
    progress(options, "completed", "名著改写已完成，可以开始阅读", 100);
    return { seriesTitle: final.title, generated: final.chapters.length, imported: articleIds.length, articleIds };
  } finally {
    db.close();
  }
}
