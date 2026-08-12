import type { AppDatabase } from "./database";

const examNames: Record<string, string> = {
  toefl: "托福",
  ielts: "雅思",
  toeic: "托业",
  middle: "初中英语",
  high: "高中英语",
};

export type DailyPushResult = {
  date: string;
  users: number;
  delivered: number;
  skipped: number;
  exhausted: number;
};

function assertDate(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`Invalid daily push date: ${date}`);
  }
}

export function localDateParts(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    hour: Number(value("hour")),
  };
}

export function dispatchDailyPushes(
  db: AppDatabase,
  date: string,
): DailyPushResult {
  assertDate(date);
  const users = db
    .prepare("SELECT id, exam_id AS examId FROM users ORDER BY id")
    .all() as Array<{ id: string; examId: string }>;
  const result: DailyPushResult = {
    date,
    users: users.length,
    delivered: 0,
    skipped: 0,
    exhausted: 0,
  };

  const existing = db.prepare(
    "SELECT 1 FROM daily_auto_pushes WHERE user_id = ? AND delivery_date = ?",
  );
  const chooseArticle = db.prepare(`
    SELECT a.id
    FROM articles a
    WHERE a.exam_id = ?
      AND NOT EXISTS (
        SELECT 1 FROM deliveries d
        WHERE d.user_id = ? AND d.article_id = a.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM user_push_items up
        WHERE up.user_id = ? AND up.article_id = a.id
      )
    ORDER BY a.year DESC, a.created_at DESC, a.id ASC
    LIMIT 1
  `);
  const batchId = `daily-auto-${date}`;

  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(
      `INSERT INTO push_batches(id, name, message, target_type)
       VALUES (?, ?, ?, 'selected')
       ON CONFLICT(id) DO NOTHING`,
    ).run(
      batchId,
      `每日自动推荐 · ${date}`,
      "根据你选择的考试目标，为你推荐一篇今日阅读练习",
    );
    const addBatchArticle = db.prepare(
      "INSERT OR IGNORE INTO push_items(batch_id, article_id) VALUES (?, ?)",
    );
    const deliver = db.prepare(
      `INSERT INTO user_push_items(batch_id, article_id, user_id)
       VALUES (?, ?, ?)`,
    );
    const record = db.prepare(
      `INSERT INTO daily_auto_pushes(
         user_id, delivery_date, batch_id, article_id, exam_id
       ) VALUES (?, ?, ?, ?, ?)`,
    );

    for (const user of users) {
      if (existing.get(user.id, date)) {
        result.skipped += 1;
        continue;
      }
      const article = chooseArticle.get(
        user.examId,
        user.id,
        user.id,
      ) as { id: string } | undefined;
      if (!article) {
        result.exhausted += 1;
        continue;
      }
      addBatchArticle.run(batchId, article.id);
      deliver.run(batchId, article.id, user.id);
      record.run(user.id, date, batchId, article.id, user.examId);
      result.delivered += 1;
    }

    if (result.delivered === 0) {
      db.prepare(
        `DELETE FROM push_batches
         WHERE id = ?
           AND NOT EXISTS (
             SELECT 1 FROM daily_auto_pushes WHERE batch_id = ?
           )`,
      ).run(batchId, batchId);
    } else {
      db.prepare(
        "INSERT INTO admin_audit_logs(action, detail_json) VALUES (?, ?)",
      ).run(
        "pushes.automatic",
        JSON.stringify({
          date,
          delivered: result.delivered,
          exhausted: result.exhausted,
          exams: [...new Set(users.map((user) => examNames[user.examId]))],
        }),
      );
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return result;
}

export function ensureDailyPushForUser(
  db: AppDatabase,
  userId: string,
  date: string,
) {
  assertDate(date);
  db.exec("BEGIN IMMEDIATE");
  try {
    const existing = db
      .prepare(
        `SELECT article_id AS articleId FROM daily_auto_pushes
         WHERE user_id = ? AND delivery_date = ?`,
      )
      .get(userId, date) as { articleId: string } | undefined;
    if (existing) {
      db.exec("COMMIT");
      return existing.articleId;
    }

    const user = db
      .prepare("SELECT exam_id AS examId FROM users WHERE id = ?")
      .get(userId) as { examId: string } | undefined;
    if (!user) {
      db.exec("COMMIT");
      return null;
    }
    const article = db
      .prepare(
        `SELECT a.id FROM articles a
         WHERE a.exam_id = ?
           AND NOT EXISTS (
             SELECT 1 FROM deliveries d
             WHERE d.user_id = ? AND d.article_id = a.id
           )
           AND NOT EXISTS (
             SELECT 1 FROM user_push_items up
             WHERE up.user_id = ? AND up.article_id = a.id
           )
         ORDER BY a.year DESC, a.created_at DESC, a.id ASC LIMIT 1`,
      )
      .get(user.examId, userId, userId) as { id: string } | undefined;
    if (!article) {
      db.exec("COMMIT");
      return null;
    }

    const batchId = `daily-auto-${date}`;
    db.prepare(
      `INSERT INTO push_batches(id, name, message, target_type)
       VALUES (?, ?, ?, 'selected') ON CONFLICT(id) DO NOTHING`,
    ).run(
      batchId,
      `每日自动推荐 · ${date}`,
      `根据你的${examNames[user.examId] ?? "英语"}目标，为你推荐一篇今日阅读练习`,
    );
    db.prepare(
      "INSERT OR IGNORE INTO push_items(batch_id, article_id) VALUES (?, ?)",
    ).run(batchId, article.id);
    db.prepare(
      `INSERT INTO user_push_items(batch_id, article_id, user_id)
       VALUES (?, ?, ?)`,
    ).run(batchId, article.id, userId);
    db.prepare(
      `INSERT INTO daily_auto_pushes(
         user_id, delivery_date, batch_id, article_id, exam_id
       ) VALUES (?, ?, ?, ?, ?)`,
    ).run(userId, date, batchId, article.id, user.examId);
    db.exec("COMMIT");
    return article.id;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function startDailyPushScheduler(
  db: AppDatabase,
  options: {
    enabled: boolean;
    hour: number;
    timeZone: string;
    intervalMs?: number;
  },
) {
  let lastRunDate = "";
  const run = () => {
    if (!options.enabled) return null;
    const current = localDateParts(new Date(), options.timeZone);
    if (current.hour < options.hour || current.date === lastRunDate) return null;
    try {
      const result = dispatchDailyPushes(db, current.date);
      lastRunDate = current.date;
      console.log(
        `Daily auto push ${current.date}: ${result.delivered} delivered, ${result.exhausted} exhausted`,
      );
      return result;
    } catch (error) {
      console.error(`Daily auto push ${current.date} failed`, error);
      return null;
    }
  };
  run();
  const timer = setInterval(run, options.intervalMs ?? 60_000);
  timer.unref();
  return { run, stop: () => clearInterval(timer) };
}
