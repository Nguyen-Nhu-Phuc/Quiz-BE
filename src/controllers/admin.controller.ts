import type { NextFunction, Request, Response } from "express";
import {
  clearGeminiKeyExhausted,
  getGeminiKeysQuotaStatus,
  listGeminiApiKeys,
} from "../helpers/geminiKeys";
import { ok } from "../helpers/http";
import * as adminService from "../services/admin.service";
import * as adminManage from "../services/adminManage.service";

export async function login(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const data = await adminService.loginAdminWithPassword(req.body);
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
    const data = await adminService.loginAdminWithGoogle({
      credential: req.body.credential,
      accessToken: req.body.accessToken,
    });
    ok(res, data);
  } catch (err) {
    next(err);
  }
}

export async function getSettings(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const data = await adminService.getAdminSettings();
    ok(res, data);
  } catch (err) {
    next(err);
  }
}

export async function updateSettings(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const data = await adminService.updateAdminSettings({
      geminiApiKey: req.body.geminiApiKey,
      geminiApiKeys: req.body.geminiApiKeys,
      geminiModel: req.body.geminiModel,
      nOnLuyen: req.body.nOnLuyen,
      nPhongThi: req.body.nPhongThi,
      thoiGianPhut: req.body.thoiGianPhut,
      nNganHang: req.body.nNganHang,
    });
    ok(res, data);
  } catch (err) {
    next(err);
  }
}

export async function getOverview(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    ok(res, await adminManage.getOverview());
  } catch (err) {
    next(err);
  }
}

export async function getGeminiQuota(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const probe =
      req.query.probe === "1" ||
      req.query.probe === "true" ||
      req.query.probe === "yes";
    ok(res, await getGeminiKeysQuotaStatus({ probe }));
  } catch (err) {
    next(err);
  }
}

export async function resetGeminiExhausted(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    clearGeminiKeyExhausted();
    ok(res, {
      cleared: true,
      keys: listGeminiApiKeys().length,
      status: await getGeminiKeysQuotaStatus({ probe: false }),
    });
  } catch (err) {
    next(err);
  }
}

export async function listUsers(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    ok(res, await adminManage.listUsers(req.query));
  } catch (err) {
    next(err);
  }
}

export async function setUserRole(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    ok(
      res,
      await adminManage.setUserRole(
        String(req.params.id),
        req.body.role,
        req.userId,
      ),
    );
  } catch (err) {
    next(err);
  }
}

export async function deleteUser(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    ok(
      res,
      await adminManage.deleteUser(String(req.params.id), req.userId),
    );
  } catch (err) {
    next(err);
  }
}

export async function listDocuments(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    ok(res, await adminManage.listDocuments(req.query));
  } catch (err) {
    next(err);
  }
}

export async function deleteDocument(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    ok(
      res,
      await adminManage.deleteDocumentAdmin(String(req.params.id)),
    );
  } catch (err) {
    next(err);
  }
}

export async function listQuizSets(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    ok(res, await adminManage.listQuizSets(req.query));
  } catch (err) {
    next(err);
  }
}

export async function deleteQuizSet(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    ok(
      res,
      await adminManage.deleteQuizSetAdmin(String(req.params.id)),
    );
  } catch (err) {
    next(err);
  }
}

export async function listSessions(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    ok(res, await adminManage.listSessions(req.query));
  } catch (err) {
    next(err);
  }
}

export async function deleteSession(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    ok(
      res,
      await adminManage.deleteSessionAdmin(String(req.params.id)),
    );
  } catch (err) {
    next(err);
  }
}
