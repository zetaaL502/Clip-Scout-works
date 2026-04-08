import { Router } from "express";
import { logger } from "../lib/logger";
import { getCompetitors, saveCompetitors } from "../lib/database";

const router = Router();

interface CompetitorChannel {
  id: string;
  channelId: string;
  title: string;
  thumbnail: string | null;
  subscriberCount: number;
  viewCount: number;
  videoCount: number;
  avgViewsPerVideo: number;
  engagementRate: string;
  monthlyViews: number;
  isOwner: boolean;
  channelAge: string;
  monthsOld: number;
  potential: string;
  viewsPerVideoRatio: number;
}

router.get("/load", async (req, res): Promise<void> => {
  try {
    const competitors = getCompetitors();

    logger.info(
      { count: competitors.length },
      "Loaded competitors from database",
    );

    res.json({
      channels: competitors,
      count: competitors.length,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error({ error: errorMessage }, "Error loading competitors");
    res.status(500).json({ error: errorMessage });
  }
});

router.post("/save", async (req, res): Promise<void> => {
  try {
    const { channels } = req.body as { channels: CompetitorChannel[] };

    if (!channels || !Array.isArray(channels)) {
      res.status(400).json({ error: "Invalid channels data" });
      return;
    }

    saveCompetitors(channels);

    logger.info({ count: channels.length }, "Saved competitors to database");

    res.json({
      success: true,
      count: channels.length,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error({ error: errorMessage }, "Error saving competitors");
    res.status(500).json({ error: errorMessage });
  }
});

export default router;
