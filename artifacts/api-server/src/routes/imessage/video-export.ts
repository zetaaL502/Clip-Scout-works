import { Router } from "express";
import path from "path";
import fs from "fs";
import os from "os";
import { randomUUID } from "node:crypto";
import { spawn } from "child_process";
import { logger } from "../../lib/logger";
import { jobs as audioJobs } from "./audio-generation";

const router = Router();

// ─── Video dimensions (9:16 portrait) ────────────────────────────────
const W = 1080;
const H = 1920;
const FPS = 30;

// Layout zones
const STATUS_H = 80;
const HEADER_H = 160;
const CHAT_TOP = STATUS_H + HEADER_H;          // y=240
const INPUT_H = 130;
const CHAT_BOTTOM = H - INPUT_H;               // y=1790
const CHAT_H = CHAT_BOTTOM - CHAT_TOP;         // 1550px

// Bubble geometry
const FONT_SIZE = 42;
const LINE_H = 60;
const PAD_X = 26;
const PAD_Y = 20;
const MAX_BUBBLE_W = 680;
const BUBBLE_GAP = 22;
const AVATAR_W = 64;
const LEFT_MARGIN = 24 + AVATAR_W + 14;        // 102 — for "them" bubbles
const RIGHT_MARGIN = 60;
const NAME_H = 32;                             // name label above "them" bubble
const APPROX_CHARS_PER_LINE = 24;              // at 42px in MAX_BUBBLE_W

// ─── Types ───────────────────────────────────────────────────────────

interface ScriptLine {
  index: number;
  text: string;
  charName: string;
  isMe: boolean;
}

interface BubbleLayout {
  lineIndex: number;
  isMe: boolean;
  textLines: string[];
  charName: string;
  /** absolute px from top of video */
  x: number;
  y: number;
  w: number;
  h: number;
  /** where text starts inside bubble */
  textX: number;
  textY: number;
  /** where character name label goes (for "them") */
  nameX: number;
  nameY: number;
  startTime: number;
  /** camera scroll offset applied when this bubble is the latest visible */
  scrollOffset: number;
}

interface VideoJob {
  videoJobId: string;
  status: "pending" | "running" | "done" | "error";
  progress: number;
  errorMessage?: string;
  outputPath?: string;
  filename?: string;
}

const videoJobs = new Map<string, VideoJob>();
const videoDir = path.join("/tmp", "imessage_videos");
fs.mkdirSync(videoDir, { recursive: true });

// ─── Helpers ─────────────────────────────────────────────────────────

function wrapText(text: string, maxChars: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const word of words) {
    if (word.length > maxChars) {
      if (cur) { lines.push(cur); cur = ""; }
      for (let i = 0; i < word.length; i += maxChars) lines.push(word.slice(i, i + maxChars));
    } else if (cur && (cur + " " + word).length > maxChars) {
      lines.push(cur); cur = word;
    } else {
      cur = cur ? cur + " " + word : word;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}

/**
 * Build a step-function expression for the scroll offset at time t.
 * Uses plain commas — the caller wraps the whole thing in single quotes,
 * so ffmpeg treats the commas as literal (not filter-chain separators).
 */
function buildScrollExpr(bubbles: BubbleLayout[]): string {
  let expr = "0";
  for (let i = bubbles.length - 1; i >= 0; i--) {
    const t = bubbles[i].startTime.toFixed(2);
    const s = Math.round(bubbles[i].scrollOffset);
    expr = `if(gte(t,${t}),${s},${expr})`;
  }
  return expr;
}

/** Compute layout for all bubbles, including scroll offsets */
function calcLayout(
  lines: ScriptLine[],
  durations: Record<number, number>
): { bubbles: BubbleLayout[]; totalDuration: number; contactName: string } {
  let currentY = CHAT_TOP + 16;
  let currentTime = 0;
  const bubbles: BubbleLayout[] = [];

  for (const line of lines) {
    const duration = durations[line.index] ?? 2.0;
    const textLines = wrapText(line.text, APPROX_CHARS_PER_LINE);
    const bubbleH = textLines.length * LINE_H + PAD_Y * 2;
    const approxW = Math.min(
      Math.max(...textLines.map((t) => t.length)) * (FONT_SIZE * 0.54) + PAD_X * 2,
      MAX_BUBBLE_W
    );
    const bubbleW = Math.max(approxW, 120);

    const labelH = line.isMe ? 0 : NAME_H;
    const x = line.isMe ? W - RIGHT_MARGIN - bubbleW : LEFT_MARGIN;
    const y = currentY + labelH;
    const textX = x + PAD_X;
    const textY = y + PAD_Y;
    const nameX = x;
    const nameY = currentY + 4;

    // How far to scroll so this bubble's bottom is visible
    const bottomY = y + bubbleH;
    const scrollOffset = Math.max(0, bottomY - CHAT_BOTTOM + 20);

    bubbles.push({
      lineIndex: line.index,
      isMe: line.isMe,
      textLines,
      charName: line.charName,
      x, y, w: bubbleW, h: bubbleH,
      textX, textY, nameX, nameY,
      startTime: currentTime,
      scrollOffset,
    });

    currentY += labelH + bubbleH + BUBBLE_GAP;
    currentTime += duration + 0.45;
  }

  const contactName = lines.find((l) => !l.isMe)?.charName ?? "Contact";
  return { bubbles, totalDuration: currentTime, contactName };
}

// ─── FFmpeg video generation ──────────────────────────────────────────

async function generateVideo(
  job: VideoJob,
  audioJobId: string,
  scriptLines: ScriptLine[],
  darkMode: boolean
): Promise<void> {
  job.status = "running";

  const audioJob = audioJobs.get(audioJobId);
  if (!audioJob) {
    job.status = "error";
    job.errorMessage = "Audio job not found";
    return;
  }

  const { bubbles, totalDuration, contactName } = calcLayout(scriptLines, audioJob.durations);
  const vidDuration = totalDuration + 0.5;

  // Colours
  const bgCol    = darkMode ? "0x000000" : "0xF2F2F7";
  const headerCol = darkMode ? "0x1C1C1E" : "0xFFFFFF";
  const borderCol = darkMode ? "0x2C2C2E" : "0xE5E5EA";
  const meCol    = "0x34C759";
  const themCol  = darkMode ? "0x3A3A3C" : "0xE5E5EA";
  const meText   = "white";
  const themText = darkMode ? "white" : "black";
  const dimText  = darkMode ? "0xEBEBF5@0.5" : "0x00000080";
  const timeText = darkMode ? "0xEBEBF5@0.7" : "0x000000CC";

  // Scroll expression (makes all bubbles shift up as conversation grows)
  const scrollExpr = buildScrollExpr(bubbles);

  // Temp dir for text files (avoids drawtext escaping issues)
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "imvid_"));
  const textFiles: string[] = [];

  const writeTextFile = (content: string): string => {
    const p = path.join(tmpDir, `t${textFiles.length}.txt`);
    fs.writeFileSync(p, content, "utf8");
    textFiles.push(p);
    return p;
  };

  try {
    // ── Build video filter chain ──────────────────────────────────
    const vf: string[] = [];

    // 1. Status bar background
    vf.push(`drawbox=x=0:y=0:w=${W}:h=${STATUS_H}:color=${headerCol}@1:t=fill`);

    // 2. Status bar time "9:41"
    const timeFile = writeTextFile("9:41");
    vf.push(`drawtext=textfile=${timeFile}:x=55:y=22:fontsize=38:fontcolor=${timeText}:font=sans-serif`);

    // 3. Contact header background
    vf.push(`drawbox=x=0:y=${STATUS_H}:w=${W}:h=${HEADER_H}:color=${headerCol}@1:t=fill`);

    // 4. Header bottom border
    vf.push(`drawbox=x=0:y=${CHAT_TOP - 2}:w=${W}:h=2:color=${borderCol}@1:t=fill`);

    // 5. Back arrow area (‹ arrow)
    const backFile = writeTextFile("< Messages");
    vf.push(`drawtext=textfile=${backFile}:x=40:y=${STATUS_H + 42}:fontsize=36:fontcolor=0x007AFF@1`);

    // 6. Avatar circle (square approximation)
    const avatarCX = W / 2;
    const avatarR = 48;
    vf.push(
      `drawbox=x=${avatarCX - avatarR}:y=${STATUS_H + 14}:w=${avatarR * 2}:h=${avatarR * 2}:color=0x8E8E93@1:t=fill`
    );
    // Avatar initials
    const initials = contactName
      .trim()
      .split(/\s+/)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .slice(0, 2)
      .join("");
    const initialsFile = writeTextFile(initials || "?");
    vf.push(
      `drawtext=textfile=${initialsFile}:x=${avatarCX - (initials.length > 1 ? 26 : 14)}:y=${STATUS_H + 28}:fontsize=42:fontcolor=white@1:font=sans-serif`
    );

    // 7. Contact name below avatar
    const cnameFile = writeTextFile(contactName);
    vf.push(
      `drawtext=textfile=${cnameFile}:x=(${W}-text_w)/2:y=${STATUS_H + HEADER_H - 36}:fontsize=34:fontcolor=${darkMode ? "white" : "black"}@1:font=sans-serif`
    );

    // 8. Chat background
    vf.push(
      `drawbox=x=0:y=${CHAT_TOP}:w=${W}:h=${CHAT_H}:color=${darkMode ? "0x000000" : "0xFFFFFF"}@1:t=fill`
    );

    // 9. Input bar background
    vf.push(
      `drawbox=x=0:y=${CHAT_BOTTOM}:w=${W}:h=${INPUT_H}:color=${headerCol}@1:t=fill`,
      `drawbox=x=0:y=${CHAT_BOTTOM}:w=${W}:h=2:color=${borderCol}@1:t=fill`
    );
    const inputFile = writeTextFile("iMessage");
    vf.push(
      `drawtext=textfile=${inputFile}:x=100:y=${CHAT_BOTTOM + 40}:fontsize=34:fontcolor=${dimText}`
    );

    // 10. Bubbles (appear in sync with audio)
    //     All expressions go inside single quotes → commas are literal, not separators.
    const scrolled = (staticVal: number) => `'${staticVal}-(${scrollExpr})'`;

    for (const b of bubbles) {
      const enableExpr = `'gte(t,${b.startTime.toFixed(2)})'`;

      // Character name label (for "them")
      if (!b.isMe) {
        const nf = writeTextFile(b.charName);
        vf.push(
          `drawtext=textfile=${nf}:x=${b.nameX}:y=${scrolled(b.nameY)}:fontsize=28:fontcolor=${dimText}:enable=${enableExpr}`
        );
      }

      // Bubble background box
      vf.push(
        `drawbox=x=${b.x}:y=${scrolled(b.y)}:w=${b.w}:h=${b.h}:color=${b.isMe ? meCol : themCol}@1:t=fill:enable=${enableExpr}`
      );

      // Text lines inside bubble
      for (let i = 0; i < b.textLines.length; i++) {
        const tf = writeTextFile(b.textLines[i]);
        const lineY = b.textY + i * LINE_H;
        vf.push(
          `drawtext=textfile=${tf}:x=${b.textX}:y=${scrolled(lineY)}:fontsize=${FONT_SIZE}:fontcolor=${b.isMe ? meText : themText}@1:enable=${enableExpr}`
        );
      }
    }

    // ── Collect audio inputs ──────────────────────────────────────
    const audioParts: Array<{ filePath: string; startTime: number }> = [];
    for (const b of bubbles) {
      const af = path.join(audioJob.dir, `line_${String(b.lineIndex).padStart(3, "0")}.mp3`);
      if (fs.existsSync(af)) {
        audioParts.push({ filePath: af, startTime: b.startTime });
      }
    }

    // ── Build ffmpeg args ─────────────────────────────────────────
    const outputFilename = `imessage_${Date.now()}.mp4`;
    const outputPath = path.join(videoDir, outputFilename);
    job.outputPath = outputPath;
    job.filename = outputFilename;

    const args: string[] = ["-y"];

    // Input 0: lavfi background
    args.push(
      "-f", "lavfi",
      "-i", `color=c=${bgCol}:s=${W}x${H}:d=${vidDuration}:r=${FPS}`
    );

    // Audio inputs
    for (const ap of audioParts) {
      args.push("-i", ap.filePath);
    }

    // Build filter_complex
    const filterParts: string[] = [];

    // Video: chain all drawbox/drawtext
    filterParts.push(`[0:v]${vf.join(",")}[vout]`);

    // Audio: adelay each track then amix
    const mixLabels: string[] = [];
    for (let i = 0; i < audioParts.length; i++) {
      const delayMs = Math.round(audioParts[i].startTime * 1000);
      const label = `a${i}`;
      filterParts.push(`[${i + 1}:a]adelay=${delayMs}|${delayMs}[${label}]`);
      mixLabels.push(`[${label}]`);
    }

    if (mixLabels.length > 0) {
      filterParts.push(`${mixLabels.join("")}amix=inputs=${mixLabels.length}:duration=longest:normalize=0[aout]`);
    }

    args.push("-filter_complex", filterParts.join(";"));
    args.push("-map", "[vout]");
    if (mixLabels.length > 0) args.push("-map", "[aout]");

    args.push(
      "-c:v", "libx264",
      "-preset", "fast",
      "-crf", "22",
      "-r", String(FPS),
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      "-b:a", "192k",
      "-t", vidDuration.toFixed(2),
      "-movflags", "+faststart",
      outputPath
    );

    logger.info({ videoJobId: job.videoJobId, audioParts: audioParts.length, bubbles: bubbles.length }, "Starting ffmpeg video export");

    await new Promise<void>((resolve, reject) => {
      const stderr: string[] = [];
      const child = spawn("ffmpeg", args);

      child.stderr.on("data", (d) => {
        const chunk = d.toString();
        stderr.push(chunk);
        const m = /time=(\d+):(\d+):(\d+\.\d+)/.exec(chunk);
        if (m) {
          const secs = +m[1] * 3600 + +m[2] * 60 + parseFloat(m[3]);
          job.progress = Math.min(98, Math.round((secs / vidDuration) * 100));
        }
      });

      child.on("close", (code) => {
        if (code === 0) {
          job.status = "done";
          job.progress = 100;
          resolve();
        } else {
          const errMsg = stderr.slice(-15).join("").trim().slice(-600);
          logger.error({ errMsg, videoJobId: job.videoJobId }, "FFmpeg video export failed");
          job.status = "error";
          job.errorMessage = errMsg;
          reject(new Error(errMsg));
        }
      });

      child.on("error", reject);
    });
  } finally {
    // Clean up temp text files
    for (const f of textFiles) { try { fs.unlinkSync(f); } catch (_) {} }
    try { fs.rmdirSync(tmpDir); } catch (_) {}
  }
}

// ─── Routes ──────────────────────────────────────────────────────────

router.post("/imessage/generate-video", async (req, res): Promise<void> => {
  const { audioJobId, lines, darkMode } = req.body as {
    audioJobId: string;
    lines: ScriptLine[];
    darkMode?: boolean;
  };

  if (!audioJobId || !lines || !Array.isArray(lines) || lines.length === 0) {
    res.status(400).json({ error: "audioJobId and lines are required" });
    return;
  }

  const audioJob = audioJobs.get(audioJobId);
  if (!audioJob) {
    res.status(404).json({ error: "Audio job not found" });
    return;
  }
  if (audioJob.status !== "done") {
    res.status(400).json({ error: "Audio job is not finished yet" });
    return;
  }

  const videoJobId = randomUUID();
  const job: VideoJob = {
    videoJobId,
    status: "pending",
    progress: 0,
  };

  videoJobs.set(videoJobId, job);

  generateVideo(job, audioJobId, lines, darkMode ?? true).catch((err) => {
    logger.error({ err: String(err), videoJobId }, "Video generation failed");
    job.status = "error";
    job.errorMessage = String(err).slice(0, 400);
  });

  res.json({ videoJobId });
});

router.get("/imessage/video-progress/:videoJobId", (req, res): void => {
  const { videoJobId } = req.params;
  const job = videoJobs.get(Array.isArray(videoJobId) ? videoJobId[0] : videoJobId);
  if (!job) { res.status(404).json({ error: "Video job not found" }); return; }
  res.json({
    videoJobId: job.videoJobId,
    status: job.status,
    progress: job.progress,
    errorMessage: job.errorMessage,
  });
});

router.get("/imessage/video-download/:videoJobId", (req, res): void => {
  const { videoJobId } = req.params;
  const job = videoJobs.get(Array.isArray(videoJobId) ? videoJobId[0] : videoJobId);
  if (!job || job.status !== "done" || !job.outputPath) {
    res.status(404).json({ error: "Video not ready" });
    return;
  }
  if (!fs.existsSync(job.outputPath)) {
    res.status(404).json({ error: "Video file missing" });
    return;
  }
  res.setHeader("Content-Type", "video/mp4");
  res.setHeader("Content-Disposition", `attachment; filename="${job.filename}"`);
  fs.createReadStream(job.outputPath).pipe(res);
});

/** Combine per-line audio files into a single downloadable MP3 */
router.get("/imessage/audio-combined/:audioJobId", (req, res): void => {
  const { audioJobId } = req.params;
  const job = audioJobs.get(Array.isArray(audioJobId) ? audioJobId[0] : audioJobId);
  if (!job || job.status !== "done") {
    res.status(404).json({ error: "Audio job not ready" });
    return;
  }

  // Build sorted list of audio files
  const files = job.lines
    .sort((a, b) => a.index - b.index)
    .map((l) => path.join(job.dir, `line_${String(l.index).padStart(3, "0")}.mp3`))
    .filter((f) => fs.existsSync(f));

  if (files.length === 0) {
    res.status(404).json({ error: "No audio files found" });
    return;
  }

  if (files.length === 1) {
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Content-Disposition", `attachment; filename="conversation.mp3"`);
    fs.createReadStream(files[0]).pipe(res);
    return;
  }

  // Use ffmpeg to concatenate
  const listPath = path.join(os.tmpdir(), `concat_${randomUUID()}.txt`);
  fs.writeFileSync(listPath, files.map((f) => `file '${f}'`).join("\n"));

  const child = spawn("ffmpeg", [
    "-y", "-f", "concat", "-safe", "0", "-i", listPath,
    "-c", "copy", "-f", "mp3", "pipe:1",
  ]);

  res.setHeader("Content-Type", "audio/mpeg");
  res.setHeader("Content-Disposition", `attachment; filename="conversation.mp3"`);
  child.stdout.pipe(res);

  child.on("close", () => { try { fs.unlinkSync(listPath); } catch (_) {} });
  child.on("error", () => { try { fs.unlinkSync(listPath); } catch (_) {} });
});

export default router;
