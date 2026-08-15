import type { AppDatabase } from "./database";
import { ApiError } from "./http";

const DICTIONARY_API = "https://api.dictionaryapi.dev/api/v2/entries/en";
const GOOGLE_DICTIONARY_AUDIO =
  "https://ssl.gstatic.com/dictionary/static/sounds/20200429";
const READY_TTL_MS = 30 * 24 * 60 * 60 * 1000;
// Keep misses short: upstream audio availability changes independently of
// definitions, and an alternate provider may become available quickly.
const MISS_TTL_MS = 15 * 60 * 1000;
const MAX_AUDIO_BYTES = 2_000_000;
const DICTIONARY_TIMEOUT_MS = 4_000;
const TRANSLATION_TIMEOUT_MS = 3_500;
const AUDIO_TIMEOUT_MS = 4_000;

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
  updatedAt: string;
};

type DictionaryPhonetic = {
  text?: string;
  audio?: string;
  sourceUrl?: string;
  license?: { name?: string; url?: string };
};

type DictionaryEntry = {
  phonetic?: string;
  phonetics?: DictionaryPhonetic[];
  sourceUrls?: string[];
  license?: { name?: string; url?: string };
  meanings?: Array<{
    partOfSpeech?: string;
    definitions?: Array<{ definition?: string; example?: string }>;
  }>;
};

export type PronunciationResult = Omit<
  CachedPronunciation,
  "audioBlob" | "audioMime" | "updatedAt"
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
      `
      SELECT word, accent, phonetic, actual_accent AS actualAccent,
        source_url AS sourceUrl, license_name AS licenseName,
        license_url AS licenseUrl, audio_mime AS audioMime,
        audio_blob AS audioBlob, status,
        definition_en AS definition, translation_zh AS translation,
        part_of_speech AS partOfSpeech, example_en AS example,
        example_zh AS exampleTranslation, updated_at AS updatedAt
      FROM pronunciation_cache WHERE word = ? AND accent = ?
    `,
    )
    .get(word, accent) as CachedPronunciation | undefined;
}

function isFresh(row: CachedPronunciation) {
  const age = Date.now() - new Date(`${row.updatedAt}Z`).getTime();
  return age < (row.status === "ready" ? READY_TTL_MS : MISS_TTL_MS);
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
    hasAudio: !!row.audioBlob,
    cached,
  };
}

function absoluteAudioUrl(value: string) {
  if (value.startsWith("//")) return `https:${value}`;
  return value;
}

function inferAccent(url: string) {
  const value = url.toLowerCase();
  if (/[-_/](us|american)([-_.?/]|$)/.test(value)) return "us";
  if (/[-_/](uk|gb|british)([-_.?/]|$)/.test(value)) return "uk";
  if (/[-_/](au|australian)([-_.?/]|$)/.test(value)) return "au";
  return "unknown";
}

function phoneticCandidates(
  entries: DictionaryEntry[],
  accent: PronunciationAccent,
) {
  const candidates = entries.flatMap((entry) =>
    (entry.phonetics ?? []).map((phonetic) => ({ phonetic, entry })),
  );
  const withAudio = candidates
    .filter(({ phonetic }) => phonetic.audio)
    .sort((left, right) => {
      const leftMatches = inferAccent(left.phonetic.audio ?? "") === accent;
      const rightMatches = inferAccent(right.phonetic.audio ?? "") === accent;
      return Number(rightMatches) - Number(leftMatches);
    });
  const selected = withAudio[0];
  const text =
    selected?.phonetic.text ??
    candidates.find(({ phonetic }) => phonetic.text)?.phonetic.text ??
    entries.find((entry) => entry.phonetic)?.phonetic ??
    "";
  return { candidates: withAudio, selected, text };
}

type AudioCandidate = {
  url: string;
  accent: string;
  sourceUrl: string | null;
  licenseName: string | null;
  licenseUrl: string | null;
};

function alternateAudioCandidate(
  word: string,
  accent: PronunciationAccent,
): AudioCandidate {
  const code = accent === "uk" ? "gb" : "us";
  return {
    url: `${GOOGLE_DICTIONARY_AUDIO}/${encodeURIComponent(word)}--_${code}_1.mp3`,
    accent,
    sourceUrl: `${GOOGLE_DICTIONARY_AUDIO}/${encodeURIComponent(word)}--_${code}_1.mp3`,
    licenseName: "Google Dictionary audio",
    licenseUrl: "https://policies.google.com/terms",
  };
}

async function downloadAudio(candidates: AudioCandidate[]) {
  for (const candidate of candidates) {
    try {
      const response = await fetch(candidate.url, {
        headers: { accept: "audio/*" },
        signal: AbortSignal.timeout(AUDIO_TIMEOUT_MS),
      });
      const contentLength = Number(response.headers.get("content-length") ?? 0);
      const contentType = response.headers.get("content-type") ?? "";
      if (
        !response.ok ||
        (contentLength && contentLength > MAX_AUDIO_BYTES) ||
        !contentType.toLowerCase().startsWith("audio/")
      ) {
        continue;
      }
      const buffer = new Uint8Array(await response.arrayBuffer());
      if (buffer.byteLength > 0 && buffer.byteLength <= MAX_AUDIO_BYTES) {
        return {
          ...candidate,
          data: buffer,
          mime: contentType || "audio/mpeg",
        };
      }
    } catch {
      // Try the next recording/provider before falling back to device TTS.
    }
  }
  return null;
}

function saveCache(db: AppDatabase, row: Omit<CachedPronunciation, "updatedAt">) {
  db.prepare(
    `
    INSERT INTO pronunciation_cache(
      word, accent, phonetic, actual_accent, source_url, license_name,
      license_url, audio_mime, audio_blob, status, definition_en,
      translation_zh, part_of_speech, example_en, example_zh, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
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
      updated_at = CURRENT_TIMESTAMP
  `,
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
  );
}

async function translateToChinese(text: string) {
  if (!text) return "";
  try {
    const url = new URL("https://api.mymemory.translated.net/get");
    url.searchParams.set("q", text.slice(0, 450));
    url.searchParams.set("langpair", "en|zh-CN");
    const response = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(TRANSLATION_TIMEOUT_MS),
    });
    if (!response.ok) return "";
    const payload = (await response.json()) as {
      responseStatus?: number;
      responseData?: { translatedText?: string };
    };
    return payload.responseStatus === 200
      ? (payload.responseData?.translatedText?.trim() ?? "")
      : "";
  } catch {
    return "";
  }
}

const pronunciationLookups = new Map<string, Promise<PronunciationResult>>();

async function lookupPronunciationUncached(
  db: AppDatabase,
  word: string,
  accent: PronunciationAccent,
  context = "",
  includeAudio = false,
): Promise<PronunciationResult> {
  const prior = cachedRow(db, word, accent);
  const hasLexicalCache = !!(
    prior?.phonetic ||
    prior?.translation ||
    prior?.definition
  );
  if (
    prior &&
    isFresh(prior) &&
    hasLexicalCache &&
    (!includeAudio || !!prior.audioBlob)
  ) {
    return publicResult(prior, true);
  }

  const contextualExample = context.trim();
  const wordTranslation = prior?.translation
    ? Promise.resolve(prior.translation)
    : translateToChinese(word);
  const contextualTranslation = prior?.exampleTranslation
    ? Promise.resolve(prior.exampleTranslation)
    : contextualExample
      ? translateToChinese(contextualExample)
      : Promise.resolve("");

  let entries: DictionaryEntry[] = [];
  try {
    const response = await fetch(`${DICTIONARY_API}/${encodeURIComponent(word)}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(DICTIONARY_TIMEOUT_MS),
    });
    if (response.ok) {
      const payload: unknown = await response.json();
      entries = Array.isArray(payload) ? (payload as DictionaryEntry[]) : [];
    }
  } catch {
    if (prior) return publicResult(prior, true);
  }

  const { candidates: dictionaryAudio, selected, text } = phoneticCandidates(
    entries,
    accent,
  );
  const matchingDictionaryAudio = dictionaryAudio.filter(
    ({ phonetic }) => inferAccent(phonetic.audio!) === accent,
  );
  const otherDictionaryAudio = dictionaryAudio.filter(
    ({ phonetic }) => inferAccent(phonetic.audio!) !== accent,
  );
  const toAudioCandidate = ({ phonetic, entry }: (typeof dictionaryAudio)[number]) => ({
    url: absoluteAudioUrl(phonetic.audio!),
    accent: inferAccent(phonetic.audio!),
    sourceUrl: phonetic.sourceUrl ?? entry.sourceUrls?.[0] ?? null,
    licenseName: phonetic.license?.name ?? entry.license?.name ?? null,
    licenseUrl: phonetic.license?.url ?? entry.license?.url ?? null,
  });
  const audioCandidates: AudioCandidate[] = [
    ...matchingDictionaryAudio.map(toAudioCandidate),
    alternateAudioCandidate(word, accent),
    ...otherDictionaryAudio.map(toAudioCandidate),
  ];
  const downloadedAudio = includeAudio
    ? await downloadAudio(audioCandidates)
    : null;

  const entry = selected?.entry ?? entries[0];
  const meaning = entries
    .flatMap((item) => item.meanings ?? [])
    .find((item) => item.definitions?.some((definition) => definition.definition));
  const definitionItem =
    meaning?.definitions?.find((item) => item.example) ??
    meaning?.definitions?.find((item) => item.definition);
  const definition =
    prior?.definition || definitionItem?.definition?.trim() || "";
  const example =
    prior?.example || contextualExample || definitionItem?.example?.trim() || "";
  const translation = await wordTranslation;
  const exampleTranslation =
    (await contextualTranslation) ||
    (example ? await translateToChinese(example) : "");
  const audioBlob = downloadedAudio?.data ?? prior?.audioBlob ?? null;
  const audioMime = downloadedAudio?.mime ?? prior?.audioMime ?? null;
  const row: Omit<CachedPronunciation, "updatedAt"> = {
    word,
    accent,
    phonetic:
      prior?.phonetic ||
      (text ? (text.startsWith("/") ? text : `/${text}/`) : ""),
    actualAccent: downloadedAudio?.accent ?? prior?.actualAccent ?? null,
    sourceUrl:
      downloadedAudio?.sourceUrl ??
      prior?.sourceUrl ??
      selected?.phonetic.sourceUrl ??
      entry?.sourceUrls?.[0] ??
      null,
    licenseName:
      downloadedAudio?.licenseName ??
      prior?.licenseName ??
      selected?.phonetic.license?.name ??
      entry?.license?.name ??
      null,
    licenseUrl:
      downloadedAudio?.licenseUrl ??
      prior?.licenseUrl ??
      selected?.phonetic.license?.url ??
      entry?.license?.url ??
      null,
    audioMime,
    audioBlob,
    status: audioBlob ? "ready" : "tts_only",
    definition,
    translation,
    partOfSpeech: meaning?.partOfSpeech?.trim() ?? "",
    example,
    exampleTranslation,
  };
  saveCache(db, row);
  return publicResult({ ...row, updatedAt: new Date().toISOString() }, false);
}

export function lookupPronunciation(
  db: AppDatabase,
  word: string,
  accent: PronunciationAccent,
  context = "",
  includeAudio = false,
): Promise<PronunciationResult> {
  const key = `${word}:${accent}:${includeAudio ? "audio" : "lexical"}:${context}`;
  const existing = pronunciationLookups.get(key);
  if (existing) return existing;
  const lookup = lookupPronunciationUncached(
    db,
    word,
    accent,
    context,
    includeAudio,
  ).finally(() => pronunciationLookups.delete(key));
  pronunciationLookups.set(key, lookup);
  return lookup;
}

export async function pronunciationAudio(
  db: AppDatabase,
  word: string,
  accent: PronunciationAccent,
) {
  let row = cachedRow(db, word, accent);
  if (!row?.audioBlob || !isFresh(row)) {
    await lookupPronunciation(db, word, accent, "", true);
    row = cachedRow(db, word, accent);
  }
  if (!row?.audioBlob) {
    throw new ApiError(404, "PRONUNCIATION_AUDIO_NOT_FOUND", "该单词暂无真人发音");
  }
  return { data: row.audioBlob, mime: row.audioMime ?? "audio/mpeg" };
}
