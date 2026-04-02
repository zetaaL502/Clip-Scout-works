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

const EXPORTS_DIR = "/tmp/exports";
const AUTO_DELETE_MS = 60 * 60 * 1000;
const MAX_CLIP_SECONDS = 30;
const ZIP_FOLDER_NAME = "youtube_export"; // must match the computer export folder name

type JobStatus = "processing" | "done" | "error";

interface Job {
  status: JobStatus;
  current: number;
  total: number;
  zipId?: string;
  qrDataUrl?: string;
  error?: string;
}

const jobs = new Map<string, Job>();
const zipFiles = new Map<string, { filePath: string; timer: ReturnType<typeof setTimeout> }>();

fsp.mkdir(EXPORTS_DIR, { recursive: true }).catch(() => {});

router.post("/server-export", async (req: Request, res: Response) => {
  const { urls } = req.body as { urls?: unknown };

  if (!Array.isArray(urls) || urls.length === 0) {
    res.status(400).json({ error: "urls array is required" });
    return;
  }

  const stringUrls = (urls as unknown[]).filter((u): u is string => typeof u === "string");
  if (stringUrls.length === 0) {
    res.status(400).json({ error: "urls must be an array of strings" });
    return;
  }

  const jobId = randomUUID();
  jobs.set(jobId, { status: "processing", current: 0, total: stringUrls.length });
  res.json({ jobId });

  const origin =
    (req.headers.origin as string | undefined) ||
    `${req.protocol}://${req.headers.host}`;

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
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);

    function fetchUrl(targetUrl: string) {
      const protocol = targetUrl.startsWith("https") ? https : http;
      protocol
        .get(targetUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            "Referer": "https://www.pexels.com/",
            "Accept": "video/webm,video/mp4,video/*,*/*;q=0.9",
          },
        }, (response) => {
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
        })
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
function fixVideoMetadata(inputPath: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", [
      "-loglevel", "error",
      "-i", inputPath,
      "-t", String(MAX_CLIP_SECONDS),
      "-c", "copy",
      "-movflags", "+faststart",
      outputPath,
    ], { stdio: ["ignore", "ignore", "pipe"] });

    const stderrChunks: string[] = [];
    ffmpeg.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk.toString()));

    ffmpeg.on("error", reject);
    ffmpeg.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`FFmpeg exited with code ${code}: ${stderrChunks.join("")}`));
      }
    });
  });
}

async function processExport(jobId: string, urls: string[], origin: string): Promise<void> {
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
