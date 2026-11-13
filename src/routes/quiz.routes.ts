import { Router } from "express";
import * as quizController from "../controllers/quiz.controller";
import { authMiddleware } from "../middlewares/auth.middleware";
import { rateLimit } from "../middlewares/rateLimit.middleware";
import { validate } from "../middlewares/validate.middleware";
import { generateQuizSchema } from "../validators/quiz.validator";

const router = Router();

router.use(authMiddleware);

router.post(
  "/generate",
  rateLimit({ keyPrefix: "quiz-generate", windowMs: 15 * 60_000, max: 5 }),
  validate(generateQuizSchema),
  quizController.generate,
);
router.get("/", quizController.list);
router.get("/:id/summary", quizController.getSummary);
router.get("/:id", quizController.getBank);
router.delete("/:id", quizController.remove);

export default router;
