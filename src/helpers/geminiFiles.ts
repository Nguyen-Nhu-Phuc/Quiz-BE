import fs from "node:fs";
import path from "node:path";
import {
  FileState,
  GoogleAIFileManager,
  type FileMetadataResponse,
} from "@google/generative-ai/server";
import { AppError } from "../middlewares/error.middleware";
import { isTransientGeminiError, toGeminiAppError } from "./geminiErrors";
import {
  createGeminiClients,
  requireGeminiApiKeys,
} from "./geminiKeys";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Gemini Files API thường ổn với file < ~50MB trên free tier; lớn hơn vẫn thử nhưng dễ timeout. */
export const GEMINI_WARN_FILE_MB = 50;

/** @deprecated Prefer createGeminiClients(apiKey).fileManager — giữ để tương thích. */
export function createFileManager(apiKey?: string) {
  const key = apiKey ?? requireGeminiApiKeys()[0];
  return createGeminiClients(key).fileManager;
}

/** Upload file local lên Gemini Files API và chờ ACTIVE (có retry). */
export async function uploadAndWaitActive(
  fileManager: GoogleAIFileManager,
  filePath: string,
  mimeType: string,
  displayName?: string,
): Promise<FileMetadataResponse> {
  const sizeMb = fs.statSync(filePath).size / (1024 * 1024);
  const label = displayName || path.basename(filePath);
  if (sizeMb > GEMINI_WARN_FILE_MB) {
    console.warn(
      `[gemini] File lớn ${sizeMb.toFixed(1)}MB: ${label} — dễ timeout khi upload`,
    );
  }

  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const upload = await fileManager.uploadFile(filePath, {
        mimeType,
        displayName: label.slice(0, 100),
      });

      let file = upload.file;
      const started = Date.now();
      while (file.state === FileState.PROCESSING) {
        if (Date.now() - started > 5 * 60_000) {
          try {
            await fileManager.deleteFile(file.name);
          } catch {
            /* ignore */
          }
          throw new AppError(504, "Gemini xử lý file quá lâu.");
        }
        await sleep(2000);
        file = await fileManager.getFile(file.name);
      }

      if (file.state !== FileState.ACTIVE) {
        const detail = file.error?.message ?? file.state;
        try {
          await fileManager.deleteFile(file.name);
        } catch {
          /* ignore */
        }
        throw new AppError(422, `Gemini không nhận file: ${detail}`);
      }

      return file;
    } catch (err) {
      lastErr = err;
      if (err instanceof AppError && err.status !== 504) throw err;
      if (!isTransientGeminiError(err) && !(err instanceof AppError)) {
        throw toGeminiAppError(err, `Upload “${label}”`);
      }
      console.warn(
        `[gemini] upload retry ${attempt + 1}/3 · ${label}:`,
        err instanceof Error ? err.message : err,
      );
      await sleep(2000 * (attempt + 1));
    }
  }

  throw toGeminiAppError(lastErr, `Upload “${label}”`);
}

export async function deleteGeminiFile(
  fileManager: GoogleAIFileManager,
  fileName: string,
) {
  try {
    await fileManager.deleteFile(fileName);
  } catch {
    /* ignore */
  }
}
