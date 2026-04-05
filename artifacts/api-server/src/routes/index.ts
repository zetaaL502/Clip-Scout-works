import { Router, type IRouter } from "express";
import healthRouter from "./health";
import pexelsRouter from "./pexels";
import pixabayRouter from "./pixabay";
import analyzeRouter from "./analyze";
import exportRouter from "./export";
import transfersRouter from "./transfers";
import subtitlesRouter from "./subtitles";
import timestampsRouter from "./timestamps";
import {
  voicesRouter,
  previewVoiceRouter,
  audioGenerationRouter,
  uploadRouter,
  imessageExportRouter,
} from "./imessage";

const router: IRouter = Router();

router.use(healthRouter);
router.use(pexelsRouter);
router.use(pixabayRouter);
router.use(analyzeRouter);
router.use(exportRouter);
router.use(transfersRouter);
router.use(subtitlesRouter);
router.use(timestampsRouter);
router.use(voicesRouter);
router.use(previewVoiceRouter);
router.use(audioGenerationRouter);
router.use(uploadRouter);
router.use(imessageExportRouter);

export default router;
