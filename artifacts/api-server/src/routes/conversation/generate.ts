import { Router } from "express";
import path from "path";
import fs from "fs";
import { randomUUID } from "node:crypto";
import { spawn } from "child_process";
import { logger } from "../../lib/logger";
import { generateAudio } from "../../utils/geminiTTS";

const router = Router();

interface ConvLine {
  text: string;
  voice: string;
  type: "text" | "image" | "video";
}

interface ConvJob {
  jobId: string;
  status: "pending" | "running" | "done" | "error";
  completed: number;
  total: number;
  errorMessage?: string;
  outputPath?: string;
}

const convJobs = new Map<string, ConvJob>();
const convDir = path.join("/tmp", "conversation_jobs");
fs.mkdirSync(convDir, { recursive: true });

function concatMp3Files(inputFiles: string[], outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const listFile = outputPath + ".list.txt";
    fs.writeFileSync(listFile, inputFiles.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join("\n"));
    const child = spawn("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", outputPath]);
    child.on("close", (code) => {
      try { fs.unlinkSync(listFile); } catch (_) {}
      code === 0 ? resolve() : reject(new Error(`ffmpeg concat code ${code}`));
    });
    child.on("error", (err) => { try { fs.unlinkSync(listFile); } catch (_) {} reject(err); });
  });
}

async function processConvJob(job: ConvJob, lines: ConvLine[]): Promise<void> {
  job.status = "running";
  const jobDir = path.join(convDir, job.jobId);
  fs.mkdirSync(jobDir, { recursive: true });

  const textLines = lines.filter((l) => l.type === "text" && l.text.trim());
  job.total = textLines.length;

  const lineMp3s: string[] = [];

  for (let i = 0; i < textLines.length; i++) {
    const line = textLines[i];
    const mp3Path = path.join(jobDir, `line_${String(i).padStart(3, "0")}.mp3`);
    try {
      await generateAudio(line.text, line.voice, mp3Path);
      lineMp3s.push(mp3Path);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.warn({ i, err: msg }, "Conversation line TTS failed, skipping");
    }
    job.completed = i + 1;
  }

  if (lineMp3s.length === 0) {
    job.status = "error";
    job.errorMessage = "No audio was generated. Check that GEMINI_API_KEY is set and the Gemini TTS model is reachable.";
    return;
  }

  const outputPath = path.join(convDir, `${job.jobId}_combined.mp3`);
  if (lineMp3s.length === 1) {
    fs.copyFileSync(lineMp3s[0], outputPath);
  } else {
    await concatMp3Files(lineMp3s, outputPath);
  }

  for (const f of lineMp3s) { try { fs.unlinkSync(f); } catch (_) {} }
  try { fs.rmdirSync(jobDir); } catch (_) {}

  job.outputPath = outputPath;
  job.status = "done";
}

router.post("/conversation/generate", async (req, res): Promise<void> => {
  if (!process.env.GEMINI_API_KEY) {
    res.status(500).json({ error: "GEMINI_API_KEY is not configured on the server." });
    return;
  }

  const { lines } = req.body as { lines?: ConvLine[] };
  if (!lines || !Array.isArray(lines) || lines.length === 0) {
    res.status(400).json({ error: "lines array is required" });
    return;
  }

  const jobId = randomUUID();
  const job: ConvJob = {
    jobId,
    status: "pending",
    completed: 0,
    total: lines.filter((l) => l.type === "text").length,
  };

  convJobs.set(jobId, job);

  processConvJob(job, lines).catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err: msg, jobId }, "Conversation generate job failed");
    job.status = "error";
    job.errorMessage = msg;
  });

  res.json({ jobId });
});

router.get("/conversation/progress/:jobId", async (req, res): Promise<void> => {
  const jobId = Array.isArray(req.params.jobId) ? req.params.jobId[0] : req.params.jobId;
  const job = convJobs.get(jobId);
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }
  res.json({ jobId: job.jobId, status: job.status, completed: job.completed, total: job.total, errorMessage: job.errorMessage });
});

router.get("/conversation/download/:jobId", async (req, res): Promise<void> => {
  const jobId = Array.isArray(req.params.jobId) ? req.params.jobId[0] : req.params.jobId;
  const job = convJobs.get(jobId);
  if (!job || job.status !== "done" || !job.outputPath) { res.status(404).json({ error: "Download not ready" }); return; }
  if (!fs.existsSync(job.outputPath)) { res.status(404).json({ error: "File missing" }); return; }
  res.setHeader("Content-Type", "audio/mpeg");
  res.setHeader("Content-Disposition", `attachment; filename="conversation_${jobId}.mp3"`);
  fs.createReadStream(job.outputPath).pipe(res);
});

export default router;
