export type ExamId = "toefl" | "ielts" | "toeic" | "middle" | "high";

export type Exam = {
  id: ExamId;
  name: string;
  subtitle: string;
  level: string;
  color: string;
};

export type Question = {
  prompt: string;
  options: string[];
  answer: number;
  explanation: string;
};

export type Article = {
  id: string;
  examId: ExamId;
  year: number;
  title: string;
  eyebrow: string;
  readMinutes: number;
  difficulty: number;
  paragraphs: string[];
  questions: Question[];
};

export type WordInfo = {
  word: string;
  phonetic: string;
  translation: string;
  definition?: string;
  partOfSpeech?: string;
  example?: string;
  exampleTranslation?: string;
};

export type MemoryRating = "again" | "hard" | "good" | "easy";

export type SavedWord = WordInfo & {
  examId: ExamId;
  articleId: string;
  savedAt: string;
  memoryStage?: number;
  nextReviewAt?: string;
  lastReviewedAt?: string | null;
  reviewCount?: number;
  lapseCount?: number;
};

export type HistoryRecord = {
  date: string;
  examId: ExamId;
  articleIds: string[];
};

export type ReaderSettings = {
  fontScale: number;
  lineSpacing: "compact" | "standard" | "relaxed";
  fontFamily: "serif" | "sans";
  pageTone: "paper" | "white" | "green";
  columnWidth: "narrow" | "standard" | "wide";
};

export type ReadingProgress = {
  offsetY: number;
  ratio: number;
  updatedAt: string;
};
