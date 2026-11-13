import type { NextFunction, Request, Response } from "express";
import { ok } from "../helpers/http";
import { AppError } from "../middlewares/error.middleware";
import * as authService from "../services/auth.service";

export async function register(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const data = await authService.registerUser(req.body);
    ok(res, data, 201);
  } catch (err) {
    next(err);
  }
}

export async function login(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const data = await authService.loginUser(req.body);
    ok(res, data);
  } catch (err) {
    next(err);
  }
}

export async function me(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.userId) {
      throw new AppError(401, "Chưa đăng nhập.");
    }
    const data = await authService.getMe(req.userId);
    ok(res, data);
  } catch (err) {
    next(err);
  }
}
