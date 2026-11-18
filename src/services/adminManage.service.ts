import fs from "node:fs/promises";
import { Types } from "mongoose";
import { isAdminEmail } from "../helpers/adminEmails";
import { requireObjectId } from "../helpers/objectId";
import { AppError } from "../middlewares/error.middleware";
import { DocumentModel } from "../models/Document.model";
import { QuizSetModel } from "../models/QuizSet.model";
import { SessionModel } from "../models/Session.model";
import { UserModel } from "../models/User.model";

function parsePaging(query: { page?: unknown; limit?: unknown; q?: unknown }) {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
  const q = typeof query.q === "string" ? query.q.trim() : "";
  return { page, limit, skip: (page - 1) * limit, q };
}

export async function getOverview() {
  const [
    users,
    admins,
    documents,
    documentsFailed,
    quizSets,
    quizFailed,
    sessions,
    sessionsActive,
  ] = await Promise.all([
    UserModel.countDocuments(),
    UserModel.countDocuments({ role: "admin" }),
    DocumentModel.countDocuments(),
    DocumentModel.countDocuments({ status: "failed" }),
    QuizSetModel.countDocuments(),
    QuizSetModel.countDocuments({ status: "failed" }),
    SessionModel.countDocuments(),
    SessionModel.countDocuments({ status: "in_progress" }),
  ]);

  const recentUsers = await UserModel.find()
    .sort({ createdAt: -1 })
    .limit(5)
    .select("email name role authProvider createdAt");

  const recentSessions = await SessionModel.find()
    .sort({ createdAt: -1 })
    .limit(5)
    .select("kind status score startedAt userId quizSetId")
    .populate("userId", "email name");

  return {
    counts: {
      users,
      admins,
      documents,
      documentsFailed,
      quizSets,
      quizFailed,
      sessions,
      sessionsActive,
    },
    recentUsers: recentUsers.map((u) => ({
      id: u._id.toString(),
      email: u.email,
      name: u.name,
      role: u.role,
      authProvider: u.authProvider,
      createdAt: u.createdAt,
    })),
    recentSessions: recentSessions.map((s) => {
      const user = s.userId as unknown as {
        _id?: Types.ObjectId;
        email?: string;
        name?: string;
      } | null;
      return {
        id: s._id.toString(),
        kind: s.kind,
        status: s.status,
        score: s.score,
        startedAt: s.startedAt,
        user: user?._id
          ? {
              id: user._id.toString(),
              email: user.email,
              name: user.name,
            }
          : null,
      };
    }),
  };
}

export async function listUsers(query: {
  page?: unknown;
  limit?: unknown;
  q?: unknown;
}) {
  const { page, limit, skip, q } = parsePaging(query);
  const filter = q
    ? {
        $or: [
          { email: { $regex: q, $options: "i" } },
          { name: { $regex: q, $options: "i" } },
        ],
      }
    : {};

  const [total, rows] = await Promise.all([
    UserModel.countDocuments(filter),
    UserModel.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .select("email name role authProvider googleId createdAt updatedAt"),
  ]);

  const userIds = rows.map((u) => u._id);
  const [docCounts, quizCounts, sessionCounts] = await Promise.all([
    DocumentModel.aggregate<{ _id: Types.ObjectId; n: number }>([
      { $match: { userId: { $in: userIds } } },
      { $group: { _id: "$userId", n: { $sum: 1 } } },
    ]),
    QuizSetModel.aggregate<{ _id: Types.ObjectId; n: number }>([
      { $match: { userId: { $in: userIds } } },
      { $group: { _id: "$userId", n: { $sum: 1 } } },
    ]),
    SessionModel.aggregate<{ _id: Types.ObjectId; n: number }>([
      { $match: { userId: { $in: userIds } } },
      { $group: { _id: "$userId", n: { $sum: 1 } } },
    ]),
  ]);

  const toMap = (arr: { _id: Types.ObjectId; n: number }[]) =>
    new Map(arr.map((x) => [x._id.toString(), x.n]));

  const docsMap = toMap(docCounts);
  const quizzesMap = toMap(quizCounts);
  const sessionsMap = toMap(sessionCounts);

  return {
    page,
    limit,
    total,
    items: rows.map((u) => {
      const id = u._id.toString();
      return {
        id,
        email: u.email,
        name: u.name,
        role: u.role,
        authProvider: u.authProvider,
        hasGoogle: Boolean(u.googleId),
        lockedByEnv: isAdminEmail(u.email),
        createdAt: u.createdAt,
        counts: {
          documents: docsMap.get(id) ?? 0,
          quizSets: quizzesMap.get(id) ?? 0,
          sessions: sessionsMap.get(id) ?? 0,
        },
      };
    }),
  };
}

export async function setUserRole(
  userId: string,
  role: "user" | "admin",
  actorId?: string,
) {
  requireObjectId(userId, "userId");
  const user = await UserModel.findById(userId);
  if (!user) throw new AppError(404, "Không tìm thấy người dùng.");

  if (isAdminEmail(user.email) && role !== "admin") {
    throw new AppError(
      400,
      "Không thể hạ quyền email trong ADMIN_EMAILS. Xóa email khỏi .env trước.",
    );
  }

  if (actorId && actorId === userId && role !== "admin") {
    throw new AppError(400, "Không thể tự hạ quyền admin của chính bạn.");
  }

  user.role = role;
  await user.save();
  return {
    id: user._id.toString(),
    email: user.email,
    name: user.name,
    role: user.role,
  };
}

/** Xóa user + toàn bộ document / quiz / session / file. */
export async function deleteUser(userId: string, actorId?: string) {
  requireObjectId(userId, "userId");
  if (actorId && actorId === userId) {
    throw new AppError(400, "Không thể tự xóa tài khoản admin đang đăng nhập.");
  }

  const user = await UserModel.findById(userId);
  if (!user) throw new AppError(404, "Không tìm thấy người dùng.");
  if (isAdminEmail(user.email)) {
    throw new AppError(
      400,
      "Không thể xóa email trong ADMIN_EMAILS. Xóa khỏi .env trước.",
    );
  }

  const docs = await DocumentModel.find({ userId: user._id });
  for (const doc of docs) {
    try {
      await fs.unlink(doc.storagePath);
    } catch {
      /* ignore */
    }
  }

  await SessionModel.deleteMany({ userId: user._id });
  await QuizSetModel.deleteMany({ userId: user._id });
  await DocumentModel.deleteMany({ userId: user._id });
  await user.deleteOne();

  return { deleted: true, id: userId };
}

export async function listDocuments(query: {
  page?: unknown;
  limit?: unknown;
  q?: unknown;
}) {
  const { page, limit, skip, q } = parsePaging(query);
  const filter = q
    ? { originalName: { $regex: q, $options: "i" } }
    : {};

  const [total, rows] = await Promise.all([
    DocumentModel.countDocuments(filter),
    DocumentModel.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .select("-storagePath")
      .populate("userId", "email name"),
  ]);

  return {
    page,
    limit,
    total,
    items: rows.map((d) => {
      const user = d.userId as unknown as {
        _id?: Types.ObjectId;
        email?: string;
        name?: string;
      } | null;
      return {
        id: d._id.toString(),
        originalName: d.originalName,
        mimeType: d.mimeType,
        size: d.size,
        status: d.status,
        errorMessage: d.errorMessage,
        createdAt: d.createdAt,
        user: user?._id
          ? {
              id: user._id.toString(),
              email: user.email,
              name: user.name,
            }
          : null,
      };
    }),
  };
}

export async function deleteDocumentAdmin(documentId: string) {
  requireObjectId(documentId, "documentId");
  const doc = await DocumentModel.findById(documentId);
  if (!doc) throw new AppError(404, "Không tìm thấy tài liệu.");

  const quizzes = await QuizSetModel.find({
    $or: [{ documentId: doc._id }, { documentIds: doc._id }],
  }).select("_id");
  const quizIds = quizzes.map((q) => q._id);

  if (quizIds.length > 0) {
    await SessionModel.deleteMany({ quizSetId: { $in: quizIds } });
    await QuizSetModel.deleteMany({ _id: { $in: quizIds } });
  }

  try {
    await fs.unlink(doc.storagePath);
  } catch {
    /* ignore */
  }
  await doc.deleteOne();
  return { deleted: true, id: documentId, deletedQuizzes: quizIds.length };
}

export async function listQuizSets(query: {
  page?: unknown;
  limit?: unknown;
  q?: unknown;
}) {
  const { page, limit, skip, q } = parsePaging(query);
  const filter = q ? { title: { $regex: q, $options: "i" } } : {};

  const [total, rows] = await Promise.all([
    QuizSetModel.countDocuments(filter),
    QuizSetModel.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .select("title mode status questionBank meta defaults createdAt userId documentId")
      .populate("userId", "email name"),
  ]);

  return {
    page,
    limit,
    total,
    items: rows.map((qset) => {
      const user = qset.userId as unknown as {
        _id?: Types.ObjectId;
        email?: string;
        name?: string;
      } | null;
      return {
        id: qset._id.toString(),
        title: qset.title,
        mode: qset.mode,
        status: qset.status,
        bankSize: qset.questionBank?.length ?? 0,
        needsReview: Boolean(qset.meta?.needsReview),
        createdAt: qset.createdAt,
        user: user?._id
          ? {
              id: user._id.toString(),
              email: user.email,
              name: user.name,
            }
          : null,
      };
    }),
  };
}

export async function deleteQuizSetAdmin(quizSetId: string) {
  requireObjectId(quizSetId, "quizSetId");
  const quiz = await QuizSetModel.findById(quizSetId);
  if (!quiz) throw new AppError(404, "Không tìm thấy bộ câu hỏi.");

  const sessionResult = await SessionModel.deleteMany({ quizSetId: quiz._id });
  await quiz.deleteOne();
  return {
    deleted: true,
    id: quizSetId,
    deletedSessions: sessionResult.deletedCount ?? 0,
  };
}

export async function listSessions(query: {
  page?: unknown;
  limit?: unknown;
  q?: unknown;
}) {
  const { page, limit, skip } = parsePaging(query);
  const kind =
    typeof query.q === "string" &&
    (query.q === "practice" || query.q === "exam")
      ? query.q
      : undefined;
  const filter = kind ? { kind } : {};

  const [total, rows] = await Promise.all([
    SessionModel.countDocuments(filter),
    SessionModel.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .select(
        "kind status config score startedAt submittedAt expiresAt userId quizSetId createdAt",
      )
      .populate("userId", "email name")
      .populate("quizSetId", "title"),
  ]);

  return {
    page,
    limit,
    total,
    items: rows.map((s) => {
      const user = s.userId as unknown as {
        _id?: Types.ObjectId;
        email?: string;
        name?: string;
      } | null;
      const quiz = s.quizSetId as unknown as {
        _id?: Types.ObjectId;
        title?: string;
      } | null;
      return {
        id: s._id.toString(),
        kind: s.kind,
        status: s.status,
        config: s.config,
        score: s.score,
        startedAt: s.startedAt,
        submittedAt: s.submittedAt,
        expiresAt: s.expiresAt,
        createdAt: s.createdAt,
        user: user?._id
          ? {
              id: user._id.toString(),
              email: user.email,
              name: user.name,
            }
          : null,
        quizSet: quiz?._id
          ? { id: quiz._id.toString(), title: quiz.title }
          : null,
      };
    }),
  };
}

export async function deleteSessionAdmin(sessionId: string) {
  requireObjectId(sessionId, "sessionId");
  const session = await SessionModel.findById(sessionId);
  if (!session) throw new AppError(404, "Không tìm thấy phiên.");
  await session.deleteOne();
  return { deleted: true, id: sessionId };
}
