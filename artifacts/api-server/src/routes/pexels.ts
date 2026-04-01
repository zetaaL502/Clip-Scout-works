import { Router, type IRouter } from "express";

const router: IRouter = Router();

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

router.post("/pexels-proxy", async (req, res) => {
  const apiKey = process.env["PEXELS_API_KEY"];
  if (!apiKey) {
    res.status(500).json({ error: "PEXELS_API_KEY not configured" });
    return;
  }

  const { keywords, page = 1 } = req.body as { keywords: string; page?: number };
  if (!keywords) {
    res.status(400).json({ error: "keywords is required" });
    return;
  }

  try {
    const url = `https://api.pexels.com/videos/search?query=${encodeURIComponent(keywords)}&per_page=20&page=${page}&min_duration=5&max_duration=30`;
    const pexelsRes = await fetch(url, {
      headers: { Authorization: apiKey },
    });

    if (!pexelsRes.ok) {
      const text = await pexelsRes.text();
      req.log.error({ status: pexelsRes.status, body: text }, "Pexels API error");
      res.status(502).json({ error: `Pexels error: ${pexelsRes.status}` });
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
    req.log.error({ err }, "Failed to fetch from Pexels");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/pexels-video/:videoId", async (req, res) => {
  const apiKey = process.env["PEXELS_API_KEY"];
  if (!apiKey) {
    res.status(500).json({ error: "PEXELS_API_KEY not configured" });
    return;
  }

  const videoId = req.params.videoId;
  if (!videoId) {
    res.status(400).json({ error: "videoId is required" });
    return;
  }

  try {
    const url = `https://api.pexels.com/videos/videos/${encodeURIComponent(videoId)}`;
    const pexelsRes = await fetch(url, {
      headers: { Authorization: apiKey },
    });

    if (!pexelsRes.ok) {
      const text = await pexelsRes.text();
      req.log.error({ status: pexelsRes.status, body: text, videoId }, "Pexels video API error");
      res.status(502).json({ error: `Pexels video error: ${pexelsRes.status}` });
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
    req.log.error({ err, videoId }, "Failed to fetch Pexels video details");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
