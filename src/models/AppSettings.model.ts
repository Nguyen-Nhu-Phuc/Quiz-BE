import { Schema, model, type HydratedDocument } from "mongoose";

const appSettingsSchema = new Schema(
  {
    /** Singleton key — luôn "default". */
    key: { type: String, required: true, unique: true, default: "default" },
    geminiApiKey: { type: String, default: "" },
    geminiApiKeys: { type: [String], default: [] },
    geminiModel: { type: String, default: "" },
    nOnLuyen: { type: Number, default: undefined },
    nPhongThi: { type: Number, default: undefined },
    thoiGianPhut: { type: Number, default: undefined },
    nNganHang: { type: Number, default: undefined },
  },
  { timestamps: true },
);

export type AppSettingsDocument = HydratedDocument<{
  key: string;
  geminiApiKey: string;
  geminiApiKeys: string[];
  geminiModel: string;
  nOnLuyen?: number;
  nPhongThi?: number;
  thoiGianPhut?: number;
  nNganHang?: number;
  createdAt: Date;
  updatedAt: Date;
}>;

export const AppSettingsModel = model("AppSettings", appSettingsSchema);
