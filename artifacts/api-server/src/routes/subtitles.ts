import { Router } from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import ffmpeg from "fluent-ffmpeg";
import { logger } from "../lib/logger.js";

const router = Router();

const FFMPEG_PATH = process.env.FFMPEG_PATH ?? "/nix/store/hnz1kx9gfqclrfydrk835zib87ah56s6-replit-runtime-path/bin/ffmpeg";
if (fs.existsSync(FFMPEG_PATH)) {
  ffmpeg.setFfmpegPath(FFMPEG_PATH);
}

const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: 500 * 1024 * 1024 },
});

const GROQ_API_BASE = "https://api.groq.com/openai/v1";
const CLEANUP_TIMEOUT_MS = 10 * 60 * 1000;

const LANGUAGES: Record<string, string> = {
  english: "English",
  spanish: "Spanish",
  hindi: "Hindi",
  french: "French",
  german: "German",
  portuguese: "Portuguese",
  japanese: "Japanese",
  chinese: "Chinese",
  arabic: "Arabic",
  korean: "Korean",
};

function toSrt(segments: Array<{ start: number; end: number; text: string }>): string {
  return segments
    .map((seg, i) => {
      const fmt = (s: number) => {
        const ms = Math.round((s % 1) * 1000);
        const totalSec = Math.floor(s);
        const sec = totalSec % 60;
        const min = Math.floor(totalSec / 60) % 60;
        const hr = Math.floor(totalSec / 3600);
        return `${String(hr).padStart(2, "0")}:${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
      };
      return `${i + 1}\n${fmt(seg.start)} --> ${fmt(seg.end)}\n${seg.text.trim()}\n`;
    })
    .join("\n");
}

function scheduleCleanup(filePath: string) {
  setTimeout(() => {
    fs.unlink(filePath, (err) => {
      if (err && err.code !== "ENOENT") {
        logger.warn({ filePath }, "Orphaned file cleanup failed");
      }
    });
  }, CLEANUP_TIMEOUT_MS);
}

function compressAudio(inputPath: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .audioFrequency(16000)
      .audioChannels(1)
      .audioBitrate("128k")
      .toFormat("mp3")
      .on("error", reject)
      .on("end", resolve)
      .save(outputPath);
  });
}

router.post("/subtitles/process", upload.single("audio"), async (req, res) => {
  const apiKey = process.env["GROQ_API_KEY"];
  if (!apiKey) {
    res.status(502).json({ error: "GROQ_API_KEY not configured on server." });
    return;
  }

  if (!req.file) {
    res.status(400).json({ error: "No audio file provided." });
    return;
  }

  const language: string = (req.body.language as string | undefined) ?? "english";
  const languageName = LANGUAGES[language] ?? "English";
  const isEnglish = language === "english";

  let audioPath = req.file.path;
  let compressedPath: string | null = null;

  try {
    const fileSizeMB = req.file.size / (1024 * 1024);
    if (fileSizeMB > 24) {
      logger.info({ fileSizeMB: fileSizeMB.toFixed(1) }, "Step 1: Compressing audio...");
      compressedPath = path.join(os.tmpdir(), `compressed-${Date.now()}.mp3`);
      await compressAudio(audioPath, compressedPath);
      fs.unlinkSync(audioPath);
      audioPath = compressedPath;
    }

    logger.info("Step 2: Transcribing with Groq Whisper...");

    const endpoint = isEnglish
      ? `${GROQ_API_BASE}/audio/translations`
      : `${GROQ_API_BASE}/audio/transcriptions`;

    const formData = new FormData();
    const audioBuffer = fs.readFileSync(audioPath);
    const blob = new Blob([audioBuffer], { type: req.file.mimetype || "audio/mpeg" });
    formData.append("file", blob, req.file.originalname || "audio.mp3");
    formData.append("model", "whisper-large-v3");
    formData.append("response_format", "verbose_json");
    if (!isEnglish) {
      formData.append("language", language);
    }

    const groqRes = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData,
    });

    if (!groqRes.ok) {
      const errText = await groqRes.text();
      res.status(502).json({ error: `Groq API error: ${errText}` });
      return;
    }

    const groqData = (await groqRes.json()) as {
      text: string;
      segments?: Array<{ start: number; end: number; text: string }>;
    };

    logger.info("Step 3: Generating SRT...");
    const segments = groqData.segments ?? [];
    const srtContent = toSrt(segments);
    const srtFileName = `${languageName}-${Date.now()}.srt`;
    const srtPath = path.join(os.tmpdir(), srtFileName);
    fs.writeFileSync(srtPath, srtContent, "utf8");

    scheduleCleanup(srtPath);

    res.json({
      transcript: groqData.text,
      srtFileName,
      downloadUrl: `/api/subtitles/download/${encodeURIComponent(srtFileName)}`,
    });
  } catch (err) {
    logger.error(err, "Subtitle processing failed");
    res.status(500).json({ error: "Processing failed. Check server logs." });
  } finally {
    fs.unlink(audioPath, () => {});
  }
});

router.get("/subtitles/download/:filename", (req, res) => {
  const filename = path.basename(req.params.filename);
  const filePath = path.join(os.tmpdir(), filename);

  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: "File not found or already downloaded." });
    return;
  }

  res.download(filePath, filename, (err) => {
    if (!err) {
      fs.unlink(filePath, () => {});
    }
  });
});

export default router;
