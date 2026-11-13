import { Router } from "express";
import * as sessionController from "../controllers/session.controller";
import { authMiddleware } from "../middlewares/auth.middleware";
import { validate } from "../middlewares/validate.middleware";
import {
  answerSchema,
  createSessionSchema,
} from "../validators/session.validator";

const router = Router();

router.use(authMiddleware);

router.post("/", validate(createSessionSchema), sessionController.create);
router.get("/", sessionController.list);
router.get("/:id", sessionController.getOne);
router.post(
  "/:id/answer",
  validate(answerSchema),
  sessionController.answer,
);
router.post("/:id/submit", sessionController.submit);
router.post("/:id/retry-wrong", sessionController.retryWrong);
router.post("/:id/redo", sessionController.redo);

export default router;
