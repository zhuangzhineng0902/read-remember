import type { ExamId, InterestId, Question } from "./types";

export type GeneratedInterestPassage = {
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

type InformationalInterestId = "military" | "art" | "science" | "why";

type TopicSeed = {
  slug: string;
  title: string;
  subject: string;
  mechanism: string;
  value: string;
  challenge: string;
  example: string;
};

type Lens = {
  slug: string;
  title: string;
  focus: string;
  action: string;
};

const lenses: Lens[] = [
  { slug: "how", title: "How It Works", focus: "cause and effect", action: "explain the process in order" },
  { slug: "design", title: "A Design Challenge", focus: "design choices", action: "choose the most useful feature" },
  { slug: "field-note", title: "Field Notes", focus: "careful observation", action: "record a useful clue" },
  { slug: "compare", title: "Compare Two Ideas", focus: "similarities and differences", action: "compare two possible approaches" },
  { slug: "story", title: "A Short History", focus: "change over time", action: "identify what improved" },
  { slug: "measure", title: "Measure the Evidence", focus: "evidence and measurement", action: "decide what should be measured" },
  { slug: "team", title: "The Team Plan", focus: "communication and teamwork", action: "share the key information clearly" },
  { slug: "myth", title: "Myth or Fact?", focus: "misconceptions", action: "replace a weak guess with evidence" },
  { slug: "future", title: "The Next Version", focus: "future improvement", action: "suggest a responsible improvement" },
  { slug: "project", title: "Try a Mini Project", focus: "learning by doing", action: "test one idea safely" },
];

const militaryTopics: TopicSeed[] = [
  { slug: "field-bridge", title: "The Bridge That Travels", subject: "a portable field bridge", mechanism: "light sections lock together and spread weight across a gap", value: "people and supplies can cross damaged roads quickly", challenge: "the bridge must be strong without becoming too heavy to move", example: "engineers first test a small model with changing loads" },
  { slug: "rescue-robot", title: "Robots in Dangerous Places", subject: "a rescue robot", mechanism: "cameras, tracks, and distance sensors send information to a remote operator", value: "a team can inspect an unsafe building before people enter", challenge: "dust, stairs, and weak radio signals can interrupt the mission", example: "a tracked robot carries a camera through a narrow opening" },
  { slug: "sonar", title: "Listening Under Water", subject: "sonar", mechanism: "a sound pulse travels through water and its echo reveals distance", value: "ships can map the seabed or locate objects when water blocks vision", challenge: "temperature and noise can bend or hide returning sound", example: "a survey ship compares echoes from shallow and deep water" },
  { slug: "weather-balloon", title: "A Balloon Above the Clouds", subject: "a weather balloon", mechanism: "instruments rise through the atmosphere and report pressure, temperature, and wind", value: "forecasters and flight teams receive a vertical picture of the weather", challenge: "the balloon expands as air pressure falls and eventually bursts", example: "a ground station follows a small transmitter as it drifts" },
  { slug: "satellite-navigation", title: "Finding a Position from Space", subject: "satellite navigation", mechanism: "a receiver compares precisely timed signals from several satellites", value: "teams can navigate, map routes, and coordinate rescue work", challenge: "buildings, mountains, or interference may weaken the signals", example: "a rescue team checks a map position against visible landmarks" },
  { slug: "codebreaking", title: "Patterns Inside a Code", subject: "codebreaking", mechanism: "analysts search repeated symbols, likely words, and structural patterns", value: "hidden messages can be understood without guessing every possibility", challenge: "a strong code changes patterns and limits useful clues", example: "students begin with letter frequency in a short substitution puzzle" },
  { slug: "cargo-drop", title: "Delivering Cargo Safely", subject: "an air-drop system", mechanism: "a parachute creates drag while packaging spreads the force of landing", value: "food or medical supplies can reach places without a usable road", challenge: "wind, mass, and landing surface all change the result", example: "a design team protects a test package dropped from a fixed height" },
  { slug: "signal-flags", title: "Messages Without a Radio", subject: "visual signal flags", mechanism: "agreed colors and positions represent short messages at a distance", value: "basic communication remains possible when electronic systems fail", challenge: "fog, darkness, and unfamiliar codes reduce understanding", example: "two teams exchange a simple safety message across a field" },
  { slug: "night-vision", title: "Making Use of Faint Light", subject: "night-vision equipment", mechanism: "sensors collect weak available light and convert it into a visible image", value: "operators can move and observe with less artificial light", challenge: "bright flashes and limited depth information can confuse the user", example: "a camera compares the same path at dusk and after dark" },
  { slug: "logistics-map", title: "The Map Behind Every Mission", subject: "a logistics map", mechanism: "routes, timing, fuel, storage, and risks are combined in one plan", value: "the right supplies arrive where they are needed", challenge: "one delayed road or missing item can affect the whole chain", example: "a coordinator prepares a second route before a convoy leaves" },
];

const artTopics: TopicSeed[] = [
  { slug: "one-point-perspective", title: "Roads That Meet on Paper", subject: "one-point perspective", mechanism: "parallel depth lines appear to move toward one vanishing point", value: "a flat drawing gains a believable sense of space", challenge: "objects must shrink consistently as they move farther away", example: "an artist draws a hallway around one point on the horizon" },
  { slug: "color-temperature", title: "Warm and Cool Colors", subject: "color temperature", mechanism: "warm reds and yellows seem to advance while cool blues often seem to recede", value: "color can guide attention and create mood", challenge: "surrounding colors can change how one color feels", example: "the same gray square looks different on orange and blue paper" },
  { slug: "watercolor-layers", title: "Painting with Transparent Layers", subject: "watercolor glazing", mechanism: "thin transparent washes dry before another color is placed above them", value: "light can pass through several layers and create rich color", challenge: "too much brushing can lift paint or make colors muddy", example: "a painter builds a leaf from three light washes" },
  { slug: "charcoal-value", title: "Drawing Light with Dark Charcoal", subject: "charcoal value", mechanism: "different pressure and blending produce a scale from paper white to deep black", value: "value changes make simple forms look solid", challenge: "charcoal spreads easily and can erase clean edges", example: "a student shades five boxes before drawing a metal cup" },
  { slug: "gesture-drawing", title: "Capturing Movement Quickly", subject: "gesture drawing", mechanism: "fast flowing lines record the direction and energy of a pose", value: "artists learn structure before worrying about small details", challenge: "slow outlining can make the pose feel stiff", example: "a class draws each moving pose for only thirty seconds" },
  { slug: "negative-space", title: "Drawing the Empty Shape", subject: "negative space", mechanism: "the artist studies the shapes around and between objects", value: "proportions become easier to judge without naming every object", challenge: "the brain prefers to draw what it thinks an object looks like", example: "a chair is drawn by tracing the empty gaps between its legs" },
  { slug: "composition-path", title: "A Path for the Viewer’s Eye", subject: "visual composition", mechanism: "contrast, direction, and placement create a route through an image", value: "the main idea becomes easier to notice", challenge: "too many equally strong elements compete for attention", example: "a bright figure is placed away from the exact center" },
  { slug: "texture-marks", title: "Marks That Feel Like Surfaces", subject: "drawn texture", mechanism: "repeated dots, lines, and broken shapes suggest material qualities", value: "viewers can imagine rough stone, soft fur, or smooth glass", challenge: "copying every detail can hide the larger form", example: "short curved marks follow the round surface of an orange" },
  { slug: "poster-hierarchy", title: "What Should You Read First?", subject: "poster hierarchy", mechanism: "size, spacing, and contrast rank information by importance", value: "a message can be understood quickly from a distance", challenge: "decorative elements must not overpower essential words", example: "a designer tests whether the title is clear from across the room" },
  { slug: "collage-story", title: "Building a Story from Fragments", subject: "collage", mechanism: "separate papers, photographs, and textures are arranged into a new relationship", value: "ordinary materials can express surprising connections", challenge: "different pieces still need a shared rhythm or idea", example: "a map fragment becomes the sky in an imaginary city" },
];

const scienceTopics: TopicSeed[] = [
  { slug: "bird-migration", title: "How Birds Find a Long Route", subject: "bird migration", mechanism: "birds combine sunlight, stars, landmarks, smell, and Earth’s magnetic field", value: "seasonal travel connects feeding and nesting places", challenge: "storms, bright city lights, and lost habitats make routes harder", example: "researchers compare tracking points along a coastline" },
  { slug: "fungal-network", title: "The Hidden Web in Soil", subject: "a fungal network", mechanism: "fine threads grow around roots and exchange water and nutrients with plants", value: "the partnership helps many plants reach scarce resources", challenge: "dry soil and disturbance can break delicate connections", example: "a forest sample reveals threads much thinner than roots" },
  { slug: "coral-partnership", title: "A Partnership Inside Coral", subject: "coral symbiosis", mechanism: "tiny algae live in coral tissue and share energy made from sunlight", value: "the partnership supports productive reefs in clear water", challenge: "unusual heat can cause corals to lose their algae", example: "scientists compare color and temperature at reef sites" },
  { slug: "volcano-pressure", title: "Pressure Beneath a Volcano", subject: "a volcanic eruption", mechanism: "rising magma releases expanding gases as pressure above it falls", value: "monitoring the process helps communities understand changing hazards", challenge: "each volcano has different pathways and warning patterns", example: "instruments measure ground movement and gas near a crater" },
  { slug: "plate-motion", title: "Continents on Moving Plates", subject: "plate tectonics", mechanism: "rigid plates move slowly over hotter, softer material below", value: "the model connects earthquakes, volcanoes, mountains, and ocean basins", challenge: "the movement is too slow to watch directly in daily life", example: "GPS stations measure tiny yearly changes in distance" },
  { slug: "photosynthesis", title: "How a Leaf Stores Sunlight", subject: "photosynthesis", mechanism: "plants use light energy to combine water and carbon dioxide into sugars", value: "the process stores energy and releases oxygen", challenge: "light, water, temperature, and nutrients can limit the rate", example: "a class compares the growth of plants under different light levels" },
  { slug: "aurora", title: "Lights Above the Polar Sky", subject: "an aurora", mechanism: "charged particles guided by Earth’s magnetic field collide with gases high in the atmosphere", value: "the colors reveal interactions between the Sun and Earth", challenge: "solar activity and cloud cover make displays difficult to predict", example: "a camera records changing green arcs during a clear night" },
  { slug: "deep-current", title: "The Slow Journey of Deep Water", subject: "deep-ocean circulation", mechanism: "differences in temperature and salt change water density and drive sinking and flow", value: "currents move heat, oxygen, and nutrients around the planet", challenge: "the complete journey takes many years and is hard to measure", example: "floating instruments report temperature at several depths" },
  { slug: "dna-copy", title: "Copying the Instructions of Life", subject: "DNA replication", mechanism: "the double strand opens and each half guides the building of a matching half", value: "cells can pass genetic instructions to new cells", challenge: "copying errors must be found and repaired", example: "a classroom model pairs colored pieces according to base rules" },
  { slug: "bee-dance", title: "A Dance That Points to Food", subject: "the honeybee waggle dance", mechanism: "direction and duration of movement communicate angle and distance", value: "many bees can locate a useful flower patch", challenge: "the message must be adjusted as the Sun moves", example: "observers map dance angles and later flight directions" },
];

const whyTopics: TopicSeed[] = [
  { slug: "ice-floats", title: "Why Does Ice Float?", subject: "floating ice", mechanism: "water molecules form a more open structure when they freeze, making ice less dense", value: "a surface layer of ice can insulate liquid water below", challenge: "most substances become denser when they turn solid", example: "an ice cube leaves part of its volume above the drink" },
  { slug: "echo", title: "Why Do We Hear an Echo?", subject: "an echo", mechanism: "sound reflects from a distant hard surface and returns after a short delay", value: "the delay can reveal the distance and shape of a space", challenge: "soft materials absorb sound and nearby reflections mix together", example: "a clap sounds different in a hall and a room with curtains" },
  { slug: "moon-phases", title: "Why Does the Moon Change Shape?", subject: "the phases of the Moon", mechanism: "we see different portions of the Moon’s sunlit half as it orbits Earth", value: "the regular pattern helps people track time and position", challenge: "the phases are often confused with Earth’s shadow", example: "a lamp and ball model show a sequence over one orbit" },
  { slug: "onion-tears", title: "Why Do Onions Make Us Cry?", subject: "onion tears", mechanism: "cut cells release chemicals that form an irritating gas near the eyes", value: "tears wash the irritant away and protect the eye", challenge: "crushing more cells releases more of the chemicals", example: "a sharp knife damages fewer cells than a blunt one" },
  { slug: "rust", title: "Why Does Iron Rust?", subject: "rusting iron", mechanism: "iron reacts with oxygen in the presence of water to form new compounds", value: "understanding corrosion helps people protect bridges and tools", challenge: "salt can speed the reaction by helping electric charge move", example: "paint separates a metal surface from air and moisture" },
  { slug: "twinkling-stars", title: "Why Do Stars Twinkle?", subject: "twinkling starlight", mechanism: "moving layers of air bend the narrow beam of light in changing directions", value: "the effect reveals that Earth’s atmosphere is active", challenge: "the changing air can blur astronomical observations", example: "a planet usually appears steadier because it looks like a tiny disk" },
  { slug: "soap-cleans", title: "Why Can Soap Remove Oil?", subject: "soap cleaning", mechanism: "soap molecules have one end that joins water and another that joins oil", value: "oil breaks into tiny droplets that water can carry away", challenge: "water alone cannot easily surround greasy material", example: "shaking oil, water, and soap makes a cloudy mixture" },
  { slug: "leaves-change", title: "Why Do Leaves Change Color?", subject: "autumn leaf color", mechanism: "shorter days reduce green chlorophyll and reveal or produce other pigments", value: "the change is part of a tree’s preparation for a difficult season", challenge: "temperature, light, and species affect the final colors", example: "two trees on the same street may change at different times" },
  { slug: "static-shock", title: "Why Does a Small Spark Jump?", subject: "static electricity", mechanism: "friction separates electric charge until it suddenly moves across a small gap", value: "the spark demonstrates how charge seeks balance", challenge: "moist air lets charge escape before a large difference builds", example: "walking on a dry carpet can charge a person before touching metal" },
  { slug: "bread-rises", title: "Why Does Bread Dough Rise?", subject: "rising dough", mechanism: "yeast uses sugars and releases carbon dioxide that becomes trapped in elastic dough", value: "many small gas pockets create a lighter texture", challenge: "temperature affects both yeast activity and dough structure", example: "warm dough expands faster than dough kept too cold" },
];

const topicGroups: Record<InformationalInterestId, TopicSeed[]> = {
  military: militaryTopics,
  art: artTopics,
  science: scienceTopics,
  why: whyTopics,
};

const categoryEyebrows: Record<InformationalInterestId, string> = {
  military: "ENGINEERING & HISTORY",
  art: "ART & DESIGN STUDIO",
  science: "SCIENCE EXPLORER",
  why: "A BIG WHY",
};

const stageDetails: Record<ExamId, { difficulty: number; minutes: number }> = {
  middle: { difficulty: 2, minutes: 4 },
  high: { difficulty: 3, minutes: 5 },
  toeic: { difficulty: 3, minutes: 4 },
  toefl: { difficulty: 4, minutes: 6 },
  ielts: { difficulty: 4, minutes: 6 },
};

function stageParagraphs(
  examId: ExamId,
  topic: TopicSeed,
  lens: Lens,
) {
  const plain = [
    `${topic.title} begins with ${topic.subject}. ${topic.mechanism}. This article looks at ${lens.focus}, so the reader should notice how one decision leads to another.`,
    `${topic.value}. A useful example is this: ${topic.example}. That example turns an abstract idea into something that can be observed, discussed, or tested.`,
    `There is still a problem to solve: ${topic.challenge}. A learner can ${lens.action}. The goal is not to memorize every term, but to use evidence to explain why the system succeeds or fails.`,
  ];
  if (examId === "middle") return plain;
  if (examId === "high") {
    return plain.map((paragraph, paragraphIndex) =>
      `${paragraph} ${[
        "This cause-and-effect chain is the key to understanding the topic.",
        "Comparing the example with the main principle reveals the writer’s purpose.",
        "A strong conclusion should connect the challenge with a possible response.",
      ][paragraphIndex]}`,
    );
  }
  if (examId === "toeic") {
    return [
      `Imagine that a project team receives a short briefing about ${topic.subject}. The central process is practical: ${topic.mechanism}. Team members are asked to focus on ${lens.focus} before choosing a plan.`,
      `The expected benefit is clear: ${topic.value}. During a demonstration, ${topic.example}. A useful report would record what happened, what resources were needed, and which result mattered most.`,
      `Before approving the plan, the team must consider a limitation: ${topic.challenge}. Their next action is to ${lens.action}. Clear instructions and a backup plan make the work safer and more reliable.`,
    ];
  }
  if (examId === "toefl") {
    return [
      `In an introductory academic discussion of ${topic.subject}, the underlying mechanism is more important than specialist vocabulary. ${topic.mechanism}. Examining the topic through ${lens.focus} makes the causal structure easier to identify.`,
      `Its significance follows from a practical consequence: ${topic.value}. For instance, ${topic.example}. The example functions as evidence because it links a general explanation to an observable result rather than merely repeating the definition.`,
      `Nevertheless, the process has a constraint: ${topic.challenge}. Researchers or designers may therefore ${lens.action}. This response illustrates a broader principle: reliable conclusions depend on both an explanatory model and evidence that could challenge it.`,
    ];
  }
  return [
    `Accounts of ${topic.subject} often appear straightforward, yet their value depends on the relationship between mechanism and evidence. ${topic.mechanism}. From the perspective of ${lens.focus}, the explanation also shows how readers organise information across a text.`,
    `One widely useful outcome is that ${topic.value}. Consider the following illustration: ${topic.example}. Although this case does not represent every situation, it demonstrates why a concrete observation can strengthen a general claim.`,
    `Any balanced assessment must also acknowledge that ${topic.challenge}. It would therefore be sensible to ${lens.action}. The most convincing position is neither unquestioning enthusiasm nor simple rejection, but a conclusion proportionate to the available evidence.`,
  ];
}

function informationalQuestions(
  examId: ExamId,
  topic: TopicSeed,
  lens: Lens,
): Question[] {
  const firstPrompt =
    examId === "middle"
      ? `What is the main value of ${topic.subject}?`
      : examId === "toeic"
        ? "What benefit should the project team include in its report?"
        : `Which statement best describes the significance of ${topic.subject}?`;
  const secondPrompt =
    examId === "middle"
      ? "What should a learner do after reading?"
      : examId === "toefl"
        ? "Why does the author include the practical example?"
        : examId === "ielts"
          ? "Which approach does the writer finally support?"
          : "What is the main purpose of the final paragraph?";
  const secondOptions =
    examId === "toefl"
      ? [
          "To replace the explanation with a personal opinion",
          "To introduce an unrelated historical event",
          "To connect a general mechanism with observable evidence",
          "To prove that the challenge no longer exists",
        ]
      : examId === "ielts"
        ? [
            "Rejecting the topic because one limitation exists",
            "Accepting every claim without measurement",
            "Drawing a balanced conclusion from evidence and limitations",
            "Memorising terms without examining their relationships",
          ]
        : [
            "Ignore the remaining limitation",
            `Use ${lens.focus} to consider the challenge and a response`,
            "Copy every technical word without understanding it",
            "Assume that one example proves every possible case",
          ];
  return [
    {
      prompt: firstPrompt,
      options: [
        `It removes every challenge connected with ${topic.subject}`,
        topic.value.charAt(0).toUpperCase() + topic.value.slice(1),
        "It makes observation and communication unnecessary",
        "It works only when no planning is required",
      ],
      answer: 1,
      explanation: `第二段直接说明了核心价值：${topic.value}。`,
    },
    {
      prompt: secondPrompt,
      options: secondOptions,
      answer: examId === "toefl" || examId === "ielts" ? 2 : 1,
      explanation:
        examId === "toefl"
          ? "实例把一般原理与可观察结果连接起来，用于支持而不是替代解释。"
          : examId === "ielts"
            ? "结尾主张同时考虑证据和局限，形成与证据强度相称的结论。"
            : `末段要求围绕 ${lens.focus} 分析局限并提出回应。`,
    },
  ];
}

const fantasyWorlds = [
  { slug: "lantern-archipelago", series: "The Lantern Archipelago", hero: "Mira", friend: "Tao", place: "islands that move each midnight", artifact: "a compass filled with blue sand", goal: "return a lost island to its families", danger: "a fog that copies familiar voices" },
  { slug: "clockwork-garden", series: "The Clockwork Garden", hero: "Nina", friend: "Bo", place: "a garden where metal flowers keep time", artifact: "a brass seed that ticks softly", goal: "restart the seasons before winter freezes the city", danger: "a gardener made of loose shadows" },
  { slug: "cloud-library", series: "The Library Above the Clouds", hero: "Eli", friend: "Sana", place: "a library carried by enormous birds", artifact: "a bookmark that opens hidden chapters", goal: "save stories that are disappearing from memory", danger: "a silent wind that erases written names" },
  { slug: "painted-city", series: "The City Behind the Painting", hero: "Lena", friend: "Jin", place: "a painted city that changes with every brushstroke", artifact: "a pencil that can draw temporary doors", goal: "find the missing artist and repair the city", danger: "black rain that removes color and sound" },
  { slug: "moon-train", series: "The Midnight Moon Train", hero: "Kai", friend: "Rosa", place: "a train line connecting forgotten dreams", artifact: "a silver ticket with no destination", goal: "deliver a dream to a child who has stopped imagining", danger: "a conductor who collects unfinished promises" },
  { slug: "whispering-mountain", series: "The Whispering Mountain", hero: "Ari", friend: "Mei", place: "a mountain whose caves answer one question each year", artifact: "a rope woven from echo threads", goal: "ask how to bring rain back to their valley", danger: "stone birds that wake when someone lies" },
  { slug: "underwater-observatory", series: "The Observatory Under the Sea", hero: "Noah", friend: "Ivy", place: "a glass observatory beneath a glowing reef", artifact: "a star chart that also maps ocean currents", goal: "find a fallen star before it cools", danger: "a current that sends travelers back in time" },
  { slug: "paper-dragon", series: "The Paper Dragon Society", hero: "Emi", friend: "Lucas", place: "a school where folded animals wake after sunset", artifact: "a sheet of paper that never tears", goal: "protect the school’s secret workshop", danger: "an ink creature that grows by stealing words" },
  { slug: "door-market", series: "The Market of One Hundred Doors", hero: "Sam", friend: "Anya", place: "a market where each door opens into a different season", artifact: "a key that becomes warm near the right choice", goal: "find the spring door for a village trapped in autumn", danger: "a merchant who trades in other people’s time" },
  { slug: "star-map", series: "The Mapmaker of Small Stars", hero: "Owen", friend: "Lila", place: "a workshop that repairs broken constellations", artifact: "a ruler that measures impossible distances", goal: "put a fallen constellation back into the sky", danger: "a creature that hides inside empty spaces on maps" },
];

const fantasyEpisodes = [
  { slug: "unexpected-message", title: "The Unexpected Message", discovery: "a moving symbol appeared on the artifact", choice: "follow the first clue before sunrise" },
  { slug: "hidden-entrance", title: "The Hidden Entrance", discovery: "a door became visible only in reflected light", choice: "enter together and mark the way back" },
  { slug: "three-rules", title: "The Three Rules", discovery: "a guardian explained three rules but refused to explain the third", choice: "test the safest rule with a small object" },
  { slug: "broken-path", title: "The Broken Path", discovery: "the marked route ended above a deep gap", choice: "combine their different skills to cross" },
  { slug: "friendly-stranger", title: "The Friendly Stranger", discovery: "a stranger knew the heroes’ names and part of their goal", choice: "ask a question that only a true helper could answer" },
  { slug: "wrong-answer", title: "The Useful Mistake", discovery: "their first solution opened the wrong chamber", choice: "study the mistake instead of hiding it" },
  { slug: "separated", title: "Two Sides of the Puzzle", discovery: "a closing wall separated the friends", choice: "send a message through sound and repeated patterns" },
  { slug: "real-cost", title: "The Real Cost", discovery: "the final tool demanded a memory rather than money", choice: "search for a fair exchange that harmed no one" },
  { slug: "return-route", title: "The Route Home", discovery: "the safe path home began to disappear", choice: "finish the mission while preserving a return route" },
  { slug: "new-map", title: "A New Map Begins", discovery: "success revealed a larger map and an unanswered question", choice: "record what they had learned before the next journey" },
];

function fantasyPassage(examId: ExamId, worldIndex: number, episodeIndex: number) {
  const world = fantasyWorlds[worldIndex];
  const episode = fantasyEpisodes[episodeIndex];
  const detail = stageDetails[examId];
  const complexity =
    examId === "middle"
      ? "They used simple words and checked each clue twice."
      : examId === "high"
        ? "They compared the clue with what they had learned on the previous journey."
        : examId === "toeic"
          ? "They divided the task, confirmed the plan, and agreed on a meeting point."
          : examId === "toefl"
            ? "They treated the clue as a hypothesis, looking for evidence that could disprove their first interpretation."
            : "They understood that a convincing choice had to account for both the immediate clue and its wider consequences.";
  return {
    slug: `corpus-${world.slug}-${episode.slug}`,
    interestId: "fantasy" as const,
    title: `${episode.title} · ${world.series}`,
    eyebrow: "ORIGINAL FANTASY ADVENTURE",
    readMinutes: detail.minutes,
    difficulty: detail.difficulty,
    seriesTitle: world.series,
    episodeNumber: episodeIndex + 1,
    paragraphs: [
      `${world.hero} and ${world.friend} were exploring ${world.place}. They carried ${world.artifact}, the only object that might help them ${world.goal}. At the start of this chapter, ${episode.discovery}.`,
      `Neither friend wanted to act on a guess. ${complexity} Around them, signs of ${world.danger} were growing stronger, so waiting without a plan was also a choice with consequences.`,
      `At last, they decided to ${episode.choice}. The decision did not solve the whole mystery, but it gave them one reliable piece of evidence. As they moved forward, the artifact changed again, pointing toward the next part of the adventure.`,
    ],
    questions: [
      {
        prompt: "What did the two friends decide to do?",
        options: [
          "Leave the artifact behind and forget the mission",
          episode.choice.charAt(0).toUpperCase() + episode.choice.slice(1),
          "Wait without collecting any evidence",
          "Follow the danger without making a plan",
        ],
        answer: 1,
        explanation: `第三段明确写到他们决定 ${episode.choice}。`,
      },
      {
        prompt: "What idea is emphasized in this chapter?",
        options: [
          "The fastest guess is always correct",
          "Friends should solve every problem alone",
          "A careful choice uses clues, teamwork, and evidence",
          "A magical object removes every consequence",
        ],
        answer: 2,
        explanation: "故事反复强调先核对线索、共同制定计划，再根据证据行动。",
      },
    ],
  } satisfies GeneratedInterestPassage;
}

export function generateInterestCorpus(
  examId: ExamId,
): GeneratedInterestPassage[] {
  const detail = stageDetails[examId];
  const informational = (Object.entries(topicGroups) as Array<
    [InformationalInterestId, TopicSeed[]]
  >).flatMap(([interestId, topics]) =>
    topics.flatMap((topic) =>
      lenses.map((lens) => ({
        slug: `corpus-${topic.slug}-${lens.slug}`,
        interestId,
        title: `${lens.title}: ${topic.title}`,
        eyebrow: categoryEyebrows[interestId],
        readMinutes: detail.minutes,
        difficulty: detail.difficulty,
        paragraphs: stageParagraphs(examId, topic, lens),
        questions: informationalQuestions(examId, topic, lens),
      })),
    ),
  );
  const fantasy = fantasyWorlds.flatMap((_, worldIndex) =>
    fantasyEpisodes.map((__, episodeIndex) =>
      fantasyPassage(examId, worldIndex, episodeIndex),
    ),
  );
  return [...informational, ...fantasy] satisfies GeneratedInterestPassage[];
}
