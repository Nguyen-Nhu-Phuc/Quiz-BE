import { Schema, model, type HydratedDocument, type Types } from "mongoose";

const documentSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    originalName: { type: String, required: true },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },
    storagePath: { type: String, required: true },
    extractedTextPreview: { type: String },
    status: {
      type: String,
      enum: ["uploaded", "processing", "ready", "failed"],
      default: "uploaded",
    },
    errorMessage: { type: String },
  },
  { timestamps: true },
);

export type DocumentDocument = HydratedDocument<{
  userId: Types.ObjectId;
  originalName: string;
  mimeType: string;
  size: number;
  storagePath: string;
  extractedTextPreview?: string;
  status: "uploaded" | "processing" | "ready" | "failed";
  errorMessage?: string;
  createdAt: Date;
  updatedAt: Date;
  _id: Types.ObjectId;
}>;

export const DocumentModel = model("Document", documentSchema);
