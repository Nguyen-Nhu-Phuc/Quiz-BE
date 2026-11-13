import type { Types } from "mongoose";
import type { ClinicalCaseInput, Question } from "../@types/question";
import {
  DEFAULT_N_ON_LUYEN,
  DEFAULT_N_PHONG_THI,
  DEFAULT_THOI_GIAN_PHUT,
  N_NGAN_HANG_MIN,
} from "../config/constants";
import { requireObjectId } from "../helpers/objectId";
import { AppError } from "../middlewares/error.middleware";
import { QuizSetModel, type QuizSetDocument } from "../models/QuizSet.model";
import { SessionModel } from "../models/Session.model";
import {
  markDocumentsFailed,
  markDocumentsReady,
  prepareDocumentsForGemini,
} from "./document.service";
import { generateQuestionBankFromFiles } from "./gemini.service";

export async function generateQuizSet(input: {
  userId: Types.ObjectId;
  documentId?: string;
  documentIds?: string[];
  title?: string;
  nOnLuyen?: number;
  nPhongThi?: number;
  thoiGianPhut?: number;
  /** Mục tiêu số câu unique trong bank. */
  nNganHang?: number;
  clinicalCases?: ClinicalCaseInput[];
}) {
  const ids =
    input.documentIds && input.documentIds.length > 0
      ? input.documentIds
      : input.documentId
        ? [input.documentId]
        : [];

  if (ids.length === 0) {
    throw new AppError(400, "Cần documentId hoặc documentIds.");
  }

  const nOnLuyen = input.nOnLuyen ?? DEFAULT_N_ON_LUYEN;
  const nPhongThi = input.nPhongThi ?? DEFAULT_N_PHONG_THI;
  const targetCount =
    input.nNganHang ??
    Math.max(nOnLuyen, nPhongThi, N_NGAN_HANG_MIN);

  // 1) Lấy file → 2) Gemini tạo đúng ~targetCount câu unique → 3) lưu → FE
  const docs = await prepareDocumentsForGemini(ids, input.userId);
  const primary = docs[0];

  let result;
  try {
    result = await generateQuestionBankFromFiles(
      docs.map((d) => ({
        storagePath: d.storagePath,
        mimeType: d.mimeType,
        originalName: d.originalName,
      })),
      {
        clinicalCases: input.clinicalCases,
        targetCount,
      },
    );
  } catch (err) {
    const msg =
      err instanceof Error ? err.message : "Gemini tạo quiz thất bại";
    await markDocumentsFailed(docs, msg);
    throw err;
  }

  if (result.questionBank.length === 0) {
    await markDocumentsFailed(docs, "Không tạo được câu hỏi nào từ tài liệu.");
    throw new AppError(
      422,
      "Không tạo được câu hỏi nào từ tài liệu. Kiểm tra nội dung file hoặc thử lại.",
    );
  }

  const preview = result.questionBank
    .slice(0, 5)
    .map((q, i) => `${i + 1}. ${q.stem}`)
    .join("\n");
  await markDocumentsReady(docs, preview);

  const title =
    input.title?.trim() ||
    (docs.length === 1
      ? primary.originalName.replace(/\.[^.]+$/, "")
      : `Bộ câu hỏi (${docs.length} tài liệu)`) ||
    "Bộ câu hỏi";

  const quiz = (await QuizSetModel.create({
    userId: input.userId,
    documentId: primary._id,
    documentIds: docs.map((d) => d._id),
    title,
    mode: result.mode,
    modeReason: result.modeReason,
    questionBank: result.questionBank,
    meta: {
      ...result.meta,
      nNganHangMin: N_NGAN_HANG_MIN,
    },
    defaults: {
      nOnLuyen,
      nPhongThi,
      thoiGianPhut: input.thoiGianPhut ?? DEFAULT_THOI_GIAN_PHUT,
    },
    status: "ready",
  })) as unknown as QuizSetDocument;

  return summarizeQuizSet(quiz);
}

export function effectiveCounts(quiz: QuizSetDocument) {
  const bankLen = quiz.questionBank.length;
  const defaults = quiz.defaults ?? {
    nOnLuyen: DEFAULT_N_ON_LUYEN,
    nPhongThi: DEFAULT_N_PHONG_THI,
    thoiGianPhut: DEFAULT_THOI_GIAN_PHUT,
  };
  return {
    bankSize: bankLen,
    nOnLuyenHieuLuc: Math.min(defaults.nOnLuyen, bankLen),
    nPhongThiHieuLuc: Math.min(defaults.nPhongThi, bankLen),
    thoiGianPhut: defaults.thoiGianPhut,
  };
}

export function summarizeQuizSet(quiz: QuizSetDocument) {
  const eff = effectiveCounts(quiz);
  const documentIds =
    quiz.documentIds?.map((id) => id.toString()) ??
    (quiz.documentId ? [quiz.documentId.toString()] : []);
  return {
    id: quiz._id.toString(),
    documentId: quiz.documentId.toString(),
    documentIds,
    title: quiz.title,
    mode: quiz.mode,
    modeReason: quiz.modeReason,
    status: quiz.status,
    meta: quiz.meta,
    defaults: quiz.defaults,
    ...eff,
    createdAt: quiz.createdAt,
  };
}

export async function listQuizSets(userId: Types.ObjectId) {
  // Không load full questionBank — chỉ lấy $size cho bankSize (hiệu năng)
  const list = await QuizSetModel.aggregate([
    { $match: { userId } },
    { $sort: { createdAt: -1 } },
    {
      $project: {
        title: 1,
        mode: 1,
        modeReason: 1,
        status: 1,
        meta: 1,
        defaults: 1,
        documentId: 1,
        documentIds: 1,
        createdAt: 1,
        bankSize: { $size: { $ifNull: ["$questionBank", []] } },
      },
    },
  ]);

  return list.map((q) => {
    const defaults = q.defaults ?? {
      nOnLuyen: DEFAULT_N_ON_LUYEN,
      nPhongThi: DEFAULT_N_PHONG_THI,
      thoiGianPhut: DEFAULT_THOI_GIAN_PHUT,
    };
    const bankLen = q.bankSize as number;
    const documentIds = Array.isArray(q.documentIds)
      ? (q.documentIds as unknown[]).map(String)
      : q.documentId
        ? [String(q.documentId)]
        : [];
    return {
      id: String(q._id),
      documentId: String(q.documentId),
      documentIds,
      title: q.title as string,
      mode: q.mode as string,
      modeReason: q.modeReason as string,
      status: q.status as string,
      meta: q.meta,
      defaults,
      bankSize: bankLen,
      nOnLuyenHieuLuc: Math.min(defaults.nOnLuyen, bankLen),
      nPhongThiHieuLuc: Math.min(defaults.nPhongThi, bankLen),
      thoiGianPhut: defaults.thoiGianPhut as number,
      createdAt: q.createdAt as Date,
    };
  });
}

export async function getQuizSetForUser(
  quizSetId: string,
  userId: Types.ObjectId,
): Promise<QuizSetDocument> {
  requireObjectId(quizSetId, "quizSetId");
  const quiz = (await QuizSetModel.findOne({
    _id: quizSetId,
    userId,
  })) as unknown as QuizSetDocument | null;
  if (!quiz) {
    throw new AppError(404, "Không tìm thấy bộ câu hỏi.");
  }
  return quiz;
}

export async function getQuizSummary(
  quizSetId: string,
  userId: Types.ObjectId,
) {
  const quiz = await getQuizSetForUser(quizSetId, userId);
  return summarizeQuizSet(quiz);
}

/**
 * Bank cho owner nhưng KHÔNG lộ correctIndex / explanation
 * (tránh xem đáp án trước phòng thi). Đáp án chỉ qua session.
 */
export async function getQuizBank(
  quizSetId: string,
  userId: Types.ObjectId,
) {
  const quiz = await getQuizSetForUser(quizSetId, userId);
  const publicBank = (quiz.questionBank as Question[]).map((q) => ({
    id: q.id,
    stem: q.stem,
    choices: q.choices,
    topic: q.topic,
    type: q.type,
    sourceDe: q.sourceDe,
  }));
  return {
    ...summarizeQuizSet(quiz),
    questionBank: publicBank,
  };
}

/** Xóa bộ câu hỏi + cascade mọi session liên quan. */
export async function deleteQuizSet(
  quizSetId: string,
  userId: Types.ObjectId,
) {
  const quiz = await getQuizSetForUser(quizSetId, userId);
  const sessionResult = await SessionModel.deleteMany({
    userId,
    quizSetId: quiz._id,
  });
  await quiz.deleteOne();
  return {
    deleted: true,
    deletedSessions: sessionResult.deletedCount ?? 0,
  };
}
