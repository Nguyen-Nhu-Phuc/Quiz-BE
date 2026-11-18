import { Schema, model, type HydratedDocument, type Types } from "mongoose";

const userSchema = new Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    /** Có khi đăng ký email/password; optional khi Google. */
    passwordHash: { type: String, required: false },
    name: { type: String, required: true, trim: true },
    googleId: { type: String, sparse: true, unique: true },
    authProvider: {
      type: String,
      enum: ["local", "google"],
      default: "local",
    },
    role: {
      type: String,
      enum: ["user", "admin"],
      default: "user",
    },
    avatarUrl: { type: String },
  },
  { timestamps: true },
);

export type UserDocument = HydratedDocument<{
  email: string;
  passwordHash?: string;
  name: string;
  googleId?: string;
  authProvider: "local" | "google";
  role: "user" | "admin";
  avatarUrl?: string;
  createdAt: Date;
  updatedAt: Date;
  _id: Types.ObjectId;
}>;

export const UserModel = model("User", userSchema);
