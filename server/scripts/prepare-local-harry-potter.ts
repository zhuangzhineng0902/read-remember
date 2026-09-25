import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const sourceArg = process.argv.indexOf("--source");
const sourcePath = path.resolve(sourceArg >= 0
  ? process.argv[sourceArg + 1]
  : "/Users/zhuangzhineng/Downloads/哈利波特1-7英文原版.txt");
const root = path.resolve(process.cwd(), "data/classics-staging");
const catalogPath = path.join(root, "catalog.json");
const rawBuffer = readFileSync(sourcePath);
const raw = new TextDecoder("gb18030").decode(rawBuffer).replace(/\r\n?/g, "\n");

const units = [
  { book: 1, unitId: "book-1-the-boy-who-lived", title: "Harry Potter and the Sorcerer's Stone", unitTitle: "The Boy Who Lived", start: /^\s*CHAPTER ONE\s*$/mi, end: /^\s*CHAPTER TWO\s*$/mi, tags: ["mystery", "family", "magic", "new-beginning"] },
  { book: 2, unitId: "book-2-the-worst-birthday", title: "Harry Potter and the Chamber of Secrets", unitTitle: "The Worst Birthday", start: /^\s*CHAPTER[\t ]+ONE\s*$/mi, end: /^\s*CHAPTER[\t ]+TWO\s*$/mi, tags: ["family", "friendship", "secrecy", "unexpected-visitor"] },
  { book: 3, unitId: "book-3-owl-post", title: "Harry Potter and the Prisoner of Azkaban", unitTitle: "Owl Post", start: /^\s*CHAPTER ONE\s*$/mi, end: /^\s*CHAPTER TWO\s*$/mi, tags: ["friendship", "letters", "school", "anticipation"] },
  { book: 4, unitId: "book-4-the-riddle-house", title: "Harry Potter and the Goblet of Fire", unitTitle: "The Riddle House", start: /^\s*CHAPTER ONE - THE RIDDLE HOUSE\s*$/mi, end: /^\s*CHAPTER TWO - THE SCAR\s*$/mi, tags: ["mystery", "danger", "secrets", "dark-atmosphere"] },
  { book: 5, unitId: "book-5-dudley-demented", title: "Harry Potter and the Order of the Phoenix", unitTitle: "Dudley Demented", start: /^\s*- CHAPTER ONE -\s*$/mi, end: /^\s*- CHAPTER TWO -\s*$/mi, tags: ["danger", "family", "defense", "unexpected-ally"] },
  { book: 6, unitId: "book-6-the-other-minister", title: "Harry Potter and the Half-Blood Prince", unitTitle: "The Other Minister", start: /^\s*Chapter 1: The Other Minister\s*$/mi, end: /^\s*Chapter 2: Spinner's End\s*$/mi, startOccurrence: 2, tags: ["leadership", "crisis", "two-worlds", "politics"] },
  { book: 7, unitId: "book-7-the-dark-lord-ascending", title: "Harry Potter and the Deathly Hallows", unitTitle: "The Dark Lord Ascending", start: /^\s*Chapter One\s*$/mi, end: /^\s*Chapter Two\s*$/mi, tags: ["danger", "loyalty", "conflict", "dark-atmosphere"] },
] as const;

function sha256(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

function bookText(book: number) {
  const marker = new RegExp(`^${book}\\.Harry Potter.*$`, "m").exec(raw);
  if (!marker) throw new Error(`Cannot locate book ${book}`);
  const next = new RegExp(`^${book + 1}\\.Harry Potter.*$`, "m").exec(raw.slice(marker.index + marker[0].length));
  const end = next ? marker.index + marker[0].length + next.index : raw.length;
  return raw.slice(marker.index, end);
}

function nthMatch(text: string, expression: RegExp, occurrence = 1) {
  const regex = new RegExp(expression.source, expression.flags.includes("g") ? expression.flags : `${expression.flags}g`);
  let match: RegExpExecArray | null = null;
  for (let index = 0; index < occurrence; index += 1) match = regex.exec(text);
  if (!match) throw new Error(`Cannot locate occurrence ${occurrence} of ${expression}`);
  return match;
}

function paragraphize(value: string, oneLinePerParagraph = false) {
  const paragraphs: string[] = [];
  let current: string[] = [];
  const flush = () => {
    const paragraph = current.join(" ").replace(/\s+/g, " ").trim();
    if (paragraph) paragraphs.push(paragraph);
    current = [];
  };
  for (const rawLine of value.replace(/\f/g, "\n").split("\n")) {
    const line = rawLine.trim();
    if (!line || /^\d+$/.test(line)) { flush(); continue; }
    if (/^(?:　{2}| {4,})\S/.test(rawLine)) flush();
    current.push(line);
    if (oneLinePerParagraph || /^　{2}\S/.test(rawLine)) flush();
  }
  flush();
  return `${paragraphs.map((paragraph, index) => `p${String(index + 1).padStart(3, "0")}\t${paragraph}`).join("\n\n")}\n`;
}

const existing = JSON.parse(readFileSync(catalogPath, "utf8")) as { units: Array<Record<string, unknown>> };
const imported: Array<Record<string, unknown>> = [];
for (const unit of units) {
  const book = bookText(unit.book);
  const start = nthMatch(book, unit.start, "startOccurrence" in unit ? unit.startOccurrence : 1);
  const end = nthMatch(book.slice(start.index + start[0].length), unit.end);
  const body = book.slice(start.index + start[0].length, start.index + start[0].length + end.index);
  const source = paragraphize(body, unit.book === 6);
  const sourceHash = sha256(source);
  const directory = path.join(root, "harry-potter", unit.unitId);
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, "source.txt"), source);
  const manifest = {
    status: "pending_editorial_review",
    workId: "harry-potter",
    unitId: unit.unitId,
    title: unit.title,
    unitTitle: unit.unitTitle,
    author: "J. K. Rowling",
    language: "English",
    sourceProvider: "Local user-provided file",
    sourceWorkUrl: "local://harry-potter-1-7",
    sourceDownloadUrl: "local://harry-potter-1-7",
    scope: `Complete opening chapter: ${unit.unitTitle}`,
    sourceVersion: `local-${sha256(rawBuffer).slice(0, 16)}`,
    sourceHash,
    paragraphCount: (source.match(/^p\d+\t/gm) ?? []).length,
    wordCount: (source.match(/[A-Za-z]+(?:[’'-][A-Za-z]+)*/g) ?? []).length,
    tags: unit.tags,
    cleaning: "GB18030 decoded to UTF-8; page numbers removed; wrapped prose joined; stable paragraph IDs added.",
    usageBasis: "User-provided local text. Copyright/permission has not been verified; private local adaptation only. Do not publish or redistribute.",
    localSourceFile: path.basename(sourcePath),
    localSourceHash: sha256(rawBuffer),
  };
  writeFileSync(path.join(directory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  imported.push(manifest);
}

const importedIds = new Set(imported.map((unit) => `${unit.workId}/${unit.unitId}`));
existing.units = [
  ...existing.units.filter((unit) => !importedIds.has(`${unit.workId}/${unit.unitId}`)),
  ...imported,
];
writeFileSync(catalogPath, `${JSON.stringify({ status: "staging", unitCount: existing.units.length, units: existing.units }, null, 2)}\n`);
console.log(`Prepared ${imported.length} local Harry Potter units for editorial-base generation.`);
