import bcrypt from "bcryptjs";
import { OAuth2Client } from "google-auth-library";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { syncAdminRole } from "../helpers/adminEmails";
import { AppError } from "../middlewares/error.middleware";
import { UserModel } from "../models/User.model";

export type UserRole = "user" | "admin";

function signToken(userId: string, role: UserRole): string {
  return jwt.sign({ sub: userId, role }, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn as jwt.SignOptions["expiresIn"],
  });
}

function toAuthUser(user: {
  _id: { toString(): string };
  email: string;
  name: string;
  role?: UserRole;
  createdAt?: Date;
}) {
  return {
    id: user._id.toString(),
    email: user.email,
    name: user.name,
    role: (user.role ?? "user") as UserRole,
    createdAt: user.createdAt,
  };
}

export async function registerUser(input: {
  email: string;
  password: string;
  name: string;
}) {
  const email = input.email.toLowerCase().trim();
  const exists = await UserModel.findOne({ email });
  if (exists) {
    throw new AppError(409, "Email đã được sử dụng.");
  }

  const passwordHash = await bcrypt.hash(input.password, 10);
  const user = await UserModel.create({
    email,
    passwordHash,
    name: input.name.trim(),
  });
  const role = await syncAdminRole(user);

  const token = signToken(user._id.toString(), role);
  return {
    token,
    user: toAuthUser({ ...user.toObject(), role }),
  };
}

export async function loginUser(input: { email: string; password: string }) {
  const email = input.email.toLowerCase().trim();
  const user = await UserModel.findOne({ email });
  if (!user) {
    throw new AppError(401, "Email hoặc mật khẩu không đúng.");
  }

  if (!user.passwordHash) {
    throw new AppError(
      401,
      "Tài khoản này đăng nhập bằng Google. Hãy dùng nút “Đăng nhập với Google”.",
    );
  }

  const ok = await bcrypt.compare(input.password, user.passwordHash);
  if (!ok) {
    throw new AppError(401, "Email hoặc mật khẩu không đúng.");
  }

  const role = await syncAdminRole(user);
  const token = signToken(user._id.toString(), role);
  return {
    token,
    user: toAuthUser({ ...user.toObject(), role }),
  };
}

type GoogleProfile = {
  email: string;
  googleId: string;
  name: string;
  avatarUrl?: string;
};

async function profileFromIdToken(credential: string): Promise<GoogleProfile> {
  const client = new OAuth2Client(env.googleClientId);
  let payload;
  try {
    const ticket = await client.verifyIdToken({
      idToken: credential,
      audience: env.googleClientId,
    });
    payload = ticket.getPayload();
  } catch {
    throw new AppError(401, "Google credential không hợp lệ hoặc đã hết hạn.");
  }

  if (!payload?.email || !payload.sub) {
    throw new AppError(401, "Google không trả đủ thông tin tài khoản.");
  }
  if (payload.email_verified === false) {
    throw new AppError(401, "Email Google chưa được xác minh.");
  }

  const email = payload.email.toLowerCase().trim();
  return {
    email,
    googleId: payload.sub,
    name: (
      payload.name ||
      payload.given_name ||
      email.split("@")[0] ||
      "User"
    ).trim(),
    avatarUrl: payload.picture || undefined,
  };
}

async function profileFromAccessToken(
  accessToken: string,
): Promise<GoogleProfile> {
  let res: Response;
  try {
    res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch {
    throw new AppError(401, "Không xác minh được Google access token.");
  }
  if (!res.ok) {
    throw new AppError(401, "Google access token không hợp lệ hoặc đã hết hạn.");
  }
  const data = (await res.json()) as {
    sub?: string;
    email?: string;
    email_verified?: boolean | string;
    name?: string;
    given_name?: string;
    picture?: string;
  };
  if (!data.email || !data.sub) {
    throw new AppError(401, "Google không trả đủ thông tin tài khoản.");
  }
  if (data.email_verified === false || data.email_verified === "false") {
    throw new AppError(401, "Email Google chưa được xác minh.");
  }
  const email = data.email.toLowerCase().trim();
  return {
    email,
    googleId: data.sub,
    name: (data.name || data.given_name || email.split("@")[0] || "User").trim(),
    avatarUrl: data.picture || undefined,
  };
}

async function upsertGoogleUser(profile: GoogleProfile) {
  let user = await UserModel.findOne({
    $or: [{ googleId: profile.googleId }, { email: profile.email }],
  });

  if (user) {
    if (!user.googleId) {
      user.googleId = profile.googleId;
      user.authProvider = user.passwordHash ? user.authProvider : "google";
      if (profile.avatarUrl) user.avatarUrl = profile.avatarUrl;
      await user.save();
    }
  } else {
    user = await UserModel.create({
      email: profile.email,
      name: profile.name,
      googleId: profile.googleId,
      authProvider: "google",
      avatarUrl: profile.avatarUrl,
    });
  }

  const role = await syncAdminRole(user);
  const token = signToken(user._id.toString(), role);
  return {
    token,
    user: toAuthUser({ ...user.toObject(), role }),
  };
}

/** Đăng nhập / đăng ký bằng Google (ID token hoặc OAuth access token). */
export async function loginWithGoogle(input: {
  credential?: string;
  accessToken?: string;
}) {
  if (!env.googleClientId) {
    throw new AppError(
      503,
      "Chưa cấu hình GOOGLE_CLIENT_ID. Không thể đăng nhập Google.",
    );
  }

  const profile = input.credential
    ? await profileFromIdToken(input.credential)
    : input.accessToken
      ? await profileFromAccessToken(input.accessToken)
      : null;

  if (!profile) {
    throw new AppError(400, "Thiếu Google credential hoặc accessToken.");
  }

  return upsertGoogleUser(profile);
}

export async function getMe(userId: string) {
  const user = await UserModel.findById(userId).select(
    "email name role createdAt",
  );
  if (!user) {
    throw new AppError(404, "Không tìm thấy người dùng.");
  }
  const role = await syncAdminRole(user);
  return toAuthUser({ ...user.toObject(), role });
}

export function isGoogleAuthConfigured(): boolean {
  return Boolean(env.googleClientId);
}
