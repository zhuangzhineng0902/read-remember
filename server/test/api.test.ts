import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, test } from "node:test";
import { createApp } from "../src/app";
import { createDatabase } from "../src/database";
import { dispatchDailyPushes } from "../src/daily-push";
import { lookupPronunciation } from "../src/pronunciation";

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

  const interests = await request("/api/v1/interests");
  assert.equal(interests.status, 200);
  assert.equal((await interests.json()).data.length, 5);
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

test("partial pronunciation cache returns immediately without requiring examples", async () => {
  db.prepare(
    `INSERT INTO pronunciation_cache(
      word, accent, phonetic, status, definition_en, translation_zh,
      part_of_speech, example_en, example_zh
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "partial",
    "us",
    "/ˈpɑːrʃəl/",
    "tts_only",
    "Existing only in part.",
    "部分的",
    "adjective",
    "",
    "",
  );

  const response = await request(
    "/api/v1/pronunciations/partial?accent=us&context=This%20is%20a%20partial%20example.",
  );
  assert.equal(response.status, 200);
  const value = (await response.json()).data;
  assert.equal(value.cached, true);
  assert.equal(value.translation, "部分的");
  assert.equal(value.example, "");
});

test("empty cached translations are refreshed from the bilingual dictionary", async () => {
  for (const word of ["delivering", "cargo", "medical"]) {
    db.prepare(
      `INSERT INTO pronunciation_cache(
        word, accent, phonetic, status, definition_en, translation_zh
      ) VALUES (?, 'us', '', 'tts_only', 'Cached definition.', '')`,
    ).run(word);
  }
  const translations: Record<string, string> = {
    delivering: "v. 投递，运送；交付",
    cargo: "n. 货物；货运",
    medical: "adj. 医学的，医疗的",
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.hostname === "dict.youdao.com") {
      const word = url.searchParams.get("q") ?? "";
      return new Response(
        JSON.stringify({
          ec: {
            word: [
              {
                usphone: "test-phone",
                trs: [{ tr: [{ l: { i: [translations[word]] } }] }],
              },
            ],
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url.hostname === "api.dictionaryapi.dev") {
      return new Response(
        JSON.stringify([
          {
            meanings: [
              {
                partOfSpeech: "noun",
                definitions: [{ definition: "A deterministic test entry." }],
              },
            ],
          },
        ]),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    throw new Error(`Unexpected fetch in pronunciation test: ${url}`);
  };
  try {
    for (const [word, translation] of Object.entries(translations)) {
      const result = await lookupPronunciation(db, word, "us");
      assert.equal(result.translation, translation);
      assert.equal(result.phonetic, "/test-phone/");
      assert.equal(result.cached, false);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
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

  const blocked = await request("/api/v1/daily?date=2026-08-08");
  assert.equal(blocked.status, 403);
  assert.equal((await blocked.json()).error.code, "REGISTRATION_REQUIRED");
});

test("anonymous account can register, login, and update profile", async () => {
  const registered = await request("/api/v1/auth/register", {
    method: "POST",
    body: JSON.stringify({
      deviceId: "integration-test-device",
      username: "reader_test",
      password: "reading123",
      displayName: "测试读者",
      email: "reader@example.com",
    }),
  });
  assert.equal(registered.status, 201);
  const account = (await registered.json()).data;
  assert.equal(account.isRegistered, true);
  assert.equal(account.displayName, "测试读者");

  const invalid = await request("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ username: "reader_test", password: "wrongpass" }),
  });
  assert.equal(invalid.status, 401);

  const login = await request("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ username: "reader_test", password: "reading123" }),
  });
  assert.equal(login.status, 200);
  token = (await login.json()).data.token;

  const updated = await request("/api/v1/users/me", {
    method: "PATCH",
    body: JSON.stringify({
      username: "reader_updated",
      displayName: "新的昵称",
      email: "updated@example.com",
    }),
  });
  assert.equal(updated.status, 200);
  assert.equal((await updated.json()).data.username, "reader_updated");

  const changedPassword = await request("/api/v1/users/me/password", {
    method: "PATCH",
    body: JSON.stringify({
      currentPassword: "reading123",
      newPassword: "remember456",
    }),
  });
  assert.equal(changedPassword.status, 204);

  const relogin = await request("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({
      username: "reader_updated",
      password: "remember456",
    }),
  });
  assert.equal(relogin.status, 200);

  const preferences = await request("/api/v1/users/me/preferences", {
    method: "PATCH",
    body: JSON.stringify({
      learning: {
        dailyReminderEnabled: true,
        reminderTime: "08:00",
        pronunciationAccent: "uk",
        dailyGoal: 3,
      },
      reader: {
        fontScale: 1.1,
        lineSpacing: "relaxed",
        fontFamily: "sans",
        pageTone: "green",
        columnWidth: "wide",
      },
    }),
  });
  assert.equal(preferences.status, 200);
  const preferenceData = (await preferences.json()).data;
  assert.equal(preferenceData.learning.dailyGoal, 3);
  assert.equal(preferenceData.interests.length, 5);
});

test("interest preferences drive the interest feed and mixed daily reading", async () => {
  const preferences = await request("/api/v1/users/me/preferences", {
    method: "PATCH",
    body: JSON.stringify({ interests: ["military", "art"] }),
  });
  assert.equal(preferences.status, 200);
  assert.deepEqual((await preferences.json()).data.interests, ["military", "art"]);

  const feed = await request("/api/v1/interest-feed");
  assert.equal(feed.status, 200);
  const feedItems = (await feed.json()).data as Array<{
    id: string;
    contentKind: string;
    interestId: string;
  }>;
  assert.equal(feedItems.length, 20);
  assert.ok(feedItems.every((item) => item.contentKind === "interest"));
  assert.ok(
    feedItems.every((item) => ["military", "art"].includes(item.interestId)),
  );
  assert.equal(
    feedItems.filter((item) => item.interestId === "military").length,
    10,
  );
  assert.equal(
    feedItems.filter((item) => item.interestId === "art").length,
    10,
  );

  const nextFeed = await request("/api/v1/interest-feed");
  assert.equal(nextFeed.status, 200);
  const nextFeedItems = (await nextFeed.json()).data as Array<{ id: string }>;
  assert.equal(nextFeedItems.length, 20);
  const firstFeedIds = new Set(feedItems.map((item) => item.id));
  assert.ok(nextFeedItems.every((item) => !firstFeedIds.has(item.id)));

  const article = await request(`/api/v1/articles/${feedItems[0].id}`);
  assert.equal(article.status, 200);

  const daily = await request("/api/v1/daily?date=2026-08-08");
  assert.equal(daily.status, 200);
  const dailyItems = (await daily.json()).data.articles as Array<{
    contentKind: string;
  }>;
  assert.equal(dailyItems.length, 3);
  assert.equal(
    dailyItems.filter((item) => item.contentKind === "interest").length,
    1,
  );
});

test("interest corpus contains at least one hundred unique articles per stage and category", () => {
  const rows = db
    .prepare(
      `SELECT exam_id AS examId, interest_id AS interestId,
        COUNT(*) AS total, COUNT(DISTINCT id) AS uniqueIds,
        COUNT(DISTINCT paragraphs_json) AS uniqueBodies
       FROM articles
       WHERE content_kind = 'interest'
       GROUP BY exam_id, interest_id`,
    )
    .all() as Array<{
    examId: string;
    interestId: string;
    total: number;
    uniqueIds: number;
    uniqueBodies: number;
  }>;
  assert.equal(rows.length, 25);
  assert.ok(
    rows.every(
      (row) =>
        row.total >= 100 &&
        row.uniqueIds === row.total &&
        row.uniqueBodies >= 100,
    ),
  );
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

test("custom daily goal immediately replenishes today's target articles", async () => {
  await request("/api/v1/users/me/exam", {
    method: "PATCH",
    body: JSON.stringify({ examId: "ielts" }),
  });
  const preferences = await request("/api/v1/users/me/preferences", {
    method: "PATCH",
    body: JSON.stringify({
      learning: {
        dailyReminderEnabled: true,
        reminderTime: "08:00",
        pronunciationAccent: "uk",
        dailyGoal: 5,
      },
    }),
  });
  assert.equal(preferences.status, 200);
  assert.equal((await preferences.json()).data.learning.dailyGoal, 5);

  const daily = await request("/api/v1/daily");
  const data = (await daily.json()).data;
  assert.equal(data.examId, "ielts");
  assert.equal(data.articles.length, 5);
  assert.equal(new Set(data.articles.map((item: { id: string }) => item.id)).size, 5);

  await request("/api/v1/users/me/preferences", {
    method: "PATCH",
    body: JSON.stringify({
      learning: {
        dailyReminderEnabled: true,
        reminderTime: "08:00",
        pronunciationAccent: "uk",
        dailyGoal: 3,
      },
    }),
  });
  await request("/api/v1/users/me/exam", {
    method: "PATCH",
    body: JSON.stringify({ examId: "toefl" }),
  });
});

test("article answers can be submitted and appear in history", async () => {
  const daily = await request("/api/v1/daily?date=2026-08-09");
  const articleId = (await daily.json()).data.articles[0].id as string;
  const articleResponse = await request(`/api/v1/articles/${articleId}`);
  const article = (await articleResponse.json()).data;
  assert.ok(article.paragraphs.length > 0);
  assert.ok(article.questions[0].options.length > 0);
  assert.equal("answer" in article.questions[0], false);

  const draftAnswers = article.questions.map(
    (_: unknown, index: number) => (index === 0 ? 1 : null),
  );
  const savedDraft = await request(`/api/v1/articles/${articleId}/answers`, {
    method: "PUT",
    body: JSON.stringify({ answers: draftAnswers }),
  });
  assert.equal(savedDraft.status, 200);
  assert.deepEqual((await savedDraft.json()).data.answers, draftAnswers);

  const restoredDraft = await request(`/api/v1/articles/${articleId}/answers`);
  assert.equal(restoredDraft.status, 200);
  const restoredDraftData = (await restoredDraft.json()).data;
  assert.equal(restoredDraftData.submitted, false);
  assert.deepEqual(restoredDraftData.answers, draftAnswers);

  const readingState = await request(
    `/api/v1/articles/${articleId}/reading-state`,
    {
      method: "PUT",
      body: JSON.stringify({ offsetY: 480, ratio: 0.6, sessionSeconds: 95 }),
    },
  );
  assert.equal(readingState.status, 200);
  assert.equal((await readingState.json()).data.readingSeconds, 95);

  const storedQuestions = JSON.parse(
    (
      db
        .prepare("SELECT questions_json AS questionsJson FROM articles WHERE id = ?")
        .get(articleId) as { questionsJson: string }
    ).questionsJson,
  ) as Array<{ answer: number; options: string[] }>;
  const wrongAnswers = storedQuestions.map(
    (question) => (question.answer + 1) % question.options.length,
  );

  const completion = await request(`/api/v1/articles/${articleId}/complete`, {
    method: "POST",
    body: JSON.stringify({ answers: wrongAnswers }),
  });
  assert.equal(completion.status, 200);
  assert.equal((await completion.json()).data.total, article.questions.length);

  const restoredCompletion = await request(
    `/api/v1/articles/${articleId}/answers`,
  );
  const restoredCompletionData = (await restoredCompletion.json()).data;
  assert.equal(restoredCompletionData.submitted, true);
  assert.equal(restoredCompletionData.results.length, article.questions.length);
  assert.deepEqual(
    restoredCompletionData.answers,
    wrongAnswers,
  );

  const stats = await request("/api/v1/users/me/stats");
  const statsData = (await stats.json()).data;
  assert.equal(statsData.completedArticles, 1);
  assert.equal(statsData.readingSeconds, 95);
  assert.equal(statsData.correctAnswers, 0);

  const mistakes = await request("/api/v1/mistakes");
  assert.equal((await mistakes.json()).data.length, article.questions.length);

  const history = await request("/api/v1/history?limit=100");
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
  assert.equal(typeof detailedVocabulary[0].articleTitle, "string");
  assert.ok(detailedVocabulary[0].articleTitle.length > 0);
  assert.equal(detailedVocabulary[0].memoryStage, 0);
  assert.equal(detailedVocabulary[0].reviewCount, 0);

  const reviewed = await request("/api/v1/vocabulary/vulnerable/review", {
    method: "POST",
    body: JSON.stringify({ examId: "toefl", rating: "good" }),
  });
  assert.equal(reviewed.status, 200);
  const reviewedWord = (await reviewed.json()).data;
  assert.equal(reviewedWord.memoryStage, 1);
  assert.equal(reviewedWord.reviewCount, 1);
  assert.equal(reviewedWord.lapseCount, 0);
  assert.ok(Date.parse(reviewedWord.nextReviewAt) > Date.now());

  const removed = await request("/api/v1/vocabulary/vulnerable?examId=toefl", {
    method: "DELETE",
  });
  assert.equal(removed.status, 204);
});

test("changing exam creates three new target articles on the same date", async () => {
  const changed = await request("/api/v1/users/me/exam", {
    method: "PATCH",
    body: JSON.stringify({ examId: "toeic" }),
  });
  assert.equal((await changed.json()).data.examId, "toeic");

  const daily = await request("/api/v1/daily?date=2026-08-09");
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
  const importedArticle = db
    .prepare("SELECT id FROM articles WHERE title = ?")
    .get("An Imported Authorized Passage") as { id: string };
  const response = await fetch(`${baseUrl}/api/v1/admin/pushes`, {
    method: "POST",
    headers: {
      "x-admin-key": "test-admin-key",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      name: "Integration push",
      message: "A manually selected practice article",
      articleIds: [importedArticle.id],
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
  assert.equal(manualPush.article.id, importedArticle.id);

  const savedFromPush = await request("/api/v1/vocabulary/synchronized", {
    method: "PUT",
    body: JSON.stringify({
      examId: "toeic",
      articleId: importedArticle.id,
      phonetic: "",
      translation: "同步的",
    }),
  });
  assert.equal(savedFromPush.status, 201);
  assert.equal((await savedFromPush.json()).data.phonetic, "");

  const removed = await request(
    "/api/v1/vocabulary/synchronized?examId=toeic",
    { method: "DELETE" },
  );
  assert.equal(removed.status, 204);
});
