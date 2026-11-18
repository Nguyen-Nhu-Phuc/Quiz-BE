import { z } from "zod";

export const adminLoginSchema = z.object({
  email: z.string().email("Email không hợp lệ"),
  password: z.string().min(1, "Thiếu mật khẩu"),
});

export const adminGoogleLoginSchema = z
  .object({
    credential: z.string().min(1).optional(),
    accessToken: z.string().min(1).optional(),
  })
  .refine((v) => Boolean(v.credential || v.accessToken), {
    message: "Thiếu Google credential hoặc accessToken",
  });

export const updateAdminSettingsSchema = z.object({
  geminiApiKey: z.string().optional(),
  geminiApiKeys: z.string().optional(),
  geminiModel: z.string().max(120).optional(),
  nOnLuyen: z.coerce.number().int().min(1).max(500).optional(),
  nPhongThi: z.coerce.number().int().min(1).max(500).optional(),
  thoiGianPhut: z.coerce.number().int().min(1).max(300).optional(),
  nNganHang: z.coerce.number().int().min(1).max(500).optional(),
});

export const adminListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  q: z.string().max(200).optional(),
});

export const adminSetUserRoleSchema = z.object({
  role: z.enum(["user", "admin"]),
});

export const adminIdParamSchema = z.object({
  id: z.string().min(1),
});
