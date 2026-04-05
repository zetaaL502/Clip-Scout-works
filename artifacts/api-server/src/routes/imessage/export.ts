import { Router } from "express";
import path from "path";
import fs from "fs";
import { randomUUID } from "node:crypto";
import { logger } from "../../lib/logger";
import { jobs } from "./audio-generation";
import { fileRegistry } from "./upload";

const router = Router();

interface TimelineEntry {
  lineIndex: number;
  startTime: number;
  duration: number;
  type: "text" | "image";
}

interface ExportSettings {
  format: "9:16" | "16:9";
  backgroundVideoId?: string;
  backgroundMusicId?: string;
  darkMode: boolean;
  showFrame: boolean;
}

interface ExportJob {
  exportId: string;
  status: "pending" | "running" | "done" | "error";
  progress: number;
  errorMessage?: string;
  filename?: string;
  outputPath?: string;
}

const exportJobs = new Map<string, ExportJob>();
const exportDir = path.join("/tmp", "imessage_exports");
fs.mkdirSync(exportDir, { recursive: true });

async function runFFmpegExport(
  exportJob: ExportJob,
  audioJobId: string,
  timeline: TimelineEntry[],
  settings: ExportSettings
): Promise<void> {
  const { default: ffmpeg } = await import("fluent-ffmpeg");

  const audioJob = jobs.get(audioJobId);
  if (!audioJob) {
    exportJob.status = "error";
    exportJob.errorMessage = "Audio job not found";
    return;
  }

  const width = settings.format === "9:16" ? 1080 : 1920;
  const height = settings.format === "9:16" ? 1920 : 1080;
  const totalDuration = timeline.reduce(
    (max, e) => Math.max(max, e.startTime + e.duration),
    0
  );

  const outputFilename = `story_${Date.now()}.mp4`;
  const outputPath = path.join(exportDir, outputFilename);

  exportJob.outputPath = outputPath;
  exportJob.filename = outputFilename;
  exportJob.status = "running";

  const bgVideoEntry = settings.backgroundVideoId
    ? fileRegistry.get(settings.backgroundVideoId)
    : null;
  const bgMusicEntry = settings.backgroundMusicId
    ? fileRegistry.get(settings.backgroundMusicId)
    : null;

  const bgColor = settings.darkMode ? "0x000000" : "0xF2F2F7";

  const cmd = ffmpeg();

  if (bgVideoEntry && fs.existsSync(bgVideoEntry.path)) {
    cmd.input(bgVideoEntry.path).inputOptions(["-stream_loop", "-1"]);
  } else {
    cmd
      .input(`color=c=${bgColor}:s=${width}x${height}:d=${totalDuration + 1}`)
      .inputFormat("lavfi");
  }

  const audioInputs: string[] = [];
  const audioDelays: number[] = [];

  for (const entry of timeline) {
    if (entry.type !== "text") continue;
    const audioFile = path.join(
      audioJob.dir,
      `line_${String(entry.lineIndex).padStart(3, "0")}.mp3`
    );
    if (fs.existsSync(audioFile)) {
      audioInputs.push(audioFile);
      audioDelays.push(entry.startTime);
    }
  }

  audioInputs.forEach((f) => cmd.input(f));

  if (bgMusicEntry && fs.existsSync(bgMusicEntry.path)) {
    cmd.input(bgMusicEntry.path).inputOptions(["-stream_loop", "-1"]);
  }

  const filterParts: string[] = [];
  const audioMixInputs: string[] = [];

  audioInputs.forEach((_, i) => {
    const inputIdx = i + 1;
    const delayMs = Math.floor(audioDelays[i] * 1000);
    filterParts.push(`[${inputIdx}:a]adelay=${delayMs}|${delayMs}[a${i}]`);
    audioMixInputs.push(`[a${i}]`);
  });

  if (bgMusicEntry) {
    const musicIdx = 1 + audioInputs.length;
    filterParts.push(
      `[${musicIdx}:a]volume=0.2,atrim=duration=${totalDuration + 1}[bgmusic]`
    );
    audioMixInputs.push("[bgmusic]");
  }

  const videoFilter = bgVideoEntry
    ? `[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},trim=duration=${totalDuration + 1}[vid]`
    : `[0:v]trim=duration=${totalDuration + 1}[vid]`;

  filterParts.push(videoFilter);

  let filterComplex = "";
  if (audioMixInputs.length > 0) {
    filterParts.push(
      `${audioMixInputs.join("")}amix=inputs=${audioMixInputs.length}:duration=longest[amix]`
    );
    filterComplex = filterParts.join(";");

    cmd
      .complexFilter(filterComplex)
      .outputOptions([
        "-map", "[vid]",
        "-map", "[amix]",
        "-c:v", "libx264",
        "-preset", "fast",
        "-crf", "22",
        "-c:a", "aac",
        "-b:a", "192k",
        "-t", String(totalDuration + 1),
        "-movflags", "+faststart",
      ]);
  } else {
    filterComplex = filterParts.join(";");
    cmd
      .complexFilter(filterComplex)
      .outputOptions([
        "-map", "[vid]",
        "-c:v", "libx264",
        "-preset", "fast",
        "-crf", "22",
        "-an",
        "-t", String(totalDuration + 1),
        "-movflags", "+faststart",
      ]);
  }

  await new Promise<void>((resolve, reject) => {
    cmd
      .output(outputPath)
      .on("progress", (progress) => {
        const pct = Math.min(99, Math.round((progress.percent ?? 0)));
        exportJob.progress = pct;
      })
      .on("end", () => {
        exportJob.status = "done";
        exportJob.progress = 100;
        resolve();
      })
      .on("error", (err) => {
        logger.error({ err, exportId: exportJob.exportId }, "FFmpeg export failed");
        exportJob.status = "error";
        exportJob.errorMessage = err.message;
        reject(err);
      })
      .run();
  });
}

router.post("/imessage/export", async (req, res): Promise<void> => {
  const { jobId, timeline, settings } = req.body as {
    jobId: string;
    timeline: TimelineEntry[];
    settings: ExportSettings;
  };

  if (!jobId || !timeline || !settings) {
    res.status(400).json({ error: "jobId, timeline, and settings are required" });
    return;
  }

  const exportId = randomUUID();
  const exportJob: ExportJob = {
    exportId,
    status: "pending",
    progress: 0,
  };

  exportJobs.set(exportId, exportJob);

  runFFmpegExport(exportJob, jobId, timeline, settings).catch((err) => {
    logger.error({ err, exportId }, "Export failed");
    exportJob.status = "error";
    exportJob.errorMessage = String(err);
  });

  res.json({ exportId });
});

router.get("/imessage/export-progress/:exportId", async (req, res): Promise<void> => {
  const exportId = Array.isArray(req.params.exportId)
    ? req.params.exportId[0]
    : req.params.exportId;
  const exportJob = exportJobs.get(exportId);

  if (!exportJob) {
    res.status(404).json({ error: "Export not found" });
    return;
  }

  res.json({
    exportId: exportJob.exportId,
    status: exportJob.status,
    progress: exportJob.progress,
    errorMessage: exportJob.errorMessage,
    filename: exportJob.filename,
  });
});

router.get("/imessage/download/:exportId", async (req, res): Promise<void> => {
  const exportId = Array.isArray(req.params.exportId)
    ? req.params.exportId[0]
    : req.params.exportId;
  const exportJob = exportJobs.get(exportId);

  if (!exportJob || exportJob.status !== "done" || !exportJob.outputPath) {
    res.status(404).json({ error: "Export not found or not ready" });
    return;
  }

  if (!fs.existsSync(exportJob.outputPath)) {
    res.status(404).json({ error: "Export file missing" });
    return;
  }

  res.setHeader("Content-Type", "video/mp4");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${exportJob.filename}"`
  );
  fs.createReadStream(exportJob.outputPath).pipe(res);
});

export default router;
