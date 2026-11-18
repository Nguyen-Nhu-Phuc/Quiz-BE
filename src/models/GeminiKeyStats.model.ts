import { Schema, model, type HydratedDocument } from "mongoose";

/** Thống kê quota theo API key (fingerprint) · ngày theo Pacific (RPD Gemini). */
const geminiKeyStatsSchema = new Schema(
  {
    keyFingerprint: { type: String, required: true, index: true },
    /** YYYY-MM-DD theo America/Los_Angeles */
    dayPt: { type: String, required: true, index: true },
    generateCalls: { type: Number, default: 0 },
    knownDailyLimit: { type: Number },
    lastQuotaMetric: { type: String },
    lastMessage: { type: String },
    exhaustedAt: { type: Date },
    retryAfterSec: { type: Number },
    lastProbeOk: { type: Boolean },
    lastProbeAt: { type: Date },
  },
  { timestamps: true },
);

geminiKeyStatsSchema.index({ keyFingerprint: 1, dayPt: 1 }, { unique: true });

export type GeminiKeyStatsDocument = HydratedDocument<{
  keyFingerprint: string;
  dayPt: string;
  generateCalls: number;
  knownDailyLimit?: number;
  lastQuotaMetric?: string;
  lastMessage?: string;
  exhaustedAt?: Date;
  retryAfterSec?: number;
  lastProbeOk?: boolean;
  lastProbeAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}>;

export const GeminiKeyStatsModel = model("GeminiKeyStats", geminiKeyStatsSchema);
