import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

type UnitMeta = {
  unitId: string;
  unitTitle: string;
  scope: string;
  tags: string[];
};

type UnitSpec = UnitMeta & {
  start: string;
  end: string;
};

type WorkSpec = {
  workId: string;
  title: string;
  author: string;
  translator?: string;
  language: string;
  provider: "Project Gutenberg" | "Wikisource";
  workUrl: string;
  downloadUrl: string;
  rawFile: string;
  units: UnitSpec[];
};

const root = path.resolve(process.cwd(), "data/classics-staging");

const works: WorkSpec[] = [
  {
    workId: "aesop",
    title: "Three Hundred Aesop's Fables",
    author: "Traditional, attributed to Aesop",
    translator: "George Fyler Townsend",
    language: "English",
    provider: "Project Gutenberg",
    workUrl: "https://www.gutenberg.org/ebooks/21",
    downloadUrl: "https://www.gutenberg.org/cache/epub/21/pg21.txt",
    rawFile: "aesop/_raw/pg21.txt",
    units: [
      {
        unitId: "lion-and-mouse-townsend",
        unitTitle: "The Lion and the Mouse",
        scope: "The complete fable The Lion and the Mouse",
        tags: ["animals", "kindness", "reciprocity", "small-hero"],
        start: "\nThe Lion And The Mouse\n",
        end: "\nThe Wolf And The Lamb\n",
      },
      {
        unitId: "hare-and-tortoise",
        unitTitle: "The Hare and the Tortoise",
        scope: "The complete fable The Hare and the Tortoise",
        tags: ["animals", "patience", "effort", "consequences"],
        start: "\nThe Hare and the Tortoise\n",
        end: "\nThe Charcoal-Burner And The Fuller\n",
      },
      {
        unitId: "shepherd-boy-and-wolf",
        unitTitle: "The Shepherd's Boy and the Wolf",
        scope: "The complete fable The Shepherd's Boy and the Wolf",
        tags: ["animals", "honesty", "trust", "consequences"],
        start: "\nThe Shepherd’s Boy and the Wolf\n",
        end: "\nThe Boys and the Frogs\n",
      },
    ],
  },
  {
    workId: "alice",
    title: "Alice's Adventures in Wonderland",
    author: "Lewis Carroll",
    language: "English",
    provider: "Project Gutenberg",
    workUrl: "https://www.gutenberg.org/ebooks/11",
    downloadUrl: "https://www.gutenberg.org/cache/epub/11/pg11.txt",
    rawFile: "alice/_raw/pg11.txt",
    units: [
      {
        unitId: "down-the-rabbit-hole",
        unitTitle: "Down the Rabbit-Hole",
        scope: "Complete Chapter I",
        tags: ["fantasy", "curiosity", "discovery", "strange-world"],
        start: "\nCHAPTER I.\nDown the Rabbit-Hole\n",
        end: "\nCHAPTER II.\nThe Pool of Tears\n",
      },
      {
        unitId: "advice-from-a-caterpillar",
        unitTitle: "Advice from a Caterpillar",
        scope: "Complete Chapter V",
        tags: ["fantasy", "identity", "advice", "transformation"],
        start: "\nCHAPTER V.\nAdvice from a Caterpillar\n",
        end: "\nCHAPTER VI.\nPig and Pepper\n",
      },
      {
        unitId: "mad-tea-party",
        unitTitle: "A Mad Tea-Party",
        scope: "Complete Chapter VII",
        tags: ["fantasy", "riddles", "manners", "absurdity"],
        start: "\nCHAPTER VII.\nA Mad Tea-Party\n",
        end: "\nCHAPTER VIII.\nThe Queen’s Croquet-Ground\n",
      },
    ],
  },
  {
    workId: "secret-garden",
    title: "The Secret Garden",
    author: "Frances Hodgson Burnett",
    language: "English",
    provider: "Project Gutenberg",
    workUrl: "https://www.gutenberg.org/ebooks/113",
    downloadUrl: "https://www.gutenberg.org/cache/epub/113/pg113.txt",
    rawFile: "secret-garden/_raw/pg113.txt",
    units: [
      {
        unitId: "robin-showed-the-way",
        unitTitle: "The Robin Who Showed the Way",
        scope: "Complete Chapter VIII",
        tags: ["nature", "secret", "discovery", "animal-guide"],
        start: "\nCHAPTER VIII.\nTHE ROBIN WHO SHOWED THE WAY\n",
        end: "\nCHAPTER IX.\nTHE STRANGEST HOUSE ANYONE EVER LIVED IN\n",
      },
      {
        unitId: "dickon",
        unitTitle: "Dickon",
        scope: "Complete Chapter X",
        tags: ["friendship", "nature", "trust", "first-meeting"],
        start: "\nCHAPTER X.\nDICKON\n",
        end: "\nCHAPTER XI.\nTHE NEST OF THE MISSEL THRUSH\n",
      },
      {
        unitId: "a-tantrum",
        unitTitle: "A Tantrum",
        scope: "Complete Chapter XVII",
        tags: ["friendship", "courage", "conflict", "change"],
        start: "\nCHAPTER XVII.\nA TANTRUM\n",
        end: "\nCHAPTER XVIII.\n“THA’ MUNNOT WASTE NO TIME”\n",
      },
    ],
  },
  {
    workId: "treasure-island",
    title: "Treasure Island",
    author: "Robert Louis Stevenson",
    language: "English",
    provider: "Project Gutenberg",
    workUrl: "https://www.gutenberg.org/ebooks/120",
    downloadUrl: "https://www.gutenberg.org/cache/epub/120/pg120.txt",
    rawFile: "treasure-island/_raw/pg120.txt",
    units: [
      {
        unitId: "captain-and-black-spot",
        unitTitle: "The Captain and the Black Spot",
        scope: "Complete Chapters I-III",
        tags: ["adventure", "danger", "mystery", "warning"],
        start: "\nI\nThe Old Sea-dog at the Admiral Benbow\n",
        end: "\nIV\nThe Sea-chest\n",
      },
      {
        unitId: "sea-chest-and-map",
        unitTitle: "The Sea-Chest and the Map",
        scope: "Complete Chapters IV-VI",
        tags: ["adventure", "escape", "treasure-map", "choice"],
        start: "\nIV\nThe Sea-chest\n",
        end: "\nPART TWO--The Sea-cook\n",
      },
      {
        unitId: "apple-barrel-secret",
        unitTitle: "The Apple-Barrel Secret",
        scope: "Complete Chapters XI-XII",
        tags: ["adventure", "betrayal", "eavesdropping", "trust"],
        start: "\nXI\nWhat I Heard in the Apple-Barrel\n",
        end: "\nPART THREE--My Shore Adventure\n",
      },
    ],
  },
];

function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function cleanNewlines(value: string) {
  return value.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
}

function sliceUnit(raw: string, spec: UnitSpec) {
  const start = raw.indexOf(spec.start);
  const end = raw.indexOf(spec.end, start + spec.start.length);
  if (start < 0 || end < 0) throw new Error(`Cannot locate ${spec.unitId}`);
  return raw.slice(start + 1, end).trim();
}

function paragraphize(value: string, language: string) {
  const cleaned = value.replace(/^\s*\*\*\* START OF[\s\S]*?\*\*\*\s*/i, "");
  const blocks = (language === "Chinese" ? cleaned.split(/\n+/) : cleaned.split(/\n\s*\n+/))
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => language === "Chinese"
      ? block.replace(/^:+/, "").trim()
      : block.replace(/\n+/g, " ").replace(/[ \t]+/g, " "));
  return `${blocks.map((block, index) => `p${String(index + 1).padStart(3, "0")}\t${block}`).join("\n\n")}\n`;
}

function sourceVersion(raw: string, fallback: string) {
  return raw.match(/Most recently updated:\s*([^\n]+)/i)?.[1]?.trim() ?? fallback;
}

function writeUnit(work: WorkSpec, unit: UnitMeta, body: string, rawPaths: string[], revisionIds: number[] = []) {
  const source = paragraphize(body, work.language);
  const directory = path.join(root, work.workId, unit.unitId);
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, "source.txt"), source);
  const rawBuffers = rawPaths.map((rawPath) => readFileSync(path.join(root, rawPath)));
  const manifest = {
    status: "pending_editorial_review",
    workId: work.workId,
    unitId: unit.unitId,
    title: work.title,
    unitTitle: unit.unitTitle,
    author: work.author,
    ...(work.translator ? { translator: work.translator } : {}),
    language: work.language,
    sourceProvider: work.provider,
    sourceWorkUrl: work.workUrl,
    sourceDownloadUrl: work.downloadUrl,
    scope: unit.scope,
    sourceVersion: sourceVersion(rawBuffers[0].toString("utf8"), revisionIds.length ? `Wikisource revisions ${revisionIds.join(", ")}` : "downloaded source"),
    sourceRevisionIds: revisionIds,
    rawFiles: rawPaths.map((rawPath, index) => ({ path: rawPath, sha256: sha256(rawBuffers[index]) })),
    sourceHash: sha256(source),
    paragraphCount: (source.match(/^p\d+\t/gm) ?? []).length,
    wordCount: work.language === "English" ? (source.match(/[A-Za-z]+(?:[’'-][A-Za-z]+)*/g) ?? []).length : undefined,
    characterCount: work.language === "Chinese" ? (source.match(/[\p{Script=Han}]/gu) ?? []).length : undefined,
    tags: unit.tags,
    cleaning: "Mechanical extraction only: line endings normalized, wrapped prose joined, and stable paragraph IDs added.",
    usageBasis: work.provider === "Project Gutenberg"
      ? "Public-domain edition distributed by Project Gutenberg; verify rights in the target publication region."
      : "Text hosted by Chinese Wikisource; verify the page history, license, and target-region rights before publication.",
  };
  writeFileSync(path.join(directory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

const catalog: unknown[] = [];
for (const work of works) {
  const raw = cleanNewlines(readFileSync(path.join(root, work.rawFile), "utf8"));
  for (const unit of work.units) catalog.push(writeUnit(work, unit, sliceUnit(raw, unit), [work.rawFile]));
}

const journeyWork: WorkSpec = {
  workId: "journey-to-the-west",
  title: "西遊記",
  author: "吳承恩",
  language: "Chinese",
  provider: "Project Gutenberg",
  workUrl: "https://zh.wikisource.org/wiki/西遊記",
  downloadUrl: "https://zh.wikisource.org/w/api.php",
  rawFile: "journey-to-the-west/_raw/chapter-016.json",
  units: [],
};

for (const unit of [
  { unitId: "black-wind-mountain", unitTitle: "觀音院與黑風山", scope: "完整第十六至十七回", tags: ["團隊", "冒險", "貪念", "取回袈裟"], chapters: [16, 17] },
  { unitId: "meeting-zhu-bajie", unitTitle: "高老莊收八戒", scope: "完整第十八至十九回", tags: ["團隊", "判斷", "改過", "新夥伴"], chapters: [18, 19] },
  { unitId: "yellow-wind-demon", unitTitle: "黃風嶺降風魔", scope: "完整第二十至二十一回", tags: ["冒險", "勇氣", "合作", "解救"], chapters: [20, 21] },
]) {
  const rawPaths = unit.chapters.map((chapter) => `journey-to-the-west/_raw/chapter-${String(chapter).padStart(3, "0")}.json`);
  const pages = rawPaths.map((rawPath) => JSON.parse(readFileSync(path.join(root, rawPath), "utf8")) as {
    parse: { revid: number; wikitext: string };
  });
  const body = pages.map((page) => cleanNewlines(page.parse.wikitext)
    .replace(/^\{\{header[\s\S]*?\n\}\}\s*/, "")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/\[\[(?:[^\]|]+\|)?([^\]]+)\]\]/g, "$1")
    .replace(/''+/g, "")
    .trim()).join("\n\n");
  catalog.push(writeUnit(
    { ...journeyWork, provider: "Wikisource" },
    unit,
    body,
    rawPaths,
    pages.map((page) => page.parse.revid),
  ));
}

writeFileSync(path.join(root, "catalog.json"), `${JSON.stringify({
  status: "staging",
  unitCount: catalog.length,
  units: catalog,
}, null, 2)}\n`);

console.log(`Prepared ${catalog.length} pending-review classic units in ${root}`);
