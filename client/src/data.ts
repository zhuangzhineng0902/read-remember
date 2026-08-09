import { Article, Exam, ExamId, WordInfo } from "./types";

export const exams: Exam[] = [
  {
    id: "toefl",
    name: "托福 TOEFL",
    subtitle: "学术阅读与海外升学",
    level: "大学 · 留学",
    color: "#256A60",
  },
  {
    id: "toeic",
    name: "托业 TOEIC",
    subtitle: "职场与商务英语",
    level: "职场 · 商务",
    color: "#B97732",
  },
  {
    id: "high",
    name: "高中英语",
    subtitle: "高考阅读专项训练",
    level: "高一—高三",
    color: "#4F668C",
  },
  {
    id: "middle",
    name: "初中英语",
    subtitle: "中考阅读能力提升",
    level: "初一—初三",
    color: "#8A5B75",
  },
];

const passages = [
  {
    title: "The Quiet Power of Urban Trees",
    eyebrow: "ENVIRONMENT",
    body: [
      "On a summer afternoon, a street lined with mature trees can feel remarkably different from a bare road nearby. The leaves form a broad canopy that blocks sunlight, while water released from the leaves cools the surrounding air.",
      "Researchers have found that this cooling effect is more than a matter of comfort. Lower temperatures reduce the demand for air conditioning and can protect vulnerable residents during heat waves. Trees also capture rainwater and provide shelter for birds and insects.",
      "Yet planting a tree is only the beginning. Young trees require careful maintenance, and city planners must select species that can survive limited soil, pollution, and changing weather. A successful urban forest is therefore a long-term public investment.",
    ],
    questions: [
      {
        prompt: "What is the main purpose of the passage?",
        options: [
          "To compare several tree species",
          "To explain the benefits and challenges of urban trees",
          "To criticize the use of air conditioning",
          "To describe a single research project",
        ],
        answer: 1,
        explanation:
          "文章先介绍城市树木的降温及生态价值，随后说明养护与规划挑战。",
      },
      {
        prompt: "The word “vulnerable” is closest in meaning to:",
        options: [
          "easily harmed",
          "well prepared",
          "highly active",
          "deeply interested",
        ],
        answer: 0,
        explanation:
          "在热浪语境中，vulnerable residents 指更容易受到伤害的居民。",
      },
    ],
  },
  {
    title: "Why We Remember What We Teach",
    eyebrow: "LEARNING SCIENCE",
    body: [
      "Students often believe that rereading is the safest way to remember new material. However, learning becomes more durable when students try to explain an idea without looking at their notes.",
      "The act of teaching forces the learner to organize scattered facts into a coherent structure. It also reveals gaps in understanding. When an explanation becomes confusing, the learner knows exactly which part deserves another look.",
      "This method does not require a real audience. Speaking to an empty chair or writing a short lesson can produce a similar result. The important step is to retrieve the idea and express it in clear language.",
    ],
    questions: [
      {
        prompt: "According to the passage, teaching helps memory because it:",
        options: [
          "takes less time than reading",
          "removes the need for notes",
          "organizes knowledge and exposes gaps",
          "provides a real audience",
        ],
        answer: 2,
        explanation: "第二段明确指出，讲解会组织零散事实，并暴露理解中的空白。",
      },
      {
        prompt: "What can be inferred about the method?",
        options: [
          "It works only in groups",
          "It depends on clear retrieval and expression",
          "It is unsuitable for difficult topics",
          "It replaces all other study methods",
        ],
        answer: 1,
        explanation: "最后一句强调关键是提取知识并清晰表达。",
      },
    ],
  },
  {
    title: "A Library Without Late Fees",
    eyebrow: "SOCIETY",
    body: [
      "Several public libraries have stopped charging late fees. At first, critics feared that readers would keep books indefinitely and that library shelves would become empty.",
      "Instead, many libraries reported that long-overdue books were returned and former members began borrowing again. Small fines had created a psychological barrier, especially for families who could not easily pay them.",
      "The policy does not mean that books have no value. Borrowers may still be charged for items that are lost. The goal is to encourage access while preserving a shared public resource.",
    ],
    questions: [
      {
        prompt: "Why did some libraries remove late fees?",
        options: [
          "To sell more books",
          "To increase access to library services",
          "To reduce staff numbers",
          "To shorten borrowing periods",
        ],
        answer: 1,
        explanation: "末段点明目标是鼓励公众使用图书馆资源。",
      },
      {
        prompt: "What happened after the change?",
        options: [
          "All books disappeared",
          "Membership declined",
          "Some overdue books came back",
          "Lost books became free",
        ],
        answer: 2,
        explanation: "第二段说明许多长期逾期的书被归还。",
      },
    ],
  },
  {
    title: "The Return of the Night Train",
    eyebrow: "TRAVEL",
    body: [
      "Night trains once connected major cities across Europe, but many routes disappeared as low-cost airlines expanded. Recently, travelers have shown renewed interest in sleeping their way across the continent.",
      "Supporters point to the convenience of leaving a city center in the evening and arriving in another the next morning. The journey can also produce fewer carbon emissions than a short flight.",
      "Operating the service remains complicated. Carriages are expensive, international schedules must be coordinated, and each train carries fewer passengers than a daytime service. Even so, new routes continue to appear.",
    ],
    questions: [
      {
        prompt: "What advantage of night trains is mentioned?",
        options: [
          "They always cost less",
          "They carry more passengers",
          "They connect airports directly",
          "They can reduce travel emissions",
        ],
        answer: 3,
        explanation: "第二段提到夜间列车的碳排放可能低于短途航班。",
      },
      {
        prompt: "Why are night trains difficult to operate?",
        options: [
          "Passengers dislike sleeping",
          "They require costly equipment and coordination",
          "Cities prohibit evening departures",
          "Day trains use the same stations",
        ],
        answer: 1,
        explanation: "第三段列举了车厢昂贵、跨国时刻协调等运营难点。",
      },
    ],
  },
  {
    title: "Small Gardens, Big Changes",
    eyebrow: "COMMUNITY",
    body: [
      "A neglected piece of land between two apartment buildings may seem useless. In many neighborhoods, however, residents have transformed such spaces into community gardens.",
      "The vegetables are valuable, but the social effects can be even greater. People who once passed without speaking begin to exchange advice, tools, and recipes. Children observe how food grows and older residents share practical knowledge.",
      "Community gardens still need clear agreements. Members must decide how to divide work, pay for water, and share the harvest. When these rules are created together, the garden often becomes a source of local pride.",
    ],
    questions: [
      {
        prompt: "The author suggests the greatest value may be:",
        options: [
          "cheaper apartments",
          "larger harvests",
          "stronger social connections",
          "professional farming jobs",
        ],
        answer: 2,
        explanation: "第二段强调社区花园带来的社会联系可能比蔬菜本身更重要。",
      },
      {
        prompt: "What helps a garden succeed?",
        options: [
          "Rules made together",
          "No division of work",
          "Private ownership",
          "Removing older members",
        ],
        answer: 0,
        explanation: "最后一句指出，共同制定规则有助于社区花园成为骄傲。",
      },
    ],
  },
  {
    title: "Listening to the Ocean Floor",
    eyebrow: "SCIENCE",
    body: [
      "The deep ocean is dark, cold, and difficult to observe. Scientists therefore use sound to learn what happens far below the surface. Underwater microphones can remain in place for months and collect continuous data.",
      "These recordings reveal whale calls, volcanic activity, storms, and even the noise of distant ships. By comparing patterns over time, researchers can track migration and notice changes in an ecosystem.",
      "The volume of data creates a new challenge. A single instrument may record thousands of hours of sound. Computer programs help identify unusual events, but human experts are still needed to interpret what those signals mean.",
    ],
    questions: [
      {
        prompt: "Why do scientists use underwater microphones?",
        options: [
          "Light travels quickly underwater",
          "The deep ocean is hard to observe directly",
          "Whales avoid research ships",
          "The devices prevent storms",
        ],
        answer: 1,
        explanation: "首段说明深海难以直接观察，因此研究者使用声音。",
      },
      {
        prompt: "What challenge is described in the final paragraph?",
        options: [
          "Too much recorded information",
          "No recognizable signals",
          "A lack of ocean sounds",
          "Microphones that move too fast",
        ],
        answer: 0,
        explanation: "每台设备可能产生数千小时录音，数据规模本身成为挑战。",
      },
    ],
  },
];

export const articles: Article[] = (
  ["toefl", "toeic", "high", "middle"] as ExamId[]
).flatMap((examId, examIndex) =>
  passages.map((passage, index) => ({
    id: `${examId}-${index + 1}`,
    examId,
    year: 2025 - ((index + examIndex) % 5),
    title: passage.title,
    eyebrow: passage.eyebrow,
    readMinutes: 5 + (index % 4),
    difficulty: Math.min(5, 2 + ((index + examIndex) % 4)),
    paragraphs: passage.body,
    questions: passage.questions,
  })),
);

const vocabulary: Record<string, [string, string]> = {
  mature: ["/məˈtʃʊr/", "成熟的"],
  canopy: ["/ˈkænəpi/", "树冠；顶篷"],
  remarkably: ["/rɪˈmɑːrkəbli/", "显著地"],
  surrounding: ["/səˈraʊndɪŋ/", "周围的"],
  vulnerable: ["/ˈvʌlnərəbl/", "脆弱的；易受伤害的"],
  capture: ["/ˈkæptʃər/", "收集；捕获"],
  maintenance: ["/ˈmeɪntənəns/", "维护；保养"],
  species: ["/ˈspiːʃiːz/", "物种；种类"],
  pollution: ["/pəˈluːʃn/", "污染"],
  durable: ["/ˈdʊrəbl/", "持久的"],
  coherent: ["/koʊˈhɪrənt/", "连贯的"],
  scattered: ["/ˈskætərd/", "零散的"],
  retrieve: ["/rɪˈtriːv/", "提取；找回"],
  indefinitely: ["/ɪnˈdefɪnətli/", "无限期地"],
  barrier: ["/ˈbæriər/", "障碍"],
  preserve: ["/prɪˈzɜːrv/", "保护；保存"],
  emissions: ["/ɪˈmɪʃənz/", "排放物"],
  coordinated: ["/koʊˈɔːrdɪneɪtɪd/", "协调的"],
  neglected: ["/nɪˈɡlektɪd/", "被忽视的"],
  transformed: ["/trænsˈfɔːrmd/", "转变；改造"],
  harvest: ["/ˈhɑːrvɪst/", "收获"],
  continuous: ["/kənˈtɪnjuəs/", "连续的"],
  reveal: ["/rɪˈviːl/", "揭示"],
  migration: ["/maɪˈɡreɪʃn/", "迁徙"],
  ecosystem: ["/ˈiːkoʊsɪstəm/", "生态系统"],
  interpret: ["/ɪnˈtɜːrprɪt/", "解释；理解"],
  instrument: ["/ˈɪnstrəmənt/", "仪器"],
};

export function lookupWord(raw: string): WordInfo {
  const word = raw.toLowerCase().replace(/[^a-z'-]/g, "");
  const entry = vocabulary[word];
  return {
    word,
    phonetic: entry?.[0] ?? "/ pronunciation /",
    translation: entry?.[1] ?? "点击加入生词库，稍后完善释义",
  };
}

export const getExam = (id: ExamId) => exams.find((item) => item.id === id)!;

export function getDailyArticles(
  examId: ExamId,
  date = new Date(),
  excludedIds: string[] = [],
): Article[] {
  const pool = articles.filter((item) => item.examId === examId);
  const dayIndex = Math.floor(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000,
  );
  const start = (dayIndex * 3) % Math.max(1, pool.length);
  const rotated = [...pool.slice(start), ...pool.slice(0, start)];
  // Delivered items never enter the result again. The production API can keep
  // this unseen pool replenished as the local demo corpus runs low.
  return rotated.filter((item) => !excludedIds.includes(item.id)).slice(0, 3);
}
