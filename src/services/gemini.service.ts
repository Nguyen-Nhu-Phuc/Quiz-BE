import fs from "node:fs/promises";
import path from "node:path";
import { GoogleGenerativeAI } from "@google/generative-ai";
import mammoth from "mammoth";
import type {
  ClinicalCaseInput,
  DocumentMode,
  GeminiQuizResult,
  Question,
} from "../@types/question";
import { EXTRACT_BANK_REVIEW_THRESHOLD } from "../config/constants";
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
  markGeminiKeyExhausted,
  maskGeminiKey,
  requireGeminiApiKeys,
} from "../helpers/geminiKeys";
import { extractJsonLoose } from "../helpers/jsonRepair";
import { AppError } from "../middlewares/error.middleware";
import { dedupeQuestionBank, sanitizeQuestion } from "./dedupe.service";
import type { GoogleAIFileManager } from "@google/generative-ai/server";

const BATCH_SIZE = 40;

function buildSystemPrompt(targetCount: number): string {
  return `Bạn là gia sư ôn luyện. Đọc kỹ TÀI LIỆU ĐÍNH KÈM và trả về JSON ngân hàng câu hỏi trắc nghiệm.

## MỤC TIÊU SỐ LƯỢNG
- Người dùng yêu cầu khoảng ${targetCount} câu UNIQUE (stem khác nhau rõ).
- Mỗi lần trả tối đa ${BATCH_SIZE} câu. Nếu chưa đủ sẽ được gọi tiếp.
- ZERO_NEAR_DUPLICATE: CẤM trùng stem / biến thể wording gần / chỉ đổi mã số / xáo choices.
- CẤM clone khuôn câu chỉ đổi vài từ để đủ số. Mỗi câu phải hỏi ý khác nhau từ tài liệu.
- Không để stem trống. PDF scan: đọc/OCR chữ rồi mới trích/sinh.

## MODE
1. Tài liệu đã là đề/trắc nghiệm (nhiều Câu N + A/B/C/D) → EXTRACT: trích tối đa câu có sẵn.
2. Giáo trình/bài giảng → GENERATE: viết câu mới phủ kiến thức; vẫn cố gắng đạt ${targetCount} câu unique nếu tài liệu đủ nội dung.
3. Nếu tài liệu không đủ ý độc lập để đạt ${targetCount}, trả hết câu unique được và meta.hasMore=false + lyDoBankNganHonTarget.

## Schema mỗi câu
id, stem (không rỗng), choices[4], correctIndex (0-3), explanation, topic, type ("trac_nghiem"|"lam_sang")

## CASE LÂM SÀNG (BẮT BUỘC — do bạn tự tạo)
- Luôn tự viết câu type "lam_sang" dựa trên kiến thức / tình huống trong tài liệu đính kèm.
- Không chờ người dùng cung cấp case. Tự dựng tình huống lâm sàng ngắn (bệnh nhân, bối cảnh, dấu hiệu) rồi hỏi quyết định/kiến thức liên quan tài liệu.
- Stem = tình huống + câu hỏi; 4 đáp án; explanation bám tài liệu.
- Tỷ lệ gợi ý: khoảng 15–25% bank là "lam_sang" (còn lại "trac_nghiem"), miễn là nội dung tài liệu cho phép; không pad clone để đủ tỷ lệ.
- EXTRACT: giữ câu gốc; vẫn bổ sung thêm case lâm sàng mới (type lam_sang) từ kiến thức trong tài liệu nếu chưa có sẵn — không đè / không viết lại câu đã extract.
- Mỗi case phải stem khác rõ; ZERO_NEAR_DUPLICATE áp dụng cả lam_sang.

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

const FALLBACK_MODELS = [
  "gemini-3.5-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-flash-latest",
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
};

type ContentPart =
  | { text: string }
  | { fileData: { mimeType: string; fileUri: string } };

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function modelCandidates(): string[] {
  const preferred = env.geminiModel?.trim();
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

function safeResponseText(result: {
  response: {
    text: () => string;
    candidates?: Array<{ finishReason?: string }>;
    promptFeedback?: { blockReason?: string };
  };
}): { text: string; finishReason?: string } {
  const finishReason = result.response.candidates?.[0]?.finishReason;
  const block = result.response.promptFeedback?.blockReason;
  if (block) {
    throw new AppError(422, `Gemini chặn nội dung (${block}).`);
  }
  try {
    return { text: result.response.text() ?? "", finishReason };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
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
) {
  let lastErr: unknown;
  for (const modelName of modelCandidates()) {
    const model = genAI.getGenerativeModel({
      model: modelName,
      generationConfig: {
        temperature: 0.25,
        responseMimeType: "application/json",
        maxOutputTokens: 8192,
      },
    });

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const result = await model.generateContent(parts);
        if (modelName !== env.geminiModel) {
          console.info(`[gemini] OK với model=${modelName}`);
        }
        return result;
      } catch (err) {
        lastErr = err;
        const msg = err instanceof Error ? err.message : String(err);
        if (isGeminiKeyExhaustedError(err)) {
          if (apiKey) markGeminiKeyExhausted(apiKey, msg);
          throw toGeminiAppError(err, "Gemini generate");
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
}): string {
  const { labels, targetCount, already, need, clinicalCases, isFirst } = input;
  let prompt = `Tài liệu đính kèm (${labels.length}): ${labels.join(", ")}.\n`;
  prompt += `Mục tiêu ngân hàng: ${targetCount} câu UNIQUE.\n`;
  prompt += `Đã có: ${already.length} câu unique. Lần này hãy trả thêm tối đa ${Math.min(BATCH_SIZE, need)} câu MỚI (stem khác rõ các câu đã có).\n`;

  if (already.length > 0) {
    prompt += `\nTránh trùng các stem gần đây:\n${stemAvoidList(already)}\n`;
  }

  if (isFirst) {
    prompt +=
      "\nChọn EXTRACT hoặc GENERATE đúng loại tài liệu. Quét HẾT nội dung đính kèm.\n";
    prompt +=
      'Bắt buộc tự tạo sẵn một phần câu type "lam_sang" (case lâm sàng) từ nội dung tài liệu — không chờ case người dùng.\n';
  } else {
    prompt +=
      "\nTiếp tục bổ sung câu mới từ phần chưa khai thác / góc hỏi khác. Không lặp ý đã có.\n";
    const lamSangCount = already.filter((q) => q.type === "lam_sang").length;
    const targetLamSang = Math.max(2, Math.round(targetCount * 0.2));
    if (lamSangCount < targetLamSang) {
      prompt += `Ưu tiên thêm case lâm sàng type "lam_sang" (hiện ${lamSangCount}/${targetLamSang} gợi ý) nếu còn tình huống độc lập từ tài liệu.\n`;
    }
  }

  if (clinicalCases?.length) {
    prompt +=
      '\n(Tuỳ chọn thêm) Ưu tiên hiện thực các case người dùng dưới đây thành câu type "lam_sang" (vẫn được tự tạo thêm case khác):\n';
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
  console.info(`[gemini] Có ${keys.length} API key khả dụng`);

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
        { text: buildSystemPrompt(targetCount) },
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
          }),
        },
      ];

      let result;
      try {
        result = await generateWithModelFallback(
          clients.genAI,
          parts,
          clients.apiKey,
        );
      } catch (err) {
        if (isGeminiKeyExhaustedError(err) && keyIdx + 1 < keys.length) {
          await switchToNextKey(
            err instanceof Error ? err.message : "generate quota",
          );
          round -= 1;
          continue;
        }
        throw err;
      }

      const { text, finishReason } = safeResponseText(result);
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
            { text: buildSystemPrompt(target) },
            {
              text: `Tài liệu:\n"""\n${fullText.slice(0, 200_000)}\n"""\n\n${buildBatchPrompt({
                labels: ["document.txt"],
                targetCount: target,
                already: kept,
                need,
                clinicalCases: round === 0 ? clinicalCases : undefined,
                isFirst: round === 0,
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
