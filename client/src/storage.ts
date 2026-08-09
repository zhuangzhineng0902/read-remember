import AsyncStorage from "@react-native-async-storage/async-storage";
import { ExamId, HistoryRecord, SavedWord } from "./types";
import { randomUUID } from "expo-crypto";

const KEYS = {
  exam: "rr:selected-exam",
  words: "rr:saved-words",
  history: "rr:history",
  completed: "rr:completed",
  deviceId: "rr:device-id",
  authToken: "rr:auth-token",
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
};
