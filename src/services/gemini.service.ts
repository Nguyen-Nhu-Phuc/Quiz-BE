import fs from "node:fs/promises";
import path from "node:path";
import { GoogleGenerativeAI } from "@google/generative-ai";
import mammoth from "mammoth";
import type {
  ClinicalCaseInput,
  DocumentMode,
  GeminiQuizResult,
  Question,
  QuizDifficulty,
} from "../@types/question";
import { EXTRACT_BANK_REVIEW_THRESHOLD } from "../config/constants";
import { getRuntimeConfig } from "../config/runtimeConfig";
import { env } from "../config/env";
import {
  isTransientGeminiError,
  toGeminiAppError,
} from "../helpers/geminiErrors";
import {
  deleteGeminiFile,
  uploadAndWaitActive,
} from "../helpers/geminiFiles";
import {
  createGeminiClients,
  isGeminiKeyExhaustedError,
  isPerModelDailyQuotaError,
  isTransientRateLimitError,
  markGeminiKeyExhausted,
  maskGeminiKey,
  recordGeminiKeyUse,
  requireGeminiApiKeys,
} from "../helpers/geminiKeys";
import { extractJsonLoose } from "../helpers/jsonRepair";
import { AppError } from "../middlewares/error.middleware";
import { dedupeQuestionBank, sanitizeQuestion } from "./dedupe.service";
import type { GoogleAIFileManager } from "@google/generative-ai/server";

const BATCH_SIZE = 40;

function difficultyGuide(level: QuizDifficulty): string {
  if (level === "de") {
    return "Độ khó DỄ: tình huống ngắn, hỏi nhận biết / áp dụng trực tiếp 1 ý trong tài liệu; đáp án nhiễu rõ ràng hơn.";
  }
  if (level === "kho") {
    return "Độ khó KHÓ: tình huống nhiều yếu tố, cần suy luận / ưu tiên xử trí / loại trừ; đáp án nhiễu gần đúng.";
  }
  return "Độ khó TRUNG BÌNH: tình huống thực tế vừa phải, hỏi quyết định hoặc giải thích dựa tài liệu.";
}

function buildSystemPrompt(
  targetCount: number,
  options: {
    includeSituational: boolean;
    difficulty: QuizDifficulty;
    topicHint?: string;
  },
): string {
  const mixBlock = options.includeSituational
    ? `
## BẮT BUỘC TRỘN 2 LOẠI CÂU (mỗi batch và cả bank)
Luôn tạo **cả hai** trong cùng ngân hàng — không được chỉ có một loại:

### A) Lý thuyết — type "trac_nghiem" (~50–60% bank)
- Hỏi định nghĩa, nguyên lý, quy định, dấu hiệu, phân loại, đúng/sai kiến thức.
- Stem ngắn, rõ, không cần dựng tình huống dài.

### B) Tình huống — type "tinh_huong" hoặc "lam_sang" (~40–50% bank)
- Kiểu NotebookLM: bối cảnh ngắn → hỏi quyết định / bước tiếp / nhận định đúng.
- "tinh_huong": tình huống chung (quy trình, kỹ thuật, quản lý…) từ tài liệu.
- "lam_sang": chỉ khi tài liệu y khoa (bệnh nhân, triệu chứng, xử trí).
- Format stem gợi ý: "Tình huống: …\\nCâu hỏi: …" (hoặc 2–4 câu mô tả + 1 câu hỏi).

### Quy tắc chung
- Cả hai loại đều trắc nghiệm 4 đáp án; explanation bám tài liệu; paraphrase (chống RECITATION).
- Mỗi batch phải có **cả** câu lý thuyết và câu tình huống (không dump một loại).
- Không pad clone; mỗi câu ý độc lập.
- EXTRACT: giữ câu gốc; bổ sung thêm lý thuyết + tình huống mới nếu bank thiếu một trong hai loại.
- ${difficultyGuide(options.difficulty)}
`
    : `
## LOẠI CÂU
- Ưu tiên type "trac_nghiem" (lý thuyết). Chỉ giữ tình huống nếu đã có sẵn trong đề EXTRACT.
`;

  const topicBlock = options.topicHint?.trim()
    ? `\n## CHỦ ĐỀ / YÊU CẦU THÊM CỦA NGƯỜI DÙNG\n${options.topicHint.trim()}\nƯu tiên phủ chủ đề này nhưng vẫn bám tài liệu; không bịa ngoài nguồn.\n`
    : "";

  return `Bạn là gia sư ôn luyện (phong cách quiz NotebookLM). Đọc kỹ TÀI LIỆU ĐÍNH KÈM và trả về JSON ngân hàng câu hỏi trắc nghiệm.

## MỤC TIÊU SỐ LƯỢNG
- Người dùng yêu cầu khoảng ${targetCount} câu UNIQUE (stem khác nhau rõ).
- Mỗi lần trả tối đa ${BATCH_SIZE} câu. Nếu chưa đủ sẽ được gọi tiếp.
- ZERO_NEAR_DUPLICATE: CẤM trùng stem / biến thể wording gần / chỉ đổi mã số / xáo choices.
- CẤM clone khuôn câu chỉ đổi vài từ để đủ số. Mỗi câu phải hỏi ý khác nhau từ tài liệu.
- Không để stem trống. PDF scan: đọc/OCR chữ rồi mới trích/sinh.
- CHỐNG RECITATION: không copy nguyên văn dài từ PDF; paraphrase stem/choices/explanation; chỉ giữ thuật ngữ & số liệu.

## MODE
1. Tài liệu đã là đề/trắc nghiệm (nhiều Câu N + A/B/C/D) → EXTRACT: trích tối đa câu có sẵn.
2. Giáo trình/bài giảng → GENERATE: viết câu mới phủ kiến thức; vẫn cố gắng đạt ${targetCount} câu unique nếu tài liệu đủ nội dung.
3. Nếu tài liệu không đủ ý độc lập để đạt ${targetCount}, trả hết câu unique được và meta.hasMore=false + lyDoBankNganHonTarget.

## Schema mỗi câu
id, stem (không rỗng), choices[4], correctIndex (0-3), explanation, topic, type ("trac_nghiem"|"tinh_huong"|"lam_sang")
${mixBlock}${topicBlock}
## Output — CHỈ JSON:
{
  "mode": "EXTRACT" | "GENERATE",
  "modeReason": string,
  "questionBank": Question[],
  "meta": {
    "soCauPhatHien"?: number,
    "hasMore": boolean,
    "soYDocLap"?: number,
    "lyDoBankNganHonTarget"?: string
  }
}`;
}

/** Ưu tiên lite khi model chính hết RPD free tier (quota theo model, không phải cả tài khoản). */
const FALLBACK_MODELS = [
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-flash-latest",
  "gemini-2.0-flash",
  "gemini-2.0-flash-lite",
];

export type SourceDocumentFile = {
  storagePath: string;
  mimeType: string;
  originalName: string;
};

export type GenerateBankOptions = {
  clinicalCases?: ClinicalCaseInput[];
  /** Số câu unique mong muốn trong ngân hàng. */
  targetCount: number;
  /** Trộn câu hỏi tình huống kiểu NotebookLM (mặc định true). */
  includeSituational?: boolean;
  difficulty?: QuizDifficulty;
  /** Gợi ý chủ đề / prompt thêm (vd. "triệu chứng thai kỳ nguy cơ cao"). */
  topicHint?: string;
};

function isSituationalType(type: string | undefined): boolean {
  return type === "tinh_huong" || type === "lam_sang";
}

type ContentPart =
  | { text: string }
  | { fileData: { mimeType: string; fileUri: string } };

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function modelCandidates(): string[] {
  const preferred = getRuntimeConfig().geminiModel?.trim() || env.geminiModel?.trim();
  const list = preferred
    ? [preferred, ...FALLBACK_MODELS.filter((m) => m !== preferred)]
    : [...FALLBACK_MODELS];
  return [...new Set(list)];
}

function isPdf(mimeType: string, fileName: string): boolean {
  const ext = path.extname(fileName).toLowerCase();
  return mimeType === "application/pdf" || ext === ".pdf";
}

function isDocx(mimeType: string, fileName: string): boolean {
  const ext = path.extname(fileName).toLowerCase();
  return (
    mimeType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    mimeType === "application/msword" ||
    ext === ".docx" ||
    ext === ".doc"
  );
}

function ensureUniqueIds(questions: Question[]): Question[] {
  const seen = new Set<string>();
  return questions.map((q, i) => {
    let id = q.id || `q-${i + 1}`;
    if (seen.has(id)) id = `${id}-${i + 1}`;
    seen.add(id);
    return { ...q, id };
  });
}

function sanitizeBank(rawBank: unknown[]): Question[] {
  const sanitized: Question[] = [];
  for (let i = 0; i < rawBank.length; i += 1) {
    const q = sanitizeQuestion(rawBank[i], i);
    if (q) sanitized.push(q);
  }
  return sanitized;
}

function isRecitationFinish(finishReason?: string): boolean {
  return String(finishReason ?? "").toUpperCase() === "RECITATION";
}

function throwRecitationError(finishReason?: string): never {
  throw new AppError(
    502,
    "Gemini chặn vì nội dung quá giống tài liệu gốc (RECITATION). Đang thử viết lại / paraphrase…",
    { recitation: true, finishReason: finishReason || "RECITATION" },
  );
}

export function isGeminiRecitationError(err: unknown): boolean {
  if (err instanceof AppError) {
    const d = err.details as { recitation?: boolean } | undefined;
    if (d?.recitation) return true;
    return /RECITATION/i.test(err.message);
  }
  const msg = err instanceof Error ? err.message : String(err);
  return /RECITATION/i.test(msg);
}

const ANTI_RECITATION_APPENDIX = `
## CHỐNG RECITATION (BẮT BUỘC)
- CẤM trích nguyên văn dài từ tài liệu / sách giáo khoa / đề thi.
- Viết lại stem, choices, explanation bằng lời của bạn (paraphrase); chỉ giữ thuật ngữ chuyên môn, số liệu, tên riêng.
- Ưu tiên mode GENERATE (câu hỏi mới dựa kiến thức tài liệu), không copy-paste đoạn dài.
- Không tái tạo chuỗi ≥ 10 từ liên tiếp từ nguồn.
- Chỉ trả JSON questionBank như schema.
`;

function safeResponseText(result: {
  response: {
    text: () => string;
    candidates?: Array<{ finishReason?: string; content?: { parts?: Array<{ text?: string }> } }>;
    promptFeedback?: { blockReason?: string };
  };
}): { text: string; finishReason?: string } {
  const finishReason = result.response.candidates?.[0]?.finishReason;
  const block = result.response.promptFeedback?.blockReason;
  if (block) {
    throw new AppError(422, `Gemini chặn nội dung (${block}).`);
  }
  if (isRecitationFinish(finishReason)) {
    // Đôi khi vẫn có partial text trước khi bị cắt — thử lấy; nếu trống thì lỗi recitation
    const partial = (result.response.candidates?.[0]?.content?.parts ?? [])
      .map((p) => p.text ?? "")
      .join("")
      .trim();
    if (partial.length > 40) {
      console.warn("[gemini] RECITATION nhưng còn partial — dùng partial");
      return { text: partial, finishReason };
    }
    throwRecitationError(finishReason);
  }
  try {
    return { text: result.response.text() ?? "", finishReason };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (isRecitationFinish(finishReason) || /RECITATION/i.test(msg)) {
      throwRecitationError(finishReason || "RECITATION");
    }
    throw new AppError(
      502,
      `Gemini không trả text (${finishReason || msg}).`,
    );
  }
}

async function generateWithModelFallback(
  genAI: GoogleGenerativeAI,
  parts: ContentPart[],
  apiKey?: string,
  opts?: { temperature?: number; antiRecitation?: boolean },
) {
  const temperature = opts?.temperature ?? (opts?.antiRecitation ? 0.55 : 0.25);
  const requestParts: ContentPart[] = opts?.antiRecitation
    ? [...parts, { text: ANTI_RECITATION_APPENDIX }]
    : parts;

  let lastErr: unknown;
  for (const modelName of modelCandidates()) {
    const model = genAI.getGenerativeModel({
      model: modelName,
      generationConfig: {
        temperature,
        responseMimeType: "application/json",
        maxOutputTokens: 8192,
      },
    });

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        if (apiKey) recordGeminiKeyUse(apiKey);
        const result = await model.generateContent(requestParts);
        // Kiểm tra RECITATION sớm (HTTP 200 nhưng không có text)
        const finishReason = result.response.candidates?.[0]?.finishReason;
        if (isRecitationFinish(finishReason)) {
          const partial = (result.response.candidates?.[0]?.content?.parts ?? [])
            .map((p: { text?: string }) => p.text ?? "")
            .join("")
            .trim();
          if (partial.length > 40) {
            console.warn(
              `[gemini] RECITATION+partial · model=${modelName} · dùng partial`,
            );
            return result;
          }
          lastErr = new AppError(502, "RECITATION", { recitation: true });
          console.warn(
            `[gemini] RECITATION · model=${modelName} · attempt ${attempt + 1}`,
          );
          if (!opts?.antiRecitation) {
            // Thử lại ngay với anti-recitation trên cùng model
            break;
          }
          if (attempt < 2) {
            await sleep(800);
            continue;
          }
          break;
        }
        if (modelName !== getRuntimeConfig().geminiModel) {
          console.info(`[gemini] OK với model=${modelName}`);
        }
        return result;
      } catch (err) {
        lastErr = err;
        const msg = err instanceof Error ? err.message : String(err);

        // Hết RPD của 1 model → thử model khác (đừng đốt cả API key ngay).
        if (isPerModelDailyQuotaError(err)) {
          console.warn(
            `[gemini] Model ${modelName} hết hạn mức ngày (free tier) — thử model khác`,
          );
          break;
        }

        // RPM / quá tải tạm → chờ rồi thử lại, không đánh dấu key chết.
        if (isTransientRateLimitError(err) && attempt < 2) {
          console.warn(
            `[gemini] Rate limit tạm · model=${modelName} · attempt ${attempt + 1}`,
          );
          await sleep(2500 * (attempt + 1));
          continue;
        }
        if (isTransientRateLimitError(err)) {
          console.warn(`[gemini] Rate limit · bỏ model=${modelName}`);
          break;
        }

        if (isGeminiKeyExhaustedError(err)) {
          if (apiKey) markGeminiKeyExhausted(apiKey, msg);
          throw toGeminiAppError(err, "Gemini generate");
        }
        if (isGeminiRecitationError(err)) {
          console.warn(`[gemini] RECITATION throw · model=${modelName}`);
          break;
        }
        if (/404|no longer available/i.test(msg)) {
          console.warn(`[gemini] model ${modelName} unavailable`);
          break;
        }
        if (isTransientGeminiError(err) && attempt < 2) {
          await sleep(2000 * (attempt + 1));
          continue;
        }
        if (isTransientGeminiError(err)) {
          console.warn(`[gemini] model ${modelName} bận/mất mạng`);
          break;
        }
        throw toGeminiAppError(err, "Gemini generate");
      }
    }
  }

  // Tất cả model đều hết RPD free tier → mới đánh dấu key.
  if (isPerModelDailyQuotaError(lastErr)) {
    if (apiKey) {
      markGeminiKeyExhausted(
        apiKey,
        lastErr instanceof Error ? lastErr.message : String(lastErr),
      );
    }
    throw toGeminiAppError(lastErr, "Gemini generate");
  }

  // Lớp 2: nếu chưa anti-recitation thì gọi lại toàn bộ models với paraphrase
  if (!opts?.antiRecitation && isGeminiRecitationError(lastErr)) {
    console.warn("[gemini] Retry toàn bộ với anti-RECITATION paraphrase…");
    return generateWithModelFallback(genAI, parts, apiKey, {
      antiRecitation: true,
      temperature: 0.65,
    });
  }

  if (isGeminiRecitationError(lastErr)) {
    throw new AppError(
      502,
      "Gemini liên tục chặn RECITATION (nội dung quá giống tài liệu). Thử ít file hơn, hoặc bật GENERATE bằng giáo trình ngắn hơn.",
      { recitation: true },
    );
  }
  throw toGeminiAppError(lastErr, "Gemini generate");
}

function parseGeminiQuizResponse(responseText: string): {
  mode: DocumentMode;
  modeReason: string;
  questions: Question[];
  rawMeta: Record<string, unknown>;
  hasMore: boolean;
} {
  let parsed: unknown;
  try {
    parsed = extractJsonLoose(responseText);
  } catch (err) {
    console.error(
      "[gemini] JSON parse fail · len=",
      responseText.length,
      "· preview:",
      responseText.slice(0, 300).replace(/\s+/g, " "),
    );
    throw new AppError(
      502,
      `Gemini trả về JSON không hợp lệ (${err instanceof Error ? err.message : "parse error"}).`,
    );
  }

  if (Array.isArray(parsed)) {
    return {
      mode: "EXTRACT",
      modeReason: "Gemini trả mảng câu hỏi.",
      questions: sanitizeBank(parsed),
      rawMeta: {},
      hasMore: false,
    };
  }

  const obj = parsed as Record<string, unknown>;
  const mode: DocumentMode =
    obj.mode === "GENERATE" ? "GENERATE" : "EXTRACT";
  const rawMeta = (obj.meta ?? {}) as Record<string, unknown>;
  return {
    mode,
    modeReason: String(obj.modeReason ?? "").trim() || "Không nêu lý do.",
    questions: sanitizeBank(
      Array.isArray(obj.questionBank) ? obj.questionBank : [],
    ),
    rawMeta,
    hasMore: Boolean(rawMeta.hasMore),
  };
}

function stemAvoidList(questions: Question[], limit = 25): string {
  return questions
    .slice(-limit)
    .map((q, i) => `${i + 1}. ${q.stem.slice(0, 120)}`)
    .join("\n");
}

async function buildSourceParts(
  sources: SourceDocumentFile[],
  fileManager: GoogleAIFileManager,
): Promise<{
  parts: ContentPart[];
  labels: string[];
  uploadedNames: string[];
}> {
  const parts: ContentPart[] = [];
  const labels: string[] = [];
  const uploadedNames: string[] = [];

  for (const src of sources) {
    labels.push(src.originalName);
    if (isPdf(src.mimeType, src.originalName)) {
      console.info(`[gemini] Upload PDF: ${src.originalName}`);
      const file = await uploadAndWaitActive(
        fileManager,
        src.storagePath,
        "application/pdf",
        src.originalName,
      );
      uploadedNames.push(file.name);
      parts.push({
        fileData: { mimeType: file.mimeType, fileUri: file.uri },
      });
    } else if (isDocx(src.mimeType, src.originalName)) {
      console.info(`[gemini] DOCX → text: ${src.originalName}`);
      const buffer = await fs.readFile(src.storagePath);
      const extracted = await mammoth.extractRawText({ buffer });
      const text = (extracted.value ?? "").trim();
      if (!text) {
        throw new AppError(422, `Không đọc được DOCX: ${src.originalName}`);
      }
      parts.push({
        text: `\n===== ${src.originalName} =====\n${text.slice(0, 200_000)}\n`,
      });
    } else {
      throw new AppError(415, `Không hỗ trợ: ${src.originalName}`);
    }
  }

  return { parts, labels, uploadedNames };
}

function buildBatchPrompt(input: {
  labels: string[];
  targetCount: number;
  already: Question[];
  need: number;
  clinicalCases?: ClinicalCaseInput[];
  isFirst: boolean;
  includeSituational: boolean;
  topicHint?: string;
}): string {
  const {
    labels,
    targetCount,
    already,
    need,
    clinicalCases,
    isFirst,
    includeSituational,
    topicHint,
  } = input;
  let prompt = `Tài liệu đính kèm (${labels.length}): ${labels.join(", ")}.\n`;
  prompt += `Mục tiêu ngân hàng: ${targetCount} câu UNIQUE.\n`;
  prompt += `Đã có: ${already.length} câu unique. Lần này hãy trả thêm tối đa ${Math.min(BATCH_SIZE, need)} câu MỚI (stem khác rõ các câu đã có).\n`;

  if (already.length > 0) {
    prompt += `\nTránh trùng các stem gần đây:\n${stemAvoidList(already)}\n`;
  }

  if (isFirst) {
    prompt +=
      "\nChọn EXTRACT hoặc GENERATE đúng loại tài liệu. Quét HẾT nội dung đính kèm.\n";
    if (includeSituational) {
      prompt +=
        'Batch này BẮT BUỘC trộn cả câu lý thuyết type "trac_nghiem" (~55%) VÀ câu tình huống type "tinh_huong"/"lam_sang" (~45%) — không chỉ một loại.\n';
    }
  } else {
    prompt +=
      "\nTiếp tục bổ sung câu mới từ phần chưa khai thác / góc hỏi khác. Không lặp ý đã có.\n";
    if (includeSituational) {
      const sitCount = already.filter((q) => isSituationalType(q.type)).length;
      const theoryCount = already.length - sitCount;
      const targetSit = Math.max(3, Math.round(targetCount * 0.45));
      const targetTheory = Math.max(3, Math.round(targetCount * 0.55));
      if (sitCount < targetSit) {
        prompt += `Thiếu tình huống (hiện ${sitCount}/${targetSit}) → ưu tiên thêm "tinh_huong"/"lam_sang".\n`;
      }
      if (theoryCount < targetTheory) {
        prompt += `Thiếu lý thuyết (hiện ${theoryCount}/${targetTheory}) → ưu tiên thêm "trac_nghiem".\n`;
      }
      if (sitCount >= targetSit && theoryCount >= targetTheory) {
        prompt +=
          "Vẫn trộn đều cả lý thuyết và tình huống trong batch này.\n";
      }
    }
  }

  if (topicHint?.trim()) {
    prompt += `\nƯu tiên chủ đề: ${topicHint.trim()}\n`;
  }

  if (clinicalCases?.length) {
    prompt +=
      '\n(Tuỳ chọn thêm) Hiện thực các case dưới đây thành câu type "lam_sang" hoặc "tinh_huong":\n';
    clinicalCases.forEach((c, i) => {
      prompt += `[Case ${i + 1}] ${c.situation}`;
      if (c.suggestedQuestion) prompt += ` | Q: ${c.suggestedQuestion}`;
      if (c.expectedAnswer) prompt += ` | A: ${c.expectedAnswer}`;
      prompt += "\n";
    });
  }

  prompt +=
    "\nmeta.hasMore=true nếu còn ý độc lập chưa viết; =false nếu đã hết. Chỉ trả JSON.";
  return prompt;
}

/**
 * Upload tài liệu lên Gemini → sinh/trích đến đủ targetCount câu unique (lọc trùng).
 * Tự đổi API key khi hết quota (GEMINI_API_KEYS / GEMINI_API_KEY_2…).
 */
export async function generateQuestionBankFromFiles(
  sources: SourceDocumentFile[],
  options: GenerateBankOptions,
): Promise<GeminiQuizResult> {
  const keys = requireGeminiApiKeys();
  if (sources.length === 0) {
    throw new AppError(400, "Cần ít nhất 1 tài liệu.");
  }

  const targetCount = Math.max(1, Math.min(500, Math.floor(options.targetCount)));
  const includeSituational = options.includeSituational !== false;
  const difficulty: QuizDifficulty = options.difficulty ?? "trung_binh";
  const topicHint = options.topicHint?.trim() || undefined;
  const promptOpts = { includeSituational, difficulty, topicHint };
  console.info(
    `[gemini] Có ${keys.length} API key · tình huống=${includeSituational} · độ khó=${difficulty}`,
  );

  let keyIdx = 0;
  let clients = createGeminiClients(keys[keyIdx]);
  let sourceParts: ContentPart[] = [];
  let labels: string[] = [];
  let uploadedNames: string[] = [];

  const cleanupUploads = async () => {
    for (const name of uploadedNames) {
      await deleteGeminiFile(clients.fileManager, name);
    }
    uploadedNames = [];
  };

  const uploadSources = async () => {
    await cleanupUploads();
    console.info(
      `[gemini] Upload tài liệu với key ${keyIdx + 1}/${keys.length} (${maskGeminiKey(clients.apiKey)})`,
    );
    const built = await buildSourceParts(sources, clients.fileManager);
    sourceParts = built.parts;
    labels = built.labels;
    uploadedNames = built.uploadedNames;
  };

  const switchToNextKey = async (reason: string) => {
    markGeminiKeyExhausted(clients.apiKey, reason);
    await cleanupUploads();
    keyIdx += 1;
    if (keyIdx >= keys.length) {
      throw new AppError(
        503,
        `Tất cả ${keys.length} Gemini API key đã hết hạn mức. Thêm key vào GEMINI_API_KEYS rồi thử lại.`,
      );
    }
    clients = createGeminiClients(keys[keyIdx]);
    console.warn(
      `[gemini] Đổi sang API key ${keyIdx + 1}/${keys.length} (${maskGeminiKey(clients.apiKey)})`,
    );
    await uploadSources();
  };

  for (;;) {
    try {
      await uploadSources();
      break;
    } catch (err) {
      if (isGeminiKeyExhaustedError(err) && keyIdx + 1 < keys.length) {
        await switchToNextKey(
          err instanceof Error ? err.message : "upload quota",
        );
        continue;
      }
      throw err;
    }
  }

  let mode: DocumentMode = "EXTRACT";
  let modeReason = "";
  let rawMeta: Record<string, unknown> = {};
  let kept: Question[] = [];
  const removedExamples: string[] = [];
  let totalRaw = 0;
  let stalledRounds = 0;

  const maxRounds = Math.min(24, Math.ceil(targetCount / BATCH_SIZE) + 6);

  try {
    for (let round = 0; round < maxRounds; round += 1) {
      const need = targetCount - kept.length;
      if (need <= 0) break;

      console.info(
        `[gemini] batch ${round + 1}/${maxRounds} · có ${kept.length}/${targetCount} · cần thêm ${need} · key#${keyIdx + 1}`,
      );

      const parts: ContentPart[] = [
        { text: buildSystemPrompt(targetCount, promptOpts) },
        ...sourceParts,
        {
          text: buildBatchPrompt({
            labels,
            targetCount,
            already: kept,
            need,
            clinicalCases:
              round === 0 && kept.length === 0
                ? options.clinicalCases
                : undefined,
            isFirst: round === 0 && kept.length === 0,
            includeSituational,
            topicHint,
          }),
        },
      ];

      let result;
      try {
        result = await generateWithModelFallback(
          clients.genAI,
          parts,
          clients.apiKey,
          // Từ batch 2 trở đi / khi đã có câu: ưu tiên paraphrase để tránh RECITATION
          kept.length > 0 || round > 0
            ? { antiRecitation: true, temperature: 0.5 }
            : undefined,
        );
      } catch (err) {
        if (isGeminiKeyExhaustedError(err) && keyIdx + 1 < keys.length) {
          await switchToNextKey(
            err instanceof Error ? err.message : "generate quota",
          );
          round -= 1;
          continue;
        }
        if (isGeminiRecitationError(err)) {
          console.warn(
            `[gemini] RECITATION batch ${round + 1} — thử paraphrase lần nữa…`,
          );
          try {
            result = await generateWithModelFallback(
              clients.genAI,
              [
                ...parts,
                {
                  text: "BẮT BUỘC mode GENERATE: viết câu hỏi mới paraphrase, tuyệt đối không trích nguyên văn tài liệu.",
                },
              ],
              clients.apiKey,
              { antiRecitation: true, temperature: 0.7 },
            );
          } catch (err2) {
            if (kept.length > 0) {
              console.warn(
                `[gemini] RECITATION kéo dài — giữ ${kept.length} câu đã có`,
              );
              rawMeta = {
                ...rawMeta,
                lyDoBankNganHonTarget:
                  `Gemini bị chặn RECITATION khi đọc tài liệu (quá giống nguồn). Đã giữ ${kept.length} câu đã tạo được.`,
              };
              break;
            }
            throw new AppError(
              502,
              "Gemini chặn RECITATION (tài liệu bị coi là nội dung có bản quyền / trích quá sát). Thử upload ít file hơn, hoặc file giáo trình ngắn hơn, rồi tạo lại.",
              { recitation: true },
            );
          }
        } else {
          throw err;
        }
      }

      let text = "";
      let finishReason: string | undefined;
      try {
        ({ text, finishReason } = safeResponseText(result));
      } catch (err) {
        if (isGeminiRecitationError(err) && kept.length > 0) {
          console.warn(
            `[gemini] RECITATION khi đọc response — giữ ${kept.length} câu`,
          );
          rawMeta = {
            ...rawMeta,
            lyDoBankNganHonTarget:
              `Gemini bị chặn RECITATION. Đã giữ ${kept.length} câu đã tạo được.`,
          };
          break;
        }
        if (isGeminiRecitationError(err)) {
          stalledRounds += 1;
          if (stalledRounds >= 3) {
            throw new AppError(
              502,
              "Gemini chặn RECITATION liên tục. Thử ít file / file ngắn hơn.",
              { recitation: true },
            );
          }
          continue;
        }
        throw err;
      }
      if (!text.trim()) {
        stalledRounds += 1;
        if (stalledRounds >= 2) break;
        continue;
      }

      let parsed;
      try {
        parsed = parseGeminiQuizResponse(text);
      } catch (err) {
        if (kept.length > 0) {
          console.warn("[gemini] JSON lỗi mid-run — giữ bank hiện có");
          break;
        }
        throw err;
      }

      if (!modeReason) {
        mode = parsed.mode;
        modeReason = parsed.modeReason;
        rawMeta = parsed.rawMeta;
      }

      totalRaw += parsed.questions.length;
      const before = kept.length;
      const merged = dedupeQuestionBank(
        [...kept, ...parsed.questions],
        mode,
      );
      kept = merged.kept;
      removedExamples.push(...merged.removedExamples);
      const gained = kept.length - before;

      console.info(
        `[gemini] +${gained} unique (raw ${parsed.questions.length}) → ${kept.length}/${targetCount}`,
      );

      const truncated = finishReason === "MAX_TOKENS";
      if (gained === 0 && !truncated) {
        stalledRounds += 1;
      } else {
        stalledRounds = 0;
      }

      if (kept.length >= targetCount) break;
      if (stalledRounds >= 2 && !parsed.hasMore && !truncated) {
        rawMeta = {
          ...rawMeta,
          ...parsed.rawMeta,
          lyDoBankNganHonTarget:
            String(parsed.rawMeta.lyDoBankNganHonTarget ?? "").trim() ||
            `Tài liệu không còn đủ ý độc lập để đạt ${targetCount} câu unique (dừng ở ${kept.length}).`,
        };
        break;
      }
      if (parsed.questions.length === 0 && !truncated) break;
    }
  } finally {
    await cleanupUploads();
  }

  const questionBank = ensureUniqueIds(kept).slice(0, targetCount);
  if (questionBank.length === 0) {
    throw new AppError(
      422,
      "Gemini không trả về câu hỏi hợp lệ từ tài liệu.",
    );
  }

  const soCauPhatHien = Math.max(totalRaw, questionBank.length);
  const soCauSauLocTrungStem = questionBank.length;
  const soCauBoDoTrung = Math.max(0, soCauPhatHien - soCauSauLocTrungStem);
  const shortOfTarget = questionBank.length < targetCount;

  return {
    mode,
    modeReason:
      modeReason ||
      `Tạo ngân hàng mục tiêu ${targetCount} câu từ ${labels.length} tài liệu.`,
    questionBank,
    meta: {
      soCauPhatHien,
      soCauSauLocTrungStem,
      soCauBoDoTrung,
      viDuStemBiLoaiTrung: [...new Set(removedExamples)].slice(0, 8),
      soYDocLap:
        typeof rawMeta.soYDocLap === "number"
          ? rawMeta.soYDocLap
          : questionBank.length,
      lyDoBankNganHonTarget: shortOfTarget
        ? String(rawMeta.lyDoBankNganHonTarget ?? "").trim() ||
          `Chỉ tạo được ${questionBank.length}/${targetCount} câu unique (hết ý độc lập hoặc Gemini dừng sớm).`
        : undefined,
      needsReview:
        mode === "EXTRACT" &&
        soCauPhatHien >= EXTRACT_BANK_REVIEW_THRESHOLD &&
        soCauSauLocTrungStem < EXTRACT_BANK_REVIEW_THRESHOLD,
    },
  };
}

/** Fallback text-only generate. */
export async function generateQuestionBankFromText(
  documentText: string,
  clinicalCases?: ClinicalCaseInput[],
  targetCount = 60,
): Promise<GeminiQuizResult> {
  const fullText = documentText.trim();
  if (!fullText) throw new AppError(422, "Tài liệu trống.");

  // Gói như 1 “file” text tạm qua cùng pipeline options
  const tmp = await fs.mkdtemp(path.join("/tmp", "quiz-text-"));
  const filePath = path.join(tmp, "document.txt");
  await fs.writeFile(filePath, fullText.slice(0, 200_000), "utf8");

  // Dùng mammoth path? Không — generateQuestionBankFromFiles chỉ PDF/DOCX.
  const keys = requireGeminiApiKeys();
  let keyIdx = 0;
  let clients = createGeminiClients(keys[keyIdx]);
  const target = Math.max(1, Math.min(500, targetCount));
  const promptOpts = {
    includeSituational: true,
    difficulty: "trung_binh" as QuizDifficulty,
    topicHint: undefined as string | undefined,
  };
  let kept: Question[] = [];
  let mode: DocumentMode = "GENERATE";
  let modeReason = "GENERATE từ text.";
  let rawMeta: Record<string, unknown> = {};

  try {
    for (let round = 0; round < Math.ceil(target / BATCH_SIZE) + 4; round += 1) {
      const need = target - kept.length;
      if (need <= 0) break;
      let result;
      try {
        result = await generateWithModelFallback(
          clients.genAI,
          [
            { text: buildSystemPrompt(target, promptOpts) },
            {
              text: `Tài liệu:\n"""\n${fullText.slice(0, 200_000)}\n"""\n\n${buildBatchPrompt({
                labels: ["document.txt"],
                targetCount: target,
                already: kept,
                need,
                clinicalCases: round === 0 ? clinicalCases : undefined,
                isFirst: round === 0,
                includeSituational: true,
              })}`,
            },
          ],
          clients.apiKey,
        );
      } catch (err) {
        if (isGeminiKeyExhaustedError(err) && keyIdx + 1 < keys.length) {
          markGeminiKeyExhausted(
            clients.apiKey,
            err instanceof Error ? err.message : "quota",
          );
          keyIdx += 1;
          clients = createGeminiClients(keys[keyIdx]);
          console.warn(
            `[gemini] Text-mode đổi key → #${keyIdx + 1} (${maskGeminiKey(clients.apiKey)})`,
          );
          round -= 1;
          continue;
        }
        throw err;
      }
      const { text } = safeResponseText(result);
      const parsed = parseGeminiQuizResponse(text);
      if (round === 0) {
        mode = parsed.mode;
        modeReason = parsed.modeReason;
        rawMeta = parsed.rawMeta;
      }
      const merged = dedupeQuestionBank([...kept, ...parsed.questions], mode);
      const before = kept.length;
      kept = merged.kept;
      if (kept.length === before) break;
    }
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }

  const questionBank = ensureUniqueIds(kept).slice(0, target);
  return {
    mode,
    modeReason,
    questionBank,
    meta: {
      soCauPhatHien: questionBank.length,
      soCauSauLocTrungStem: questionBank.length,
      soCauBoDoTrung: 0,
      soYDocLap: questionBank.length,
      lyDoBankNganHonTarget:
        questionBank.length < target
          ? String(rawMeta.lyDoBankNganHonTarget ?? "") ||
            `Chỉ tạo được ${questionBank.length}/${target} câu unique.`
          : undefined,
      needsReview: false,
    },
  };
}
