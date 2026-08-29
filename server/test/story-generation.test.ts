import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assessStoryQuality,
  buildSeriesPlanPrompt,
  loadStoryEngagementBrief,
  normalizeTargetWords,
  parseJson,
  parseStoryGenerationCheckpoint,
  passesStoryQualityFloor,
  resolveReaderProfile,
  runStoryGeneration,
  storyGenerationCheckpointSchema,
  structuredJsonValues,
  validateSeriesPlan,
  type GeneratedStoryEpisode,
  type SeriesPlan,
  type StoryRunOptions,
} from "../scripts/generate-story-series";
import { createDatabase } from "../src/database";

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
    questions: [
      { prompt: "What did the friends share?", options: ["A brass key", "A boat", "A meal", "A map"], answer: 0, explanation: "原文说他们共同使用铜钥匙。" },
      { prompt: "Why will they continue?", options: ["They saw a moving light", "They lost a book", "They heard music", "They felt tired"], answer: 0, explanation: "地板下移动的光形成了新的问题。" },
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
  };
  const logs: string[] = [];
  const setupDb = createDatabase(databasePath);
  setupDb.prepare(
    `INSERT INTO interest_categories(
      id, name, subtitle, emoji, color, activity_prompt, story_prompt, active
     ) VALUES ('custom-story', '定制故事', '用户自己的连续故事', '✨', '#55766D',
       '预测下一集。', '根据用户灵感创作原创连续故事。', 1)`,
  ).run();
  setupDb.close();
  const options: StoryRunOptions = {
    databasePath,
    ecdictPath: path.join(directory, "missing-ecdict.sqlite"),
    baseUrl: "http://127.0.0.1:1",
    apiPath: "/must-not-be-called",
    apiKey: "",
    model: "unused",
    reviewModel: "unused",
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
    minLexicalCoverage: 0.95,
    temperature: 0.8,
    reviewTemperature: 0.2,
    timeoutMs: 50,
    maxRetries: 1,
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
  };
  try {
    const result = await runStoryGeneration(options);
    assert.equal(result.generated, 2);
    assert.equal(result.imported, 2);
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
    questions: [
      { prompt: "Where did the team stand?", options: ["Near the gate", "On a boat", "At school", "At home"], answer: 0, explanation: "原文说他们在门边。" },
      { prompt: "Why did they work together?", options: ["To check the gate", "To cook", "To sleep", "To leave"], answer: 0, explanation: "他们共同检查异常。" },
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
  assert.equal(checkpoint?.plan.seriesTitle, validPlan.seriesTitle);
  assert.equal(checkpoint?.episodes.length, 1);
  assert.equal(parseStoryGenerationCheckpoint({ version: 2 }), null);
});

test("story quality keeps 95 percent as a target but publishes above the 90 percent floor", () => {
  const baseQuality = {
    score: 88,
    wordCount: 240,
    averageSentenceWords: 10,
    lexicalCoverage: 0.913,
    unfamiliarWords: ["blade", "dull"],
    issues: ["高频词覆盖率不足"],
  };
  assert.equal(passesStoryQualityFloor(baseQuality, 0.95), true);
  assert.equal(
    passesStoryQualityFloor({ ...baseQuality, lexicalCoverage: 0.899 }, 0.95),
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
