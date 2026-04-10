import { Router } from "express";
import { logger } from "../../lib/logger";
import Groq from "groq-sdk";

const router = Router();

function calculateHoursAgo(dateString: string): number {
  const date = new Date(dateString);
  const now = new Date();
  return Math.max(1, (now.getTime() - date.getTime()) / (1000 * 60 * 60));
}

function getGroqClient(apiKey: string) {
  return new Groq({ apiKey });
}

router.get("/search", async (req, res): Promise<void> => {
  try {
    const { apiKey, q, publishedAfter, maxResults, regionCode, order } =
      req.query as {
        apiKey?: string;
        q?: string;
        publishedAfter?: string;
        maxResults?: string;
        regionCode?: string;
        order?: string;
      };

    if (!apiKey) {
      res.status(400).json({ error: "API key is required" });
      return;
    }

    if (!q) {
      res.status(400).json({ error: "Search query is required" });
      return;
    }

    const parsedMaxResults = Math.min(parseInt(maxResults || "25"), 50);
    const parsedOrder = order || "viewCount";
    const parsedRegion = regionCode || "US";

    logger.info(
      { query: q, order: parsedOrder, region: parsedRegion },
      "Searching YouTube videos",
    );

    const searchUrl = new URL("https://www.googleapis.com/youtube/v3/search");
    searchUrl.searchParams.set("key", apiKey);
    searchUrl.searchParams.set("part", "snippet");
    searchUrl.searchParams.set("q", q);
    searchUrl.searchParams.set("type", "video");
    searchUrl.searchParams.set("order", parsedOrder);
    searchUrl.searchParams.set("maxResults", parsedMaxResults.toString());
    searchUrl.searchParams.set("regionCode", parsedRegion);
    if (publishedAfter) {
      searchUrl.searchParams.set("publishedAfter", publishedAfter);
    }
    searchUrl.searchParams.set(
      "fields",
      "items(id(videoId),snippet(title,description,channelId,channelTitle,publishedAt,thumbnails)),nextPageToken,pageInfo",
    );

    const searchRes = await fetch(searchUrl.toString());
    const searchData = await searchRes.json() as any;

    if (!searchRes.ok) {
      logger.error({ error: searchData }, "YouTube search API error");
      throw new Error(
        searchData.error?.message || `YouTube API error: ${searchRes.status}`,
      );
    }

    const searchItems = searchData.items || [];
    const videoIds = searchItems
      .map((item: any) => item.id?.videoId)
      .filter(Boolean);

    if (videoIds.length === 0) {
      res.json({ videos: [], total: 0 });
      return;
    }

    const videosUrl = new URL("https://www.googleapis.com/youtube/v3/videos");
    videosUrl.searchParams.set("key", apiKey);
    videosUrl.searchParams.set("part", "snippet,statistics,contentDetails");
    videosUrl.searchParams.set("id", videoIds.join(","));
    videosUrl.searchParams.set(
      "fields",
      "items(id,snippet(title,description,channelId,channelTitle,publishedAt,thumbnails),statistics(viewCount,likeCount),contentDetails(duration))",
    );

    const videosRes = await fetch(videosUrl.toString());
    const videosData = await videosRes.json() as any;

    if (!videosRes.ok) {
      logger.error({ error: videosData }, "YouTube videos API error");
      throw new Error(
        videosData.error?.message || `YouTube API error: ${videosRes.status}`,
      );
    }

    const channelIds = [
      ...new Set(
        (videosData.items || [])
          .map((v: any) => v.snippet?.channelId)
          .filter(Boolean),
      ),
    ];

    let channelThumbnails: Record<string, string> = {};
    if (channelIds.length > 0) {
      const channelsUrl = new URL(
        "https://www.googleapis.com/youtube/v3/channels",
      );
      channelsUrl.searchParams.set("key", apiKey);
      channelsUrl.searchParams.set("part", "snippet");
      channelsUrl.searchParams.set("id", channelIds.join(","));
      channelsUrl.searchParams.set(
        "fields",
        "items(id,snippet(thumbnails(default)))",
      );

      const channelsRes = await fetch(channelsUrl.toString());
      const channelsData = await channelsRes.json() as any;

      if (channelsRes.ok) {
        (channelsData.items || []).forEach((channel: any) => {
          if (channel.id && channel.snippet?.thumbnails?.default?.url) {
            channelThumbnails[channel.id] =
              channel.snippet.thumbnails.default.url;
          }
        });
      }
    }

    const videos = (videosData.items || []).map((video: any) => ({
      id: video.id || "",
      title: video.snippet?.title || "",
      channelId: video.snippet?.channelId || "",
      channelTitle: video.snippet?.channelTitle || "",
      channelThumbnail:
        channelThumbnails[video.snippet?.channelId || ""] || null,
      viewCount: video.statistics?.viewCount || "0",
      likeCount: video.statistics?.likeCount || null,
      publishedAt: video.snippet?.publishedAt || "",
      description: video.snippet?.description || "",
      thumbnail:
        video.snippet?.thumbnails?.high?.url ||
        video.snippet?.thumbnails?.medium?.url ||
        video.snippet?.thumbnails?.default?.url ||
        null,
      duration: video.contentDetails?.duration || null,
    }));

    logger.info(
      { videoCount: videos.length },
      "Returning video search results",
    );

    res.json({ videos, total: videos.length });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error({ error: errorMessage }, "Error searching YouTube videos");
    res.status(500).json({ error: errorMessage });
  }
});

router.get("/channel", async (req, res): Promise<void> => {
  try {
    const { apiKey, id } = req.query as { apiKey?: string; id?: string };

    if (!apiKey) {
      res.status(400).json({ error: "API key is required" });
      return;
    }

    if (!id) {
      res.status(400).json({ error: "Channel ID is required" });
      return;
    }

    logger.info({ channelId: id }, "Fetching channel details");

    const channelUrl = new URL(
      "https://www.googleapis.com/youtube/v3/channels",
    );
    channelUrl.searchParams.set("key", apiKey);
    channelUrl.searchParams.set(
      "part",
      "snippet,statistics,brandingSettings,contentDetails",
    );
    channelUrl.searchParams.set("id", id);
    channelUrl.searchParams.set(
      "fields",
      "items(id,snippet(title,description,customUrl,publishedAt,country,thumbnails(medium,high)),statistics(subscriberCount,viewCount,videoCount,hiddenSubscriberCount),brandingSettings(image(bannerImageUrl),channel(keywords)),contentDetails(relatedPlaylists(uploads)))",
    );

    const channelRes = await fetch(channelUrl.toString());
    const channelData = await channelRes.json() as any;

    if (!channelRes.ok) {
      logger.error({ error: channelData }, "YouTube channel API error");
      throw new Error(
        channelData.error?.message || `YouTube API error: ${channelRes.status}`,
      );
    }

    const channel = channelData.items?.[0];
    if (!channel) {
      res.status(404).json({ error: "Channel not found" });
      return;
    }

    const uploadsPlaylistId = channel.contentDetails?.relatedPlaylists?.uploads;
    let allVideos: any[] = [];

    if (uploadsPlaylistId) {
      const playlistUrl = new URL(
        "https://www.googleapis.com/youtube/v3/playlistItems",
      );
      playlistUrl.searchParams.set("key", apiKey);
      playlistUrl.searchParams.set("part", "snippet,contentDetails");
      playlistUrl.searchParams.set("playlistId", uploadsPlaylistId);
      playlistUrl.searchParams.set("maxResults", "50");
      playlistUrl.searchParams.set(
        "fields",
        "items(snippet(title,publishedAt,thumbnails(medium)),contentDetails(videoId)),nextPageToken",
      );

      const playlistRes = await fetch(playlistUrl.toString());
      const playlistData = await playlistRes.json() as any;

      if (playlistRes.ok && playlistData.items) {
        const videoIds = playlistData.items
          .map((item: any) => item.contentDetails?.videoId)
          .filter(Boolean);

        if (videoIds.length > 0) {
          const videosUrl = new URL(
            "https://www.googleapis.com/youtube/v3/videos",
          );
          videosUrl.searchParams.set("key", apiKey);
          videosUrl.searchParams.set(
            "part",
            "snippet,statistics,contentDetails",
          );
          videosUrl.searchParams.set("id", videoIds.join(","));
          videosUrl.searchParams.set(
            "fields",
            "items(id,snippet(title,publishedAt,thumbnails(medium)),statistics(viewCount,likeCount,commentCount),contentDetails(duration))",
          );

          const videosRes = await fetch(videosUrl.toString());
          const videosData = await videosRes.json() as any;

          if (videosRes.ok && videosData.items) {
            allVideos = videosData.items.map((video: any) => {
              const views = parseInt(video.statistics?.viewCount || "0");
              const likes = parseInt(video.statistics?.likeCount || "0");
              const comments = parseInt(video.statistics?.commentCount || "0");
              const hoursAgo = calculateHoursAgo(video.snippet?.publishedAt);
              const viewsPerHour = views / hoursAgo;
              const totalEngagement = likes + comments;
              const engagementRate =
                views > 0 ? ((totalEngagement / views) * 100).toFixed(2) : "0";

              return {
                id: video.id,
                title: video.snippet?.title,
                publishedAt: video.snippet?.publishedAt,
                thumbnail: video.snippet?.thumbnails?.medium?.url,
                viewCount: video.statistics?.viewCount || "0",
                likeCount: video.statistics?.likeCount || "0",
                commentCount: video.statistics?.commentCount || "0",
                duration: video.contentDetails?.duration,
                viewsPerHour: viewsPerHour.toFixed(1),
                hoursAgo: Math.round(hoursAgo),
                engagementRate,
                engagement: engagementRate,
              };
            });
          }
        }
      }
    }

    const recentVideos = allVideos.slice(0, 50);
    const topVideos = [...allVideos]
      .sort((a, b) => parseInt(b.viewCount) - parseInt(a.viewCount))
      .slice(0, 10);
    const trendingVideos = [...allVideos]
      .sort((a, b) => parseFloat(b.viewsPerHour) - parseFloat(a.viewsPerHour))
      .slice(0, 10);

    const subscriberCount = parseInt(
      channel.statistics?.subscriberCount || "0",
    );
    const viewCount = parseInt(channel.statistics?.viewCount || "0");
    const videoCount = parseInt(channel.statistics?.videoCount || "0");

    const avgViewsPerVideo =
      videoCount > 0 ? Math.round(viewCount / videoCount) : 0;
    const estimatedMonthlyViews = avgViewsPerVideo * (videoCount > 0 ? 4 : 0);
    const estimatedRevenueLow = estimatedMonthlyViews * 0.001;
    const estimatedRevenueHigh = estimatedMonthlyViews * 0.01;
    const isMonetized = subscriberCount >= 1000 && videoCount >= 10;

    const avgEngagementRate =
      allVideos.length > 0
        ? (
            allVideos.reduce(
              (acc, v) => acc + parseFloat(v.engagementRate),
              0,
            ) / allVideos.length
          ).toFixed(2)
        : "0";

    res.json({
      id: channel.id,
      title: channel.snippet?.title,
      description: channel.snippet?.description,
      customUrl: channel.snippet?.customUrl,
      publishedAt: channel.snippet?.publishedAt,
      country: channel.snippet?.country,
      thumbnail:
        channel.snippet?.thumbnails?.high?.url ||
        channel.snippet?.thumbnails?.medium?.url,
      bannerImage: channel.brandingSettings?.image?.bannerImageUrl,
      keywords: channel.brandingSettings?.channel?.keywords,
      statistics: {
        subscriberCount,
        viewCount,
        videoCount,
        hiddenSubscriberCount: channel.statistics?.hiddenSubscriberCount,
      },
      metrics: {
        avgViewsPerVideo,
        avgEngagementRate,
        estimatedMonthlyViews,
        estimatedRevenue: {
          low: estimatedRevenueLow.toFixed(2),
          high: estimatedRevenueHigh.toFixed(2),
          currency: "USD",
        },
        isMonetized,
        monetizationStatus:
          subscriberCount >= 1000
            ? "Eligible (1K+ subscribers)"
            : `Not eligible (${subscriberCount.toLocaleString()} subscribers, need 1K)`,
        subscriberGrade:
          subscriberCount >= 1000000
            ? "Mega"
            : subscriberCount >= 100000
              ? "Large"
              : subscriberCount >= 10000
                ? "Medium"
                : subscriberCount >= 1000
                  ? "Small"
                  : "Nano",
      },
      recentVideos,
      topVideos,
      trendingVideos,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error({ error: errorMessage }, "Error fetching channel");
    res.status(500).json({ error: errorMessage });
  }
});

router.get("/channel-by-name", async (req, res): Promise<void> => {
  try {
    const { apiKey, name } = req.query as { apiKey?: string; name?: string };

    if (!apiKey) {
      res.status(400).json({ error: "API key is required" });
      return;
    }

    if (!name) {
      res.status(400).json({ error: "Channel name is required" });
      return;
    }

    logger.info({ channelName: name }, "Searching for channel by name");

    const searchUrl = new URL("https://www.googleapis.com/youtube/v3/search");
    searchUrl.searchParams.set("key", apiKey);
    searchUrl.searchParams.set("part", "snippet");
    searchUrl.searchParams.set("q", name);
    searchUrl.searchParams.set("type", "channel");
    searchUrl.searchParams.set("maxResults", "5");
    searchUrl.searchParams.set(
      "fields",
      "items(id(channelId),snippet(title,description,thumbnails))",
    );

    const searchRes = await fetch(searchUrl.toString());
    const searchData = await searchRes.json() as any;

    if (!searchRes.ok) {
      logger.error({ error: searchData }, "YouTube search API error");
      throw new Error(
        searchData.error?.message || `YouTube API error: ${searchRes.status}`,
      );
    }

    const channels = searchData.items || [];

    if (channels.length === 0) {
      res.json({ channels: [] });
      return;
    }

    const channelIds = channels.map((c: any) => c.id.channelId);

    const channelUrl = new URL(
      "https://www.googleapis.com/youtube/v3/channels",
    );
    channelUrl.searchParams.set("key", apiKey);
    channelUrl.searchParams.set("part", "snippet,statistics,contentDetails");
    channelUrl.searchParams.set("id", channelIds.join(","));
    channelUrl.searchParams.set(
      "fields",
      "items(id,snippet(title,description,customUrl,publishedAt,thumbnails(medium,high)),statistics(subscriberCount,viewCount,videoCount))",
    );

    const channelRes = await fetch(channelUrl.toString());
    const channelData = await channelRes.json() as any;

    if (!channelRes.ok) {
      logger.error({ error: channelData }, "YouTube channels API error");
      throw new Error(
        channelData.error?.message || `YouTube API error: ${channelRes.status}`,
      );
    }

    const enrichedChannels = (channelData.items || []).map((channel: any) => {
      const subscriberCount = parseInt(
        channel.statistics?.subscriberCount || "0",
      );
      const videoCount = parseInt(channel.statistics?.videoCount || "0");
      const viewCount = parseInt(channel.statistics?.viewCount || "0");

      return {
        id: channel.id,
        title: channel.snippet?.title,
        description: channel.snippet?.description,
        customUrl: channel.snippet?.customUrl,
        publishedAt: channel.snippet?.publishedAt,
        thumbnail:
          channel.snippet?.thumbnails?.high?.url ||
          channel.snippet?.thumbnails?.medium?.url,
        subscriberCount,
        viewCount,
        videoCount,
        avgViewsPerVideo:
          videoCount > 0 ? Math.round(viewCount / videoCount) : 0,
        isMonetized: subscriberCount >= 1000 && videoCount >= 10,
        monetizationStatus:
          subscriberCount >= 1000 ? "Eligible" : "Not eligible",
      };
    });

    enrichedChannels.sort((a: { subscriberCount: number }, b: { subscriberCount: number }) => b.subscriberCount - a.subscriberCount);

    res.json({ channels: enrichedChannels });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error({ error: errorMessage }, "Error searching channels");
    res.status(500).json({ error: errorMessage });
  }
});

router.post("/video-ideas", async (req, res): Promise<void> => {
  try {
    const { apiKey, groqKey, channelData, topVideos, niche } = req.body as {
      apiKey?: string;
      groqKey?: string;
      channelData?: any;
      topVideos?: any[];
      niche?: string;
    };

    if (!groqKey) {
      res
        .status(400)
        .json({ error: "AI API key is required. Please add it in Settings." });
      return;
    }

    const channelName = channelData?.title || "this channel";
    const topTitles =
      topVideos
        ?.slice(0, 5)
        .map((v: any) => v.title)
        .join("\n") || "No video data available";
    const subscriberCount =
      channelData?.statistics?.subscriberCount || "unknown";
    const avgViews = channelData?.metrics?.avgViewsPerVideo || "unknown";
    const engagement = channelData?.metrics?.avgEngagementRate || "unknown";

    const prompt = `You are a YouTube growth strategist. Analyze this channel and generate video ideas.

CHANNEL: ${channelName}
NICHE: ${niche || "General"}
SUBSCRIBERS: ${formatNumber(subscriberCount)}
AVG VIEWS PER VIDEO: ${formatNumber(avgViews)}
ENGAGEMENT RATE: ${engagement}%

TOP PERFORMING VIDEOS:
${topTitles}

Based on the channel's successful content and niche, generate 10 unique video ideas that could perform well. For each idea, provide:
1. A catchy title
2. A brief hook (first 5-10 seconds)
3. Key topics/angles to cover
4. Why it would perform well

Format as JSON array like this:
[{"title": "...", "hook": "...", "topics": "...", "whyItWorks": "..."}]

Generate fresh, creative ideas - not copies of existing videos but inspired by what works.`;

    const groq = getGroqClient(groqKey);

    const completion = await groq.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      model: "llama-3.1-8b-instant",
      temperature: 0.8,
      max_tokens: 2000,
    });

    const response = completion.choices[0]?.message?.content || "";

    let ideas = [];
    try {
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        ideas = JSON.parse(jsonMatch[0]);
      }
    } catch {
      ideas = [
        {
          title: "AI ideas",
          hook: "Response parsing failed",
          topics: response,
          whyItWorks: "Raw AI response",
        },
      ];
    }

    logger.info(
      { channelName, ideaCount: ideas.length },
      "Generated video ideas",
    );

    res.json({ ideas, promptUsed: false });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error({ error: errorMessage }, "Error generating video ideas");
    res.status(500).json({ error: errorMessage });
  }
});

router.get("/discover", async (req, res): Promise<void> => {
  try {
    const { apiKey, q, maxResults, publishedAfter } = req.query as {
      apiKey?: string;
      q?: string;
      maxResults?: string;
      publishedAfter?: string;
    };

    if (!apiKey) {
      res.status(400).json({ error: "API key is required" });
      return;
    }

    if (!q) {
      res.status(400).json({ error: "Search topic is required" });
      return;
    }

    const parsedMax = Math.min(parseInt(maxResults || "50"), 100);

    logger.info(
      { query: q, publishedAfter },
      "Discovering rising automation channels",
    );

    const searchUrl = new URL("https://www.googleapis.com/youtube/v3/search");
    searchUrl.searchParams.set("key", apiKey);
    searchUrl.searchParams.set("part", "snippet");
    searchUrl.searchParams.set("q", q);
    searchUrl.searchParams.set("type", "video");
    searchUrl.searchParams.set("order", "date");
    searchUrl.searchParams.set("maxResults", "50");
    if (publishedAfter) {
      searchUrl.searchParams.set("publishedAfter", publishedAfter);
    }
    searchUrl.searchParams.set(
      "fields",
      "items(id(videoId),snippet(channelId,channelTitle,publishedAt))",
    );

    const searchRes = await fetch(searchUrl.toString());
    const searchData = await searchRes.json() as any;

    if (!searchRes.ok) {
      throw new Error(
        searchData.error?.message || `YouTube API error: ${searchRes.status}`,
      );
    }

    const channelMap = new Map<
      string,
      {
        channelId: string;
        channelTitle: string;
        videoCount: number;
        totalViews: number;
        videoIds: string[];
        channelCreatedAt: string;
      }
    >();

    (searchData.items || []).forEach((item: any) => {
      const channelId = item.snippet?.channelId;
      const channelTitle = item.snippet?.channelTitle;
      if (channelId) {
        if (!channelMap.has(channelId)) {
          channelMap.set(channelId, {
            channelId,
            channelTitle,
            videoCount: 0,
            totalViews: 0,
            videoIds: [],
            channelCreatedAt: item.snippet?.publishedAt || "",
          });
        }
        const channel = channelMap.get(channelId);
        if (channel && item.id?.videoId) {
          channel.videoIds.push(item.id.videoId);
        }
      }
    });

    const channelIds = Array.from(channelMap.keys());

    for (let i = 0; i < channelIds.length; i += 50) {
      const batch = channelIds.slice(i, i + 50);

      const channelsUrl = new URL(
        "https://www.googleapis.com/youtube/v3/channels",
      );
      channelsUrl.searchParams.set("key", apiKey);
      channelsUrl.searchParams.set("part", "snippet,statistics");
      channelsUrl.searchParams.set("id", batch.join(","));
      channelsUrl.searchParams.set(
        "fields",
        "items(id,snippet(title,publishedAt,thumbnails(medium,high)),statistics(subscriberCount,viewCount,videoCount))",
      );

      const channelsRes = await fetch(channelsUrl.toString());
      const channelsData = await channelsRes.json() as any;

      if (channelsRes.ok && channelsData.items) {
        channelsData.items.forEach((channel: any) => {
          const existing = channelMap.get(channel.id);
          if (existing) {
            existing.channelTitle =
              channel.snippet?.title || existing.channelTitle;
            existing.videoCount = parseInt(
              channel.statistics?.videoCount || "0",
            );
            if (channel.snippet?.publishedAt) {
              existing.channelCreatedAt = channel.snippet.publishedAt;
            }
          }
        });
      }

      if (i + 50 < channelIds.length) {
        await new Promise((r) => setTimeout(r, 100));
      }
    }

    const videoIds = [
      ...new Set(
        (searchData.items || [])
          .map((item: any) => item.id?.videoId)
          .filter(Boolean),
      ),
    ];

    let videoViews: Record<string, number> = {};
    if (videoIds.length > 0) {
      const videosUrl = new URL("https://www.googleapis.com/youtube/v3/videos");
      videosUrl.searchParams.set("key", apiKey);
      videosUrl.searchParams.set("part", "statistics");
      videosUrl.searchParams.set("id", videoIds.join(","));
      videosUrl.searchParams.set("fields", "items(id,statistics(viewCount))");

      const videosRes = await fetch(videosUrl.toString());
      const videosData = await videosRes.json() as any;

      if (videosRes.ok && videosData.items) {
        videosData.items.forEach((video: any) => {
          videoViews[video.id] = parseInt(video.statistics?.viewCount || "0");
        });
      }
    }

    const now = new Date();

    const channels = Array.from(channelMap.values()).map((ch) => {
      let channelViews = 0;
      ch.videoIds.forEach((vid) => {
        channelViews += videoViews[vid] || 0;
      });
      const videosInSearch = ch.videoIds.length;
      const avgViewsPerVideo =
        videosInSearch > 0 ? Math.round(channelViews / videosInSearch) : 0;

      const createdDate = new Date(ch.channelCreatedAt);
      const monthsOld =
        (now.getTime() - createdDate.getTime()) / (1000 * 60 * 60 * 24 * 30);

      let type = "Established";
      let channelAge = "Old";
      if (monthsOld <= 2) {
        type = "Fresh";
        channelAge = "Created < 2 months ago";
      } else if (monthsOld <= 6) {
        type = "New";
        channelAge = "Created < 6 months ago";
      } else if (monthsOld <= 12) {
        type = "Growing";
        channelAge = "Created < 1 year ago";
      } else if (monthsOld <= 24) {
        type = "Building";
        channelAge = "Created < 2 years ago";
      } else {
        channelAge = `Created ${Math.round(monthsOld / 12)} years ago`;
      }

      const viewsToVideoRatio =
        ch.videoCount > 0 ? channelViews / ch.videoCount : 0;
      const isNewChannelWithHighViews =
        monthsOld <= 6 && avgViewsPerVideo > 10000;
      const isFacelessPotential =
        ch.videoCount <= 50 && avgViewsPerVideo > 5000 && monthsOld <= 12;

      let potential = "Low";
      if (
        isNewChannelWithHighViews ||
        (isFacelessPotential && avgViewsPerVideo > 50000)
      ) {
        potential = "Very High";
      } else if (isFacelessPotential || avgViewsPerVideo > 50000) {
        potential = "High";
      } else if (
        avgViewsPerVideo > 10000 ||
        (ch.videoCount <= 20 && avgViewsPerVideo > 5000)
      ) {
        potential = "Medium";
      }

      const excludeKeywords = [
        "song",
        "music",
        "official",
        "vevo",
        "topic",
        "topic ",
        "record label",
        "entertainment",
        "vevo",
        "official video",
        "audio",
      ];
      const titleLower = ch.channelTitle?.toLowerCase() || "";
      const isLikelyMusic = excludeKeywords.some((kw) =>
        titleLower.includes(kw),
      );

      return {
        channelId: ch.channelId,
        channelTitle: ch.channelTitle,
        totalVideos: ch.videoCount,
        videosFound: videosInSearch,
        totalViews: channelViews,
        avgViewsPerVideo,
        type,
        channelAge,
        monthsOld: Math.round(monthsOld),
        viewsToVideoRatio: Math.round(viewsToVideoRatio),
        isNewChannelWithHighViews,
        isFacelessPotential,
        isLikelyMusic,
        potential,
        isExcluded: isLikelyMusic,
      };
    });

    const filteredChannels = channels
      .filter((ch) => !ch.isExcluded)
      .sort((a, b) => {
        if (a.isNewChannelWithHighViews && !b.isNewChannelWithHighViews)
          return -1;
        if (!a.isNewChannelWithHighViews && b.isNewChannelWithHighViews)
          return 1;
        if (a.isFacelessPotential && !b.isFacelessPotential) return -1;
        if (!a.isFacelessPotential && b.isFacelessPotential) return 1;
        if (a.monthsOld < 6 && b.monthsOld >= 6) return -1;
        if (a.monthsOld >= 6 && b.monthsOld < 6) return 1;
        if (a.type === "Fresh" && b.type !== "Fresh") return -1;
        if (a.type !== "Fresh" && b.type === "Fresh") return 1;
        return b.avgViewsPerVideo - a.avgViewsPerVideo;
      })
      .slice(0, parsedMax);

    logger.info(
      { channelCount: filteredChannels.length },
      "Returning rising channels",
    );

    res.json({ channels: filteredChannels, total: filteredChannels.length });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error({ error: errorMessage }, "Error discovering channels");
    res.status(500).json({ error: errorMessage });
  }
});

function formatNumber(num: any): string {
  if (typeof num === "number") return num.toLocaleString();
  if (typeof num === "string") return num;
  return "0";
}

export default router;
