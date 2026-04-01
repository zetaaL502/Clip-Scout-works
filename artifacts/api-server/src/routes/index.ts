import { Router, type IRouter } from "express";
import healthRouter from "./health";
import pexelsRouter from "./pexels";
import analyzeRouter from "./analyze";

const router: IRouter = Router();

router.use(healthRouter);
router.use(pexelsRouter);
router.use(analyzeRouter);

export default router;
