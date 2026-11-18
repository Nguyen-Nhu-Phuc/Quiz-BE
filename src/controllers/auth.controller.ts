import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env";
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

export async function googleLogin(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const data = await authService.loginWithGoogle({
      credential: req.body.credential,
      accessToken: req.body.accessToken,
    });
    ok(res, data);
  } catch (err) {
    next(err);
  }
}

export async function googleConfig(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    ok(res, {
      enabled: authService.isGoogleAuthConfigured(),
      clientId: env.googleClientId,
    });
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
