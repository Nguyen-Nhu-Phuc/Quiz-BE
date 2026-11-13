import type { NextFunction, Request, Response } from "express";
import { ok } from "../helpers/http";
import { paramId } from "../helpers/params";
import { AppError } from "../middlewares/error.middleware";
import * as sessionService from "../services/session.service";

function requireUser(req: Request) {
  if (!req.userObjectId) {
    throw new AppError(401, "Chưa đăng nhập.");
  }
  return req.userObjectId;
}

export async function create(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = requireUser(req);
    const data = await sessionService.createSession({
      userId,
      quizSetId: req.body.quizSetId,
      kind: req.body.kind,
      nCau: req.body.nCau,
      thoiGianPhut: req.body.thoiGianPhut,
    });
    ok(res, data, 201);
  } catch (err) {
    next(err);
  }
}

export async function list(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = requireUser(req);
    const data = await sessionService.listSessions(userId);
    ok(res, data);
  } catch (err) {
    next(err);
  }
}

export async function getOne(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = requireUser(req);
    const data = await sessionService.getSessionForUser(paramId(req), userId);
    ok(res, data);
  } catch (err) {
    next(err);
  }
}

export async function answer(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = requireUser(req);
    const data = await sessionService.answerQuestion({
      sessionId: paramId(req),
      userId,
      questionId: req.body.questionId,
      selectedIndex: req.body.selectedIndex,
    });
    ok(res, data);
  } catch (err) {
    next(err);
  }
}

export async function submit(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = requireUser(req);
    const data = await sessionService.submitSession(paramId(req), userId);
    ok(res, data);
  } catch (err) {
    next(err);
  }
}

export async function retryWrong(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = requireUser(req);
    const data = await sessionService.retryWrong(paramId(req), userId);
    ok(res, data, 201);
  } catch (err) {
    next(err);
  }
}

export async function redo(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = requireUser(req);
    const data = await sessionService.redoSession(paramId(req), userId);
    ok(res, data, 201);
  } catch (err) {
    next(err);
  }
}
