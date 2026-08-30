import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  ArticleAnswerState,
  ArticleTimerSettings,
  ExamId,
  HistoryRecord,
  InterestId,
  LearningSettings,
  ReaderSettings,
  ReadingProgress,
  SavedWord,
} from "./types";
import { randomUUID } from "expo-crypto";

const KEYS = {
  exam: "rr:selected-exam",
  words: "rr:saved-words",
  history: "rr:history",
  completed: "rr:completed",
  deviceId: "rr:device-id",
  authToken: "rr:auth-token",
  readerSettings: "rr:reader-settings",
  readingProgress: "rr:reading-progress",
  articleAnswers: "rr:article-answers",
  articleTimers: "rr:article-timers",
  readerTimerDefaults: "rr:reader-timer-defaults",
  readerHintSeen: "rr:reader-hint-seen",
  learningSettings: "rr:learning-settings",
  interests: "rr:interests",
};

async function readJson<T>(key: string, fallback: T): Promise<T> {
  const value = await AsyncStorage.getItem(key);
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export const storage = {
  getExam: () => AsyncStorage.getItem(KEYS.exam) as Promise<ExamId | null>,
  setExam: (examId: ExamId) => AsyncStorage.setItem(KEYS.exam, examId),
  clearExam: () => AsyncStorage.removeItem(KEYS.exam),
  getWords: () => readJson<SavedWord[]>(KEYS.words, []),
  setWords: (words: SavedWord[]) =>
    AsyncStorage.setItem(KEYS.words, JSON.stringify(words)),
  getHistory: () => readJson<HistoryRecord[]>(KEYS.history, []),
  setHistory: (history: HistoryRecord[]) =>
    AsyncStorage.setItem(KEYS.history, JSON.stringify(history)),
  getCompleted: () => readJson<string[]>(KEYS.completed, []),
  setCompleted: (ids: string[]) =>
    AsyncStorage.setItem(KEYS.completed, JSON.stringify(ids)),
  async getDeviceId() {
    const saved = await AsyncStorage.getItem(KEYS.deviceId);
    if (saved) return saved;
    const next = randomUUID();
    await AsyncStorage.setItem(KEYS.deviceId, next);
    return next;
  },
  getAuthToken: () => AsyncStorage.getItem(KEYS.authToken),
  setAuthToken: (token: string) => AsyncStorage.setItem(KEYS.authToken, token),
  clearAuthToken: () => AsyncStorage.removeItem(KEYS.authToken),
  getReaderSettings: () =>
    readJson<ReaderSettings | null>(KEYS.readerSettings, null),
  setReaderSettings: (settings: ReaderSettings) =>
    AsyncStorage.setItem(KEYS.readerSettings, JSON.stringify(settings)),
  async getReadingProgress(userId: string, articleId: string) {
    const progress = await readJson<Record<string, ReadingProgress>>(
      KEYS.readingProgress,
      {},
    );
    return progress[`${userId}:${articleId}`] ?? null;
  },
  async setReadingProgress(
    userId: string,
    articleId: string,
    value: ReadingProgress,
  ) {
    const progress = await readJson<Record<string, ReadingProgress>>(
      KEYS.readingProgress,
      {},
    );
    progress[`${userId}:${articleId}`] = value;
    await AsyncStorage.setItem(KEYS.readingProgress, JSON.stringify(progress));
  },
  async getArticleAnswerState(userId: string, articleId: string) {
    const states = await readJson<Record<string, ArticleAnswerState>>(
      KEYS.articleAnswers,
      {},
    );
    return states[`${userId}:${articleId}`] ?? null;
  },
  async setArticleAnswerState(
    userId: string,
    articleId: string,
    value: ArticleAnswerState,
  ) {
    const states = await readJson<Record<string, ArticleAnswerState>>(
      KEYS.articleAnswers,
      {},
    );
    states[`${userId}:${articleId}`] = value;
    await AsyncStorage.setItem(KEYS.articleAnswers, JSON.stringify(states));
  },
  async getArticleTimerSettings(userId: string, articleId: string) {
    const settings = await readJson<Record<string, ArticleTimerSettings>>(
      KEYS.articleTimers,
      {},
    );
    return settings[`${userId}:${articleId}`] ?? null;
  },
  async setArticleTimerSettings(
    userId: string,
    articleId: string,
    value: ArticleTimerSettings,
  ) {
    const settings = await readJson<Record<string, ArticleTimerSettings>>(
      KEYS.articleTimers,
      {},
    );
    settings[`${userId}:${articleId}`] = value;
    await AsyncStorage.setItem(KEYS.articleTimers, JSON.stringify(settings));
  },
  async getReaderTimerDefaults(userId: string) {
    const settings = await readJson<Record<string, ArticleTimerSettings>>(
      KEYS.readerTimerDefaults,
      {},
    );
    return settings[userId] ?? null;
  },
  async setReaderTimerDefaults(userId: string, value: ArticleTimerSettings) {
    const settings = await readJson<Record<string, ArticleTimerSettings>>(
      KEYS.readerTimerDefaults,
      {},
    );
    settings[userId] = value;
    await AsyncStorage.setItem(KEYS.readerTimerDefaults, JSON.stringify(settings));
  },
  async getReaderHintSeen() {
    return (await AsyncStorage.getItem(KEYS.readerHintSeen)) === "true";
  },
  setReaderHintSeen: () => AsyncStorage.setItem(KEYS.readerHintSeen, "true"),
  getLearningSettings: () =>
    readJson<LearningSettings | null>(KEYS.learningSettings, null),
  setLearningSettings: (settings: LearningSettings) =>
    AsyncStorage.setItem(KEYS.learningSettings, JSON.stringify(settings)),
  getInterests: () => readJson<InterestId[]>(KEYS.interests, []),
  setInterests: (interests: InterestId[]) =>
    AsyncStorage.setItem(KEYS.interests, JSON.stringify(interests)),
};
