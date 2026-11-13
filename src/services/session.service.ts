import type { Types } from "mongoose";
import type { PublicQuestion, Question } from "../@types/question";
import {
  DEFAULT_N_ON_LUYEN,
  DEFAULT_N_PHONG_THI,
  DEFAULT_THOI_GIAN_PHUT,
} from "../config/constants";
import { requireObjectId } from "../helpers/objectId";
import { sampleByIds, sampleUniqueQuestions } from "../helpers/sampleUnique";
import { shuffleQuestionsForSession } from "../helpers/shuffle";
import { AppError } from "../middlewares/error.middleware";
import { SessionModel, type SessionDocument } from "../models/Session.model";
import { getQuizSetForUser } from "./quiz.service";

/** Chuẩn hóa câu hỏi — không spread Mongoose subdoc (spread sẽ mất stem/id). */
function asQuestions(bank: Question[]): Question[] {
  return bank.map((raw) => {
    const maybe = raw as Question & { toObject?: () => Question };
    const q =
      typeof maybe?.toObject === "function" ? maybe.toObject() : maybe;

    return {
      id: String(q.id ?? ""),
      stem: String(q.stem ?? ""),
      choices: [
        String(q.choices?.[0] ?? ""),
        String(q.choices?.[1] ?? ""),
        String(q.choices?.[2] ?? ""),
        String(q.choices?.[3] ?? ""),
      ] as [string, string, string, string],
      correctIndex: Number(q.correctIndex) as 0 | 1 | 2 | 3,
      explanation: String(q.explanation ?? ""),
      topic: String(q.topic ?? ""),
      type: String(q.type ?? "trac_nghiem"),
      sourceDe: q.sourceDe ? String(q.sourceDe) : undefined,
      stemNorm: String(q.stemNorm ?? ""),
      answerCore: q.answerCore ? String(q.answerCore) : undefined,
      answerConfidence: q.answerConfidence,
    };
  });
}

function toPublicQuestion(
  q: Question,
  opts: { reveal: boolean },
): PublicQuestion {
  const base: PublicQuestion = {
    id: q.id,
    stem: q.stem,
    choices: q.choices,
    topic: q.topic,
    type: q.type,
    sourceDe: q.sourceDe,
  };
  if (opts.reveal) {
    base.correctIndex = q.correctIndex;
    base.explanation = q.explanation;
  }
  return base;
}

function isExpired(session: SessionDocument): boolean {
  if (session.kind !== "exam" || !session.expiresAt) return false;
  return new Date() >= new Date(session.expiresAt);
}

async function submitSessionInternal(
  session: SessionDocument,
  status: "submitted" | "expired",
): Promise<SessionDocument> {
  for (const ans of session.answers) {
    const q = session.questionsSnapshot.find((x) => x.id === ans.questionId);
    if (q) ans.isCorrect = ans.selectedIndex === q.correctIndex;
  }

  const score = computeScore(session);
  session.status = status;
  session.submittedAt = new Date();
  session.score = {
    correct: score.correct,
    total: score.total,
    percent: score.percent,
  };
  session.wrongQuestionIds = score.wrongIds;
  await session.save();
  return session;
}

async function autoExpireIfNeeded(
  session: SessionDocument,
): Promise<SessionDocument> {
  if (
    session.status === "in_progress" &&
    session.kind === "exam" &&
    isExpired(session)
  ) {
    return submitSessionInternal(session, "expired");
  }
  return session;
}

function computeScore(session: SessionDocument) {
  let correct = 0;
  const wrongIds: string[] = [];

  for (const q of session.questionsSnapshot) {
    const ans = session.answers.find((a) => a.questionId === q.id);
    if (!ans) {
      // Chưa trả lời: tính vào điểm (sai) nhưng KHÔNG đưa vào ôn câu sai
      continue;
    }
    const ok = ans.selectedIndex === q.correctIndex;
    if (ok) correct += 1;
    else wrongIds.push(q.id);
  }

  const total = session.questionsSnapshot.length;
  return {
    correct,
    total,
    percent: total === 0 ? 0 : Math.round((correct / total) * 100),
    wrongIds,
  };
}

function serializeSession(session: SessionDocument) {
  const reveal =
    session.status === "submitted" || session.status === "expired";
  const answeredIds = new Set(session.answers.map((a) => a.questionId));

  const questions = asQuestions(session.questionsSnapshot).map((q) => {
    const answered = answeredIds.has(q.id);
    const show = reveal || (session.kind === "practice" && answered);
    return toPublicQuestion(q, { reveal: show });
  });

  return {
    id: session._id.toString(),
    quizSetId: session.quizSetId.toString(),
    kind: session.kind,
    config: session.config,
    status: session.status,
    startedAt: session.startedAt,
    submittedAt: session.submittedAt,
    expiresAt: session.expiresAt,
    score: session.score,
    wrongQuestionIds: reveal ? session.wrongQuestionIds : undefined,
    parentSessionId: session.parentSessionId?.toString(),
    questionIds: session.questionIds,
    questions,
    answers:
      reveal || session.kind === "practice"
        ? session.answers
        : session.answers.map((a) => ({
            questionId: a.questionId,
            selectedIndex: a.selectedIndex,
            answeredAt: a.answeredAt,
          })),
  };
}

async function findSessionOrThrow(
  sessionId: string,
  userId: Types.ObjectId,
): Promise<SessionDocument> {
  requireObjectId(sessionId, "sessionId");
  const session = (await SessionModel.findOne({
    _id: sessionId,
    userId,
  })) as unknown as SessionDocument | null;
  if (!session) {
    throw new AppError(404, "Không tìm thấy phiên làm bài.");
  }
  return session;
}

export async function createSession(input: {
  userId: Types.ObjectId;
  quizSetId: string;
  kind: "practice" | "exam";
  nCau?: number;
  thoiGianPhut?: number;
  parentSessionId?: Types.ObjectId;
  forceIds?: string[];
}) {
  const quiz = await getQuizSetForUser(input.quizSetId, input.userId);
  const bank = asQuestions(quiz.questionBank as Question[]);
  if (bank.length === 0) {
    throw new AppError(422, "Ngân hàng câu hỏi trống.");
  }

  const defaults = quiz.defaults ?? {
    nOnLuyen: DEFAULT_N_ON_LUYEN,
    nPhongThi: DEFAULT_N_PHONG_THI,
    thoiGianPhut: DEFAULT_THOI_GIAN_PHUT,
  };

  const requested =
    input.nCau ??
    (input.kind === "practice" ? defaults.nOnLuyen : defaults.nPhongThi);

  // N_*_HIEU_LUC = min(N_*, bank.length) — không cắt vì "concept"
  const nHieuLuc = Math.min(requested, bank.length);

  let picked: Question[];
  if (input.forceIds && input.forceIds.length > 0) {
    picked = sampleByIds(bank, input.forceIds);
  } else {
    picked = sampleUniqueQuestions(bank, nHieuLuc);
  }

  const snapshot = shuffleQuestionsForSession(picked);
  const thoiGianPhut =
    input.kind === "exam"
      ? (input.thoiGianPhut ?? defaults.thoiGianPhut)
      : undefined;

  const startedAt = new Date();
  const expiresAt =
    input.kind === "exam" && thoiGianPhut
      ? new Date(startedAt.getTime() + thoiGianPhut * 60_000)
      : undefined;

  const session = (await SessionModel.create({
    userId: input.userId,
    quizSetId: quiz._id,
    kind: input.kind,
    config: { nCau: snapshot.length, thoiGianPhut },
    questionIds: snapshot.map((q) => q.id),
    questionsSnapshot: snapshot,
    answers: [],
    status: "in_progress",
    startedAt,
    expiresAt,
    parentSessionId: input.parentSessionId,
  })) as unknown as SessionDocument;

  return serializeSession(session);
}

export async function getSessionForUser(
  sessionId: string,
  userId: Types.ObjectId,
) {
  let session = await findSessionOrThrow(sessionId, userId);
  session = await autoExpireIfNeeded(session);
  return serializeSession(session);
}

export async function listSessions(userId: Types.ObjectId) {
  const list = await SessionModel.find({ userId })
    .sort({ createdAt: -1 })
    .select(
      "quizSetId kind config status score startedAt submittedAt expiresAt createdAt",
    );

  return list.map((s) => ({
    id: s._id.toString(),
    quizSetId: s.quizSetId.toString(),
    kind: s.kind,
    config: s.config,
    status: s.status,
    score: s.score,
    startedAt: s.startedAt,
    submittedAt: s.submittedAt,
    expiresAt: s.expiresAt,
    createdAt: s.createdAt,
  }));
}

/** Practice: chấm ngay + explanation. Exam: chỉ ghi đáp án, không lộ đúng/sai. */
export async function answerQuestion(input: {
  sessionId: string;
  userId: Types.ObjectId;
  questionId: string;
  selectedIndex: number;
}) {
  let session = await findSessionOrThrow(input.sessionId, input.userId);
  session = await autoExpireIfNeeded(session);

  if (session.status !== "in_progress") {
    throw new AppError(409, "Phiên đã kết thúc, không thể trả lời thêm.");
  }

  const q = session.questionsSnapshot.find((x) => x.id === input.questionId);
  if (!q) {
    throw new AppError(404, "Câu hỏi không thuộc phiên này.");
  }

  const existingIdx = session.answers.findIndex(
    (a) => a.questionId === input.questionId,
  );

  if (session.kind === "practice" && existingIdx >= 0) {
    throw new AppError(409, "Câu này đã khóa đáp án.");
  }

  const isCorrect =
    session.kind === "practice"
      ? input.selectedIndex === q.correctIndex
      : undefined;

  const payload = {
    questionId: input.questionId,
    selectedIndex: input.selectedIndex,
    isCorrect,
    answeredAt: new Date(),
  };

  if (existingIdx >= 0) {
    session.answers[existingIdx] = payload;
  } else {
    session.answers.push(payload);
  }
  session.markModified("answers");
  await session.save();

  if (session.kind === "practice") {
    return {
      questionId: input.questionId,
      selectedIndex: input.selectedIndex,
      isCorrect: Boolean(isCorrect),
      correctIndex: q.correctIndex,
      explanation: q.explanation,
      topic: q.topic,
    };
  }

  return {
    questionId: input.questionId,
    selectedIndex: input.selectedIndex,
    saved: true,
  };
}

export async function submitSession(
  sessionId: string,
  userId: Types.ObjectId,
) {
  let session = await findSessionOrThrow(sessionId, userId);
  session = await autoExpireIfNeeded(session);

  if (session.status !== "in_progress") {
    return serializeSession(session);
  }

  session = await submitSessionInternal(session, "submitted");
  return serializeSession(session);
}

/** Ôn câu sai theo id — KHÔNG gọi Gemini. */
export async function retryWrong(
  sessionId: string,
  userId: Types.ObjectId,
) {
  let session = await findSessionOrThrow(sessionId, userId);
  session = await autoExpireIfNeeded(session);

  if (session.status === "in_progress") {
    throw new AppError(409, "Hãy nộp bài trước khi ôn câu sai.");
  }

  const wrongIds = session.wrongQuestionIds ?? [];
  if (wrongIds.length === 0) {
    throw new AppError(422, "Không có câu sai để ôn.");
  }

  return createSession({
    userId,
    quizSetId: session.quizSetId.toString(),
    kind: "practice",
    nCau: wrongIds.length,
    parentSessionId: session._id,
    forceIds: wrongIds,
  });
}

/** Làm lại: resample + xáo — KHÔNG tạo câu mới. */
export async function redoSession(
  sessionId: string,
  userId: Types.ObjectId,
) {
  const session = await findSessionOrThrow(sessionId, userId);
  const config = session.config ?? { nCau: 1 };

  return createSession({
    userId,
    quizSetId: session.quizSetId.toString(),
    kind: session.kind,
    nCau: config.nCau,
    thoiGianPhut: config.thoiGianPhut,
    parentSessionId: session._id,
  });
}
