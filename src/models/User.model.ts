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
    passwordHash: { type: String, required: true },
    name: { type: String, required: true, trim: true },
  },
  { timestamps: true },
);

export type UserDocument = HydratedDocument<{
  email: string;
  passwordHash: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  _id: Types.ObjectId;
}>;

export const UserModel = model("User", userSchema);
