import type { DocumentMode, Question } from "../@types/question";
import { normalizeStem, tokenOverlapRatio } from "../helpers/stemNorm";

export interface DedupeResult {
  kept: Question[];
  removedExamples: string[];
  soCauPhatHien: number;
  soCauSauLocTrungStem: number;
  soCauBoDoTrung: number;
}

function normalizeAnswerCore(q: Question): string {
  if (q.answerCore?.trim()) {
    return q.answerCore.toLowerCase().normalize("NFC").replace(/\s+/g, " ").trim();
  }
  const choice = q.choices[q.correctIndex] ?? "";
  return choice.toLowerCase().normalize("NFC").replace(/\s+/g, " ").trim();
}

function isNearDuplicate(a: Question, b: Question, mode: DocumentMode): boolean {
  const sa = a.stemNorm || normalizeStem(a.stem);
  const sb = b.stemNorm || normalizeStem(b.stem);

  if (sa === sb) return true;

  const overlap = tokenOverlapRatio(sa, sb);
  if (overlap >= 0.82) return true;

  const aa = normalizeAnswerCore(a);
  const ab = normalizeAnswerCore(b);

  // GENERATE: khung câu gần giống + cùng answerCore → clone topic đuôi
  if (mode === "GENERATE" && aa && aa === ab && overlap >= 0.65) {
    return true;
  }
  // Cùng đáp án chữ + stem ngắn gần nhau
  if (aa && aa === ab && overlap >= 0.75) {
    return true;
  }

  return false;
}

/**
 * Lọc trùng ZERO_NEAR_DUPLICATE.
 * Chỉ loại trùng stem / biến thể gần — KHÔNG gộp theo conceptKey / “mỗi khái niệm 1 câu”.
 */
export function dedupeQuestionBank(
  questions: Question[],
  mode: DocumentMode,
): DedupeResult {
  const soCauPhatHien = questions.length;
  const kept: Question[] = [];
  const removedExamples: string[] = [];

  for (const raw of questions) {
    const q: Question = {
      ...raw,
      stemNorm: raw.stemNorm?.trim()
        ? raw.stemNorm
        : normalizeStem(raw.stem),
    };

    const dupOf = kept.find((k) => isNearDuplicate(k, q, mode));
    if (dupOf) {
      if (removedExamples.length < 8) {
        removedExamples.push(q.stem.slice(0, 160));
      }
      continue;
    }
    kept.push(q);
  }

  return {
    kept,
    removedExamples,
    soCauPhatHien,
    soCauSauLocTrungStem: kept.length,
    soCauBoDoTrung: soCauPhatHien - kept.length,
  };
}

/** Validate & chuẩn hóa 1 câu từ Gemini. Trả null nếu không hợp lệ. */
export function sanitizeQuestion(raw: unknown, index: number): Question | null {
  if (!raw || typeof raw !== "object") return null;
  const q = raw as Record<string, unknown>;

  const stem = String(q.stem ?? "").trim();
  const choicesRaw = Array.isArray(q.choices) ? q.choices.map(String) : [];
  if (!stem || choicesRaw.length !== 4) return null;
  if (choicesRaw.some((c) => !c.trim())) return null;

  let correctIndex = Number(q.correctIndex);
  if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex > 3) {
    return null;
  }

  const explanation = String(q.explanation ?? "").trim() || "Theo nội dung tài liệu.";
  const id = String(q.id ?? `q-${index + 1}`).trim() || `q-${index + 1}`;

  return {
    id,
    stem,
    choices: choicesRaw as [string, string, string, string],
    correctIndex: correctIndex as 0 | 1 | 2 | 3,
    explanation,
    topic: String(q.topic ?? "").trim(),
    type: String(q.type ?? "trac_nghiem").trim() || "trac_nghiem",
    sourceDe: q.sourceDe ? String(q.sourceDe) : undefined,
    stemNorm: normalizeStem(stem),
    answerCore: q.answerCore ? String(q.answerCore) : undefined,
    answerConfidence:
      q.answerConfidence === "cao" || q.answerConfidence === "trung_binh"
        ? q.answerConfidence
        : undefined,
  };
}
