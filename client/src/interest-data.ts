import type {
  Article,
  ExamId,
  InterestCategory,
  InterestId,
  Question,
} from "./types";
import { generateInterestCorpus } from "./interest-corpus";

export const interestCategories: InterestCategory[] = [
  {
    id: "military",
    name: "军事科技",
    subtitle: "雷达、工程、导航与历史",
    emoji: "🛡️",
    color: "#536B60",
    activityPrompt: "任务：用 3 个英文关键词说明这项技术解决了什么问题。",
  },
  {
    id: "art",
    name: "画画与设计",
    subtitle: "透视、色彩、光影与创作",
    emoji: "🎨",
    color: "#B66A55",
    activityPrompt: "动手画：根据文章画一个小练习，并用英文标注 3 个细节。",
  },
  {
    id: "science",
    name: "科普知识",
    subtitle: "自然、动物与地球科学",
    emoji: "🔬",
    color: "#45758C",
    activityPrompt: "小小讲解员：不用看原文，用两句话把科学原理讲给家人听。",
  },
  {
    id: "why",
    name: "十万个为什么",
    subtitle: "从日常问题发现科学答案",
    emoji: "💡",
    color: "#B4833E",
    activityPrompt: "先猜后答：合上文章说出原因，再回来检查遗漏了哪个关键词。",
  },
  {
    id: "fantasy",
    name: "奇幻冒险",
    subtitle: "原创连续故事与神秘任务",
    emoji: "🗺️",
    color: "#745F91",
    activityPrompt: "剧情预测：用一句英文写下你认为下一章会发生什么。",
  },
];

export const defaultInterestIds = interestCategories.map(
  (category) => category.id,
);

export const interestSourceGuides: Record<
  InterestId,
  { name: string; url: string | null }
> = {
  military: {
    name: "原创选题 · National Army Museum / IWM Education",
    url: "https://www.nam.ac.uk/subjects/technology",
  },
  art: {
    name: "原创选题 · Smithsonian Art Education",
    url: "https://www.si.edu/educators/art-resources",
  },
  science: {
    name: "原创选题 · NASA Science Education",
    url: "https://science.nasa.gov/learn/resources/learn-with-nasa/",
  },
  why: {
    name: "原创选题 · NOAA Education",
    url: "https://www.noaa.gov/education",
  },
  fantasy: {
    name: "拾词原创连续故事",
    url: null,
  },
};

type InterestPassage = {
  slug: string;
  interestId: InterestId;
  title: string;
  eyebrow: string;
  readMinutes: number;
  difficulty: number;
  seriesTitle?: string;
  episodeNumber?: number;
  paragraphs: string[];
  questions: Question[];
};

const passages: InterestPassage[] = [
  {
    slug: "radar-sees-far-away",
    interestId: "military",
    title: "How Radar Sees Far Away",
    eyebrow: "MILITARY TECHNOLOGY",
    readMinutes: 4,
    difficulty: 2,
    paragraphs: [
      "A radar station does not use eyes to watch the sky. It sends out short waves of energy. These waves travel very fast. When they hit an object, such as an airplane, part of the energy comes back to the station.",
      "A computer measures how long the trip takes. Because the waves move at a known speed, the computer can work out the distance. It also checks the direction of the returning signal. In this way, radar can show where an object is moving even at night or behind clouds.",
      "Radar is not only used by the military. Airports use it to guide planes safely, weather stations use it to follow storms, and ships use it when fog hides the sea ahead.",
    ],
    questions: [
      {
        prompt: "How does radar find the distance of an object?",
        options: [
          "By measuring the travel time of waves",
          "By taking a photograph",
          "By listening to the pilot",
          "By measuring the object's color",
        ],
        answer: 0,
        explanation: "雷达根据波发出并返回所用的时间计算距离。",
      },
      {
        prompt: "Which civilian use of radar is mentioned?",
        options: [
          "Growing vegetables",
          "Drawing maps by hand",
          "Following storms",
          "Building engines",
        ],
        answer: 2,
        explanation: "第三段提到气象站使用雷达追踪风暴。",
      },
    ],
  },
  {
    slug: "patterns-that-hide",
    interestId: "military",
    title: "Patterns That Help Things Hide",
    eyebrow: "CAMOUFLAGE SCIENCE",
    readMinutes: 4,
    difficulty: 2,
    paragraphs: [
      "A green coat may seem useful in a forest, but one flat color can still be easy to see. Nature shows a better idea. Tigers, leopards, and many insects use lines or spots that break up the clear shape of their bodies.",
      "Camouflage patterns work in a similar way. Dark and light areas make it harder for the eye to find the edge of an object. The colors must also match the place. A pattern for dry land will not work well in snow or beside the sea.",
      "Modern designers study light, distance, cameras, and even heat. Their goal is not to make an object truly disappear. Good camouflage simply gives an observer less useful information and more time to make a mistake.",
    ],
    questions: [
      {
        prompt: "Why are patterns often better than one flat color?",
        options: [
          "They make objects warmer",
          "They break up the object's shape",
          "They are cheaper to paint",
          "They can change the weather",
        ],
        answer: 1,
        explanation: "深浅图案会打破物体清晰的轮廓，使其更难辨认。",
      },
      {
        prompt: "What is the real goal of camouflage?",
        options: [
          "To become completely invisible",
          "To look beautiful",
          "To give an observer less useful information",
          "To copy only tiger stripes",
        ],
        answer: 2,
        explanation: "最后一段说明伪装并非真正隐身，而是减少观察者获得的有效信息。",
      },
    ],
  },
  {
    slug: "artists-create-depth",
    interestId: "art",
    title: "How Artists Create Depth",
    eyebrow: "DRAWING SKILLS",
    readMinutes: 4,
    difficulty: 2,
    paragraphs: [
      "A sheet of paper is flat, yet a good drawing can look deep. Artists create this feeling with several simple clues. One clue is size: if two trees are really the same size, the smaller tree usually looks farther away.",
      "Another clue is overlap. When one object covers part of another, our brain decides that the first object is closer. Lines can help too. In a drawing of a road, the two sides seem to move toward the same point in the distance. This is called perspective.",
      "You can test these ideas quickly. Draw three boxes. Make each one smaller, place it a little higher, and let one box cover another. Without adding any color, your flat paper will already begin to look like a space you could enter.",
    ],
    questions: [
      {
        prompt: "What does a smaller tree usually appear to be?",
        options: ["Brighter", "Farther away", "Older", "Heavier"],
        answer: 1,
        explanation: "在画面中，同样大小的物体画得越小，通常显得越远。",
      },
      {
        prompt: "What is perspective used to create?",
        options: [
          "A feeling of depth",
          "A louder sound",
          "A softer pencil",
          "A new color",
        ],
        answer: 0,
        explanation: "透视利用线条等线索在平面上制造空间深度。",
      },
    ],
  },
  {
    slug: "light-and-shadow",
    interestId: "art",
    title: "The Secret Job of Light and Shadow",
    eyebrow: "ART STUDIO",
    readMinutes: 4,
    difficulty: 2,
    paragraphs: [
      "When beginners draw a ball, they often color one half dark and leave the other half white. Real light is more gradual. The brightest point faces the light, while the surface slowly becomes darker as it turns away.",
      "A ball also creates a shadow on the table. This shadow tells us where the light comes from and how close the ball is to the table. Near the ball, the shadow is usually darker. Farther away, its edge may become softer.",
      "Artists often practice with only one lamp and one simple object. They look carefully before drawing. By learning to see small changes between light and dark, they can make ordinary shapes feel solid and real.",
    ],
    questions: [
      {
        prompt: "What happens as a round surface turns away from light?",
        options: [
          "It slowly becomes darker",
          "It becomes larger",
          "It loses its shadow",
          "It changes its material",
        ],
        answer: 0,
        explanation: "球面转离光源时，明暗会逐渐过渡，而不是突然分成两半。",
      },
      {
        prompt: "Why do artists study the shadow on the table?",
        options: [
          "It shows information about the light and object",
          "It makes the lamp brighter",
          "It changes the paper color",
          "It removes the need to observe",
        ],
        answer: 0,
        explanation: "投影能够说明光源方向以及物体和桌面的距离关系。",
      },
    ],
  },
  {
    slug: "ocean-moving-belt",
    interestId: "science",
    title: "The Ocean's Moving Belt",
    eyebrow: "EARTH SCIENCE",
    readMinutes: 5,
    difficulty: 3,
    paragraphs: [
      "Ocean water is always moving. Winds push water across the surface, but a slower system also travels through the deep sea. Cold, salty water is heavier than warm water, so it sinks in some parts of the world.",
      "As deep water moves away, other water takes its place. Over many years, this creates a huge loop that connects different oceans. Scientists sometimes compare it to a moving belt. The loop carries heat, oxygen, and food for tiny sea life.",
      "Changes in temperature or ice can affect this movement. That is why scientists measure the salt and heat of ocean water. Understanding the deep current helps them study weather, sea life, and long-term changes on Earth.",
    ],
    questions: [
      {
        prompt: "Why does cold, salty water sink?",
        options: [
          "It is heavier",
          "It has more light",
          "Wind pulls it down",
          "Fish carry it",
        ],
        answer: 0,
        explanation: "第一段指出冷而咸的海水密度更大，因此会下沉。",
      },
      {
        prompt: "What does the deep-ocean loop carry?",
        options: [
          "Only ships",
          "Heat, oxygen, and food",
          "Sand from every beach",
          "Fresh water only",
        ],
        answer: 1,
        explanation: "第二段列出了热量、氧气和微小海洋生物的食物。",
      },
    ],
  },
  {
    slug: "bees-share-directions",
    interestId: "science",
    title: "How Bees Share Directions",
    eyebrow: "ANIMAL SCIENCE",
    readMinutes: 4,
    difficulty: 3,
    paragraphs: [
      "When a honeybee finds many flowers, it returns to the hive with useful news. The bee cannot draw a map, so it moves in a special pattern called a waggle dance.",
      "The direction of the dance tells other bees which way to fly compared with the sun. The length of the moving part gives information about distance. A longer waggle usually means the flowers are farther away.",
      "The dance is not the only clue. The returning bee also carries the smell of the flowers. Other bees combine the movement, smell, and sunlight to find the food. This small animal communication system is both simple and surprisingly exact.",
    ],
    questions: [
      {
        prompt: "What does the length of the waggle show?",
        options: [
          "The flower's color",
          "The distance to food",
          "The number of bees",
          "The time of night",
        ],
        answer: 1,
        explanation: "摇摆部分持续得越长，通常表示食物距离越远。",
      },
      {
        prompt: "Which clue is also carried back to the hive?",
        options: ["The smell of flowers", "A small map", "A leaf", "Rainwater"],
        answer: 0,
        explanation: "第三段说明蜜蜂还会带回花朵的气味。",
      },
    ],
  },
  {
    slug: "why-sky-blue",
    interestId: "why",
    title: "Why Is the Sky Blue?",
    eyebrow: "A BIG WHY",
    readMinutes: 4,
    difficulty: 2,
    paragraphs: [
      "Sunlight may look white, but it contains many colors. When sunlight enters Earth's air, it meets tiny gas particles. The particles send some of the light in many different directions.",
      "Blue light has shorter waves than red light, so it is scattered more easily. During the day, blue light reaches our eyes from every part of the sky. This makes the sky look blue even when we are not looking toward the sun.",
      "At sunset, sunlight travels through more air before it reaches us. Much of the blue light is scattered away. More red and orange light remains on the direct path, so the sky near the setting sun often turns warm colors.",
    ],
    questions: [
      {
        prompt: "Why does the daytime sky look blue?",
        options: [
          "Blue light is scattered easily",
          "The ocean reflects all its color",
          "Air is naturally blue paint",
          "Red light moves faster",
        ],
        answer: 0,
        explanation: "蓝光波长较短，更容易被空气中的微粒散射到各个方向。",
      },
      {
        prompt: "Why are sunsets often red or orange?",
        options: [
          "The sun becomes cooler",
          "More blue light has been scattered away",
          "Clouds create new colors",
          "The moon pushes red light down",
        ],
        answer: 1,
        explanation: "日落时光穿过更多空气，蓝光大量散射后，红橙光更明显。",
      },
    ],
  },
  {
    slug: "why-we-yawn",
    interestId: "why",
    title: "Why Do We Yawn?",
    eyebrow: "A BIG WHY",
    readMinutes: 4,
    difficulty: 2,
    paragraphs: [
      "Everyone yawns, but scientists still discuss exactly why it happens. People often yawn when they are tired or bored. However, a yawn is not simply the body's way of getting more oxygen, as many people once believed.",
      "One idea is that yawning helps the brain change its level of attention. A deep breath, a wide mouth, and a stretch of the face happen together. This may help the body move from one state to another, such as from sleepiness to being alert.",
      "Yawning is also catching. Seeing, hearing, or even reading about a yawn can make another person yawn. This effect may be connected with the way humans notice and copy the feelings or actions of people around them.",
    ],
    questions: [
      {
        prompt: "Which old explanation does the passage question?",
        options: [
          "Yawning gets more oxygen",
          "Yawning can be catching",
          "Tired people often yawn",
          "The face stretches during a yawn",
        ],
        answer: 0,
        explanation: "首段指出“打哈欠只是为了获得更多氧气”是过去的常见观点。",
      },
      {
        prompt: "What may yawning help the brain do?",
        options: [
          "Forget all sounds",
          "Change its level of attention",
          "See in the dark",
          "Stop needing sleep",
        ],
        answer: 1,
        explanation: "第二段提出打哈欠可能帮助大脑调整注意和清醒状态。",
      },
    ],
  },
  {
    slug: "map-drew-itself",
    interestId: "fantasy",
    title: "The Map That Drew Itself",
    eyebrow: "FANTASY ADVENTURE",
    readMinutes: 5,
    difficulty: 2,
    seriesTitle: "The Lantern Library",
    episodeNumber: 1,
    paragraphs: [
      "Leo stayed late in the school art room to finish a drawing. When he opened an old wooden box for a ruler, he found a blank piece of paper. The moment his pencil touched it, a silver line appeared by itself.",
      "The line became a map of the school. One room was marked with a tiny blue lantern, but Leo had never seen that room before. Under the map, three words slowly formed: Find it tonight.",
      "Leo called his friend Mina, who loved solving puzzles. They followed the map to the library. Behind the last shelf, the blue lantern symbol began to shine. Then the shelf moved a few centimeters, and cold air came through the narrow opening.",
    ],
    questions: [
      {
        prompt: "What happened when Leo touched the paper with his pencil?",
        options: [
          "The pencil broke",
          "A silver line appeared",
          "The box disappeared",
          "The lights went out",
        ],
        answer: 1,
        explanation: "第一段写到铅笔碰到纸时，一条银色线条自行出现。",
      },
      {
        prompt: "Why did Leo call Mina?",
        options: [
          "She knew the art teacher",
          "She loved solving puzzles",
          "She owned the wooden box",
          "She wanted a new ruler",
        ],
        answer: 1,
        explanation: "Mina 喜欢解谜，所以 Leo 请她一起寻找地图上的房间。",
      },
    ],
  },
  {
    slug: "door-beneath-library",
    interestId: "fantasy",
    title: "The Door Beneath the Library",
    eyebrow: "FANTASY ADVENTURE",
    readMinutes: 5,
    difficulty: 3,
    seriesTitle: "The Lantern Library",
    episodeNumber: 2,
    paragraphs: [
      "Leo and Mina pushed the shelf until the opening was wide enough. Stone steps led down into darkness. The map gave off a weak silver light, so they used it like a lamp.",
      "At the bottom, they found a round door with five empty spaces. Each space had the shape of a common object: a leaf, a key, a feather, a coin, and a drop of water. Above the door were the words: Choose what can travel without feet.",
      "Mina studied the shapes. A leaf could travel on the wind, and water could travel in a river. But the puzzle asked for only one answer. Suddenly, they heard a soft turning sound behind the door. Someone—or something—was waiting on the other side.",
    ],
    questions: [
      {
        prompt: "How did the children use the map on the stairs?",
        options: [
          "As a lamp",
          "As a key",
          "As a blanket",
          "As a step",
        ],
        answer: 0,
        explanation: "地图发出银色微光，因此他们把它当作灯使用。",
      },
      {
        prompt: "What made the puzzle difficult?",
        options: [
          "None of the objects could move",
          "More than one shape seemed possible",
          "The words were in another language",
          "The door had no empty spaces",
        ],
        answer: 1,
        explanation: "叶子和水都可能“没有脚也能旅行”，但谜题只允许一个答案。",
      },
    ],
  },
];

const examIds: ExamId[] = ["toefl", "ielts", "toeic", "high", "middle"];

export const interestArticles: Article[] = examIds.flatMap((examId) =>
  [...passages, ...generateInterestCorpus(examId)].map((passage) => ({
    id: `${examId}-interest-${passage.slug}`,
    examId,
    year: 2026,
    title: passage.title,
    eyebrow: passage.eyebrow,
    readMinutes: passage.readMinutes,
    difficulty: passage.difficulty,
    contentKind: "interest" as const,
    interestId: passage.interestId,
    seriesTitle: passage.seriesTitle ?? null,
    episodeNumber: passage.episodeNumber ?? null,
    paragraphs: passage.paragraphs,
    questions: passage.questions,
  })),
);

export function getInterestCategory(id?: InterestId | null) {
  return interestCategories.find((category) => category.id === id);
}

export function getInterestArticles(
  examId: ExamId,
  selected: InterestId[] = defaultInterestIds,
) {
  return interestArticles.filter(
    (article) =>
      article.examId === examId &&
      article.interestId &&
      selected.includes(article.interestId),
  );
}
