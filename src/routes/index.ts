import { Router } from "express";
import authRoutes from "./auth.routes";
import documentRoutes from "./document.routes";
import quizRoutes from "./quiz.routes";
import sessionRoutes from "./session.routes";

const router = Router();

router.get("/health", (_req, res) => {
  res.json({ success: true, data: { status: "ok" } });
});

router.use("/auth", authRoutes);
router.use("/documents", documentRoutes);
router.use("/quizzes", quizRoutes);
router.use("/sessions", sessionRoutes);

export default router;
