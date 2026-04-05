import { Router } from "express";
import { KOKORO_VOICES } from "../../utils/kokoroTTS";

const router = Router();

router.get("/imessage/voices", (_req, res): void => {
  res.json({
    voices: KOKORO_VOICES.map((v) => ({
      shortName: v.id,
      name: `${v.label} (${v.accent})`,
      gender: v.gender,
      locale: v.accent === "American" ? "en-US" : "en-GB",
    })),
  });
});

export default router;
