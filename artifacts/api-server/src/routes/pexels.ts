import { Router, type IRouter } from "express";

const router: IRouter = Router();

const PEXELS_TIMEOUT_MS = 15000;

type PexelsVideoFile = {
  quality: string;
  link: string;
  file_type: string;
  width?: number;
  height?: number;
};

function isLandscape(width?: number, height?: number): boolean {
  return typeof width === "number" && typeof height === "number" && width > height;
}

function pickExportSafeFile(videoFiles: PexelsVideoFile[]): PexelsVideoFile | undefined {
  const mp4Files = videoFiles.filter((f) => f.file_type === "video/mp4");
  const landscapeMp4Files = mp4Files.filter((f) => isLandscape(f.width, f.height));
  const widthSafe = (f: PexelsVideoFile) => !f.width || f.width <= 2000;
  const inTargetRange = (f: PexelsVideoFile) =>
    typeof f.width === "number" && f.width >= 1280 && f.width <= 1920;

  if (landscapeMp4Files.length > 0) {
    return (
      landscapeMp4Files.find((f) => f.quality === "hd" && widthSafe(f)) ??
      landscapeMp4Files.find((f) => inTargetRange(f) && widthSafe(f)) ??
      landscapeMp4Files.find((f) => widthSafe(f)) ??
      landscapeMp4Files[0]
    );
  }
  return undefined;
}

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

router.post("/pexels-proxy", async (req, res) => {
  const apiKey = process.env["PEXELS_API_KEY"];
  if (!apiKey) {
    res.status(502).json({ error: "PEXELS_API_KEY not configured on server" });
    return;
  }

  const { keywords, page = 1 } = req.body as { keywords?: string; page?: number };
  if (!keywords || typeof keywords !== "string" || !keywords.trim()) {
    res.status(400).json({ error: "keywords is required" });
    return;
  }

  try {
    const url = `https://api.pexels.com/videos/search?query=${encodeURIComponent(keywords.trim())}&per_page=20&page=${page}&min_duration=5&max_duration=30`;
    const pexelsRes = await fetchWithTimeout(
      url,
      { headers: { Authorization: apiKey } },
      PEXELS_TIMEOUT_MS,
    );

    if (!pexelsRes.ok) {
      const text = await pexelsRes.text().catch(() => "");
      req.log.warn({ status: pexelsRes.status, body: text }, "Pexels API returned non-OK");
      res.status(502).json({ error: `Pexels API error: ${pexelsRes.status}` });
      return;
    }

    const data = (await pexelsRes.json()) as {
      videos: Array<{
        id: number;
        image: string;
        width?: number;
        height?: number;
        video_files: Array<{ quality: string; link: string; file_type: string; width?: number; height?: number }>;
      }>;
    };

    const clips = (data.videos ?? [])
      .filter((video) => isLandscape(video.width, video.height))
      .map((video) => {
        const hdFile =
          video.video_files.find((f) => f.quality === "hd" && f.file_type === "video/mp4") ??
          video.video_files.find((f) => f.file_type === "video/mp4" && isLandscape(f.width, f.height)) ??
          video.video_files.find((f) => f.file_type === "video/mp4") ??
          video.video_files[0];
        return {
          id: String(video.id),
          thumbnail_url: video.image,
          media_url: hdFile?.link ?? "",
          width: video.width,
          height: video.height,
        };
      })
      .slice(0, 4);

    res.json(clips);
  } catch (err) {
    const isAbort = (err as Error)?.name === "AbortError";
    if (isAbort) {
      req.log.warn("Pexels API request timed out");
      res.status(504).json({ error: "Pexels API timed out" });
    } else {
      req.log.error({ err }, "Failed to fetch from Pexels");
      res.status(502).json({ error: "Failed to reach Pexels API" });
    }
  }
});

router.get("/pexels-video/:videoId", async (req, res) => {
  const apiKey = process.env["PEXELS_API_KEY"];
  if (!apiKey) {
    res.status(502).json({ error: "PEXELS_API_KEY not configured on server" });
    return;
  }

  const videoId = req.params.videoId;
  if (!videoId) {
    res.status(400).json({ error: "videoId is required" });
    return;
  }

  try {
    const url = `https://api.pexels.com/videos/videos/${encodeURIComponent(videoId)}`;
    const pexelsRes = await fetchWithTimeout(
      url,
      { headers: { Authorization: apiKey } },
      PEXELS_TIMEOUT_MS,
    );

    if (!pexelsRes.ok) {
      const text = await pexelsRes.text().catch(() => "");
      req.log.warn({ status: pexelsRes.status, body: text, videoId }, "Pexels video API returned non-OK");
      res.status(502).json({ error: `Pexels video API error: ${pexelsRes.status}` });
      return;
    }

    const data = (await pexelsRes.json()) as {
      id: number;
      video_files: PexelsVideoFile[];
    };

    const selected = pickExportSafeFile(data.video_files ?? []);
    if (!selected?.link) {
      res.status(404).json({ error: "No exportable video file found" });
      return;
    }

    res.json({
      id: data.id,
      media_url: selected.link,
      width: selected.width ?? null,
      quality: selected.quality,
    });
  } catch (err) {
    const isAbort = (err as Error)?.name === "AbortError";
    if (isAbort) {
      req.log.warn({ videoId }, "Pexels video API request timed out");
      res.status(504).json({ error: "Pexels video API timed out" });
    } else {
      req.log.error({ err, videoId }, "Failed to fetch Pexels video details");
      res.status(502).json({ error: "Failed to reach Pexels API" });
    }
  }
});

// Proxies a video download through the server to avoid CORS restrictions.
// Only allows CDN URLs from trusted video hosts (Pexels, Vimeo, etc.).
router.get("/video-download", async (req, res) => {
  const rawUrl = req.query["url"];
  if (typeof rawUrl !== "string" || !rawUrl) {
    res.status(400).json({ error: "url query param is required" });
    return;
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    res.status(400).json({ error: "Invalid URL" });
    return;
  }

  // Allow only trusted video CDN hostnames
  const allowedHosts = [
    "videos.pexels.com",
    "player.vimeo.com",
    "vimeocdn.com",
    "storage.googleapis.com",
    "cdn.giphy.com",
    "media.giphy.com",
    "media0.giphy.com",
    "media1.giphy.com",
    "media2.giphy.com",
    "media3.giphy.com",
    "media4.giphy.com",
  ];
  const isAllowed = allowedHosts.some(
    (host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`)
  );
  if (!isAllowed) {
    res.status(403).json({ error: "URL host not allowed" });
    return;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000);

    const upstream = await fetch(rawUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; ClipScout/1.0)",
      },
    });

    clearTimeout(timer);

    if (!upstream.ok) {
      res.status(502).json({ error: `Upstream returned ${upstream.status}` });
      return;
    }

    const contentType = upstream.headers.get("content-type") ?? "video/mp4";
    const contentLength = upstream.headers.get("content-length");

    res.setHeader("Content-Type", contentType);
    res.setHeader("Access-Control-Allow-Origin", "*");
    if (contentLength) res.setHeader("Content-Length", contentLength);
    res.setHeader("Cache-Control", "no-store");

    if (upstream.body) {
      const reader = upstream.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
    }

    res.end();
  } catch (err) {
    const isAbort = (err as Error)?.name === "AbortError";
    if (!res.headersSent) {
      res.status(isAbort ? 504 : 502).json({ error: isAbort ? "Download timed out" : "Download failed" });
    }
  }
});

export default router;
