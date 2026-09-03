import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { z } from "zod";
import {
  assessStoryQuality,
  buildDiscardedDraftLessons,
  buildNarrativeCraftBrief,
  buildEpisodeWritingContract,
  buildSeriesPlanPrompt,
  callStructured,
  creativeDraftModelPolicy,
  fragmentSentenceRatio,
  isStrictStoryCritique,
  isStoryCritiqueImprovement,
  loadStoryEngagementBrief,
  mergeEpisodeStructure,
  normalizeCandidateCritiqueBatch,
  normalizeContinuitySummary,
  normalizeEpisodeNarrative,
  normalizeLexicalToken,
  normalizePlanningArtifact,
  normalizeSeriesPlan,
  normalizeStoryCritique,
  normalizeTargetWords,
  narrativePreflightIssues,
  parseJson,
  parseStoryGenerationCheckpoint,
  prioritizeTargetWords,
  readStreamingModelContent,
  passesStoryQualityFloor,
  repeatedNarrativeIssues,
  resolveReaderProfile,
  runStoryGeneration,
  selectBackboneStoryCritique,
  selectBestStoryCritique,
  selectDraftLessonsForPrompt,
  shouldAdoptMechanicalRepair,
  semanticPlanningModelPolicy,
  semanticRewriteModelPolicy,
  semanticQualityIssues,
  storyWordLimits,
  structureModelForAttempt,
  storyGenerationCheckpointSchema,
  structuredJsonValues,
  validateSeriesPlan,
  type GeneratedStoryEpisode,
  type SeriesPlan,
  type StoryCritique,
  type StoryRunOptions,
} from "../scripts/generate-story-series";
import { createDatabase } from "../src/database";
import {
  automaticQualityRetryLimit,
  episodeAutomaticRetryState,
  isRecoverableStoryQualityFailure,
} from "../src/custom-story";

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

test("series plan validator enforces clue chronology", () => {
  assert.equal(validateSeriesPlan(validPlan, 2).seriesTitle, validPlan.seriesTitle);
  const invalid = structuredClone(validPlan);
  invalid.clueLedger[0].introducedIn = 2;
  invalid.clueLedger[0].usedIn = 1;
  assert.throws(() => validateSeriesPlan(invalid, 2), /顺序不合法/);
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
    /不得把上一集已知事实再次写成新发现/,
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

const strongCritique: StoryCritique = {
  plot: { score: 9, issues: [] },
  childAppeal: { score: 9, issues: [] },
  gradedLanguage: { score: 8.5, issues: [] },
  continuity: { score: 9, issues: [] },
  rewritePriorities: ["保持当前清晰推进"],
};

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
      return Array(size).fill("word").join(" ");
    }),
  });

  assert.deepEqual(storyWordLimits({ examId: "middle" }, 1), {
    targetRange: [180, 280],
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
    networkRetries: 1,
    structureRetries: 2,
    maxCompletionTokens: 8_192,
    disableThinking: true,
  });
});

test("semantic rewrite planning uses a separate M3 direct blueprint before execution", () => {
  assert.deepEqual(semanticPlanningModelPolicy({ rewriteTimeoutMs: 480_000 }), {
    timeoutMs: 480_000,
    networkRetries: 1,
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
  assert.equal(contract.requiredEvents.length, 7);
  assert.match(contract.requiredEvents[4], /铜盒/);
  assert.match(contract.requiredEvents[5], /伙伴合作必须实际改变结果/);
  assert.ok(contract.optionalIfSpace.some((item) => /广播员/.test(item)));
  assert.ok(contract.optionalIfSpace.some((item) => /Ben/.test(item)));
  assert.deepEqual(contract.requiredClueActions, [
    { clueId: "C1", action: "payoff" },
    { clueId: "C2", action: "payoff" },
  ]);
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

  assert.ok(lessons.length <= 8);
  assert.equal(lessons.filter((lesson) => lesson.startsWith("剧情逻辑")).length, 1);
  assert.equal(lessons.filter((lesson) => lesson.startsWith("优先改进")).length, 3);
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

test("a completed checkpoint skips model calls and imports saved episodes", async () => {
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
    assert.deepEqual(importedEpisodes, [1, 2]);
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
  assert.equal(qualityWithNewWord.lexicalCoverage, 1);
  assert.deepEqual(qualityWithNewWord.unfamiliarWords, []);

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
    },
  });
  assert.equal(checkpoint?.activeEpisode?.stage, "mechanical_repaired");
  assert.equal(checkpoint?.activeEpisode?.fullRewriteCount, 2);
  assert.equal(checkpoint?.activeEpisode?.episode.title, "Saved Draft");
  assert.equal(checkpoint?.reviewCalibrationVersion, "independent-four-dimension-v2-calibrated-7-7.5");
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

test("story quality keeps 95 percent as a target and allows one token of rounding at the 90 percent floor", () => {
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
  assert.equal(
    passesStoryQualityFloor({ ...baseQuality, lexicalCoverage: 0.895 }, 0.95),
    false,
  );
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
    assert.equal(requestBodies[1].model, "MiniMax-M3");
    assert.deepEqual(requestBodies[1].thinking, { type: "disabled" });
    assert.match(logs.join(" "), /自动切换.*MiniMax-M3.*直接输出模式/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
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
