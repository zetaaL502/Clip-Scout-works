import { Router } from "express";
import { google } from "googleapis";
import { logger } from "../../lib/logger";

const router = Router();

const CONFIG = {
  defaultRegionCode: "US",
  defaultMaxResults: 200,
  maxResultsLimit: 500,
  channelBatchSize: 50,
};

function getYouTubeClient(apiKey: string) {
  if (!apiKey) {
    throw new Error("YouTube API key is required");
  }
  return google.youtube({ version: "v3", auth: apiKey });
}

router.get("/new-channels", async (req, res): Promise<void> => {
  try {
    const { apiKey, publishedAfter, maxResults, regionCode } = req.query as {
      apiKey?: string;
      publishedAfter?: string;
      maxResults?: string;
      regionCode?: string;
    };

    if (!apiKey) {
      res.status(400).json({ error: "API key is required" });
      return;
    }

    const parsedMaxResults = Math.min(
      parseInt(maxResults || "200"),
      CONFIG.maxResultsLimit,
    );

    const parsedPublishedAfter = publishedAfter || getDefaultPublishedAfter();
    const parsedRegionCode = regionCode || CONFIG.defaultRegionCode;

    const parsedDate = new Date(parsedPublishedAfter);
    if (isNaN(parsedDate.getTime())) {
      res
        .status(400)
        .json({
          error:
            "Invalid publishedAfter date. Use ISO format (e.g., 2026-01-07)",
        });
      return;
    }

    const youtube = getYouTubeClient(apiKey);

    logger.info(
      {
        publishedAfter: parsedPublishedAfter,
        maxResults: parsedMaxResults,
        regionCode: parsedRegionCode,
      },
      "Fetching new YouTube channels",
    );

    const searchResponse = await youtube.search.list({
      part: ["snippet"],
      type: ["video"],
      order: "date",
      publishedAfter: parsedDate.toISOString(),
      regionCode: parsedRegionCode,
      maxResults: parsedMaxResults,
      fields:
        "items(snippet(channelId,channelTitle,publishedAt,title)),nextPageToken",
    });

    const searchItems = searchResponse.data.items || [];
    const nextPageToken = searchResponse.data.nextPageToken || null;

    logger.info({ videoCount: searchItems.length }, "Found videos from search");

    const channelIdMap = new Map<
      string,
      { title: string; latestVideoDate: string }
    >();

    for (const item of searchItems) {
      const channelId = item.snippet?.channelId;
      if (channelId && !channelIdMap.has(channelId)) {
        channelIdMap.set(channelId, {
          title: item.snippet?.channelTitle || "Unknown",
          latestVideoDate: item.snippet?.publishedAt || "",
        });
      }
    }

    const channelIds = Array.from(channelIdMap.keys());
    const channelDetails: ChannelDetail[] = [];

    for (let i = 0; i < channelIds.length; i += CONFIG.channelBatchSize) {
      const batchIds = channelIds.slice(i, i + CONFIG.channelBatchSize);

      const channelsResponse = await youtube.channels.list({
        part: ["snippet", "statistics", "brandingSettings"],
        id: batchIds,
        fields:
          "items(id,snippet(title,customUrl,publishedAt,country,thumbnails),statistics(viewCount,subscriberCount,videoCount),brandingSettings(image))",
      });

      const channelItems = channelsResponse.data.items || [];

      for (const channel of channelItems) {
        const latestVideo = channelIdMap.get(channel.id || "");

        channelDetails.push({
          id: channel.id || "",
          title: channel.snippet?.title || "Unknown",
          customUrl: channel.snippet?.customUrl || null,
          publishedAt: channel.snippet?.publishedAt || "",
          country: channel.snippet?.country || null,
          thumbnail:
            channel.snippet?.thumbnails?.high?.url ||
            channel.snippet?.thumbnails?.medium?.url ||
            channel.snippet?.thumbnails?.default?.url ||
            null,
          bannerImage:
            channel.brandingSettings?.image?.bannerExternalUrl || null,
          statistics: {
            viewCount: parseInt(channel.statistics?.viewCount || "0"),
            subscriberCount: parseInt(
              channel.statistics?.subscriberCount || "0",
            ),
            videoCount: parseInt(channel.statistics?.videoCount || "0"),
          },
          latestVideo: latestVideo
            ? {
                title: latestVideo.title,
                publishedAt: latestVideo.latestVideoDate,
              }
            : null,
        });
      }

      if (i + CONFIG.channelBatchSize < channelIds.length) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    channelDetails.sort((a, b) => {
      const dateA = a.latestVideo?.publishedAt || a.publishedAt;
      const dateB = b.latestVideo?.publishedAt || b.publishedAt;
      return new Date(dateB).getTime() - new Date(dateA).getTime();
    });

    logger.info(
      { channelCount: channelDetails.length },
      "Returning channel data",
    );

    res.json({
      channels: channelDetails,
      pagination: {
        nextPageToken,
        totalFound: channelDetails.length,
        query: {
          publishedAfter: parsedPublishedAfter,
          maxResults: parsedMaxResults,
          regionCode: parsedRegionCode,
        },
      },
    });
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";

    if (errorMessage.includes("quotaExceeded")) {
      logger.error({ error: errorMessage }, "YouTube API quota exceeded");
      res.status(429).json({
        error: "YouTube API quota exceeded. Please try again later.",
        retryAfter: "86400",
      });
      return;
    }

    logger.error({ error: errorMessage }, "Error fetching YouTube channels");
    res.status(500).json({ error: errorMessage });
  }
});

router.get("/health", async (req, res): Promise<void> => {
  const { apiKey } = req.query as { apiKey?: string };

  if (!apiKey) {
    res.status(400).json({ status: "error", message: "API key required" });
    return;
  }

  try {
    const youtube = getYouTubeClient(apiKey);

    await youtube.channels.list({
      part: ["snippet"],
      id: ["UC_x5XG1OV2P6uZZ5FSM9Ttw"],
      fields: "items(id,title)",
    });

    res.json({
      status: "ok",
      timestamp: new Date().toISOString(),
    });
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    res.status(503).json({
      status: "error",
      message: errorMessage,
    });
  }
});

function getDefaultPublishedAfter(): string {
  const threeMonthsAgo = new Date();
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
  return threeMonthsAgo.toISOString().split("T")[0];
}

interface ChannelDetail {
  id: string;
  title: string;
  customUrl: string | null;
  publishedAt: string;
  country: string | null;
  thumbnail: string | null;
  bannerImage: string | null;
  statistics: {
    viewCount: number;
    subscriberCount: number;
    videoCount: number;
  };
  latestVideo: {
    title: string;
    publishedAt: string;
  } | null;
}

export default router;
