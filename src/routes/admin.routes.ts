import { Router } from "express";
import * as adminController from "../controllers/admin.controller";
import { adminAuthMiddleware } from "../middlewares/adminAuth.middleware";
import { validate } from "../middlewares/validate.middleware";
import {
  adminGeminiKeyBodySchema,
  adminGeminiKeyIndexSchema,
  adminGoogleLoginSchema,
  adminIdParamSchema,
  adminListQuerySchema,
  adminLoginSchema,
  adminSetUserRoleSchema,
  updateAdminSettingsSchema,
} from "../validators/admin.validator";

const router = Router();

router.post("/login", validate(adminLoginSchema), adminController.login);
router.post(
  "/google",
  validate(adminGoogleLoginSchema),
  adminController.googleLogin,
);

router.use(adminAuthMiddleware);

router.get("/settings", adminController.getSettings);
router.put(
  "/settings",
  validate(updateAdminSettingsSchema),
  adminController.updateSettings,
);

router.get("/gemini-keys", adminController.listGeminiKeys);
router.post(
  "/gemini-keys",
  validate(adminGeminiKeyBodySchema),
  adminController.addGeminiKey,
);
router.put(
  "/gemini-keys/:index",
  validate(adminGeminiKeyIndexSchema, "params"),
  validate(adminGeminiKeyBodySchema),
  adminController.updateGeminiKey,
);
router.delete(
  "/gemini-keys/:index",
  validate(adminGeminiKeyIndexSchema, "params"),
  adminController.deleteGeminiKey,
);

router.get("/overview", adminController.getOverview);
router.get("/gemini-quota", adminController.getGeminiQuota);
router.post("/gemini-quota/reset-exhausted", adminController.resetGeminiExhausted);

router.get(
  "/users",
  validate(adminListQuerySchema, "query"),
  adminController.listUsers,
);
router.patch(
  "/users/:id/role",
  validate(adminIdParamSchema, "params"),
  validate(adminSetUserRoleSchema),
  adminController.setUserRole,
);
router.delete(
  "/users/:id",
  validate(adminIdParamSchema, "params"),
  adminController.deleteUser,
);

router.get(
  "/documents",
  validate(adminListQuerySchema, "query"),
  adminController.listDocuments,
);
router.delete(
  "/documents/:id",
  validate(adminIdParamSchema, "params"),
  adminController.deleteDocument,
);

router.get(
  "/quizzes",
  validate(adminListQuerySchema, "query"),
  adminController.listQuizSets,
);
router.delete(
  "/quizzes/:id",
  validate(adminIdParamSchema, "params"),
  adminController.deleteQuizSet,
);

router.get(
  "/sessions",
  validate(adminListQuerySchema, "query"),
  adminController.listSessions,
);
router.delete(
  "/sessions/:id",
  validate(adminIdParamSchema, "params"),
  adminController.deleteSession,
);

export default router;
