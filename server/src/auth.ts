import type { NextFunction, Request, Response } from "express";
import type { AppDatabase } from "./database";
import { ApiError } from "./http";

export type AuthUser = {
  id: string;
  deviceId: string;
  examId: string;
};

export function requireAuth(db: AppDatabase) {
  const findUser = db.prepare(`
    SELECT id, device_id AS deviceId, exam_id AS examId
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
    const user = findUser.get(token) as AuthUser | undefined;
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
