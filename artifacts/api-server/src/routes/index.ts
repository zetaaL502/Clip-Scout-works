import { Router, type IRouter } from "express";
import healthRouter from "./health";
import pexelsRouter from "./pexels";

const router: IRouter = Router();

router.use(healthRouter);
router.use(pexelsRouter);

export default router;
