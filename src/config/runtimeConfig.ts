import {
  DEFAULT_GENERATION_TIME_BUDGET_SEC,
  DEFAULT_N_ON_LUYEN,
  DEFAULT_N_PHONG_THI,
  DEFAULT_THOI_GIAN_PHUT,
  N_NGAN_HANG_MIN,
} from "./constants";
import { env } from "./env";

export type RuntimeConfig = {
  geminiApiKey: string;
  geminiApiKeys: string[];
  geminiModel: string;
  nOnLuyen: number;
  nPhongThi: number;
  thoiGianPhut: number;
  nNganHang: number;
  /** Giới hạn giây khi Gemini tạo ngân hàng câu hỏi. */
  generationTimeBudgetSec: number;
};

/** Override từ Mongo AppSettings — null field = dùng env/constants. */
let override: Partial<RuntimeConfig> | null = null;

function envGeminiKeys(): string[] {
  const collected: string[] = [];
  if (env.geminiApiKey?.trim()) collected.push(env.geminiApiKey.trim());
  for (const k of env.geminiApiKeys) {
    if (k.trim()) collected.push(k.trim());
  }
  for (const [name, value] of Object.entries(process.env)) {
    if (!/^GEMINI_API_KEY_\d+$/i.test(name)) continue;
    if (value?.trim()) collected.push(value.trim());
  }
  return [...new Set(collected)];
}

export function setRuntimeOverride(partial: Partial<RuntimeConfig> | null) {
  override = partial;
}

export function getRuntimeConfig(): RuntimeConfig {
  const envKeys = envGeminiKeys();
  const o = override ?? {};

  const geminiApiKey =
    (o.geminiApiKey?.trim() ? o.geminiApiKey.trim() : "") ||
    env.geminiApiKey.trim() ||
    envKeys[0] ||
    "";

  const fromDbKeys = (o.geminiApiKeys ?? [])
    .map((k) => k.trim())
    .filter(Boolean);
  const geminiApiKeys =
    fromDbKeys.length > 0
      ? fromDbKeys
      : envKeys.filter((k) => k !== geminiApiKey);

  return {
    geminiApiKey,
    geminiApiKeys,
    geminiModel:
      (o.geminiModel?.trim() ? o.geminiModel.trim() : "") ||
      env.geminiModel.trim() ||
      "gemini-3.5-flash",
    nOnLuyen: o.nOnLuyen ?? DEFAULT_N_ON_LUYEN,
    nPhongThi: o.nPhongThi ?? DEFAULT_N_PHONG_THI,
    thoiGianPhut: o.thoiGianPhut ?? DEFAULT_THOI_GIAN_PHUT,
    nNganHang: o.nNganHang ?? N_NGAN_HANG_MIN,
    generationTimeBudgetSec:
      o.generationTimeBudgetSec ??
      env.generationTimeBudgetSec ??
      DEFAULT_GENERATION_TIME_BUDGET_SEC,
  };
}

/** Tất cả Gemini keys khả dụng (primary + phụ), unique. */
export function listRuntimeGeminiKeys(): string[] {
  const cfg = getRuntimeConfig();
  const all = [cfg.geminiApiKey, ...cfg.geminiApiKeys]
    .map((k) => k.trim())
    .filter(Boolean);
  return [...new Set(all)];
}
