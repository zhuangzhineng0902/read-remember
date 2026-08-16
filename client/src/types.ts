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

export type AnswerResult = {
  questionId: number;
  selectedAnswer: number;
  correctAnswer: number;
  correct: boolean;
  explanation: string;
};

export type ArticleAnswerState = {
  answers: Array<number | null>;
  submitted: boolean;
  results: AnswerResult[];
  updatedAt: string;
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
  articleTitle?: string;
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
  articles?: HistoryArticle[];
};

export type HistoryArticle = Pick<
  Article,
  "id" | "examId" | "year" | "title" | "eyebrow" | "readMinutes" | "difficulty"
> & {
  completed: boolean;
  score: number | null;
  total: number | null;
  readingRatio: number;
};

export type LearningStats = {
  completedArticles: number;
  learningDays: number;
  readingSeconds: number;
  streakDays: number;
  savedWords: number;
  dueWords: number;
  answeredQuestions: number;
  correctAnswers: number;
};

export type MistakeItem = {
  id: string;
  article: Omit<Article, "paragraphs" | "questions">;
  questionId: number;
  prompt: string;
  options: string[];
  selectedAnswer: number;
  correctAnswer: number;
  explanation: string;
  completedAt: string;
};

export type ReaderSettings = {
  fontScale: number;
  lineSpacing: "compact" | "standard" | "relaxed";
  fontFamily: "serif" | "sans";
  pageTone: "paper" | "white" | "green";
  columnWidth: "narrow" | "standard" | "wide";
};

export type LearningSettings = {
  dailyReminderEnabled: boolean;
  reminderTime: string;
  pronunciationAccent: "us" | "uk";
  dailyGoal: number;
};

export type UserProfile = {
  id: string;
  deviceId: string;
  examId: ExamId;
  username: string | null;
  displayName: string;
  email: string;
  isRegistered: boolean;
};

export type ReadingProgress = {
  offsetY: number;
  ratio: number;
  readingSeconds?: number;
  updatedAt: string;
};

export type UserPreferences = {
  learning: LearningSettings;
  reader: ReaderSettings;
  updatedAt: string;
};
