import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { NextFunction, Request, Response } from "express";
import type { AppDatabase } from "./database";
import { ApiError } from "./http";

export type AuthUser = {
  id: string;
  deviceId: string;
  examId: string;
  username: string | null;
  displayName: string;
  email: string;
  isRegistered: boolean;
};

const scryptAsync = promisify(scrypt);

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scryptAsync(password, salt, 64)) as Buffer;
  return `scrypt:${salt}:${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [algorithm, salt, encoded] = stored.split(":");
  if (algorithm !== "scrypt" || !salt || !encoded) return false;
  const expected = Buffer.from(encoded, "hex");
  const actual = (await scryptAsync(password, salt, expected.length)) as Buffer;
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function requireAuth(db: AppDatabase) {
  const findUser = db.prepare(`
    SELECT id, device_id AS deviceId, exam_id AS examId,
      username, display_name AS displayName, email,
      CASE WHEN username IS NULL THEN 0 ELSE 1 END AS isRegistered
    FROM users
    WHERE token = ?
  `);

  return (req: Request, res: Response, next: NextFunction) => {
    const authorization = req.header("authorization");
    if (!authorization?.startsWith("Bearer ")) {
      next(new ApiError(401, "UNAUTHORIZED", "缺少登录凭证"));
      return;
    }

    const token = authorization.slice("Bearer ".length).trim();
    const row = findUser.get(token) as
      | (Omit<AuthUser, "isRegistered"> & { isRegistered: number })
      | undefined;
    const user = row
      ? { ...row, isRegistered: Boolean(row.isRegistered) }
      : undefined;
    if (!user) {
      next(new ApiError(401, "UNAUTHORIZED", "登录凭证无效或已过期"));
      return;
    }

    res.locals.user = user;
    next();
  };
}

export function currentUser(res: Response): AuthUser {
  return res.locals.user as AuthUser;
}

export function requireRegistered(
  _req: Request,
  res: Response,
  next: NextFunction,
) {
  if (!currentUser(res).isRegistered) {
    next(new ApiError(403, "REGISTRATION_REQUIRED", "请先注册或登录正式账号"));
    return;
  }
  next();
}
