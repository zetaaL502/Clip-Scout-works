import { Router, type IRouter } from "express";
import healthRouter from "./health";
import pexelsRouter from "./pexels";
import pixabayRouter from "./pixabay";
import analyzeRouter from "./analyze";
import exportRouter from "./export";
import transfersRouter from "./transfers";
import subtitlesRouter from "./subtitles";
import timestampsRouter from "./timestamps";
import competitorsRouter from "./competitors";
import {
  voicesRouter,
  previewVoiceRouter,
  audioGenerationRouter,
  uploadRouter,
  imessageExportRouter,
  videoExportRouter,
} from "./imessage";
import {
  conversationGenerateRouter,
  conversationUploadRouter,
} from "./conversation";
import youtubeRouter from "./youtube/channels";
import youtubeSearchRouter from "./youtube/search";

const router: IRouter = Router();

router.use(healthRouter);
router.use(pexelsRouter);
router.use(pixabayRouter);
router.use("/analyze", analyzeRouter);
router.use(exportRouter);
router.use(transfersRouter);
router.use(subtitlesRouter);
router.use(timestampsRouter);
router.use("/competitors", competitorsRouter);
router.use(voicesRouter);
router.use(previewVoiceRouter);
router.use(audioGenerationRouter);
router.use(uploadRouter);
router.use(imessageExportRouter);
router.use(videoExportRouter);
router.use(conversationGenerateRouter);
router.use(conversationUploadRouter);
router.use("/youtube", youtubeRouter);
router.use("/youtube", youtubeSearchRouter);

export default router;
