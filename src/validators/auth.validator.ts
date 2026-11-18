import { z } from "zod";

export const registerSchema = z.object({
  email: z.string().email("Email không hợp lệ"),
  password: z.string().min(6, "Mật khẩu tối thiểu 6 ký tự"),
  name: z.string().min(1, "Tên không được trống").max(120),
});

export const loginSchema = z.object({
  email: z.string().email("Email không hợp lệ"),
  password: z.string().min(1, "Thiếu mật khẩu"),
});

export const googleLoginSchema = z
  .object({
    credential: z.string().min(1).optional(),
    accessToken: z.string().min(1).optional(),
  })
  .refine((v) => Boolean(v.credential || v.accessToken), {
    message: "Thiếu Google credential hoặc accessToken",
  });
