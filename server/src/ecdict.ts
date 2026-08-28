import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";

const { DatabaseSync } = createRequire(import.meta.url)(
  "node:sqlite",
) as typeof import("node:sqlite");

export const ECDICT_SOURCE_VERSION = "ecdict-1.0.28-v2";
export const ECDICT_SOURCE_URL = "https://github.com/skywind3000/ECDICT";
export const ECDICT_LICENSE_URL =
  "https://github.com/skywind3000/ECDICT/blob/master/LICENSE";

type EcdictRow = {
  word: string;
  phonetic: string | null;
  definition: string | null;
  translation: string | null;
  pos: string | null;
  exchange: string | null;
};

type EcdictFrequencyRow = {
  frq: number | null;
  bnc: number | null;
  exchange: string | null;
};

export type EcdictEntry = {
  word: string;
  phonetic: string;
  definition: string;
  translation: string;
  partOfSpeech: string;
};

const partOfSpeechNames: Record<string, string> = {
  a: "adjective",
  c: "conjunction",
  d: "determiner",
  i: "preposition",
  j: "adjective",
  m: "number",
  n: "noun",
  o: "interjection",
  p: "pronoun",
  q: "modal verb",
  r: "adverb",
  u: "auxiliary",
  v: "verb",
  x: "other",
};

function normalizeWord(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z'-]/g, "");
}

function lexicalCandidates(value: string) {
  const word = normalizeWord(value);
  const candidates = [word];
  if (word.endsWith("ies") || word.endsWith("ied")) {
    candidates.push(`${word.slice(0, -3)}y`);
  }
  if (word.endsWith("ing")) {
    const stem = word.slice(0, -3);
    candidates.push(stem, `${stem}e`);
    if (/([b-df-hj-np-tv-z])\1$/.test(stem)) {
      candidates.push(stem.slice(0, -1));
    }
  }
  if (word.endsWith("ed")) {
    const stem = word.slice(0, -2);
    candidates.push(stem, `${stem}e`);
    if (/([b-df-hj-np-tv-z])\1$/.test(stem)) {
      candidates.push(stem.slice(0, -1));
    }
  }
  if (word.endsWith("es")) candidates.push(word.slice(0, -2));
  if (word.endsWith("s") && !word.endsWith("ss")) {
    candidates.push(word.slice(0, -1));
  }
  return candidates.filter(
    (candidate, index, values) =>
      candidate.length > 1 && values.indexOf(candidate) === index,
  );
}

function lemmaFromExchange(exchange: string | null) {
  return exchange
    ?.split("/")
    .find((item) => item.startsWith("0:"))
    ?.slice(2)
    .trim();
}

function parsePartOfSpeech(value: string | null) {
  if (!value) return "";
  const ranked = value
    .split("/")
    .map((item) => {
      const [code, weight] = item.split(":");
      return { code: code?.trim().toLowerCase(), weight: Number(weight ?? 0) };
    })
    .filter((item) => item.code)
    .sort((left, right) => right.weight - left.weight);
  return partOfSpeechNames[ranked[0]?.code ?? ""] ?? "";
}

function serializeRow(row: EcdictRow): EcdictEntry {
  const phonetic = row.phonetic?.trim().replace(/^\/+|\/+$/g, "") ?? "";
  return {
    word: row.word,
    phonetic: phonetic ? `/${phonetic}/` : "",
    definition: row.definition?.trim() ?? "",
    translation: row.translation?.trim() ?? "",
    partOfSpeech: parsePartOfSpeech(row.pos),
  };
}

export class EcdictDictionary {
  private readonly frequencyCache = new Map<string, number | null>();

  constructor(
    private readonly db: DatabaseSyncType,
    readonly filename: string,
  ) {}

  lookup(value: string): EcdictEntry | null {
    const select = this.db.prepare(
      `SELECT word, phonetic, definition, translation, pos, exchange
       FROM stardict WHERE word = ? COLLATE NOCASE LIMIT 1`,
    );
    const candidates = lexicalCandidates(value);
    let fallback: EcdictRow | undefined;
    for (const candidate of candidates) {
      const row = select.get(candidate) as EcdictRow | undefined;
      if (!row) continue;
      fallback ??= row;
      const serialized = serializeRow(row);
      const lemma = lemmaFromExchange(row.exchange);
      if (lemma && lemma !== candidate) {
        const lemmaRow = select.get(lemma) as EcdictRow | undefined;
        if (lemmaRow) {
          const lemmaEntry = serializeRow(lemmaRow);
          const merged = {
            word: serialized.word,
            phonetic: serialized.phonetic || lemmaEntry.phonetic,
            definition: serialized.definition || lemmaEntry.definition,
            translation: serialized.translation || lemmaEntry.translation,
            partOfSpeech:
              serialized.partOfSpeech || lemmaEntry.partOfSpeech,
          };
          if (merged.translation) return merged;
        }
      }
      if (serialized.translation) return serialized;
    }
    return fallback ? serializeRow(fallback) : null;
  }

  frequencyRank(value: string): number | null {
    const normalized = normalizeWord(value);
    if (!normalized) return null;
    if (this.frequencyCache.has(normalized)) {
      return this.frequencyCache.get(normalized) ?? null;
    }
    const select = this.db.prepare(
      `SELECT frq, bnc, exchange
       FROM stardict WHERE word = ? COLLATE NOCASE LIMIT 1`,
    );
    const ranks: number[] = [];
    for (const candidate of lexicalCandidates(normalized)) {
      const row = select.get(candidate) as EcdictFrequencyRow | undefined;
      if (!row) continue;
      if (row.frq && row.frq > 0) ranks.push(row.frq);
      if (row.bnc && row.bnc > 0) ranks.push(row.bnc);
      const lemma = lemmaFromExchange(row.exchange);
      if (lemma && lemma !== candidate) {
        const lemmaRow = select.get(lemma) as EcdictFrequencyRow | undefined;
        if (lemmaRow?.frq && lemmaRow.frq > 0) ranks.push(lemmaRow.frq);
        if (lemmaRow?.bnc && lemmaRow.bnc > 0) ranks.push(lemmaRow.bnc);
      }
    }
    const rank = ranks.length ? Math.min(...ranks) : null;
    this.frequencyCache.set(normalized, rank);
    return rank;
  }

  close() {
    this.db.close();
  }
}

export function openEcdict(filename: string) {
  if (!existsSync(filename)) return null;
  const db = new DatabaseSync(filename, { readOnly: true });
  const table = db
    .prepare(
      "SELECT 1 AS found FROM sqlite_schema WHERE type = 'table' AND name = 'stardict'",
    )
    .get() as { found: number } | undefined;
  if (!table) {
    db.close();
    throw new Error(`ECDICT SQLite 缺少 stardict 表：${filename}`);
  }
  db.exec("PRAGMA query_only = ON");
  return new EcdictDictionary(db, filename);
}
