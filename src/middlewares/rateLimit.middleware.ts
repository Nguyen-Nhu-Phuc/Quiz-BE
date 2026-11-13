import type { NextFunction, Request, Response } from "express";
import { AppError } from "./error.middleware";

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

/** Rate limit đơn giản in-memory theo userId (hoặc IP). */
export function rateLimit(options: {
  windowMs: number;
  max: number;
  keyPrefix: string;
}) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const id = req.userId || req.ip || "anon";
    const key = `${options.keyPrefix}:${id}`;
    const now = Date.now();
    let bucket = buckets.get(key);

    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + options.windowMs };
      buckets.set(key, bucket);
    }

    bucket.count += 1;
    if (bucket.count > options.max) {
      next(
        new AppError(
          429,
          "Quá nhiều yêu cầu. Vui lòng thử lại sau vài phút.",
        ),
      );
      return;
    }
    next();
  };
}
