import type { NextFunction, Request, Response } from "express";
import multer from "multer";
import { ZodError } from "zod";
import { env } from "../config/env";

export class AppError extends Error {
  status: number;
  details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
    this.name = "AppError";
  }
}

export function notFoundHandler(
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  res.status(404).json({
    success: false,
    error: { message: "Không tìm thấy endpoint." },
  });
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof AppError) {
    res.status(err.status).json({
      success: false,
      error: { message: err.message, details: err.details },
    });
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      success: false,
      error: {
        message: "Dữ liệu không hợp lệ.",
        details: err.flatten(),
      },
    });
    return;
  }

  // QA U6: file quá lớn / multer → message tiếng Việt rõ
  if (err instanceof multer.MulterError) {
    const message =
      err.code === "LIMIT_FILE_SIZE"
        ? env.maxUploadMb > 0
          ? `File vượt quá giới hạn ${env.maxUploadMb}MB.`
          : "File quá lớn."
        : err.code === "LIMIT_FILE_COUNT" || err.code === "LIMIT_UNEXPECTED_FILE"
          ? "Quá nhiều file trong một lần tải lên."
          : `Lỗi tải file: ${err.message}`;
    res.status(err.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({
      success: false,
      error: { message },
    });
    return;
  }

  // Gemini / fetch mạng — trả message rõ, không “Lỗi máy chủ” chung
  const msg = err instanceof Error ? err.message : String(err);
  const cause =
    err instanceof Error && err.cause instanceof Error
      ? err.cause.message
      : "";
  if (/fetch failed|ECONNRESET|ETIMEDOUT|UND_ERR|socket hang up/i.test(`${msg} ${cause}`)) {
    console.error("[error] network/gemini", msg, cause || undefined);
    res.status(502).json({
      success: false,
      error: {
        message:
          "Mất kết nối tới Gemini (file lớn hoặc mạng không ổn). Thử lại, hoặc upload ít / file nhỏ hơn.",
        details: env.nodeEnv === "development" ? `${msg} ${cause}`.trim() : undefined,
      },
    });
    return;
  }

  console.error("[error]", err);
  res.status(500).json({
    success: false,
    error: {
      message: "Lỗi máy chủ.",
      details: env.nodeEnv === "development" ? String(err) : undefined,
    },
  });
}
