import { Router, type IRouter } from "express";

const router: IRouter = Router();

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
    const url = `https://api.pexels.com/videos/search?query=${encodeURIComponent(keywords)}&per_page=4&page=${page}`;
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
        video_files: Array<{ quality: string; link: string; file_type: string }>;
      }>;
    };

    const clips = (data.videos ?? []).map((video) => {
      const hdFile =
        video.video_files.find((f) => f.quality === "hd" && f.file_type === "video/mp4") ??
        video.video_files.find((f) => f.file_type === "video/mp4") ??
        video.video_files[0];
      return {
        id: String(video.id),
        thumbnail_url: video.image,
        media_url: hdFile?.link ?? "",
      };
    });

    res.json(clips);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch from Pexels");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
