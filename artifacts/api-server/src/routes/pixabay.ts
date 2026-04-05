import { Router, type IRouter } from "express";

const router: IRouter = Router();

const PIXABAY_TIMEOUT_MS = 15000;

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function isLandscape(width?: number, height?: number): boolean {
  return typeof width === "number" && typeof height === "number" && width > height;
}

router.post("/pixabay-proxy", async (req, res) => {
  const apiKey = process.env["PIXABAY_API_KEY"];
  if (!apiKey) {
    res.status(502).json({ error: "PIXABAY_API_KEY not configured on server" });
    return;
  }

  const { keywords, page = 1 } = req.body as { keywords?: string; page?: number };
  if (!keywords || typeof keywords !== "string" || !keywords.trim()) {
    res.status(400).json({ error: "keywords is required" });
    return;
  }

  try {
    const url = `https://pixabay.com/api/videos/?key=${apiKey}&q=${encodeURIComponent(keywords.trim())}&per_page=20&page=${page}&video_type=film`;
    const pixabayRes = await fetchWithTimeout(url, PIXABAY_TIMEOUT_MS);

    if (!pixabayRes.ok) {
      const text = await pixabayRes.text().catch(() => "");
      req.log.warn({ status: pixabayRes.status, body: text }, "Pixabay API returned non-OK");
      res.status(502).json({ error: `Pixabay API error: ${pixabayRes.status}` });
      return;
    }

    const data = (await pixabayRes.json()) as {
      hits: Array<{
        id: number;
        picture_id: string;
        duration: number;
        videos: {
          large?: { url: string; width: number; height: number };
          medium?: { url: string; width: number; height: number };
          small?: { url: string; width: number; height: number };
          tiny?: { url: string; width: number; height: number };
        };
      }>;
    };

    const clips = (data.hits ?? [])
      .map((hit) => {
        const video = hit.videos.large ?? hit.videos.medium ?? hit.videos.small ?? hit.videos.tiny;
        if (!video?.url) return null;
        return {
          id: String(hit.id),
          thumbnail_url: `https://i.vimeocdn.com/video/${hit.picture_id}_640x360.jpg`,
          media_url: video.url,
          width: video.width,
          height: video.height,
          duration: hit.duration,
        };
      })
      .filter((c): c is NonNullable<typeof c> => c !== null && isLandscape(c.width, c.height))
      .slice(0, 4);

    res.json(clips);
  } catch (err) {
    const isAbort = (err as Error)?.name === "AbortError";
    if (isAbort) {
      req.log.warn("Pixabay API request timed out");
      res.status(504).json({ error: "Pixabay API timed out" });
    } else {
      req.log.error({ err }, "Failed to fetch from Pixabay");
      res.status(502).json({ error: "Failed to reach Pixabay API" });
    }
  }
});

export default router;
