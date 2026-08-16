import type { AppDatabase } from "./database";
import {
  ECDICT_LICENSE_URL,
  ECDICT_SOURCE_URL,
  ECDICT_SOURCE_VERSION,
  type EcdictDictionary,
} from "./ecdict";
import { ApiError } from "./http";

const READY_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MISS_TTL_MS = 15 * 60 * 1000;

const LOCAL_TRANSLATIONS: Record<string, string> = {
  deliver: "递送；运送；交付",
  delivering: "递送；运送；交付",
  cargo: "货物；货运",
  medical: "医学的；医疗的",
  supplies: "物资；补给品",
};

export type PronunciationAccent = "us" | "uk";

type CachedPronunciation = {
  word: string;
  accent: PronunciationAccent;
  phonetic: string;
  actualAccent: string | null;
  sourceUrl: string | null;
  licenseName: string | null;
  licenseUrl: string | null;
  audioMime: string | null;
  audioBlob: Uint8Array | null;
  status: "ready" | "tts_only";
  definition: string;
  translation: string;
  partOfSpeech: string;
  example: string;
  exampleTranslation: string;
  lexicalSource: string;
  updatedAt: string;
};

export type PronunciationResult = Omit<
  CachedPronunciation,
  "audioBlob" | "audioMime" | "updatedAt" | "lexicalSource"
> & {
  hasAudio: boolean;
  cached: boolean;
};

function cachedRow(
  db: AppDatabase,
  word: string,
  accent: PronunciationAccent,
) {
  return db
    .prepare(
      `SELECT word, accent, phonetic, actual_accent AS actualAccent,
        source_url AS sourceUrl, license_name AS licenseName,
        license_url AS licenseUrl, audio_mime AS audioMime,
        audio_blob AS audioBlob, status,
        definition_en AS definition, translation_zh AS translation,
        part_of_speech AS partOfSpeech, example_en AS example,
        example_zh AS exampleTranslation, lexical_source AS lexicalSource,
        updated_at AS updatedAt
       FROM pronunciation_cache WHERE word = ? AND accent = ?`,
    )
    .get(word, accent) as CachedPronunciation | undefined;
}

function isFresh(row: CachedPronunciation) {
  const timestamp = row.updatedAt.endsWith("Z")
    ? row.updatedAt
    : `${row.updatedAt.replace(" ", "T")}Z`;
  const age = Date.now() - new Date(timestamp).getTime();
  const hasLexicalData = Boolean(row.translation || row.definition);
  return age < (hasLexicalData ? READY_TTL_MS : MISS_TTL_MS);
}

function publicResult(
  row: CachedPronunciation,
  cached: boolean,
): PronunciationResult {
  return {
    word: row.word,
    accent: row.accent,
    phonetic: row.phonetic,
    actualAccent: row.actualAccent,
    sourceUrl: row.sourceUrl,
    licenseName: row.licenseName,
    licenseUrl: row.licenseUrl,
    status: row.status,
    definition: row.definition,
    translation: row.translation,
    partOfSpeech: row.partOfSpeech,
    example: row.example,
    exampleTranslation: row.exampleTranslation,
    hasAudio: Boolean(row.audioBlob),
    cached,
  };
}

function saveCache(db: AppDatabase, row: Omit<CachedPronunciation, "updatedAt">) {
  db.prepare(
    `INSERT INTO pronunciation_cache(
      word, accent, phonetic, actual_accent, source_url, license_name,
      license_url, audio_mime, audio_blob, status, definition_en,
      translation_zh, part_of_speech, example_en, example_zh,
      lexical_source, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(word, accent) DO UPDATE SET
      phonetic = excluded.phonetic,
      actual_accent = excluded.actual_accent,
      source_url = excluded.source_url,
      license_name = excluded.license_name,
      license_url = excluded.license_url,
      audio_mime = excluded.audio_mime,
      audio_blob = excluded.audio_blob,
      status = excluded.status,
      definition_en = excluded.definition_en,
      translation_zh = excluded.translation_zh,
      part_of_speech = excluded.part_of_speech,
      example_en = excluded.example_en,
      example_zh = excluded.example_zh,
      lexical_source = excluded.lexical_source,
      updated_at = CURRENT_TIMESTAMP`,
  ).run(
    row.word,
    row.accent,
    row.phonetic,
    row.actualAccent,
    row.sourceUrl,
    row.licenseName,
    row.licenseUrl,
    row.audioMime,
    row.audioBlob,
    row.status,
    row.definition,
    row.translation,
    row.partOfSpeech,
    row.example,
    row.exampleTranslation,
    row.lexicalSource,
  );
}

const pronunciationLookups = new Map<string, Promise<PronunciationResult>>();

async function lookupPronunciationUncached(
  db: AppDatabase,
  word: string,
  accent: PronunciationAccent,
  context: string,
  dictionary: EcdictDictionary | null,
) {
  const prior = cachedRow(db, word, accent);
  const sourceMatches = dictionary
    ? prior?.lexicalSource === ECDICT_SOURCE_VERSION
    : true;
  if (
    prior &&
    sourceMatches &&
    isFresh(prior) &&
    Boolean(prior.translation || prior.definition)
  ) {
    return publicResult(
      dictionary && context.trim()
        ? { ...prior, example: context.trim(), exampleTranslation: "" }
        : prior,
      true,
    );
  }

  const entry = dictionary?.lookup(word) ?? null;
  const row: Omit<CachedPronunciation, "updatedAt"> = {
    word,
    accent,
    phonetic: entry?.phonetic ?? (dictionary ? "" : prior?.phonetic ?? ""),
    actualAccent: prior?.actualAccent ?? null,
    sourceUrl: entry ? ECDICT_SOURCE_URL : null,
    licenseName: entry ? "ECDICT (MIT)" : null,
    licenseUrl: entry ? ECDICT_LICENSE_URL : null,
    audioMime: prior?.audioMime ?? null,
    audioBlob: prior?.audioBlob ?? null,
    status: prior?.audioBlob ? "ready" : "tts_only",
    definition: entry?.definition ?? (dictionary ? "" : prior?.definition ?? ""),
    translation:
      entry?.translation ??
      LOCAL_TRANSLATIONS[word] ??
      (dictionary ? "" : prior?.translation ?? ""),
    partOfSpeech:
      entry?.partOfSpeech ?? (dictionary ? "" : prior?.partOfSpeech ?? ""),
    example: dictionary ? "" : context.trim() || prior?.example || "",
    exampleTranslation: dictionary ? "" : prior?.exampleTranslation ?? "",
    lexicalSource: dictionary ? ECDICT_SOURCE_VERSION : "local-fallback",
  };
  saveCache(db, row);
  const responseRow =
    dictionary && context.trim() ? { ...row, example: context.trim() } : row;
  return publicResult(
    { ...responseRow, updatedAt: new Date().toISOString() },
    false,
  );
}

export function lookupPronunciation(
  db: AppDatabase,
  word: string,
  accent: PronunciationAccent,
  context = "",
  _includeAudio = false,
  dictionary: EcdictDictionary | null = null,
): Promise<PronunciationResult> {
  const key = `${word}:${accent}:${context}:${dictionary ? ECDICT_SOURCE_VERSION : "fallback"}`;
  const existing = pronunciationLookups.get(key);
  if (existing) return existing;
  const lookup = lookupPronunciationUncached(
    db,
    word,
    accent,
    context,
    dictionary,
  ).finally(() => pronunciationLookups.delete(key));
  pronunciationLookups.set(key, lookup);
  return lookup;
}

export async function pronunciationAudio(
  db: AppDatabase,
  word: string,
  accent: PronunciationAccent,
) {
  const row = cachedRow(db, word, accent);
  if (!row?.audioBlob) {
    throw new ApiError(
      404,
      "PRONUNCIATION_AUDIO_NOT_FOUND",
      "该单词暂无真人发音，请使用设备语音朗读",
    );
  }
  return { data: row.audioBlob, mime: row.audioMime ?? "audio/mpeg" };
}
