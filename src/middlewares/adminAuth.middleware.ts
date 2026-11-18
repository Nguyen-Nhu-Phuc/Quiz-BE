import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { Types } from "mongoose";
import { env } from "../config/env";
import { AppError } from "./error.middleware";

interface AdminJwtPayload {
  role?: string;
  sub?: string;
}

/** JWT user có `role: "admin"` (đăng nhập email/Google). */
export function adminAuthMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    next(new AppError(401, "Thiếu token admin."));
    return;
  }

  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, env.jwtSecret) as AdminJwtPayload;
    if (payload.role !== "admin") {
      next(new AppError(403, "Không phải phiên admin."));
      return;
    }
    if (!payload.sub || !Types.ObjectId.isValid(payload.sub)) {
      next(new AppError(401, "Token admin không hợp lệ."));
      return;
    }
    req.isAdmin = true;
    req.userId = payload.sub;
    req.userObjectId = new Types.ObjectId(payload.sub);
    next();
  } catch {
    next(new AppError(401, "Token admin hết hạn hoặc không hợp lệ."));
  }
}
