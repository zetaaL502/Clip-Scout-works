import { Router, type Request, type Response } from "express";
import archiver from "archiver";
import QRCode from "qrcode";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import https from "node:https";
import http from "node:http";

const router = Router();

const EXPORTS_DIR =
  process.platform === "win32"
    ? path.join(process.env.TEMP || "C:\\Windows\\Temp", "clipscout_exports")
    : "/tmp/exports";
const AUTO_DELETE_MS = 60 * 60 * 1000;
const MAX_CLIP_SECONDS = 30;
const ZIP_FOLDER_NAME = "youtube_export";
const IMAGE_DURATION = 5; // images get exactly 5 seconds

const FFmpeg_PATH =
  process.platform === "win32"
    ? "C:\\Users\\Galaxy\\Downloads\\ffmpeg-master-latest-win64-gpl\\ffmpeg-master-latest-win64-gpl\\bin\\ffmpeg.exe"
    : "ffmpeg";

type JobStatus = "processing" | "done" | "error";

interface Job {
  status: JobStatus;
  current: number;
  total: number;
  zipId?: string;
  qrDataUrl?: string;
  error?: string;
}

// NEW FEATURE: Multi-video per segment duration division, trimming and stitching
interface ExportSegment {
  urls: string[];
  duration: number; // segment duration in seconds (e.g. 15, 20, 30)
  types: ("image" | "video")[]; // identify images vs videos
}

const jobs = new Map<string, Job>();
const zipFiles = new Map<
  string,
  { filePath: string; timer: ReturnType<typeof setTimeout> }
>();

fsp.mkdir(EXPORTS_DIR, { recursive: true }).catch(() => {});

router.post("/server-export", async (req: Request, res: Response) => {
  // NEW FEATURE: Multi-video per segment duration division, trimming and stitching
  // Accept either { segments: ExportSegment[] } (new) or { urls: string[] } (legacy)
  const { urls, segments } = req.body as { urls?: unknown; segments?: unknown };

  const origin =
    (req.headers.origin as string | undefined) ||
    `${req.protocol}://${req.headers.host}`;

  if (Array.isArray(segments) && segments.length > 0) {
    // New format: per-segment grouping with duration info
    const validSegments = (segments as unknown[]).filter(
      (s): s is ExportSegment =>
        s !== null &&
        typeof s === "object" &&
        Array.isArray((s as ExportSegment).urls) &&
        (s as ExportSegment).urls.length > 0 &&
        typeof (s as ExportSegment).duration === "number",
    );
    if (validSegments.length === 0) {
      res.status(400).json({
        error: "segments must be a non-empty array of {urls, duration}",
      });
      return;
    }

    const jobId = randomUUID();
    jobs.set(jobId, {
      status: "processing",
      current: 0,
      total: validSegments.length,
    });
    res.json({ jobId });
    processSegmentsExport(jobId, validSegments, origin).catch((err: Error) => {
      const job = jobs.get(jobId);
      if (job) {
        job.status = "error";
        job.error = err.message;
      }
    });
    return;
  }

  // Legacy flat-urls format
  if (!Array.isArray(urls) || urls.length === 0) {
    res.status(400).json({ error: "urls array is required" });
    return;
  }

  const stringUrls = (urls as unknown[]).filter(
    (u): u is string => typeof u === "string",
  );
  if (stringUrls.length === 0) {
    res.status(400).json({ error: "urls must be an array of strings" });
    return;
  }

  const jobId = randomUUID();
  jobs.set(jobId, {
    status: "processing",
    current: 0,
    total: stringUrls.length,
  });
  res.json({ jobId });

  processExport(jobId, stringUrls, origin).catch((err: Error) => {
    const job = jobs.get(jobId);
    if (job) {
      job.status = "error";
      job.error = err.message;
    }
  });
});

router.get("/export-progress/:jobId", (req: Request, res: Response) => {
  const { jobId } = req.params;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const send = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  const interval = setInterval(() => {
    const job = jobs.get(jobId);
    if (!job) {
      send({ error: "Job not found" });
      clearInterval(interval);
      res.end();
      return;
    }

    send({
      current: job.current,
      total: job.total,
      status: job.status,
      zipId: job.zipId ?? null,
      qrDataUrl: job.qrDataUrl ?? null,
      error: job.error ?? null,
    });

    if (job.status === "done" || job.status === "error") {
      clearInterval(interval);
      res.end();
    }
  }, 500);

  req.on("close", () => clearInterval(interval));
});

router.get("/download/:zipId", (req: Request, res: Response) => {
  const { zipId } = req.params;
  const entry = zipFiles.get(zipId);

  if (!entry || !fs.existsSync(entry.filePath)) {
    res.status(404).json({ error: "File not found or expired" });
    return;
  }

  const filename = `Project_Videos_${zipId.slice(0, 8)}.zip`;
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Content-Type", "application/zip");
  fs.createReadStream(entry.filePath).pipe(res);
});

// Download a URL to a file path, following redirects.
function downloadFile(url: string, dest: string): Promise<void> {
  // Handle data URLs (base64 custom uploads)
  if (url.startsWith("data:")) {
    return new Promise((resolve, reject) => {
      try {
        const base64Data = url.split(",")[1];
        if (!base64Data) {
          reject(new Error("Invalid data URL"));
          return;
        }
        const buffer = Buffer.from(base64Data, "base64");
        fs.writeFileSync(dest, buffer);
        resolve();
      } catch (err) {
        reject(err);
      }
    });
  }

  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);

    function fetchUrl(targetUrl: string) {
      const protocol = targetUrl.startsWith("https") ? https : http;
      const isGiphy =
        targetUrl.includes("giphy.com") || targetUrl.includes("giphy-media");

      protocol
        .get(
          targetUrl,
          {
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
              Referer: isGiphy
                ? "https://giphy.com/"
                : "https://www.pexels.com/",
              Accept: isGiphy
                ? "image/gif,*/*;q=0.9"
                : "video/webm,video/mp4,video/*,*/*;q=0.9",
            },
          },
          (response) => {
            if (
              (response.statusCode === 301 || response.statusCode === 302) &&
              response.headers.location
            ) {
              // redirect — don't write to file yet, follow the redirect
              fetchUrl(response.headers.location);
              return;
            }
            response.pipe(file);
            file.on("finish", () => file.close(() => resolve()));
            response.on("error", (err) => {
              fsp.unlink(dest).catch(() => {});
              reject(err);
            });
          },
        )
        .on("error", (err) => {
          fsp.unlink(dest).catch(() => {});
          reject(err);
        });
    }

    fetchUrl(url);
  });
}

// Run FFmpeg on an already-downloaded file to fix MP4 metadata.
// Identical fix to /trim-video-url: outputs to a real file with +faststart
// so editing apps (VN, CapCut, etc.) see the correct duration.
function fixVideoMetadata(
  inputPath: string,
  outputPath: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn(
      FFmpeg_PATH,
      [
        "-loglevel",
        "error",
        "-i",
        inputPath,
        "-t",
        String(MAX_CLIP_SECONDS),
        "-c",
        "copy",
        "-movflags",
        "+faststart",
        outputPath,
      ],
      { stdio: ["ignore", "ignore", "pipe"] },
    );

    const stderrChunks: string[] = [];
    ffmpeg.stderr.on("data", (chunk: Buffer) =>
      stderrChunks.push(chunk.toString()),
    );

    ffmpeg.on("error", reject);
    ffmpeg.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(
            `FFmpeg exited with code ${code}: ${stderrChunks.join("")}`,
          ),
        );
      }
    });
  });
}

// Probe the actual duration of a downloaded video file using FFmpeg.
// Returns 0 if the duration cannot be determined.
function getVideoDuration(filePath: string): Promise<number> {
  return new Promise((resolve) => {
    const ffmpeg = spawn(
      FFmpeg_PATH,
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        filePath,
      ],
      { stdio: ["ignore", "pipe", "ignore"] },
    );

    let stdout = "";
    ffmpeg.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    ffmpeg.on("error", () => resolve(0));
    ffmpeg.on("close", () => {
      const parsed = parseFloat(stdout.trim());
      resolve(isNaN(parsed) ? 0 : parsed);
    });
  });
}

// NEW FEATURE: Multi-video per segment duration division, trimming and stitching
// Trim a video file to exactly `durationSecs` seconds, re-encoding to h264/aac for consistent format.
// If the source is shorter than durationSecs FFmpeg simply outputs the full source (no error).
function trimVideo(
  inputPath: string,
  outputPath: string,
  durationSecs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn(
      FFmpeg_PATH,
      [
        "-loglevel",
        "error",
        "-i",
        inputPath,
        "-t",
        durationSecs.toFixed(3),
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-crf",
        "28",
        "-c:a",
        "aac",
        "-movflags",
        "+faststart",
        outputPath,
      ],
      { stdio: ["ignore", "ignore", "pipe"] },
    );

    const stderrChunks: string[] = [];
    ffmpeg.stderr.on("data", (chunk: Buffer) =>
      stderrChunks.push(chunk.toString()),
    );
    ffmpeg.on("error", reject);
    ffmpeg.on("close", (code) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(
            `FFmpeg trim failed (code ${code}): ${stderrChunks.join("")}`,
          ),
        );
    });
  });
}

// Loop a video seamlessly using -stream_loop -1 then trim to exactly `targetSecs`.
// Used when the source clip is shorter than the target sub-duration.
function loopAndTrimVideo(
  inputPath: string,
  outputPath: string,
  targetSecs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn(
      FFmpeg_PATH,
      [
        "-loglevel",
        "error",
        "-stream_loop",
        "-1",
        "-i",
        inputPath,
        "-t",
        targetSecs.toFixed(3),
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-crf",
        "23",
        "-c:a",
        "aac",
        "-movflags",
        "+faststart",
        outputPath,
      ],
      { stdio: ["ignore", "ignore", "pipe"] },
    );

    const stderrChunks: string[] = [];
    ffmpeg.stderr.on("data", (chunk: Buffer) =>
      stderrChunks.push(chunk.toString()),
    );
    ffmpeg.on("error", reject);
    ffmpeg.on("close", (code) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(
            `FFmpeg loop failed (code ${code}): ${stderrChunks.join("")}`,
          ),
        );
    });
  });
}

// NEW FEATURE: Multi-video per segment duration division, trimming and stitching
// Concatenate multiple video files (all same codec) into a single output using FFmpeg concat demuxer.
async function stitchVideos(
  inputPaths: string[],
  outputPath: string,
  tempDir: string,
): Promise<void> {
  if (inputPaths.length === 1) {
    await fsp.copyFile(inputPaths[0], outputPath);
    return;
  }
  const listFile = path.join(
    tempDir,
    `concat_${Date.now()}_${Math.random().toString(36).slice(2)}.txt`,
  );
  const listContent = inputPaths.map((p) => `file '${p}'`).join("\n");
  await fsp.writeFile(listFile, listContent, "utf8");
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn(
      FFmpeg_PATH,
      [
        "-loglevel",
        "error",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        listFile,
        "-c",
        "copy",
        "-movflags",
        "+faststart",
        outputPath,
      ],
      { stdio: ["ignore", "ignore", "pipe"] },
    );

    const stderrChunks: string[] = [];
    ffmpeg.stderr.on("data", (chunk: Buffer) =>
      stderrChunks.push(chunk.toString()),
    );
    ffmpeg.on("error", (err) => {
      fsp.unlink(listFile).catch(() => {});
      reject(err);
    });
    ffmpeg.on("close", (code) => {
      fsp.unlink(listFile).catch(() => {});
      if (code === 0) resolve();
      else
        reject(
          new Error(
            `FFmpeg stitch failed (code ${code}): ${stderrChunks.join("")}`,
          ),
        );
    });
  });
}

// Convert an image to a video with exact duration
function imageToVideo(
  inputPath: string,
  outputPath: string,
  durationSecs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn(
      FFmpeg_PATH,
      [
        "-loop",
        "1",
        "-i",
        inputPath,
        "-t",
        durationSecs.toFixed(3),
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-crf",
        "28",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        outputPath,
      ],
      { stdio: ["ignore", "ignore", "pipe"] },
    );

    const stderrChunks: string[] = [];
    ffmpeg.stderr.on("data", (chunk: Buffer) =>
      stderrChunks.push(chunk.toString()),
    );
    ffmpeg.on("error", reject);
    ffmpeg.on("close", (code) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(
            `FFmpeg image->video failed (code ${code}): ${stderrChunks.join("")}`,
          ),
        );
    });
  });
}

// NEW FEATURE: Multi-video per segment duration division, trimming and stitching
// For each segment: divide its duration equally among N selected clips, trim each, stitch per segment,
// then stitch all segments into one master video and deliver via the existing QR/download flow.
async function processSegmentsExport(
  jobId: string,
  segments: ExportSegment[],
  origin: string,
): Promise<void> {
  const job = jobs.get(jobId);
  if (!job) return;

  await fsp.mkdir(EXPORTS_DIR, { recursive: true });
  const jobDir = path.join(EXPORTS_DIR, jobId);
  await fsp.mkdir(jobDir, { recursive: true });

  const segmentOutputPaths: string[] = [];

  for (let segIdx = 0; segIdx < segments.length; segIdx++) {
    const { urls, duration, types } = segments[segIdx];
    const N = urls.length;

    // Count images (each gets exactly 5 seconds)
    const imageCount = types.filter((t) => t === "image").length;
    const videoCount = N - imageCount;

    // Calculate duration per clip: images = 5s, videos split remaining time
    const remainingDuration = Math.max(
      0,
      duration - imageCount * IMAGE_DURATION,
    );
    const videoDuration = videoCount > 0 ? remainingDuration / videoCount : 0;

    const trimmedPaths: string[] = [];

    for (let clipIdx = 0; clipIdx < N; clipIdx++) {
      const clipType = types[clipIdx];
      const ext = clipType === "image" ? ".jpg" : ".mp4";
      const rawPath = path.join(
        jobDir,
        `seg${segIdx}_clip${clipIdx}.raw${ext}`,
      );
      const trimmedPath = path.join(jobDir, `seg${segIdx}_clip${clipIdx}.mp4`);
      const targetDuration =
        clipType === "image" ? IMAGE_DURATION : videoDuration;

      try {
        await downloadFile(urls[clipIdx], rawPath);

        if (clipType === "image") {
          await imageToVideo(rawPath, trimmedPath, IMAGE_DURATION);
        } else {
          const actualDuration = await getVideoDuration(rawPath);

          if (actualDuration > 0 && actualDuration < targetDuration - 0.1) {
            await loopAndTrimVideo(rawPath, trimmedPath, targetDuration);
          } else {
            await trimVideo(rawPath, trimmedPath, targetDuration);
          }
        }

        await fsp.unlink(rawPath).catch(() => {});
        trimmedPaths.push(trimmedPath);
      } catch (err) {
        console.error(
          `[export] FAIL: segment ${segIdx} clip ${clipIdx}: ${err}`,
        );
        await fsp.unlink(rawPath).catch(() => {});
        await fsp.unlink(trimmedPath).catch(() => {});
      }
    }

    if (trimmedPaths.length === 0) {
      job.current = segIdx + 1;
      continue;
    }

    const segOutputPath = path.join(
      jobDir,
      `segment_${String(segIdx).padStart(3, "0")}.mp4`,
    );
    if (trimmedPaths.length === 1) {
      await fsp.rename(trimmedPaths[0], segOutputPath);
    } else {
      await stitchVideos(trimmedPaths, segOutputPath, jobDir);
      for (const p of trimmedPaths) await fsp.unlink(p).catch(() => {});
    }

    segmentOutputPaths.push(segOutputPath);
    job.current = segIdx + 1;
  }

  if (segmentOutputPaths.length === 0) {
    job.status = "error";
    job.error = "No segments could be processed";
    return;
  }

  // Package each segment as a numbered file (001.mp4, 002.mp4, …)
  const zipId = randomUUID();
  const zipPath = path.join(EXPORTS_DIR, `export_${zipId}.zip`);

  await new Promise<void>((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver("zip", { zlib: { level: 6 } });
    output.on("close", resolve);
    archive.on("error", reject);
    archive.pipe(output);
    segmentOutputPaths.forEach((segPath, i) => {
      const filename = String(i + 1).padStart(3, "0") + ".mp4";
      archive.file(segPath, { name: `${ZIP_FOLDER_NAME}/${filename}` });
    });
    archive.finalize();
  });

  await fsp.rm(jobDir, { recursive: true, force: true });

  const downloadUrl = `${origin}/api/download/${zipId}`;
  const qrDataUrl = await QRCode.toDataURL(downloadUrl, {
    width: 300,
    margin: 2,
    color: { dark: "#000000", light: "#ffffff" },
  });

  const timer = setTimeout(async () => {
    await fsp.unlink(zipPath).catch(() => {});
    zipFiles.delete(zipId);
    jobs.delete(jobId);
  }, AUTO_DELETE_MS);

  zipFiles.set(zipId, { filePath: zipPath, timer });
  job.zipId = zipId;
  job.qrDataUrl = qrDataUrl;
  job.status = "done";
}

async function processExport(
  jobId: string,
  urls: string[],
  origin: string,
): Promise<void> {
  const job = jobs.get(jobId);
  if (!job) return;

  await fsp.mkdir(EXPORTS_DIR, { recursive: true });

  const jobDir = path.join(EXPORTS_DIR, jobId);
  await fsp.mkdir(jobDir, { recursive: true });

  for (let i = 0; i < urls.length; i++) {
    const filename = String(i + 1).padStart(3, "0") + ".mp4";
    const rawPath = path.join(jobDir, `${filename}.raw`);
    const finalPath = path.join(jobDir, filename);

    try {
      // Step 1: Download the raw file
      await downloadFile(urls[i], rawPath);

      // Step 2: Run FFmpeg to fix moov atom / duration metadata — identical to
      // what /trim-video-url does for the computer export. Without this, VN and
      // other mobile editors show 0s or 0.5s duration on Pexels clips.
      await fixVideoMetadata(rawPath, finalPath);

      // Step 3: Remove the raw file — only the fixed file goes into the ZIP
      await fsp.unlink(rawPath).catch(() => {});
    } catch {
      // Clean up any partial files and skip this clip
      await fsp.unlink(rawPath).catch(() => {});
      await fsp.unlink(finalPath).catch(() => {});
    }

    job.current = i + 1;
  }

  const zipId = randomUUID();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const zipFilename = `Project_Videos_${timestamp}.zip`;
  const zipPath = path.join(EXPORTS_DIR, zipFilename);

  await new Promise<void>((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver("zip", { zlib: { level: 6 } });
    output.on("close", resolve);
    archive.on("error", reject);
    archive.pipe(output);
    // Use ZIP_FOLDER_NAME as the folder inside the ZIP — matches the computer export exactly:
    // computer export produces youtube_export/001.mp4, youtube_export/002.mp4, etc.
    archive.directory(jobDir, ZIP_FOLDER_NAME);
    archive.finalize();
  });

  await fsp.rm(jobDir, { recursive: true, force: true });

  const downloadUrl = `${origin}/api/download/${zipId}`;
  const qrDataUrl = await QRCode.toDataURL(downloadUrl, {
    width: 300,
    margin: 2,
    color: { dark: "#000000", light: "#ffffff" },
  });

  const timer = setTimeout(async () => {
    await fsp.unlink(zipPath).catch(() => {});
    zipFiles.delete(zipId);
    jobs.delete(jobId);
  }, AUTO_DELETE_MS);

  zipFiles.set(zipId, { filePath: zipPath, timer });

  job.zipId = zipId;
  job.qrDataUrl = qrDataUrl;
  job.status = "done";
}

export default router;
