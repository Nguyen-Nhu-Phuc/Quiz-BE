import { GoogleGenerativeAI } from "@google/generative-ai";
import { GoogleAIFileManager } from "@google/generative-ai/server";
import { env } from "../config/env";
import { AppError } from "../middlewares/error.middleware";

/** Key đã hết quota / bị từ chối trong process hiện tại. */
const exhausted = new Set<string>();

/** Gom GEMINI_API_KEY + GEMINI_API_KEYS + GEMINI_API_KEY_2… */
export function listGeminiApiKeys(): string[] {
  const collected: string[] = [];

  if (env.geminiApiKey?.trim()) {
    collected.push(env.geminiApiKey.trim());
  }

  for (const extra of env.geminiApiKeys) {
    collected.push(extra);
  }

  // GEMINI_API_KEY_2, GEMINI_API_KEY_3, …
  for (const [name, value] of Object.entries(process.env)) {
    if (!/^GEMINI_API_KEY_\d+$/i.test(name)) continue;
    if (value?.trim()) collected.push(value.trim());
  }

  return [...new Set(collected)];
}

export function requireGeminiApiKeys(): string[] {
  const keys = listGeminiApiKeys().filter((k) => !exhausted.has(k));
  if (keys.length === 0) {
    const all = listGeminiApiKeys();
    if (all.length === 0) {
      throw new AppError(
        503,
        "Chưa cấu hình GEMINI_API_KEY / GEMINI_API_KEYS. Không thể gọi Gemini.",
      );
    }
    throw new AppError(
      503,
      `Tất cả ${all.length} Gemini API key đã hết hạn mức (quota). Thêm key mới vào .env rồi thử lại.`,
    );
  }
  return keys;
}

export function markGeminiKeyExhausted(apiKey: string, reason?: string) {
  if (!apiKey || exhausted.has(apiKey)) return;
  exhausted.add(apiKey);
  const short = `${apiKey.slice(0, 6)}…${apiKey.slice(-4)}`;
  console.warn(
    `[gemini] Đánh dấu key hết hạn mức: ${short}` +
      (reason ? ` · ${reason}` : ""),
  );
}

export function isGeminiKeyExhaustedError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const cause =
    err instanceof Error && err.cause instanceof Error
      ? err.cause.message
      : "";
  const text = `${msg} ${cause}`;
  return /RESOURCE_EXHAUSTED|exceeded your current quota|quota|rate limit|429|API_KEY_INVALID|API key not valid|PERMISSION_DENIED|billing|limit: 0|GenerateRequestsPerDay|RequestsPerMinute/i.test(
    text,
  );
}

export function createGeminiClients(apiKey: string) {
  return {
    apiKey,
    genAI: new GoogleGenerativeAI(apiKey),
    fileManager: new GoogleAIFileManager(apiKey),
  };
}

export function maskGeminiKey(apiKey: string): string {
  if (apiKey.length < 12) return "***";
  return `${apiKey.slice(0, 6)}…${apiKey.slice(-4)}`;
}
