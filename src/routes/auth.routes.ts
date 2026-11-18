import { Router } from "express";
import * as authController from "../controllers/auth.controller";
import { authMiddleware } from "../middlewares/auth.middleware";
import { validate } from "../middlewares/validate.middleware";
import {
  googleLoginSchema,
  loginSchema,
  registerSchema,
} from "../validators/auth.validator";

const router = Router();

router.post("/register", validate(registerSchema), authController.register);
router.post("/login", validate(loginSchema), authController.login);
router.post(
  "/google",
  validate(googleLoginSchema),
  authController.googleLogin,
);
router.get("/google/config", authController.googleConfig);
router.get("/me", authMiddleware, authController.me);

export default router;
