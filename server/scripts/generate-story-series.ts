import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { jsonrepair } from "jsonrepair";
import type { ExamId, InterestId, Question } from "../../client/src/types";
import { createDatabase } from "../src/database";
import { importArticles } from "../src/content-import";
import { openEcdict } from "../src/ecdict";

const storyInterestIds = [
  "military",
  "art",
  "science",
  "why",
  "fantasy",
  "mecha",
  "cultivation",
  "tiger",
  "cat",
  "custom-story",
] as const;
type StoryInterestId = string;

const sourceModes = ["original", "classic", "favorite"] as const;
export type StorySourceMode = (typeof sourceModes)[number];

const readerStageIds = ["auto", "starter", "stage1", "stage2", "stage3", "stage4", "stage5", "stage6"] as const;
export type ReaderStageId = (typeof readerStageIds)[number];

const classicSourceIds = [
  "alice",
  "treasure-island",
  "secret-garden",
  "around-the-world",
  "journey-west",
  "aesop",
  "sherlock-holmes",
  "little-princess",
  "wizard-of-oz",
  "tom-sawyer",
] as const;
export type ClassicSourceId = (typeof classicSourceIds)[number];

const classicSources: Record<
  ClassicSourceId,
  { title: string; author: string; storyCore: string; childAppeal: string }
> = {
  alice: {
    title: "Alice's Adventures in Wonderland",
    author: "Lewis Carroll",
    storyCore: "a curious child follows an impossible clue into a world whose strange rules must be understood",
    childAppeal: "wordplay, surprising creatures, changing size, and comic logic puzzles",
  },
  "treasure-island": {
    title: "Treasure Island",
    author: "Robert Louis Stevenson",
    storyCore: "a young person finds a map, joins a dangerous voyage, and learns that trust must be earned",
    childAppeal: "secret maps, ships, hidden loyalties, codes, and island exploration",
  },
  "secret-garden": {
    title: "The Secret Garden",
    author: "Frances Hodgson Burnett",
    storyCore: "lonely children restore a hidden garden and gradually help one another become braver and kinder",
    childAppeal: "a locked place, a buried key, animals, seasonal change, and a healing friendship",
  },
  "around-the-world": {
    title: "Around the World in Eighty Days",
    author: "Jules Verne",
    storyCore: "a precise traveler races against time while unexpected people and choices change the meaning of the journey",
    childAppeal: "countdowns, transport, distant places, close escapes, and clever route changes",
  },
  "journey-west": {
    title: "Journey to the West",
    author: "Wu Cheng'en",
    storyCore: "very different companions travel toward a shared goal and survive trials by combining courage, judgment, and loyalty",
    childAppeal: "magical tools, transformations, comic arguments, monsters, and team-based trials",
  },
  aesop: {
    title: "Aesop's Fables",
    author: "traditional, attributed to Aesop",
    storyCore: "animals make understandable mistakes and discover consequences through a short, concrete conflict",
    childAppeal: "talking animals, quick reversals, humor, and simple choices with visible results",
  },
  "sherlock-holmes": {
    title: "The Early Sherlock Holmes Stories",
    author: "Arthur Conan Doyle",
    storyCore: "an observer notices ordinary details that others miss and tests several explanations before solving a fair mystery",
    childAppeal: "clues, disguises, codes, wrong guesses, and satisfying deductions",
  },
  "little-princess": {
    title: "A Little Princess",
    author: "Frances Hodgson Burnett",
    storyCore: "a child facing a sudden loss protects dignity and friendship through imagination, courage, and generosity",
    childAppeal: "secret kindness, dramatic reversal, found family, and hope in a difficult place",
  },
  "wizard-of-oz": {
    title: "The Wonderful Wizard of Oz",
    author: "L. Frank Baum",
    storyCore: "a child and three unusual companions cross a strange land, each slowly proving they already have the quality they seek",
    childAppeal: "a colorful road, odd cities, playful dangers, riddles, and lovable companions",
  },
  "tom-sawyer": {
    title: "The Adventures of Tom Sawyer",
    author: "Mark Twain",
    storyCore: "an imaginative child turns ordinary life into adventures, but must learn when a joke becomes a real responsibility",
    childAppeal: "mischief, caves, treasure, school life, friendship, and comic plans that go wrong",
  },
};

const readerStages = {
  starter: { label: "Starter", headwords: 250, cefr: "A1", maxNewWords: 4 },
  stage1: { label: "Stage 1", headwords: 400, cefr: "A1-A2", maxNewWords: 5 },
  stage2: { label: "Stage 2", headwords: 700, cefr: "A2-B1", maxNewWords: 6 },
  stage3: { label: "Stage 3", headwords: 1000, cefr: "B1", maxNewWords: 7 },
  stage4: { label: "Stage 4", headwords: 1400, cefr: "B1-B2", maxNewWords: 8 },
  stage5: { label: "Stage 5", headwords: 1800, cefr: "B2", maxNewWords: 8 },
  stage6: { label: "Stage 6", headwords: 2500, cefr: "B2-C1", maxNewWords: 8 },
} as const;
type ResolvedReaderStageId = keyof typeof readerStages;

type StoryGuide = {
  label: string;
  promise: string;
  cast: string;
  humor: string;
};

const storyGuides: Record<
  (typeof storyInterestIds)[number],
  { label: string; promise: string; cast: string; humor: string }
> = {
  military: {
    label: "军事科技与工程冒险",
    promise: "以雷达、导航、通信、救援工程和历史技术为核心的任务故事；强调判断、协作与和平用途，不渲染伤害",
    cast: "一位爱动手的少年工程师、一位重视证据的队友、一位幽默的通信伙伴，以及动机复杂但可理解的竞争者",
    humor: "测试设备的小故障、工程术语误会、过度复杂的计划被简单办法解决",
  },
  art: {
    label: "画画与设计连续故事",
    promise: "围绕色彩、光影、建筑、舞台和视觉谜题展开创作冒险，每次设计选择都真实影响故事结果",
    cast: "一位大胆的年轻画手、一位观察细节的设计伙伴、一位擅长制作的朋友，以及隐藏线索的委托人",
    humor: "颜料意外、透视错觉、作品与观众产生的有趣误会",
  },
  science: {
    label: "科普探索连续故事",
    promise: "用自然、动物、地球和太空科学推动探险；结论来自观察和小实验，不能靠突然出现的知识答案",
    cast: "一位好奇的少年观察员、一位谨慎记录数据的伙伴、一位喜欢动手实验的朋友，以及带来谜团的研究者",
    humor: "实验小意外、动物打断计划、伙伴对错误假设的友善吐槽",
  },
  why: {
    label: "十万个为什么解谜故事",
    promise: "从日常现象提出一个孩子真想知道的问题，再通过冒险、猜测、验证和反转找到答案",
    cast: "一位问题很多的孩子、一位先猜再验证的伙伴、一位擅长发现生活细节的朋友，以及制造错误线索的人",
    humor: "离谱但可检验的猜想、家庭小实验、认真提问带来的意外场面",
  },
  fantasy: {
    label: "奇幻冒险原创故事",
    promise: "原创魔法规则、神秘地图、伙伴任务与公平谜题；魔法有边界，角色必须理解规则并合作",
    cast: "一位勇敢但会犯错的新冒险者、一位冷静的朋友、一位古怪向导，以及有合理愿望的对手",
    humor: "魔法规则的字面效果、会抱怨的道具、伙伴间有温度的吐槽",
  },
  mecha: {
    label: "高达机甲风原创故事",
    promise: "原创少年机师、太空探索、机甲协作、战术谜题与团队羁绊；不得复用任何现有高达作品的人名、机体、设定或剧情",
    cast: "一位会冲动但愿意道歉的少年机师、一位冷静的观察者、一位擅长工程的幽默伙伴，以及有秘密的辅助机器人",
    humor: "训练事故、伙伴吐槽、机器人对人类习惯的误解",
  },
  cultivation: {
    label: "修仙奇遇原创故事",
    promise: "东方仙侠氛围、御剑、灵兽、秘境和规则谜题；力量不能替代判断，伙伴合作必须真正改变结局",
    cast: "一位善良但不服输的新弟子、一位谨慎的朋友、一只嘴馋的灵兽，以及立场复杂的长辈",
    humor: "法器小故障、灵兽贪吃、一本正经的仙门规矩被生活细节打破",
  },
  tiger: {
    label: "虎小满原创线上故事",
    promise: "虎小满与动物伙伴的热血喜剧冒险，谜题来自日常小镇并逐步扩大，友情和承认错误比蛮力更重要",
    cast: "行动很快的虎小满、观察仔细的兔子伙伴、慢却可靠的乌龟伙伴，以及会被理解的对手",
    humor: "零食、过度自信的小计划、伙伴温和但精准的吐槽",
  },
  cat: {
    label: "猫成成原创线上故事",
    promise: "猫成成与伙伴进入温暖又神秘的机关世界，依靠观察、同理心和团队解谜推进连续案件",
    cast: "细心的猫成成、忠诚又好笑的狗伙伴、一位小向导，以及并非纯粹坏人的谜题制造者",
    humor: "侦探仪式感、饼干、聪明计划中的小意外",
  },
  "custom-story": {
    label: "用户定制原创连续故事",
    promise: "忠实吸收用户给出的主题、角色、关键词和期待情节，同时保持适龄、原创、幽默、伙伴合作、谜题公平和连续追读感",
    cast: "优先使用用户指定的角色；缺少必要能力时，可以补充一到两位性格互补的原创伙伴",
    humor: "来自用户角色的性格差异、计划偏差和伙伴间温暖的吐槽，不使用容易过时的网络梗",
  },
};

function storyGuideFor(
  options: Pick<StoryRunOptions, "interest"> &
    Partial<
      Pick<StoryRunOptions, "customInterestName" | "customInterestPrompt">
    >,
): StoryGuide {
  const builtIn = storyGuides[options.interest as keyof typeof storyGuides];
  if (builtIn) return builtIn;
  return {
    label: `${options.customInterestName || options.interest}原创连续故事`,
    promise:
      options.customInterestPrompt ||
      "围绕该兴趣主题创作适龄、幽默、有悬念且强调伙伴合作的原创连续故事",
    cast: "三到五位性格和能力互补的少年伙伴，以及一位动机可理解、能够推动成长的对手或向导",
    humor: "来自人物性格、计划偏差和伙伴之间温暖而精准的吐槽",
  };
}

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
  number: z.number().int().min(1).max(100),
  title: z.string().trim().min(3).max(160),
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

const clueLedgerEntrySchema = z.object({
  id: z.string().trim().regex(/^C\d+$/),
  clue: z.string().trim().min(5).max(400),
  introducedIn: z.number().int().min(1).max(100),
  misdirection: z.string().trim().min(5).max(400),
  usedIn: z.number().int().min(1).max(100),
  payoffIn: z.number().int().min(1).max(100),
  payoff: z.string().trim().min(8).max(500),
});

const planSchema = z.object({
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

const questionSchema = z.object({
  prompt: z.string().trim().min(8).max(500),
  options: z.array(z.string().trim().min(1).max(500)).length(4),
  answer: z.number().int().min(0).max(3),
  explanation: z.string().trim().min(4).max(1000),
});

const episodeSchema = z.object({
  title: z.string().trim().min(3).max(160),
  paragraphs: z.array(z.string().trim().min(30).max(3000)).min(3).max(6),
  targetWords: z.array(z.string().trim().regex(/^[a-z][a-z'-]*$/i)).min(4).max(10),
  continuitySummary: z.string().trim().min(20).max(1200),
  storyState: z.object({
    characterPositions: z.array(z.string().trim().min(4).max(240)).min(1).max(12),
    knownFacts: z.array(z.string().trim().min(4).max(240)).min(1).max(16),
    unresolvedQuestions: z.array(z.string().trim().min(4).max(240)).min(1).max(12),
    items: z.array(z.string().trim().min(2).max(200)).max(16),
    relationshipChanges: z.array(z.string().trim().min(4).max(240)).max(12),
  }),
  questions: z.array(questionSchema).min(2).max(3),
});

const storyCritiqueSchema = z.object({
  plot: z.object({ score: z.number().min(0).max(10), issues: z.array(z.string()).max(8) }),
  childAppeal: z.object({ score: z.number().min(0).max(10), issues: z.array(z.string()).max(8) }),
  gradedLanguage: z.object({ score: z.number().min(0).max(10), issues: z.array(z.string()).max(8) }),
  continuity: z.object({ score: z.number().min(0).max(10), issues: z.array(z.string()).max(8) }),
  rewritePriorities: z.array(z.string().trim().min(4).max(300)).min(1).max(8),
});

export type SeriesPlan = z.infer<typeof planSchema>;
export type GeneratedStoryEpisode = z.infer<typeof episodeSchema>;

type StoryConfigFile = Partial<StoryRunOptions>;

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

export type StoryRunOptions = {
  databasePath: string;
  ecdictPath: string;
  baseUrl: string;
  apiPath: string;
  apiKey: string;
  model: string;
  reviewModel: string;
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
  minLexicalCoverage: number;
  temperature: number;
  reviewTemperature: number;
  timeoutMs: number;
  maxRetries: number;
  dryRun: boolean;
  force: boolean;
  log: (message: string) => void;
  onProgress?: (progress: StoryGenerationProgress) => void;
};

export type StoryQuality = {
  score: number;
  wordCount: number;
  averageSentenceWords: number;
  lexicalCoverage: number | null;
  unfamiliarWords: string[];
  issues: string[];
};

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
  { audience: string; firstWords: [number, number]; laterWords: [number, number]; maxSentenceWords: number; difficulty: number }
> = {
  middle: { audience: "初中生", firstWords: [180, 260], laterWords: [230, 340], maxSentenceWords: 15, difficulty: 2 },
  high: { audience: "高中生", firstWords: [240, 340], laterWords: [300, 430], maxSentenceWords: 20, difficulty: 3 },
  toefl: { audience: "托福基础阶段学习者", firstWords: [280, 380], laterWords: [350, 480], maxSentenceWords: 22, difficulty: 3 },
  ielts: { audience: "雅思基础阶段学习者", firstWords: [280, 380], laterWords: [350, 480], maxSentenceWords: 22, difficulty: 3 },
  toeic: { audience: "托业基础阶段学习者", firstWords: [240, 340], laterWords: [300, 420], maxSentenceWords: 19, difficulty: 3 },
};

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

const defaultOptions: Omit<StoryRunOptions, "log"> = {
  databasePath: path.resolve("data/read-remember.sqlite"),
  ecdictPath: path.resolve("data/ecdict.sqlite"),
  baseUrl: "",
  apiPath: "/chat/completions",
  apiKey: "",
  model: "",
  reviewModel: "",
  interest: "tiger",
  customInterestName: "",
  customInterestSubtitle: "",
  customInterestEmoji: "✨",
  customInterestColor: "#55766D",
  customInterestPrompt: "",
  customActivityPrompt: "用一句英文记录本章最重要的发现，并预测下一集。",
  examId: "middle",
  sourceMode: "original",
  classicId: "",
  sourceTitle: "",
  sourceNotes: "",
  readerStage: "auto",
  episodes: 6,
  importNamespace: "",
  planCandidates: 3,
  minLexicalCoverage: 0.95,
  temperature: 0.82,
  reviewTemperature: 0.25,
  timeoutMs: 180_000,
  maxRetries: 3,
  dryRun: false,
  force: false,
};

const helpText = `
连续兴趣故事生成器（OpenAI Chat Completions 兼容接口）

用法：
  npm run generate:story-series -- --config config/story-generation.json

参数：
  --interest <id>         支持全部内置栏目，也支持自定义小写 slug
  --interest-name <name>  自定义栏目中文名
  --interest-subtitle <text>
  --interest-emoji <emoji>
  --interest-color <#RRGGBB>
  --interest-prompt <text> 自定义栏目的故事方向（必填）
  --activity-prompt <text> 阅读后的互动任务
  --exam <middle|high|toefl|ielts|toeic>
  --source-mode <original|classic|favorite>
  --classic <${classicSourceIds.join("|")}>
  --source-title <name>   孩子喜欢的作品名或题材名，仅用于提取吸引力
  --source-notes <text>   喜欢的元素，例如魔法学校、伙伴闯关、幽默宠物
  --reader-stage <auto|starter|stage1|stage2|stage3|stage4|stage5|stage6>
  --episodes <2-30>
  --import-namespace <id> 导入 ID 命名空间，供后台定制任务隔离同名系列
  --database <path>
  --ecdict <path>         ECDICT SQLite，用于实测正文高频词覆盖率
  --plan-candidates <2-4> 候选季纲数量，默认 3
  --min-coverage <0.80-1> 最低高频词覆盖率，默认 0.95
  --base-url <url>
  --api-path <path>
  --api-key <key>
  --model <name>
  --review-model <name>   第二遍故事编辑模型，默认与生成模型相同
  --dry-run               只输出故事策划提示，不调用模型或写数据库
  --force                 覆盖同系列、同集已有内容
`.trim();

function stripFence(value: string) {
  return value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
}

export class ModelJsonParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelJsonParseError";
  }
}

function balancedJsonCandidate(value: string, start: number) {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  for (let index = start; index < value.length; index++) {
    const character = value[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === "{" || character === "[") stack.push(character);
    if (character === "}" || character === "]") {
      const expected = character === "}" ? "{" : "[";
      if (stack.pop() !== expected) return null;
      if (stack.length === 0) return value.slice(start, index + 1);
    }
  }
  return null;
}

function jsonCandidates(value: string) {
  const candidates: string[] = [];
  for (let index = 0; index < value.length; index++) {
    if (value[index] !== "{" && value[index] !== "[") continue;
    const candidate = balancedJsonCandidate(value, index);
    if (candidate) candidates.push(candidate);
  }
  return [...new Set(candidates)];
}

function parsedJsonValues(value: string) {
  const cleaned = stripFence(value);
  const values: unknown[] = [];
  const seen = new Set<string>();
  const add = (candidate: string, repair = false) => {
    try {
      const parsed = JSON.parse(repair ? jsonrepair(candidate) : candidate) as unknown;
      const key = JSON.stringify(parsed);
      if (!seen.has(key)) {
        seen.add(key);
        values.push(parsed);
      }
    } catch {}
  };

  add(cleaned);
  const candidates = jsonCandidates(cleaned);
  for (const candidate of candidates) add(candidate);

  // 修复阶段优先尝试信息量更大的片段，可避免说明文字里的 [a-z]
  // 被修成 ["a-z"] 后抢在真正的业务对象之前。
  for (const candidate of [...candidates].sort((left, right) => right.length - left.length)) {
    add(candidate, true);
  }
  add(cleaned, true);
  return values;
}

export function parseJson(value: string) {
  const values = parsedJsonValues(value);
  if (values.length) return values[0];
  const candidates = jsonCandidates(stripFence(value));
  throw new ModelJsonParseError(
    candidates.length
      ? `模型返回了 ${candidates.length} 个类似 JSON 的片段，但都无法解析`
      : "模型响应中没有完整 JSON 对象或数组",
  );
}

function jsonParseFailure(value: string) {
  const cleaned = stripFence(value);
  const candidates = jsonCandidates(cleaned);
  return new ModelJsonParseError(
    candidates.length
      ? `模型返回了 ${candidates.length} 个类似 JSON 的片段，但都无法解析`
      : "模型响应中没有完整 JSON 对象或数组",
  );
}

function endpoint(options: StoryRunOptions) {
  if (/^https?:\/\//.test(options.apiPath)) return options.apiPath;
  return `${options.baseUrl.replace(/\/$/, "")}/${options.apiPath.replace(/^\//, "")}`;
}

async function callModelText(options: StoryRunOptions, system: string, user: string, model = options.model, temperature = options.temperature) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= options.maxRetries; attempt++) {
    try {
      const response = await fetch(endpoint(options), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model,
          temperature,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
        signal: AbortSignal.timeout(options.timeoutMs),
      });
      if (!response.ok) throw new Error(`模型接口返回 ${response.status}: ${await response.text()}`);
      const payload = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = payload.choices?.[0]?.message?.content;
      if (!content) throw new Error("模型响应中没有文本内容");
      return content;
    } catch (error) {
      lastError = error;
      if (attempt < options.maxRetries) await new Promise((resolve) => setTimeout(resolve, attempt * 800));
    }
  }
  throw lastError;
}

async function callStructured<T>(
  options: StoryRunOptions,
  schema: z.ZodType<T>,
  system: string,
  user: string,
  model = options.model,
  temperature = options.temperature,
) {
  let prompt = user;
  let lastError: z.ZodError | ModelJsonParseError | null = null;
  for (let attempt = 1; attempt <= 4; attempt++) {
    const content = await callModelText(options, system, prompt, model, temperature);
    const values = parsedJsonValues(content);
    if (!values.length) {
      lastError = jsonParseFailure(content);
      options.log(`模型第 ${attempt} 次返回无法解析，正在要求其重新输出严格 JSON…`);
      prompt = `${user}\n\n上一次响应无法作为 JSON 解析：${lastError.message}。请重新输出一份完整 JSON：只能有一个顶层对象，键名和字符串必须使用英文双引号，数组必须填真实值；禁止输出 Markdown、解释、正则示例（如 [a-z]）、JSON Schema、注释或第二个对象。`;
      continue;
    }

    const attempts = values.map((value) => ({ value, result: schema.safeParse(value) }));
    const valid = attempts.find((entry) => entry.result.success);
    if (valid?.result.success) return valid.result.data;
    const closest = attempts.reduce((best, entry) => {
      const issueCount = entry.result.success ? 0 : entry.result.error.issues.length;
      const bestIssueCount = best.result.success ? 0 : best.result.error.issues.length;
      return issueCount < bestIssueCount ? entry : best;
    });
    if (closest.result.success) return closest.result.data;
    lastError = closest.result.error;
    const issues = closest.result.error.issues
      .slice(0, 12)
      .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
      .join("；");
    const previousValue = JSON.stringify(closest.value).slice(0, 16_000);
    options.log(`模型第 ${attempt} 次返回结构不完整，正在携带字段错误自动修正…`);
    prompt = `${user}\n\n你上一次实际返回的是：\n${previousValue}\n\n结构校验错误：${issues}。请以这份实际返回为基础，补齐并修正所有字段。不要使用省略号或占位值；只返回一份完整合法 JSON。`;
  }
  throw lastError ?? new Error("模型没有返回符合结构的 JSON");
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
  return `分级阅读档位：${profile.label}，CEFR ${profile.cefr}，以约 ${profile.headwords} 个核心高频词为词汇控制参考。
采用成熟分级读物的方法，但不模仿任何具体书虫文本：约 95% 正文使用该档高频、具体、易成像的词；同一人物、地点和关键物件保持固定称呼；少用同义替换；难概念先用动作或情境铺垫；每集最多引入 ${profile.maxNewWords} 个值得学习的新词，并让词义可从上下文猜出。`;
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
  const classicMode = options.sourceMode === "classic";
  return `你是儿童与青少年英语连续故事的总编剧。请设计一个 ${options.episodes} 集的英文连续分级故事季。

栏目方向：${guide.label}
题材承诺：${classicMode ? `${guide.label}只作为阅读节奏与幽默风格参考，故事内容忠实简化指定公版原作` : guide.promise}
核心角色结构：${classicMode ? "使用原作核心人物，合并不必要的次要人物，但不能改变关键人物关系" : guide.cast}
幽默来源：${guide.humor}
读者：${level.audience}
${sourceBrief(options)}
${gradedReadingBrief(options)}

硬性质量标准：
1. 每集开头两句内出现异常事件、具体目标或好笑的麻烦，不做背景说明堆砌。
2. 每集至少有一次有效线索、一次合理误判或反转、一次由团队合作真正解决的困难。
3. 友情通过行动、分歧、互相补位和承认错误体现，不用说教台词总结价值观。
4. 对手要有能理解的动机；谜题答案必须由前文线索支持，禁止突然出现万能道具。
5. 每集结尾解决当前小目标，同时留下明确而公平的新悬念，让读者想立刻看下一集。
6. 整季有主谜题、角色成长和线索回收；笑点来自人物性格，不靠网络热梗。
7. 严格遵守上面的选材模式：公版名著可忠实简化原作；其余模式不得使用现有影视、动漫、小说或游戏的受保护表达。

每套策划还必须完成：
- 故事圣经：3-8 条不可随意改变的世界规则；固定人物、地点和物件的英文称呼；每位主要角色的欲望、恐惧、说话特征和整季成长。
- 线索账本：每条线索用 C1、C2……编号，明确在哪一集埋下、误导、使用和回收；埋下不得晚于使用，最后一集前回收主线线索。
- 每集按“目标→阻碍→角色作出艰难选择→产生后果→出现新问题”构成因果链，不能只罗列事件。

只返回一套策划 JSON，不要附加说明：
{"seriesTitle":"英文系列名","premise":"中文策划说明","cast":[{"name":"英文名","role":"中文角色作用","strength":"优点","flaw":"缺点"}],"seasonMystery":"中文主谜题","storyBible":{"worldRules":["中文"],"fixedTerms":[{"concept":"中文概念","english":"固定英文称呼"}],"characterArcs":[{"name":"英文名","wants":"中文","fear":"中文","voice":"中文","growth":"中文"}]},"clueLedger":[{"id":"C1","clue":"中文","introducedIn":1,"misdirection":"中文","usedIn":2,"payoffIn":3,"payoff":"中文"}],"episodes":[{"number":1,"title":"英文标题","openingHook":"中文","goal":"中文","obstacle":"中文","choice":"中文","consequence":"中文","newQuestion":"中文","problem":"中文","clue":"中文","teamworkTurn":"中文","emotionalBeat":"中文","cliffhanger":"中文"}]}`;
}

function episodePrompt(
  options: StoryRunOptions,
  plan: SeriesPlan,
  episodeIndex: number,
  previousEpisode: GeneratedStoryEpisode | null,
) {
  const level = examGuide[options.examId];
  const readerProfile = resolveReaderProfile(options);
  const beat = plan.episodes[episodeIndex];
  const range = episodeIndex < 2 ? level.firstWords : level.laterWords;
  const relevantClues = plan.clueLedger.filter(
    (item) => [item.introducedIn, item.usedIn, item.payoffIn].includes(beat.number),
  );
  return `根据故事季策划，写第 ${beat.number} 集英文分级阅读文章。

系列策划：${JSON.stringify(plan)}
上一集连续性摘要：${previousEpisode?.continuitySummary || "这是第一集，从一个立刻发生的异常事件开始。"}
上一集结构化状态：${previousEpisode ? JSON.stringify(previousEpisode.storyState) : "第一集尚无历史状态"}
本集节拍：${JSON.stringify(beat)}
本集必须处理的线索账本：${JSON.stringify(relevantClues)}
${sourceBrief(options)}
${gradedReadingBrief(options)}

语言控制：
- 正文 ${range[0]}-${range[1]} 个英文词，3-5 个自然段。
- 面向${level.audience}，优先使用约 ${readerProfile.headwords} 词档的核心高频词；只设置 4-${readerProfile.maxNewWords} 个可从语境猜出的 targetWords。
- 平均句长不超过约 ${level.maxSentenceWords} 词；关键动作使用短句。
- 对话简短自然，幽默不影响情节，禁止解释词汇表式写法。
- 不为追求“文学感”频繁替换同义词；相同事物尽量沿用相同称呼，让孩子凭上下文建立词义。

叙事控制：
- 前两句必须形成钩子。
- 严格写出本集“目标→阻碍→选择→后果→新问题”的因果链；选择必须有代价，后果必须由角色选择引起。
- 线索先出现、后使用；合作必须改变结果；结尾必须是公平悬念。
- 遵守 storyBible 的固定称呼、人物声音和世界规则，不得让角色忘记已知事实或无故获得物件。
- 文章本身要精彩，不要用“这告诉我们团队合作很重要”之类说教句。
- 出 2 道四选一题：一道具体线索题，一道推断/人物选择题。错误项必须可信但能由原文排除。
- explanation 使用中文并指出原文依据。

只返回 JSON：
{"title":"英文标题","paragraphs":["..."],"targetWords":["..."],"continuitySummary":"中文，供下一集保持连续性","storyState":{"characterPositions":["中文：人物当前位置及状态"],"knownFacts":["中文：角色已经确认的事实"],"unresolvedQuestions":["中文：尚未解决的问题"],"items":["中文：物件及持有人"],"relationshipChanges":["中文：本集发生的关系变化"]},"questions":[{"prompt":"...","options":["A text","B text","C text","D text"],"answer":0,"explanation":"中文"}]}`;
}

function critiquePrompt(
  options: StoryRunOptions,
  plan: SeriesPlan,
  episode: GeneratedStoryEpisode,
  episodeNumber: number,
  previousEpisode: GeneratedStoryEpisode | null,
) {
  return `你是由四位编辑组成的儿童英语故事审稿组，只诊断问题，不重写正文。

整季策划：${JSON.stringify(plan)}
上一集状态：${previousEpisode ? JSON.stringify(previousEpisode.storyState) : "第一集"}
第 ${episodeNumber} 集待审稿：${JSON.stringify(episode)}
${sourceBrief(options)}
${gradedReadingBrief(options)}

四个视角分别按 0-10 分审查：
1. plot：目标、阻碍、选择、后果是否构成因果链；线索是否公平；解法是否靠前文准备。
2. childAppeal：前两句钩子、自然笑点、具体冒险、伙伴互动和结尾悬念是否真能让孩子想读下一集。
3. gradedLanguage：句子、词汇、指代是否适龄；是否有不必要的难词、抽象解释和同义词漂移。
4. continuity：是否遵守故事圣经、线索账本和上一集人物/物件/已知事实状态。

只返回 JSON：
{"plot":{"score":8,"issues":["中文问题"]},"childAppeal":{"score":8,"issues":["中文问题"]},"gradedLanguage":{"score":8,"issues":["中文问题"]},"continuity":{"score":8,"issues":["中文问题"]},"rewritePriorities":["按重要性排序的中文修改动作"]}`;
}

function reviewPrompt(
  options: StoryRunOptions,
  plan: SeriesPlan,
  episode: GeneratedStoryEpisode,
  critique: z.infer<typeof storyCritiqueSchema>,
  episodeNumber: number,
  previousEpisode: GeneratedStoryEpisode | null,
) {
  const level = examGuide[options.examId];
  const range = episodeNumber <= 2 ? level.firstWords : level.laterWords;
  return `你是严格的儿童英语故事编辑。请重写并提升下面这一集，而不是只写评语。

整季设定：${JSON.stringify(plan)}
上一集状态：${previousEpisode ? JSON.stringify(previousEpisode.storyState) : "第一集"}
待审稿：${JSON.stringify(episode)}
四维审稿意见：${JSON.stringify(critique)}
${sourceBrief(options)}
${gradedReadingBrief(options)}

按 rewritePriorities 逐项定向修复，并检查：开头钩子、人物声音、自然幽默、线索公平、团队合作的因果作用、情绪变化、悬念、连续性、选材边界、选择题唯一正确性。正文保持 ${range[0]}-${range[1]} 词、3-5 段，语言适合${level.audience}，平均句长约不超过 ${level.maxSentenceWords} 词。删除说教、空泛形容、突然出现的解法、不必要难词和为了变化而使用的生僻同义词。必须更新 storyState，准确反映重写后的结局。

返回与原稿完全相同结构的 JSON，不要附加评论。`;
}

export function assessStoryQuality(
  episode: GeneratedStoryEpisode,
  options: Pick<StoryRunOptions, "examId" | "readerStage"> & Partial<Pick<StoryRunOptions, "minLexicalCoverage">>,
  episodeNumber: number,
  lexical?: {
    lookup: LexicalRankLookup;
    isFamiliar?: LexicalFamiliarityLookup;
    allowedWords?: string[];
  },
): StoryQuality {
  const level = examGuide[options.examId];
  const readerProfile = resolveReaderProfile(options);
  const range = episodeNumber <= 2 ? level.firstWords : level.laterWords;
  const text = episode.paragraphs.join(" ");
  const words = text.match(/[A-Za-z]+(?:['-][A-Za-z]+)*/g) ?? [];
  const sentences = text.split(/[.!?]+/).map((item) => item.trim()).filter(Boolean);
  const averageSentenceWords = sentences.length ? words.length / sentences.length : words.length;
  const issues: string[] = [];
  let lexicalCoverage: number | null = null;
  let unfamiliarWords: string[] = [];
  if (words.length < range[0]) issues.push(`正文过短：${words.length} < ${range[0]}`);
  if (words.length > range[1]) issues.push(`正文过长：${words.length} > ${range[1]}`);
  if (averageSentenceWords > level.maxSentenceWords + 2) issues.push(`平均句长过高：${averageSentenceWords.toFixed(1)}`);
  if (!/[“”"']/.test(text)) issues.push("缺少自然对话或人物声音");
  if (!/(together|friend|team|shared|helped|agreed|asked)/i.test(text)) issues.push("团队合作在正文中不够明确");
  if (episode.targetWords.length < 4 || episode.targetWords.length > readerProfile.maxNewWords) {
    issues.push(`目标词数量应为 4-${readerProfile.maxNewWords} 个`);
  }
  const missingTargetWords = episode.targetWords.filter(
    (word) => !new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text),
  );
  if (missingTargetWords.length) issues.push(`目标词未出现在正文：${missingTargetWords.join(", ")}`);
  if (episode.questions.some((question) => question.options.length !== 4 || question.answer > 3)) issues.push("题目选项或答案索引不合法");
  if (lexical && words.length) {
    // 每集明确选出的目标词就是允许孩子少量查阅的新词，不应反过来被
    // 高频词门禁判为超纲；人物名和固定世界术语同样由调用方加入白名单。
    const allowed = new Set(
      [...(lexical.allowedWords ?? []), ...episode.targetWords].map((word) => word.toLowerCase()),
    );
    const rankCutoff = readerProfile.headwords * 3;
    const unfamiliarCounts = new Map<string, number>();
    let familiarCount = 0;
    for (const word of words) {
      const normalized = word.toLowerCase().replace(/^'+|'+$/g, "");
      const rank = lexical.lookup(normalized);
      if (
        allowed.has(normalized)
        || lexical.isFamiliar?.(normalized)
        || (rank !== null && rank <= rankCutoff)
      ) {
        familiarCount++;
      } else {
        unfamiliarCounts.set(normalized, (unfamiliarCounts.get(normalized) ?? 0) + 1);
      }
    }
    lexicalCoverage = familiarCount / words.length;
    unfamiliarWords = [...unfamiliarCounts.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, 12)
      .map(([word]) => word);
    const minimum = options.minLexicalCoverage ?? 0.95;
    if (lexicalCoverage < minimum) {
      issues.push(
        `高频词覆盖率不足：${(lexicalCoverage * 100).toFixed(1)}% < ${(minimum * 100).toFixed(0)}%；优先简化 ${unfamiliarWords.slice(0, 8).join(", ")}`,
      );
    }
  }
  return {
    score: Math.max(0, 100 - issues.length * 12),
    wordCount: words.length,
    averageSentenceWords: Number(averageSentenceWords.toFixed(1)),
    lexicalCoverage: lexicalCoverage === null ? null : Number(lexicalCoverage.toFixed(3)),
    unfamiliarWords,
    issues,
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

async function generatePlan(options: StoryRunOptions, engagementBrief: string) {
  const basePrompt = `${buildSeriesPlanPrompt(options)}\n\n真实使用反馈（仅供策划）：${engagementBrief}`;
  reportProgress(
    options,
    "planning",
    `正在生成 ${options.planCandidates} 套候选故事方案`,
    4,
  );
  options.log(`正在并行生成 ${options.planCandidates} 套候选季纲…`);
  const candidates = await Promise.all(
    Array.from({ length: options.planCandidates }, async (_, index) => {
      const value = await callStructured(
        options,
        planSchema,
        "你只输出合法 JSON。你擅长原创、连续、适龄、可读性高的儿童英语冒险故事策划。",
        `${basePrompt}\n\n这是候选方案 ${index + 1}/${options.planCandidates}。请避开最先想到的套路，让核心谜题、角色缺点造成的选择和线索回收具有独特性。`,
      );
      return validateSeriesPlan(value, options.episodes);
    }),
  );
  reportProgress(options, "selecting_plan", "候选方案已完成，正在选择最终故事主线", 14);
  const selection = await callStructured(
    options,
    planSchema,
    "你只输出合法 JSON。你是儿童分级连续故事总编，善于比较方案并把最强元素融合成逻辑严密的新季纲。",
    `${basePrompt}\n\n以下是 ${candidates.length} 套候选季纲：\n${JSON.stringify(candidates)}\n\n比较它们的开篇吸引力、整季因果链、角色成长、线索公平性、笑点潜力和连续追读欲。选择最强主结构，并只在不破坏因果和线索账本的前提下融合其他方案的优点。返回一套完整最终季纲 JSON。`,
    options.reviewModel || options.model,
    options.reviewTemperature,
  );
  return validateSeriesPlan(selection, options.episodes);
}

async function generateEpisode(
  options: StoryRunOptions,
  plan: SeriesPlan,
  index: number,
  previousEpisode: GeneratedStoryEpisode | null,
) {
  const episodeNumber = index + 1;
  reportProgress(
    options,
    "drafting",
    `正在生成第 ${episodeNumber}/${options.episodes} 集初稿`,
    episodeProgress(options, index, 0),
  );
  const draft = await callStructured(
    options,
    episodeSchema,
    "你只输出合法 JSON。你是擅长悬念、幽默、伙伴感与分级英语的儿童故事作家。",
    episodePrompt(options, plan, index, previousEpisode),
  );
  reportProgress(
    options,
    "reviewing",
    `第 ${episodeNumber} 集初稿已完成，正在质量评审`,
    episodeProgress(options, index, 0.3),
  );
  const critique = await callStructured(
    options,
    storyCritiqueSchema,
    "你只输出合法 JSON。你代表剧情、儿童吸引力、分级语言和连续性四位专业编辑，必须指出可执行的问题。",
    critiquePrompt(options, plan, draft, index + 1, previousEpisode),
    options.reviewModel || options.model,
    options.reviewTemperature,
  );
  reportProgress(
    options,
    "editing",
    `第 ${episodeNumber} 集质量评审已完成，正在编辑润色`,
    episodeProgress(options, index, 0.55),
  );
  const reviewed = await callStructured(
    options,
    episodeSchema,
    "你只输出合法 JSON。你是严谨的儿童文学编辑，必须直接返回提升后的完整稿件。",
    reviewPrompt(options, plan, draft, critique, index + 1, previousEpisode),
    options.reviewModel || options.model,
    options.reviewTemperature,
  );
  reportProgress(
    options,
    "quality_check",
    `第 ${episodeNumber} 集编辑稿已完成，正在自动质量检查`,
    episodeProgress(options, index, 0.8),
  );
  return reviewed;
}

async function repairEpisode(
  options: StoryRunOptions,
  plan: SeriesPlan,
  episode: GeneratedStoryEpisode,
  episodeNumber: number,
  quality: StoryQuality,
) {
  const level = examGuide[options.examId];
  const range = episodeNumber <= 2 ? level.firstWords : level.laterWords;
  return callStructured(
    options,
    episodeSchema,
    "你只输出合法 JSON。你是分级阅读终审编辑，只修复自动质量检测指出的问题，并保持精彩情节和原有结构。",
    `整季策划：${JSON.stringify(plan)}\n待修稿：${JSON.stringify(episode)}\n自动检测问题：${quality.issues.join("；")}\n超纲或未识别词（除 targetWords、人物专名和固定术语外，逐个换成更常见表达）：${quality.unfamiliarWords.join(", ")}\n\n正文必须保持 ${range[0]}-${range[1]} 词。targetWords 中的每个词必须以完整单词实际出现在正文中；不要引入新的生僻同义词。不要删除关键线索、角色选择的后果或结尾悬念。修改后同步更新 continuitySummary、storyState 和题目。返回与待修稿相同结构的完整 JSON。`,
    options.reviewModel || options.model,
    0.1,
  );
}

function lexicalAllowedWords(plan: SeriesPlan) {
  return [
    ...plan.cast.flatMap((character) => character.name.match(/[A-Za-z]+(?:['-][A-Za-z]+)*/g) ?? []),
    ...plan.storyBible.fixedTerms.flatMap((term) => term.english.match(/[A-Za-z]+(?:['-][A-Za-z]+)*/g) ?? []),
  ];
}

function examVocabularyTags(examId: ExamId) {
  if (examId === "middle") return ["zk"];
  if (examId === "high") return ["zk", "gk"];
  if (examId === "toefl") return ["toefl"];
  if (examId === "ielts") return ["ielts"];
  return ["zk", "gk", "cet4", "cet6"];
}

function meetsQualityTarget(quality: StoryQuality, targetCoverage: number) {
  return quality.score >= 80 && (quality.lexicalCoverage === null || quality.lexicalCoverage >= targetCoverage);
}

export function passesStoryQualityFloor(quality: StoryQuality, targetCoverage: number) {
  const publishableCoverage = Math.min(targetCoverage, 0.9);
  return quality.score >= 80 && (quality.lexicalCoverage === null || quality.lexicalCoverage >= publishableCoverage);
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}

export async function runStoryGeneration(options: StoryRunOptions) {
  if (options.dryRun) {
    options.log(buildSeriesPlanPrompt(options));
    return { generated: 0, imported: 0, articleIds: [] as string[], seriesTitle: "", qualities: [] as StoryQuality[] };
  }
  if (!options.baseUrl || !options.model) throw new Error("需要配置 baseUrl 和 model");
  const engagementBrief = loadStoryEngagementBrief(options.databasePath, options.interest, options.examId);
  options.log(engagementBrief);
  const plan = await generatePlan(options, engagementBrief);
  options.log(`系列策划完成：${plan.seriesTitle}`);
  reportProgress(options, "drafting", `故事方案《${plan.seriesTitle}》已完成，正在生成第 1 集初稿`, 20);
  const generated: GeneratedStoryEpisode[] = [];
  const qualities: StoryQuality[] = [];
  let previousEpisode: GeneratedStoryEpisode | null = null;
  const dictionary = openEcdict(options.ecdictPath);
  if (!dictionary) options.log(`未找到 ECDICT，跳过词频覆盖率检测：${options.ecdictPath}`);
  const lexical = dictionary
    ? {
        lookup: (word: string) => dictionary.frequencyRank(word),
        isFamiliar: (word: string) => dictionary.hasVocabularyTag(word, examVocabularyTags(options.examId)),
        allowedWords: lexicalAllowedWords(plan),
      }
    : undefined;
  try {
    for (let index = 0; index < options.episodes; index++) {
      let episode = await generateEpisode(options, plan, index, previousEpisode);
      let quality = assessStoryQuality(episode, options, index + 1, lexical);
      for (let repairAttempt = 1; repairAttempt <= 3 && !meetsQualityTarget(quality, options.minLexicalCoverage); repairAttempt++) {
        reportProgress(
          options,
          "repairing",
          `第 ${index + 1} 集正在进行第 ${repairAttempt}/3 次定向修稿`,
          episodeProgress(options, index, 0.88),
        );
        options.log(
          `[${index + 1}/${options.episodes}] 自动质量门禁触发，进行第 ${repairAttempt}/3 次定向修稿：${quality.issues.join("；")}`,
        );
        episode = await repairEpisode(options, plan, episode, index + 1, quality);
        quality = assessStoryQuality(episode, options, index + 1, lexical);
      }
      if (!passesStoryQualityFloor(quality, options.minLexicalCoverage)) {
        throw new Error(`第 ${index + 1} 集质量未达标：${quality.issues.join("；")}`);
      }
      if (!meetsQualityTarget(quality, options.minLexicalCoverage)) {
        options.log(
          `[${index + 1}/${options.episodes}] 高频词覆盖未达到 ${(options.minLexicalCoverage * 100).toFixed(0)}% 的优化目标，`
          + `但已达到 90% 发布底线，保留少量可查目标词并继续。`,
        );
      }
      generated.push(episode);
      qualities.push(quality);
      previousEpisode = episode;
      reportProgress(
        options,
        index + 1 === options.episodes ? "saving" : "drafting",
        index + 1 === options.episodes
          ? "全部章节已完成，正在保存到故事书架"
          : `第 ${index + 1}/${options.episodes} 集已完成，准备生成下一集`,
        episodeProgress(options, index, 1),
      );
      const coverage = quality.lexicalCoverage === null ? "未检测词频" : `高频词覆盖 ${(quality.lexicalCoverage * 100).toFixed(1)}%`;
      options.log(`[${index + 1}/${options.episodes}] ${episode.title} · ${quality.wordCount} 词 · ${coverage} · 质量 ${quality.score}`);
    }
  } finally {
    dictionary?.close();
  }

  const db = createDatabase(options.databasePath);
  reportProgress(options, "saving", "正在保存文章并解锁第一集", 96);
  try {
    const guide = storyGuideFor(options);
    if (!storyInterestIds.includes(options.interest as (typeof storyInterestIds)[number])) {
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
        options.customInterestName,
        options.customInterestSubtitle,
        options.customInterestEmoji,
        options.customInterestColor,
        options.customActivityPrompt,
        options.customInterestPrompt,
      );
    }
    const seriesSlug = slug(plan.seriesTitle) || `${options.interest}-series`;
    const classicSource = options.sourceMode === "classic" ? classicSources[options.classicId as ClassicSourceId] : null;
    const sourceName = classicSource
      ? `拾词 AI 公版名著分级改写 · ${classicSource.title}`
      : options.sourceMode === "favorite"
        ? `拾词 AI 原创兴趣故事 · ${options.sourceTitle || guide.label}`
        : `拾词 AI 原创连续故事 · ${guide.label}`;
    const licenseNote = classicSource
      ? `基于公版原作 ${classicSource.title} 独立生成的分级重述；未复制任何商业简写本、现代译本或影视改编文本`
      : options.sourceMode === "favorite"
        ? "仅参考用户提供的题材偏好，角色、设定、语言与具体情节由模型原创，并经过第二遍审校"
        : "由项目配置的生成模型原创生成，并经过第二遍故事质量审校";
    if (options.force) {
      db.prepare(
        `DELETE FROM articles WHERE exam_id = ? AND content_kind = 'interest'
         AND interest_id = ? AND series_title = ?`,
      ).run(options.examId, options.interest, plan.seriesTitle);
    }
    const ids = importArticles(db, {
      examId: options.examId,
      sourceName,
      sourceUrl: null,
      licenseNote,
      rightsConfirmed: true,
      articles: generated.map((episode, index) => ({
        externalId: `${options.importNamespace ? `${slug(options.importNamespace)}-` : ""}${options.interest}-${seriesSlug}-${index + 1}`,
        year: new Date().getFullYear(),
        title: episode.title,
        eyebrow: classicSource ? "GRADED CLASSIC ADVENTURE" : "ORIGINAL SERIAL ADVENTURE",
        readMinutes: Math.max(3, Math.ceil(qualities[index].wordCount / 95)),
        difficulty: examGuide[options.examId].difficulty,
        contentKind: "interest" as const,
        interestId: options.interest as InterestId,
        seriesTitle: plan.seriesTitle,
        episodeNumber: index + 1,
        paragraphs: episode.paragraphs,
        questions: episode.questions as Question[],
      })),
    });
    return { generated: generated.length, imported: ids.length, articleIds: ids, seriesTitle: plan.seriesTitle, qualities };
  } finally {
    db.close();
  }
}

function flagMap(argv: string[]) {
  const flags = new Map<string, string | true>();
  for (let index = 0; index < argv.length; index++) {
    const value = argv[index];
    if (!value.startsWith("--")) continue;
    const key = value.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      flags.set(key, next);
      index++;
    } else flags.set(key, true);
  }
  return flags;
}

export function storyOptionsFromCli(argv = process.argv.slice(2)): StoryRunOptions {
  const flags = flagMap(argv);
  if (flags.has("help")) {
    console.log(helpText);
    process.exit(0);
  }
  const configPath = String(flags.get("config") ?? "");
  const fileConfig: StoryConfigFile =
    configPath && existsSync(configPath)
      ? (JSON.parse(readFileSync(configPath, "utf8")) as StoryConfigFile)
      : {};
  const from = (flag: string, env: string, key: keyof StoryRunOptions) =>
    flags.get(flag) ?? process.env[env] ?? fileConfig[key];
  const interest = String(from("interest", "STORY_INTEREST", "interest") ?? defaultOptions.interest);
  const examId = String(from("exam", "STORY_EXAM_ID", "examId") ?? defaultOptions.examId);
  const sourceMode = String(from("source-mode", "STORY_SOURCE_MODE", "sourceMode") ?? defaultOptions.sourceMode);
  const classicId = String(from("classic", "STORY_CLASSIC_ID", "classicId") ?? defaultOptions.classicId);
  const sourceTitle = String(from("source-title", "STORY_SOURCE_TITLE", "sourceTitle") ?? defaultOptions.sourceTitle);
  const sourceNotes = String(from("source-notes", "STORY_SOURCE_NOTES", "sourceNotes") ?? defaultOptions.sourceNotes);
  const readerStage = String(from("reader-stage", "STORY_READER_STAGE", "readerStage") ?? defaultOptions.readerStage);
  const customInterestName = String(from("interest-name", "STORY_INTEREST_NAME", "customInterestName") ?? defaultOptions.customInterestName);
  const customInterestSubtitle = String(from("interest-subtitle", "STORY_INTEREST_SUBTITLE", "customInterestSubtitle") ?? defaultOptions.customInterestSubtitle);
  const customInterestEmoji = String(from("interest-emoji", "STORY_INTEREST_EMOJI", "customInterestEmoji") ?? defaultOptions.customInterestEmoji);
  const customInterestColor = String(from("interest-color", "STORY_INTEREST_COLOR", "customInterestColor") ?? defaultOptions.customInterestColor);
  const customInterestPrompt = String(from("interest-prompt", "STORY_INTEREST_PROMPT", "customInterestPrompt") ?? defaultOptions.customInterestPrompt);
  const customActivityPrompt = String(from("activity-prompt", "STORY_ACTIVITY_PROMPT", "customActivityPrompt") ?? defaultOptions.customActivityPrompt);
  if (!/^[a-z][a-z0-9-]{1,39}$/.test(interest)) throw new Error("interest 必须是 2-40 位小写 slug");
  const customInterest = !storyInterestIds.includes(interest as (typeof storyInterestIds)[number]);
  if (customInterest && (!customInterestName.trim() || !customInterestSubtitle.trim() || !customInterestPrompt.trim())) {
    throw new Error("自定义兴趣需要 --interest-name、--interest-subtitle 和 --interest-prompt");
  }
  if (!/^#[0-9a-f]{6}$/i.test(customInterestColor)) throw new Error("interest-color 必须是 #RRGGBB");
  if (!["middle", "high", "toefl", "ielts", "toeic"].includes(examId)) throw new Error(`不支持的考试阶段：${examId}`);
  if (!sourceModes.includes(sourceMode as StorySourceMode)) throw new Error(`不支持的选材模式：${sourceMode}`);
  if (!readerStageIds.includes(readerStage as ReaderStageId)) throw new Error(`不支持的分级档位：${readerStage}`);
  if (sourceMode === "classic" && !classicSourceIds.includes(classicId as ClassicSourceId)) {
    throw new Error(`classic 模式必须通过 --classic 选择：${classicSourceIds.join(", ")}`);
  }
  if (sourceMode === "favorite" && !sourceTitle.trim() && !sourceNotes.trim()) {
    throw new Error("favorite 模式至少需要 --source-title 或 --source-notes");
  }
  const episodes = Number(from("episodes", "STORY_EPISODES", "episodes") ?? defaultOptions.episodes);
  if (!Number.isInteger(episodes) || episodes < 2 || episodes > 30) throw new Error("episodes 必须为 2-30 的整数");
  const planCandidates = Number(
    from("plan-candidates", "STORY_PLAN_CANDIDATES", "planCandidates") ?? defaultOptions.planCandidates,
  );
  if (!Number.isInteger(planCandidates) || planCandidates < 2 || planCandidates > 4) {
    throw new Error("plan-candidates 必须为 2-4 的整数");
  }
  const minLexicalCoverage = Number(
    from("min-coverage", "STORY_MIN_LEXICAL_COVERAGE", "minLexicalCoverage") ?? defaultOptions.minLexicalCoverage,
  );
  if (!Number.isFinite(minLexicalCoverage) || minLexicalCoverage < 0.8 || minLexicalCoverage > 1) {
    throw new Error("min-coverage 必须为 0.80-1 之间的小数");
  }
  return {
    ...defaultOptions,
    ...fileConfig,
    databasePath: path.resolve(String(from("database", "DATABASE_PATH", "databasePath") ?? defaultOptions.databasePath)),
    ecdictPath: path.resolve(String(from("ecdict", "ECDICT_PATH", "ecdictPath") ?? defaultOptions.ecdictPath)),
    baseUrl: String(from("base-url", "STORY_BASE_URL", "baseUrl") ?? ""),
    apiPath: String(from("api-path", "STORY_API_PATH", "apiPath") ?? defaultOptions.apiPath),
    apiKey: String(from("api-key", "STORY_API_KEY", "apiKey") ?? ""),
    model: String(from("model", "STORY_MODEL", "model") ?? ""),
    reviewModel: String(from("review-model", "STORY_REVIEW_MODEL", "reviewModel") ?? ""),
    interest: interest as StoryInterestId,
    customInterestName,
    customInterestSubtitle,
    customInterestEmoji,
    customInterestColor,
    customInterestPrompt,
    customActivityPrompt,
    examId: examId as ExamId,
    sourceMode: sourceMode as StorySourceMode,
    classicId: classicId as ClassicSourceId | "",
    sourceTitle,
    sourceNotes,
    readerStage: readerStage as ReaderStageId,
    episodes,
    importNamespace: String(from("import-namespace", "STORY_IMPORT_NAMESPACE", "importNamespace") ?? defaultOptions.importNamespace),
    planCandidates,
    minLexicalCoverage,
    dryRun: flags.has("dry-run") || fileConfig.dryRun === true,
    force: flags.has("force") || fileConfig.force === true,
    log: console.log,
  };
}

if (/generate-story-series\.(?:ts|js)$/.test(process.argv[1] ?? "")) {
  runStoryGeneration(storyOptionsFromCli())
    .then((result) => console.log(`完成：${result.seriesTitle || "dry-run"}，生成 ${result.generated} 集，导入 ${result.imported} 集。`))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
