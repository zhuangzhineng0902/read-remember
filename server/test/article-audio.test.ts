import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { ArticleAudioService } from "../src/article-audio";
import { createDatabase } from "../src/database";

test("Kokoro article audio is generated once and cached in SQLite and files", async () => {
  const temporaryDirectory = mkdtempSync(path.join(tmpdir(), "read-remember-audio-"));
  const audioRoot = path.join(temporaryDirectory, "audio");
  const db = createDatabase(":memory:");
  const article = db
    .prepare("SELECT id, title FROM articles ORDER BY id LIMIT 1")
    .get() as { id: string; title: string };
  let calls = 0;
  const server = createServer(async (request, response) => {
    calls += 1;
    assert.equal(request.url, "/v1/audio/speech");
    assert.equal(request.headers.authorization, "Bearer kokoro-test-key");
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
      model: string;
      voice: string;
      input: string;
      response_format: string;
      speed: number;
    };
    assert.equal(body.model, "kokoro-test-model");
    assert.equal(body.voice, "af_heart");
    assert.ok(body.input.startsWith(article.title));
    assert.equal(body.response_format, "mp3");
    assert.equal(body.speed, 1);
    response.setHeader("content-type", "audio/mpeg");
    response.end(Buffer.from([73, 68, 51, 4, 5, 6]));
  });

  try {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert(address && typeof address !== "string");
    const service = new ArticleAudioService(db, {
      baseUrl: `http://127.0.0.1:${address.port}/v1`,
      apiPath: "/audio/speech",
      apiKey: "kokoro-test-key",
      model: "kokoro-test-model",
      format: "mp3",
      audioRoot,
      timeoutMs: 5_000,
      maxInputCharacters: 12_000,
      defaultVoice: "af_heart",
      voices: [{ id: "af_heart", label: "温和女声 · 美音" }],
    });

    const [first, concurrent] = await Promise.all([
      service.ensure(article.id, "af_heart"),
      service.ensure(article.id, "af_heart"),
    ]);
    assert.equal(calls, 1);
    assert.equal(first.audioPath, concurrent.audioPath);
    assert.equal(first.cached, false);

    const second = await service.ensure(article.id, "af_heart");
    assert.equal(calls, 1);
    assert.equal(second.cached, true);
    assert.equal(second.audioPath, first.audioPath);

    const token = first.audioPath.split("/").at(-1)!;
    const file = service.file(token);
    assert(file);
    assert.equal(file.mimeType, "audio/mpeg");
    assert.equal(file.byteSize, 6);
    assert.equal(service.metadata(article.id, "af_heart")?.cached, true);
    const count = db
      .prepare("SELECT COUNT(*) AS count FROM article_audio_cache")
      .get() as { count: number };
    assert.equal(count.count, 1);
  } finally {
    db.close();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
