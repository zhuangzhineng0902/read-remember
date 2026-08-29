import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { after, before, test } from "node:test";
import { createApp } from "../src/app";
import { createDatabase } from "../src/database";
import { dispatchDailyPushes } from "../src/daily-push";
import { lookupPronunciation } from "../src/pronunciation";
import { EcdictDictionary } from "../src/ecdict";

const { DatabaseSync } = createRequire(import.meta.url)(
  "node:sqlite",
) as typeof import("node:sqlite");

const db = createDatabase(":memory:");
let phraseTranslationCalls = 0;
let articleTranslationCalls = 0;
const enqueuedCustomStories: string[] = [];
const cachedArticleTranslation = (articleId: string, targetLanguage = "zh-CN") => {
  const row = db
    .prepare(
      `SELECT article_id AS articleId, target_language AS targetLanguage,
        translated_title AS title,
        translated_paragraphs_json AS paragraphsJson,
        provider, model, translated_at AS translatedAt
       FROM article_translations
       WHERE article_id = ? AND target_language = ?`,
    )
    .get(articleId, targetLanguage) as
    | {
        articleId: string;
        targetLanguage: string;
        title: string;
        paragraphsJson: string;
        provider: string;
        model: string;
        translatedAt: string;
      }
    | undefined;
  return row
    ? {
        articleId: row.articleId,
        targetLanguage: row.targetLanguage,
        title: row.title,
        paragraphs: JSON.parse(row.paragraphsJson) as string[],
        provider: row.provider,
        model: row.model,
        translatedAt: row.translatedAt,
        cached: true,
      }
    : null;
};
const server = createServer(
  createApp(
    db,
    {
      corsOrigin: "*",
      adminApiKey: "test-admin-key",
      syncAllowedHosts: [],
      dailyPushEnabled: false,
    },
    null,
    null,
    {
      enabled: true,
      async translate(text, context, targetLanguage = "zh-CN") {
        phraseTranslationCalls += 1;
        return {
          text,
          translation: context.includes("clock") ? "墙上的大钟" : "测试短语",
          targetLanguage,
          cached: false,
        };
      },
    },
    {
      enabled: true,
      metadata: cachedArticleTranslation,
      async ensure(articleId, targetLanguage = "zh-CN") {
        const cached = cachedArticleTranslation(articleId, targetLanguage);
        if (cached) return cached;
        articleTranslationCalls += 1;
        db.prepare(
          `INSERT INTO article_translations(
            article_id, target_language, source_hash, translated_title,
            translated_paragraphs_json, provider, model
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          articleId,
          targetLanguage,
          "test-source-hash",
          "测试中文标题",
          JSON.stringify(["第一段中文译文。", "第二段中文译文。"]),
          "http://translation.test/v1",
          "test-translator",
        );
        return {
          ...cachedArticleTranslation(articleId, targetLanguage)!,
          cached: false,
        };
      },
    },
    {
      enabled: true,
      enqueue(requestId) {
        enqueuedCustomStories.push(requestId);
      },
      resume() {},
    },
  ),
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
  assert.equal((await interests.json()).data.length, 9);
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

test("empty cached translations are refreshed from the local ECDICT database", async () => {
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
  const dictionaryDb = new DatabaseSync(":memory:");
  dictionaryDb.exec(`CREATE TABLE stardict(
    word TEXT COLLATE NOCASE PRIMARY KEY,
    phonetic TEXT,
    definition TEXT,
    translation TEXT,
    pos TEXT,
    exchange TEXT
  )`);
  const insert = dictionaryDb.prepare(
    `INSERT INTO stardict(word, phonetic, definition, translation, pos, exchange)
     VALUES (?, 'test-phone', 'A deterministic test entry.', ?, ?, NULL)`,
  );
  insert.run("deliver", translations.delivering, "v:100");
  insert.run("cargo", translations.cargo, "n:100");
  insert.run("medical", translations.medical, "j:100");
  const dictionary = new EcdictDictionary(dictionaryDb, ":memory:");
  try {
    for (const [word, translation] of Object.entries(translations)) {
      const result = await lookupPronunciation(
        db,
        word,
        "us",
        "",
        false,
        dictionary,
      );
      assert.equal(result.translation, translation);
      assert.equal(result.phonetic, "/test-phone/");
      assert.equal(result.cached, false);
    }
  } finally {
    dictionary.close();
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
  assert.equal(preferenceData.interests.length, 9);
});

test("registered users can queue and inspect a private custom story", async () => {
  const created = await request("/api/v1/custom-stories", {
    method: "POST",
    body: JSON.stringify({
      idea: "三个孩子在会移动的图书馆里寻找一张失踪的星图",
      characters: "爱画画的 Mia、擅长机械的 Ben",
      keywords: ["星图", "机关", "猫"],
      plotNotes: "每一集找到一部分地图，最后发现猫一直在保护它",
      tone: "mystery",
      episodeCount: 3,
      readerStage: "stage1",
    }),
  });
  assert.equal(created.status, 202);
  const story = (await created.json()).data;
  assert.equal(story.status, "queued");
  assert.equal(story.progressStage, "queued");
  assert.equal(story.progressMessage, "等待开始创作");
  assert.equal(story.progressPercent, 0);
  assert.equal(story.completedEpisodeCount, 0);
  assert.equal(story.resumeAvailable, false);
  assert.equal(story.episodeCount, 3);
  assert.deepEqual(story.keywords, ["星图", "机关", "猫"]);
  assert.deepEqual(enqueuedCustomStories, [story.id]);

  const detail = await request(`/api/v1/custom-stories/${story.id}`);
  assert.equal(detail.status, 200);
  assert.equal((await detail.json()).data.idea, story.idea);

  const list = await request("/api/v1/custom-stories");
  assert.equal(list.status, 200);
  assert.equal((await list.json()).data[0].id, story.id);

  const invalid = await request("/api/v1/custom-stories", {
    method: "POST",
    body: JSON.stringify({ idea: "太短" }),
  });
  assert.equal(invalid.status, 400);

  db.prepare(
    "UPDATE custom_story_requests SET status = 'failed', error_message = 'bad json' WHERE id = ?",
  ).run(story.id);
  const retried = await request(`/api/v1/custom-stories/${story.id}/retry`, {
    method: "POST",
  });
  assert.equal(retried.status, 202);
  const retriedStory = (await retried.json()).data;
  assert.equal(retriedStory.status, "queued");
  assert.equal(retriedStory.progressMessage, "等待重新开始创作");
  assert.equal(retriedStory.progressPercent, 0);
  assert.deepEqual(enqueuedCustomStories, [story.id, story.id]);

  db.prepare(
    `UPDATE custom_story_requests
     SET status = 'failed', checkpoint_json = '{"version":1}',
         checkpoint_episode_count = 1 WHERE id = ?`,
  ).run(story.id);
  const resumed = await request(`/api/v1/custom-stories/${story.id}/retry`, {
    method: "POST",
  });
  assert.equal(resumed.status, 202);
  const resumedStory = (await resumed.json()).data;
  assert.equal(resumedStory.resumeAvailable, true);
  assert.equal(resumedStory.completedEpisodeCount, 1);
  assert.equal(resumedStory.progressMessage, "等待从第 2 集继续创作");
  assert.equal(resumedStory.progressPercent, 45);
  assert.deepEqual(enqueuedCustomStories, [story.id, story.id, story.id]);
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
    id: string;
    contentKind: string;
  }>;
  assert.equal(dailyItems.length, 3);
  assert.deepEqual(
    dailyItems.map((item) => item.contentKind),
    ["interest", "exam", "interest"],
  );

  const selected = await request("/api/v1/daily/select", {
    method: "POST",
    body: JSON.stringify({
      date: "2026-08-08",
      articleId: dailyItems[1].id,
    }),
  });
  assert.equal(selected.status, 200);
  const selectedDaily = await request("/api/v1/daily?date=2026-08-08");
  assert.equal(
    (await selectedDaily.json()).data.selectedArticleId,
    dailyItems[1].id,
  );

  // Simulate a legacy client that persisted the selected exam in the first
  // card. The API should keep the selection while restoring strict role order.
  db.prepare(
    `UPDATE deliveries SET slot = 4
     WHERE user_id = ? AND delivery_date = ? AND exam_id = ? AND article_id = ?`,
  ).run(userId, "2026-08-08", "toefl", dailyItems[0].id);
  db.prepare(
    `UPDATE deliveries SET slot = 1
     WHERE user_id = ? AND delivery_date = ? AND exam_id = ? AND article_id = ?`,
  ).run(userId, "2026-08-08", "toefl", dailyItems[1].id);
  db.prepare(
    `UPDATE deliveries SET slot = 2
     WHERE user_id = ? AND delivery_date = ? AND exam_id = ? AND article_id = ?`,
  ).run(userId, "2026-08-08", "toefl", dailyItems[0].id);

  const repairedDaily = await request("/api/v1/daily?date=2026-08-08");
  assert.equal(repairedDaily.status, 200);
  const repairedData = (await repairedDaily.json()).data as {
    selectedArticleId: string;
    articles: Array<{ id: string; contentKind: string }>;
  };
  assert.equal(repairedData.selectedArticleId, dailyItems[1].id);
  assert.deepEqual(
    repairedData.articles.map((item) => item.contentKind),
    ["interest", "exam", "interest"],
  );
  assert.equal(repairedData.articles[1].id, dailyItems[1].id);
});

test("interest corpus contains broad reference reading and complete original story series", () => {
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
  assert.equal(rows.length, 45);
  assert.ok(
    rows.every(
      (row) =>
        row.total >= (["mecha", "cultivation", "tiger", "cat"].includes(row.interestId) ? 6 : 100) &&
        row.uniqueIds === row.total &&
        row.uniqueBodies >= (["mecha", "cultivation", "tiger", "cat"].includes(row.interestId) ? 6 : 100),
    ),
  );
});

test("completing a story episode unlocks the next chapter", async () => {
  const preferences = await request("/api/v1/users/me/preferences", {
    method: "PATCH",
    body: JSON.stringify({ interests: ["mecha"] }),
  });
  assert.equal(preferences.status, 200);

  const feed = await request("/api/v1/interest-feed?interestId=mecha&limit=1");
  assert.equal(feed.status, 200);
  const first = (await feed.json()).data[0] as {
    id: string;
    seriesTitle: string;
    episodeNumber: number;
  };
  assert.equal(first.episodeNumber, 1);

  const completed = await request(`/api/v1/articles/${first.id}/complete`, {
    method: "POST",
    body: JSON.stringify({ answers: [0, 1] }),
  });
  assert.equal(completed.status, 200);
  const nextEpisode = (await completed.json()).data.nextEpisode as {
    id: string;
    seriesTitle: string;
    episodeNumber: number;
  };
  assert.equal(nextEpisode.seriesTitle, first.seriesTitle);
  assert.equal(nextEpisode.episodeNumber, 2);

  const nextArticle = await request(`/api/v1/articles/${nextEpisode.id}`);
  assert.equal(nextArticle.status, 200);

  // Keep this integration assertion isolated from later aggregate-stat tests.
  db.prepare("DELETE FROM article_progress WHERE user_id = ? AND article_id = ?").run(
    userId,
    first.id,
  );
  db.prepare("DELETE FROM article_attempts WHERE user_id = ? AND article_id = ?").run(
    userId,
    first.id,
  );
  const restoredPreferences = await request("/api/v1/users/me/preferences", {
    method: "PATCH",
    body: JSON.stringify({ interests: ["military", "art"] }),
  });
  assert.equal(restoredPreferences.status, 200);
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

test("a delivered article supports context-aware multi-word translation", async () => {
  assert.ok(firstArticleId);
  const translated = await request("/api/v1/phrases/translate", {
    method: "POST",
    body: JSON.stringify({
      articleId: firstArticleId,
      text: "the big clock",
      context: "Dan put the big clock on the wall.",
      targetLanguage: "zh-CN",
    }),
  });
  assert.equal(translated.status, 200);
  const value = (await translated.json()).data;
  assert.equal(value.translation, "墙上的大钟");
  assert.equal(value.text, "the big clock");
  assert.equal(phraseTranslationCalls, 1);
});

test("translated article content is returned when materialized", async () => {
  const missing = await request(
    `/api/v1/articles/${firstArticleId}/translation`,
  );
  assert.equal(missing.status, 200);
  assert.equal((await missing.json()).data, null);

  const generated = await request(
    `/api/v1/articles/${firstArticleId}/translation`,
    {
      method: "POST",
      body: JSON.stringify({ language: "zh-CN" }),
    },
  );
  assert.equal(generated.status, 201);
  assert.equal(articleTranslationCalls, 1);

  const response = await request(
    `/api/v1/articles/${firstArticleId}/translation`,
  );
  assert.equal(response.status, 200);
  const translation = (await response.json()).data;
  assert.equal(translation.articleId, firstArticleId);
  assert.equal(translation.targetLanguage, "zh-CN");
  assert.equal(translation.title, "测试中文标题");
  assert.deepEqual(translation.paragraphs, [
    "第一段中文译文。",
    "第二段中文译文。",
  ]);
  assert.equal(translation.model, "test-translator");

  const cached = await request(
    `/api/v1/articles/${firstArticleId}/translation`,
    {
      method: "POST",
      body: JSON.stringify({ language: "zh-CN" }),
    },
  );
  assert.equal(cached.status, 200);
  assert.equal(articleTranslationCalls, 1);
});

test("daily reading remains a three-card choice when legacy goal settings change", async () => {
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
  assert.equal(data.articles.length, 3);
  assert.equal(new Set(data.articles.map((item: { id: string }) => item.id)).size, 3);

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
  assert.equal(saved.status, 201, await saved.clone().text());

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

test("admin can add a custom interest used by preferences and article imports", async () => {
  const headers = {
    "x-admin-key": "test-admin-key",
    "content-type": "application/json",
  };
  const created = await fetch(`${baseUrl}/api/v1/admin/interests`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      id: "dinosaur",
      name: "恐龙探险",
      subtitle: "化石、史前世界与科学冒险",
      emoji: "🦕",
      color: "#55766D",
      activityPrompt: "用一句英文记录本章发现，并预测下一集。",
      storyPrompt: "围绕恐龙、化石和野外考察创作连续冒险，知识必须来自观察和证据。",
    }),
  });
  assert.equal(created.status, 201, await created.clone().text());

  const catalog = await request("/api/v1/interests");
  const categories = (await catalog.json()).data as Array<{ id: string }>;
  assert.ok(categories.some((category) => category.id === "dinosaur"));

  const preferences = await request("/api/v1/users/me/preferences", {
    method: "PATCH",
    body: JSON.stringify({ interests: ["dinosaur", "science"] }),
  });
  assert.equal(preferences.status, 200, await preferences.clone().text());
  assert.deepEqual((await preferences.json()).data.interests, ["dinosaur", "science"]);

  const imported = await fetch(`${baseUrl}/api/v1/admin/articles/import`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      examId: "middle",
      sourceName: "Custom interest test",
      licenseNote: "Original test content for custom interest validation",
      rightsConfirmed: true,
      articles: [
        {
          externalId: "dinosaur-test-1",
          year: 2026,
          title: "The Footprint Beside the Tent",
          eyebrow: "DINOSAUR FIELD MYSTERY",
          readMinutes: 4,
          difficulty: 2,
          contentKind: "interest",
          interestId: "dinosaur",
          seriesTitle: "The Young Fossil Team",
          episodeNumber: 1,
          paragraphs: [
            "Mia found a three-toed mark beside the team's tent, but the rain had fallen before anyone arrived at the field camp.",
          ],
          questions: [
            {
              prompt: "What did Mia find beside the tent?",
              options: ["A footprint", "A map", "A feather", "A key"],
              answer: 0,
              explanation: "The passage says she found a three-toed mark.",
            },
          ],
        },
      ],
    }),
  });
  assert.equal(imported.status, 201, await imported.clone().text());
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
  const primaryUser = userRows.find((user: { id: string }) => user.id === userId);
  assert.ok(primaryUser);
  assert.ok(primaryUser.pushedArticles >= 6);
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
