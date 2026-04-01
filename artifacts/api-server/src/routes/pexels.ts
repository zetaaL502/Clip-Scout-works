import { Router, type IRouter } from "express";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createReadStream, unlinkSync, statSync } from "node:fs";
import { randomUUID } from "node:crypto";

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
        duration?: number;
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
          duration: video.duration,
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

const MAX_CLIP_SECONDS = 30;

function makeTmpPath(): string {
  return join(tmpdir(), `clipscout-${randomUUID()}.mp4`);
}

function cleanupTmp(path: string): void {
  try { unlinkSync(path); } catch { /* ignore */ }
}

// Runs FFmpeg with stdin piped from `feedFn`, output written to a temp file.
// Returns the temp file path on success. The caller must delete the temp file.
// Using a real output file (not pipe:1) lets FFmpeg write a proper moov atom with
// correct duration — fragmented/empty_moov variants cause editing apps to show 0s duration.
async function runFfmpegTrim(
  feedFn: (stdin: NodeJS.WritableStream) => void,
  logWarn: (msg: string) => void,
  logError: (msg: string) => void,
): Promise<string> {
  const tmpPath = makeTmpPath();

  const ffmpeg = spawn("ffmpeg", [
    "-loglevel", "error",
    "-i", "pipe:0",
    "-t", String(MAX_CLIP_SECONDS),
    "-c", "copy",
    "-movflags", "+faststart",  // relocate moov to front; correct duration written after copy
    tmpPath,                     // real file output — FFmpeg writes proper duration metadata
  ], { stdio: ["pipe", "pipe", "pipe"] });

  feedFn(ffmpeg.stdin);

  const stderrChunks: string[] = [];
  ffmpeg.stderr.on("data", (chunk: Buffer) => {
    stderrChunks.push(chunk.toString());
  });

  await new Promise<void>((resolve, reject) => {
    ffmpeg.on("error", (err) => {
      logError(`ffmpeg spawn error: ${err.message}`);
      reject(err);
    });
    ffmpeg.on("close", (code) => {
      if (stderrChunks.length > 0) logWarn(stderrChunks.join(""));
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`FFmpeg exited with code ${code}`));
      }
    });
  });

  return tmpPath;
}

// Streams a completed temp file as the HTTP response and then deletes it.
function sendTmpFile(tmpPath: string, res: import("express").Response): void {
  let stat: ReturnType<typeof statSync>;
  try {
    stat = statSync(tmpPath);
  } catch {
    cleanupTmp(tmpPath);
    if (!res.headersSent) res.status(500).json({ error: "Temp file missing after trim" });
    return;
  }

  res.setHeader("Content-Type", "video/mp4");
  res.setHeader("Content-Length", stat.size);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");

  const stream = createReadStream(tmpPath);
  stream.pipe(res);
  stream.on("close", () => cleanupTmp(tmpPath));
  stream.on("error", () => cleanupTmp(tmpPath));
}

// Receives a raw MP4 video blob from the browser, trims it and returns a proper MP4.
router.post("/trim-video", async (req, res) => {
  let tmpPath: string | null = null;
  try {
    tmpPath = await runFfmpegTrim(
      (stdin) => { req.pipe(stdin); req.on("error", () => stdin.destroy()); },
      (msg) => req.log.warn({ msg }, "ffmpeg trim stderr"),
      (msg) => req.log.error({ msg }, "ffmpeg trim error"),
    );
    sendTmpFile(tmpPath, res);
  } catch {
    if (tmpPath) cleanupTmp(tmpPath);
    if (!res.headersSent) res.status(500).json({ error: "Trim failed" });
  }
});

// Accepts a Pexels CDN URL, fetches it server-side, trims to MAX_CLIP_SECONDS,
// and returns a proper MP4 with correct duration metadata.
router.post("/trim-video-url", async (req, res) => {
  const { url } = req.body as { url?: string };
  if (!url || typeof url !== "string") {
    res.status(400).json({ error: "url is required" });
    return;
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    res.status(400).json({ error: "Invalid URL" });
    return;
  }

  const ALLOWED_TRIM_HOSTS = ["videos.pexels.com"];
  const isAllowed = ALLOWED_TRIM_HOSTS.some(
    (h) => parsed.hostname === h || parsed.hostname.endsWith(`.${h}`)
  );
  if (!isAllowed) {
    res.status(403).json({ error: "URL host not allowed" });
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90000);

  let tmpPath: string | null = null;
  try {
    const upstream = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Referer": "https://www.pexels.com/",
        "Accept": "video/webm,video/mp4,video/*,*/*;q=0.9",
      },
    });

    clearTimeout(timer);

    if (!upstream.ok || !upstream.body) {
      res.status(502).json({ error: `Upstream returned ${upstream.status}` });
      return;
    }

    const upstreamBody = upstream.body;
    tmpPath = await runFfmpegTrim(
      (stdin) => {
        const reader = upstreamBody.getReader();
        (async () => {
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) { stdin.end(); break; }
              if (!stdin.write(value)) {
                await new Promise<void>((resolve) => stdin.once("drain", resolve));
              }
            }
          } catch { stdin.destroy(); }
        })();
      },
      (msg) => req.log.warn({ msg }, "ffmpeg trim-url stderr"),
      (msg) => req.log.error({ msg }, "ffmpeg trim-url error"),
    );

    sendTmpFile(tmpPath, res);
  } catch (err) {
    clearTimeout(timer);
    if (tmpPath) cleanupTmp(tmpPath);
    const isAbort = (err as Error)?.name === "AbortError";
    if (!res.headersSent) {
      res.status(isAbort ? 504 : 502).json({ error: isAbort ? "Fetch timed out" : "Failed to fetch video" });
    }
  }
});

const ALLOWED_CDN_HOSTS = [
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

// Legacy proxy kept for GIF passthrough only — MP4s go through /trim-video instead.
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

  const isAllowed = ALLOWED_CDN_HOSTS.some(
    (host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`)
  );
  if (!isAllowed) {
    res.status(403).json({ error: "URL host not allowed" });
    return;
  }

  // Determine if this is a GIF (Giphy) — skip FFmpeg trimming for GIFs
  const isGif =
    parsed.pathname.endsWith(".gif") ||
    rawUrl.includes("giphy.com") ||
    rawUrl.includes("giphy-media");

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 90000);

    const upstream = await fetch(rawUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Referer": "https://www.pexels.com/",
        "Accept": "video/webm,video/mp4,video/*,*/*;q=0.9",
        "Accept-Language": "en-US,en;q=0.9",
        "Origin": "https://www.pexels.com",
      },
    });

    clearTimeout(timer);

    if (!upstream.ok) {
      res.status(502).json({ error: `Upstream returned ${upstream.status}` });
      return;
    }

    if (!upstream.body) {
      res.status(502).json({ error: "Empty upstream body" });
      return;
    }

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "no-store");

    if (isGif) {
      // Stream GIFs through unchanged
      const contentType = upstream.headers.get("content-type") ?? "image/gif";
      const contentLength = upstream.headers.get("content-length");
      res.setHeader("Content-Type", contentType);
      if (contentLength) res.setHeader("Content-Length", contentLength);

      const reader = upstream.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
      res.end();
      return;
    }

    // MP4 — trim to MAX_CLIP_SECONDS seconds using FFmpeg (stream copy, no re-encode)
    res.setHeader("Content-Type", "video/mp4");

    const ffmpeg = spawn("ffmpeg", [
      "-loglevel", "error",
      "-i", "pipe:0",                          // read source video from stdin
      "-t", String(MAX_CLIP_SECONDS),           // trim to 30 seconds maximum
      "-c", "copy",                             // stream copy — no re-encoding, very fast
      "-f", "mp4",
      "-movflags", "frag_keyframe+empty_moov", // fragmented MP4 — streamable without seeking
      "pipe:1",                                 // write trimmed video to stdout
    ], { stdio: ["pipe", "pipe", "pipe"] });

    // Forward FFmpeg stdout → HTTP response
    ffmpeg.stdout.pipe(res);

    // Pump the upstream response body into FFmpeg stdin
    const reader = upstream.body.getReader();
    (async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            ffmpeg.stdin.end();
            break;
          }
          if (!ffmpeg.stdin.write(value)) {
            // Respect backpressure
            await new Promise<void>((resolve) => ffmpeg.stdin.once("drain", resolve));
          }
        }
      } catch {
        ffmpeg.stdin.destroy();
      }
    })();

    ffmpeg.stderr.on("data", (chunk: Buffer) => {
      req.log.warn({ msg: chunk.toString() }, "ffmpeg stderr");
    });

    ffmpeg.on("error", (err) => {
      req.log.error({ err }, "ffmpeg spawn error");
      if (!res.headersSent) res.status(500).end();
      else res.end();
    });

    // Wait for FFmpeg to finish before logging completion
    await new Promise<void>((resolve) => ffmpeg.on("close", resolve));

  } catch (err) {
    const isAbort = (err as Error)?.name === "AbortError";
    if (!res.headersSent) {
      res.status(isAbort ? 504 : 502).json({
        error: isAbort ? "Download timed out" : "Download failed",
      });
    }
  }
});

export default router;
