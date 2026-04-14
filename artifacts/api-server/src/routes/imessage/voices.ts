import { Router } from "express";
import { GEMINI_VOICES } from "../../utils/geminiTTS";

const router = Router();

router.get("/imessage/voices", (_req, res): void => {
  res.json({
    voices: GEMINI_VOICES.map((v) => ({
      shortName: v.id,
      name: `${v.label} (${v.style})`,
      gender: v.gender,
      locale: "en-US",
    })),
  });
});

export default router;
