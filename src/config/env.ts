import path from "node:path";
import dotenv from "dotenv";

dotenv.config();

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

const nodeEnv = process.env.NODE_ENV ?? "development";
const jwtSecret = required("JWT_SECRET", "dev-only-change-me");

if (
  nodeEnv === "production" &&
  (!process.env.JWT_SECRET || jwtSecret === "dev-only-change-me")
) {
  throw new Error("Production bắt buộc đặt JWT_SECRET mạnh (không dùng mặc định).");
}

function parseGeminiApiKeysExtra(): string[] {
  const raw = process.env.GEMINI_API_KEYS ?? "";
  return raw
    .split(/[\s,;|]+/)
    .map((k) => k.trim())
    .filter(Boolean);
}

function parseAdminEmails(): string[] {
  const raw = process.env.ADMIN_EMAILS ?? "";
  return raw
    .split(/[\s,;|]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

const adminEmails = parseAdminEmails();

if (nodeEnv === "production" && adminEmails.length === 0) {
  throw new Error(
    "Production bắt buộc đặt ADMIN_EMAILS (email admin, cách nhau bởi dấu phẩy).",
  );
}

export const env = {
  port: Number(process.env.PORT ?? 5000),
  mongoUri: required("MONGO_URI", "mongodb://127.0.0.1:27017/quizpractice"),
  jwtSecret,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "7d",
  /** Email được phép vào /admin (đăng nhập tài khoản hoặc Google). */
  adminEmails,
  /** Google OAuth Client ID (GIS / ID token). */
  googleClientId: process.env.GOOGLE_CLIENT_ID?.trim() ?? "",
  /** Key chính (giữ tương thích). */
  geminiApiKey: process.env.GEMINI_API_KEY ?? "",
  /** Key dự phòng — cách nhau bởi dấu phẩy / xuống dòng / `;` / `|`. */
  geminiApiKeys: parseGeminiApiKeysExtra(),
  geminiModel: process.env.GEMINI_MODEL ?? "gemini-3.5-flash",
  clientOrigin: process.env.CLIENT_ORIGIN ?? "http://localhost:3000",
  uploadDir: path.resolve(process.cwd(), process.env.UPLOAD_DIR ?? "uploads"),
  /** 0 hoặc không set = không giới hạn dung lượng file. */
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB ?? 0),
  /**
   * Ngân sách thời gian tạo câu hỏi (giây). Hết giờ dừng sớm, giữ câu đã tạo.
   * Mặc định 180s (3 phút).
   */
  generationTimeBudgetSec: Math.max(
    60,
    Math.min(
      900,
      Number(process.env.GENERATION_TIME_BUDGET_SEC ?? 180) || 180,
    ),
  ),
  nodeEnv,
};
