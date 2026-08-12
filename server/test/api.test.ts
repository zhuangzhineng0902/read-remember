import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, test } from "node:test";
import { createApp } from "../src/app";
import { createDatabase } from "../src/database";
import { dispatchDailyPushes } from "../src/daily-push";

const db = createDatabase(":memory:");
const server = createServer(
  createApp(db, {
    corsOrigin: "*",
    adminApiKey: "test-admin-key",
    syncAllowedHosts: [],
    dailyPushEnabled: false,
  }),
);
let baseUrl = "";
let token = "";
let userId = "";
let firstArticleId = "";

before(async () => {
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      assert(address && typeof address !== "string");
      baseUrl = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  db.close();
});

async function request(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (init.body) headers.set("content-type", "application/json");
  return fetch(`${baseUrl}${path}`, { ...init, headers });
}

test("health and exam list are public", async () => {
  const health = await request("/health");
  assert.equal(health.status, 200);
  assert.equal((await health.json()).status, "ok");

  const exams = await request("/api/v1/exams");
  assert.equal(exams.status, 200);
  assert.equal((await exams.json()).data.length, 5);
});

test("pronunciation metadata and cached audio are public", async () => {
  db.prepare(
    `
    INSERT INTO pronunciation_cache(
      word, accent, phonetic, actual_accent, source_url, license_name,
      license_url, audio_mime, audio_blob, status, definition_en,
      translation_zh, part_of_speech, example_en, example_zh
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    "fixture",
    "us",
    "/ˈfɪkstʃər/",
    "us",
    "https://example.com/source",
    "Test license",
    "https://example.com/license",
    "audio/mpeg",
    new Uint8Array([73, 68, 51]),
    "ready",
    "A thing used as a fixed test example.",
    "用于固定测试的示例。",
    "noun",
    "This fixture keeps the test deterministic.",
    "这个固定数据让测试结果保持确定。",
  );

  const metadata = await request("/api/v1/pronunciations/fixture?accent=us");
  assert.equal(metadata.status, 200);
  const data = (await metadata.json()).data;
  assert.equal(data.phonetic, "/ˈfɪkstʃər/");
  assert.equal(data.hasAudio, true);
  assert.equal(data.fallback, "device-tts");
  assert.equal(data.translation, "用于固定测试的示例。");
  assert.equal(data.partOfSpeech, "noun");
  assert.equal(data.exampleTranslation, "这个固定数据让测试结果保持确定。");

  const audio = await request(
    "/api/v1/pronunciations/fixture/audio?accent=us",
  );
  assert.equal(audio.status, 200);
  assert.equal(audio.headers.get("content-type"), "audio/mpeg");
  assert.deepEqual([...new Uint8Array(await audio.arrayBuffer())], [73, 68, 51]);
});

test("anonymous device login returns a reusable token", async () => {
  const response = await request("/api/v1/auth/anonymous", {
    method: "POST",
    body: JSON.stringify({ deviceId: "integration-test-device" }),
  });
  assert.equal(response.status, 201);
  const session = (await response.json()).data;
  token = session.token;
  userId = session.id;
  assert.ok(token);

  const again = await request("/api/v1/auth/anonymous", {
    method: "POST",
    body: JSON.stringify({ deviceId: "integration-test-device" }),
  });
  assert.equal(again.status, 200);
  assert.equal((await again.json()).data.token, token);
});

test("daily delivery is idempotent and never repeats across dates", async () => {
  const first = await request("/api/v1/daily?date=2026-08-09");
  const firstData = (await first.json()).data;
  assert.equal(firstData.articles.length, 3);
  firstArticleId = firstData.articles[0].id;

  const repeated = await request("/api/v1/daily?date=2026-08-09");
  const repeatedData = (await repeated.json()).data;
  assert.deepEqual(
    repeatedData.articles.map((item: { id: string }) => item.id),
    firstData.articles.map((item: { id: string }) => item.id),
  );

  const second = await request("/api/v1/daily?date=2026-08-10");
  const secondData = (await second.json()).data;
  assert.equal(secondData.articles.length, 3);
  const allIds = [...firstData.articles, ...secondData.articles].map(
    (item: { id: string }) => item.id,
  );
  assert.equal(new Set(allIds).size, 6);
});

test("article answers can be submitted and appear in history", async () => {
  const daily = await request("/api/v1/daily?date=2026-08-09");
  const articleId = (await daily.json()).data.articles[0].id as string;
  const articleResponse = await request(`/api/v1/articles/${articleId}`);
  const article = (await articleResponse.json()).data;
  assert.ok(article.paragraphs.length > 0);
  assert.ok(article.questions[0].options.length > 0);
  assert.equal("answer" in article.questions[0], false);

  const completion = await request(`/api/v1/articles/${articleId}/complete`, {
    method: "POST",
    body: JSON.stringify({ answers: article.questions.map(() => 0) }),
  });
  assert.equal(completion.status, 200);
  assert.equal((await completion.json()).data.total, article.questions.length);

  const history = await request("/api/v1/history");
  const historyData = (await history.json()).data;
  const completed = historyData.find(
    (item: { article: { id: string } }) => item.article.id === articleId,
  );
  assert.ok(completed.progress);
});

test("vocabulary can be added, filtered, and removed", async () => {
  const daily = await request("/api/v1/daily?date=2026-08-09");
  const articleId = (await daily.json()).data.articles[0].id as string;
  const saved = await request("/api/v1/vocabulary/vulnerable", {
    method: "PUT",
    body: JSON.stringify({
      examId: "toefl",
      articleId,
      phonetic: "/ˈvʌlnərəbl/",
      translation: "脆弱的；易受伤害的",
      definition: "Likely to be harmed.",
      partOfSpeech: "adjective",
      example: "Young trees are vulnerable to drought.",
      exampleTranslation: "幼树容易受到干旱影响。",
    }),
  });
  assert.equal(saved.status, 201);

  const list = await request("/api/v1/vocabulary?examId=toefl&search=vul");
  assert.equal((await list.json()).data.length, 1);
  const detailedList = await request("/api/v1/vocabulary?examId=toefl&search=vul");
  const detailedVocabulary = (await detailedList.json()).data;
  assert.equal(detailedVocabulary[0].partOfSpeech, "adjective");
  assert.equal(detailedVocabulary[0].exampleTranslation, "幼树容易受到干旱影响。");

  const removed = await request("/api/v1/vocabulary/vulnerable?examId=toefl", {
    method: "DELETE",
  });
  assert.equal(removed.status, 204);
});

test("changing exam creates an independent unseen delivery pool", async () => {
  const changed = await request("/api/v1/users/me/exam", {
    method: "PATCH",
    body: JSON.stringify({ examId: "toeic" }),
  });
  assert.equal((await changed.json()).data.examId, "toeic");

  const daily = await request("/api/v1/daily?date=2026-08-11");
  const data = (await daily.json()).data;
  assert.equal(data.examId, "toeic");
  assert.equal(data.articles.length, 3);
  assert.ok(
    data.articles.every((item: { examId: string }) => item.examId === "toeic"),
  );
});

test("daily automatic push follows each user's exam and is idempotent", async () => {
  const autoUserId = "18e57236-dd4a-45a7-aaef-2449af54543d";
  db.prepare(
    `INSERT INTO users(id, device_id, token, exam_id)
     VALUES (?, ?, ?, ?)`,
  ).run(autoUserId, "daily-auto-test-device", "daily-auto-test-token", "high");
  const first = dispatchDailyPushes(db, "2026-08-12");
  assert.ok(first.delivered >= 1);

  const row = db
    .prepare(
      `SELECT dap.delivery_date AS deliveryDate, dap.exam_id AS examId,
        a.exam_id AS articleExamId
       FROM daily_auto_pushes dap
       JOIN articles a ON a.id = dap.article_id
       WHERE dap.user_id = ? AND dap.delivery_date = ?`,
    )
    .get(autoUserId, "2026-08-12") as {
    deliveryDate: string;
    examId: string;
    articleExamId: string;
  };
  assert.equal(row.examId, "high");
  assert.equal(row.articleExamId, "high");

  const repeated = dispatchDailyPushes(db, "2026-08-12");
  assert.equal(repeated.delivered, 0);
  assert.equal(repeated.skipped, first.delivered);
  const count = db
    .prepare(
      "SELECT COUNT(*) AS count FROM daily_auto_pushes WHERE user_id = ? AND delivery_date = ?",
    )
    .get(autoUserId, "2026-08-12") as { count: number };
  assert.equal(count.count, 1);
});

test("admin can inspect the bank, import authorized content, and view metrics", async () => {
  const unauthorized = await fetch(`${baseUrl}/api/v1/admin/overview`);
  assert.equal(unauthorized.status, 401);

  const headers = {
    "x-admin-key": "test-admin-key",
    "content-type": "application/json",
  };
  const imported = await fetch(`${baseUrl}/api/v1/admin/articles/import`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      examId: "toeic",
      sourceName: "Integration licensed feed",
      licenseNote: "Test fixture with confirmed internal usage rights",
      rightsConfirmed: true,
      articles: [
        {
          externalId: "integration-import-1",
          year: 2026,
          title: "An Imported Authorized Passage",
          eyebrow: "BUSINESS",
          readMinutes: 6,
          difficulty: 3,
          paragraphs: [
            "This sufficiently long paragraph represents content supplied by an authorized integration test fixture.",
          ],
          questions: [
            {
              prompt: "What does this passage represent?",
              options: ["A test fixture", "A weather report"],
              answer: 0,
              explanation:
                "The passage explicitly identifies itself as a test fixture.",
            },
          ],
        },
      ],
    }),
  });
  assert.equal(imported.status, 201);
  assert.equal((await imported.json()).data.imported, 1);

  const bank = await fetch(`${baseUrl}/api/v1/admin/articles?search=Imported`, {
    headers,
  });
  assert.equal((await bank.json()).data.length, 1);

  const filteredBank = await fetch(
    `${baseUrl}/api/v1/admin/articles?examId=toeic&eyebrow=BUSINESS`,
    { headers },
  );
  const filteredArticles = (await filteredBank.json()).data;
  assert.ok(filteredArticles.length >= 1);
  assert.ok(
    filteredArticles.every(
      (article: { examId: string; eyebrow: string }) =>
        article.examId === "toeic" && article.eyebrow === "BUSINESS",
    ),
  );

  const articleTypes = await fetch(
    `${baseUrl}/api/v1/admin/article-types?examId=toeic`,
    { headers },
  );
  const typeRows = (await articleTypes.json()).data;
  assert.ok(typeRows.some((item: { eyebrow: string }) => item.eyebrow === "BUSINESS"));

  const users = await fetch(`${baseUrl}/api/v1/admin/users`, { headers });
  const userRows = (await users.json()).data;
  assert.equal(userRows[0].id, userId);
  assert.ok(userRows[0].pushedArticles >= 6);
});

test("admin manual push reaches the selected mobile user", async () => {
  const response = await fetch(`${baseUrl}/api/v1/admin/pushes`, {
    method: "POST",
    headers: {
      "x-admin-key": "test-admin-key",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      name: "Integration push",
      message: "A manually selected practice article",
      articleIds: [firstArticleId],
      userIds: [userId],
      allUsers: false,
    }),
  });
  assert.equal(response.status, 201);
  assert.equal((await response.json()).data.deliveries, 1);

  const pushes = await request("/api/v1/pushes");
  const pushData = (await pushes.json()).data;
  const manualPush = pushData.find(
    (item: { pushName: string }) => item.pushName === "Integration push",
  );
  assert.equal(manualPush.article.id, firstArticleId);
});
