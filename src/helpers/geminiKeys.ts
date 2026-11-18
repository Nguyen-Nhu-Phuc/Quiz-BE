import { createHash } from "node:crypto";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { GoogleAIFileManager } from "@google/generative-ai/server";
import { listRuntimeGeminiKeys } from "../config/runtimeConfig";
import { AppError } from "../middlewares/error.middleware";
import { GeminiKeyStatsModel } from "../models/GeminiKeyStats.model";

/** Key đã hết quota / bị từ chối trong process hiện tại. */
const exhausted = new Set<string>();

/** Cache limit/retry đã parse trong process. */
const runtimeHints = new Map<
  string,
  {
    knownDailyLimit?: number;
    retryAfterSec?: number;
    lastMessage?: string;
    lastQuotaMetric?: string;
  }
>();

export function listGeminiApiKeys(): string[] {
  return listRuntimeGeminiKeys();
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

export function maskGeminiKey(apiKey: string): string {
  if (apiKey.length < 12) return "***";
  return `${apiKey.slice(0, 6)}…${apiKey.slice(-4)}`;
}

export function fingerprintGeminiKey(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex").slice(0, 16);
}

/** Ngày Pacific (Gemini RPD reset nửa đêm PT). */
export function pacificDayKey(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function parseQuotaHint(reason?: string): {
  knownDailyLimit?: number;
  retryAfterSec?: number;
  lastQuotaMetric?: string;
} {
  if (!reason) return {};
  const limitMatch = reason.match(/\blimit:\s*(\d+)/i);
  const metricMatch = reason.match(
    /Quota exceeded for metric:\s*([^\s,]+)/i,
  );
  let retryAfterSec: number | undefined;
  const retryMatch = reason.match(
    /retry in\s+(\d+)h(\d+)m([\d.]+)s/i,
  );
  if (retryMatch) {
    retryAfterSec =
      Number(retryMatch[1]) * 3600 +
      Number(retryMatch[2]) * 60 +
      Math.ceil(Number(retryMatch[3]));
  } else {
    const secMatch = reason.match(/retry in\s+([\d.]+)\s*s/i);
    if (secMatch) retryAfterSec = Math.ceil(Number(secMatch[1]));
  }
  return {
    knownDailyLimit: limitMatch ? Number(limitMatch[1]) : undefined,
    retryAfterSec,
    lastQuotaMetric: metricMatch?.[1],
  };
}

async function upsertDayStats(
  apiKey: string,
  patch: {
    incCalls?: number;
    knownDailyLimit?: number;
    lastQuotaMetric?: string;
    lastMessage?: string;
    exhaustedAt?: Date | null;
    retryAfterSec?: number;
    lastProbeOk?: boolean;
  },
) {
  const keyFingerprint = fingerprintGeminiKey(apiKey);
  const dayPt = pacificDayKey();
  const $inc = patch.incCalls ? { generateCalls: patch.incCalls } : undefined;
  const $set: Record<string, unknown> = {};
  if (patch.knownDailyLimit != null) $set.knownDailyLimit = patch.knownDailyLimit;
  if (patch.lastQuotaMetric) $set.lastQuotaMetric = patch.lastQuotaMetric;
  if (patch.lastMessage) $set.lastMessage = patch.lastMessage.slice(0, 800);
  if (patch.retryAfterSec != null) $set.retryAfterSec = patch.retryAfterSec;
  if (patch.lastProbeOk != null) {
    $set.lastProbeOk = patch.lastProbeOk;
    $set.lastProbeAt = new Date();
  }
  if (patch.exhaustedAt === null) {
    $set.exhaustedAt = null;
    $set.retryAfterSec = null;
  } else if (patch.exhaustedAt) {
    $set.exhaustedAt = patch.exhaustedAt;
  }

  await GeminiKeyStatsModel.findOneAndUpdate(
    { keyFingerprint, dayPt },
    {
      ...(Object.keys($set).length ? { $set } : {}),
      ...($inc ? { $inc } : {}),
      $setOnInsert: { keyFingerprint, dayPt },
    },
    { upsert: true, new: true },
  ).catch((err) => {
    console.warn("[gemini] Không lưu thống kê key:", err);
  });
}

export function markGeminiKeyExhausted(apiKey: string, reason?: string) {
  if (!apiKey) return;
  const hint = parseQuotaHint(reason);
  runtimeHints.set(apiKey, {
    ...runtimeHints.get(apiKey),
    ...hint,
    lastMessage: reason?.slice(0, 800),
  });
  if (!exhausted.has(apiKey)) {
    exhausted.add(apiKey);
    console.warn(
      `[gemini] Đánh dấu key hết hạn mức: ${maskGeminiKey(apiKey)}` +
        (reason ? ` · ${reason}` : ""),
    );
  }
  void upsertDayStats(apiKey, {
    knownDailyLimit: hint.knownDailyLimit,
    lastQuotaMetric: hint.lastQuotaMetric,
    lastMessage: reason,
    exhaustedAt: new Date(),
    retryAfterSec: hint.retryAfterSec,
  });
}

/** Ghi nhận 1 lần gọi generate (ước lượng RPD). */
export function recordGeminiKeyUse(apiKey: string) {
  if (!apiKey) return;
  void upsertDayStats(apiKey, { incCalls: 1 });
}

export function clearGeminiKeyExhausted(apiKey?: string) {
  if (apiKey) {
    exhausted.delete(apiKey);
    void upsertDayStats(apiKey, { exhaustedAt: null });
    return;
  }
  exhausted.clear();
}

function errText(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  const cause =
    err instanceof Error && err.cause instanceof Error
      ? err.cause.message
      : "";
  return `${msg} ${cause}`;
}

/** Hết hạn mức theo ngày của 1 model (Free Tier RPD) — nên thử model khác trước khi bỏ key. */
export function isPerModelDailyQuotaError(err: unknown): boolean {
  const text = errText(err);
  return /GenerateRequestsPerDay|generate_content_free_tier_requests|free_tier_requests|RequestsPerDayPerProjectPerModel/i.test(
    text,
  );
}

/** RPM / quá tải tạm — không nên đánh dấu key chết cả ngày. */
export function isTransientRateLimitError(err: unknown): boolean {
  const text = errText(err);
  if (isPerModelDailyQuotaError(err)) return false;
  return /RequestsPerMinute|rate limit|high demand|429/i.test(text);
}

/**
 * Lỗi khiến nên đổi API key (key invalid / hết quota mọi hướng / billing).
 * Không gồm RPM tạm thời.
 */
export function isGeminiKeyExhaustedError(err: unknown): boolean {
  const text = errText(err);
  if (/API_KEY_INVALID|API key not valid|PERMISSION_DENIED/i.test(text)) {
    return true;
  }
  if (isPerModelDailyQuotaError(err)) return true;
  if (
    /RESOURCE_EXHAUSTED|exceeded your current quota/i.test(text) &&
    !isTransientRateLimitError(err)
  ) {
    return true;
  }
  return /billing|limit:\s*0\b/i.test(text);
}

export function createGeminiClients(apiKey: string) {
  return {
    apiKey,
    genAI: new GoogleGenerativeAI(apiKey),
    fileManager: new GoogleAIFileManager(apiKey),
  };
}

export type GeminiKeyQuotaStatus = {
  index: number;
  masked: string;
  fingerprint: string;
  status: "ok" | "exhausted" | "invalid" | "unknown";
  generateCallsToday: number;
  knownDailyLimit: number | null;
  remainingToday: number | null;
  exhaustedInProcess: boolean;
  retryAfterSec: number | null;
  lastQuotaMetric: string | null;
  lastMessage: string | null;
  lastProbeOk: boolean | null;
  lastProbeAt: string | null;
  dayPt: string;
  note: string;
};

async function probeKeyAlive(apiKey: string): Promise<{
  ok: boolean;
  message?: string;
}> {
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}&pageSize=1`,
      { method: "GET" },
    );
    if (res.ok) {
      void upsertDayStats(apiKey, { lastProbeOk: true });
      return { ok: true };
    }
    const body = await res.text();
    if (isGeminiKeyExhaustedError(body)) {
      markGeminiKeyExhausted(apiKey, body);
      return { ok: false, message: body.slice(0, 400) };
    }
    void upsertDayStats(apiKey, {
      lastProbeOk: false,
      lastMessage: body.slice(0, 400),
    });
    return { ok: false, message: body.slice(0, 400) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, message: msg };
  }
}

/** Trạng thái quota từng key — dùng cho admin. */
export async function getGeminiKeysQuotaStatus(options?: {
  probe?: boolean;
}): Promise<{
  dayPt: string;
  keys: GeminiKeyQuotaStatus[];
  summary: {
    total: number;
    available: number;
    exhausted: number;
  };
}> {
  const keys = listGeminiApiKeys();
  const dayPt = pacificDayKey();
  const fps = keys.map(fingerprintGeminiKey);
  const docs = await GeminiKeyStatsModel.find({
    keyFingerprint: { $in: fps },
    dayPt,
  }).lean();
  const byFp = new Map(docs.map((d) => [d.keyFingerprint, d]));

  const rows: GeminiKeyQuotaStatus[] = [];
  for (let i = 0; i < keys.length; i += 1) {
    const apiKey = keys[i];
    const fp = fps[i];
    const doc = byFp.get(fp);
    const hint = runtimeHints.get(apiKey);
    const inExhausted = exhausted.has(apiKey);

    let lastProbeOk = doc?.lastProbeOk ?? null;
    let lastMessage =
      hint?.lastMessage || doc?.lastMessage || null;

    if (options?.probe) {
      const probe = await probeKeyAlive(apiKey);
      lastProbeOk = probe.ok;
      if (probe.message) lastMessage = probe.message;
    }

    const knownDailyLimit =
      hint?.knownDailyLimit ?? doc?.knownDailyLimit ?? null;
    const generateCallsToday = doc?.generateCalls ?? 0;
    const remainingToday =
      knownDailyLimit != null
        ? Math.max(0, knownDailyLimit - generateCallsToday)
        : null;

    let status: GeminiKeyQuotaStatus["status"] = "unknown";
    if (inExhausted || (remainingToday === 0 && knownDailyLimit != null)) {
      status = "exhausted";
    } else if (lastProbeOk === false && /API_KEY_INVALID|not valid/i.test(lastMessage || "")) {
      status = "invalid";
    } else if (lastProbeOk === true || generateCallsToday > 0) {
      status = "ok";
    } else if (!inExhausted) {
      status = "ok";
    }

    let note =
      "Gemini không API số dư — đếm request trong app + limit từ lỗi 429.";
    if (knownDailyLimit != null && remainingToday != null) {
      note = `Ước lượng còn ~${remainingToday}/${knownDailyLimit} request/ngày (theo limit đã thấy từ Google).`;
    } else if (generateCallsToday > 0) {
      note = `Đã ghi ${generateCallsToday} lần gọi hôm nay (PT). Chưa biết limit — xem AI Studio hoặc đợi lỗi 429.`;
    }

    rows.push({
      index: i + 1,
      masked: maskGeminiKey(apiKey),
      fingerprint: fp,
      status,
      generateCallsToday,
      knownDailyLimit,
      remainingToday,
      exhaustedInProcess: inExhausted,
      retryAfterSec: hint?.retryAfterSec ?? doc?.retryAfterSec ?? null,
      lastQuotaMetric: hint?.lastQuotaMetric ?? doc?.lastQuotaMetric ?? null,
      lastMessage,
      lastProbeOk,
      lastProbeAt: doc?.lastProbeAt
        ? new Date(doc.lastProbeAt).toISOString()
        : null,
      dayPt,
      note,
    });
  }

  const exhaustedCount = rows.filter((r) => r.status === "exhausted").length;
  return {
    dayPt,
    keys: rows,
    summary: {
      total: rows.length,
      available: rows.length - exhaustedCount,
      exhausted: exhaustedCount,
    },
  };
}
