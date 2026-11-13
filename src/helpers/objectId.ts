import { Types } from "mongoose";
import { AppError } from "../middlewares/error.middleware";

export function requireObjectId(id: string, label = "id"): Types.ObjectId {
  if (!Types.ObjectId.isValid(id)) {
    throw new AppError(400, `${label} không hợp lệ.`);
  }
  return new Types.ObjectId(id);
}
