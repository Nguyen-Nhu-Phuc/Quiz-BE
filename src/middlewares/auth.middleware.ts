import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { Types } from "mongoose";
import { env } from "../config/env";
import { AppError } from "./error.middleware";

interface JwtPayload {
  sub: string;
}

export function authMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    next(new AppError(401, "Thiếu token xác thực."));
    return;
  }

  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, env.jwtSecret) as JwtPayload;
    if (!Types.ObjectId.isValid(payload.sub)) {
      next(new AppError(401, "Token không hợp lệ."));
      return;
    }
    req.userId = payload.sub;
    req.userObjectId = new Types.ObjectId(payload.sub);
    next();
  } catch {
    next(new AppError(401, "Token hết hạn hoặc không hợp lệ."));
  }
}
