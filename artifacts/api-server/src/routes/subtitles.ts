import { Router, json as expressJson } from "express";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { logger } from "../lib/logger.js";

const router = Router();

const ASSEMBLYAI_API = "https://api.assemblyai.com/v2";
const CLEANUP_TIMEOUT_MS = 15 * 60 * 1000;

function scheduleCleanup(filePath: string) {
  setTimeout(() => { fs.unlink(filePath, () => {}); }, CLEANUP_TIMEOUT_MS);
}

// --- Chunk upload (same chunked JSON/base64 approach to bypass proxy limits) ---
router.post("/subtitles/chunk", expressJson({ limit: "200kb" }), (req, res) => {
  const { sessionId, chunkIndex, totalChunks, data } = req.body as Record<string, string | number>;
  if (!sessionId || chunkIndex === undefined || !totalChunks || !data) {
    res.status(400).json({ error: "Missing sessionId, chunkIndex, totalChunks, or data." });
    return;
  }
  try {
    const chunkBuffer = Buffer.from(data as string, "base64");
    const destPath = path.join(os.tmpdir(), `chunk-${sessionId}-${chunkIndex}`);
    fs.writeFileSync(destPath, chunkBuffer);
    logger.info({ sessionId, chunkIndex, bytes: chunkBuffer.byteLength }, "Chunk received");
    res.json({ ok: true, chunkIndex });
  } catch (err) {
    logger.error({ err }, "Failed to write chunk");
    res.status(500).json({ error: "Failed to write chunk." });
  }
});

// --- Process up to 5 sessions in parallel via AssemblyAI ---
router.post("/subtitles/process-many", expressJson({ limit: "10kb" }), async (req, res) => {
  const apiKey = process.env["ASSEMBLYAI_API_KEY"];
  if (!apiKey) {
    res.status(502).json({ error: "ASSEMBLYAI_API_KEY not configured on server." });
    return;
  }

  const { sessions, language } = req.body as {
    sessions: Array<{ sessionId: string; totalChunks: string | number; originalName: string }>;
    language?: string;
  };

  if (!Array.isArray(sessions) || sessions.length === 0 || sessions.length > 5) {
    res.status(400).json({ error: "Provide between 1 and 5 sessions." });
    return;
  }

  try {
    const srtFiles = await Promise.all(
      sessions.map(async ({ sessionId, totalChunks, originalName }) => {
        const total = Number(totalChunks);

        // 1. Assemble chunks from disk
        const assembledPath = path.join(os.tmpdir(), `assembled-${sessionId}`);
        const writeStream = fs.createWriteStream(assembledPath);
        for (let i = 0; i < total; i++) {
          const chunkPath = path.join(os.tmpdir(), `chunk-${sessionId}-${i}`);
          if (!fs.existsSync(chunkPath)) {
            writeStream.destroy();
            throw new Error(`Missing chunk ${i} for "${originalName}"`);
          }
          writeStream.write(fs.readFileSync(chunkPath));
          fs.unlinkSync(chunkPath);
        }
        await new Promise<void>((resolve, reject) => {
          writeStream.end();
          writeStream.on("finish", resolve);
          writeStream.on("error", reject);
        });

        // 2. Upload assembled file to AssemblyAI
        logger.info({ sessionId, originalName }, "Uploading to AssemblyAI...");
        const fileBuffer = fs.readFileSync(assembledPath);
        fs.unlinkSync(assembledPath);

        const uploadRes = await fetch(`${ASSEMBLYAI_API}/upload`, {
          method: "POST",
          headers: { Authorization: apiKey, "Content-Type": "application/octet-stream" },
          body: fileBuffer,
        });
        if (!uploadRes.ok) {
          throw new Error(`AssemblyAI upload failed (${uploadRes.status}): ${await uploadRes.text()}`);
        }
        const { upload_url } = await uploadRes.json() as { upload_url: string };

        // 3. Submit transcription job
        const txBody: Record<string, string> = { audio_url: upload_url };
        if (language && language !== "english") txBody.language_code = language;
        const txRes = await fetch(`${ASSEMBLYAI_API}/transcript`, {
          method: "POST",
          headers: { Authorization: apiKey, "Content-Type": "application/json" },
          body: JSON.stringify(txBody),
        });
        if (!txRes.ok) {
          throw new Error(`AssemblyAI transcript create failed (${txRes.status}): ${await txRes.text()}`);
        }
        const { id } = await txRes.json() as { id: string };
        logger.info({ id, originalName }, "Transcript job submitted, polling...");

        // 4. Poll until complete (max 10 minutes)
        const deadline = Date.now() + 10 * 60 * 1000;
        while (Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 4000));
          const poll = await fetch(`${ASSEMBLYAI_API}/transcript/${id}`, {
            headers: { Authorization: apiKey },
          });
          const pollData = await poll.json() as { status: string; error?: string };
          if (pollData.status === "completed") break;
          if (pollData.status === "error") {
            throw new Error(`AssemblyAI error for "${originalName}": ${pollData.error ?? "unknown"}`);
          }
          logger.info({ id, status: pollData.status }, "Polling...");
        }

        // 5. Fetch SRT
        const srtRes = await fetch(`${ASSEMBLYAI_API}/transcript/${id}/srt`, {
          headers: { Authorization: apiKey },
        });
        if (!srtRes.ok) {
          throw new Error(`SRT fetch failed (${srtRes.status}) for "${originalName}"`);
        }
        const srtContent = await srtRes.text();

        const baseName = originalName.replace(/\.[^/.]+$/, "");
        const srtFileName = `${baseName}-${Date.now()}.srt`;
        const srtPath = path.join(os.tmpdir(), srtFileName);
        fs.writeFileSync(srtPath, srtContent, "utf8");
        scheduleCleanup(srtPath);

        logger.info({ srtFileName }, "SRT ready");
        return {
          srtFileName,
          downloadUrl: `/api/subtitles/download/${encodeURIComponent(srtFileName)}`,
        };
      }),
    );

    res.json({ srtFiles });
  } catch (err) {
    logger.error({ err }, "process-many failed");
    res.status(500).json({ error: `Processing failed: ${err instanceof Error ? err.message : String(err)}` });
  }
});

// --- SRT download ---
router.get("/subtitles/download/:filename", (req, res) => {
  const filename = path.basename(req.params.filename);
  const filePath = path.join(os.tmpdir(), filename);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: "File not found or already downloaded." });
    return;
  }
  res.download(filePath, filename, (err) => {
    if (!err) fs.unlink(filePath, () => {});
  });
});

export default router;
