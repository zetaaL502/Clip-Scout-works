import { Router } from "express";
import { MsEdgeTTS } from "msedge-tts";
import { logger } from "../../lib/logger";

const router = Router();

let cachedVoices: object[] | null = null;

router.get("/imessage/voices", async (_req, res): Promise<void> => {
  if (cachedVoices) {
    res.json({ voices: cachedVoices });
    return;
  }

  try {
    const tts = new MsEdgeTTS();
    const allVoices = await tts.getVoices();
    const englishVoices = allVoices
      .filter((v) => v.Locale.startsWith("en-"))
      .map((v) => ({
        name: v.Name,
        shortName: v.ShortName,
        gender: v.Gender,
        locale: v.Locale,
      }));
    cachedVoices = englishVoices;
    res.json({ voices: englishVoices });
  } catch (e) {
    logger.error({ e }, "Failed to retrieve voices");
    res.status(500).json({ error: "Failed to retrieve voices" });
  }
});

export default router;
