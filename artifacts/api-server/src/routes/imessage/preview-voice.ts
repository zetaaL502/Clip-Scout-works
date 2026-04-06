import { Router } from "express";
import path from "path";
import fs from "fs";
import os from "os";
import { randomUUID } from "node:crypto";
import { logger } from "../../lib/logger";
import { generateAudio } from "../../utils/geminiTTS";

const router = Router();

router.post("/imessage/preview-voice", async (req, res): Promise<void> => {
  const { voice, text } = req.body as { voice?: string; text?: string };

  if (!voice) {
    res.status(400).json({ error: "voice is required" });
    return;
  }

  const previewText = text || "Hey, this is how I sound.";
  const tmpFile = path.join(os.tmpdir(), `preview_${randomUUID()}.mp3`);

  try {
    await generateAudio(previewText, voice, tmpFile);

    if (!fs.existsSync(tmpFile)) {
      res.status(500).json({ error: "Audio file was not created" });
      return;
    }

    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Content-Disposition", 'inline; filename="preview.mp3"');
    const stream = fs.createReadStream(tmpFile);
    stream.pipe(res);
    stream.on("end", () => { try { fs.unlinkSync(tmpFile); } catch (_) {} });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.warn({ err: msg, voice }, "Voice preview generation failed");
    try { fs.unlinkSync(tmpFile); } catch (_) {}
    res.status(500).json({ error: msg });
  }
});

export default router;
