import { z } from "zod";

export const createSessionSchema = z.object({
  quizSetId: z.string().min(1),
  kind: z.enum(["practice", "exam"]),
  nCau: z.coerce.number().int().min(1).max(500).optional(),
  thoiGianPhut: z.coerce.number().int().min(1).max(300).optional(),
});

export const answerSchema = z.object({
  questionId: z.string().min(1),
  selectedIndex: z.coerce.number().int().min(0).max(3),
});
