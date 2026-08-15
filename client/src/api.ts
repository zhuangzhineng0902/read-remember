import { NativeModules, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  Article,
  ExamId,
  HistoryRecord,
  MemoryRating,
  SavedWord,
} from "./types";

type ApiEnvelope<T> = { data: T };

type Session = {
  id: string;
  token: string;
  examId: ExamId;
};

export type ArticleSummary = Omit<Article, "paragraphs" | "questions">;

export type ManualPush = {
  batchId: string;
  pushName: string;
  message: string;
  receivedAt: string;
  openedAt: string | null;
  completedAt: string | null;
  article: ArticleSummary;
};

type ApiQuestion = {
  id: number;
  prompt: string;
  options: string[];
};

type ApiArticle = Omit<Article, "questions"> & { questions: ApiQuestion[] };

export type AnswerResult = {
  questionId: number;
  selectedAnswer: number;
  correctAnswer: number;
  correct: boolean;
  explanation: string;
};

export type Pronunciation = {
  word: string;
  accent: "us" | "uk";
  phonetic: string;
  actualAccent: string | null;
  hasAudio: boolean;
  audioPath: string | null;
  fallback: "device-tts";
  sourceUrl: string | null;
  licenseName: string | null;
  licenseUrl: string | null;
  cached: boolean;
  definition: string;
  translation: string;
  partOfSpeech: string;
  example: string;
  exampleTranslation: string;
};

type PronunciationCacheEntry = {
  cachedAt: number;
  value: Pronunciation;
};

type HistoryItem = {
  date: string;
  slot: number;
  article: ArticleSummary;
  progress: { score: number; total: number; completedAt: string } | null;
};

function developmentHost() {
  const scriptUrl = NativeModules.SourceCode?.scriptURL as string | undefined;
  if (!scriptUrl) return "127.0.0.1";
  try {
    return new URL(scriptUrl).hostname;
  } catch {
    return scriptUrl.match(/https?:\/\/([^:/]+)/)?.[1] ?? "127.0.0.1";
  }
}

export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_URL ??
  (Platform.OS === "web"
    ? "/api/v1"
    : `http://${developmentHost()}:4000/api/v1`);

let authToken: string | null = null;
const PRONUNCIATION_CACHE_PREFIX = "rr:pronunciation:";
const PRONUNCIATION_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const PRONUNCIATION_REVALIDATE_MS = 24 * 60 * 60 * 1000;
const pronunciationMemoryCache = new Map<string, PronunciationCacheEntry>();
const pronunciationRequests = new Map<string, Promise<Pronunciation>>();

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  if (init.body) headers.set("content-type", "application/json");
  if (authToken) headers.set("authorization", `Bearer ${authToken}`);

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(
      payload?.error?.message ?? `API 请求失败 (${response.status})`,
    );
  }
  if (response.status === 204) return undefined as T;
  return ((await response.json()) as ApiEnvelope<T>).data;
}

const pronunciationCacheKey = (word: string, accent: "us" | "uk") =>
  `${accent}:${word.toLowerCase()}`;

async function readPronunciationCache(word: string, accent: "us" | "uk") {
  const key = pronunciationCacheKey(word, accent);
  const memoryEntry = pronunciationMemoryCache.get(key);
  if (
    memoryEntry &&
    Date.now() - memoryEntry.cachedAt < PRONUNCIATION_CACHE_MAX_AGE_MS
  ) {
    return memoryEntry;
  }
  try {
    const raw = await AsyncStorage.getItem(`${PRONUNCIATION_CACHE_PREFIX}${key}`);
    if (!raw) return null;
    const entry = JSON.parse(raw) as PronunciationCacheEntry;
    if (Date.now() - entry.cachedAt >= PRONUNCIATION_CACHE_MAX_AGE_MS) {
      void AsyncStorage.removeItem(`${PRONUNCIATION_CACHE_PREFIX}${key}`);
      return null;
    }
    pronunciationMemoryCache.set(key, entry);
    return entry;
  } catch {
    return null;
  }
}

async function writePronunciationCache(value: Pronunciation) {
  const key = pronunciationCacheKey(value.word, value.accent);
  const entry: PronunciationCacheEntry = { cachedAt: Date.now(), value };
  pronunciationMemoryCache.set(key, entry);
  try {
    await AsyncStorage.setItem(
      `${PRONUNCIATION_CACHE_PREFIX}${key}`,
      JSON.stringify(entry),
    );
  } catch {
    // Memory caching still speeds up the current reading session.
  }
}

function requestPronunciation(
  word: string,
  accent: "us" | "uk",
  context: string,
  includeAudio: boolean,
) {
  const normalizedContext = context.slice(0, 450);
  const params = new URLSearchParams({
    accent,
    context: normalizedContext,
    includeAudio: String(includeAudio),
  });
  const key = `${word.toLowerCase()}:${accent}:${includeAudio}:${normalizedContext}`;
  const existing = pronunciationRequests.get(key);
  if (existing) return existing;
  const pending = request<Pronunciation>(
    `/pronunciations/${encodeURIComponent(word)}?${params.toString()}`,
  )
    .then((result) => {
      if (!includeAudio) void writePronunciationCache(result);
      return result;
    })
    .finally(() => pronunciationRequests.delete(key));
  pronunciationRequests.set(key, pending);
  return pending;
}

const withAudioUrl = (pronunciation: Pronunciation) => ({
  ...pronunciation,
  audioUrl: pronunciation.audioPath
    ? `${API_BASE_URL}${pronunciation.audioPath}`
    : null,
});

function hydrateArticle(article: ApiArticle): Article {
  return {
    ...article,
    questions: article.questions.map((question) => ({
      prompt: question.prompt,
      options: question.options,
      // Correct answers are intentionally returned only after submission.
      answer: -1,
      explanation: "",
    })),
  };
}

export const api = {
  async authenticate(deviceId: string, cachedToken?: string | null) {
    if (cachedToken) {
      authToken = cachedToken;
      try {
        const user = await request<Omit<Session, "token">>("/users/me");
        return { ...user, token: cachedToken };
      } catch {
        authToken = null;
      }
    }

    const session = await request<Session>("/auth/anonymous", {
      method: "POST",
      body: JSON.stringify({ deviceId }),
    });
    authToken = session.token;
    return session;
  },

  setExam: (examId: ExamId) =>
    request<Omit<Session, "token">>("/users/me/exam", {
      method: "PATCH",
      body: JSON.stringify({ examId }),
    }),

  async getDaily(date?: string): Promise<Article[]> {
    const query = date ? `?date=${encodeURIComponent(date)}` : "";
    const daily = await request<{
      date: string;
      examId: ExamId;
      articles: ArticleSummary[];
      corpusExhausted: boolean;
    }>(`/daily${query}`);
    return Promise.all(
      daily.articles.map((article) => this.getArticle(article.id)),
    );
  },

  async getArticle(id: string): Promise<Article> {
    return hydrateArticle(
      await request<ApiArticle>(`/articles/${encodeURIComponent(id)}`),
    );
  },

  getPushes: () => request<ManualPush[]>("/pushes"),

  completeArticle: (id: string, answers: number[]) =>
    request<{
      articleId: string;
      score: number;
      total: number;
      results: AnswerResult[];
    }>(`/articles/${encodeURIComponent(id)}/complete`, {
      method: "POST",
      body: JSON.stringify({ answers }),
    }),

  async getHistory(): Promise<{
    records: HistoryRecord[];
    completedIds: string[];
  }> {
    const items = await request<HistoryItem[]>("/history?limit=100");
    const grouped = new Map<string, HistoryRecord>();
    const completedIds: string[] = [];
    for (const item of items) {
      const key = `${item.date}:${item.article.examId}`;
      const record = grouped.get(key) ?? {
        date: item.date,
        examId: item.article.examId,
        articleIds: [],
      };
      record.articleIds.push(item.article.id);
      grouped.set(key, record);
      if (item.progress) completedIds.push(item.article.id);
    }
    return { records: [...grouped.values()], completedIds };
  },

  getVocabulary: () => request<SavedWord[]>("/vocabulary"),

  async getPronunciation(
    word: string,
    accent: "us" | "uk" = "us",
    context = "",
    includeAudio = false,
  ): Promise<Pronunciation & { audioUrl: string | null }> {
    if (includeAudio) {
      return withAudioUrl(
        await requestPronunciation(word, accent, context, true),
      );
    }

    const cached = await readPronunciationCache(word, accent);
    if (cached) {
      if (Date.now() - cached.cachedAt >= PRONUNCIATION_REVALIDATE_MS) {
        void requestPronunciation(word, accent, context, false).catch(() => {});
      }
      return withAudioUrl(cached.value);
    }
    return withAudioUrl(
      await requestPronunciation(word, accent, context, false),
    );
  },

  async prefetchPronunciations(
    items: Array<{ word: string; context: string }>,
    concurrency = 3,
  ) {
    const unique = [
      ...new Map(
        items.map((item) => [item.word.toLowerCase(), item] as const),
      ).values(),
    ];
    let cursor = 0;
    const worker = async () => {
      while (cursor < unique.length) {
        const item = unique[cursor++];
        await this.getPronunciation(item.word, "us", item.context).catch(
          () => null,
        );
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(concurrency, unique.length) }, worker),
    );
  },

  saveWord: (word: SavedWord) =>
    request<SavedWord>(`/vocabulary/${encodeURIComponent(word.word)}`, {
      method: "PUT",
      body: JSON.stringify({
        examId: word.examId,
        articleId: word.articleId,
        phonetic: word.phonetic,
        translation: word.translation,
        definition: word.definition ?? "",
        partOfSpeech: word.partOfSpeech ?? "",
        example: word.example ?? "",
        exampleTranslation: word.exampleTranslation ?? "",
      }),
    }),

  removeWord: (word: Pick<SavedWord, "word" | "examId">) =>
    request<void>(
      `/vocabulary/${encodeURIComponent(word.word)}?examId=${word.examId}`,
      { method: "DELETE" },
    ),

  reviewWord: (word: Pick<SavedWord, "word" | "examId">, rating: MemoryRating) =>
    request<SavedWord>(
      `/vocabulary/${encodeURIComponent(word.word)}/review`,
      {
        method: "POST",
        body: JSON.stringify({ examId: word.examId, rating }),
      },
    ),
};
