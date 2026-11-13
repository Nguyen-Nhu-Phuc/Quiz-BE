import fs from "node:fs/promises";
import path from "node:path";
import mammoth from "mammoth";
import pdfParse from "pdf-parse";
import { AppError } from "../middlewares/error.middleware";
import { extractPdfTextWithGemini } from "./pdfOcr";

/** Text quá ngắn / chỉ whitespace → coi như không có lớp chữ. */
function isUsableText(text: string): boolean {
  const compact = text.replace(/\s+/g, "").trim();
  return compact.length >= 40;
}

export async function parseDocumentToText(
  filePath: string,
  mimeType: string,
): Promise<string> {
  const ext = path.extname(filePath).toLowerCase();
  const buffer = await fs.readFile(filePath);

  if (mimeType === "application/pdf" || ext === ".pdf") {
    let text = "";
    try {
      const result = await pdfParse(buffer);
      text = (result.text ?? "").trim();
    } catch (err) {
      console.warn(
        "[parseDocument] pdf-parse failed, fallback OCR:",
        err instanceof Error ? err.message : err,
      );
    }

    if (isUsableText(text)) {
      return text;
    }

    console.info(
      "[parseDocument] PDF không có text layer đủ dùng → OCR bằng Gemini…",
    );
    return extractPdfTextWithGemini(filePath);
  }

  if (
    mimeType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    mimeType === "application/msword" ||
    ext === ".docx" ||
    ext === ".doc"
  ) {
    const result = await mammoth.extractRawText({ buffer });
    const text = (result.value ?? "").trim();
    if (!text) {
      throw new AppError(422, "Không đọc được nội dung DOCX.");
    }
    return text;
  }

  throw new AppError(415, "Định dạng tài liệu không hỗ trợ. Chỉ PDF/DOCX.");
}
