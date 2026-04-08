import { Router } from "express";
import path from "path";
import fs from "fs";
import { randomUUID } from "node:crypto";
import { logger } from "../../lib/logger";
import { generateAudio } from "../../utils/kokoroTTS";
import { spawn } from "child_process";

const router = Router();

interface ScriptLine {
  index: number;
  character: string;
  text: string;
  voice: string;
}

interface AudioJob {
  jobId: string;
  status: "pending" | "running" | "done" | "error";
  completed: number;
  total: number;
  failedLines: number[];
  durations: Record<number, number>;
  lines: ScriptLine[];
  dir: string;
  apiKey?: string;
}

export const jobs = new Map<string, AudioJob>();

function getAudioDir(jobId: string): string {
  const dir = path.join("/tmp", "audio_jobs", jobId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function getAudioDuration(filePath: string): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      filePath,
    ]);
    let output = "";
    child.stdout.on("data", (d) => (output += d.toString()));
    child.on("close", () => {
      const dur = parseFloat(output.trim());
      resolve(isNaN(dur) ? 3.0 : dur);
    });
  });
}

async function generateLine(job: AudioJob, line: ScriptLine): Promise<void> {
  const outputFile = path.join(
    job.dir,
    `line_${String(line.index).padStart(3, "0")}.mp3`,
  );

  try {
    await generateAudio(line.text, line.voice, outputFile);

    if (!fs.existsSync(outputFile)) {
      throw new Error("Output file not created");
    }

    const dur = await getAudioDuration(outputFile);
    job.durations[line.index] = dur;
  } catch (e) {
    logger.warn({ line: line.index, e }, "TTS failed for line");
    job.failedLines.push(line.index);
  }

  job.completed++;
  if (job.completed >= job.total) {
    job.status = "done";
  }
}

async function processJob(job: AudioJob): Promise<void> {
  job.status = "running";
  for (let i = 0; i < job.lines.length; i++) {
    const line = job.lines[i];
    await generateLine(job, line);

    // Wait 4.1 seconds between generations to strictly prevent hitting Gemini API 15 RPM limit
    if (i < job.lines.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 4100));
    }
  }
  job.status = "done";
}

router.post("/imessage/generate-audio", async (req, res): Promise<void> => {
  const { lines, apiKey } = req.body as {
    lines?: ScriptLine[];
    apiKey?: string;
  };

  if (!lines || !Array.isArray(lines) || lines.length === 0) {
    res.status(400).json({ error: "lines array is required" });
    return;
  }

  const jobId = randomUUID();
  const dir = getAudioDir(jobId);

  const job: AudioJob = {
    jobId,
    status: "pending",
    completed: 0,
    total: lines.length,
    failedLines: [],
    durations: {},
    lines,
    dir,
    apiKey,
  };

  jobs.set(jobId, job);

  processJob(job).catch((err) => {
    logger.error({ err, jobId }, "Audio generation job failed");
    job.status = "error";
  });

  res.json({ jobId, totalLines: lines.length });
});

router.get(
  "/imessage/audio-progress/:jobId",
  async (req, res): Promise<void> => {
    const jobId = Array.isArray(req.params.jobId)
      ? req.params.jobId[0]
      : req.params.jobId;
    const job = jobs.get(jobId);

    if (!job) {
      res.status(404).json({ error: "Job not found" });
      return;
    }

    res.json({
      jobId: job.jobId,
      status: job.status,
      completed: job.completed,
      total: job.total,
      failedLines: job.failedLines,
      durations: job.durations,
    });
  },
);

router.get(
  "/imessage/audio-file/:jobId/:lineIndex",
  async (req, res): Promise<void> => {
    const jobId = Array.isArray(req.params.jobId)
      ? req.params.jobId[0]
      : req.params.jobId;
    const lineIndex = parseInt(
      Array.isArray(req.params.lineIndex)
        ? req.params.lineIndex[0]
        : req.params.lineIndex,
      10,
    );

    const job = jobs.get(jobId);
    if (!job) {
      res.status(404).json({ error: "Job not found" });
      return;
    }

    const filePath = path.join(
      job.dir,
      `line_${String(lineIndex).padStart(3, "0")}.mp3`,
    );

    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: "Audio file not found" });
      return;
    }

    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="line_${lineIndex}.mp3"`,
    );
    fs.createReadStream(filePath).pipe(res);
  },
);

router.get(
  "/imessage/audio-download/:jobId",
  async (req, res): Promise<void> => {
    const jobId = Array.isArray(req.params.jobId)
      ? req.params.jobId[0]
      : req.params.jobId;

    const job = jobs.get(jobId);
    if (!job) {
      res.status(404).json({ error: "Job not found" });
      return;
    }

    if (job.status !== "done") {
      res
        .status(400)
        .json({ error: "Audio not ready yet", status: job.status });
      return;
    }

    const outputPath = path.join(job.dir, "combined.mp3");

    const inputFiles: string[] = [];
    for (let i = 0; i < job.total; i++) {
      const f = path.join(job.dir, `line_${String(i).padStart(3, "0")}.mp3`);
      if (fs.existsSync(f)) {
        inputFiles.push(f);
      }
    }

    if (inputFiles.length === 0) {
      res.status(404).json({ error: "No audio files found" });
      return;
    }

    if (inputFiles.length === 1) {
      res.setHeader("Content-Type", "audio/mpeg");
      res.setHeader("Content-Disposition", 'attachment; filename="audio.mp3"');
      fs.createReadStream(inputFiles[0]).pipe(res);
      return;
    }

    const listFile = path.join(job.dir, "concat_list.txt");
    fs.writeFileSync(
      listFile,
      inputFiles.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join("\n"),
    );

    const child = spawn("ffmpeg", [
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      listFile,
      "-acodec",
      "libmp3lame",
      "-b:a",
      "192k",
      outputPath,
    ]);

    child.on("close", (code) => {
      try {
        fs.unlinkSync(listFile);
      } catch (_) {}
      if (code === 0 && fs.existsSync(outputPath)) {
        res.setHeader("Content-Type", "audio/mpeg");
        res.setHeader(
          "Content-Disposition",
          'attachment; filename="audio.mp3"',
        );
        fs.createReadStream(outputPath).pipe(res);
      } else {
        res.status(500).json({ error: "Failed to combine audio files" });
      }
    });

    child.on("error", () => {
      try {
        fs.unlinkSync(listFile);
      } catch (_) {}
      res.status(500).json({ error: "FFmpeg error" });
    });
  },
);

export default router;
