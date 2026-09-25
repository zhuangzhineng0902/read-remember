import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { z } from "zod";
import { readingDifficulty, readingLanguageBrief } from "../scripts/story-generation/reading-difficulty";
import {
  assessStoryQuality,
  buildDiscardedDraftLessons,
  buildNarrativeCraftBrief,
  buildEpisodeWritingContract,
  buildSeriesPlanPrompt,
  candidateReviewMode,
  candidateVocabularyIsReviewable,
  canAdoptQualifiedLexicalRepair,
  callStructured,
  compressionDriftIssues,
  creativeDraftModelPolicy,
  draftSevereSentenceBudgetIssues,
  draftSentenceBudgetIssues,
  episodeDraftFailureSummary,
  episodeNarrativeHash,
  episodePlanPatchSchema,
  continuityEpisodePatchSchema,
  episodeWritingContractCapacityIssues,
  examVocabularyTags,
  lexicalAllowedWords,
  lexicalRepairProtectedTerms,
  measureNarrativeVocabulary,
  canReuseLexicalElite,
  fragmentSentenceRatio,
  isBorderlineStoryCritique,
  isTransientModelCapacityError,
  isStrictStoryCritique,
  isStoryCritiqueImprovement,
  isSemanticRepairProgress,
  loadStoryEngagementBrief,
  lexicalEditDriftIssues,
  clueLedgerPatchSchema,
  continuityRepairPatchSchema,
  continuityRepairRootTemplate,
  continuityEvidenceProblems,
  groundStoryCritiqueEvidence,
  mergeEpisodeStructure,
  normalizeCandidateCritiqueBatch,
  normalizeContinuitySummary,
  normalizeEpisodeNarrative,
  normalizeFourParagraphNarrative,
  normalizeLexicalToken,
  normalizePlanningArtifact,
  normalizeSeriesPlan,
  normalizeStoryCritique,
  normalizeTargetWords,
  needsStarterLanguageEdit,
  selectNarrativeTargetWords,
  narrativePreflightIssues,
  narrativeCompletionTokenBudget,
  parseJson,
  parseStoryGenerationCheckpoint,
  parseClassicCheckpoint,
  classicChapterBudgets,
  classicCapacityIssue,
  classicCheckpointRetryBlockReason,
  prepareClassicTask,
  classicNarrativeSchema,
  classicEditorProviderSchema,
  classicPublishableNarrativeSchema,
  loadClassicAsset,
  resolveClassicProfile,
  prioritizeTargetWords,
  readStreamingModelContent,
  relevantEvidenceCandidates,
  recoverStructuredComposite,
  passesStoryQualityFloor,
  repeatedNarrativeIssues,
  resolveReaderProfile,
  reviewEpisodeWritingContract,
  runStoryGeneration,
  runOptionalStage,
  selectBackboneStoryCritique,
  selectBestStoryCritique,
  selectDraftLessonsForPrompt,
  shouldAdoptMechanicalRepair,
  shouldPreserveStarterQualifiedLexicalFailure,
  semanticPlanningModelPolicy,
  semanticRewriteModelPolicy,
  seriesPlanClueCapacityAdjustments,
  semanticQualityIssues,
  storyWordLimits,
  repairObjectFields,
  structureModelForAttempt,
  storyGenerationCheckpointSchema,
  storyCheckpointRetryBlockReason,
  storyPlanCapacity,
  storyEpisodeAttemptBudget,
  structuredJsonValues,
  trimTinyNarrativeOverflow,
  validateSeriesPlan,
  type GeneratedStoryEpisode,
  type GeneratedStoryContent,
  type SeriesPlan,
  type StoryCritique,
  type StoryRunOptions,
  storyOptionsFromCli,
  runConfiguredStoryGeneration,
} from "../scripts/generate-story-series";
import { createDatabase } from "../src/database";
import {
  automaticQualityRetryLimit,
  episodeAutomaticRetryState,
  isRecoverableStoryQualityFailure,
  shouldResumeInterruptedStory,
  storyFailureFingerprint,
  shouldFuseStoryFailure,
} from "../src/custom-story";
import { StoryGenerationFailure } from "../scripts/story-generation/generation-policy";
import { normalizeProviderJsonSchema, responseFormatForSchema, zodFailureLabel } from "../scripts/story-generation/model-client";

test("learning words come from actual prose regardless of malformed model word lists", () => {
  const paragraphs = ["Dash’s friend opened the door. The little mouse found a small box near the floor.", "The friend helped carry the box back home."];
  const words = selectNarrativeTargetWords(paragraphs, 5, ["missing", "box", "box", "Dash"], ["Dash"]);
  assert.equal(words.length, 5);
  assert.equal(new Set(words).size, 5);
  assert.equal(words[0], "box");
  assert.ok(!words.includes("missing"));
  assert.ok(!words.includes("dash"));
  assert.ok(!words.includes("s"));
  for (const word of words) assert.ok(new RegExp(`\\b${word}\\b`, "i").test(paragraphs.join(" ")));
  assert.equal(selectNarrativeTargetWords(paragraphs, 4, [], ["Dash"]).length, 4);
  assert.deepEqual(selectNarrativeTargetWords(["a the to"], 5), []);
});

test("fresh planning failures can use the bounded retry budget before a full season checkpoint exists", () => {
  assert.equal(isRecoverableStoryQualityFailure(new StoryGenerationFailure("主线存在阻断", "PLAN_FEASIBILITY_GATE", "narrative", "new_candidates"), false), true);
  assert.equal(isRecoverableStoryQualityFailure(new StoryGenerationFailure("需人工处理", "MANUAL", "narrative", "manual"), false), false);
});

test("automatic quality retries are counted independently for each episode", () => {
  assert.equal(automaticQualityRetryLimit, 3);
  assert.deepEqual(episodeAutomaticRetryState(2, 2, 2), {
    used: 2,
    next: 3,
    canRetry: true,
  });
  assert.deepEqual(episodeAutomaticRetryState(2, 3, 2), {
    used: 3,
    next: 4,
    canRetry: false,
  });
  assert.deepEqual(episodeAutomaticRetryState(2, 3, 3), {
    used: 0,
    next: 1,
    canRetry: true,
  });
});

test("one visible episode attempt cannot hide extra candidate or synthesis rounds", () => {
  assert.deepEqual(storyEpisodeAttemptBudget, {
    candidateBatchesPerQueueAttempt: 1,
    synthesisDraftsPerQueueAttempt: 1,
    initialCandidates: 3,
    supplementalCandidates: 2,
    minimumCandidatePool: 3,
  });
});

test("candidate review mode short-circuits empty pools and treats one draft as a single review", () => {
  assert.equal(candidateReviewMode(0), "skip");
  assert.equal(candidateReviewMode(1), "single");
  assert.equal(candidateReviewMode(2), "batch");
});

test("optional stages preserve the last qualified artifact when optimization fails", async () => {
  const fallback = { title: "Qualified", adopted: false };
  let failure: unknown;
  const result = await runOptionalStage(fallback, async () => {
    throw new Error("injected optional timeout");
  }, (error) => { failure = error; });
  assert.equal(result, fallback);
  assert.match(String(failure), /injected optional timeout/);
  assert.deepEqual(await runOptionalStage(fallback, async () => ({ title: "Better", adopted: true }), () => {}), {
    title: "Better",
    adopted: true,
  });
});

test("initial evidence selection keeps bounded source candidates and prioritizes the intended original span", () => {
  const candidates = Array.from({ length: 100 }, (_, id) => ({
    id,
    paragraph: 1,
    quote: id === 77 ? "The brass key clicked inside the lock." : `Unrelated source sentence number ${id}.`,
  }));
  const selected = relevantEvidenceCandidates(candidates, "The brass key clicked inside the lock.", 12);
  assert.equal(selected.length, 12);
  assert.equal(selected[0].quote, "The brass key clicked inside the lock.");
  assert.deepEqual(selected.map((candidate) => candidate.id), Array.from({ length: 12 }, (_, id) => id));
});

test("an interrupted task cannot restart a fresh episode after its retry budget is exhausted", () => {
  assert.equal(shouldResumeInterruptedStory(3, 3, 2, 5, false), false);
  assert.equal(shouldResumeInterruptedStory(3, 2, 2, 5, false), true);
  assert.equal(shouldResumeInterruptedStory(3, 3, 2, 5, true), true);
  assert.equal(shouldResumeInterruptedStory(2, 3, 2, 5, false), true);
});

test("classic story prompt uses a public-domain source and controlled reader stage", () => {
  const prompt = buildSeriesPlanPrompt({
    interest: "tiger",
    examId: "middle",
    episodes: 6,
    sourceMode: "classic",
    classicId: "treasure-island",
    sourceTitle: "",
    sourceNotes: "",
    readerStage: "stage1",
  });

  assert.match(prompt, /Treasure Island/);
  assert.match(prompt, /400 个核心高频词/);
  assert.match(prompt, /不得复制 Oxford Bookworms/);
  assert.match(prompt, /公版名著可忠实简化原作/);
  assert.match(prompt, /故事圣经/);
  assert.match(prompt, /线索账本/);
  assert.match(prompt, /目标→阻碍→角色作出艰难选择→产生后果→出现新问题/);
  assert.match(prompt, /首稿写作技法蓝图/);
  assert.match(prompt, /不复制原句/);
  assert.match(prompt, /独立任务合同/);
  assert.match(prompt, /mustNotRepeat/);
});

test("classic-v1 loads only a verified source/base pair with an approved profile", () => {
  const asset = loadClassicAsset("aesop", "lion-and-mouse");
  assert.equal(asset.manifest.sourceVersion, "gutenberg-49010-stickney-1915-v1");
  assert.equal(asset.manifest.sourceHash, asset.base.sourceHash);
  assert.deepEqual(asset.sourceParagraphIds, ["p001", "p002", "p003", "p004", "p005", "p006", "p007"]);
  assert.equal(resolveClassicProfile(asset, "auto", 2).readerStage, "starter");
  assert.throws(() => resolveClassicProfile(asset, "stage4", 2), /CONTENT_REJECTED/);
});

test("classic CLI requires and preserves the verified unit identity", () => {
  const incomplete = storyOptionsFromCli([
    "--source-mode", "classic", "--classic", "aesop", "--episodes", "2",
  ]);
  assert.throws(() => runConfiguredStoryGeneration(incomplete), /classicUnitId/);
  const options = storyOptionsFromCli([
    "--source-mode", "classic", "--classic", "aesop", "--unit", "lion-and-mouse",
    "--episodes", "2", "--reader-stage", "starter",
  ]);
  assert.equal(options.classicUnitId, "lion-and-mouse");
});

test("classic dispatch repeats bounded compression until an overlong edit fits", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "read-remember-classic-v1-"));
  const databasePath = path.join(directory, "story.sqlite");
  createDatabase(databasePath).close();
  const narrative = {
    title: "The Lion and His Small Friend",
    chapters: [{
      title: "A Surprising Promise",
      paragraphs: [
        "A hungry Lion woke and found a small Mouse under his great paw. The Lion was ready to eat him, but the Mouse begged for his life. He said that he meant no harm and promised that he would help the Lion one day.",
        "The Lion laughed because such a small animal did not seem useful to him. Still, the promise amused him. He lifted his paw and let the Mouse run free. The Mouse remembered the kindness and the promise he had made.",
      ],
    }, {
      title: "The Promise Kept",
      paragraphs: [
        "Not long after that day, hunters caught the Lion. They tied him down with a strong rope and left to prepare their next step. The Lion pulled with all his strength, but the rope held him. At last, he gave a loud groan.",
        "The Mouse heard the Lion and ran to him. He used his sharp teeth to bite the rope again and again. Soon the rope broke, and the Lion stood up free. The Mouse had kept his promise, and the Lion understood that a small friend could give great help.",
      ],
    }],
  };
  const learning = {
    chapters: [{ chapterNumber: 1, questions: [{
      type: "detail", prompt: "What did the Mouse promise?", options: ["To help the Lion", "To find food", "To call the hunters", "To leave the forest"], answer: 0,
      explanation: "The Mouse promised to help the Lion one day.", evidence: "promised that he would help the Lion one day",
    }, {
      type: "cause_effect", prompt: "Why did the Lion let the Mouse go?", options: ["He was asleep", "The promise amused him", "The hunters arrived", "The Mouse bit him"], answer: 1,
      explanation: "The Lion was amused by the promise.", evidence: "the promise amused him",
    }] }, { chapterNumber: 2, questions: [{
      type: "detail", prompt: "What held the Lion?", options: ["A strong rope", "A stone wall", "A deep river", "A wooden box"], answer: 0,
      explanation: "The hunters tied the Lion with rope.", evidence: "They tied him down with a strong rope",
    }, {
      type: "cause_effect", prompt: "How did the Mouse free the Lion?", options: ["He called a friend", "He moved a rock", "He bit the rope", "He opened a gate"], answer: 2,
      explanation: "The Mouse repeatedly bit the rope until it broke.", evidence: "bite the rope again and again",
    }] }],
  };
  const overlongNarrative = {
    ...narrative,
    chapters: [{
      ...narrative.chapters[0],
      paragraphs: [...narrative.chapters[0].paragraphs, Array.from({ length: 180 }, () => "extra").join(" ")],
    }, narrative.chapters[1]],
  };
  const shorterButOverBudget = {
    ...narrative,
    chapters: [{
      ...narrative.chapters[0],
      paragraphs: [...narrative.chapters[0].paragraphs, Array.from({ length: 100 }, () => "extra").join(" ")],
    }, narrative.chapters[1]],
  };
  const editorPatch = {
    chapterEdits: [{ chapterNumber: 1, paragraphs: overlongNarrative.chapters[0].paragraphs }],
  };
  let calls = 0;
  const server = createServer((request, response) => {
    request.resume();
    request.on("end", () => {
      calls += 1;
      const outputs = [
        narrative,
        editorPatch,
        shorterButOverBudget.chapters[0],
        narrative.chapters[0],
        { complete: true, issues: [] },
        learning,
      ];
      modelJson(response, outputs[calls - 1]);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  try {
    const logs: string[] = [];
    const options = resumableRunOptions(databasePath, `http://127.0.0.1:${address.port}`, null, logs);
    const result = await runConfiguredStoryGeneration({
      ...options,
      sourceMode: "classic",
      classicId: "aesop",
      classicUnitId: "lion-and-mouse",
      readerStage: "starter",
      episodes: 2,
      seriesVersionId: "classic-test-version",
    });
    assert.equal(calls, 6);
    assert.equal(result.articleIds.length, 2);
    const published = createDatabase(databasePath);
    try {
      const rows = published.prepare(
        "SELECT series_key AS seriesKey, episode_number AS episodeNumber, paragraphs_json AS paragraphsJson FROM articles WHERE series_key = ? ORDER BY episode_number",
      ).all("classic-test-version") as Array<{ seriesKey: string; episodeNumber: number; paragraphsJson: string }>;
      assert.deepEqual(rows.map(({ seriesKey, episodeNumber }) => ({ seriesKey, episodeNumber })), [
        { seriesKey: "classic-test-version", episodeNumber: 1 },
        { seriesKey: "classic-test-version", episodeNumber: 2 },
      ]);
      assert.deepEqual(JSON.parse(rows[1].paragraphsJson), narrative.chapters[1].paragraphs);
    } finally {
      published.close();
    }
    assert.doesNotMatch(logs.join(" "), /候选|融合|线索账本|四维/);
    assert.match(logs.join(" "), /第 1\/3 次分章压缩：第 1 章/);
    assert.match(logs.join(" "), /第 2\/3 次分章压缩：第 1 章/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    rmSync(directory, { recursive: true, force: true });
  }
});

test("classic output and checkpoint schemas require their complete dedicated root shapes", () => {
  assert.deepEqual(classicChapterBudgets({ readerStage: "starter", episodeCount: 3, minWords: 300, maxWords: 1200 }), [
    { targetMinimum: 300, targetMaximum: 350, hardMaximum: 400 },
    { targetMinimum: 300, targetMaximum: 350, hardMaximum: 400 },
    { targetMinimum: 300, targetMaximum: 350, hardMaximum: 400 },
  ]);
  assert.equal(classicNarrativeSchema.safeParse({
    title: "A Small Friend",
    chapters: [
      { title: "The Promise", paragraphs: ["The Lion chose to let the little Mouse go free."] },
      { title: "The Rescue", paragraphs: ["The Mouse bit the rope until the Lion was free."] },
    ],
  }).success, true);
  assert.equal(classicNarrativeSchema.safeParse({
    title: "Missing wrapper",
    title2: "bad",
    paragraphs: ["The model incorrectly placed chapter fields at the root."],
  }).success, false);
  const danglingDraft = {
    title: "A Complete JSON Draft",
    chapters: [{ title: "The ending", paragraphs: ["The editor still needs to complete this sentence,"] }],
  };
  assert.equal(classicNarrativeSchema.safeParse(danglingDraft).success, true);
  assert.equal(classicPublishableNarrativeSchema.safeParse(danglingDraft).success, false);
  assert.equal(classicPublishableNarrativeSchema.safeParse({
    ...danglingDraft,
    chapters: [{ title: "The ending", paragraphs: ["The editor completed the final sentence."] }],
  }).success, true);
  const providerSchema = responseFormatForSchema(classicEditorProviderSchema).json_schema.schema as Record<string, unknown>;
  assert.equal("anyOf" in providerSchema, false);
  assert.equal(providerSchema.type, "object");
  assert.throws(() => parseClassicCheckpoint({ type: "classic-adaptation", stage: "drafted" }), /OUTPUT_SCHEMA/);
});

test("classic capacity failures stop before generation and require a changed scope or profile", () => {
  const asset = loadClassicAsset("aesop", "lion-and-mouse");
  const profile = resolveClassicProfile(asset, "starter", 2);
  const overloaded = {
    ...asset,
    base: { ...asset.base, mustKeep: Array.from({ length: 13 }, (_, index) => `Required event ${index + 1}`) },
  };
  assert.match(classicCapacityIssue(overloaded, profile), /缩小原作范围，或增加阅读篇幅/);
  const checkpoint = prepareClassicTask("aesop", "lion-and-mouse", "starter", 2).checkpoint;
  checkpoint.failure = {
    code: "CONTENT_REJECTED",
    message: "已保存完整稿，但当前故事范围无法在指定篇幅内完成合格改编。可选择缩小原作范围，或增加阅读篇幅后继续。",
  };
  assert.match(classicCheckpointRetryBlockReason(checkpoint) ?? "", /无法在指定篇幅内/);
});

test("custom stories select public-domain craft references from the submitted theme", () => {
  const brief = buildNarrativeCraftBrief({
    interest: "custom-story",
    sourceMode: "favorite",
    classicId: "",
    sourceTitle: "A funny portal adventure",
    sourceNotes: "穿越到仙侠和机甲世界，伙伴一起破解线索",
  }, 1);
  assert.match(brief, /Alice's Adventures in Wonderland/);
  assert.match(brief, /Treasure Island/);
  assert.match(brief, /The Early Sherlock Holmes Stories/);
  assert.match(brief, /感官定位.*人物反应.*可见后果/);
});

test("favorite story prompt keeps the appeal while requiring new expression", () => {
  const prompt = buildSeriesPlanPrompt({
    interest: "cultivation",
    examId: "middle",
    episodes: 6,
    sourceMode: "favorite",
    classicId: "",
    sourceTitle: "魔法校园故事",
    sourceNotes: "幽默宠物、伙伴闯关、校园谜题",
    readerStage: "starter",
  });

  assert.match(prompt, /魔法校园故事/);
  assert.match(prompt, /幽默宠物、伙伴闯关、校园谜题/);
  assert.match(prompt, /角色、世界和谜题必须可独立识别为原创/);
  assert.match(prompt, /250 个核心高频词/);
  assert.match(prompt, /Starter 也不能写成 3-6 岁幼儿故事/);
  assert.match(prompt, /consequence 只写选择立刻造成的一次可见代价/);
  assert.match(prompt, /非终集 cliffhanger 须体现本集带来的新信息/);
  assert.match(prompt, /终集该字段记录完整收束画面/);
  assert.match(prompt, /整季最多 3 位主要角色、最多 3 条线索/);
});

test("automatic reader stages follow the learner exam level", () => {
  assert.deepEqual(resolveReaderProfile({ examId: "middle", readerStage: "auto" }), {
    id: "stage1",
    label: "Stage 1",
    headwords: 400,
    cefr: "A1-A2",
    maxNewWords: 5,
  });
  assert.equal(resolveReaderProfile({ examId: "high", readerStage: "auto" }).id, "stage3");
});

test("starter season plans limit cognitive load without making the theme childish", () => {
  assert.deepEqual(
    storyPlanCapacity({ examId: "middle", readerStage: "starter", episodes: 3 }),
    {
      maximumMainCharacters: 3,
      maximumSeasonClues: 3,
      maximumWorldRules: 5,
      maximumNewFactsPerEpisode: 2,
    },
  );
  assert.deepEqual(storyWordLimits({ examId: "middle", readerStage: "starter" }, 1), {
    targetRange: [180, 240],
    publishRange: [180, 310],
  });
  assert.deepEqual(storyWordLimits({ examId: "middle", readerStage: "starter" }, 2), {
    targetRange: [200, 260],
    publishRange: [180, 310],
  });
});

test("story planning has a safe fallback before engagement data exists", () => {
  assert.match(
    loadStoryEngagementBrief(`/tmp/read-remember-missing-story-feedback-${process.pid}.sqlite`, "tiger", "middle"),
    /暂无历史阅读反馈/,
  );
});

test("existing informational interests can generate serial stories", () => {
  const prompt = buildSeriesPlanPrompt({
    interest: "science",
    examId: "middle",
    episodes: 6,
    sourceMode: "original",
    classicId: "",
    sourceTitle: "",
    sourceNotes: "",
    readerStage: "stage1",
  });
  assert.match(prompt, /科普探索连续故事/);
  assert.match(prompt, /自然、动物、地球和太空科学/);
});

test("custom interests contribute their own story direction", () => {
  const prompt = buildSeriesPlanPrompt({
    interest: "dinosaur",
    customInterestName: "恐龙探险",
    customInterestPrompt: "围绕恐龙、化石和野外考察创作连续冒险，知识来自观察和证据。",
    examId: "middle",
    episodes: 6,
    sourceMode: "original",
    classicId: "",
    sourceTitle: "",
    sourceNotes: "",
    readerStage: "stage1",
  });
  assert.match(prompt, /恐龙探险原创连续故事/);
  assert.match(prompt, /恐龙、化石和野外考察/);
});

test("user story prompt preserves submitted ideas inside the quality pipeline", () => {
  const prompt = buildSeriesPlanPrompt({
    interest: "custom-story",
    examId: "middle",
    episodes: 3,
    sourceMode: "favorite",
    classicId: "",
    sourceTitle: "会移动的图书馆与失踪的星图",
    sourceNotes: "角色：Mia 和 Ben；关键词：星图、机关、橘猫",
    readerStage: "stage1",
  });
  assert.match(prompt, /用户定制原创连续故事/);
  assert.match(prompt, /会移动的图书馆与失踪的星图/);
  assert.match(prompt, /星图、机关、橘猫/);
  assert.match(prompt, /故事圣经/);
});

const validPlan: SeriesPlan = {
  seriesTitle: "The Clockwork Harbor",
  premise: "三个伙伴必须在潮水到来前查清港口时钟失灵的原因，并学会在意见不同的时候共享证据。",
  cast: [
    { name: "Mia", role: "观察者", strength: "留意细节", flaw: "不愿求助" },
    { name: "Ben", role: "工程伙伴", strength: "动手能力强", flaw: "行动太快" },
    { name: "Pip", role: "幽默伙伴", strength: "善于提问", flaw: "容易分心" },
  ],
  seasonMystery: "旧港口的三座时钟为什么在同一天显示不同时间，以及谁留下了修复它们的线索。",
  storyBible: {
    worldRules: ["潮水每天只在正午进入内港", "旧时钟必须由三把不同工具共同开启", "港口广播只播报已经确认的信息"],
    fixedTerms: [
      { concept: "钟塔", english: "clock tower" },
      { concept: "铜钥匙", english: "brass key" },
      { concept: "内港", english: "inner harbor" },
    ],
    characterArcs: [
      { name: "Mia", wants: "独自解谜", fear: "判断错误", voice: "先描述证据", growth: "学会及时分享不完整的发现" },
      { name: "Ben", wants: "马上修好机器", fear: "失去作用", voice: "短句并提出行动", growth: "学会先检查再动手" },
      { name: "Pip", wants: "证明问题有趣", fear: "害怕被忽视", voice: "用轻松问题推进思考", growth: "把玩笑变成有用观察" },
    ],
  },
  clueLedger: [
    { id: "C1", clue: "铜屑在北门", introducedIn: 1, misdirection: "像是钥匙损坏", usedIn: 1, payoffIn: 2, payoff: "铜屑来自潮位齿轮" },
    { id: "C2", clue: "广播慢一分钟", introducedIn: 1, misdirection: "像是播音员失误", usedIn: 2, payoffIn: 2, payoff: "广播系统连接着港口主时钟" },
  ],
  episodes: [1, 2].map((number) => ({
    number,
    title: `Clock ${number}`,
    episodeMission: number === 1 ? "确认异常钟声来自哪一座钟塔" : "利用第一集线索阻止错误潮位信号",
    newInformation: [number === 1 ? "铜屑与北门钟塔有关" : "铜屑实际来自潮位齿轮"],
    irreversibleChange: number === 1 ? "伙伴进入钟塔并共享第一条证据" : "潮位齿轮被修复并暴露改动者的痕迹",
    mustNotRepeat: [number === 1 ? "不要提前解释铜屑的真正来源" : "不要再次把发现北门铜屑作为主要悬念"],
    openingHook: "钟声在没有人触碰时突然响起。",
    goal: "伙伴们要找到错误时间的来源。",
    obstacle: "三座时钟给出互相冲突的证据。",
    choice: "他们决定分享各自尚未确认的观察。",
    consequence: "三个片段拼成一条可以验证的线索。",
    newQuestion: "是谁提前改动了潮位齿轮？",
    problem: "错误钟声会让船只错过安全潮位。",
    clue: "北门地上出现了一小片铜屑。",
    teamworkTurn: "三人把观察、工具和问题结合起来。",
    emotionalBeat: "Mia 承认自己需要伙伴检查判断。",
    cliffhanger: "锁住的齿轮盒里传出第二次滴答声。",
  })),
};

test("continuity repair schemas accept only editable text and leave scheduling to the program", () => {
  const episodePatch = episodePlanPatchSchema.parse({
    ...validPlan.episodes[0],
    number: 99,
    mustNotRepeat: ["model must not replace this"],
    entryBridge: { immediateSituation: "wrong", unresolvedPromise: "wrong", nextAction: "wrong", whyNow: "wrong" },
  });
  assert.equal("number" in episodePatch, false);
  assert.equal("mustNotRepeat" in episodePatch, false);
  assert.equal("entryBridge" in episodePatch, false);

  const cluePatch = clueLedgerPatchSchema.parse({ ...validPlan.clueLedger[0], introducedIn: 9, usedIn: 9, payoffIn: 9 });
  assert.deepEqual(Object.keys(cluePatch).sort(), ["clue", "id", "misdirection", "payoff"]);

  const continuityPatch = continuityEpisodePatchSchema.parse(validPlan.episodes[1]);
  assert.deepEqual(Object.keys(continuityPatch).sort(), [
    "choice", "cliffhanger", "clue", "consequence", "emotionalBeat", "goal",
    "newQuestion", "obstacle", "openingHook", "problem", "teamworkTurn",
  ]);

  const nakedPatch = continuityRepairPatchSchema.parse({
    ...validPlan.episodes[1], number: 88, mustNotRepeat: ["wrong"], entryBridge: validPlan.episodes[1].entryBridge,
  });
  assert.equal("title" in nakedPatch.episode, false);
  assert.deepEqual(nakedPatch.clueLedger, []);

  const splitPatch = continuityRepairPatchSchema.parse([
    validPlan.episodes[1],
    validPlan.clueLedger.map(({ id, clue, misdirection, payoff }) => ({ id, clue, misdirection, payoff })),
  ]);
  assert.equal(splitPatch.episode.goal, validPlan.episodes[1].goal);
  assert.equal(splitPatch.clueLedger.length, validPlan.clueLedger.length);
  const rootTemplate = JSON.parse(continuityRepairRootTemplate);
  assert.deepEqual(Object.keys(rootTemplate).sort(), ["clueLedger", "episode"]);
  assert.deepEqual(Object.keys(rootTemplate.episode).sort(), Object.keys(continuityPatch).sort());

  const responseFormat = responseFormatForSchema(continuityRepairPatchSchema);
  assert.equal(responseFormat.type, "json_schema");
  assert.equal(responseFormat.json_schema.strict, true);
  const responseSchema = responseFormat.json_schema.schema as {
    required?: string[];
    properties?: Record<string, unknown>;
  };
  assert.deepEqual(responseSchema.required?.sort(), ["clueLedger", "episode"]);
  assert.deepEqual(Object.keys(responseSchema.properties ?? {}).sort(), ["clueLedger", "episode"]);

  const transformedFormat = responseFormatForSchema(
    z.object({ score: z.number(), issues: z.array(z.string()) }).transform((value) => value.score),
  );
  assert.deepEqual(
    Object.keys((transformedFormat.json_schema.schema as { properties?: object }).properties ?? {}).sort(),
    ["issues", "score"],
  );
  assert.deepEqual(normalizeProviderJsonSchema({ type: "object", additionalProperties: {} }), {
    type: "object", additionalProperties: true,
  });
  const openFormat = responseFormatForSchema(z.record(z.string(), z.unknown()));
  assert.equal(openFormat.json_schema.strict, false);
});

test("structured output diagnostics separate schema shape from business constraints", () => {
  const shape = z.object({ episode: z.object({ goal: z.string() }) }).safeParse({});
  assert.equal(shape.success, false);
  if (!shape.success) assert.equal(zodFailureLabel(shape.error), "Schema 结构校验失败");
  const business = z.string().superRefine((_value, context) => {
    context.addIssue({ code: "custom", message: "章节安排不可修改" });
  }).safeParse("valid json scalar");
  assert.equal(business.success, false);
  if (!business.success) assert.equal(zodFailureLabel(business.error), "业务约束校验失败");
});

test("review contracts describe narrative functions without prescribing routes or actors", () => {
  const reviewContract = reviewEpisodeWritingContract(buildEpisodeWritingContract({ examId: "middle" }, validPlan, 2));
  const serialized = JSON.stringify(reviewContract);
  assert.match(serialized, /叙事功能|中心问题|新问题/);
  assert.doesNotMatch(serialized, /Mia|Ben|三座时钟|分享各自/);
  assert.equal("paragraphCards" in reviewContract, false);
  assert.equal("requiredEvents" in reviewContract, false);
});

test("continuity review claims require exact evidence from the declared prose source", () => {
  const previous = ["Ming said the grey shape was not a mother wolf. It was something else."];
  const current = ["Uncle Chen looked through the telescope and put down the rope."];
  assert.deepEqual(continuityEvidenceProblems([
    "【当前证据：looked through the telescope】Uncle Chen changes his decision after seeing it.",
  ], previous, current), []);
  assert.equal(continuityEvidenceProblems([
    "【当前证据：looked through the telescope】上一集已经确认它是一头熊。",
  ], previous, current).length, 1);
  assert.equal(continuityEvidenceProblems([
    "【前文证据：already confirmed it was a bear】上一集已经确认它是一头熊。",
  ], previous, current).length, 1);

  const grounded = groundStoryCritiqueEvidence({
    plot: { score: 8, issues: [] }, childAppeal: { score: 8, issues: [] },
    gradedLanguage: { score: 8, issues: [] },
    continuity: { score: 5, issues: ["【前文证据：already confirmed it was a bear】上一集已经确认它是一头熊。"] },
    rewritePriorities: ["按虚构的熊结论重写"],
  }, previous, current);
  assert.equal(grounded.continuity.score, 8);
  assert.deepEqual(grounded.continuity.issues, []);
  assert.doesNotMatch(grounded.rewritePriorities.join(" "), /虚构的熊/);
});

test("near-floor vocabulary remains a review diagnostic and does not block publication", () => {
  assert.equal(candidateVocabularyIsReviewable({ lexicalCoverage: 0.85, wordCount: 240 }, 0.95), true);
  assert.equal(candidateVocabularyIsReviewable({ lexicalCoverage: 0.849, wordCount: 240 }, 0.95), false);
  assert.equal(passesStoryQualityFloor({ lexicalCoverage: 0.85, wordCount: 240, blockingIssues: [] }, 0.95), true);
});

function checkpointEpisode(title: string): GeneratedStoryEpisode {
  return {
    title,
    paragraphs: [
      "Mia and Ben stood together beside the old clock tower and heard a strange sound inside.",
      "They shared the brass key, checked the small door, and found a safe path through the tower.",
      "A new light moved under the floor, so the friends agreed to follow it in the next adventure.",
    ],
    targetWords: ["clock", "tower", "shared", "follow"],
    continuitySummary: "伙伴们共同打开钟塔小门，发现地板下有一道移动的光，决定下一集继续追查。",
    storyState: {
      characterPositions: ["Mia 和 Ben 在旧钟塔内部"],
      knownFacts: ["铜钥匙可以打开钟塔的小门"],
      unresolvedQuestions: ["地板下移动的光来自哪里"],
      items: ["Mia 和 Ben 共同保管铜钥匙"],
      relationshipChanges: ["两人开始主动分享观察结果"],
    },
    qualityEvidence: {
      idiomaticPhrase: "stood together",
      sensoryQuote: "heard a strange sound inside",
      causalLinks: [
        {
          causeQuote: "heard a strange sound inside",
          effectQuote: "They shared the brass key",
        },
        {
          causeQuote: "They shared the brass key",
          effectQuote: "A new light moved under the floor",
        },
      ],
      clueEvidence: [
        {
          clueId: "C1",
          action: "plant",
          evidenceQuote: "A new light moved under the floor",
        },
      ],
      progression: {
        obstacleQuote: "heard a strange sound inside",
        choiceQuote: "They shared the brass key",
        consequenceQuote: "found a safe path through the tower",
        newInformationQuote: "A new light moved under the floor",
      },
    },
    questions: [
      { prompt: "What did the friends share?", options: ["A brass key", "A boat", "A meal", "A map"], answer: 0, explanation: "原文说他们共同使用铜钥匙。", skill: "detail", evidenceQuote: "They shared the brass key" },
      { prompt: "Why will they continue?", options: ["They saw a moving light", "They lost a book", "They heard music", "They felt tired"], answer: 0, explanation: "地板下移动的光形成了新的问题。", skill: "inference", evidenceQuote: "A new light moved under the floor" },
    ],
  };
}

function resumableEpisodeContent(title = "The Harbor Bell"): GeneratedStoryContent {
  return {
    title,
    paragraphs: [
      "Mia and Ben waited beside the old clock tower before the harbor opened. A clear bell rang inside, although the wooden door stayed shut. \"That bell should not ring yet,\" Mia said. Ben held the brass key. Pip watched the quiet windows.",
      "Near the north door, Mia found a small piece of copper on the stone. Pip heard a soft click behind the wall and called both friends over. They shared each detail instead of guessing alone. Ben placed the brass key in the lock, but the door still refused to move.",
      "Ben wanted to push the door, yet Mia asked him to check the floor first. Together they followed a thin mark from the copper piece to a loose board. Pip lifted the board with a simple hook. Under it, a slow wheel pulled the bell rope at the wrong time.",
      "The friends stopped the wheel before it rang again. Mia wrote down what they had seen, and Ben left the machine untouched. A second clock across the harbor began to ring one minute late. They knew the two strange bells were connected, but they still needed to learn who changed them.",
    ],
    targetWords: ["tower", "copper", "wheel", "connected"],
    continuitySummary: "三位伙伴发现钟塔内的慢轮错误拉动钟绳，远处第二座钟又慢了一分钟，两处异常已经确认有关。",
    storyState: {
      characterPositions: ["Mia、Ben 和 Pip 在北门钟塔内"],
      knownFacts: ["慢轮会在错误时间拉动钟绳", "第二座钟慢了一分钟"],
      unresolvedQuestions: ["是谁改动了两座钟"],
      items: ["Ben 保管铜钥匙"],
      relationshipChanges: ["三人开始先共享证据再行动"],
    },
    qualityEvidence: {
      idiomaticPhrase: "called both friends over",
      sensoryQuote: "Pip heard a soft click behind the wall and called both friends over.",
      causalLinks: [
        {
          causeQuote: "A clear bell rang inside, although the wooden door stayed shut.",
          effectQuote: "Near the north door, Mia found a small piece of copper on the stone.",
        },
        {
          causeQuote: "Together they followed a thin mark from the copper piece to a loose board.",
          effectQuote: "The friends stopped the wheel before it rang again.",
        },
      ],
      clueEvidence: [
        {
          clueId: "C1",
          action: "plant",
          evidenceQuote: "Near the north door, Mia found a small piece of copper on the stone.",
        },
        {
          clueId: "C2",
          action: "plant",
          evidenceQuote: "A second clock across the harbor began to ring one minute late.",
        },
      ],
      progression: {
        obstacleQuote: "Ben placed the brass key in the lock, but the door still refused to move.",
        choiceQuote: "Ben wanted to push the door, yet Mia asked him to check the floor first.",
        consequenceQuote: "The friends stopped the wheel before it rang again.",
        newInformationQuote: "They knew the two strange bells were connected, but they still needed to learn who changed them.",
      },
    },
  };
}

const resumableQuestions = [
  {
    prompt: "What did Mia find near the north door?",
    options: ["A piece of copper", "A paper map", "A silver bell", "A broken boat"],
    answer: 0,
    explanation: "原文直接说明 Mia 在北门附近发现了一小片铜。",
    skill: "detail" as const,
    evidenceQuote: "Mia found a small piece of copper",
  },
  {
    prompt: "Why did the friends check under the loose board?",
    options: ["A mark led there", "They wanted to hide", "The key fell there", "Pip heard a boat"],
    answer: 0,
    explanation: "原文说明他们沿着铜片旁的痕迹走到松动的木板，因此检查木板下面。",
    skill: "inference" as const,
    evidenceQuote: "they followed a thin mark from the copper piece to a loose board",
  },
];

function modelJson(response: import("node:http").ServerResponse, value: unknown, status = 200) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(status === 200
    ? JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) }, finish_reason: "stop" }] })
    : JSON.stringify({ error: { message: String(value) } }));
}

function resumableRunOptions(
  databasePath: string,
  baseUrl: string,
  checkpoint: StoryRunOptions["checkpoint"],
  logs: string[],
): StoryRunOptions {
  return {
    databasePath,
    ecdictPath: path.join(path.dirname(databasePath), "missing-ecdict.sqlite"),
    baseUrl,
    apiPath: "/chat/completions",
    apiKey: "",
    model: "MiniMax-M3",
    reviewModel: "MiniMax-M3",
    structureRepairModel: "MiniMax-M3",
    interest: "custom-story",
    customInterestName: "定制故事",
    customInterestSubtitle: "用户自己的连续故事",
    customInterestEmoji: "✨",
    customInterestColor: "#55766D",
    customInterestPrompt: "根据用户灵感创作原创连续故事。",
    customActivityPrompt: "预测下一集。",
    examId: "middle",
    sourceMode: "favorite",
    classicId: "",
    sourceTitle: "钟塔冒险",
    sourceNotes: "伙伴合作解开钟塔谜题",
    readerStage: "stage1",
    episodes: 2,
    importNamespace: "resumable-test",
    planCandidates: 3,
    episodeCandidates: 3,
    minLexicalCoverage: 0.95,
    temperature: 0.65,
    reviewTemperature: 0.15,
    timeoutMs: 1_000,
    rewriteTimeoutMs: 1_000,
    networkRetries: 1,
    structureRetries: 1,
    dryRun: false,
    force: false,
    log: (message) => logs.push(message),
    checkpoint,
  };
}

test("metadata-pending recovery skips candidate generation and persists the completed metadata stage", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "read-remember-metadata-resume-"));
  const databasePath = path.join(directory, "story.sqlite");
  const narrative = resumableEpisodeContent();
  const { targetWords: _targetWords, ...modelMetadata } = narrative;
  const requests: string[] = [];
  let saved: StoryRunOptions["checkpoint"];
  createDatabase(databasePath).close();
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      const parsed = JSON.parse(body) as { messages: Array<{ role: string; content: string }> };
      const system = parsed.messages.find((message) => message.role === "system")?.content ?? "";
      requests.push(system);
      if (system.includes("故事数据整理编辑")) {
        const { title: _title, paragraphs: _paragraphs, ...metadata } = modelMetadata;
        modelJson(response, metadata);
      } else if (system.includes("证据核对员")) {
        modelJson(response, { replacements: Array.from({ length: 12 }, (_, index) => ({ index, candidateId: 0 })) });
      } else {
        modelJson(response, `unexpected model stage: ${system}`, 500);
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const logs: string[] = [];
  const checkpoint = {
    version: 2 as const,
    plan: validPlan,
    episodes: [],
    storyContractVersion: "feasible-serial-contract-v13",
    stagedEpisode: {
      index: 0,
      stage: "metadata_pending" as const,
      narrative: { title: narrative.title, paragraphs: narrative.paragraphs },
      critique: strongCritique,
      semanticReview: strongCritique,
      textHash: episodeNarrativeHash(narrative),
      source: "selected" as const,
      fullRewriteCount: 0,
      mechanicalRepairUsed: false,
      semanticRewriteUsed: false,
      lexicalRepairExhausted: false,
      localRepairAttempts: { metadata: 0, lexical: 0 },
    },
  };
  try {
    const options = resumableRunOptions(databasePath, `http://127.0.0.1:${address.port}`, checkpoint, logs);
    options.onCheckpoint = (next) => {
      saved = next;
      if (next.activeEpisode?.stage === "semantic_reviewed") throw new Error("injected stop after metadata");
    };
    await assert.rejects(runStoryGeneration(options), /injected stop after metadata/);
    assert.equal(saved?.version, 2);
    if (!saved || saved.version !== 2) throw new Error("expected a version 2 checkpoint");
    assert.equal(saved.activeEpisode?.stage, "semantic_reviewed");
    assert.equal(saved.activeEpisode?.episode.title, narrative.title);
    assert.ok((saved.activeEpisode?.episode.targetWords.length ?? 0) >= 4);
    assert.equal(requests.length, 2);
    assert.ok(requests.some((system) => system.includes("故事数据整理编辑")));
    assert.ok(requests.some((system) => system.includes("证据核对员")));
    assert.doesNotMatch(logs.join(" "), /生成第 1\/2 集的 .*候选初稿/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    rmSync(directory, { recursive: true, force: true });
  }
});

test("questions-pending recovery generates only questions, saves ready-to-publish, and imports once", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "read-remember-question-resume-"));
  const databasePath = path.join(directory, "story.sqlite");
  const episode = resumableEpisodeContent();
  const quality = assessStoryQuality(episode, { examId: "middle", readerStage: "stage1", minLexicalCoverage: 0.95 }, 1, undefined, validPlan, null);
  assert.deepEqual(quality.blockingIssues, []);
  const systems: string[] = [];
  createDatabase(databasePath).close();
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      const parsed = JSON.parse(body) as { messages: Array<{ role: string; content: string }> };
      const system = parsed.messages.find((message) => message.role === "system")?.content ?? "";
      systems.push(system);
      if (system.includes("英语分级阅读题目终审")) modelJson(response, { questions: resumableQuestions });
      else if (system.includes("独立阅读理解命题审核员")) modelJson(response, {
        reviews: resumableQuestions.map((_question, questionIndex) => ({ questionIndex, supported: true, uniqueAnswer: true, issues: [] })),
      });
      else modelJson(response, `unexpected model stage: ${system}`, 500);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const logs: string[] = [];
  const savedStages: string[] = [];
  const checkpoint = {
    version: 2 as const,
    plan: validPlan,
    episodes: [],
    storyContractVersion: "feasible-serial-contract-v13",
    stagedEpisode: {
      index: 0,
      stage: "questions_pending" as const,
      episode,
      quality,
      critique: strongCritique,
      semanticReview: strongCritique,
      textHash: episodeNarrativeHash(episode),
      fullRewriteCount: 0,
      mechanicalRepairUsed: false,
      semanticRewriteUsed: false,
      lexicalRepairExhausted: false,
      localRepairAttempts: { metadata: 0, lexical: 0 },
    },
  };
  try {
    const options = resumableRunOptions(databasePath, `http://127.0.0.1:${address.port}`, checkpoint, logs);
    options.onCheckpoint = (next) => {
      if (next.stagedEpisode) savedStages.push(next.stagedEpisode.stage);
    };
    options.onEpisodeImported = () => { throw new Error("injected stop after first import"); };
    await assert.rejects(runStoryGeneration(options), /injected stop after first import/);
    assert.deepEqual(systems.map((system) => system.includes("命题审核员") ? "review" : "questions"), ["questions", "review"]);
    assert.ok(savedStages.includes("ready_to_publish"));
    const db = createDatabase(databasePath);
    try {
      const row = db.prepare("SELECT COUNT(*) AS count FROM articles WHERE series_title = ?").get(validPlan.seriesTitle) as { count: number };
      assert.equal(row.count, 1);
    } finally {
      db.close();
    }
    assert.match(logs.join(" "), /恢复已定稿正文，只继续独立命题与验题/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    rmSync(directory, { recursive: true, force: true });
  }
});

test("ready-to-publish recovery imports without any model request", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "read-remember-ready-resume-"));
  const databasePath = path.join(directory, "story.sqlite");
  const episode = { ...resumableEpisodeContent(), questions: resumableQuestions };
  const quality = assessStoryQuality(episode, { examId: "middle", readerStage: "stage1", minLexicalCoverage: 0.95 }, 1, undefined, validPlan, null);
  assert.deepEqual(quality.blockingIssues, []);
  createDatabase(databasePath).close();
  const logs: string[] = [];
  const checkpoint = {
    version: 2 as const,
    plan: validPlan,
    episodes: [],
    storyContractVersion: "feasible-serial-contract-v13",
    stagedEpisode: {
      index: 0,
      stage: "ready_to_publish" as const,
      episode,
      quality,
      semanticReview: strongCritique,
      textHash: episodeNarrativeHash(episode),
      fullRewriteCount: 0,
      mechanicalRepairUsed: false,
      semanticRewriteUsed: false,
      lexicalRepairExhausted: false,
      localRepairAttempts: { metadata: 0, lexical: 0 },
    },
  };
  try {
    const options = resumableRunOptions(databasePath, "http://127.0.0.1:1", checkpoint, logs);
    options.onEpisodeImported = () => { throw new Error("injected stop after ready import"); };
    await assert.rejects(runStoryGeneration(options), /injected stop after ready import/);
    assert.match(logs.join(" "), /恢复已通过全部门禁的成稿，只执行幂等发布/);
    const db = createDatabase(databasePath);
    try {
      const row = db.prepare("SELECT COUNT(*) AS count FROM articles WHERE series_title = ?").get(validPlan.seriesTitle) as { count: number };
      assert.equal(row.count, 1);
    } finally {
      db.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("optional optimization failure keeps the qualified episode and continues through questions and import", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "read-remember-optional-fallback-"));
  const databasePath = path.join(directory, "story.sqlite");
  const episode = resumableEpisodeContent("The Qualified Harbor Bell");
  const quality = assessStoryQuality(episode, { examId: "middle", readerStage: "stage1", minLexicalCoverage: 0.95 }, 1, undefined, validPlan, null);
  assert.deepEqual(quality.blockingIssues, []);
  const improvableReview: StoryCritique = {
    plot: { score: 8, issues: [] },
    childAppeal: { score: 8, issues: ["伙伴互动可以更直接"] },
    gradedLanguage: { score: 7, issues: [] },
    continuity: { score: 8, issues: [] },
    rewritePriorities: ["让伙伴动作更直接"],
  };
  const systems: string[] = [];
  createDatabase(databasePath).close();
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      const parsed = JSON.parse(body) as { messages: Array<{ role: string; content: string }> };
      const system = parsed.messages.find((message) => message.role === "system")?.content ?? "";
      systems.push(system);
      if (system.includes("剧情重构策划师")) modelJson(response, "injected optional timeout", 500);
      else if (system.includes("独立连载故事编辑")) modelJson(response, { handoffs: [], issues: [] });
      else if (system.includes("英语分级阅读题目终审")) modelJson(response, { questions: resumableQuestions });
      else if (system.includes("独立阅读理解命题审核员")) modelJson(response, {
        reviews: resumableQuestions.map((_question, questionIndex) => ({ questionIndex, supported: true, uniqueAnswer: true, issues: [] })),
      });
      else modelJson(response, `unexpected model stage: ${system}`, 500);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const logs: string[] = [];
  const checkpoint = {
    version: 2 as const,
    plan: validPlan,
    episodes: [],
    storyContractVersion: "feasible-serial-contract-v13",
    reviewCalibrationVersion: "independent-single-final-v4-calibrated-7-7.5",
    activeEpisode: {
      index: 0,
      stage: "semantic_reviewed" as const,
      episode,
      quality,
      critique: improvableReview,
      semanticReview: improvableReview,
      fullRewriteCount: 0,
      mechanicalRepairUsed: false,
      semanticRewriteUsed: false,
      lexicalRepairExhausted: false,
      localRepairAttempts: { metadata: 0, lexical: 0 },
    },
  };
  try {
    const options = resumableRunOptions(databasePath, `http://127.0.0.1:${address.port}`, checkpoint, logs);
    options.onEpisodeImported = () => { throw new Error("injected stop after fallback import"); };
    await assert.rejects(runStoryGeneration(options), /injected stop after fallback import/);
    assert.ok(systems.some((system) => system.includes("剧情重构策划师")));
    assert.ok(systems.some((system) => system.includes("独立连载故事编辑")));
    assert.ok(systems.some((system) => system.includes("英语分级阅读题目终审")));
    assert.match(logs.join(" "), /可选增益优化失败，已降级保留原有合格稿/);
    const db = createDatabase(databasePath);
    try {
      const row = db.prepare("SELECT title, COUNT(*) AS count FROM articles WHERE series_title = ?").get(validPlan.seriesTitle) as { title: string; count: number };
      assert.equal(row.count, 1);
      assert.equal(row.title, episode.title);
    } finally {
      db.close();
    }
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    rmSync(directory, { recursive: true, force: true });
  }
});

test("series plan validator enforces chronology and normalizes overloaded clue actions", () => {
  assert.equal(validateSeriesPlan(validPlan, 2).seriesTitle, validPlan.seriesTitle);
  const invalid = structuredClone(validPlan);
  invalid.clueLedger[0].introducedIn = 2;
  invalid.clueLedger[0].usedIn = 1;
  assert.throws(() => validateSeriesPlan(invalid, 2), /顺序不合法/);

  const overloaded = structuredClone(validPlan);
  overloaded.clueLedger.push({
    id: "C3",
    clue: "旧船票藏在钟后",
    introducedIn: 1,
    misdirection: "像是废纸",
    usedIn: 2,
    payoffIn: 2,
    payoff: "船票记录了真正的潮汐时间",
  });
  assert.equal(validateSeriesPlan(overloaded, 2).seriesTitle, overloaded.seriesTitle);
  const adjustments = seriesPlanClueCapacityAdjustments(overloaded);
  assert.equal(adjustments.length, 2);
  assert.deepEqual(adjustments[0].primary.map((action) => action.clueId), ["C1", "C2"]);
  assert.deepEqual(adjustments[0].supporting.map((action) => action.clueId), ["C3"]);
  assert.deepEqual(
    buildEpisodeWritingContract({ examId: "middle" }, overloaded, 1).requiredClueActions,
    adjustments[0].primary,
  );
});

test("series plan normalization repairs harmless model cardinality and numeric drift locally", () => {
  const modelPlan = structuredClone(validPlan) as unknown as Record<string, unknown>;
  const episodes = modelPlan.episodes as Array<Record<string, unknown>>;
  episodes[0].number = "1";
  episodes[0].newInformation = ["fact one", "fact two", "fact three", "extra fact"];
  episodes[0].mustNotRepeat = ["old one", "old two", "old three", "old four", "old five", "old six"];
  const clueLedger = modelPlan.clueLedger as Array<Record<string, unknown>>;
  clueLedger[0].introducedIn = "1";

  const normalized = normalizeSeriesPlan([modelPlan]) as Record<string, unknown>;
  const normalizedEpisodes = normalized.episodes as Array<Record<string, unknown>>;
  const normalizedClues = normalized.clueLedger as Array<Record<string, unknown>>;
  assert.equal(normalizedEpisodes[0].number, 1);
  assert.equal((normalizedEpisodes[0].newInformation as unknown[]).length, 3);
  assert.deepEqual(normalizedEpisodes[0].mustNotRepeat, []);
  assert.match(
    String((normalizedEpisodes[1].mustNotRepeat as unknown[])[0]),
    /允许用一句话承接当前状态.*不得把以下已知事实再次写成新发现/,
  );
  assert.equal(normalizedClues[0].introducedIn, 1);

  const checkpoint = storyGenerationCheckpointSchema.parse({
    version: 2,
    plan: modelPlan,
    episodes: [],
  });
  assert.equal(checkpoint.plan.episodes[0].newInformation.length, 3);
});

test("a complete rewritten narrative can be preserved while missing metadata is filled separately", () => {
  const complete = checkpointEpisode("The Saved Rewrite");
  const narrativeOnly = {
    title: complete.title,
    paragraphs: [...complete.paragraphs, '"Run!"', '"Now!"', '"Together!"', '"Go!"'],
  };
  const metadata = {
    targetWords: complete.targetWords,
    continuitySummary: complete.continuitySummary,
    storyState: complete.storyState,
    qualityEvidence: complete.qualityEvidence,
  };

  assert.deepEqual(mergeEpisodeStructure(narrativeOnly, metadata), {
    ...narrativeOnly,
    ...metadata,
  });
  assert.equal(mergeEpisodeStructure(narrativeOnly, { targetWords: [] }), null);
});

test("a complete one-paragraph narrative is split locally instead of regenerated", () => {
  const complete = checkpointEpisode("The One Paragraph Draft");
  const singleParagraph = complete.paragraphs.join(" ");
  const normalized = normalizeEpisodeNarrative({
    title: complete.title,
    paragraphs: [singleParagraph],
  }) as { title: string; paragraphs: string[] };

  assert.equal(normalized.title, complete.title);
  assert.ok(normalized.paragraphs.length >= 3);
  assert.ok(normalized.paragraphs.length <= 5);
  const originalWords = singleParagraph.match(/[A-Za-z]+(?:['-][A-Za-z]+)*/g);
  const normalizedWords = normalized.paragraphs.join(" ").match(/[A-Za-z]+(?:['-][A-Za-z]+)*/g);
  assert.deepEqual(normalizedWords, originalWords);

  const metadata = {
    targetWords: complete.targetWords,
    continuitySummary: complete.continuitySummary,
    storyState: complete.storyState,
    qualityEvidence: complete.qualityEvidence,
  };
  assert.ok(mergeEpisodeStructure({ title: complete.title, paragraphs: [singleParagraph] }, metadata));
});

test("model paragraph-count drift is normalized locally to the four-paragraph contract", () => {
  const sourceParagraphs = Array.from({ length: 9 }, (_, index) =>
    `Scene ${index + 1} moves forward because the team follows a clear clue.`,
  );
  const normalized = normalizeFourParagraphNarrative({
    title: "The Clockwork Trail",
    paragraphs: sourceParagraphs,
  }) as { title: string; paragraphs: string[] };

  assert.equal(normalized.paragraphs.length, 4);
  const sourceWords = sourceParagraphs.join(" ").match(/[A-Za-z]+(?:['-][A-Za-z]+)*/g);
  const normalizedWords = normalized.paragraphs.join(" ").match(/[A-Za-z]+(?:['-][A-Za-z]+)*/g);
  assert.deepEqual(normalizedWords, sourceWords);

  const withEmptyFifth = normalizeFourParagraphNarrative({
    title: "The Clockwork Trail",
    paragraphs: [...sourceParagraphs.slice(0, 4), ""],
  }) as { paragraphs: string[] };
  assert.deepEqual(withEmptyFifth.paragraphs, sourceParagraphs.slice(0, 4));
});

const strongCritique: StoryCritique = {
  plot: { score: 9, issues: [] },
  childAppeal: { score: 9, issues: [] },
  gradedLanguage: { score: 8.5, issues: [] },
  continuity: { score: 9, issues: [] },
  rewritePriorities: ["保持当前清晰推进"],
};

test("Starter language editing locks only plot-valid drafts with a language bottleneck", () => {
  const languageBottleneck: StoryCritique = {
    plot: { score: 8, issues: [] },
    childAppeal: { score: 8, issues: [] },
    gradedLanguage: { score: 6, issues: ["时态和搭配不自然"] },
    continuity: { score: 8, issues: [] },
    rewritePriorities: ["只修语言"],
  };
  assert.equal(needsStarterLanguageEdit("starter", languageBottleneck), true);
  assert.equal(needsStarterLanguageEdit("stage1", languageBottleneck), false);
  assert.equal(needsStarterLanguageEdit("starter", {
    ...languageBottleneck,
    plot: { score: 6, issues: ["剧情缺少因果"] },
  }), false);
  assert.equal(needsStarterLanguageEdit("starter", strongCritique), false);
});

test("a qualified draft adopts one lexical edit when semantics remain valid", () => {
  const repairedVocabulary = { lexicalCoverage: 0.91, wordCount: 240 };
  assert.equal(canAdoptQualifiedLexicalRepair(repairedVocabulary, 0.95, strongCritique), true);
  assert.equal(canAdoptQualifiedLexicalRepair(
    { lexicalCoverage: 0.86, wordCount: 240 },
    0.95,
    strongCritique,
  ), true);
  assert.equal(canAdoptQualifiedLexicalRepair(repairedVocabulary, 0.95, {
    ...strongCritique,
    continuity: { score: 6, issues: ["换词改变了线索含义"] },
  }), false);
});

test("a downstream Starter lexical diagnostic does not trigger plan reduction", () => {
  const lexicalFailure = {
    score: 86,
    wordCount: 270,
    averageSentenceWords: 9,
    lexicalCoverage: 0.889,
    unfamiliarWords: ["telescope", "fence"],
    issues: ["高频词覆盖率不足"],
    blockingIssues: ["高频词覆盖率不足"],
    blockingIssueDetails: [{
      code: "LEXICAL_COVERAGE_LOW",
      domain: "lexical" as const,
      message: "高频词覆盖率不足",
    }],
  };
  assert.equal(shouldPreserveStarterQualifiedLexicalFailure(
    "starter", lexicalFailure, 0.95, strongCritique,
  ), false);
  assert.equal(shouldPreserveStarterQualifiedLexicalFailure(
    "stage1", lexicalFailure, 0.95, strongCritique,
  ), false);
  assert.equal(shouldPreserveStarterQualifiedLexicalFailure(
    "starter", lexicalFailure, 0.95, {
      ...strongCritique,
      plot: { score: 6, issues: ["剧情未通过"] },
    },
  ), false);
});

test("checkpoint preserves the Starter language-load repair reason", () => {
  const episode = checkpointEpisode("Locked Starter Draft");
  const checkpoint = parseStoryGenerationCheckpoint({
    version: 2,
    plan: validPlan,
    episodes: [],
    rejectedElite: {
      index: 0,
      narrative: { title: episode.title, paragraphs: episode.paragraphs },
      critique: {
        ...strongCritique,
        gradedLanguage: { score: 6, issues: ["搭配不自然"] },
      },
      repairReason: "starter_language_load",
    },
  });
  assert.equal(checkpoint?.rejectedElite?.repairReason, "starter_language_load");
  assert.equal(checkpoint?.rejectedElite?.narrative.title, "Locked Starter Draft");
});

test("Starter language-load recovery simplifies only editable episode actions", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "read-remember-starter-load-"));
  const databasePath = path.join(directory, "story.sqlite");
  const requests: string[] = [];
  let saved: StoryRunOptions["checkpoint"];
  createDatabase(databasePath).close();
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      const parsed = JSON.parse(body) as { messages: Array<{ role: string; content: string }> };
      const system = parsed.messages.find((message) => message.role === "system")?.content ?? "";
      requests.push(system);
      modelJson(response, {
        episode: {
          openingHook: "钟声突然从北门响起。",
          goal: "伙伴只检查北门的钟。",
          obstacle: "北门的钟门被旧锁牢牢锁住了。",
          choice: "他们决定一起用三件工具开门。",
          consequence: "门打开并露出一片铜屑。",
          newQuestion: "谁动过里面的齿轮？",
          problem: "错误钟声会误导船只。",
          clue: "门内只有一片铜屑。",
          teamworkTurn: "三人同时使用各自的工具。",
          emotionalBeat: "Mia 主动请伙伴核对发现。",
          cliffhanger: "齿轮盒里又响了一声。",
        },
        clueLedger: validPlan.clueLedger.map(({ id, clue, misdirection, payoff }) => ({ id, clue, misdirection, payoff })),
      });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const locked = checkpointEpisode("Locked Starter Draft");
  const checkpoint = {
    version: 2 as const,
    plan: validPlan,
    episodes: [],
    storyContractVersion: "feasible-serial-contract-v13",
    rejectedElite: {
      index: 0,
      narrative: { title: locked.title, paragraphs: locked.paragraphs },
      critique: {
        ...strongCritique,
        gradedLanguage: { score: 6, issues: ["时态和搭配不自然"] },
      },
      repairReason: "starter_language_load" as const,
    },
  };
  try {
    const options = resumableRunOptions(
      databasePath,
      `http://127.0.0.1:${address.port}`,
      checkpoint,
      [],
    );
    options.readerStage = "starter";
    options.onCheckpoint = (next) => {
      saved = next;
      if (next.replannedEpisodes?.includes(1)) throw new Error("injected stop after Starter load repair");
    };
    await assert.rejects(runStoryGeneration(options), /injected stop after Starter load repair/);
    assert.equal(requests.length, 1);
    assert.match(requests[0], /短篇分级故事总编/);
    if (!saved || saved.version !== 2) throw new Error("expected repaired checkpoint");
    assert.equal(saved.plan.episodes[0].goal, "伙伴只检查北门的钟。");
    assert.equal(saved.plan.episodes[0].episodeMission, validPlan.episodes[0].episodeMission);
    assert.deepEqual(saved.plan.episodes[0].newInformation, validPlan.episodes[0].newInformation);
    assert.equal(saved.plan.episodes[0].irreversibleChange, validPlan.episodes[0].irreversibleChange);
    assert.equal(saved.plan.clueLedger[0].introducedIn, validPlan.clueLedger[0].introducedIn);
    assert.equal(saved.plan.clueLedger[0].usedIn, validPlan.clueLedger[0].usedIn);
    assert.equal(saved.plan.clueLedger[0].payoffIn, validPlan.clueLedger[0].payoffIn);
    assert.equal(saved.rejectedElite, undefined);
    assert.equal(saved.starterRepairStates?.[0]?.episode, 1);
    assert.match(saved.starterRepairStates?.[0]?.actionSimplification?.sourcePlanHash ?? "", /^[a-f0-9]{64}$/);
    assert.match(saved.starterRepairStates?.[0]?.actionSimplification?.resultPlanHash ?? "", /^[a-f0-9]{64}$/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    rmSync(directory, { recursive: true, force: true });
  }
});

test("legacy lexical repair state no longer blocks retry", () => {
  const episode = checkpointEpisode("Saved Semantic Draft");
  const checkpoint = parseStoryGenerationCheckpoint({
    version: 2,
    plan: validPlan,
    episodes: [],
    rejectedElite: {
      index: 1,
      narrative: { title: episode.title, paragraphs: episode.paragraphs },
      critique: strongCritique,
      repairReason: "starter_lexical_load",
    },
    starterRepairStates: [{
      episode: 2,
      lexicalEdit: {
        sourceTextHash: "a".repeat(64),
        resultTextHash: "b".repeat(64),
        beforeCoverage: 0.866,
        afterCoverage: 0.879,
      },
      actionSimplification: {
        sourcePlanHash: "c".repeat(64),
        resultPlanHash: "d".repeat(64),
      },
    }],
  });
  assert.ok(checkpoint);
  const reason = storyCheckpointRetryBlockReason(checkpoint);
  assert.equal(reason, null);
});

test("candidate critique batches preserve a single top-level review for targeted recovery", () => {
  const singleReview = {
    candidateIndex: "1",
    ...strongCritique,
  };

  assert.deepEqual(normalizeCandidateCritiqueBatch(singleReview), {
    reviews: [singleReview],
  });
});

test("candidate critique batches normalize arrays and candidate-index keyed objects", () => {
  const first = { candidateIndex: 0, ...strongCritique };
  const third = { candidateIndex: 2, ...strongCritique };

  assert.deepEqual(normalizeCandidateCritiqueBatch([first, third]), {
    reviews: [first, third],
  });
  assert.deepEqual(normalizeCandidateCritiqueBatch({
    0: strongCritique,
    2: strongCritique,
  }), {
    reviews: [first, third],
  });
});

test("transient planning artifacts accept richer objects and array-shaped section lists", () => {
  const rich = {
    unifiedCausalSpine: ["goal", "choice", "consequence"],
    cluePlanting: { source: 1, strength: "fair clue" },
    sensoryPalette: ["cold stone", "soft hum"],
  };
  assert.deepEqual(normalizePlanningArtifact(rich), rich);
  assert.deepEqual(normalizePlanningArtifact([[{ source: 0 }, { source: 2 }]]), {
    sections: [{ source: 0 }, { source: 2 }],
  });
});

test("split critique arrays are merged before strict validation", () => {
  const normalized = normalizeStoryCritique([
    { dimension: "plot", score: 8, issues: [] },
    { childAppeal: strongCritique.childAppeal },
    { dimension: "gradedLanguage", score: 8.5, issues: [] },
    { continuity: strongCritique.continuity },
    { rewritePriorities: ["保持当前清晰推进"] },
  ]) as StoryCritique;
  assert.equal(normalized.plot.score, 8);
  assert.deepEqual(normalized.childAppeal, strongCritique.childAppeal);
  assert.deepEqual(normalized.gradedLanguage, strongCritique.gradedLanguage);
  assert.deepEqual(normalized.continuity, strongCritique.continuity);
  assert.deepEqual(normalized.rewritePriorities, strongCritique.rewritePriorities);
});

test("saved quality failures are eligible for bounded automatic story continuation", () => {
  assert.equal(
    isRecoverableStoryQualityFailure("第 2 集语义质量未达标：连续性 6.0 < 7", true),
    true,
  );
  assert.equal(
    isRecoverableStoryQualityFailure("第 2 集语义质量未达标：连续性 6.0 < 7", false),
    false,
  );
  assert.equal(
    isRecoverableStoryQualityFailure("数据库写入失败", true),
    false,
  );
  assert.equal(
    isRecoverableStoryQualityFailure("模型服务繁忙导致本批只有 2 份可用初稿", true),
    false,
  );
  assert.equal(
    isRecoverableStoryQualityFailure(
      "第 3 集候选初稿连续未达到编辑底线：高分原稿保守压缩后未通过核心事件复核",
      true,
    ),
    true,
  );
  assert.equal(
    isRecoverableStoryQualityFailure("第 4 集两次定长校正后仍不合法：第 3 段最长句 24 词", true),
    true,
  );
  assert.equal(
    isRecoverableStoryQualityFailure(new Error("第 3 集最终结构修稿造成语义退化：吸引力下降"), true),
    true,
  );
  assert.equal(
    isRecoverableStoryQualityFailure(new Error("所有候选季纲均不可用；模型未能提供至少一套完整故事方案"), false),
    true,
  );
});

test("semantic quality gate rejects a weaker later episode", () => {
  const weak = structuredClone(strongCritique);
  weak.plot.score = 7.5;
  weak.childAppeal.score = 7;
  assert.match(semanticQualityIssues(weak, strongCritique).join(" "), /剧情逻辑/);
  assert.match(semanticQualityIssues(weak, strongCritique).join(" "), /比第一集低/);
  assert.deepEqual(semanticQualityIssues(strongCritique, strongCritique), []);
});

test("calibrated candidate gating requires every dimension to reach seven and average 7.5", () => {
  const acceptable = structuredClone(strongCritique);
  acceptable.continuity.score = 7;
  const weakDimension = structuredClone(strongCritique);
  weakDimension.continuity.score = 6.9;
  const weakAverage = structuredClone(strongCritique);
  weakAverage.plot.score = 7;
  weakAverage.childAppeal.score = 7;
  weakAverage.gradedLanguage.score = 7;
  weakAverage.continuity.score = 7;
  assert.equal(isStrictStoryCritique(strongCritique), true);
  assert.equal(isStrictStoryCritique(acceptable), true);
  assert.equal(isStrictStoryCritique(weakDimension), false);
  assert.equal(isStrictStoryCritique(weakAverage), false);
});

test("a 7.25 all-seven draft can enter targeted enhancement without lowering the final gate", () => {
  const borderline = structuredClone(strongCritique);
  borderline.plot.score = 8;
  borderline.childAppeal.score = 7;
  borderline.gradedLanguage.score = 7;
  borderline.continuity.score = 7;
  assert.equal(isBorderlineStoryCritique(borderline), true);
  assert.equal(isStrictStoryCritique(borderline), false);

  borderline.childAppeal.score = 6.9;
  assert.equal(isBorderlineStoryCritique(borderline), false);
});

test("an optimized story is adopted only when it remains strict and improves the average", () => {
  const improved = structuredClone(strongCritique);
  improved.plot.score = 9.5;
  const equal = structuredClone(strongCritique);
  const regressed = structuredClone(improved);
  regressed.continuity.score = 7.5;

  assert.equal(isStoryCritiqueImprovement(improved, strongCritique), true);
  assert.equal(isStoryCritiqueImprovement(equal, strongCritique), false);
  assert.equal(isStoryCritiqueImprovement(regressed, strongCritique), false);
});

test("mandatory semantic rewrites retain the best-so-far draft instead of compounding regressions", () => {
  const original = structuredClone(strongCritique);
  original.plot.score = 7;
  original.childAppeal.score = 7;
  original.gradedLanguage.score = 6;
  original.continuity.score = 8;

  const better = structuredClone(original);
  better.gradedLanguage.score = 7;
  const worse = structuredClone(original);
  worse.plot.score = 6;
  worse.childAppeal.score = 6;
  const higherAverageButNewWeakDimension = structuredClone(original);
  higherAverageButNewWeakDimension.plot.score = 6;
  higherAverageButNewWeakDimension.childAppeal.score = 9;
  higherAverageButNewWeakDimension.gradedLanguage.score = 8;

  assert.equal(isSemanticRepairProgress(better, original), true);
  assert.equal(isSemanticRepairProgress(worse, original), false);
  assert.equal(isSemanticRepairProgress(higherAverageButNewWeakDimension, original), false);
});

test("narrative preflight rejects bad length, paragraph count, and mixed Chinese before model review", () => {
  const issues = narrativePreflightIssues(
    { examId: "middle", readerStage: "stage1" },
    validPlan,
    1,
    { title: "A 门", paragraphs: ["Too short."] },
  );
  assert.ok(issues.some((issue) => /恰好 4 段/.test(issue)));
  assert.ok(issues.some((issue) => /正文词数/.test(issue)));
  assert.ok(issues.some((issue) => /夹杂中文/.test(issue)));
});

test("all stages share one publication length boundary", () => {
  const narrativeWithWords = (count: number) => ({
    title: "The Shared Gate",
    paragraphs: Array.from({ length: 4 }, (_, paragraphIndex) => {
      const base = Math.floor(count / 4);
      const size = base + (paragraphIndex < count % 4 ? 1 : 0);
      return Array(size).fill("word").join(" ") + ".";
    }),
  });

  assert.deepEqual(storyWordLimits({ examId: "middle" }, 1), {
    targetRange: [180, 280],
    publishRange: [180, 310],
  });
  assert.deepEqual(storyWordLimits({ examId: "middle" }, 3), {
    targetRange: [220, 310],
    publishRange: [180, 310],
  });
  assert.deepEqual(
    narrativePreflightIssues(
      { examId: "middle", readerStage: "stage1" },
      validPlan,
      1,
      narrativeWithWords(300),
    ),
    [],
  );
  assert.match(
    narrativePreflightIssues(
      { examId: "middle", readerStage: "stage1" },
      validPlan,
      1,
      narrativeWithWords(311),
    ).join(" "),
    /发布硬范围 180-310/,
  );

  const withinPublishLimit = checkpointEpisode("Within Publish Limit");
  withinPublishLimit.paragraphs = narrativeWithWords(300).paragraphs;
  const overPublishLimit = structuredClone(withinPublishLimit);
  overPublishLimit.paragraphs = narrativeWithWords(311).paragraphs;
  assert.doesNotMatch(
    assessStoryQuality(
      withinPublishLimit,
      { examId: "middle", readerStage: "stage1", minLexicalCoverage: 0.95 },
      1,
    ).blockingIssues.join(" "),
    /正文过长/,
  );
  assert.match(
    assessStoryQuality(
      overPublishLimit,
      { examId: "middle", readerStage: "stage1", minLexicalCoverage: 0.95 },
      1,
    ).blockingIssues.join(" "),
    /发布硬上限 310/,
  );
});

test("discarded drafts persist actionable lessons for the next generation round", () => {
  const weak = structuredClone(strongCritique);
  weak.plot.score = 5;
  weak.plot.issues = ["钥匙突然出现，缺少来源", "角色选择没有产生后果"];
  weak.rewritePriorities = ["先交代钥匙来源，再让角色承担选择后果"];
  const active = {
    index: 1,
    stage: "semantic_reviewed" as const,
    episode: checkpointEpisode("Rejected Draft"),
    quality: {
      score: 64,
      wordCount: 280,
      averageSentenceWords: 10,
      lexicalCoverage: 0.92,
      unfamiliarWords: [],
      issues: ["正文过长"],
      blockingIssues: ["正文过长"],
    },
    critique: weak,
    semanticReview: weak,
    fullRewriteCount: 2,
    mechanicalRepairUsed: false,
    semanticRewriteUsed: true,
  };
  const lessons = buildDiscardedDraftLessons(active, active.quality, ["上一轮：避免重复解释旧线索"]);

  assert.ok(lessons.some((lesson) => /剧情逻辑 5\.0 分/.test(lesson)));
  assert.ok(lessons.some((lesson) => /钥匙突然出现/.test(lesson)));
  assert.ok(lessons.some((lesson) => /优先改进/.test(lesson)));
  assert.ok(lessons.some((lesson) => /自动门禁：正文过长/.test(lesson)));
  assert.ok(lessons.includes("上一轮：避免重复解释旧线索"));
});

test("candidate drafts use M3 direct JSON mode to prevent reasoning-only exhaustion", () => {
  assert.deepEqual(creativeDraftModelPolicy({ rewriteTimeoutMs: 480_000 }), {
    timeoutMs: 480_000,
    networkRetries: 1,
    structureRetries: 2,
    maxCompletionTokens: 8_192,
    disableThinking: true,
  });
});

test("semantic full rewrites use MiniMax M3 direct output with a recovery retry", () => {
  assert.deepEqual(semanticRewriteModelPolicy({ rewriteTimeoutMs: 480_000 }), {
    timeoutMs: 480_000,
    networkRetries: 2,
    structureRetries: 2,
    maxCompletionTokens: 8_192,
    disableThinking: true,
  });
});

test("semantic rewrite planning uses a separate M3 direct blueprint before execution", () => {
  assert.deepEqual(semanticPlanningModelPolicy({ rewriteTimeoutMs: 480_000 }), {
    timeoutMs: 480_000,
    networkRetries: 2,
    structureRetries: 2,
    maxCompletionTokens: 8_192,
    disableThinking: true,
  });
});

test("episode writing contracts cap hard story work at four paragraph cards", () => {
  const overloaded = structuredClone(validPlan);
  overloaded.episodes[1].newInformation = [
    "伙伴找到一个藏在齿轮后的铜盒",
    "广播员拒绝解释慢一分钟的原因",
    "Ben 当着所有人做出了错误指控",
  ];
  const contract = buildEpisodeWritingContract({ examId: "middle" }, overloaded, 2);

  assert.equal(contract.paragraphCards.length, 4);
  assert.equal(contract.requiredEvents.length, 4);
  assert.ok(contract.paragraphCards.every((card) => card.targetSentences >= 4));
  assert.ok(contract.paragraphCards.every((card) => card.maxWordsPerSentence <= 13));
  assert.match(contract.requiredEvents[1], /伙伴合作/);
  assert.doesNotMatch(contract.requiredEvents[2], /Ben 当着所有人/);
  assert.ok(contract.requiredEvents[2].includes(overloaded.clueLedger[0].payoff));
  assert.ok(contract.optionalIfSpace.some((item) => /铜盒/.test(item)));
  assert.ok(contract.optionalIfSpace.some((item) => /广播员/.test(item)));
  assert.ok(contract.optionalIfSpace.some((item) => /Ben/.test(item)));
  assert.deepEqual(contract.requiredClueActions, [
    { clueId: "C1", action: "payoff" },
    { clueId: "C2", action: "payoff" },
  ]);
  assert.deepEqual(episodeWritingContractCapacityIssues(contract), []);
});

test("the final paragraph continues the consequence instead of replaying its trigger", () => {
  const contract = buildEpisodeWritingContract({ examId: "middle" }, validPlan, 1);
  assert.match(contract.paragraphCards[3].purpose, /绝不重演触发动作/);
  assert.match(contract.requiredEvents[3], /不得重复其触发动作/);
  assert.match(contract.requiredEvents[3], /具体新证据或新风险/);
});

test("season finale closes the mystery instead of requiring another cliffhanger", () => {
  const final = buildEpisodeWritingContract({ examId: "middle" }, validPlan, validPlan.episodes.length);
  assert.equal(final.endingMode, "resolution");
  assert.match(final.paragraphCards[3].purpose, /完成当前中心目标/);
  assert.match(final.requiredEvents[3], /不强制采用旧 cliffhanger/);
  assert.match(final.editorialRules, /两种有效感官即达标/);
  assert.match(final.editorialRules, /不复述旧物件不等于矛盾/);
  const opening = buildEpisodeWritingContract({ examId: "middle" }, validPlan, 1);
  assert.equal(opening.endingMode, "cliffhanger");
});

test("short-reading completion budgets stay bounded while leaving room to close JSON", () => {
  assert.ok(narrativeCompletionTokenBudget(208) >= 700);
  assert.ok(narrativeCompletionTokenBudget(310) > 310 * 2);
  assert.ok(narrativeCompletionTokenBudget(800) > 800 * 2);
  assert.ok(narrativeCompletionTokenBudget(208) >= 8192);
  assert.ok(narrativeCompletionTokenBudget(2000) <= 16384);
});

test("a JSON-valid truncated chapter is rejected before scoring", () => {
  const draft = {
    title: "The Drain",
    paragraphs: Array.from({ length: 4 }, () => Array(50).fill("word").join(" ") + "."),
  };
  draft.paragraphs[3] += ' "This time you smell, I listen," Dash';
  assert.match(narrativePreflightIssues({ examId: "middle", readerStage: "starter" }, validPlan, 1, draft).join(";"), /结尾不完整/);
  draft.paragraphs[3] += " said.";
  assert.doesNotMatch(narrativePreflightIssues({ examId: "middle", readerStage: "starter" }, validPlan, 1, draft).join(";"), /结尾不完整/);
});

test("request timeouts are infrastructure failures rather than quality failures", () => {
  assert.equal(isTransientModelCapacityError(new DOMException("The operation was aborted due to timeout", "TimeoutError")), true);
  assert.equal(isTransientModelCapacityError(new Error("剧情质量不足")), false);
});

test("nested metadata recovery requests only invalid leaves and preserves valid siblings", async () => {
  const schema = z.object({ title: z.string(), evidence: z.object({ quote: z.string(), progression: z.object({ cause: z.string() }) }) });
  const paths: string[] = [];
  const value = await repairObjectFields(schema, { title: "Kept", evidence: { quote: "Exact quote" } }, async (_schema, _value, path) => {
    paths.push(path.join("."));
    return { cause: "Exact cause" };
  });
  assert.deepEqual(paths, ["evidence.progression"]);
  assert.deepEqual(value, { title: "Kept", evidence: { quote: "Exact quote", progression: { cause: "Exact cause" } } });
  await assert.rejects(repairObjectFields(schema, {}, async () => 42));
});

test("separate root JSON fragments are reattached only when the schema validates them", () => {
  const schema = z.object({
    title: z.string(),
    episodes: z.array(z.object({ number: z.number(), title: z.string() })).min(2),
  });
  assert.deepEqual(recoverStructuredComposite([
    { title: "A Small Season" },
    [{ number: 1, title: "One" }, { number: 2, title: "Two" }],
    ["unrelated", "values"],
  ], schema), {
    title: "A Small Season",
    episodes: [{ number: 1, title: "One" }, { number: 2, title: "Two" }],
  });
});

test("middle-school publication accepts both junior and senior school dictionary tags", () => {
  assert.deepEqual(examVocabularyTags("middle"), ["zk", "gk"]);
  assert.deepEqual(examVocabularyTags("high"), ["zk", "gk"]);
});

test("beginner language policy overrides exam vocabulary and avoids technical plot overload", () => {
  for (const exam of ["middle", "high", "toeic", "toefl", "ielts"] as const) {
    assert.deepEqual(examVocabularyTags(exam, "starter"), ["zk"]);
    assert.deepEqual(examVocabularyTags(exam, "stage1"), ["zk"]);
  }
  assert.equal(readingDifficulty("starter").averageSentenceWords, 8);
  assert.equal(readingDifficulty("starter").maximumSentenceWords, 18);
  assert.match(readingLanguageBrief("starter"), /避免依赖多个专业零件/);
  assert.match(readingLanguageBrief("starter"), /目标词、场景术语/);
  const plan = structuredClone(validPlan);
  plan.storyBible.fixedTerms = [{ english: "xylophonic tailgate", concept: "fictional mechanism" }];
  const allowed = lexicalAllowedWords(plan);
  assert.ok(!allowed.includes("tailgate"));
  assert.ok(!allowed.includes("xylophonic"));
  assert.ok(allowed.length > 0);
});

test("reader-level sentence length is advisory until the outlier is severe", () => {
  const episode = checkpointEpisode("Sentence difficulty");
  const sentence = "The little team went down to the old house and looked for a small box near the open door.";
  episode.paragraphs = Array.from({ length: 4 }, () => [sentence, sentence, sentence].join(" "));
  const starter = assessStoryQuality(episode, { examId: "high", readerStage: "starter" }, 1);
  const advanced = assessStoryQuality(episode, { examId: "high", readerStage: "stage5" }, 1);
  assert.ok(starter.issues.some((issue) => issue.startsWith("最长句超过")));
  assert.ok(!starter.blockingIssues.some((issue) => issue.startsWith("最长句超过")));
  assert.ok(!advanced.blockingIssues.some((issue) => issue.startsWith("最长句超过")));
});

test("lexical editing protects published terms, not unpublished difficult teaching words", () => {
  const plan = structuredClone(validPlan);
  plan.storyBible.fixedTerms = ["floorboards", "whistle", "hubcap"].map((english) => ({ english, concept: english }));
  const previous = checkpointEpisode("Previous");
  previous.paragraphs = ["Mia found the whistle."];
  const firstProtected = lexicalRepairProtectedTerms(plan, null);
  for (const word of ["floorboards", "whistle", "hubcap"]) assert.ok(!firstProtected.includes(word));
  assert.ok(firstProtected.includes(plan.cast[0].name));
  const laterProtected = lexicalRepairProtectedTerms(plan, previous);
  assert.ok(laterProtected.includes("whistle"));
  assert.ok(!laterProtected.includes("floorboards"));
  assert.ok(!laterProtected.includes("hubcap"));
});

test("candidate and final vocabulary coverage remain diagnostic but do not block publication", () => {
  const episode = checkpointEpisode("Vocabulary test");
  episode.paragraphs = Array.from({ length: 4 }, () => "Mia saw the hubcap and the floorboards near the whistle.");
  episode.targetWords = ["hubcap", "floorboards", "whistle", "saw"];
  const lexical = { lookup: (word: string) => ["hubcap", "floorboards", "whistle"].includes(word) ? 9999 : 1, allowedWords: ["Mia"] };
  const candidate = measureNarrativeVocabulary(episode.paragraphs, 400, lexical);
  const final = assessStoryQuality(episode, { examId: "middle", readerStage: "stage1" }, 1, lexical);
  assert.equal(candidate.lexicalCoverage, final.lexicalCoverage);
  assert.deepEqual(candidate.unfamiliarWords, final.unfamiliarWords);
  assert.equal(passesStoryQualityFloor({ ...candidate, blockingIssues: [] }, 0.95), true);
  assert.equal(passesStoryQualityFloor({ ...final, blockingIssues: [] }, 0.95), true);
});

test("semantic elites remain reusable regardless of diagnostic vocabulary coverage", () => {
  assert.equal(canReuseLexicalElite({ wordCount: 227, lexicalCoverage: 0.846 }, 0.95), true);
  assert.equal(canReuseLexicalElite({ wordCount: 227, lexicalCoverage: 0.846 }, 0.95, true), true);
  assert.equal(canReuseLexicalElite({ wordCount: 227, lexicalCoverage: 0.96 }, 0.95, true), true);
  assert.equal(canReuseLexicalElite({ wordCount: 227, lexicalCoverage: 0.96 }, 0.95), true);
});

test("draft sentence budgets detect paragraph expansion without rejecting small variation", () => {
  const contract = buildEpisodeWritingContract({ examId: "middle" }, validPlan, 2);
  const withinBudget = {
    paragraphs: contract.paragraphCards.map((card) =>
      Array.from({ length: card.targetSentences }, () => "The friends move through the quiet tunnel with care.").join(" ")
    ),
  };
  assert.deepEqual(draftSentenceBudgetIssues(contract, withinBudget), []);
  const expanded = structuredClone(withinBudget);
  expanded.paragraphs[0] += " This sentence adds too many extra words because the writer keeps explaining every small action in unnecessary detail.";
  assert.match(draftSentenceBudgetIssues(contract, expanded).join(" "), /第 1 段/);
});

test("severe sentence-budget drift cannot be mislabeled as a harmless variation", () => {
  const contract = buildEpisodeWritingContract({ examId: "middle" }, validPlan, 2);
  const severe = {
    paragraphs: contract.paragraphCards.map((_card, index) => index === 0
      ? "One very long sentence carries far too many separate actions because the writer keeps adding events without stopping to help a young reader understand them clearly."
      : "One. Two. Three. Four. Five. Six."),
  };
  assert.match(draftSevereSentenceBudgetIssues(contract, severe).join("；"), /严重/);

  const severalShortSentences = {
    paragraphs: contract.paragraphCards.map((card) =>
      Array.from({ length: card.targetSentences + 4 }, () => "Mia moved with care.").join(" ")
    ),
  };
  assert.deepEqual(draftSevereSentenceBudgetIssues(contract, severalShortSentences), []);
});

test("a modest middle-school sentence outlier remains editorial instead of killing the draft", () => {
  const contract = buildEpisodeWritingContract({ examId: "middle" }, validPlan, 2);
  const target = contract.paragraphCards[0].maxWordsPerSentence;
  const modest = {
    paragraphs: contract.paragraphCards.map((_card, index) => index === 0
      ? `${Array.from({ length: target + 7 }, () => "word").join(" ")}.`
      : "One. Two. Three. Four. Five. Six."),
  };
  assert.match(draftSentenceBudgetIssues(contract, modest).join("；"), /最长句/);
  assert.deepEqual(draftSevereSentenceBudgetIssues(contract, modest), []);

  modest.paragraphs[0] = `${Array.from({ length: target + 11 }, () => "word").join(" ")}.`;
  assert.match(draftSevereSentenceBudgetIssues(contract, modest).join("；"), /严重/);
});

test("compression drift guard rejects invented rewrites but accepts conservative deletion", () => {
  const original = {
    paragraphs: [
      "Mia opened the old gate and heard the bell ring. Ben held the lamp while they crossed the wet floor.",
      "A cold wind moved through the tunnel. The friends followed the silver marks together.",
      "The last mark stopped beside a wooden box. Mia used the key and found a folded map.",
      "They carried the map home before sunset. A red star appeared over the northern tower.",
    ],
  };
  const deleted = {
    paragraphs: [
      "Mia opened the old gate and heard the bell ring.",
      "The friends followed the silver marks together.",
      "Mia used the key and found a folded map.",
      "They carried the map home before sunset.",
    ],
  };
  const invented = {
    paragraphs: [
      "Zara flew a crystal rocket above the burning ocean.",
      "Robots fired purple lasers from a hidden moon base.",
      "A wizard changed the engine into a golden dragon.",
      "The captain vanished through a magical mirror at midnight.",
    ],
  };
  assert.deepEqual(compressionDriftIssues(original, deleted), []);
  assert.match(compressionDriftIssues(original, invented).join(" "), /疑似改写或新增情节/);
});

test("tiny prose overflow is trimmed locally only when dispensable words are available", () => {
  const narrative = {
    title: "A Small Door",
    paragraphs: [
      "Mia moved very slowly.",
      "Ben held the door.",
      "They crossed together.",
      "The bell rang softly.",
    ],
  };
  const words = narrative.paragraphs.join(" ").match(/[A-Za-z]+(?:['-][A-Za-z]+)*/g)?.length ?? 0;
  const trimmed = trimTinyNarrativeOverflow(narrative, words - 2);
  assert.equal(
    trimmed.paragraphs.join(" ").match(/[A-Za-z]+(?:['-][A-Za-z]+)*/g)?.length,
    words - 2,
  );
  assert.equal(trimTinyNarrativeOverflow(narrative, words - 4), narrative);
});

test("lexical simplification must stay near the original length and structure", () => {
  const original = {
    title: "The Hidden Gate",
    paragraphs: [
      "Mia held the heavy lantern while Ben opened the narrow gate.",
      "Cold rain struck the stones, but both friends stayed beside the wall.",
      "Ben replaced the difficult mechanism with a simple wooden handle.",
      "The gate moved at last, and a warm light showed the road home.",
    ],
  };
  const localEdit = {
    ...original,
    paragraphs: [
      original.paragraphs[0],
      original.paragraphs[1],
      "Ben replaced the difficult machine with a simple wooden handle.",
      original.paragraphs[3],
    ],
  };
  const shortened = {
    ...original,
    paragraphs: ["Mia held a lamp.", "Rain fell.", "Ben fixed the gate.", "They went home."],
  };
  assert.deepEqual(lexicalEditDriftIssues(original, localEdit), []);
  assert.match(lexicalEditDriftIssues(original, shortened).join("；"), /改变正文长度过多|超出局部换词范围/);
});

test("episode contract capacity validation rejects overloaded hard requirements", () => {
  const contract = buildEpisodeWritingContract({ examId: "middle" }, validPlan, 2);
  assert.deepEqual(episodeWritingContractCapacityIssues({
    ...contract,
    requiredEvents: [...contract.requiredEvents, "fifth hard event"],
    requiredClueActions: [
      ...contract.requiredClueActions,
      { clueId: "C3", action: "plant" },
    ],
  }), ["每集硬叙事任务不得超过四项", "每集强制线索动作不得超过两项"]);
});

test("episode draft failures report length pressure and the best four-dimensional scores", () => {
  assert.match(episodeDraftFailureSummary({
    rawWordCounts: [266, 491, 360],
    preflightRejected: 3,
    reviewed: 6,
    bestReview: strongCritique,
  }), /原始候选词数 266-491；前置硬门禁淘汰 3 稿；已完成 6 次独立评分；最佳四维/);
});

test("each exam stage uses its own later-episode reading length cap", () => {
  assert.deepEqual(buildEpisodeWritingContract({ examId: "middle" }, validPlan, 2).wordRange, [220, 310]);
  assert.deepEqual(buildEpisodeWritingContract({ examId: "high" }, validPlan, 2).wordRange, [260, 320]);
  assert.deepEqual(buildEpisodeWritingContract({ examId: "toeic" }, validPlan, 2).wordRange, [240, 300]);
  assert.deepEqual(buildEpisodeWritingContract({ examId: "toefl" }, validPlan, 2).wordRange, [600, 800]);
  assert.deepEqual(buildEpisodeWritingContract({ examId: "ielts" }, validPlan, 2).wordRange, [520, 700]);
});

test("frequent unfamiliar words become explicit learning targets instead of forcing a full rewrite", () => {
  const selected = prioritizeTargetWords(
    {
      paragraphs: [
        "A dragon crossed the flame while dust filled the gate.",
        "The dragon hid behind the gate.",
        "The flame showed a crack in the gate.",
        "The friends followed the dragon together.",
      ],
      targetWords: ["gate", "friends", "followed", "crossed"],
    },
    {
      score: 88,
      wordCount: 35,
      averageSentenceWords: 8.8,
      lexicalCoverage: 0.895,
      unfamiliarWords: ["dragon", "flame", "dust", "crack"],
      issues: ["高频词覆盖率不足"],
      blockingIssues: [],
    },
    5,
    (word) => ["gate", "friends", "followed", "crossed"].includes(word),
  );
  assert.deepEqual(selected, ["dragon", "flame", "dust", "crack", "gate"]);
});

test("discarded draft feedback is compacted before entering a new prompt", () => {
  const lessons = selectDraftLessonsForPrompt([
    "剧情逻辑 6.0 分：选择没有导致后果",
    "剧情逻辑 5.0 分：重要物件没有来源",
    "连续性 6.0 分：重复上一集的发现",
    "优先改进：先交代钥匙的来源",
    "优先改进：让角色的选择造成代价",
    "优先改进：结尾只保留一个悬念",
    "优先改进：这条应该因同类过多而被去掉",
    "自动门禁：正文过长",
  ]);

  assert.ok(lessons.length <= 6);
  assert.ok(lessons.every((lesson) => lesson.length <= 160));
  assert.equal(lessons.filter((lesson) => lesson.startsWith("剧情逻辑")).length, 1);
  assert.equal(lessons.filter((lesson) => lesson.startsWith("优先改进")).length, 1);
  assert.ok(lessons.some((lesson) => lesson.startsWith("自动门禁")));
});

test("candidate selection favors plot and child appeal quality", () => {
  const flatter = structuredClone(strongCritique);
  flatter.plot.score = 8;
  flatter.childAppeal.score = 7.5;
  flatter.gradedLanguage.score = 10;
  assert.equal(selectBestStoryCritique([flatter, strongCritique]), 1);
});

test("five-draft backbone selection preserves the original candidate index", () => {
  const weaker = structuredClone(strongCritique);
  weaker.plot.score = 7;
  weaker.childAppeal.score = 7;
  const strongest = structuredClone(strongCritique);
  strongest.plot.score = 9.5;
  strongest.childAppeal.score = 9;

  assert.equal(
    selectBackboneStoryCritique([weaker, null, strongCritique, strongest, null]),
    3,
  );
  assert.throws(() => selectBackboneStoryCritique([null, null]), /至少需要一份可用/);
});

test("cross-episode detector blocks near-duplicate narrative sentences", () => {
  const previous = checkpointEpisode("First");
  const repeated = checkpointEpisode("Second");
  repeated.paragraphs[0] = "Inside the old clock tower, Mia and Ben stood together and heard a strange sound.";
  assert.match(repeatedNarrativeIssues(repeated, previous).join(" "), /近似重复上一集/);
});

test("a completed checkpoint restores rows without republishing saved episodes", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "read-remember-story-checkpoint-"));
  const databasePath = path.join(directory, "checkpoint.sqlite");
  const episodeOne = checkpointEpisode("The First Clock");
  const episodeTwo = checkpointEpisode("The Second Clock");
  const quality = {
    score: 100,
    wordCount: 210,
    averageSentenceWords: 10,
    lexicalCoverage: 0.98,
    unfamiliarWords: [],
    issues: [],
    blockingIssues: [],
  };
  const logs: string[] = [];
  createDatabase(databasePath).close();
  const importedEpisodes: number[] = [];
  const options: StoryRunOptions = {
    databasePath,
    ecdictPath: path.join(directory, "missing-ecdict.sqlite"),
    baseUrl: "http://127.0.0.1:1",
    apiPath: "/must-not-be-called",
    apiKey: "",
    model: "unused",
    reviewModel: "unused",
    structureRepairModel: "unused",
    interest: "custom-story",
    customInterestName: "定制故事",
    customInterestSubtitle: "用户自己的连续故事",
    customInterestEmoji: "✨",
    customInterestColor: "#55766D",
    customInterestPrompt: "根据用户灵感创作原创连续故事。",
    customActivityPrompt: "预测下一集。",
    examId: "middle",
    sourceMode: "favorite",
    classicId: "",
    sourceTitle: "钟塔冒险",
    sourceNotes: "伙伴合作解开钟塔谜题",
    readerStage: "stage1",
    episodes: 2,
    importNamespace: "checkpoint-test",
    planCandidates: 3,
    episodeCandidates: 2,
    minLexicalCoverage: 0.95,
    temperature: 0.8,
    reviewTemperature: 0.2,
    timeoutMs: 50,
    rewriteTimeoutMs: 480_000,
    networkRetries: 1,
    structureRetries: 1,
    dryRun: false,
    force: false,
    log: (message) => logs.push(message),
    checkpoint: {
      version: 1,
      plan: validPlan,
      episodes: [
        { episode: episodeOne, quality },
        { episode: episodeTwo, quality },
      ],
    },
    onEpisodeImported: (episode) => {
      importedEpisodes.push(episode.episodeNumber);
      const checkpointDb = createDatabase(databasePath);
      try {
        const category = checkpointDb.prepare(
          "SELECT active FROM interest_categories WHERE id = 'custom-story'",
        ).get() as { active: number } | undefined;
        assert.equal(category?.active, 1);
        const imported = checkpointDb.prepare(
          "SELECT COUNT(*) AS count FROM articles WHERE series_title = ?",
        ).get(validPlan.seriesTitle) as { count: number };
        assert.equal(imported.count, episode.episodeNumber);
      } finally {
        checkpointDb.close();
      }
    },
  };
  try {
    const result = await runStoryGeneration(options);
    assert.equal(result.generated, 2);
    assert.equal(result.imported, 2);
    assert.deepEqual(importedEpisodes, []);
    assert.match(logs.join(" "), /已从检查点恢复/);
    const db = createDatabase(databasePath);
    try {
      const row = db.prepare(
        "SELECT COUNT(*) AS count FROM articles WHERE series_title = ?",
      ).get(validPlan.seriesTitle) as { count: number };
      assert.equal(row.count, 2);
    } finally {
      db.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("story quality measures actual frequency coverage", () => {
  const sentence = "The cat and dog helped together near the xylophonic gate.";
  const episode: GeneratedStoryEpisode = {
    title: "A Strange Gate",
    paragraphs: [Array(7).fill(sentence).join(" "), Array(7).fill(sentence).join(" "), Array(6).fill(sentence).join(" ")],
    targetWords: ["cat", "dog", "helped", "together"],
    continuitySummary: "伙伴们在门边发现了异常声音，并决定下一集共同检查齿轮。",
    storyState: {
      characterPositions: ["伙伴们都在旧门旁"],
      knownFacts: ["门后有重复的声音"],
      unresolvedQuestions: ["声音是谁制造的"],
      items: ["Ben 拿着工具箱"],
      relationshipChanges: ["Mia 开始主动分享发现"],
    },
    qualityEvidence: {
      idiomaticPhrase: "helped together",
      sensoryQuote: "near the xylophonic gate",
      causalLinks: [
        { causeQuote: "The cat and dog", effectQuote: "helped together" },
        { causeQuote: "helped together", effectQuote: "xylophonic gate" },
      ],
      clueEvidence: [
        { clueId: "C1", action: "plant", evidenceQuote: "near the xylophonic gate" },
      ],
      progression: {
        obstacleQuote: "The cat and dog",
        choiceQuote: "dog helped together",
        consequenceQuote: "near the xylophonic gate",
        newInformationQuote: "xylophonic gate",
      },
    },
    questions: [
      { prompt: "Where did the team stand?", options: ["Near the gate", "On a boat", "At school", "At home"], answer: 0, explanation: "原文说他们在门边。", skill: "detail", evidenceQuote: "near the xylophonic gate" },
      { prompt: "Why did they work together?", options: ["To check the gate", "To cook", "To sleep", "To leave"], answer: 0, explanation: "他们共同检查异常。", skill: "inference", evidenceQuote: "The cat and dog helped together" },
    ],
  };
  const quality = assessStoryQuality(
    episode,
    { examId: "middle", readerStage: "stage1", minLexicalCoverage: 0.95 },
    1,
    { lookup: (word) => word === "xylophonic" ? 5000 : 1 },
  );
  assert.equal(quality.lexicalCoverage, 0.9);
  assert.deepEqual(quality.unfamiliarWords, ["xylophonic"]);
  assert.match(quality.issues.join(" "), /高频词覆盖率不足/);

  episode.targetWords = ["xylophonic", "cat", "dog", "helped"];
  const qualityWithNewWord = assessStoryQuality(
    episode,
    { examId: "middle", readerStage: "stage1", minLexicalCoverage: 0.95 },
    1,
    { lookup: (word) => word === "xylophonic" ? 5000 : 1 },
  );
  assert.equal(qualityWithNewWord.lexicalCoverage, 0.9);
  assert.deepEqual(qualityWithNewWord.unfamiliarWords, ["xylophonic"]);

  const checkpointValue = {
    version: 1,
    plan: validPlan,
    episodes: [{ episode, quality: qualityWithNewWord }],
  } as const;
  const checkpointResult = storyGenerationCheckpointSchema.safeParse(checkpointValue);
  assert.equal(
    checkpointResult.success,
    true,
    checkpointResult.success ? "" : JSON.stringify(checkpointResult.error.issues),
  );
  const checkpoint = parseStoryGenerationCheckpoint(checkpointValue);
  assert.equal(checkpoint?.version, 2);
  assert.equal(checkpoint?.plan.seriesTitle, validPlan.seriesTitle);
  assert.equal(checkpoint?.episodes.length, 1);
  assert.equal(parseStoryGenerationCheckpoint({ version: 2 }), null);
});

test("lexical normalization treats possessive story names as their allowed base name", () => {
  assert.equal(normalizeLexicalToken("Aelith's"), "aelith");
  assert.equal(normalizeLexicalToken("AELITH"), "aelith");
});

test("mechanical repair never replaces a readable draft with a truncated story", () => {
  const before = {
    score: 88,
    wordCount: 266,
    averageSentenceWords: 10,
    lexicalCoverage: 0.898,
    unfamiliarWords: ["dragon"],
    issues: ["高频词覆盖率不足"],
    blockingIssues: [],
  };
  const truncated = {
    ...before,
    score: 76,
    wordCount: 53,
    lexicalCoverage: 0.906,
    issues: ["正文过短：53 < 180"],
    blockingIssues: ["正文过短：53 < 180"],
  };
  const improved = {
    ...before,
    score: 100,
    wordCount: 250,
    lexicalCoverage: 0.91,
    issues: [],
  };
  assert.equal(shouldAdoptMechanicalRepair(before, truncated, 0.95), false);
  assert.equal(shouldAdoptMechanicalRepair(before, improved, 0.95), true);
});

test("an in-progress episode checkpoint resumes from its exact generation stage", () => {
  const episode = checkpointEpisode("Saved Draft");
  const { questions: _questions, ...content } = episode;
  const quality = assessStoryQuality(
    content,
    { examId: "middle", readerStage: "stage1", minLexicalCoverage: 0.95 },
    1,
  );
  const checkpoint = parseStoryGenerationCheckpoint({
    version: 2,
    plan: validPlan,
    episodes: [],
    reviewCalibrationVersion: "independent-four-dimension-v2-calibrated-7-7.5",
    activeEpisode: {
      index: 0,
      stage: "mechanical_repaired",
      episode: content,
      quality,
      fullRewriteCount: 2,
      mechanicalRepairUsed: true,
      semanticRewriteUsed: false,
      lexicalRepairExhausted: true,
    },
  });
  assert.equal(checkpoint?.activeEpisode?.stage, "mechanical_repaired");
  assert.equal(checkpoint?.activeEpisode?.fullRewriteCount, 2);
  assert.equal(checkpoint?.activeEpisode?.lexicalRepairExhausted, true);
  assert.equal(checkpoint?.activeEpisode?.episode.title, "Saved Draft");
  assert.equal(checkpoint?.reviewCalibrationVersion, "independent-four-dimension-v2-calibrated-7-7.5");
});

test("staged checkpoints preserve a selected narrative through metadata, questions, and publish boundaries", () => {
  const completed = checkpointEpisode("Saved by stage");
  const { questions: _questions, ...content } = completed;
  const narrative = { title: content.title, paragraphs: content.paragraphs };
  const quality = assessStoryQuality(
    content,
    { examId: "middle", readerStage: "stage1", minLexicalCoverage: 0.95 },
    1,
  );
  const counters = {
    fullRewriteCount: 1,
    mechanicalRepairUsed: false,
    semanticRewriteUsed: true,
    localRepairAttempts: { metadata: 0, lexical: 0 },
  };
  const metadataPending = parseStoryGenerationCheckpoint({
    version: 2,
    plan: validPlan,
    episodes: [],
    stagedEpisode: {
      index: 0,
      stage: "metadata_pending",
      narrative,
      critique: strongCritique,
      semanticReview: strongCritique,
      textHash: episodeNarrativeHash(narrative),
      source: "selected",
      ...counters,
    },
  });
  assert.equal(metadataPending?.stagedEpisode?.stage, "metadata_pending");
  assert.equal(metadataPending?.stagedEpisode?.textHash, episodeNarrativeHash(narrative));

  const questionsPending = parseStoryGenerationCheckpoint({
    version: 2,
    plan: validPlan,
    episodes: [],
    stagedEpisode: {
      index: 0,
      stage: "questions_pending",
      episode: content,
      quality,
      critique: strongCritique,
      semanticReview: strongCritique,
      textHash: episodeNarrativeHash(content),
      ...counters,
    },
  });
  assert.equal(questionsPending?.stagedEpisode?.stage, "questions_pending");

  const ready = parseStoryGenerationCheckpoint({
    version: 2,
    plan: validPlan,
    episodes: [],
    stagedEpisode: {
      index: 0,
      stage: "ready_to_publish",
      episode: completed,
      quality,
      semanticReview: strongCritique,
      textHash: episodeNarrativeHash(completed),
      ...counters,
    },
  });
  assert.equal(ready?.stagedEpisode?.stage, "ready_to_publish");
});

test("story quality blocks mixed Chinese and questions without source evidence", () => {
  const episode = checkpointEpisode("The Broken Map");
  episode.paragraphs[0] += " 小心!";
  episode.questions[1].evidenceQuote = "An old map showed them a hidden tunnel";
  const quality = assessStoryQuality(
    episode,
    { examId: "middle", readerStage: "stage1", minLexicalCoverage: 0.95 },
    1,
  );
  assert.match(quality.blockingIssues.join(" "), /夹杂中文/);
  assert.match(quality.blockingIssues.join(" "), /第 2 题的原文证据不存在/);
  assert.equal(passesStoryQualityFloor(quality, 0.95), false);
});

test("sensory keywords do not veto real original quotes but fabricated quotes remain blocked", () => {
  const episode = checkpointEpisode("Rain at the Door");
  episode.paragraphs[0] += " Rain still ran down his hood.";
  episode.qualityEvidence.sensoryQuote = "Rain still ran down his hood.";
  const options = { examId: "middle" as const, readerStage: "stage1" as const, minLexicalCoverage: 0.95 };
  const quality = assessStoryQuality(episode, options, 1);
  assert.equal(quality.blockingIssues.some((issue) => issue.startsWith("五感描写证据")), false);
  assert.ok(quality.issues.some((issue) => issue.includes("由独立语义评审")));
  episode.qualityEvidence.sensoryQuote = "A bright lamp lit an imaginary room.";
  assert.ok(assessStoryQuality(episode, options, 1).blockingIssues.some((issue) => issue.startsWith("五感描写证据")));
});

test("checkpoint keeps separate local repair counters without resetting full rewrite usage", () => {
  const { questions: _questions, ...episode } = checkpointEpisode("Saved local repair");
  const base = { version: 2, plan: validPlan, episodes: [], activeEpisode: {
    index: 0, stage: "semantic_reviewed", episode, fullRewriteCount: 4,
    mechanicalRepairUsed: true, semanticRewriteUsed: true,
    localRepairAttempts: { metadata: 1, lexical: 1 },
  } };
  const restored = parseStoryGenerationCheckpoint(base);
  assert.deepEqual(restored?.activeEpisode?.localRepairAttempts, { metadata: 1, lexical: 1 });
  assert.equal(restored?.activeEpisode?.fullRewriteCount, 4);
  const { localRepairAttempts: _old, ...legacy } = base.activeEpisode;
  assert.ok(parseStoryGenerationCheckpoint({ ...base, activeEpisode: legacy }));
});

test("story content can pass through quality checks before questions are generated", () => {
  const { questions: _questions, ...content } = checkpointEpisode("Question Later");
  const quality = assessStoryQuality(
    content,
    { examId: "middle", readerStage: "stage1", minLexicalCoverage: 0.95 },
    1,
  );
  assert.doesNotMatch(quality.issues.join(" "), /题目|选项|答案/);
});

test("a draft with one causal link is checkpointable and deferred to the final quality repair", () => {
  const { questions: _questions, ...content } = checkpointEpisode("One Link Draft");
  content.qualityEvidence.causalLinks = content.qualityEvidence.causalLinks.slice(0, 1);
  const quality = assessStoryQuality(
    content,
    { examId: "middle", readerStage: "stage1", minLexicalCoverage: 0.95 },
    1,
  );
  assert.match(quality.blockingIssues.join(" "), /因果证据不足/);
  const checkpoint = parseStoryGenerationCheckpoint({
    version: 2,
    plan: validPlan,
    episodes: [],
    activeEpisode: {
      index: 0,
      stage: "draft_selected",
      episode: content,
      quality,
      fullRewriteCount: 0,
      mechanicalRepairUsed: false,
      semanticRewriteUsed: false,
    },
  });
  assert.equal(checkpoint?.activeEpisode?.episode.qualityEvidence.causalLinks.length, 1);
});

test("short quoted dialogue is excluded from the fragment sentence ratio", () => {
  const withDialogue = "'Wait!' Mia ran quickly toward the open tower door. 'Look!' Ben followed her without slowing down.";
  const withNarrativeFragments = "'Wait!' Mia ran. 'Look!' Ben stopped beside the door.";
  assert.equal(fragmentSentenceRatio(withDialogue), 0);
  assert.ok(fragmentSentenceRatio(withNarrativeFragments) > 0);
});

test("story quality keeps coverage as a diagnostic regardless of the measured percentage", () => {
  const baseQuality = {
    score: 88,
    wordCount: 240,
    averageSentenceWords: 10,
    lexicalCoverage: 0.913,
    unfamiliarWords: ["blade", "dull"],
    issues: ["高频词覆盖率不足"],
    blockingIssues: [],
  };
  assert.equal(passesStoryQualityFloor(baseQuality, 0.95), true);
  assert.equal(
    passesStoryQualityFloor({ ...baseQuality, lexicalCoverage: 0.899 }, 0.95),
    true,
  );
  assert.equal(passesStoryQualityFloor({ ...baseQuality, lexicalCoverage: 0.895 }, 0.95), true);
});

test("model JSON parser ignores a second object or trailing commentary", () => {
  assert.deepEqual(
    parseJson('{"title":"first","note":"brace } inside"}\n{"title":"second"}'),
    { title: "first", note: "brace } inside" },
  );
  assert.deepEqual(parseJson('说明：\n[1,{"ok":true}]\n完成'), [1, { ok: true }]);
});

test("JSON structure correction alternates between M2.7 and M3", () => {
  const models = {
    model: "MiniMax-M2.7",
    reviewModel: "MiniMax-M3",
    structureRepairModel: "MiniMax-M3",
  };
  assert.equal(structureModelForAttempt(models, "MiniMax-M2.7", 1), "MiniMax-M2.7");
  assert.equal(structureModelForAttempt(models, "MiniMax-M2.7", 2), "MiniMax-M3");
  assert.equal(structureModelForAttempt(models, "MiniMax-M3", 1), "MiniMax-M3");
  assert.equal(structureModelForAttempt(models, "MiniMax-M3", 2), "MiniMax-M3");
});

test("a rejected provider schema is logged once and skipped for the same endpoint model and shape", async () => {
  const bodies: Array<Record<string, unknown>> = [];
  const logs: string[] = [];
  const server = createServer((request, response) => {
    let raw = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => { raw += chunk; });
    request.on("end", () => {
      const body = JSON.parse(raw) as Record<string, unknown>;
      bodies.push(body);
      if ((body.response_format as { type?: string }).type === "json_schema") {
        response.writeHead(400, { "content-type": "application/json" });
        response.end('{"error":{"message":"response_format json_schema does not support top-level anyOf"}}');
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' }, finish_reason: "stop" }] }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const options = {
    baseUrl: `http://127.0.0.1:${address.port}`,
    apiPath: "/chat/completions", apiKey: "", model: "schema-cache-model",
    reviewModel: "schema-cache-model", structureRepairModel: "schema-cache-model",
    temperature: 0.1, reviewTemperature: 0.1, timeoutMs: 1_000, rewriteTimeoutMs: 1_000,
    networkRetries: 1, structureRetries: 1, log: (message: string) => logs.push(message),
  } as unknown as StoryRunOptions;
  try {
    const schema = z.object({ ok: z.boolean() });
    await callStructured(options, schema, "Return JSON.", "Return JSON.", options.model, 0.1, { stage: "cache-test" });
    await callStructured(options, schema, "Return JSON.", "Return JSON.", options.model, 0.1, { stage: "cache-test" });
    assert.deepEqual(bodies.map((body) => (body.response_format as { type: string }).type), ["json_schema", "json_object", "json_object"]);
    assert.match(logs.join(" "), /stage=cache-test.*root=object.*top-level anyOf/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("streaming model responses are assembled even when the provider reports a token boundary", async () => {
  const response = new Response([
    'data: {"choices":[{"delta":{"content":"{\\"ok\\":"},"finish_reason":null}]}',
    "",
    'data: {"choices":[{"delta":{"content":"true}"},"finish_reason":"length"}]}',
    "",
  ].join("\n"), { headers: { "content-type": "text/event-stream" } });
  assert.equal(
    await readStreamingModelContent(
      response as unknown as Parameters<typeof readStreamingModelContent>[0],
    ),
    '{"ok":true}',
  );
});

test("streaming model responses accept array text blocks", async () => {
  const response = new Response(
    'data: {"choices":[{"delta":{"content":[{"type":"text","text":"{\\"ok\\":true}"}]},"finish_reason":"stop"}]}\n\n',
    { headers: { "content-type": "text/event-stream" } },
  );
  assert.equal(
    await readStreamingModelContent(
      response as unknown as Parameters<typeof readStreamingModelContent>[0],
    ),
    '{"ok":true}',
  );
});

test("reasoning-only streaming responses report finish and diagnostic details", async () => {
  const response = new Response([
    'data: {"choices":[{"delta":{"reasoning_content":"still thinking"},"finish_reason":null}]}',
    "",
    'data: {"choices":[{"delta":{},"finish_reason":"length"}],"base_resp":{"status_code":0,"status_msg":""}}',
    "",
  ].join("\n"), { headers: { "content-type": "text/event-stream" } });
  await assert.rejects(
    readStreamingModelContent(
      response as unknown as Parameters<typeof readStreamingModelContent>[0],
    ),
    /没有文本内容.*finish=length.*reasoningChars=14/,
  );
});

test("reasoning-only length responses recover through MiniMax M3 direct output independently of structure retries", async () => {
  const requestBodies: Array<Record<string, unknown>> = [];
  const logs: string[] = [];
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      requestBodies.push(JSON.parse(body) as Record<string, unknown>);
      response.writeHead(200, { "content-type": "text/event-stream" });
      if (requestBodies.length === 1) {
        response.end([
        'data: {"choices":[{"delta":{"reasoning_content":"planned the final object"},"finish_reason":null}]}',
        "",
        'data: {"choices":[{"delta":{},"finish_reason":"length"}],"base_resp":{"status_code":0,"status_msg":""}}',
        "",
        ].join("\n"));
        return;
      }
      response.end(
        'data: {"choices":[{"delta":{"content":"{\\"ok\\":true}"},"finish_reason":"stop"}],"base_resp":{"status_code":0,"status_msg":""}}\n\n',
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  try {
    const result = await callStructured(
      {
        baseUrl: `http://127.0.0.1:${address.port}`,
        apiPath: "/chat/completions",
        apiKey: "",
        model: "MiniMax-M2.7",
        reviewModel: "MiniMax-M3",
        structureRepairModel: "MiniMax-M3",
        temperature: 0.65,
        reviewTemperature: 0.15,
        timeoutMs: 1_000,
        rewriteTimeoutMs: 1_000,
        networkRetries: 1,
        structureRetries: 1,
        log: (message: string) => { logs.push(message); },
      } as unknown as StoryRunOptions,
      z.object({ ok: z.boolean() }),
      "Return JSON.",
      "Return an object.",
      "MiniMax-M3",
      0.15,
      { structureRetries: 1, maxCompletionTokens: 16_384 },
    );
    assert.deepEqual(result, { ok: true });
    assert.equal(requestBodies.length, 2);
    assert.equal((requestBodies[0].response_format as { type?: string }).type, "json_schema");
    assert.deepEqual(
      Object.keys(((requestBodies[0].response_format as { json_schema?: { schema?: { properties?: object } } })
        .json_schema?.schema?.properties) ?? {}),
      ["ok"],
    );
    assert.equal(requestBodies[1].model, "MiniMax-M3");
    assert.deepEqual(requestBodies[1].thinking, { type: "disabled" });
    assert.match(logs.join(" "), /自动切换.*MiniMax-M3.*直接输出模式/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("a 529 during partial recovery stays an infrastructure error instead of becoming a schema error", async () => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      choices: [{ message: { content: '{"ok":true}' }, finish_reason: "stop" }],
    }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  try {
    await assert.rejects(
      callStructured(
        {
          baseUrl: `http://127.0.0.1:${address.port}`,
          apiPath: "/chat/completions",
          apiKey: "",
          model: "MiniMax-M3",
          reviewModel: "MiniMax-M3",
          structureRepairModel: "MiniMax-M3",
          temperature: 0.1,
          reviewTemperature: 0.1,
          timeoutMs: 1_000,
          rewriteTimeoutMs: 1_000,
          networkRetries: 1,
          structureRetries: 1,
          log: () => undefined,
        } as unknown as StoryRunOptions,
        z.object({ ok: z.boolean(), metadata: z.string() }),
        "Return JSON.",
        "Return an object.",
        "MiniMax-M3",
        0.1,
        {
          structureRetries: 1,
          recoverPartial: async () => {
            throw new Error("ModelHttpError · 模型接口返回 529: overloaded_error (2064)");
          },
        },
      ),
      (error: unknown) => {
        assert.equal(isTransientModelCapacityError(error), true);
        assert.doesNotMatch((error as Error).message, /模型连续|正文局部恢复失败/);
        return true;
      },
    );
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("serialized repair backpressure remains classified as model capacity", () => {
  assert.equal(isTransientModelCapacityError(new Error("模型服务繁忙，已停止本批后续长度校正请求")), true);
  assert.equal(isTransientModelCapacityError(new Error("TypeError · terminated · ECONNRESET · read ECONNRESET")), true);
  assert.equal(isTransientModelCapacityError(new Error("fetch failed · UND_ERR_CONNECT_TIMEOUT")), true);
});

test("identical story failures share a fingerprint but changed checkpoints do not", () => {
  const first = storyFailureFingerprint("same failure", null, 3);
  assert.equal(storyFailureFingerprint("same failure", null, 3), first);
  assert.notEqual(storyFailureFingerprint("different failure", null, 3), first);
  assert.notEqual(storyFailureFingerprint("same failure", null, 4), first);
});

test("a saved season plan must not fuse different fresh candidate failures", () => {
  const checkpoint = parseStoryGenerationCheckpoint({ version: 2, plan: validPlan, episodes: [] });
  assert.ok(checkpoint);
  assert.equal(shouldFuseStoryFailure(new Error("same message"), checkpoint, 2), false);
  const active = {
    ...checkpoint,
    activeEpisode: { index: 0, stage: "mechanical_repaired" as const,
      episode: checkpointEpisode("saved draft"), fullRewriteCount: 1,
      mechanicalRepairUsed: true, semanticRewriteUsed: false },
  };
  assert.equal(shouldFuseStoryFailure(new Error("same message"), active, 2), true);
  assert.equal(shouldFuseStoryFailure(new Error("same message"), active, 1), false);
  assert.equal(shouldFuseStoryFailure(new StoryGenerationFailure("same message", "CANDIDATE_LEXICAL_GATE", "lexical", "new_candidates"), active, 2), false);
});

test("model JSON parser skips regex examples before the real object", () => {
  assert.deepEqual(
    parseJson('targetWords 必须匹配 [a-z]。\n最终结果：\n{"title":"Bao","targetWords":["sky","gate"]}'),
    { title: "Bao", targetWords: ["sky", "gate"] },
  );
});

test("model JSON parser repairs common near-JSON output", () => {
  assert.deepEqual(
    parseJson("结果：{'title':'Bao','targetWords':['sky','gate',],}"),
    { title: "Bao", targetWords: ["sky", "gate"] },
  );
});

test("model JSON parser repairs the real object after an invalid regex fragment", () => {
  assert.deepEqual(
    parseJson("格式示例 [a-z]。结果：{'title':'Bao','targetWords':['sky','gate',],}"),
    { title: "Bao", targetWords: ["sky", "gate"] },
  );
});

test("structured JSON parser unwraps arrays and common response envelopes", () => {
  const arrayValues = structuredJsonValues('[{"title":"Episode One","paragraphs":[]}]');
  assert.equal(
    arrayValues.some(
      (value) => !Array.isArray(value) && typeof value === "object" && value !== null
        && (value as { title?: string }).title === "Episode One",
    ),
    true,
  );
  const wrappedValues = structuredJsonValues(
    '{"data":[{"title":"Episode Two","paragraphs":[]}]}',
  );
  assert.equal(
    wrappedValues.some(
      (value) => !Array.isArray(value) && typeof value === "object" && value !== null
        && (value as { title?: string }).title === "Episode Two",
    ),
    true,
  );
  const splitObjectValues = structuredJsonValues(
    '[{"title":"Episode Three"},{"paragraphs":["one","two","three"]}]',
  );
  assert.equal(
    splitObjectValues.some(
      (value) => !Array.isArray(value) && typeof value === "object" && value !== null
        && (value as { title?: string; paragraphs?: string[] }).title === "Episode Three"
        && (value as { paragraphs?: string[] }).paragraphs?.length === 3,
    ),
    true,
  );
  const stringValues = structuredJsonValues(
    '["{\\"title\\":\\"Episode Four\\",\\"paragraphs\\":[]}"]',
  );
  assert.equal(
    stringValues.some(
      (value) => !Array.isArray(value) && typeof value === "object" && value !== null
        && (value as { title?: string }).title === "Episode Four",
    ),
    true,
  );
});

test("target word normalization accepts model labels and explanations", () => {
  assert.deepEqual(
    normalizeTargetWords([
      "1. energy blade（能量刃）",
      "to rush - 冲过去",
      { word: "GLOW: to shine softly" },
      "teamwork",
      "[a-z]",
    ]),
    ["blade", "rush", "glow", "teamwork"],
  );
});

test("overlong continuity summaries are clipped locally instead of regenerating the episode", () => {
  const longSummary = `${"人物仍在钟塔，已经确认铜钥匙属于旧机器，但地板下的蓝光来源尚未解决。".repeat(80)}结尾`;
  const normalized = normalizeContinuitySummary(longSummary);
  assert.equal(typeof normalized, "string");
  assert.ok((normalized as string).length <= 1200);
  assert.match(normalized as string, /[。；]$/);
});

test("one-character item placeholders are removed locally", () => {
  const episode = checkpointEpisode("Clean State");
  episode.storyState.items = ["A", "铜钥匙由 Mia 保管"];
  const parsed = storyGenerationCheckpointSchema.parse({
    version: 1,
    plan: validPlan,
    episodes: [{
      episode,
      quality: {
        score: 100,
        wordCount: 220,
        averageSentenceWords: 10,
        lexicalCoverage: 0.98,
        unfamiliarWords: [],
        issues: [],
        blockingIssues: [],
      },
    }],
  });
  assert.deepEqual(parsed.episodes[0].episode.storyState.items, ["铜钥匙由 Mia 保管"]);
});
