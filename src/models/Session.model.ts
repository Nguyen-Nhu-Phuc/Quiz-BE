import { Schema, model, type HydratedDocument, type Types } from "mongoose";
import type { Question } from "../@types/question";

const sessionQuestionSchema = new Schema(
  {
    id: { type: String, required: true },
    stem: { type: String, required: true },
    choices: { type: [String], required: true },
    correctIndex: { type: Number, required: true, min: 0, max: 3 },
    explanation: { type: String, required: true },
    topic: { type: String, default: "" },
    type: { type: String, default: "trac_nghiem" },
    sourceDe: { type: String },
    stemNorm: { type: String, required: true },
    answerCore: { type: String },
    answerConfidence: { type: String },
  },
  { _id: false },
);

const answerSchema = new Schema(
  {
    questionId: { type: String, required: true },
    selectedIndex: { type: Number, required: true, min: 0, max: 3 },
    isCorrect: { type: Boolean },
    answeredAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const sessionSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    quizSetId: {
      type: Schema.Types.ObjectId,
      ref: "QuizSet",
      required: true,
      index: true,
    },
    kind: { type: String, enum: ["practice", "exam"], required: true },
    config: {
      nCau: { type: Number, required: true },
      thoiGianPhut: { type: Number },
    },
    questionIds: { type: [String], required: true },
    questionsSnapshot: { type: [sessionQuestionSchema], required: true },
    answers: { type: [answerSchema], default: [] },
    status: {
      type: String,
      enum: ["in_progress", "submitted", "expired"],
      default: "in_progress",
    },
    score: {
      correct: Number,
      total: Number,
      percent: Number,
    },
    startedAt: { type: Date, default: Date.now },
    submittedAt: { type: Date },
    expiresAt: { type: Date },
    wrongQuestionIds: { type: [String], default: [] },
    parentSessionId: { type: Schema.Types.ObjectId, ref: "Session" },
  },
  { timestamps: true },
);

export interface SessionAnswer {
  questionId: string;
  selectedIndex: number;
  isCorrect?: boolean | null;
  answeredAt: Date;
}

export type SessionDocument = HydratedDocument<{
  userId: Types.ObjectId;
  quizSetId: Types.ObjectId;
  kind: "practice" | "exam";
  config: { nCau: number; thoiGianPhut?: number };
  questionIds: string[];
  questionsSnapshot: Question[];
  answers: SessionAnswer[];
  status: "in_progress" | "submitted" | "expired";
  score?: { correct: number; total: number; percent: number };
  startedAt: Date;
  submittedAt?: Date;
  expiresAt?: Date;
  wrongQuestionIds: string[];
  parentSessionId?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
  _id: Types.ObjectId;
}>;

export const SessionModel = model("Session", sessionSchema);
