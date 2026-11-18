import { env } from "../config/env";

export function isAdminEmail(email: string): boolean {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;
  return env.adminEmails.includes(normalized);
}

/**
 * Đồng bộ role:
 * - Email trong ADMIN_EMAILS → luôn admin
 * - Email khác → giữ role hiện tại (admin có thể promote qua UI)
 */
export async function syncAdminRole(user: {
  email: string;
  role?: string;
  save: () => Promise<unknown>;
}): Promise<"user" | "admin"> {
  if (isAdminEmail(user.email)) {
    if (user.role !== "admin") {
      (user as { role: "user" | "admin" }).role = "admin";
      await user.save();
    }
    return "admin";
  }
  return user.role === "admin" ? "admin" : "user";
}
