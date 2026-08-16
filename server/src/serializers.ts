import type { Question } from "../../client/src/types";

export type ArticleRow = {
  id: string;
  examId: string;
  year: number;
  title: string;
  eyebrow: string;
  readMinutes: number;
  difficulty: number;
  contentKind: "exam" | "interest";
  interestId: string | null;
  seriesTitle: string | null;
  episodeNumber: number | null;
  paragraphsJson: string;
  questionsJson: string;
};

export const articleSelect = `
  a.id,
  a.exam_id AS examId,
  a.year,
  a.title,
  a.eyebrow,
  a.read_minutes AS readMinutes,
  a.difficulty,
  a.content_kind AS contentKind,
  a.interest_id AS interestId,
  a.series_title AS seriesTitle,
  a.episode_number AS episodeNumber,
  a.paragraphs_json AS paragraphsJson,
  a.questions_json AS questionsJson
`;

export function serializeArticle(row: ArticleRow) {
  const questions = JSON.parse(row.questionsJson) as Question[];
  return {
    id: row.id,
    examId: row.examId,
    year: row.year,
    title: row.title,
    eyebrow: row.eyebrow,
    readMinutes: row.readMinutes,
    difficulty: row.difficulty,
    contentKind: row.contentKind,
    interestId: row.interestId,
    seriesTitle: row.seriesTitle,
    episodeNumber: row.episodeNumber,
    paragraphs: JSON.parse(row.paragraphsJson) as string[],
    questions: questions.map(({ prompt, options }, index) => ({
      id: index,
      prompt,
      options,
    })),
  };
}

export function serializeArticleSummary(row: ArticleRow) {
  return {
    id: row.id,
    examId: row.examId,
    year: row.year,
    title: row.title,
    eyebrow: row.eyebrow,
    readMinutes: row.readMinutes,
    difficulty: row.difficulty,
    contentKind: row.contentKind,
    interestId: row.interestId,
    seriesTitle: row.seriesTitle,
    episodeNumber: row.episodeNumber,
  };
}
