import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  runArticleTranslation,
  type TranslationRunOptions,
} from "../scripts/translate-articles";

const { DatabaseSync } = createRequire(import.meta.url)(
  "node:sqlite",
) as typeof import("node:sqlite");

test("article translation supports custom models, deduplication and resumable runs", async () => {
  const temporaryDirectory = mkdtempSync(path.join(tmpdir(), "read-remember-translation-"));
  const databasePath = path.join(temporaryDirectory, "translation.sqlite");
  const db = new DatabaseSync(databasePath);
  db.exec(`
    CREATE TABLE articles (
      id TEXT PRIMARY KEY,
      exam_id TEXT NOT NULL,
      content_kind TEXT NOT NULL,
      title TEXT NOT NULL,
      paragraphs_json TEXT NOT NULL
    )
  `);
  const insert = db.prepare(
    `INSERT INTO articles(id, exam_id, content_kind, title, paragraphs_json)
     VALUES (?, 'middle', 'interest', ?, ?)`,
  );
  insert.run(
    "article-1",
    "First Flight",
    JSON.stringify(["A shared paragraph.", "The first ending."]),
  );
  insert.run(
    "article-2",
    "Second Flight",
    JSON.stringify(["A shared paragraph.", "The second ending."]),
  );
  db.close();

  let calls = 0;
  const server = createServer(async (request, response) => {
    calls += 1;
    assert.equal(request.url, "/custom/chat/completions");
    assert.equal(request.headers.authorization, "Bearer test-key");
    assert.equal(request.headers["x-project"], "read-remember-test");
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
      model: string;
      messages: Array<{ content: string }>;
    };
    assert.equal(body.model, "custom-translation-model");
    const input = JSON.parse(body.messages[1].content) as {
      items: Array<{ id: string; text: string }>;
    };
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                translations: input.items.map((item) => ({
                  id: item.id,
                  translation: `中文：${item.text}`,
                })),
              }),
            },
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
      }),
    );
  });

  try {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert(address && typeof address !== "string");
    const options: TranslationRunOptions = {
      databasePath,
      baseUrl: `http://127.0.0.1:${address.port}`,
      apiPath: "/custom/chat/completions",
      apiKey: "test-key",
      model: "custom-translation-model",
      targetLanguage: "zh-CN",
      batchSize: 3,
      concurrency: 2,
      timeoutMs: 5_000,
      maxRetries: 0,
      temperature: 0.1,
      jsonMode: false,
      headers: { "X-Project": "read-remember-test" },
      force: false,
      dryRun: false,
      log: () => undefined,
    };

    const first = await runArticleTranslation(options);
    assert.equal(first.articles, 2);
    assert.equal(first.uniqueSegments, 5);
    assert.equal(first.translatedSegments, 5);
    assert.equal(first.materializedArticles, 2);
    assert.equal(first.usage.totalTokens, 300);
    assert.equal(calls, 2);

    const second = await runArticleTranslation(options);
    assert.equal(second.cachedSegments, 5);
    assert.equal(second.translatedSegments, 0);
    assert.equal(second.materializedArticles, 2);
    assert.equal(calls, 2);

    const verification = new DatabaseSync(databasePath, { readOnly: true });
    const segmentCount = verification
      .prepare("SELECT COUNT(*) AS count FROM translation_segments")
      .get() as { count: number };
    const translations = verification
      .prepare(
        `SELECT article_id AS articleId, translated_title AS title,
          translated_paragraphs_json AS paragraphsJson
         FROM article_translations ORDER BY article_id`,
      )
      .all() as Array<{
      articleId: string;
      title: string;
      paragraphsJson: string;
    }>;
    verification.close();
    assert.equal(segmentCount.count, 5);
    assert.equal(translations.length, 2);
    assert.equal(translations[0].title, "中文：First Flight");
    assert.deepEqual(JSON.parse(translations[1].paragraphsJson), [
      "中文：A shared paragraph.",
      "中文：The second ending.",
    ]);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
