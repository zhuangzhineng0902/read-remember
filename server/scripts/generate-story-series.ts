import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { jsonrepair } from "jsonrepair";
import { Agent, fetch } from "undici";
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

const publicDomainCraftReferences = {
  alice: {
    title: "Alice's Adventures in Wonderland",
    lessons: [
      "让陌生世界的规则通过角色亲眼看到的后果显现，不先写大段设定说明",
      "用一个具体、奇怪但容易想象的细节制造开场疑问",
      "让幽默来自角色认真应对荒诞规则，而不是旁白解释笑点",
    ],
  },
  "treasure-island": {
    title: "Treasure Island",
    lessons: [
      "先给读者一个普通物件或动作，再让它逐渐显出危险含义",
      "场景目标清楚：人物知道此刻要找什么、躲开什么、必须在何时前完成",
      "用可见动作和选择表现信任变化，不直接宣布谁可靠",
    ],
  },
  "secret-garden": {
    title: "The Secret Garden",
    lessons: [
      "用风、泥土、植物气味、温度和细小声音建立空间感",
      "让环境细节同时反映人物情绪，并成为后续发现的线索",
      "场景转换前先给人物一个明确原因和身体行动，避免突然跳转",
    ],
  },
  "sherlock-holmes": {
    title: "The Early Sherlock Holmes Stories",
    lessons: [
      "先公平展示可观察线索，再允许人物误判，最后用同一证据解释真相",
      "把推理拆成观察、猜测、验证三步，读者能跟着人物一起想",
      "答案不能依赖结尾突然出现的人、物件或背景知识",
    ],
  },
  "wizard-of-oz": {
    title: "The Wonderful Wizard of Oz",
    lessons: [
      "保持旅程目标简单明确，让不同伙伴用互补能力解决同一个障碍",
      "每个场景先解决一个眼前问题，再自然打开下一段旅程",
      "角色成长通过行动证明，少用抽象的价值观总结",
    ],
  },
  "tom-sawyer": {
    title: "The Adventures of Tom Sawyer",
    lessons: [
      "笑点来自角色性格、误判和计划产生的实际后果",
      "儿童角色先行动再反思，但每次冒险必须保留清楚的因果链",
      "对话要短、带目的，并和说话时的动作交替出现",
    ],
  },
  aesop: {
    title: "Aesop's Fables",
    lessons: [
      "用少量角色和一个核心冲突保持叙事清楚",
      "选择立刻产生可见后果，让低龄读者无需额外解释也能理解",
      "不在结尾说教，让人物承受的结果自然表达主题",
    ],
  },
  "around-the-world": {
    title: "Around the World in Eighty Days",
    lessons: [
      "用时间、路线和资源限制保持紧张感，但每一步变化都交代原因",
      "把较大的旅程拆成可以独立理解的小目标",
      "反转改变计划但不改变既有规则，使意外仍然合乎逻辑",
    ],
  },
} as const;

type CraftReferenceId = keyof typeof publicDomainCraftReferences;

const interestCraftReferences: Record<string, CraftReferenceId[]> = {
  military: ["treasure-island", "around-the-world", "sherlock-holmes"],
  art: ["secret-garden", "alice", "tom-sawyer"],
  science: ["sherlock-holmes", "around-the-world", "secret-garden"],
  why: ["sherlock-holmes", "aesop", "secret-garden"],
  fantasy: ["alice", "wizard-of-oz", "secret-garden"],
  mecha: ["treasure-island", "wizard-of-oz", "around-the-world"],
  cultivation: ["wizard-of-oz", "alice", "sherlock-holmes"],
  tiger: ["tom-sawyer", "aesop", "treasure-island"],
  cat: ["sherlock-holmes", "secret-garden", "tom-sawyer"],
  "custom-story": ["alice", "secret-garden", "sherlock-holmes", "wizard-of-oz"],
};

export function buildNarrativeCraftBrief(
  options: Pick<StoryRunOptions, "interest" | "sourceMode" | "classicId" | "sourceTitle" | "sourceNotes">,
  episodeNumber?: number,
) {
  const sourceText = `${options.sourceTitle} ${options.sourceNotes}`.toLowerCase();
  const selected: CraftReferenceId[] = [];
  const add = (id: CraftReferenceId) => {
    if (!selected.includes(id)) selected.push(id);
  };
  if (options.sourceMode === "classic" && options.classicId in publicDomainCraftReferences) {
    add(options.classicId as CraftReferenceId);
  }
  add("secret-garden");
  if (/谜|侦探|线索|密码|mystery|detective|clue|code/.test(sourceText)) add("sherlock-holmes");
  if (/穿越|异世界|魔法|奇幻|仙|fantasy|magic|portal/.test(sourceText)) add("alice");
  if (/机甲|军事|太空|战术|mecha|space|military/.test(sourceText)) add("treasure-island");
  if (/幽默|搞笑|逗比|动物|funny|humor|animal/.test(sourceText)) add("tom-sawyer");
  for (const id of interestCraftReferences[options.interest] ?? interestCraftReferences["custom-story"]) add(id);
  if (episodeNumber && episodeNumber > 1) add("sherlock-holmes");

  const references = selected.slice(0, 4).map((id) => {
    const reference = publicDomainCraftReferences[id];
    return `- 《${reference.title}》可借鉴的技法：${reference.lessons.join("；")}。`;
  });
  return `首稿写作技法蓝图（只学习叙事方法，不复制原句、专名、标志性场景或具体情节，也不模仿任何商业分级改写本）：
${references.join("\n")}

分级读物通用写法：
- 一个自然段完成一个清楚的小推进：感官定位 → 人物反应 → 目标或选择 → 可见后果。
- 先用高频具体词写清谁在哪里、想做什么，再加入少量新词；新词通过动作和上下文显义，并保持固定叫法。
- 对话与动作交替，避免连续台词；场景或说话者变化时重新点明人物名字，减少含混代词。
- 伏笔第一次出现时像普通细节，第二次改变人物判断，回收时用同一细节解释答案。
- 首稿完成后先做无声自检：逐段写出“因为 X，所以人物做 Y，结果 Z”；如果写不出，就在输出前重写该段。`;
}

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
  episodeMission: z.string().trim().min(10).max(500),
  newInformation: z.array(z.string().trim().min(6).max(300)).min(1).max(3),
  irreversibleChange: z.string().trim().min(8).max(400),
  mustNotRepeat: z.array(z.string().trim().min(6).max(300)).min(1).max(5),
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
  skill: z.enum(["detail", "inference", "cause_effect"]),
  evidenceQuote: z.string().trim().min(8).max(300),
});

const qualityEvidenceSchema = z.object({
  idiomaticPhrase: z.string().trim().min(3).max(100),
  sensoryQuote: z.string().trim().min(8).max(300),
  causalLinks: z.array(z.object({
    causeQuote: z.string().trim().min(8).max(300),
    effectQuote: z.string().trim().min(8).max(300),
  })).min(1).max(5),
  clueEvidence: z.array(z.object({
    clueId: z.string().trim().regex(/^C\d+$/),
    action: z.enum(["plant", "use", "payoff"]),
    evidenceQuote: z.string().trim().min(8).max(300),
  })).min(1).max(8),
  progression: z.object({
    obstacleQuote: z.string().trim().min(8).max(300),
    choiceQuote: z.string().trim().min(8).max(300),
    consequenceQuote: z.string().trim().min(8).max(300),
    newInformationQuote: z.string().trim().min(8).max(300),
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
  // Paragraph count is a presentation detail, not a reason to discard an otherwise
  // complete story. Prompts still ask for 3-5; accepting up to 8 makes model output
  // resilient to an extra scene break.
  paragraphs: z.array(z.string().trim().min(2).max(3000)).min(3).max(8),
});

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

export function mergeEpisodeStructure(narrative: unknown, metadata: unknown) {
  const parsedNarrative = episodeNarrativeSchema.safeParse(narrative);
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

const storyCritiqueSchema = z.object({
  plot: z.object({ score: z.number().min(0).max(10), issues: z.array(z.string()).max(8) }),
  childAppeal: z.object({ score: z.number().min(0).max(10), issues: z.array(z.string()).max(8) }),
  gradedLanguage: z.object({ score: z.number().min(0).max(10), issues: z.array(z.string()).max(8) }),
  continuity: z.object({ score: z.number().min(0).max(10), issues: z.array(z.string()).max(8) }),
  rewritePriorities: z.array(z.string().trim().min(4).max(300)).min(1).max(8),
});

const candidateCritiqueBatchSchema = z.object({
  reviews: z.array(storyCritiqueSchema.extend({
    candidateIndex: z.number().int().min(0).max(2),
  })).min(1).max(3),
});

export type SeriesPlan = z.infer<typeof planSchema>;
export type GeneratedStoryContent = z.infer<typeof episodeContentSchema>;
export type GeneratedStoryEpisode = z.infer<typeof episodeSchema>;
export type StoryCritique = z.infer<typeof storyCritiqueSchema>;

type StoryConfigFile = Partial<StoryRunOptions> & { maxRetries?: number };

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
};

const activeEpisodeStages = [
  "draft_selected",
  "edited",
  "mechanical_repaired",
  "semantic_reviewed",
  "semantic_rewritten",
] as const;

const storyQualityCheckpointSchema = z.object({
  score: z.number().min(0).max(100),
  wordCount: z.number().int().nonnegative(),
  averageSentenceWords: z.number().nonnegative(),
  lexicalCoverage: z.number().min(0).max(1).nullable(),
  unfamiliarWords: z.array(z.string()),
  issues: z.array(z.string()),
  blockingIssues: z.array(z.string()).default([]),
});

const completedEpisodeCheckpointSchema = z.object({
  episode: episodeSchema,
  quality: storyQualityCheckpointSchema,
  semanticReview: storyCritiqueSchema.optional(),
});

const legacyStoryGenerationCheckpointSchema = z.object({
  version: z.literal(1),
  plan: planSchema,
  episodes: z.array(completedEpisodeCheckpointSchema).max(30),
});

const currentStoryGenerationCheckpointSchema = z.object({
  version: z.literal(2),
  plan: planSchema,
  episodes: z.array(completedEpisodeCheckpointSchema).max(30),
  activeEpisode: z.object({
    index: z.number().int().min(0).max(29),
    stage: z.enum(activeEpisodeStages),
    episode: episodeContentSchema,
    quality: storyQualityCheckpointSchema.optional(),
    critique: storyCritiqueSchema.optional(),
    semanticReview: storyCritiqueSchema.optional(),
    fullRewriteCount: z.number().int().min(0).max(2),
    mechanicalRepairUsed: z.boolean(),
    semanticRewriteUsed: z.boolean(),
  }).optional(),
});

export const storyGenerationCheckpointSchema = z.union([
  currentStoryGenerationCheckpointSchema,
  legacyStoryGenerationCheckpointSchema,
]);

export type StoryGenerationCheckpointInput = z.infer<typeof storyGenerationCheckpointSchema>;
export type StoryGenerationCheckpoint = z.infer<typeof currentStoryGenerationCheckpointSchema>;
export type ActiveEpisodeCheckpoint = NonNullable<StoryGenerationCheckpoint["activeEpisode"]>;

export function parseStoryGenerationCheckpoint(value: unknown) {
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
  structureRepairModel: "",
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
  episodeCandidates: 3,
  minLexicalCoverage: 0.95,
  temperature: 0.65,
  reviewTemperature: 0.25,
  timeoutMs: 120_000,
  rewriteTimeoutMs: 480_000,
  networkRetries: 2,
  structureRetries: 2,
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
  --structure-repair-model <name> JSON 结构纠错优先模型；与原模型不同时自动切换
  --episode-candidates <1-3>  每集并行生成的首稿数量，默认 3；随后一次批量四维评审
  --timeout-ms <ms>       单次模型网络请求超时，默认 120000
  --rewrite-timeout-ms <ms> 完整正文重写超时，默认 480000
  --network-retries <1-3> 单次结构请求的网络尝试次数，默认 2
  --structure-retries <1-3> JSON 结构纠错次数，默认 2
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

export function structuredJsonValues(value: string) {
  const expanded: unknown[] = [];
  const seen = new Set<string>();
  const queue = parsedJsonValues(value).map((item) => ({ item, depth: 0 }));
  while (queue.length) {
    const current = queue.shift();
    if (!current) break;
    let key: string | undefined;
    try {
      key = JSON.stringify(current.item);
    } catch {
      continue;
    }
    if (key === undefined || seen.has(key)) continue;
    seen.add(key);
    expanded.push(current.item);
    if (current.depth >= 3) continue;
    if (Array.isArray(current.item)) {
      const array = current.item;
      if (array.every((item) => typeof item === "string")) {
        queue.push({ item: array.join(""), depth: current.depth + 1 });
      }
      const pairs = array.filter(
        (item): item is [string, unknown] => Array.isArray(item) && item.length === 2 && typeof item[0] === "string",
      );
      if (pairs.length === array.length && pairs.length) {
        queue.push({ item: Object.fromEntries(pairs), depth: current.depth + 1 });
      }
      if (
        array.length >= 2
        && array.length % 2 === 0
        && array.every((item, index) => index % 2 === 1 || typeof item === "string")
      ) {
        const flatPairs = Array.from({ length: array.length / 2 }, (_, index) => [
          array[index * 2] as string,
          array[index * 2 + 1],
        ] as const);
        queue.push({ item: Object.fromEntries(flatPairs), depth: current.depth + 1 });
      }
      const objects = array.filter(
        (item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item),
      );
      if (objects.length) {
        queue.push({ item: Object.assign({}, ...objects), depth: current.depth + 1 });
        for (const keyName of ["key", "field", "name"] as const) {
          const keyed = objects.filter(
            (item) => typeof item[keyName] === "string" && "value" in item,
          );
          if (keyed.length === objects.length) {
            queue.push({
              item: Object.fromEntries(keyed.map((item) => [item[keyName] as string, item.value])),
              depth: current.depth + 1,
            });
          }
        }
      }
      for (const item of array) queue.push({ item, depth: current.depth + 1 });
      continue;
    }
    if (typeof current.item === "string") {
      const nested = current.item.trim();
      if (nested.startsWith("{") || nested.startsWith("[") || nested.startsWith("```")) {
        for (const item of parsedJsonValues(nested)) {
          queue.push({ item, depth: current.depth + 1 });
        }
      }
      continue;
    }
    if (!current.item || typeof current.item !== "object") continue;
    const record = current.item as Record<string, unknown>;
    for (const wrapper of ["data", "result", "output", "response", "content"]) {
      if (wrapper in record) queue.push({ item: record[wrapper], depth: current.depth + 1 });
    }
  }
  return expanded;
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

function structuredValueShape(value: unknown): string {
  if (Array.isArray(value)) return `array(${value.length})`;
  if (value === null) return "null";
  if (typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>);
    return `object{${keys.slice(0, 8).join(",")}${keys.length > 8 ? ",…" : ""}}`;
  }
  return typeof value;
}

function endpoint(options: StoryRunOptions) {
  if (/^https?:\/\//.test(options.apiPath)) return options.apiPath;
  return `${options.baseUrl.replace(/\/$/, "")}/${options.apiPath.replace(/^\//, "")}`;
}

function modelRequestError(error: unknown) {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause as { code?: string; message?: string } | undefined;
  return [error.name, error.message, cause?.code, cause?.message]
    .filter(Boolean)
    .join(" · ")
    .slice(0, 500);
}

type ModelCallPolicy = {
  timeoutMs?: number;
  networkRetries?: number;
  structureRetries?: number;
  maxCompletionTokens?: number;
  recoverPartial?: (value: unknown, issues: string) => Promise<unknown | null>;
};

const modelTokenBudgets = {
  plan: 10240,
  episode: 8192,
  critique: 8192,
  questions: 2048,
} as const;

class ModelContentError extends Error {
  constructor(message: string, readonly retryableAsStructure: boolean) {
    super(message);
    this.name = "ModelContentError";
  }
}

class ModelHttpError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message);
    this.name = "ModelHttpError";
  }
}

export function structureModelForAttempt(
  options: Pick<StoryRunOptions, "model" | "reviewModel" | "structureRepairModel">,
  initialModel: string,
  attempt: number,
) {
  const sequence = [
    initialModel,
    options.structureRepairModel,
    initialModel === options.model ? options.reviewModel : options.model,
    options.reviewModel,
    options.model,
  ].filter((candidate, index, candidates) => Boolean(candidate) && candidates.indexOf(candidate) === index);
  return sequence[(Math.max(1, attempt) - 1) % sequence.length] || initialModel;
}

function modelContentText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map((part) => {
      if (typeof part === "string") return part;
      if (!part || typeof part !== "object") return "";
      const record = part as Record<string, unknown>;
      return typeof record.text === "string"
        ? record.text
        : typeof record.content === "string"
          ? record.content
          : "";
    }).join("");
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return typeof record.text === "string" ? record.text : "";
  }
  return "";
}

function modelDispatcher(timeoutMs: number) {
  const transportTimeoutMs = timeoutMs + 30_000;
  return new Agent({
    headersTimeout: transportTimeoutMs,
    bodyTimeout: transportTimeoutMs,
  });
}

export async function readStreamingModelContent(response: Awaited<ReturnType<typeof fetch>>) {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/event-stream")) {
    let payload: {
      choices?: Array<{ message?: { content?: unknown }; text?: unknown; finish_reason?: string | null }>;
      output_sensitive?: boolean;
      base_resp?: { status_code?: number; status_msg?: string };
    };
    try {
      payload = await response.json() as typeof payload;
    } catch {
      throw new ModelContentError("模型返回了无法解析的非流式 JSON", true);
    }
    if (payload.base_resp?.status_code && payload.base_resp.status_code !== 0) {
      throw new ModelContentError(
        `模型业务响应失败（status=${payload.base_resp.status_code}:${payload.base_resp.status_msg || "empty"}）`,
        false,
      );
    }
    const choice = payload.choices?.[0];
    const content = modelContentText(choice?.message?.content) || modelContentText(choice?.text);
    if (!content) {
      const filtered = payload.output_sensitive || choice?.finish_reason === "content_filter";
      throw new ModelContentError(
        `模型响应中没有文本内容（finish=${choice?.finish_reason ?? "unknown"}，`
        + `status=${payload.base_resp?.status_code ?? "unknown"}:${payload.base_resp?.status_msg || "empty"}）`,
        !filtered,
      );
    }
    return content;
  }
  if (!response.body) throw new ModelContentError("模型流式响应中没有可读取内容", true);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let reasoningCharacters = 0;
  let eventCount = 0;
  let finishReason = "unknown";
  let statusCode: number | string = "unknown";
  let statusMessage = "";
  let outputSensitive = false;
  const consumeEvent = (event: string) => {
    const data = event
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("\n");
    if (!data || data === "[DONE]") return;
    let payload: {
      choices?: Array<{
        delta?: { content?: unknown; text?: unknown; reasoning_content?: unknown; reasoning_details?: unknown };
        message?: { content?: unknown };
        text?: unknown;
        finish_reason?: string | null;
      }>;
      output_sensitive?: boolean;
      base_resp?: { status_code?: number; status_msg?: string };
      error?: { code?: string | number; message?: string };
    };
    try {
      payload = JSON.parse(data) as typeof payload;
    } catch {
      throw new ModelContentError("模型返回了无法解析的 SSE 数据事件", true);
    }
    eventCount += 1;
    outputSensitive ||= payload.output_sensitive === true;
    statusCode = payload.base_resp?.status_code ?? statusCode;
    statusMessage = payload.error?.message ?? payload.base_resp?.status_msg ?? statusMessage;
    const choice = payload.choices?.[0];
    if (choice?.finish_reason) finishReason = choice.finish_reason;
    content += modelContentText(choice?.delta?.content)
      || modelContentText(choice?.delta?.text)
      || modelContentText(choice?.message?.content)
      || modelContentText(choice?.text);
    reasoningCharacters += modelContentText(choice?.delta?.reasoning_content).length;
    if (Array.isArray(choice?.delta?.reasoning_details)) {
      reasoningCharacters += choice.delta.reasoning_details.reduce(
        (total, detail) => total + modelContentText(detail).length,
        0,
      );
    }
  };

  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    const events = buffer.split(/\r?\n\r?\n/);
    buffer = events.pop() ?? "";
    for (const event of events) consumeEvent(event);
  }
  buffer += decoder.decode();
  if (buffer.trim()) consumeEvent(buffer);
  if (typeof statusCode === "number" && statusCode !== 0) {
    throw new ModelContentError(
      `模型业务响应失败（status=${statusCode}:${statusMessage || "empty"}）`,
      false,
    );
  }
  if (!content) {
    throw new ModelContentError(
      `模型流式响应中没有文本内容（finish=${finishReason}，events=${eventCount}，`
      + `reasoningChars=${reasoningCharacters}，status=${statusCode}:${statusMessage || "empty"}）`,
      !outputSensitive && finishReason !== "content_filter",
    );
  }
  return content;
}

async function callModelText(
  options: StoryRunOptions,
  system: string,
  user: string,
  model = options.model,
  temperature = options.temperature,
  timeoutMs = options.timeoutMs,
  networkRetries = options.networkRetries,
  maxCompletionTokens: number = modelTokenBudgets.episode,
) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= networkRetries; attempt++) {
    const dispatcher = modelDispatcher(timeoutMs);
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
          stream: true,
          stream_options: { include_usage: true },
          reasoning_split: true,
          max_completion_tokens: maxCompletionTokens,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
        signal: AbortSignal.timeout(timeoutMs),
        dispatcher,
      });
      if (!response.ok) {
        const responseText = (await response.text()).slice(0, 1000);
        throw new ModelHttpError(
          `模型接口返回 ${response.status}: ${responseText}`,
          [408, 409, 425, 429, 500, 502, 503, 504].includes(response.status),
        );
      }
      return await readStreamingModelContent(response);
    } catch (error) {
      lastError = error;
      const contentFailure = error instanceof ModelContentError;
      const retryableHttp = !(error instanceof ModelHttpError) || error.retryable;
      const willRetry = !contentFailure && retryableHttp && attempt < networkRetries;
      options.log(
        `${contentFailure ? "模型内容响应异常" : `模型网络请求 ${attempt}/${networkRetries} 失败`}：${modelRequestError(error)}`
        + (willRetry ? "；正在重试…" : ""),
      );
      if (contentFailure || !retryableHttp) throw error;
      if (willRetry) await new Promise((resolve) => setTimeout(resolve, attempt * 800));
    } finally {
      await dispatcher.close().catch(() => undefined);
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
  policy: ModelCallPolicy = {},
) {
  let prompt = user;
  let lastError: Error | null = null;
  let lastShape = "无候选";
  const structureRetries = policy.structureRetries ?? options.structureRetries;
  for (let attempt = 1; attempt <= structureRetries; attempt++) {
    const correctionModel = structureModelForAttempt(options, model, attempt);
    const correctionTemperature = attempt === 1
      ? temperature
      : Math.min(temperature, options.reviewTemperature, 0.2);
    let content: string;
    try {
      content = await callModelText(
        options,
        system,
        prompt,
        correctionModel,
        correctionTemperature,
        policy.timeoutMs ?? options.timeoutMs,
        policy.networkRetries ?? options.networkRetries,
        policy.maxCompletionTokens ?? modelTokenBudgets.episode,
      );
    } catch (error) {
      if (error instanceof ModelContentError && error.retryableAsStructure && attempt < structureRetries) {
        lastError = error;
        options.log(
          `模型内容输出 ${attempt}/${structureRetries} 为空，`
          + `下一次切换到 ${structureModelForAttempt(options, model, attempt + 1)} 重新输出紧凑 JSON…`,
        );
        prompt = `${user}\n\n上一次响应只产生了推理或空增量，没有生成最终 JSON。请缩短内部分析，直接返回一份字段完整、内容精炼的 JSON 对象；不要输出 Markdown、解释或第二个对象。`;
        continue;
      }
      throw error;
    }
    const values = structuredJsonValues(content);
    lastShape = values.slice(0, 8).map(structuredValueShape).join(" → ") || "无候选";
    if (!values.length) {
      lastError = jsonParseFailure(content);
      if (attempt < structureRetries) {
        options.log(
          `模型结构输出 ${attempt}/${structureRetries} 无法解析，下一次切换到 `
          + `${structureModelForAttempt(options, model, attempt + 1)} 重新输出严格 JSON…`,
        );
      }
      prompt = `${user}\n\n上一次响应无法作为 JSON 解析：${lastError.message}。请重新输出一份完整 JSON：只能有一个顶层对象，键名和字符串必须使用英文双引号，数组必须填真实值；禁止输出 Markdown、解释、正则示例（如 [a-z]）、JSON Schema、注释或第二个对象。`;
      continue;
    }

    const attempts = values.map((value) => ({ value, result: schema.safeParse(value) }));
    const valid = attempts.find((entry) => entry.result.success);
    if (valid?.result.success) return valid.result.data;
    const objectAttempts = attempts.filter(
      (entry) => Boolean(entry.value) && typeof entry.value === "object" && !Array.isArray(entry.value),
    );
    const closestPool = objectAttempts.length ? objectAttempts : attempts;
    const closest = closestPool.reduce((best, entry) => {
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
    if (attempt === structureRetries && policy.recoverPartial) {
      try {
        const recoveredValue = await policy.recoverPartial(closest.value, issues);
        if (recoveredValue !== null) {
          const recovered = schema.safeParse(recoveredValue);
          if (recovered.success) return recovered.data;
          lastError = recovered.error;
          options.log(
            `模型局部结果已补全，但合并后的结构仍不合法：${recovered.error.issues
              .slice(0, 8)
              .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
              .join("；")}`,
          );
        }
      } catch (error) {
        lastError = new Error(`正文局部恢复失败：${modelRequestError(error)}`);
        options.log(lastError.message);
      }
    }
    const previousValue = JSON.stringify(closest.value).slice(0, 16_000);
    if (attempt < structureRetries) {
      options.log(
        `模型结构输出 ${attempt}/${structureRetries} 不完整，下一次切换到 `
        + `${structureModelForAttempt(options, model, attempt + 1)} 并携带字段错误自动修正：${issues}`,
      );
    }
    const rootReminder = Array.isArray(closest.value)
      ? "最外层类型错误：第一个非空字符必须是 {，最后一个非空字符必须是 }；禁止用 [ 和 ] 包住结果。"
      : "最外层必须保持为一个 JSON 对象。";
    prompt = `${user}\n\n你上一次实际返回的是：\n${previousValue}\n\n结构校验错误：${issues}。${rootReminder} 请以这份实际返回为基础，补齐并修正所有字段。不要使用省略号或占位值；只返回一份完整合法 JSON 对象。`;
  }
  if (lastError) {
    throw new Error(
      `模型连续 ${structureRetries} 次未返回所需对象结构（候选形状：${lastShape}）：${lastError.message}`,
    );
  }
  throw new Error("模型没有返回符合结构的 JSON");
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
        const narrative = episodeNarrativeSchema.safeParse(value);
        if (!narrative.success) return null;
        options.log(
          `[${episodeNumber}/${options.episodes}] 模型已返回完整 title/paragraphs，但附属字段不完整（${issues}）；`
          + "保留正文，正在单独补齐连续性状态、目标词和质量证据…",
        );
        const metadata = await callStructured(
          options,
          episodeMetadataSchema,
          "你只输出合法 JSON。你是故事数据整理编辑，只为已经定稿的英文正文补齐结构化元数据，绝不改写或重复正文。",
          `本集策划上下文：${JSON.stringify(episodePlanContext(plan, episodeNumber))}\n`
            + `上一集状态：${previousEpisode ? JSON.stringify(previousEpisode.storyState) : "第一集"}\n`
            + `已定稿标题与正文：${JSON.stringify(narrative.data)}\n\n`
            + "只根据这份最终正文生成 targetWords、continuitySummary、storyState、qualityEvidence。"
            + "targetWords 选 4-6 个且必须逐字出现在正文；continuitySummary 用 80-300 个中文字符记录结尾状态、关键发现和未解问题；"
            + "storyState 使用中文字符串数组；qualityEvidence 的所有英文 quote 必须逐字存在于 paragraphs，因果和 progression 顺序必须与正文一致，"
            + "clueEvidence 只能使用本集策划上下文中的线索编号。本次禁止返回 title、paragraphs、questions。\n\n"
            + "只返回：{\"targetWords\":[\"word\"],\"continuitySummary\":\"中文\",\"storyState\":{\"characterPositions\":[\"中文\"],\"knownFacts\":[\"中文\"],\"unresolvedQuestions\":[\"中文\"],\"items\":[\"中文\"],\"relationshipChanges\":[\"中文\"]},\"qualityEvidence\":{\"idiomaticPhrase\":\"exact quote\",\"sensoryQuote\":\"exact quote\",\"causalLinks\":[{\"causeQuote\":\"exact earlier quote\",\"effectQuote\":\"exact later quote\"}],\"clueEvidence\":[{\"clueId\":\"C1\",\"action\":\"plant\",\"evidenceQuote\":\"exact quote\"}],\"progression\":{\"obstacleQuote\":\"exact quote\",\"choiceQuote\":\"exact quote\",\"consequenceQuote\":\"exact quote\",\"newInformationQuote\":\"exact quote\"}}}",
          options.model,
          Math.min(options.reviewTemperature, 0.15),
          {
            timeoutMs: options.timeoutMs,
            networkRetries: options.networkRetries,
            structureRetries: options.structureRetries,
            maxCompletionTokens: 4096,
          },
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
${buildNarrativeCraftBrief(options)}

硬性质量标准：
1. 每集开头两句内出现异常事件、具体目标或好笑的麻烦，不做背景说明堆砌。
2. 每集至少有一次有效线索、一次合理误判或反转、一次由团队合作真正解决的困难。
3. 友情通过行动、分歧、互相补位和承认错误体现，不用说教台词总结价值观。
4. 对手要有能理解的动机；谜题答案必须由前文线索支持，禁止突然出现万能道具。
5. 每集结尾解决当前小目标，同时留下明确而公平的新悬念，让读者想立刻看下一集。
6. 整季有主谜题、角色成长和线索回收；笑点来自人物性格，不靠网络热梗。
7. 严格遵守上面的选材模式：公版名著可忠实简化原作；其余模式不得使用现有影视、动漫、小说或游戏的受保护表达。
8. 场景不能写成事件清单。每集选一个主要场景，用角色能看到、听到、闻到、尝到或触到的具体细节让空间可感，并用清楚的因果过渡连接行动。
9. 英文正文和题目必须是自然、地道、适龄的英语，不得夹杂中文。每集自然放入一个从语境可理解的常用英语表达，不堆砌俚语或生硬直译中文。

每套策划还必须完成：
- 故事圣经：3-8 条不可随意改变的世界规则；固定人物、地点和物件的英文称呼；每位主要角色的欲望、恐惧、说话特征和整季成长。
- 线索账本：每条线索用 C1、C2……编号，明确在哪一集埋下、误导、使用和回收；埋下不得晚于使用，最后一集前回收主线线索。
- 每集按“目标→阻碍→角色作出艰难选择→产生后果→出现新问题”构成因果链，不能只罗列事件。
- 每集写一份独立任务合同：episodeMission 说明这一集在整季中不可替代的作用；newInformation 列出读者本集真正新知道的事实；irreversibleChange 写明结尾后无法回到本集开头的状态变化；mustNotRepeat 列出上一集已完成、不得再次当作主要发现讲述的信息。
- 相邻两集不能用相同事件换地点重演。第二集必须扩大冲突或推翻一个判断，最终集必须用前文证据解决主问题；每集至少有一个新的行动结果，而不只是再次观察已知异常。
- 每集最多推进 2-3 个主要事件；人物换地点、获得信息或改变计划时必须写出原因。伏笔先以不起眼但可记住的感官细节出现，后续回收时让读者能回想起原文证据。

只返回一套策划 JSON，不要附加说明：
{"seriesTitle":"英文系列名","premise":"中文策划说明","cast":[{"name":"英文名","role":"中文角色作用","strength":"优点","flaw":"缺点"}],"seasonMystery":"中文主谜题","storyBible":{"worldRules":["中文"],"fixedTerms":[{"concept":"中文概念","english":"固定英文称呼"}],"characterArcs":[{"name":"英文名","wants":"中文","fear":"中文","voice":"中文","growth":"中文"}]},"clueLedger":[{"id":"C1","clue":"中文","introducedIn":1,"misdirection":"中文","usedIn":2,"payoffIn":3,"payoff":"中文"}],"episodes":[{"number":1,"title":"英文标题","episodeMission":"本集不可替代的叙事任务","newInformation":["本集新增事实"],"irreversibleChange":"本集结束后的不可逆变化","mustNotRepeat":["本集不得重复讲述的既有信息"],"openingHook":"中文","goal":"中文","obstacle":"中文","choice":"中文","consequence":"中文","newQuestion":"中文","problem":"中文","clue":"中文","teamworkTurn":"中文","emotionalBeat":"中文","cliffhanger":"中文"}]}`;
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
  return `根据故事季策划，写第 ${beat.number} 集英文分级阅读文章。

本集所需策划上下文：${JSON.stringify(episodePlanContext(plan, beat.number))}
上一集连续性摘要：${previousEpisode?.continuitySummary || "这是第一集，从一个立刻发生的异常事件开始。"}
上一集结构化状态：${previousEpisode ? JSON.stringify(previousEpisode.storyState) : "第一集尚无历史状态"}
上一集最终英文正文：${previousEpisode ? JSON.stringify(previousEpisode.paragraphs) : "第一集尚无正文"}
${sourceBrief(options)}
${gradedReadingBrief(options)}
${buildNarrativeCraftBrief(options, beat.number)}

语言控制：
- 正文 ${range[0]}-${range[1]} 个英文词，3-5 个自然段。
- title、paragraphs 和 qualityEvidence 中的原文证据只能使用英语，严禁出现任何中文汉字；中文只允许出现在 continuitySummary 和 storyState。
- 面向${level.audience}，优先使用约 ${readerProfile.headwords} 词档的核心高频词；只设置 4-${readerProfile.maxNewWords} 个可从语境猜出的 targetWords。
- 平均句长不超过约 ${level.maxSentenceWords} 词；关键动作使用短句。
- 对话简短自然，使用英语母语者在该场景中会说的表达；自然加入一个适龄常用表达（例如请求、犹豫、安慰或承认错误），通过上下文让意思清楚，禁止堆砌俚语或直译中文成语。
- 不为追求“文学感”频繁替换同义词；相同事物尽量沿用相同称呼，让孩子凭上下文建立词义。
- continuitySummary 只供下一集承接，必须使用 80-300 个中文字符概括本集结束时的人物位置、关键发现、未解问题和物件变化；不要复述全文、题目或写作评价，绝不能超过 1200 个字符。

叙事控制：
- 前两句必须形成钩子。
- 每段围绕一个清楚的小目标推进，最多包含 2-3 个主要事件；用 because、so、but、when、after 等自然关系或明确动作写清“为什么发生”和“因此发生什么”，不能像提纲一样连续罗列事件。
- 至少写入两种五感中的具体细节，用声音、光线、气味、味道、温度、触感或身体反应帮助读者看懂人物在哪里、危险从哪来；感官描写必须服务线索或情绪，不能堆形容词。
- 严格写出本集“目标→阻碍→选择→后果→新问题”的因果链；选择必须有代价，后果必须由角色选择引起。人物换地点、拿到物件或知道新信息时必须交代来源。
- 把 episodeMission 当作本集唯一中心任务；正文必须清楚呈现 newInformation 和 irreversibleChange。mustNotRepeat 中的信息只能作为一句以内的必要提醒，不能再次成为发现、悬念或主要场景。
- 与上一集最终正文逐段比较：不得重复相同的解释、动作顺序或悬念；每段必须至少推进一次新行动、新判断或新后果。
- 线索先以自然细节出现，之后才能使用或回收；合作必须改变结果；结尾必须是公平悬念。按 clueLedger 准确标注本集是 plant、use 还是 payoff。
- 遵守 storyBible 的固定称呼、人物声音和世界规则，不得让角色忘记已知事实或无故获得物件。
- 文章本身要精彩，不要用“这告诉我们团队合作很重要”之类说教句。
- qualityEvidence 不是额外创作内容，只用于自检：所有 quote 必须逐字复制 paragraphs。idiomaticPhrase 是正文中的地道表达；sensoryQuote 是感官描写；每个 causalLinks 的 causeQuote 必须出现在 effectQuote 之前；clueEvidence 必须覆盖本集线索动作；progression 的 obstacleQuote、choiceQuote、consequenceQuote 必须按正文顺序出现，newInformationQuote 必须证明本集确实推进了新信息。

输出前静默执行一次硬门禁自检，不要输出自检过程：
- 词数必须落在 ${range[0]}-${range[1]} 内，最好离上下限各留 8 个词余量；除带引号短对话外，不超过 4 词的叙述句不得超过全部叙述句的 30%。
- 4-${readerProfile.maxNewWords} 个 targetWords 必须全部以完整单词实际出现在 paragraphs；优先用高频词，避免为了文采引入生僻同义词。
- progression 四段证据必须互不相同且逐字存在，正文顺序严格为 obstacleQuote → choiceQuote → consequenceQuote；newInformationQuote 必须证明本集新增事实。
- causalLinks、clueEvidence、idiomaticPhrase 和 sensoryQuote 必须逐字来自最终 paragraphs，修改正文后同步更新所有 quote。
- 本阶段只生成正文及其结构化状态，不生成 questions；题目会在正文通过全部质量门禁后单独生成。

只返回 JSON：
{"title":"English title","paragraphs":["English only..."],"targetWords":["word"],"continuitySummary":"80-300个中文字符，只记录结尾状态、关键发现和未解问题","storyState":{"characterPositions":["中文：人物当前位置及状态"],"knownFacts":["中文：角色已经确认的事实"],"unresolvedQuestions":["中文：尚未解决的问题"],"items":["中文：物件及持有人"],"relationshipChanges":["中文：本集发生的关系变化"]},"qualityEvidence":{"idiomaticPhrase":"exact English phrase from paragraphs","sensoryQuote":"exact English quote from paragraphs","causalLinks":[{"causeQuote":"exact earlier quote","effectQuote":"exact later quote"}],"clueEvidence":[{"clueId":"C1","action":"plant","evidenceQuote":"exact English quote"}],"progression":{"obstacleQuote":"exact English quote","choiceQuote":"exact later English quote","consequenceQuote":"exact still later English quote","newInformationQuote":"exact English quote proving new story information"}}}`;
}

function critiquePrompt(
  options: StoryRunOptions,
  plan: SeriesPlan,
  episode: GeneratedStoryContent,
  episodeNumber: number,
  previousEpisode: GeneratedStoryEpisode | null,
) {
  return `你是由四位编辑组成的儿童英语故事审稿组，只诊断问题，不重写正文。

本集所需策划上下文：${JSON.stringify(episodePlanContext(plan, episodeNumber))}
上一集状态：${previousEpisode ? JSON.stringify(previousEpisode.storyState) : "第一集"}
上一集最终正文：${previousEpisode ? JSON.stringify(previousEpisode.paragraphs) : "第一集"}
第 ${episodeNumber} 集待审稿：${JSON.stringify(episode)}
${sourceBrief(options)}
${gradedReadingBrief(options)}
${buildNarrativeCraftBrief(options, episodeNumber)}

四个视角分别按 0-10 分审查：
1. plot：逐段追踪目标、阻碍、选择、后果，检查每次移动、发现和计划改变是否有原因；线索是否先埋后用、后续解释是否回收前文，而不是事件清单或突然跳转。episodeMission、newInformation 和 irreversibleChange 未真正完成时不得超过 7 分。
2. childAppeal：前两句钩子、自然笑点、具体冒险、伙伴互动、至少两种服务剧情的五感描写和结尾悬念是否真能让孩子想读下一集。若角色只是观察、等待、移动和听解释，没有承担代价或改变结果，不得超过 7 分。
3. gradedLanguage：正文是否纯英文且自然地道；句子、词汇、指代是否适龄；是否有中式英语、不必要难词、碎片句、抽象解释和同义词漂移。
4. continuity：是否遵守故事圣经、线索账本和上一集人物/物件/已知事实状态；是否把 mustNotRepeat 中的旧发现换句话重复成主要情节；禁止补写正文没有的地图、对话、动机或动作。重复上一集主要事件或解释时不得超过 7 分。

评分必须严格校准：8 分代表无需结构性修改即可发布，9 分代表明显优秀，10 分只给几乎没有可执行问题的稿件。只要 issues 中存在结构性问题，对应维度就不能给 8 分以上。

只返回 JSON：
{"plot":{"score":8,"issues":["中文问题"]},"childAppeal":{"score":8,"issues":["中文问题"]},"gradedLanguage":{"score":8,"issues":["中文问题"]},"continuity":{"score":8,"issues":["中文问题"]},"rewritePriorities":["按重要性排序的中文修改动作"]}`;
}

function candidateCritiqueBatchPrompt(
  options: StoryRunOptions,
  plan: SeriesPlan,
  candidates: GeneratedStoryContent[],
  episodeNumber: number,
  previousEpisode: GeneratedStoryEpisode | null,
) {
  return `你是儿童英语连续故事的多维候选评审组。一次比较全部候选，但必须分别给每份候选独立评分，不能因为相对更好就放宽绝对质量线。

本集所需策划上下文：${JSON.stringify(episodePlanContext(plan, episodeNumber))}
上一集状态：${previousEpisode ? JSON.stringify(previousEpisode.storyState) : "第一集"}
上一集最终正文：${previousEpisode ? JSON.stringify(previousEpisode.paragraphs) : "第一集"}
候选初稿（candidateIndex 必须沿用这里的编号）：${JSON.stringify(candidates.map((episode, candidateIndex) => ({ candidateIndex, episode })))}
${sourceBrief(options)}
${gradedReadingBrief(options)}
${buildNarrativeCraftBrief(options, episodeNumber)}

每份候选都按以下四个维度 0-10 分评审：
1. plot：目标、阻碍、选择、后果的因果是否完整，任务、新信息和不可逆变化是否真正完成。
2. childAppeal：开头钩子、伙伴互动、幽默、五感、冒险和结尾悬念是否能吸引孩子继续读。
3. gradedLanguage：是否纯英文、自然地道、词汇句长适龄，避免碎片句、中式英语和生僻同义词。
4. continuity：是否遵守故事圣经、线索账本和上一集状态，是否避免重复或凭空补信息。

8 分代表不需结构性修改即可发布；只要存在结构性问题，对应维度不得超过 7 分。每个 issues 最多保留 3 个最重要问题，rewritePriorities 最多 4 项，保持精炼以免输出被截断。必须为每个 candidateIndex 恰好返回一份评审。

只返回：{"reviews":[{"candidateIndex":0,"plot":{"score":8,"issues":["中文问题"]},"childAppeal":{"score":8,"issues":["中文问题"]},"gradedLanguage":{"score":8,"issues":["中文问题"]},"continuity":{"score":8,"issues":["中文问题"]},"rewritePriorities":["中文修改动作"]}]}`;
}

function reviewPrompt(
  options: StoryRunOptions,
  plan: SeriesPlan,
  episode: GeneratedStoryContent,
  critique: z.infer<typeof storyCritiqueSchema>,
  episodeNumber: number,
  previousEpisode: GeneratedStoryEpisode | null,
) {
  const level = examGuide[options.examId];
  const range = episodeNumber <= 2 ? level.firstWords : level.laterWords;
  return `你是严格的儿童英语故事编辑。请重写并提升下面这一集，而不是只写评语。

本集所需策划上下文：${JSON.stringify(episodePlanContext(plan, episodeNumber))}
上一集状态：${previousEpisode ? JSON.stringify(previousEpisode.storyState) : "第一集"}
上一集最终正文：${previousEpisode ? JSON.stringify(previousEpisode.paragraphs) : "第一集"}
待审稿：${JSON.stringify(episode)}
四维审稿意见：${JSON.stringify(critique)}
${sourceBrief(options)}
${gradedReadingBrief(options)}
${buildNarrativeCraftBrief(options, episodeNumber)}

按 rewritePriorities 逐项定向修复，并检查：开头钩子、人物声音、自然地道的英语、服务剧情的五感描写、清楚的逐段因果、线索先埋后收、团队合作的因果作用、情绪变化、悬念、连续性和选材边界。必须完成 episodeMission，让 newInformation 通过行动被发现，让 irreversibleChange 成为角色选择造成的结果；删除对 mustNotRepeat 和上一集主要动作的重复讲述。正文保持 ${range[0]}-${range[1]} 词、3-5 段，语言适合${level.audience}，平均句长约不超过 ${level.maxSentenceWords} 词。title、paragraphs 和所有 quote 必须纯英文，不得出现中文。删除说教、事件清单、空泛形容、突然出现的解法、无来源的信息、不必要难词和为了变化而使用的生僻同义词。重写正文后必须同步更新 qualityEvidence（包括 progression）、continuitySummary 和 storyState。continuitySummary 必须压缩为 80-300 个中文字符，只保留结尾状态、关键发现和未解问题，绝不能超过 1200 个字符。本阶段不要生成 questions；题目将在正文定稿后单独生成。

返回与原稿完全相同结构的 JSON，不要附加评论。`;
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
    options.reviewModel || options.model,
    0.1,
    { maxCompletionTokens: modelTokenBudgets.questions },
  );
  return result.questions;
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

export function selectBestStoryCritique(critiques: StoryCritique[]) {
  if (!critiques.length) throw new Error("至少需要一份故事评审结果");
  return critiques.reduce((bestIndex, critique, index) => {
    const best = critiques[bestIndex];
    const score = critique.plot.score * 0.35
      + critique.childAppeal.score * 0.3
      + critique.continuity.score * 0.2
      + critique.gradedLanguage.score * 0.15;
    const bestScore = best.plot.score * 0.35
      + best.childAppeal.score * 0.3
      + best.continuity.score * 0.2
      + best.gradedLanguage.score * 0.15;
    return score > bestScore ? index : bestIndex;
  }, 0);
}

export function semanticQualityIssues(
  critique: StoryCritique,
  firstEpisodeBaseline?: StoryCritique | null,
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
    if (current < 8) {
      issues.push(`${labels[dimension]} ${current.toFixed(1)} < 8`);
    }
    const baseline = firstEpisodeBaseline?.[dimension].score;
    if (baseline !== undefined && current < baseline - 1) {
      issues.push(`${labels[dimension]}比第一集低 ${(baseline - current).toFixed(1)} 分`);
    }
  }
  if (firstEpisodeBaseline && critiqueAverage(critique) < critiqueAverage(firstEpisodeBaseline) - 0.5) {
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
  const range = episodeNumber <= 2 ? level.firstWords : level.laterWords;
  const text = episode.paragraphs.join(" ");
  const questions = "questions" in episode ? episode.questions : null;
  const words = text.match(/[A-Za-z]+(?:['-][A-Za-z]+)*/g) ?? [];
  const sentences = narrativeSentences(text);
  const averageSentenceWords = sentences.length ? words.length / sentences.length : words.length;
  const issues: string[] = [];
  const blockingIssues: string[] = [];
  const block = (issue: string) => {
    issues.push(issue);
    blockingIssues.push(issue);
  };
  let lexicalCoverage: number | null = null;
  let unfamiliarWords: string[] = [];
  if (words.length < range[0]) block(`正文过短：${words.length} < ${range[0]}`);
  if (words.length > range[1]) block(`正文过长：${words.length} > ${range[1]}`);
  if (averageSentenceWords > level.maxSentenceWords + 2) block(`平均句长过高：${averageSentenceWords.toFixed(1)}`);
  const fragmentRatio = fragmentSentenceRatio(text);
  if (fragmentRatio > 0.3) block(`碎片化短句过多：${(fragmentRatio * 100).toFixed(0)}% 的句子不超过 4 词`);
  if (!/[“”"']/.test(text)) block("缺少自然对话或人物声音");
  if (!/(together|friend|team|shared|helped|agreed|asked)/i.test(text)) block("团队合作在正文中不够明确");
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
    block("英文正文、题目或证据中夹杂中文或其他中日韩文字");
  }
  if (episode.targetWords.length < 4 || episode.targetWords.length > readerProfile.maxNewWords) {
    block(`目标词数量应为 4-${readerProfile.maxNewWords} 个`);
  }
  const missingTargetWords = episode.targetWords.filter(
    (word) => !new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text),
  );
  if (missingTargetWords.length) block(`目标词未出现在正文：${missingTargetWords.join(", ")}`);
  if (questions?.some((question) => question.options.length !== 4 || question.answer > 3)) block("题目选项或答案索引不合法");

  const idiomaticPhraseWords = episode.qualityEvidence.idiomaticPhrase.match(/[A-Za-z]+(?:['-][A-Za-z]+)*/g) ?? [];
  if (idiomaticPhraseWords.length < 2 || evidenceLocation(text, episode.qualityEvidence.idiomaticPhrase) < 0) {
    block("地道英语表达未逐字出现在正文，或表达过短");
  }
  if (
    evidenceLocation(text, episode.qualityEvidence.sensoryQuote) < 0
    || !sensoryPattern.test(episode.qualityEvidence.sensoryQuote)
  ) {
    block("五感描写证据未逐字出现在正文，或缺少具体声音、光线、气味、味道、温度或触感");
  }
  if (episode.qualityEvidence.causalLinks.length < 2) {
    block("因果证据不足：至少需要 2 组正文内可定位的原因与结果");
  }
  for (const [index, link] of episode.qualityEvidence.causalLinks.entries()) {
    const causeLocation = evidenceLocation(text, link.causeQuote);
    const effectLocation = evidenceLocation(text, link.effectQuote);
    if (causeLocation < 0 || effectLocation < 0) {
      block(`第 ${index + 1} 组因果证据未逐字出现在正文`);
    } else if (causeLocation >= effectLocation) {
      block(`第 ${index + 1} 组因果顺序不清：原因必须先于结果出现`);
    }
  }
  for (const clue of episode.qualityEvidence.clueEvidence) {
    if (evidenceLocation(text, clue.evidenceQuote) < 0) {
      block(`线索 ${clue.clueId} 的 ${clue.action} 证据未逐字出现在正文`);
    }
  }
  const progression = episode.qualityEvidence.progression;
  const obstacleLocation = evidenceLocation(text, progression.obstacleQuote);
  const choiceLocation = evidenceLocation(text, progression.choiceQuote);
  const consequenceLocation = evidenceLocation(text, progression.consequenceQuote);
  const newInformationLocation = evidenceLocation(text, progression.newInformationQuote);
  if ([obstacleLocation, choiceLocation, consequenceLocation, newInformationLocation].some((location) => location < 0)) {
    block("本集阻碍、选择、后果或新信息的推进证据未逐字出现在正文");
  } else if (!(obstacleLocation < choiceLocation && choiceLocation < consequenceLocation)) {
    block("本集推进顺序不清：阻碍必须先于角色选择，角色选择必须先于实际后果");
  }
  if (new Set([
    progression.obstacleQuote,
    progression.choiceQuote,
    progression.consequenceQuote,
    progression.newInformationQuote,
  ].map(normalizedEvidence)).size < 4) {
    block("本集阻碍、选择、后果和新信息不能复用同一段证据");
  }
  for (const issue of repeatedNarrativeIssues(episode, previousEpisode)) block(issue);
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
        block(`线索证据引用了季纲中不存在的 ${evidence.clueId}`);
      } else if (expectedEpisode !== episodeNumber) {
        block(`线索 ${evidence.clueId} 的 ${evidence.action} 应发生在第 ${expectedEpisode} 集，而不是第 ${episodeNumber} 集`);
      }
    }
    const requiredClueActions = plan.clueLedger.flatMap((clue) => [
      ...(clue.introducedIn === episodeNumber ? [{ clueId: clue.id, action: "plant" as const }] : []),
      ...(clue.usedIn === episodeNumber ? [{ clueId: clue.id, action: "use" as const }] : []),
      ...(clue.payoffIn === episodeNumber ? [{ clueId: clue.id, action: "payoff" as const }] : []),
    ]);
    for (const required of requiredClueActions) {
      if (!episode.qualityEvidence.clueEvidence.some(
        (clue) => clue.clueId === required.clueId && clue.action === required.action,
      )) {
        block(`线索 ${required.clueId} 缺少 ${required.action} 原文证据`);
      }
    }
  }
  if (questions) {
    const questionSkills = new Set(questions.map((question) => question.skill));
    if (!questionSkills.has("detail")) block("题目缺少一道人物、动作或线索细节题");
    if (!questionSkills.has("inference") && !questionSkills.has("cause_effect")) {
      block("题目缺少一道有原文依据的推断或因果题");
    }
    for (const [index, question] of questions.entries()) {
      if (evidenceLocation(text, question.evidenceQuote) < 0) {
        block(`第 ${index + 1} 题的原文证据不存在于正文`);
      }
      if ((question.evidenceQuote.match(/[A-Za-z]+(?:['-][A-Za-z]+)*/g) ?? []).length < 3) {
        block(`第 ${index + 1} 题的原文证据过短，无法支撑答案`);
      }
      if (question.options.some((option) => /^\s*[A-D][).:：]\s*/i.test(option))) {
        block(`第 ${index + 1} 题选项不应重复包含 A/B/C/D 编号`);
      }
      if (new Set(question.options.map((option) => normalizedEvidence(option))).size !== question.options.length) {
        block(`第 ${index + 1} 题包含重复选项`);
      }
    }
  }
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
    blockingIssues,
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
        options.model,
        options.temperature,
        { maxCompletionTokens: modelTokenBudgets.plan },
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
    { maxCompletionTokens: modelTokenBudgets.plan },
  );
  return validateSeriesPlan(selection, options.episodes);
}

async function generateEpisodeDraft(
  options: StoryRunOptions,
  plan: SeriesPlan,
  index: number,
  previousEpisode: GeneratedStoryEpisode | null,
) {
  const episodeNumber = index + 1;
  reportProgress(
    options,
    "drafting",
    `正在生成第 ${episodeNumber}/${options.episodes} 集的 ${options.episodeCandidates} 份候选初稿`,
    episodeProgress(options, index, 0),
  );
  const drafts = await Promise.all(Array.from({ length: options.episodeCandidates }, (_, candidateIndex) =>
    callEpisodeContent(
      options,
      plan,
      episodeNumber,
      previousEpisode,
      "你只输出合法 JSON。你是擅长悬念、幽默、伙伴感与分级英语的儿童故事作家。",
      `${episodePrompt(options, plan, index, previousEpisode)}\n\n这是候选初稿 ${candidateIndex + 1}/${options.episodeCandidates}。请用与其他候选不同但符合季纲的具体阻碍、角色互动和感官细节完成本集任务合同。`,
      options.model,
      options.temperature,
      { maxCompletionTokens: modelTokenBudgets.episode },
    ),
  ));
  reportProgress(
    options,
    "reviewing",
    `第 ${episodeNumber} 集的 ${drafts.length} 份候选初稿已完成，正在进行一次批量多维评审`,
    episodeProgress(options, index, 0.3),
  );
  const expectedCritiqueBatchSchema = candidateCritiqueBatchSchema.superRefine((value, context) => {
    const indexes = value.reviews.map((review) => review.candidateIndex);
    if (
      value.reviews.length !== drafts.length
      || new Set(indexes).size !== drafts.length
      || drafts.some((_, candidateIndex) => !indexes.includes(candidateIndex))
    ) {
      context.addIssue({
        code: "custom",
        path: ["reviews"],
        message: `必须为 candidateIndex 0-${drafts.length - 1} 各返回一份且不能重复`,
      });
    }
  });
  const critiqueBatch = await callStructured(
    options,
    expectedCritiqueBatchSchema,
    "你只输出合法 JSON。你是严格的儿童英语故事候选总编，必须一次完成所有候选的四维绝对质量评审。",
    candidateCritiqueBatchPrompt(options, plan, drafts, episodeNumber, previousEpisode),
    options.reviewModel || options.model,
    options.reviewTemperature,
    { maxCompletionTokens: modelTokenBudgets.critique },
  );
  const critiqueByIndex = new Map(
    critiqueBatch.reviews.map(({ candidateIndex, ...critique }) => [candidateIndex, critique]),
  );
  const critiques = drafts.map((_, candidateIndex) => {
    const critique = critiqueByIndex.get(candidateIndex);
    if (!critique) throw new Error(`批量候选评审缺少 candidateIndex=${candidateIndex}`);
    return critique;
  });
  let selectedIndex = selectBestStoryCritique(critiques);
  if (critiqueAverage(critiques[selectedIndex]) < 7) {
    reportProgress(
      options,
      "drafting",
      `第 ${episodeNumber} 集候选质量偏低，正在重新生成一份全新初稿`,
      episodeProgress(options, index, 0.42),
    );
    options.log(
      `[${episodeNumber}/${options.episodes}] 最佳候选四维均分仅 ${critiqueAverage(critiques[selectedIndex]).toFixed(1)}，`
      + "不进入连续润色，改为重新生成一份候选稿。",
    );
    const replacement = await callEpisodeContent(
      options,
      plan,
      episodeNumber,
      previousEpisode,
      "你只输出合法 JSON。你是擅长从失败审稿中重建故事的儿童英语作家；必须从空白重新创作，不得只改写旧稿。",
      `${episodePrompt(options, plan, index, previousEpisode)}\n\n上一批最佳候选仍未达到可编辑底线，主要问题是：${JSON.stringify(critiques[selectedIndex].rewritePriorities)}。请从空白重新设计本集的具体阻碍、角色选择、因果后果和结尾悬念，避免沿用问题稿的事件顺序或表达。`,
      options.model,
      options.temperature,
      { maxCompletionTokens: modelTokenBudgets.episode },
    );
    const replacementCritique = await callStructured(
      options,
      storyCritiqueSchema,
      "你只输出合法 JSON。你代表剧情、儿童吸引力、分级语言和连续性四位专业编辑，必须指出可执行的问题。",
      critiquePrompt(options, plan, replacement, episodeNumber, previousEpisode),
      options.reviewModel || options.model,
      options.reviewTemperature,
      { maxCompletionTokens: modelTokenBudgets.critique },
    );
    drafts.push(replacement);
    critiques.push(replacementCritique);
    selectedIndex = selectBestStoryCritique(critiques);
  }
  const draft = drafts[selectedIndex];
  const critique = critiques[selectedIndex];
  if (critiqueAverage(critique) < 7) {
    throw new Error(
      `第 ${episodeNumber} 集候选初稿连续未达到编辑底线：四维均分 ${critiqueAverage(critique).toFixed(1)} < 7`,
    );
  }
  options.log(
    `[${episodeNumber}/${options.episodes}] 从 ${drafts.length} 份初稿中选择候选 ${selectedIndex + 1}`
    + `（四维均分 ${critiqueAverage(critique).toFixed(1)}）`,
  );
  return { episode: draft, critique };
}

async function repairEpisode(
  options: StoryRunOptions,
  plan: SeriesPlan,
  episode: GeneratedStoryContent,
  episodeNumber: number,
  quality: StoryQuality,
  previousEpisode: GeneratedStoryEpisode | null,
) {
  const level = examGuide[options.examId];
  const range = episodeNumber <= 2 ? level.firstWords : level.laterWords;
  const beat = plan.episodes[episodeNumber - 1];
  const relevantClues = plan.clueLedger.filter(
    (clue) => [clue.introducedIn, clue.usedIn, clue.payoffIn].includes(episodeNumber),
  );
  return callEpisodeContent(
    options,
    plan,
    episodeNumber,
    previousEpisode,
    "你只输出合法 JSON。你是分级阅读终审编辑，只修复自动质量检测指出的问题，并保持精彩情节和原有结构。",
    `故事圣经：${JSON.stringify(plan.storyBible)}\n本集独立任务合同：${JSON.stringify(beat)}\n本集相关线索：${JSON.stringify(relevantClues)}\n上一集结构化状态：${previousEpisode ? JSON.stringify(previousEpisode.storyState) : "第一集"}\n待修正文：${JSON.stringify(episode)}\n自动检测问题：${quality.issues.join("；")}\n超纲或未识别词（除 targetWords、人物专名和固定术语外，逐个换成更常见表达）：${quality.unfamiliarWords.join(", ")}\n\n正文必须保持 ${range[0]}-${range[1]} 词。title、paragraphs 和所有 quote 必须是纯英文，彻底删除其中的中文。targetWords 中的每个词必须以完整单词实际出现在正文中；不要引入新的生僻同义词。把跳跃的事件改成读者可跟随的因果链，用服务线索或情绪的五感细节连接场景，并自然保留一个适龄地道表达。不要重复上一集的主要动作或解释，必须完成本集 episodeMission、newInformation 和 irreversibleChange。不要删除关键线索、角色选择的后果或结尾悬念。每个 qualityEvidence（包括 progression）都必须逐字复制修改后 paragraphs 中真实存在的文本。修改后同步更新 qualityEvidence、continuitySummary 和 storyState。continuitySummary 必须是 80-300 个中文字符，只记录结尾状态、关键发现和未解问题，绝不能超过 1200 个字符。本阶段不要生成 questions。返回与待修正文相同结构的完整 JSON。`,
    options.reviewModel || options.model,
    0.1,
    {
      timeoutMs: options.rewriteTimeoutMs,
      networkRetries: 1,
      structureRetries: 1,
      maxCompletionTokens: modelTokenBudgets.episode,
    },
  );
}

async function reviewEpisodeSemantics(
  options: StoryRunOptions,
  plan: SeriesPlan,
  episode: GeneratedStoryContent,
  episodeNumber: number,
  previousEpisode: GeneratedStoryEpisode | null,
) {
  return callStructured(
    options,
    storyCritiqueSchema,
    "你只输出合法 JSON。你是独立终审，不为之前的生成或修稿背书；必须严格判断这篇文章是否真的逻辑清楚、吸引孩子且比上一集有实质推进。",
    critiquePrompt(options, plan, episode, episodeNumber, previousEpisode),
    options.reviewModel || options.model,
    options.reviewTemperature,
    { maxCompletionTokens: modelTokenBudgets.critique },
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
  return quality.blockingIssues.length === 0
    && quality.score >= 80
    && (quality.lexicalCoverage === null || quality.lexicalCoverage >= targetCoverage);
}

export function passesStoryQualityFloor(quality: StoryQuality, targetCoverage: number) {
  const publishableCoverage = Math.min(targetCoverage, 0.9);
  return quality.blockingIssues.length === 0
    && quality.score >= 80
    && (quality.lexicalCoverage === null || quality.lexicalCoverage >= publishableCoverage);
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
  options.onEpisodeImported?.({
    articleId,
    episodeNumber: index + 1,
    totalEpisodes: options.episodes,
    seriesTitle: plan.seriesTitle,
  });
  return articleId;
}

export async function runStoryGeneration(options: StoryRunOptions) {
  if (options.dryRun) {
    options.log(buildSeriesPlanPrompt(options));
    return { generated: 0, imported: 0, articleIds: [] as string[], seriesTitle: "", qualities: [] as StoryQuality[] };
  }
  if (!options.baseUrl || !options.model) throw new Error("需要配置 baseUrl 和 model");
  const engagementBrief = loadStoryEngagementBrief(options.databasePath, options.interest, options.examId);
  options.log(engagementBrief);
  let restored = parseStoryGenerationCheckpoint(options.checkpoint);
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
    } catch (error) {
      options.log(`检查点无法继续，将重新生成：${error instanceof Error ? error.message : "内容不合法"}`);
      restored = null;
    }
  }
  const plan = restored?.plan ?? await generatePlan(options, engagementBrief);
  const generated: GeneratedStoryEpisode[] = restored?.episodes.map((item) => item.episode) ?? [];
  const qualities: StoryQuality[] = restored?.episodes.map((item) => item.quality) ?? [];
  const semanticReviews: Array<StoryCritique | undefined> = restored?.episodes.map(
    (item) => item.semanticReview,
  ) ?? [];
  let activeEpisode = restored?.activeEpisode;
  const checkpointEpisodes = () => generated.map((savedEpisode, savedIndex) => ({
    episode: savedEpisode,
    quality: qualities[savedIndex],
    semanticReview: semanticReviews[savedIndex],
  }));
  const saveCheckpoint = (active?: ActiveEpisodeCheckpoint) => {
    activeEpisode = active;
    options.onCheckpoint?.({
      version: 2,
      plan,
      episodes: checkpointEpisodes(),
      ...(active ? { activeEpisode: active } : {}),
    });
  };
  let previousEpisode: GeneratedStoryEpisode | null = generated.at(-1) ?? null;
  if (restored) {
    const nextEpisode = generated.length + 1;
    options.log(
      `已从检查点恢复《${plan.seriesTitle}》和 ${generated.length} 集成稿`
      + (activeEpisode ? `，第 ${activeEpisode.index + 1} 集恢复到 ${activeEpisode.stage} 阶段。` : "。"),
    );
    reportProgress(
      options,
      generated.length >= options.episodes ? "saving" : "drafting",
      generated.length >= options.episodes
        ? `已恢复全部 ${options.episodes} 集，正在保存到故事书架`
        : generated.length
          ? `已恢复前 ${generated.length} 集，正在从第 ${nextEpisode} 集继续`
          : activeEpisode
            ? `已恢复第 ${activeEpisode.index + 1} 集的阶段成果，正在继续创作`
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
      articleIds.push(importStoryEpisode(db, options, plan, generated[index], qualities[index], index));
    }

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
      for (let index = generated.length; index < options.episodes; index++) {
        const episodeNumber = index + 1;
        const episodePrevious = previousEpisode;
        const savedActive = activeEpisode?.index === index ? activeEpisode : undefined;
        let episode: GeneratedStoryContent;
        let quality: StoryQuality;
        let critique: StoryCritique | undefined;
        let semanticReview: StoryCritique | undefined;
        let fullRewriteCount = savedActive?.fullRewriteCount ?? 0;
        let mechanicalRepairUsed = savedActive?.mechanicalRepairUsed ?? false;
        let semanticRewriteUsed = savedActive?.semanticRewriteUsed ?? false;

        if (savedActive) {
          episode = savedActive.episode;
          critique = savedActive.critique;
          semanticReview = savedActive.semanticReview;
          quality = assessStoryQuality(episode, options, episodeNumber, lexical, plan, episodePrevious);
          options.log(
            `[${episodeNumber}/${options.episodes}] 从 ${savedActive.stage} 阶段继续，`
            + `已使用完整重写 ${fullRewriteCount}/2 次。`,
          );
        } else {
          const draft = await generateEpisodeDraft(options, plan, index, episodePrevious);
          episode = draft.episode;
          critique = draft.critique;
          quality = assessStoryQuality(episode, options, episodeNumber, lexical, plan, episodePrevious);
          saveCheckpoint({
            index,
            stage: "draft_selected",
            episode,
            quality,
            critique,
            fullRewriteCount,
            mechanicalRepairUsed,
            semanticRewriteUsed,
          });
        }

        if (!(savedActive?.stage === "semantic_reviewed" && semanticReview)) {
          if ((!savedActive || savedActive.stage === "draft_selected") && critique) {
            semanticReview = critique;
            options.log(
              `[${episodeNumber}/${options.episodes}] 复用候选稿四维评审作为剧情门禁，跳过一次重复语义评审。`,
            );
          } else {
            reportProgress(
              options,
              "reviewing",
              `第 ${episodeNumber} 集正在进行剧情与连续性评审`,
              episodeProgress(options, index, 0.58),
            );
            semanticReview = await reviewEpisodeSemantics(
              options,
              plan,
              episode,
              episodeNumber,
              episodePrevious,
            );
          }
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
        if (semanticIssues.length && !semanticRewriteUsed && !mechanicalRepairUsed) {
          if (fullRewriteCount >= 2) {
            throw new Error(
              `第 ${episodeNumber} 集已用完 2 次完整重写预算，语义质量仍未达标：${semanticIssues.join("；")}`,
            );
          }
          reportProgress(
            options,
            "repairing",
            `第 ${episodeNumber} 集正在先进行第 ${fullRewriteCount + 1}/2 次完整重写（剧情语义）`,
            episodeProgress(options, index, 0.68),
          );
          semanticRewriteUsed = true;
          episode = await callEpisodeContent(
            options,
            plan,
            episodeNumber,
            episodePrevious,
            "你只输出合法 JSON。你是儿童连续故事终审编辑，必须直接修复剧情逻辑、吸引力、语言或连续性不足。",
            `${reviewPrompt(options, plan, episode, semanticReview, episodeNumber, episodePrevious)}\n\n`
              + `在优先修复剧情问题的同时，一并消除当前自动检测到的结构与词汇问题：${quality.issues.join("；") || "暂无"}。`
              + "仍会在剧情定稿后执行一次最终自动检查，因此不要牺牲剧情因果来机械凑指标。",
            options.reviewModel || options.model,
            options.reviewTemperature,
            {
              timeoutMs: options.rewriteTimeoutMs,
              networkRetries: 1,
              structureRetries: 1,
              maxCompletionTokens: modelTokenBudgets.episode,
            },
          );
          fullRewriteCount += 1;
          quality = assessStoryQuality(episode, options, episodeNumber, lexical, plan, episodePrevious);
          saveCheckpoint({
            index,
            stage: "semantic_rewritten",
            episode,
            quality,
            critique,
            fullRewriteCount,
            mechanicalRepairUsed,
            semanticRewriteUsed,
          });
          semanticReview = await reviewEpisodeSemantics(
            options,
            plan,
            episode,
            episodeNumber,
            episodePrevious,
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
          semanticIssues = semanticQualityIssues(semanticReview, firstEpisodeBaseline);
        }
        if (semanticIssues.length) {
          throw new Error(`第 ${episodeNumber} 集语义质量未达标：${semanticIssues.join("；")}`);
        }

        if (!passesStoryQualityFloor(quality, options.minLexicalCoverage) && !mechanicalRepairUsed) {
          if (fullRewriteCount >= 2) {
            throw new Error(
              `第 ${episodeNumber} 集已用完 2 次完整重写预算，最终结构与词汇仍未达标：${quality.issues.join("；")}`,
            );
          }
          reportProgress(
            options,
            "repairing",
            `第 ${episodeNumber} 集剧情已通过，正在进行第 ${fullRewriteCount + 1}/2 次完整重写（最终结构与词汇）`,
            episodeProgress(options, index, 0.84),
          );
          mechanicalRepairUsed = true;
          episode = await repairEpisode(
            options,
            plan,
            episode,
            episodeNumber,
            quality,
            episodePrevious,
          );
          fullRewriteCount += 1;
          quality = assessStoryQuality(episode, options, episodeNumber, lexical, plan, episodePrevious);
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
              throw new Error(`第 ${episodeNumber} 集最终结构修稿造成语义退化：${semanticIssues.join("；")}`);
            }
          }
        }

        if (!passesStoryQualityFloor(quality, options.minLexicalCoverage)) {
          throw new Error(
            `第 ${episodeNumber} 集最终结构与词汇修稿后仍未达标：${quality.issues.join("；")}`,
          );
        }
        if (!meetsQualityTarget(quality, options.minLexicalCoverage)) {
          options.log(
            `[${episodeNumber}/${options.episodes}] 高频词覆盖未达到 ${(options.minLexicalCoverage * 100).toFixed(0)}% 的优化目标，`
            + `但已达到 90% 发布底线，保留少量可查目标词并继续。`,
          );
        }
        reportProgress(
          options,
          "reviewing",
          `第 ${episodeNumber} 集正文已定稿，正在单独生成阅读题`,
          episodeProgress(options, index, 0.98),
        );
        let completedEpisode: GeneratedStoryEpisode | null = null;
        for (let questionAttempt = 1; questionAttempt <= 2; questionAttempt++) {
          const questions = await groundQuestions(options, episode, episodeNumber);
          const candidate = { ...episode, questions };
          const candidateQuality = assessStoryQuality(
            candidate,
            options,
            episodeNumber,
            lexical,
            plan,
            episodePrevious,
          );
          if (passesStoryQualityFloor(candidateQuality, options.minLexicalCoverage)) {
            completedEpisode = candidate;
            quality = candidateQuality;
            break;
          }
          options.log(
            `[${episodeNumber}/${options.episodes}] 第 ${questionAttempt}/2 次独立命题未通过证据检查：${candidateQuality.blockingIssues.join("；")}`,
          );
        }
        if (!completedEpisode) {
          throw new Error(`第 ${episodeNumber} 集正文已通过，但独立命题连续 2 次未通过原文证据检查`);
        }
        generated.push(completedEpisode);
        qualities.push(quality);
        semanticReviews.push(semanticReview);
        previousEpisode = completedEpisode;
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
        const coverage = quality.lexicalCoverage === null ? "未检测词频" : `高频词覆盖 ${(quality.lexicalCoverage * 100).toFixed(1)}%`;
        options.log(
          `[${episodeNumber}/${options.episodes}] ${completedEpisode.title} · ${quality.wordCount} 词 · ${coverage}`
          + ` · 结构质量 ${quality.score} · 语义均分 ${critiqueAverage(semanticReview).toFixed(1)}`,
        );
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
  const episodeCandidates = Number(
    from("episode-candidates", "STORY_EPISODE_CANDIDATES", "episodeCandidates")
      ?? defaultOptions.episodeCandidates,
  );
  if (!Number.isInteger(episodeCandidates) || episodeCandidates < 1 || episodeCandidates > 3) {
    throw new Error("episode-candidates 必须为 1-3 的整数");
  }
  const timeoutMs = Number(
    from("timeout-ms", "STORY_TIMEOUT_MS", "timeoutMs") ?? defaultOptions.timeoutMs,
  );
  if (!Number.isFinite(timeoutMs) || timeoutMs < 10_000 || timeoutMs > 600_000) {
    throw new Error("timeout-ms 必须为 10000-600000 之间的毫秒数");
  }
  const rewriteTimeoutMs = Number(
    from("rewrite-timeout-ms", "STORY_REWRITE_TIMEOUT_MS", "rewriteTimeoutMs")
      ?? defaultOptions.rewriteTimeoutMs,
  );
  if (!Number.isFinite(rewriteTimeoutMs) || rewriteTimeoutMs < 60_000 || rewriteTimeoutMs > 900_000) {
    throw new Error("rewrite-timeout-ms 必须为 60000-900000 之间的毫秒数");
  }
  const networkRetries = Number(
    from("network-retries", "STORY_NETWORK_RETRIES", "networkRetries")
      ?? fileConfig.maxRetries
      ?? defaultOptions.networkRetries,
  );
  if (!Number.isInteger(networkRetries) || networkRetries < 1 || networkRetries > 3) {
    throw new Error("network-retries 必须为 1-3 的整数");
  }
  const structureRetries = Number(
    from("structure-retries", "STORY_STRUCTURE_RETRIES", "structureRetries")
      ?? defaultOptions.structureRetries,
  );
  if (!Number.isInteger(structureRetries) || structureRetries < 1 || structureRetries > 3) {
    throw new Error("structure-retries 必须为 1-3 的整数");
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
    structureRepairModel: String(
      from("structure-repair-model", "STORY_STRUCTURE_REPAIR_MODEL", "structureRepairModel") ?? "",
    ),
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
    episodeCandidates,
    timeoutMs,
    rewriteTimeoutMs,
    networkRetries,
    structureRetries,
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
