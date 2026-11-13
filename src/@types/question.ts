export type AnswerConfidence = "cao" | "trung_binh";

export type QuestionType = "trac_nghiem" | "lam_sang" | string;

export interface Question {
  id: string;
  stem: string;
  choices: [string, string, string, string];
  correctIndex: 0 | 1 | 2 | 3;
  explanation: string;
  topic: string;
  type: QuestionType;
  sourceDe?: string;
  stemNorm: string;
  answerCore?: string;
  answerConfidence?: AnswerConfidence;
}

export type DocumentMode = "EXTRACT" | "GENERATE";

export interface ClinicalCaseInput {
  situation: string;
  suggestedQuestion?: string;
  expectedAnswer?: string;
}

export interface QuizGenerateMeta {
  soCauPhatHien?: number;
  soCauSauLocTrungStem?: number;
  soCauBoDoTrung?: number;
  viDuStemBiLoaiTrung?: string[];
  soYDocLap?: number;
  lyDoBankNganHonTarget?: string;
  nNganHangMin: number;
  needsReview?: boolean;
}

export interface GeminiQuizResult {
  mode: DocumentMode;
  modeReason: string;
  questionBank: Question[];
  meta: Omit<QuizGenerateMeta, "nNganHangMin" | "needsReview"> & {
    needsReview?: boolean;
  };
}

export interface PublicQuestion {
  id: string;
  stem: string;
  choices: [string, string, string, string];
  topic: string;
  type: QuestionType;
  sourceDe?: string;
  /** Chỉ có khi practice đã trả lời hoặc session đã submit */
  correctIndex?: 0 | 1 | 2 | 3;
  explanation?: string;
}
