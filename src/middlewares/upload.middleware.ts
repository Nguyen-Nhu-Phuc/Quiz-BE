import fs from "node:fs";
import path from "node:path";
import multer from "multer";
import {
  ALLOWED_EXTENSIONS,
  ALLOWED_MIME_TYPES,
  MAX_UPLOAD_FILES,
} from "../config/constants";
import { env } from "../config/env";
import { decodeUploadFilename } from "../helpers/filenameEncoding";
import { AppError } from "./error.middleware";

if (!fs.existsSync(env.uploadDir)) {
  fs.mkdirSync(env.uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, env.uploadDir);
  },
  filename: (_req, file, cb) => {
    const name = decodeUploadFilename(file.originalname);
    const safe = name.replace(/[^\w.\-()+\sÀ-ỹ]/gi, "_");
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safe}`);
  },
});

function fileFilter(
  _req: Express.Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback,
): void {
  const ext = path.extname(decodeUploadFilename(file.originalname)).toLowerCase();
  const mime = (file.mimetype || "").toLowerCase();
  const mimeOk =
    (ALLOWED_MIME_TYPES as readonly string[]).includes(mime) ||
    mime === "application/octet-stream" ||
    mime === "";
  const extOk = (ALLOWED_EXTENSIONS as readonly string[]).includes(ext);

  // Extension bắt buộc đúng; mime phải hợp lệ hoặc generic (octet-stream).
  // Chặn .exe + Content-Type: application/pdf vì ext không nằm allowlist.
  if (!extOk || !mimeOk) {
    cb(new AppError(415, "Chỉ chấp nhận file PDF hoặc DOCX."));
    return;
  }
  cb(null, true);
}

const upload = multer({
  storage,
  fileFilter,
  // Không giới hạn dung lượng từng file (MAX_UPLOAD_MB bỏ / = 0).
  limits: {
    ...(env.maxUploadMb > 0
      ? { fileSize: env.maxUploadMb * 1024 * 1024 }
      : {}),
    files: MAX_UPLOAD_FILES,
  },
});

/** 1 file: field `file` (giữ tương thích). */
export const uploadDocument = upload.single("file");

/** Nhiều file: field `files` (1–MAX_UPLOAD_FILES). */
export const uploadDocuments = upload.array("files", MAX_UPLOAD_FILES);
