import type { ExamId, InterestId, Question } from "./types";

export type StorySeriesPassage = {
  slug: string;
  interestId: InterestId;
  title: string;
  eyebrow: string;
  readMinutes: number;
  difficulty: number;
  seriesTitle: string;
  episodeNumber: number;
  paragraphs: string[];
  questions: Question[];
};

type StoryEpisode = {
  slug: string;
  title: string;
  paragraphs: [string, string, string];
  answer: string;
  distractors: [string, string, string];
  clue: string;
};

type StorySeries = {
  id: "mecha" | "cultivation" | "tiger" | "cat";
  title: string;
  eyebrow: string;
  episodes: StoryEpisode[];
};

const storySeries: StorySeries[] = [
  {
    id: "mecha",
    title: "Starforge Team 7",
    eyebrow: "ORIGINAL MECHA ADVENTURE",
    episodes: [
      {
        slug: "mecha-voice-in-hangar",
        title: "The Voice in the Empty Hangar",
        paragraphs: [
          "Lin found the old training robot while hiding from another boring safety lecture. Its blue eye opened and said, “Pilot accepted.” Lin dropped his snack. The snack landed on the robot's head, which was not the heroic beginning either of them had expected.",
          "His friends May and Jo arrived before Lin could run away. May noticed fresh dust around the robot's feet. Jo found a tiny star symbol under the seat. The same symbol appeared on a missing ship shown in the academy museum.",
          "The three friends agreed to tell their teacher—but the hangar doors locked first. A map lit up inside the robot, showing a route beyond the moon. Then a fourth name appeared beside theirs: UNKNOWN PILOT. Someone else was already connected to the machine.",
        ],
        answer: "A star symbol linked the robot to a missing ship",
        distractors: ["The robot asked for a snack", "The teacher opened the doors", "Jo had built the robot"],
        clue: "星形标记把旧机器人与失踪飞船联系起来。",
      },
      {
        slug: "mecha-zero-gravity-test",
        title: "The Zero-Gravity Team Test",
        paragraphs: [
          "Team 7 entered the robot together because no single seat controlled everything. Lin could move the arms, May read the sensors, and Jo controlled the feet. Their first step sent the robot gently into a wall. “Excellent,” Jo said. “We have discovered the wall.”",
          "The next test placed them in a room with no gravity. Lin wanted to use full power, but May saw small arrows hidden among the stars on the ceiling. Jo turned the robot one careful degree at a time while Lin used short bursts from its hands.",
          "They reached the exit without breaking anything expensive. Almost. A loose panel floated past them, carrying a message scratched inside: DO NOT TRUST THE FOURTH SIGNAL. Before they could read more, the unknown pilot took control of the robot's left hand.",
        ],
        answer: "They combined sensors, careful turning, and short power bursts",
        distractors: ["Lin used full power alone", "They waited for gravity to return", "They followed the unknown pilot"],
        clue: "三个人分工合作，才通过失重测试。",
      },
      {
        slug: "mecha-hand-that-waved",
        title: "The Hand That Waved by Itself",
        paragraphs: [
          "The robot's left hand waved at the observation window. No one from Team 7 had moved it. On the other side of the glass, Headmaster Rook stopped smiling. He ended the test and ordered everyone out—except the robot refused to open.",
          "May compared the strange signal with the academy clock. It arrived every thirteen seconds. Jo turned the timing into dots and lines. Lin, who was usually terrible at waiting, finally saw the pattern: it was not a command. It was a message asking for help.",
          "They sent the same pattern back. A hidden compartment opened beneath the floor and revealed a damaged memory crystal. It showed the missing ship flying into a red storm. In the final image, Headmaster Rook stood on its bridge.",
        ],
        answer: "The repeated signal was a request for help",
        distractors: ["The signal told them to attack", "The robot needed more power", "The academy clock was broken"],
        clue: "十三秒一次的规律信号其实是一条求救信息。",
      },
      {
        slug: "mecha-red-storm",
        title: "Into the Red Storm",
        paragraphs: [
          "Team 7 was forbidden to leave the academy, so naturally they spent lunch discussing the safest way to disobey. May rejected eleven bad plans. Jo rejected Lin's plan because “painting ourselves the color of space” was not a real form of invisibility.",
          "They finally asked their teacher for help and showed her the memory crystal. Instead of punishing them, she unlocked a small rescue ship. She had served on the missing ship too, but had never known that part of its memory survived.",
          "Inside the red storm, every sensor showed a different direction. The friends could only navigate by comparing what each person saw. Then the unknown signal became clear: it came from a silent giant drifting ahead—and the giant opened its eyes.",
        ],
        answer: "They earned help by sharing the evidence with their teacher",
        distractors: ["They painted the ship black", "They stole a giant robot", "They ignored every sensor"],
        clue: "把证据告诉可信赖的大人，为他们赢得了真正的支援。",
      },
      {
        slug: "mecha-giant-choice",
        title: "The Giant's Impossible Choice",
        paragraphs: [
          "The giant machine was protecting a damaged station, not preparing to attack. Its power was almost gone. It could save the station or guide Team 7 through the storm, but not both. Lin wanted to stay and help. May reminded him that brave choices still needed a plan.",
          "Jo discovered that their three smaller power cells could be linked for exactly four minutes. Team 7 shared the risk: May timed the transfer, Jo repaired the cable, and Lin held both machines steady while the storm shook them.",
          "The station lights returned. The giant pointed toward a dark opening in the storm, then gave Team 7 the missing ship's final location. The coordinates were inside the academy itself. Someone had hidden the truth at home all along.",
        ],
        answer: "They linked their power cells and shared the risky task",
        distractors: ["They ordered the giant to leave", "Lin acted without a plan", "They turned off the station"],
        clue: "他们用分工和共享风险解决了看似只能二选一的问题。",
      },
      {
        slug: "mecha-fourth-pilot",
        title: "The Fourth Pilot",
        paragraphs: [
          "Back at the academy, Team 7 followed the coordinates beneath the museum. They found the missing ship folded inside a secret space. Headmaster Rook was waiting there, but he was not alone. A small service robot rolled out and introduced itself as Pilot Four.",
          "Pilot Four had sent every warning. Rook had hidden the ship because its engine could tear open unstable paths through space. He feared that even good pilots might use it before understanding the cost. May asked the question no one else had asked: why not trust a team with the truth?",
          "Rook unlocked the ship, but only after Team 7 promised that every journey would require a shared decision. The star map expanded across the room. One point flashed far beyond the red storm, where a message waited: TEAM 7, YOU ARE LATE.",
        ],
        answer: "Pilot Four was the service robot sending warnings",
        distractors: ["Headmaster Rook was the unknown attacker", "May had sent the signal", "The missing ship had no engine"],
        clue: "第四位驾驶员并不是敌人，而是一直求助和提醒他们的机器人。",
      },
    ],
  },
  {
    id: "cultivation",
    title: "The Small Cloud Sect",
    eyebrow: "ORIGINAL XIANXIA MYSTERY",
    episodes: [
      {
        slug: "cultivation-sword-that-sneezed",
        title: "The Sword That Sneezed",
        paragraphs: [
          "An Yu chose the oldest sword in the Small Cloud Sect because nobody else wanted it. The moment she touched the handle, the sword sneezed and blew dust into Elder Pine's tea. Her friend Mo tried not to laugh. The tea did not show the same kindness.",
          "The sword could not fly straight, but it pointed toward lies. During the entrance test, it pulled An Yu and Mo away from the marked path. They found a wounded crane beside a stone covered with fresh footprints.",
          "Helping the crane made them late, yet Elder Pine did not fail them. He asked why the stone was warm in winter. When An Yu placed the sword near it, a hidden stairway opened and a voice below whispered her name.",
        ],
        answer: "They stopped to help a wounded crane",
        distractors: ["They followed the marked path", "They drank Elder Pine's tea", "They made the stone cold"],
        clue: "两人宁可迟到也先帮助受伤的仙鹤。",
      },
      {
        slug: "cultivation-library-under-well",
        title: "The Library Under the Well",
        paragraphs: [
          "The stairway led to a library under an empty well. Its books had no words until someone asked an honest question. Mo asked how to become powerful. Every page stayed blank. An Yu asked how to help the crane, and one book opened by itself.",
          "The book described a stolen rain pearl that once fed the mountain springs. Without it, spirit animals were growing weak. A map appeared, but half of it was missing. Mo admitted that he had seen the other half in Elder Pine's locked room.",
          "Before they could leave, the books began flying in circles. They formed one sentence above the door: ONE OF YOUR TEACHERS STOLE THE RAIN. Then footsteps stopped at the top of the well.",
        ],
        answer: "An honest question caused a book to open",
        distractors: ["Mo demanded more power", "They broke the shelves", "The crane brought the map"],
        clue: "这座书库只回应真诚的问题。",
      },
      {
        slug: "cultivation-fox-with-two-names",
        title: "The Fox with Two Names",
        paragraphs: [
          "The footsteps belonged to a white fox carrying Elder Pine's key. It called itself Snow, then immediately answered when Mo called it Dumpling. “A secret agent needs several names,” the fox explained, “especially near kitchens.”",
          "Snow had taken the map half to keep it away from a masked thief. The fox would return it only if An Yu and Mo solved a bell puzzle. Each bell repeated the last sound it heard, but one bell always changed the final note.",
          "The friends solved it by clapping different rhythms and listening together. The false bell opened a path into the bamboo forest. Snow sniffed the air and froze. The masked thief was close—and smelled exactly like Elder Pine's tea.",
        ],
        answer: "They used different rhythms to identify the false bell",
        distractors: ["They rang every bell at once", "Snow ate the key", "An Yu used the sword to cut the bells"],
        clue: "他们通过合作比较不同节奏，找到了会改变音符的假钟。",
      },
      {
        slug: "cultivation-bamboo-mirror",
        title: "The Bamboo Mirror Maze",
        paragraphs: [
          "The bamboo forest copied every traveler. Soon three An Yus, three Mos, and far too many Snows were arguing about which one was real. The copies knew their memories, but they could not create a new joke.",
          "Mo deliberately told the worst joke he knew. The real An Yu groaned before the ending, and the real Snow asked whether it involved food. Together they marked one another with mud and moved as a single group.",
          "At the center of the maze, they found Elder Pine's teapot beside the stolen rain pearl. But the masked thief removed the mask. It was not Elder Pine. It was his shadow, walking without him.",
        ],
        answer: "A new joke helped the real friends recognize one another",
        distractors: ["The copies forgot all memories", "The sword destroyed the forest", "The teapot showed the exit"],
        clue: "复制品会模仿旧记忆，却无法预先知道一个新笑话。",
      },
      {
        slug: "cultivation-shadow-bargain",
        title: "A Bargain with a Shadow",
        paragraphs: [
          "Elder Pine's shadow claimed it stole the pearl because the sect had forgotten the dry villages below the mountain. Returning rain only to the sect would be easy. Sharing it with every valley would require breaking an ancient rule.",
          "An Yu did not trust the shadow, but she checked its story. Mo found old water records, and Snow followed the dry streambeds. The evidence showed that the villages had indeed received less water each year.",
          "They offered a new bargain: return the pearl, then face the elders together with the records. The shadow agreed, but when An Yu touched the pearl, it split into seven drops and flew toward seven locked gates.",
        ],
        answer: "They checked the shadow's claim with records and physical clues",
        distractors: ["They trusted the shadow immediately", "They ignored the villages", "They hid the pearl in the library"],
        clue: "他们没有只凭感觉判断，而是用记录和实地线索核对真相。",
      },
      {
        slug: "cultivation-seven-rain-gates",
        title: "The Seven Rain Gates",
        paragraphs: [
          "Each rain gate opened to a different valley. No person could hold more than one gate, so An Yu, Mo, Snow, Elder Pine, his shadow, the healed crane, and even the sword had to form a circle. The sword sneezed twice but kept its position.",
          "The elders objected until children from the dry villages arrived with empty jars. Elder Pine admitted that protecting tradition had become an excuse for avoiding a hard change. Together, everyone released the seven drops at the same moment.",
          "Rain crossed the whole mountain instead of falling on one garden. An Yu's sword finally flew straight—for almost six seconds. Far above the clouds, another sect lit a signal fire shaped like a question mark. Snow packed three buns for the journey.",
        ],
        answer: "Seven different partners had to hold the gates together",
        distractors: ["An Yu opened every gate alone", "The elders kept all the rain", "The shadow destroyed the records"],
        clue: "七扇门必须由七位不同伙伴同时守住。",
      },
    ],
  },
  {
    id: "tiger",
    title: "Hu Xiaoman's Adventure Club",
    eyebrow: "FUNNY FRIENDSHIP ADVENTURE",
    episodes: [
      {
        slug: "tiger-lunchbox-map",
        title: "The Map in the Lunchbox",
        paragraphs: [
          "Hu Xiaoman opened his lunchbox and found a map instead of dumplings. He was upset for three full seconds. Then he saw that the map led to the old clock tower, where a red circle marked “THE BIGGEST SNACK IN TOWN.”",
          "His friends Bean the rabbit and Little Rock the turtle joined him. Bean noticed the map was drawn on the back of a school notice. Little Rock saw that the red circle was actually a tomato sauce stain.",
          "They nearly gave up, but the stain covered a tiny printed number: 4:17. At exactly 4:17, the clock tower rang thirteen times and a paper airplane flew from its highest window. It carried one dumpling and a warning: DO NOT EAT THE SECOND ONE.",
        ],
        answer: "The sauce stain hid the number 4:17",
        distractors: ["The map led directly to a giant snack", "Bean rang the clock thirteen times", "Little Rock drew the notice"],
        clue: "看似没用的番茄酱污渍下面藏着关键时间。",
      },
      {
        slug: "tiger-second-dumpling",
        title: "The Second Dumpling",
        paragraphs: [
          "Naturally, Hu Xiaoman wanted to find the second dumpling. Bean reminded him that warnings existed for a reason. Little Rock suggested they first study the first dumpling, which was a wise plan and also a sad plan because nobody could eat the evidence.",
          "Inside the dumpling was a tiny brass key. Flour on the paper airplane matched flour outside the closed bakery. At the back door, they heard someone whispering numbers in the wrong order.",
          "The key opened a box of recipe cards. Every card described a normal snack except one: a dumpling that could make people forget the last hour. Behind them, the baker said, “I was hoping you would solve that after dinner.”",
        ],
        answer: "They examined the first dumpling before searching further",
        distractors: ["Hu Xiaoman ate all the evidence", "They broke into the clock", "The baker gave them the answer"],
        clue: "伙伴们先检查证据，而不是冲动地去找第二个包子。",
      },
      {
        slug: "tiger-forgotten-hour",
        title: "The Hour Everyone Forgot",
        paragraphs: [
          "The baker explained that one memory dumpling had been stolen. At school the next morning, everyone forgot the same hour. The principal repeated assembly twice. The music teacher played the ending of a song before its beginning.",
          "Hu Xiaoman remembered a smell of pepper during the missing hour. Bean remembered wet footprints. Little Rock had written one word on his shell with chalk: ROOFTOP. Their different memories formed one useful trail.",
          "On the roof they found an empty basket tied to a kite. The kite string crossed the street and disappeared into the town museum. Someone was using the wind to move stolen objects without touching the ground.",
        ],
        answer: "Their separate clues combined into a trail to the rooftop",
        distractors: ["Only Hu Xiaoman remembered everything", "The principal solved the case", "The kite belonged to the baker"],
        clue: "每个人只记得一小部分，但合在一起就形成了完整线索。",
      },
      {
        slug: "tiger-museum-at-night",
        title: "The Museum That Coughed",
        paragraphs: [
          "The Adventure Club entered the museum before closing. A dinosaur model coughed when Hu Xiaoman walked past. Bean discovered a speaker in its mouth. Little Rock found fresh kite string wrapped around its tail.",
          "A recorded voice sent them toward three doors. One said GOLD, one said GLORY, and one said FRIENDS. Hu Xiaoman chose GOLD first and received a bucket on his head. “Useful test,” he said from inside it.",
          "The FRIENDS door opened only when all three pushed together. Beyond it was the stolen basket and a machine printing memory-dumpling recipes. The machine had already mailed one recipe outside town—to someone named Tiger Zero.",
        ],
        answer: "The FRIENDS door required all three partners to push",
        distractors: ["The GOLD door held the recipe", "The dinosaur was alive", "Tiger Zero opened the museum"],
        clue: "写着伙伴的门需要三个人一起用力才能打开。",
      },
      {
        slug: "tiger-zero-challenge",
        title: "The Challenge from Tiger Zero",
        paragraphs: [
          "Tiger Zero sent Hu Xiaoman a challenge: reach the river island before sunset or lose every town recipe. Hu Xiaoman wanted to race there alone. Bean asked why a thief would choose the one skill Hu Xiaoman was proudest of.",
          "They built a slower plan. Bean followed coded flags along the bank, Little Rock checked which bridges could carry weight, and Hu Xiaoman ran only when the route was safe. Their teamwork reached the island before Tiger Zero's faster boat.",
          "Tiger Zero turned out to be a frightened tiger cub protecting a broken recipe robot. The robot had created the memory dumpling by mistake. Then it printed a final message: ORIGINAL OWNER APPROACHING.",
        ],
        answer: "They refused the obvious race and divided the navigation tasks",
        distractors: ["Hu Xiaoman raced alone", "They destroyed every bridge", "Bean used the memory dumpling"],
        clue: "伙伴们看穿了单纯竞速的陷阱，用分工提前到达。",
      },
      {
        slug: "tiger-recipe-robot",
        title: "The Recipe Robot's Real Owner",
        paragraphs: [
          "The approaching owner was Grandma Stripe, the town's oldest cook. She had built the robot to save recipes from disappearing. It began stealing only after one page in its instructions became wet: SHARE RECIPES had changed into STEAL RECIPES.",
          "Tiger Zero had hidden the robot because he feared punishment. Hu Xiaoman admitted that he also hid mistakes when he felt ashamed. Together they repaired the page, returned the recipes, and added a rule: every important instruction needed two people to check it.",
          "At dinner, the first dumpling was finally declared safe. Hu Xiaoman took one bite and found another map inside. This one clearly led beyond the town. Little Rock quietly packed extra chalk. Bean packed extra warnings. Hu Xiaoman packed extra dumplings.",
        ],
        answer: "Water changed one important instruction in the robot",
        distractors: ["Grandma Stripe ordered the robot to steal", "Tiger Zero invented every recipe", "Hu Xiaoman erased the page"],
        clue: "被水打湿的指令从分享食谱变成了偷走食谱。",
      },
    ],
  },
  {
    id: "cat",
    title: "Mao Chengcheng and the Puzzle City",
    eyebrow: "COZY MYSTERY ADVENTURE",
    episodes: [
      {
        slug: "cat-bell-without-sound",
        title: "The Bell That Made No Sound",
        paragraphs: [
          "Mao Chengcheng repaired small clocks in her aunt's shop. One rainy afternoon, a silent silver bell appeared on the counter. It had no moving part, yet every clock in the shop stopped when she touched it.",
          "Her friend Doubao the dog brought a magnifying glass and three biscuits for serious detective work. Tiny paw prints circled the bell, but they appeared only in the mirror. Chengcheng turned the mirror toward the street.",
          "The reflected prints crossed the road and climbed a wall that had no door. When the moon rose, a door appeared in the reflection. A note hung from its handle: PUZZLE CITY NEEDS A CLOCKMAKER BEFORE MIDNIGHT.",
        ],
        answer: "The paw prints could only be seen in a mirror",
        distractors: ["The bell rang very loudly", "Doubao found a normal door", "The clocks stopped before the bell arrived"],
        clue: "脚印只在镜子里出现，因此镜子成为找到入口的关键。",
      },
      {
        slug: "cat-upside-down-street",
        title: "The Upside-Down Street",
        paragraphs: [
          "Beyond the mirror door, lamps grew from the pavement and roads hung above the roofs. Chengcheng studied everything before taking a step. Doubao took one step, floated upward, and calmly asked her to rescue the biscuits first.",
          "A street sign showed arrows in four directions, but its shadow pointed to only one. Chengcheng waited for a moving lamp to cast the shadow across a safe path. Doubao used his tail as a rope so they could cross together.",
          "At the clock square, they found hundreds of citizens frozen in the middle of laughing, running, or sneezing. Only a small mouse could move. He said the city's missing minute had been stolen.",
        ],
        answer: "They followed the street sign's shadow to find a safe path",
        distractors: ["They walked on every arrow", "Doubao ate the street sign", "The mouse carried them across"],
        clue: "真正可靠的方向不是箭头，而是路牌投下的影子。",
      },
      {
        slug: "cat-missing-minute",
        title: "Where Did the Missing Minute Go?",
        paragraphs: [
          "The mouse was called Minute Keeper Pip. He showed them a clock with the number eight appearing twice and the number nine missing. Chengcheng suspected that the clock did not lose time. Someone had moved it.",
          "They searched places that repeated: twin bridges, matching towers, and a bakery selling two identical cakes. Doubao noticed that one cake had nine cherries in its reflection but only eight on the table.",
          "Under the ninth reflected cherry they found a glass key. It opened a room between eight and ten o'clock. Inside, thousands of stolen seconds floated like fireflies—and one was calling Chengcheng's name.",
        ],
        answer: "A reflection revealed the missing ninth cherry and a hidden key",
        distractors: ["Pip repaired the clock immediately", "The bridges moved the minute", "Doubao ate both cakes"],
        clue: "倒影中多出的第九颗樱桃标出了钥匙的位置。",
      },
      {
        slug: "cat-room-between-seconds",
        title: "The Room Between Seconds",
        paragraphs: [
          "The calling second contained a memory of Chengcheng's mother, who had once visited Puzzle City. In the memory, she hid a golden gear and said, “Some problems must wait until the right friends arrive.”",
          "A masked crow offered to trade the city's missing minute for the memory. Chengcheng wanted to hear her mother's voice again, but Doubao reminded her that a trade made under pressure was not a fair choice.",
          "They pretended to agree while Pip followed the crow's shadow. The shadow led to a tower made of stopped clocks. At its top, the golden gear was turning backward and pulling time out of the city.",
        ],
        answer: "Her friends helped Chengcheng refuse an unfair trade",
        distractors: ["Chengcheng gave away the memory", "Pip trusted the crow", "The golden gear had stopped moving"],
        clue: "伙伴的提醒让猫成成没有在压力下接受不公平交换。",
      },
      {
        slug: "cat-clock-tower-riddle",
        title: "The Clock Tower's Three Questions",
        paragraphs: [
          "The tower asked three questions. Chengcheng knew the first answer. Pip knew the second. The third asked, “What becomes larger when it is shared?” Doubao answered, “A biscuit,” which was scientifically doubtful but emotionally sincere.",
          "Chengcheng answered “trust.” The tower opened because no single visitor had solved all three questions. The masked crow admitted that he had stolen time to keep one happy day from ending.",
          "Chengcheng understood the wish but showed him the frozen citizens below. A perfect day that never moved could not become a new day. The crow released the missing minute—then the golden gear cracked in half.",
        ],
        answer: "Different friends contributed answers to the tower's questions",
        distractors: ["Doubao solved everything alone", "The crow wanted to destroy all happy days", "The citizens asked the questions"],
        clue: "三道题需要不同伙伴的知识和想法才能全部解开。",
      },
      {
        slug: "cat-first-new-minute",
        title: "The First New Minute",
        paragraphs: [
          "With the gear broken, Puzzle City could move for only sixty seconds. Chengcheng connected every small clock in the square. Pip organized the citizens, Doubao carried tools, and the crow flew messages between rooftops.",
          "Instead of rebuilding one powerful gear, they made a network. Each clock shared a little force, and no single machine controlled the whole city. When the final second arrived, the network created the first new minute by itself.",
          "The mirror door reopened at dawn. Chengcheng carried home the silent bell, now ticking softly. Inside it she found a map drawn by her mother. The map showed seven other puzzle cities—and one had just gone dark.",
        ],
        answer: "They connected many small clocks into a shared network",
        distractors: ["Chengcheng built one giant gear", "The crow stopped all messages", "Pip closed the mirror door"],
        clue: "大家让许多小钟共同分担力量，而不是依赖一个强大的齿轮。",
      },
    ],
  },
];

function questionsFor(episode: StoryEpisode): Question[] {
  return [
    {
      prompt: "Which detail was most important to solving the problem?",
      options: [episode.answer, ...episode.distractors],
      answer: 0,
      explanation: episode.clue,
    },
    {
      prompt: "What idea does this chapter emphasize?",
      options: [
        "A strong person should hide every mistake",
        "Careful clues and teamwork are stronger than a quick guess",
        "Friends should compete instead of sharing information",
        "A magical object can solve every problem alone",
      ],
      answer: 1,
      explanation: "本章的转折都来自伙伴间共享线索、互相提醒并共同承担任务。",
    },
  ];
}

export function generateOriginalStorySeries(examId: ExamId): StorySeriesPassage[] {
  const advanced = examId === "high" || examId === "toefl" || examId === "ielts";
  return storySeries.flatMap((series) =>
    series.episodes.map((episode, index) => ({
      slug: `story-${episode.slug}`,
      interestId: series.id,
      title: episode.title,
      eyebrow: series.eyebrow,
      readMinutes: index < 2 ? 4 : 5,
      difficulty: advanced ? 3 : 2,
      seriesTitle: series.title,
      episodeNumber: index + 1,
      paragraphs: advanced
        ? [
            episode.paragraphs[0],
            `${episode.paragraphs[1]} They compared the evidence before accepting the most convenient explanation.`,
            episode.paragraphs[2],
          ]
        : episode.paragraphs,
      questions: questionsFor(episode),
    })),
  );
}
