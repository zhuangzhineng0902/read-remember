import { createHash } from "node:crypto";

type FingerprintQuestion = {
  prompt: string;
  options: string[];
  answer: number;
};

type FingerprintArticle = {
  title: string;
  paragraphs: string[];
  questions: FingerprintQuestion[];
};

const normalize = (value: string) =>
  value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

export function contentFingerprint(article: FingerprintArticle) {
  const normalized = JSON.stringify({
    title: normalize(article.title),
    paragraphs: article.paragraphs.map(normalize),
    questions: article.questions.map((question) => ({
      prompt: normalize(question.prompt),
      options: question.options.map(normalize),
      answer: question.answer,
    })),
  });
  return createHash("sha256").update(normalized).digest("hex");
}

