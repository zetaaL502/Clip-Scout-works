import { Router, json as expressJson } from "express";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { logger } from "../lib/logger.js";

const router = Router();

const ASSEMBLYAI_API = "https://api.assemblyai.com/v2";
const CLEANUP_TIMEOUT_MS = 30 * 60 * 1000;

const LANG_CODE_MAP: Record<string, string> = {
  english: "en",
  spanish: "es",
  hindi: "hi",
  nepali: "ne",
  french: "fr",
  german: "de",
  portuguese: "pt",
  japanese: "ja",
  chinese: "zh",
  arabic: "ar",
  korean: "ko",
  italian: "it",
  russian: "ru",
  turkish: "tr",
  dutch: "nl",
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function scheduleCleanup(filePath: string) {
  setTimeout(() => { fs.unlink(filePath, () => {}); }, CLEANUP_TIMEOUT_MS);
}

// --- Chunk upload ---
router.post("/subtitles/chunk", expressJson({ limit: "128kb" }), (req, res) => {
  const { sessionId, chunkIndex, totalChunks, data } = req.body as Record<string, string | number>;
  if (!sessionId || chunkIndex === undefined || !totalChunks || !data) {
    res.status(400).json({ error: "Missing sessionId, chunkIndex, totalChunks, or data." });
    return;
  }
  try {
    const chunkBuffer = Buffer.from(data as string, "base64");
    const destPath = path.join(os.tmpdir(), `chunk-${sessionId}-${chunkIndex}`);
    fs.writeFileSync(destPath, chunkBuffer);
    res.json({ ok: true, chunkIndex });
  } catch (err) {
    logger.error({ err }, "Failed to write chunk");
    res.status(500).json({ error: "Failed to write chunk." });
  }
});

// --- Process sessions ONE AT A TIME ---
router.post("/subtitles/process-many", expressJson({ limit: "10kb" }), async (req, res) => {
  const apiKey = process.env["ASSEMBLYAI_API_KEY"];
  if (!apiKey) {
    res.status(502).json({ error: "ASSEMBLYAI_API_KEY not configured on server." });
    return;
  }

  const { sessions } = req.body as {
    sessions: Array<{
      sessionId: string;
      totalChunks: string | number;
      originalName: string;
      language: string;
    }>;
  };

  if (!Array.isArray(sessions) || sessions.length === 0 || sessions.length > 5) {
    res.status(400).json({ error: "Provide between 1 and 5 sessions." });
    return;
  }

  try {
    const srtFiles: Array<{ srtFileName: string; downloadUrl: string }> = [];
    const usedNames = new Set<string>();

    for (let idx = 0; idx < sessions.length; idx++) {
      const { sessionId, totalChunks, originalName, language } = sessions[idx];
      const total = Number(totalChunks);

      // 12-second pause between files to avoid rate limits
      if (idx > 0) {
        logger.info({ idx }, "Pausing 12s before next file...");
        await sleep(12000);
      }

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

      // 2. Upload to AssemblyAI
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
      const langKey = language.toLowerCase().trim();
      const langCode = LANG_CODE_MAP[langKey] ?? "en";
      const txBody: Record<string, unknown> = {
        audio_url: upload_url,
        speech_models: ["universal-2"],
        language_code: langCode,
      };

      // Submit transcription with exponential backoff retry on 429
      let txRes!: Response;
      for (let attempt = 0; attempt < 6; attempt++) {
        if (attempt > 0) {
          const waitMs = Math.min(20000 * Math.pow(2, attempt - 1), 120000);
          logger.warn({ idx, originalName, attempt, waitMs }, "Rate limited — backing off...");
          await sleep(waitMs);
        }
        txRes = await fetch(`${ASSEMBLYAI_API}/transcript`, {
          method: "POST",
          headers: { Authorization: apiKey, "Content-Type": "application/json" },
          body: JSON.stringify(txBody),
        });
        if (txRes.status !== 429) break;
      }

      if (!txRes.ok) {
        throw new Error(`AssemblyAI transcript create failed (${txRes.status}): ${await txRes.text()}`);
      }
      const { id } = await txRes.json() as { id: string };
      logger.info({ id, originalName }, "Transcript submitted, polling...");

      // 4. Poll until complete (max 10 minutes)
      const deadline = Date.now() + 10 * 60 * 1000;
      let completed = false;
      while (Date.now() < deadline) {
        await sleep(4000);
        const poll = await fetch(`${ASSEMBLYAI_API}/transcript/${id}`, {
          headers: { Authorization: apiKey },
        });
        const pollData = await poll.json() as { status: string; error?: string };
        if (pollData.status === "completed") { completed = true; break; }
        if (pollData.status === "error") {
          throw new Error(`AssemblyAI error for "${originalName}": ${pollData.error ?? "unknown"}`);
        }
        logger.info({ id, status: pollData.status }, "Polling...");
      }
      if (!completed) throw new Error(`Timeout waiting for "${originalName}"`);

      // 5. Fetch SRT
      const srtRes = await fetch(`${ASSEMBLYAI_API}/transcript/${id}/srt`, {
        headers: { Authorization: apiKey },
      });
      if (!srtRes.ok) {
        throw new Error(`SRT fetch failed (${srtRes.status}) for "${originalName}"`);
      }
      const srtContent = await srtRes.text();

      // Name file as language.srt (with suffix for duplicates)
      const baseName = langKey.replace(/\s+/g, "-");
      let displayName = `${baseName}.srt`;
      if (usedNames.has(displayName)) {
        let n = 2;
        while (usedNames.has(`${baseName}-${n}.srt`)) n++;
        displayName = `${baseName}-${n}.srt`;
      }
      usedNames.add(displayName);

      // Store on disk with unique name to avoid collisions
      const diskName = `srt-${Date.now()}-${idx}`;
      const srtPath = path.join(os.tmpdir(), diskName);
      fs.writeFileSync(srtPath, srtContent, "utf8");
      scheduleCleanup(srtPath);

      srtFiles.push({
        srtFileName: displayName,
        downloadUrl: `/api/subtitles/download/${encodeURIComponent(diskName)}?as=${encodeURIComponent(displayName)}`,
      });
      logger.info({ displayName }, "SRT ready");
    }

    res.json({ srtFiles });
  } catch (err) {
    logger.error({ err }, "process-many failed");
    res.status(500).json({ error: `Processing failed: ${err instanceof Error ? err.message : String(err)}` });
  }
});

// --- SRT download ---
router.get("/subtitles/download/:filename", (req, res) => {
  const filename = path.basename(req.params["filename"] ?? "");
  const asName = typeof req.query["as"] === "string" ? req.query["as"] : filename;
  const filePath = path.join(os.tmpdir(), filename);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: "File not found or already downloaded." });
    return;
  }
  res.setHeader("Content-Disposition", `attachment; filename="${asName}"`);
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  const stream = fs.createReadStream(filePath);
  stream.pipe(res);
  stream.on("end", () => { fs.unlink(filePath, () => {}); });
});

// --- Download page for QR code (all files in one page) ---
router.get("/subtitles/download-page", (req, res) => {
  const rawU = req.query["u"];
  const urls: string[] = Array.isArray(rawU) ? rawU as string[] : rawU ? [rawU as string] : [];

  const buttons = urls.map((u) => {
    const displayName = u.split("as=")[1] ? decodeURIComponent(u.split("as=")[1]) : "file.srt";
    return `<a href="${u}" download="${displayName}" class="btn">⬇ Download ${displayName}</a>`;
  }).join("\n");

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Download SRT Files</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:system-ui,sans-serif;background:#0a0a0a;color:#fff;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px}
  h1{color:#22c55e;font-size:1.4rem;margin-bottom:6px}
  p{color:#888;font-size:.875rem;margin-bottom:28px;text-align:center}
  .btn{display:block;width:100%;max-width:340px;padding:16px 24px;margin:10px 0;background:#22c55e;color:#000;text-decoration:none;border-radius:14px;font-weight:700;font-size:1rem;text-align:center}
  .btn:hover{background:#16a34a}
  .note{color:#555;font-size:.75rem;margin-top:24px;text-align:center}
</style>
</head>
<body>
<h1>Your SRT Files are Ready</h1>
<p>Tap each button to download</p>
${buttons}
<p class="note">Files are available for 30 minutes</p>
</body>
</html>`);
});

export default router;
