import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { createDatabase } from "../src/database";
import { PhraseTranslationService } from "../src/phrase-translation";

test("phrase translation uses sentence context and caches identical selections", async () => {
  let requestCount = 0;
  const provider = createServer((request, response) => {
    requestCount += 1;
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      const payload = JSON.parse(body) as {
        messages: Array<{ role: string; content: string }>;
      };
      const userMessage = JSON.parse(payload.messages.at(-1)?.content ?? "{}") as {
        text?: string;
        context?: string;
      };
      assert.equal(userMessage.text, "deliver medical cargo");
      assert.match(userMessage.context ?? "", /helicopter/i);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          choices: [{ message: { content: '{"translation":"运送医疗物资"}' } }],
        }),
      );
    });
  });
  await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
  const address = provider.address();
  assert(address && typeof address !== "string");

  const db = createDatabase(":memory:");
  const service = new PhraseTranslationService(db, {
    baseUrl: `http://127.0.0.1:${address.port}`,
    apiPath: "/chat/completions",
    apiKey: "test-key",
    model: "test-model",
    timeoutMs: 2_000,
    headers: {},
  });

  try {
    const first = await service.translate(
      " deliver   medical cargo ",
      "The helicopter can deliver medical cargo to the island.",
    );
    const second = await service.translate(
      "deliver medical cargo",
      "The helicopter can deliver medical cargo to the island.",
    );

    assert.equal(first.translation, "运送医疗物资");
    assert.equal(first.cached, false);
    assert.equal(second.translation, "运送医疗物资");
    assert.equal(second.cached, true);
    assert.equal(requestCount, 1);
    assert.equal(
      (db.prepare("SELECT COUNT(*) AS count FROM phrase_translation_cache").get() as {
        count: number;
      }).count,
      1,
    );
  } finally {
    db.close();
    await new Promise<void>((resolve, reject) =>
      provider.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
