import type { NextFunction, Request, Response } from "express";
import { ok } from "../helpers/http";
import { paramId } from "../helpers/params";
import { AppError } from "../middlewares/error.middleware";
import * as quizService from "../services/quiz.service";

function requireUser(req: Request) {
  if (!req.userObjectId) {
    throw new AppError(401, "Chưa đăng nhập.");
  }
  return req.userObjectId;
}

export async function generate(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = requireUser(req);
    const data = await quizService.generateQuizSet({
      userId,
      documentId: req.body.documentId,
      documentIds: req.body.documentIds,
      title: req.body.title,
      nOnLuyen: req.body.nOnLuyen,
      nPhongThi: req.body.nPhongThi,
      thoiGianPhut: req.body.thoiGianPhut,
      nNganHang: req.body.nNganHang,
      includeSituational: req.body.includeSituational,
      difficulty: req.body.difficulty,
      topicHint: req.body.topicHint,
      clinicalCases: req.body.clinicalCases,
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
    const data = await quizService.listQuizSets(userId);
    ok(res, data);
  } catch (err) {
    next(err);
  }
}

export async function getSummary(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = requireUser(req);
    const data = await quizService.getQuizSummary(paramId(req), userId);
    ok(res, data);
  } catch (err) {
    next(err);
  }
}

export async function getBank(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = requireUser(req);
    const data = await quizService.getQuizBank(paramId(req), userId);
    ok(res, data);
  } catch (err) {
    next(err);
  }
}

export async function remove(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = requireUser(req);
    const data = await quizService.deleteQuizSet(paramId(req), userId);
    ok(res, data);
  } catch (err) {
    next(err);
  }
}
