import fs from "node:fs/promises";
import type { Types } from "mongoose";
import { requireObjectId } from "../helpers/objectId";
import { parseDocumentToText } from "../helpers/parseDocument";
import { AppError } from "../middlewares/error.middleware";
import { DocumentModel } from "../models/Document.model";
import { QuizSetModel } from "../models/QuizSet.model";
import { SessionModel } from "../models/Session.model";

export async function createDocumentFromUpload(input: {
  userId: Types.ObjectId;
  file: Express.Multer.File;
}) {
  const doc = await DocumentModel.create({
    userId: input.userId,
    originalName: input.file.originalname,
    mimeType: input.file.mimetype,
    size: input.file.size,
    storagePath: input.file.path,
    status: "uploaded",
  });

  return doc;
}

export async function createDocumentsFromUploads(input: {
  userId: Types.ObjectId;
  files: Express.Multer.File[];
}) {
  const docs = [];
  for (const file of input.files) {
    docs.push(
      await createDocumentFromUpload({ userId: input.userId, file }),
    );
  }
  return docs;
}

export async function listDocuments(userId: Types.ObjectId) {
  return DocumentModel.find({ userId })
    .sort({ createdAt: -1 })
    .select("-storagePath");
}

export async function getDocumentForUser(
  documentId: string,
  userId: Types.ObjectId,
) {
  requireObjectId(documentId, "documentId");
  const doc = await DocumentModel.findOne({ _id: documentId, userId });
  if (!doc) {
    throw new AppError(404, "Không tìm thấy tài liệu.");
  }
  return doc;
}

/** Xóa document + cascade QuizSet và Session liên quan (tránh orphan). */
export async function deleteDocument(
  documentId: string,
  userId: Types.ObjectId,
) {
  const doc = await getDocumentForUser(documentId, userId);

  const quizzes = await QuizSetModel.find({
    userId,
    $or: [{ documentId: doc._id }, { documentIds: doc._id }],
  }).select("_id");
  const quizIds = quizzes.map((q) => q._id);

  if (quizIds.length > 0) {
    await SessionModel.deleteMany({ userId, quizSetId: { $in: quizIds } });
    await QuizSetModel.deleteMany({ _id: { $in: quizIds }, userId });
  }

  try {
    await fs.unlink(doc.storagePath);
  } catch {
    // file có thể đã bị xóa
  }
  await doc.deleteOne();
  return {
    deleted: true,
    deletedQuizSets: quizIds.length,
  };
}

/** Đọc full text từ file đã upload; cập nhật preview. */
export async function loadDocumentText(
  documentId: string,
  userId: Types.ObjectId,
): Promise<{ doc: Awaited<ReturnType<typeof getDocumentForUser>>; text: string }> {
  const doc = await getDocumentForUser(documentId, userId);
  doc.status = "processing";
  await doc.save();

  try {
    const text = await parseDocumentToText(doc.storagePath, doc.mimeType);
    doc.extractedTextPreview = text.slice(0, 2000);
    doc.status = "ready";
    doc.errorMessage = undefined;
    await doc.save();
    return { doc, text };
  } catch (err) {
    doc.status = "failed";
    doc.errorMessage = err instanceof Error ? err.message : "Parse thất bại";
    await doc.save();
    throw err;
  }
}

/**
 * Đọc nhiều tài liệu và ghép text (mỗi file 1 section có tên nguồn)
 * để Gemini EXTRACT/GENERATE trên toàn bộ.
 */
export async function loadDocumentsText(
  documentIds: string[],
  userId: Types.ObjectId,
): Promise<{
  docs: Awaited<ReturnType<typeof getDocumentForUser>>[];
  text: string;
}> {
  const uniqueIds = [...new Set(documentIds.map((id) => id.trim()).filter(Boolean))];
  if (uniqueIds.length === 0) {
    throw new AppError(400, "Cần ít nhất 1 tài liệu.");
  }

  const docs = [];
  const parts: string[] = [];

  for (const id of uniqueIds) {
    const { doc, text } = await loadDocumentText(id, userId);
    docs.push(doc);
    parts.push(
      `\n\n===== TÀI LIỆU: ${doc.originalName} =====\n\n${text.trim()}`,
    );
  }

  return { docs, text: parts.join("\n").trim() };
}

/**
 * Chuẩn bị tài liệu để gửi thẳng lên Gemini (không OCR/parse trước).
 * Đánh dấu processing; caller cập nhật ready/failed sau generate.
 */
export async function prepareDocumentsForGemini(
  documentIds: string[],
  userId: Types.ObjectId,
) {
  const uniqueIds = [
    ...new Set(documentIds.map((id) => id.trim()).filter(Boolean)),
  ];
  if (uniqueIds.length === 0) {
    throw new AppError(400, "Cần ít nhất 1 tài liệu.");
  }

  const docs = [];
  for (const id of uniqueIds) {
    const doc = await getDocumentForUser(id, userId);
    doc.status = "processing";
    doc.errorMessage = undefined;
    await doc.save();
    docs.push(doc);
  }
  return docs;
}

export async function markDocumentsReady(
  docs: Awaited<ReturnType<typeof getDocumentForUser>>[],
  preview?: string,
) {
  for (const doc of docs) {
    doc.status = "ready";
    doc.errorMessage = undefined;
    if (preview) doc.extractedTextPreview = preview.slice(0, 2000);
    await doc.save();
  }
}

export async function markDocumentsFailed(
  docs: Awaited<ReturnType<typeof getDocumentForUser>>[],
  message: string,
) {
  for (const doc of docs) {
    doc.status = "failed";
    doc.errorMessage = message;
    await doc.save();
  }
}
