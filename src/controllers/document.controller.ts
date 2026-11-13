import type { NextFunction, Request, Response } from "express";
import { ok } from "../helpers/http";
import { paramId } from "../helpers/params";
import { AppError } from "../middlewares/error.middleware";
import * as documentService from "../services/document.service";

function requireUser(req: Request) {
  if (!req.userObjectId) {
    throw new AppError(401, "Chưa đăng nhập.");
  }
  return req.userObjectId;
}

function toDocDto(doc: {
  _id: { toString(): string };
  originalName: string;
  mimeType: string;
  size: number;
  status: string;
  createdAt?: Date;
}) {
  return {
    id: doc._id.toString(),
    originalName: doc.originalName,
    mimeType: doc.mimeType,
    size: doc.size,
    status: doc.status,
    createdAt: doc.createdAt,
  };
}

export async function upload(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = requireUser(req);
    if (!req.file) {
      throw new AppError(400, "Thiếu file upload (field: file).");
    }
    const doc = await documentService.createDocumentFromUpload({
      userId,
      file: req.file,
    });
    ok(res, toDocDto(doc), 201);
  } catch (err) {
    next(err);
  }
}

/** Upload nhiều PDF/DOCX — field `files`. */
export async function uploadMany(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = requireUser(req);
    const files = req.files as Express.Multer.File[] | undefined;
    if (!files?.length) {
      throw new AppError(400, "Thiếu file upload (field: files).");
    }
    const docs = await documentService.createDocumentsFromUploads({
      userId,
      files,
    });
    ok(res, docs.map(toDocDto), 201);
  } catch (err) {
    next(err);
  }
}

export async function list(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = requireUser(req);
    const docs = await documentService.listDocuments(userId);
    // Chuẩn hóa giống upload/getOne: luôn trả `id` (không lộ storagePath)
    ok(
      res,
      docs.map((doc) => ({
        id: doc._id.toString(),
        originalName: doc.originalName,
        mimeType: doc.mimeType,
        size: doc.size,
        status: doc.status,
        extractedTextPreview: doc.extractedTextPreview,
        errorMessage: doc.errorMessage,
        createdAt: doc.createdAt,
      })),
    );
  } catch (err) {
    next(err);
  }
}

export async function getOne(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = requireUser(req);
    const doc = await documentService.getDocumentForUser(
      paramId(req),
      userId,
    );
    ok(res, {
      id: doc._id.toString(),
      originalName: doc.originalName,
      mimeType: doc.mimeType,
      size: doc.size,
      status: doc.status,
      extractedTextPreview: doc.extractedTextPreview,
      errorMessage: doc.errorMessage,
      createdAt: doc.createdAt,
    });
  } catch (err) {
    next(err);
  }
}

export async function remove(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = requireUser(req);
    const result = await documentService.deleteDocument(paramId(req), userId);
    ok(res, result);
  } catch (err) {
    next(err);
  }
}
