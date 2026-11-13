import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { GoogleGenerativeAI } from "@google/generative-ai";
import {
  FileState,
  GoogleAIFileManager,
} from "@google/generative-ai/server";
import { createWorker } from "tesseract.js";
import { env } from "../config/env";
import {
  createGeminiClients,
  isGeminiKeyExhaustedError,
  markGeminiKeyExhausted,
  maskGeminiKey,
  requireGeminiApiKeys,
} from "./geminiKeys";
import { AppError } from "../middlewares/error.middleware";

const OCR_PROMPT = `Transcribe ALL visible text on this PDF page exactly (Vietnamese/English).
Keep exam structure if present: "Câu N", A/B/C/D, answers.
Do not summarize or invent. Plain text only.`;

const FALLBACK_MODELS = [
  "gemini-3.5-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
];

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function usable(text: string): boolean {
  return text.replace(/\s+/g, "").length >= 40;
}

function ocrModelCandidates(): string[] {
  const preferred = env.geminiModel?.trim();
  const list = preferred
    ? [preferred, ...FALLBACK_MODELS.filter((m) => m !== preferred)]
    : [...FALLBACK_MODELS];
  return [...new Set(list)];
}

/** OCR local: render từng trang → Tesseract (vie+eng). */
async function extractWithTesseract(filePath: string): Promise<string> {
  const { pdf } = await import("pdf-to-img");
  const document = await pdf(filePath, { scale: 2 });
  const worker = await createWorker(["vie", "eng"], 1, {
    logger: () => undefined,
  });

  try {
    const parts: string[] = [];
    let pageNo = 0;
    for await (const image of document) {
      pageNo += 1;
      console.info(`[pdfOcr] Tesseract trang ${pageNo}/${document.length}…`);
      const { data } = await worker.recognize(image);
      const pageText = (data.text ?? "").trim();
      if (pageText) {
        parts.push(`----- Trang ${pageNo} -----\n${pageText}`);
      }
    }
    return parts.join("\n\n").trim();
  } finally {
    await worker.terminate();
  }
}

async function waitFileActive(
  fileManager: GoogleAIFileManager,
  fileName: string,
) {
  let file = await fileManager.getFile(fileName);
  const started = Date.now();
  while (file.state === FileState.PROCESSING) {
    if (Date.now() - started > 3 * 60_000) {
      throw new AppError(504, "Gemini xử lý PDF quá lâu (OCR timeout).");
    }
    await sleep(1500);
    file = await fileManager.getFile(fileName);
  }
  if (file.state !== FileState.ACTIVE) {
    throw new AppError(
      422,
      `Không OCR được PDF qua Gemini (${file.error?.message ?? file.state}).`,
    );
  }
  return file;
}

async function geminiOcrOnePdf(
  genAI: GoogleGenerativeAI,
  fileManager: GoogleAIFileManager,
  pdfPath: string,
  label: string,
): Promise<string> {
  const upload = await fileManager.uploadFile(pdfPath, {
    mimeType: "application/pdf",
    displayName: label.slice(0, 100),
  });
  const file = await waitFileActive(fileManager, upload.file.name);

  try {
    let lastErr: unknown;
    for (const modelName of ocrModelCandidates()) {
      const model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig: { temperature: 0.1, maxOutputTokens: 8192 },
      });
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const result = await model.generateContent([
            {
              fileData: {
                mimeType: file.mimeType,
                fileUri: file.uri,
              },
            },
            { text: OCR_PROMPT },
          ]);
          return (result.response.text() ?? "").trim();
        } catch (err) {
          lastErr = err;
          const msg = err instanceof Error ? err.message : String(err);
          if (/RECITATION|blocked/i.test(msg)) {
            console.warn(`[pdfOcr] ${label}: bị chặn RECITATION`);
            return "";
          }
          if (isGeminiKeyExhaustedError(err)) throw err;
          if (/404|no longer available/i.test(msg)) break;
          if (/503|429|high demand/i.test(msg) && attempt === 0) {
            await sleep(2000);
            continue;
          }
          if (/503|429|high demand/i.test(msg)) break;
          throw err;
        }
      }
    }
    if (lastErr) throw lastErr;
    return "";
  } finally {
    try {
      await fileManager.deleteFile(file.name);
    } catch {
      /* ignore */
    }
  }
}

/** Gemini OCR theo từng trang (tránh RECITATION / file quá lớn). */
async function extractWithGeminiPages(filePath: string): Promise<string> {
  const keys = requireGeminiApiKeys();
  let keyIdx = 0;
  let clients = createGeminiClients(keys[keyIdx]);

  const srcBytes = await fs.readFile(filePath);
  const srcDoc = await PDFDocument.load(srcBytes, { ignoreEncryption: true });
  const pageCount = srcDoc.getPageCount();
  if (pageCount === 0) {
    throw new AppError(422, "PDF không có trang.");
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "quiz-ocr-"));
  const parts: string[] = [];

  try {
    for (let i = 0; i < pageCount; i += 1) {
      console.info(
        `[pdfOcr] Gemini OCR trang ${i + 1}/${pageCount} · key#${keyIdx + 1}…`,
      );
      const pageDoc = await PDFDocument.create();
      const [copied] = await pageDoc.copyPages(srcDoc, [i]);
      pageDoc.addPage(copied);
      const pagePath = path.join(tmpDir, `page-${i + 1}.pdf`);
      await fs.writeFile(pagePath, await pageDoc.save());

      try {
        const text = await geminiOcrOnePdf(
          clients.genAI,
          clients.fileManager,
          pagePath,
          `page-${i + 1}`,
        );
        if (text) {
          parts.push(`----- Trang ${i + 1} -----\n${text}`);
        }
      } catch (err) {
        if (isGeminiKeyExhaustedError(err) && keyIdx + 1 < keys.length) {
          markGeminiKeyExhausted(
            clients.apiKey,
            err instanceof Error ? err.message : "ocr quota",
          );
          keyIdx += 1;
          clients = createGeminiClients(keys[keyIdx]);
          console.warn(
            `[pdfOcr] Đổi API key → #${keyIdx + 1} (${maskGeminiKey(clients.apiKey)})`,
          );
          i -= 1;
          continue;
        }
        throw err;
      }
    }
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }

  return parts.join("\n\n").trim();
}

/**
 * PDF không có text layer → OCR.
 * Ưu tiên Tesseract local; nếu yếu → Gemini từng trang.
 */
export async function extractPdfTextWithGemini(
  filePath: string,
): Promise<string> {
  let localText = "";
  try {
    console.info("[pdfOcr] Thử OCR local (Tesseract vie+eng)…");
    localText = await extractWithTesseract(filePath);
  } catch (err) {
    console.warn(
      "[pdfOcr] Tesseract thất bại:",
      err instanceof Error ? err.message : err,
    );
  }

  if (usable(localText)) {
    console.info(`[pdfOcr] Tesseract OK · ${localText.length} ký tự`);
    return localText;
  }

  console.info("[pdfOcr] Tesseract yếu/trống → OCR từng trang bằng Gemini…");
  const geminiText = await extractWithGeminiPages(filePath);
  if (usable(geminiText)) {
    return geminiText;
  }

  // Ghép cả hai nếu mỗi bên có chút chữ
  const merged = [localText, geminiText].filter(Boolean).join("\n\n").trim();
  if (usable(merged)) return merged;

  throw new AppError(
    422,
    "Không đọc được nội dung PDF (scan mờ hoặc OCR thất bại). Thử file PDF có lớp chữ, hoặc OCR bằng công cụ khác rồi tải lại.",
  );
}
