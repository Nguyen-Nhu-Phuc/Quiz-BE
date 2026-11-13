import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { AppError } from "../middlewares/error.middleware";
import { UserModel } from "../models/User.model";

function signToken(userId: string): string {
  return jwt.sign({ sub: userId }, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn as jwt.SignOptions["expiresIn"],
  });
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

  const token = signToken(user._id.toString());
  return {
    token,
    user: { id: user._id.toString(), email: user.email, name: user.name },
  };
}

export async function loginUser(input: { email: string; password: string }) {
  const email = input.email.toLowerCase().trim();
  const user = await UserModel.findOne({ email });
  if (!user) {
    throw new AppError(401, "Email hoặc mật khẩu không đúng.");
  }

  const ok = await bcrypt.compare(input.password, user.passwordHash);
  if (!ok) {
    throw new AppError(401, "Email hoặc mật khẩu không đúng.");
  }

  const token = signToken(user._id.toString());
  return {
    token,
    user: { id: user._id.toString(), email: user.email, name: user.name },
  };
}

export async function getMe(userId: string) {
  const user = await UserModel.findById(userId).select("email name createdAt");
  if (!user) {
    throw new AppError(404, "Không tìm thấy người dùng.");
  }
  return {
    id: user._id.toString(),
    email: user.email,
    name: user.name,
    createdAt: user.createdAt,
  };
}
