import { AppError } from "../middlewares/error.middleware";

export function isTransientGeminiError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const cause =
    err instanceof Error && err.cause instanceof Error
      ? err.cause.message
      : "";
  const text = `${msg} ${cause}`;
  return /fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|socket|network|503|429|high demand|temporarily|timeout|UND_ERR/i.test(
    text,
  );
}

/** Đổi lỗi mạng/SDK Gemini thành AppError tiếng Việt (không lộ TypeError thô). */
export function toGeminiAppError(err: unknown, context = "Gemini"): AppError {
  if (err instanceof AppError) return err;

  const msg = err instanceof Error ? err.message : String(err);
  const cause =
    err instanceof Error && err.cause instanceof Error
      ? ` (${err.cause.message})`
      : "";

  if (/fetch failed|ECONNRESET|ETIMEDOUT|socket|UND_ERR/i.test(msg + cause)) {
    return new AppError(
      502,
      `${context}: mất kết nối tới Google (file lớn / mạng không ổn). Thử lại, hoặc upload ít file / file nhỏ hơn.`,
      { original: msg + cause },
    );
  }
  if (/413|too large|payload|size/i.test(msg)) {
    return new AppError(
      413,
      `${context}: file quá lớn để gửi lên Gemini. Hãy tách file hoặc nén PDF.`,
    );
  }
  if (/404|no longer available/i.test(msg)) {
    return new AppError(502, `${context}: model không còn khả dụng. Đổi GEMINI_MODEL trong .env.`);
  }
  if (/RESOURCE_EXHAUSTED|exceeded your current quota|quota/i.test(msg + cause)) {
    return new AppError(
      503,
      `${context}: API key hết hạn mức (quota). Thêm GEMINI_API_KEYS dự phòng trong .env.`,
      { original: msg + cause, quota: true },
    );
  }
  if (/503|429|high demand|rate limit/i.test(msg)) {
    return new AppError(
      503,
      `${context}: Gemini đang quá tải / rate limit. Thử lại hoặc dùng API key khác.`,
      { original: msg, rateLimited: true },
    );
  }

  return new AppError(502, `${context}: ${msg || "lỗi không xác định."}`);
}
