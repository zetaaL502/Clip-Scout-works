import { Router, type Request, type Response } from "express";
import archiver from "archiver";
import QRCode from "qrcode";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import https from "node:https";
import http from "node:http";

const router = Router();

const EXPORTS_DIR = "/tmp/exports";
const AUTO_DELETE_MS = 60 * 60 * 1000;

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

function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);

    function fetch(targetUrl: string) {
      const protocol = targetUrl.startsWith("https") ? https : http;
      protocol
        .get(targetUrl, (response) => {
          if (
            (response.statusCode === 301 || response.statusCode === 302) &&
            response.headers.location
          ) {
            file.close();
            fetch(response.headers.location);
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

    fetch(url);
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
    const destPath = path.join(jobDir, filename);
    try {
      await downloadFile(urls[i], destPath);
    } catch {
      // skip failed clips, continue with the rest
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
    archive.directory(jobDir, false);
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
