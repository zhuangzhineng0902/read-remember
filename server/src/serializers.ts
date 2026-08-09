import type { Question } from "../../client/src/types";

export type ArticleRow = {
  id: string;
  examId: string;
  year: number;
  title: string;
  eyebrow: string;
  readMinutes: number;
  difficulty: number;
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
  };
}
