import { z } from "zod";
import {
  DEFAULT_N_ON_LUYEN,
  DEFAULT_N_PHONG_THI,
  DEFAULT_THOI_GIAN_PHUT,
  MAX_UPLOAD_FILES,
} from "../config/constants";

export const clinicalCaseSchema = z.object({
  situation: z.string().min(1),
  suggestedQuestion: z.string().optional(),
  expectedAnswer: z.string().optional(),
});

export const generateQuizSchema = z
  .object({
    /** Một tài liệu (tương thích cũ). */
    documentId: z.string().min(1).optional(),
    /** Nhiều tài liệu → ghép text → 1 bank. */
    documentIds: z.array(z.string().min(1)).min(1).max(MAX_UPLOAD_FILES).optional(),
    title: z.string().min(1).max(200).optional(),
    // coerce: phòng FE gửi string/null từ InputNumber
    nOnLuyen: z.coerce
      .number()
      .int()
      .min(1)
      .max(500)
      .default(DEFAULT_N_ON_LUYEN),
    nPhongThi: z.coerce
      .number()
      .int()
      .min(1)
      .max(500)
      .default(DEFAULT_N_PHONG_THI),
    thoiGianPhut: z.coerce
      .number()
      .int()
      .min(1)
      .max(300)
      .default(DEFAULT_THOI_GIAN_PHUT),
    /** Số câu UNIQUE muốn có trong ngân hàng (Gemini sinh/trích đến đủ). */
    nNganHang: z.coerce.number().int().min(1).max(500).optional(),
    /** Trộn câu hỏi tình huống kiểu NotebookLM (mặc định true). */
    includeSituational: z.coerce.boolean().optional().default(true),
    difficulty: z.enum(["de", "trung_binh", "kho"]).optional().default("trung_binh"),
    /** Gợi ý chủ đề / prompt thêm cho Gemini. */
    topicHint: z.string().max(500).optional(),
    clinicalCases: z.array(clinicalCaseSchema).max(20).optional(),
  })
  .refine((v) => Boolean(v.documentId) || (v.documentIds?.length ?? 0) > 0, {
    message: "Cần documentId hoặc documentIds.",
    path: ["documentIds"],
  });
