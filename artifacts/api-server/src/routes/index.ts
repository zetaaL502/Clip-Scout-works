import { Router, type IRouter } from "express";
import healthRouter from "./health";
import pexelsRouter from "./pexels";
import pixabayRouter from "./pixabay";
import analyzeRouter from "./analyze";
import exportRouter from "./export";
import transfersRouter from "./transfers";
import subtitlesRouter from "./subtitles";

const router: IRouter = Router();

router.use(healthRouter);
router.use(pexelsRouter);
router.use(pixabayRouter);
router.use(analyzeRouter);
router.use(exportRouter);
router.use(transfersRouter);
router.use(subtitlesRouter);

export default router;
