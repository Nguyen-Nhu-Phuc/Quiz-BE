import type { Request } from "express";
import { AppError } from "../middlewares/error.middleware";

export function paramId(req: Request, name = "id"): string {
  const value = req.params[name];
  const id = Array.isArray(value) ? value[0] : value;
  if (!id) {
    throw new AppError(400, `Thiếu tham số ${name}.`);
  }
  return id;
}
