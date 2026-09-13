export type ExamId = "toefl" | "ielts" | "toeic" | "middle" | "high";

export const interestIds = [
  "military",
  "art",
  "science",
  "why",
  "fantasy",
  "mecha",
  "cultivation",
  "tiger",
  "cat",
] as const;

export type BuiltInInterestId = (typeof interestIds)[number];
// Interest categories are data-driven. Built-in IDs remain exported for
// offline content, while server-created categories use the same slug format.
export type InterestId = string;

export type InterestCategory = {
  id: InterestId;
  name: string;
  subtitle: string;
  emoji: string;
  color: string;
  activityPrompt: string;
  storyPrompt?: string;
  builtIn?: boolean;
};

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
  contentKind?: "exam" | "interest";
  interestId?: InterestId | null;
  seriesTitle?: string | null;
  episodeNumber?: number | null;
  paragraphs: string[];
  questions: Question[];
};

export type ArticleTranslation = {
  articleId: string;
  targetLanguage: string;
  title: string;
  paragraphs: string[];
  provider: string;
  model: string;
  translatedAt: string;
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

export type ReminderStyle = "mecha-blade" | "galactica";

export type ArticleTimerSettings = {
  enabled: boolean;
  durationMinutes: number;
  reminderStyle: ReminderStyle;
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
  interests: InterestId[];
  updatedAt: string;
};

export type CustomStoryTone =
  | "adventure"
  | "funny"
  | "mystery"
  | "friendship"
  | "fantasy";

export type CustomStoryReaderStage =
  | "auto"
  | "starter"
  | "stage1"
  | "stage2"
  | "stage3"
  | "stage4"
  | "stage5"
  | "stage6";

export type CustomStoryProgressStage =
  | "queued"
  | "planning"
  | "selecting_plan"
  | "drafting"
  | "reviewing"
  | "editing"
  | "quality_check"
  | "repairing"
  | "saving"
  | "completed"
  | "failed";

export type OriginalStoryInput = {
  sourceMode?: "favorite";
  idea: string;
  characters: string;
  keywords: string[];
  plotNotes: string;
  tone: CustomStoryTone;
  episodeCount: number;
  readerStage: CustomStoryReaderStage;
};

export type ClassicStoryInput = {
  sourceMode: "classic";
  classicId: string;
  unitId: string;
  readerStage: CustomStoryReaderStage;
  examId?: ExamId;
  episodeCount: number;
};

export type CustomStoryInput = OriginalStoryInput | ClassicStoryInput;

export type ClassicSource = {
  classicId: string;
  unitId: string;
  status: "available" | "pending_editorial_review";
  title: string;
  unitTitle: string;
  author: string;
  description: string;
  scope: string;
  sourceUrl: string;
  supportedProfiles: Array<{
    readerStage: CustomStoryReaderStage;
    episodeCount: number;
    minWords: number;
    maxWords: number;
  }>;
};

export type CustomStory = {
  id: string;
  examId: ExamId;
  sourceMode: "favorite" | "classic";
  classicId: string;
  classicUnitId: string;
  sourceVersion: string;
  baseVersion: string;
  pipelineVersion: string;
  idea: string;
  characters: string;
  keywords: string[];
  plotNotes: string;
  tone: CustomStoryTone;
  episodeCount: number;
  readerStage: CustomStoryReaderStage;
  status: "queued" | "generating" | "completed" | "failed";
  progressStage: CustomStoryProgressStage;
  progressMessage: string;
  progressPercent: number;
  completedEpisodeCount: number;
  automaticRetryEpisode: number;
  automaticRetryCount: number;
  resumeAvailable: boolean;
  requiresRevision: boolean;
  revisionMessage: string | null;
  seriesTitle: string;
  errorMessage: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  articles: Array<Omit<Article, "paragraphs" | "questions"> & { unlocked: boolean }>;
};
