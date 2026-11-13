import { Router } from "express";
import * as documentController from "../controllers/document.controller";
import { authMiddleware } from "../middlewares/auth.middleware";
import {
  uploadDocument,
  uploadDocuments,
} from "../middlewares/upload.middleware";

const router = Router();

router.use(authMiddleware);

router.post("/upload", uploadDocument, documentController.upload);
router.post("/upload-many", uploadDocuments, documentController.uploadMany);
router.get("/", documentController.list);
router.get("/:id", documentController.getOne);
router.delete("/:id", documentController.remove);

export default router;
