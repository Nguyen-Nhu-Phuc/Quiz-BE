import { Schema, model, type HydratedDocument, type Types } from "mongoose";
import type { DocumentMode, Question } from "../@types/question";
import {
  DEFAULT_N_ON_LUYEN,
  DEFAULT_N_PHONG_THI,
  DEFAULT_THOI_GIAN_PHUT,
  N_NGAN_HANG_MIN,
} from "../config/constants";

const questionSchema = new Schema(
  {
    id: { type: String, required: true },
    stem: { type: String, required: true },
    choices: {
      type: [String],
      required: true,
      validate: {
        validator: (v: string[]) => v.length === 4,
        message: "Phải có đúng 4 đáp án",
      },
    },
    correctIndex: { type: Number, required: true, min: 0, max: 3 },
    explanation: { type: String, required: true },
    topic: { type: String, default: "" },
    type: { type: String, default: "trac_nghiem" },
    sourceDe: { type: String },
    stemNorm: { type: String, required: true },
    answerCore: { type: String },
    answerConfidence: {
      type: String,
      enum: ["cao", "trung_binh"],
    },
  },
  { _id: false },
);

const quizSetSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    documentId: {
      type: Schema.Types.ObjectId,
      ref: "Document",
      required: true,
      index: true,
    },
    /** Tất cả tài liệu nguồn (khi upload nhiều file). documentId = phần tử đầu. */
    documentIds: {
      type: [{ type: Schema.Types.ObjectId, ref: "Document" }],
      default: undefined,
    },
    title: { type: String, required: true },
    mode: { type: String, enum: ["EXTRACT", "GENERATE"], required: true },
    modeReason: { type: String, required: true },
    questionBank: { type: [questionSchema], default: [] },
    meta: {
      soCauPhatHien: Number,
      soCauSauLocTrungStem: Number,
      soCauBoDoTrung: Number,
      viDuStemBiLoaiTrung: [String],
      soYDocLap: Number,
      lyDoBankNganHonTarget: String,
      nNganHangMin: { type: Number, default: N_NGAN_HANG_MIN },
      needsReview: { type: Boolean, default: false },
    },
    defaults: {
      nOnLuyen: { type: Number, default: DEFAULT_N_ON_LUYEN },
      nPhongThi: { type: Number, default: DEFAULT_N_PHONG_THI },
      thoiGianPhut: { type: Number, default: DEFAULT_THOI_GIAN_PHUT },
    },
    status: {
      type: String,
      enum: ["ready", "failed"],
      default: "ready",
    },
  },
  { timestamps: true },
);

export type QuizSetDocument = HydratedDocument<{
  userId: Types.ObjectId;
  documentId: Types.ObjectId;
  documentIds?: Types.ObjectId[];
  title: string;
  mode: DocumentMode;
  modeReason: string;
  questionBank: Question[];
  meta: {
    soCauPhatHien?: number;
    soCauSauLocTrungStem?: number;
    soCauBoDoTrung?: number;
    viDuStemBiLoaiTrung?: string[];
    soYDocLap?: number;
    lyDoBankNganHonTarget?: string;
    nNganHangMin: number;
    needsReview?: boolean;
  };
  defaults: {
    nOnLuyen: number;
    nPhongThi: number;
    thoiGianPhut: number;
  };
  status: "ready" | "failed";
  createdAt: Date;
  updatedAt: Date;
  _id: Types.ObjectId;
}>;

export const QuizSetModel = model("QuizSet", quizSetSchema);
