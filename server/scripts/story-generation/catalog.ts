type CraftOptions = {
  interest: string;
  sourceMode: StorySourceMode;
  classicId: ClassicSourceId | "";
  sourceTitle: string;
  sourceNotes: string;
  customInterestName: string;
  customInterestPrompt: string;
};

export const storyInterestIds = [
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
export type StoryInterestId = string;

export const sourceModes = ["original", "classic", "favorite"] as const;
export type StorySourceMode = (typeof sourceModes)[number];

export const readerStageIds = ["auto", "starter", "stage1", "stage2", "stage3", "stage4", "stage5", "stage6"] as const;
export type ReaderStageId = (typeof readerStageIds)[number];

export const classicSourceIds = [
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

export const classicSources: Record<
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
  options: Pick<CraftOptions, "interest" | "sourceMode" | "classicId" | "sourceTitle" | "sourceNotes">,
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

export const readerStages = {
  starter: { label: "Starter", headwords: 250, cefr: "A1", maxNewWords: 4 },
  stage1: { label: "Stage 1", headwords: 400, cefr: "A1-A2", maxNewWords: 5 },
  stage2: { label: "Stage 2", headwords: 700, cefr: "A2-B1", maxNewWords: 6 },
  stage3: { label: "Stage 3", headwords: 1000, cefr: "B1", maxNewWords: 7 },
  stage4: { label: "Stage 4", headwords: 1400, cefr: "B1-B2", maxNewWords: 8 },
  stage5: { label: "Stage 5", headwords: 1800, cefr: "B2", maxNewWords: 8 },
  stage6: { label: "Stage 6", headwords: 2500, cefr: "B2-C1", maxNewWords: 8 },
} as const;
export type ResolvedReaderStageId = keyof typeof readerStages;

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

export function storyGuideFor(
  options: Pick<CraftOptions, "interest"> &
    Partial<
      Pick<CraftOptions, "customInterestName" | "customInterestPrompt">
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

