import { Router } from "express";
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import path from "path";
import fs from "fs";
import os from "os";
import { randomUUID } from "node:crypto";
import { logger } from "../../lib/logger";

const router = Router();

router.post("/imessage/preview-voice", async (req, res): Promise<void> => {
  const { voice, text } = req.body as { voice?: string; text?: string };

  if (!voice) {
    res.status(400).json({ error: "voice is required" });
    return;
  }

  const previewText = text || "Hey how are you doing today";
  const tmpFile = path.join(os.tmpdir(), `preview_${randomUUID()}.mp3`);

  try {
    const tts = new MsEdgeTTS();
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    const readable = tts.toStream(previewText);

    const writeStream = fs.createWriteStream(tmpFile);
    readable.pipe(writeStream);

    await new Promise<void>((resolve, reject) => {
      writeStream.on("finish", resolve);
      writeStream.on("error", reject);
      readable.on("error", reject);
    });

    if (!fs.existsSync(tmpFile)) {
      res.status(500).json({ error: "Audio file was not created" });
      return;
    }

    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Content-Disposition", 'inline; filename="preview.mp3"');
    const stream = fs.createReadStream(tmpFile);
    stream.pipe(res);
    stream.on("end", () => {
      try { fs.unlinkSync(tmpFile); } catch (_) {}
    });
  } catch (e) {
    logger.warn({ e, voice }, "Voice preview generation failed");
    res.status(500).json({ error: "TTS generation failed" });
  }
});

export default router;
