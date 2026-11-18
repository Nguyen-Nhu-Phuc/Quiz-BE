import mongoose from "mongoose";
import {
  getRuntimeConfig,
  listRuntimeGeminiKeys,
  setRuntimeOverride,
  type RuntimeConfig,
} from "../config/runtimeConfig";
import { env } from "../config/env";
import {
  getGeminiKeysQuotaStatus,
  maskGeminiKey,
} from "../helpers/geminiKeys";
import { AppError } from "../middlewares/error.middleware";
import { AppSettingsModel } from "../models/AppSettings.model";
import * as authService from "./auth.service";

/** Đăng nhập admin bằng email/password — chỉ user role=admin. */
export async function loginAdminWithPassword(input: {
  email: string;
  password: string;
}) {
  const data = await authService.loginUser(input);
  if (data.user.role !== "admin") {
    throw new AppError(403, "Tài khoản này không có quyền admin.");
  }
  return data;
}

/** Đăng nhập admin bằng Google — chỉ email trong ADMIN_EMAILS. */
export async function loginAdminWithGoogle(input: {
  credential?: string;
  accessToken?: string;
}) {
  const data = await authService.loginWithGoogle(input);
  if (data.user.role !== "admin") {
    throw new AppError(403, "Tài khoản Google này không có quyền admin.");
  }
  return data;
}

export async function loadRuntimeFromDb(): Promise<void> {
  const doc = await AppSettingsModel.findOne({ key: "default" }).lean();
  if (!doc) {
    setRuntimeOverride(null);
    return;
  }
  setRuntimeOverride({
    geminiApiKey: doc.geminiApiKey || undefined,
    geminiApiKeys: doc.geminiApiKeys?.length ? doc.geminiApiKeys : undefined,
    geminiModel: doc.geminiModel || undefined,
    nOnLuyen: typeof doc.nOnLuyen === "number" ? doc.nOnLuyen : undefined,
    nPhongThi: typeof doc.nPhongThi === "number" ? doc.nPhongThi : undefined,
    thoiGianPhut:
      typeof doc.thoiGianPhut === "number" ? doc.thoiGianPhut : undefined,
    nNganHang: typeof doc.nNganHang === "number" ? doc.nNganHang : undefined,
  });
}

function maskOrEmpty(key: string): string {
  const t = key.trim();
  if (!t) return "";
  return maskGeminiKey(t);
}

export async function getAdminSettings() {
  await loadRuntimeFromDb();
  const cfg = getRuntimeConfig();
  const doc = await AppSettingsModel.findOne({ key: "default" }).lean();
  const geminiQuota = await getGeminiKeysQuotaStatus({ probe: false });

  return {
    geminiApiKeyMasked: maskOrEmpty(cfg.geminiApiKey),
    geminiApiKeysMasked: cfg.geminiApiKeys.map(maskOrEmpty).filter(Boolean),
    geminiApiKeySet: Boolean(cfg.geminiApiKey),
    geminiApiKeysCount: listRuntimeGeminiKeys().length,
    geminiModel: cfg.geminiModel,
    geminiQuota,
    nOnLuyen: cfg.nOnLuyen,
    nPhongThi: cfg.nPhongThi,
    thoiGianPhut: cfg.thoiGianPhut,
    nNganHang: cfg.nNganHang,
    updatedAt: doc?.updatedAt ?? null,
    health: {
      mongo: mongoose.connection.readyState === 1 ? "ok" : "down",
      geminiKeysAvailable: geminiQuota.summary.available,
      geminiKeysExhausted: geminiQuota.summary.exhausted,
      adminConfigured: env.adminEmails.length > 0,
      adminEmailsCount: env.adminEmails.length,
    },
  };
}

export type UpdateAdminSettingsInput = {
  geminiApiKey?: string;
  /** Chuỗi keys cách nhau bởi dấu phẩy / xuống dòng; "" = xóa keys DB phụ. */
  geminiApiKeys?: string;
  geminiModel?: string;
  nOnLuyen?: number;
  nPhongThi?: number;
  thoiGianPhut?: number;
  nNganHang?: number;
};

function parseKeysInput(raw: string | undefined): string[] | undefined {
  if (raw === undefined) return undefined;
  return raw
    .split(/[\s,;|]+/)
    .map((k) => k.trim())
    .filter(Boolean);
}

export async function updateAdminSettings(input: UpdateAdminSettingsInput) {
  let doc = await AppSettingsModel.findOne({ key: "default" });
  if (!doc) {
    doc = new AppSettingsModel({ key: "default" });
  }

  // Key trống / chỉ khoảng trắng = giữ nguyên; có giá trị mới = thay
  if (typeof input.geminiApiKey === "string" && input.geminiApiKey.trim()) {
    doc.geminiApiKey = input.geminiApiKey.trim();
  }

  if (input.geminiApiKeys !== undefined) {
    const parsed = parseKeysInput(input.geminiApiKeys);
    doc.geminiApiKeys = parsed ?? [];
  }

  if (typeof input.geminiModel === "string" && input.geminiModel.trim()) {
    doc.geminiModel = input.geminiModel.trim();
  }

  if (typeof input.nOnLuyen === "number") doc.nOnLuyen = input.nOnLuyen;
  if (typeof input.nPhongThi === "number") doc.nPhongThi = input.nPhongThi;
  if (typeof input.thoiGianPhut === "number") {
    doc.thoiGianPhut = input.thoiGianPhut;
  }
  if (typeof input.nNganHang === "number") doc.nNganHang = input.nNganHang;

  await doc.save();
  await loadRuntimeFromDb();
  return getAdminSettings();
}

export type { RuntimeConfig };
