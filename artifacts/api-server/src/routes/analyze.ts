import { Router, type IRouter } from "express";
import { ai } from "@workspace/integrations-gemini-ai";

const router: IRouter = Router();

const GEMINI_MODEL = "gemini-2.5-flash";

const buildPrompt = (script: string) => `You are a video production assistant helping a YouTube creator scout B-roll footage.

CRITICAL RULE — COVER THE ENTIRE SCRIPT: You MUST cover every single word of the script from the very first word to the very last word. Do NOT stop early. Do NOT skip any part. Do NOT summarize. Every sentence must appear verbatim in exactly one segment. Create as many segments as needed to cover everything.

Segmentation rules:
- Split the full script into logical segments of approximately 50–75 words each.
- Never cut mid-sentence.
- Each segment must be between 30 and 100 words — never shorter, never longer.
- The text_body of every segment must be the EXACT script text copied verbatim.
- All segments combined must reproduce the ENTIRE script word for word with nothing missing.

For pexels_keywords — STRICT RULES:
- Write 2–3 words maximum per keyword string.
- ONLY use broad, generic visual concepts that stock footage websites definitely have.
- Think: what common B-roll footage would visually represent this scene? NOT the literal topic.
- GOOD examples: "city skyline", "luxury apartment", "private jet", "airport crowd", "cash money", "desert highway", "skyscraper night", "business meeting", "ocean sunset", "crowd walking", "office work", "highway cars", "mountain landscape", "shopping mall", "restaurant dining"
- BAD examples: "ultra wealthy expat crisis", "missile strike dubai", "billionaire tax calculation", "geopolitical tension", "economic collapse forecast"
- If the topic is niche or abstract, find the closest VISUAL equivalent. A segment about taxes? Use "paperwork desk". About war? Use "military soldiers". About wealth? Use "luxury lifestyle".

For giphy_keywords:
- 2–3 words for a fun expressive GIF. Example: "mind blown", "money rain", "shocked face"

For duration_estimate:
- Estimated speaking time. Example: "~15 seconds"

Return ONLY valid raw JSON with no markdown, no explanation, no code blocks:
{
  "segments": [
    {
      "order_index": 1,
      "text_body": "exact script text for this segment",
      "pexels_keywords": "city skyline",
      "giphy_keywords": "mind blown",
      "duration_estimate": "~15 seconds"
    }
  ]
}

Full script to segment (cover ALL of it):
${script}`;

router.post("/analyze-script", async (req, res) => {
  const { script } = req.body as { script?: string };

  if (!script || typeof script !== "string" || script.trim().length < 50) {
    res.status(400).json({ error: "script is required and must be at least 50 characters" });
    return;
  }

  try {
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [{ role: "user", parts: [{ text: buildPrompt(script.trim()) }] }],
      config: {
        responseMimeType: "application/json",
      },
    });

    const raw = response.text ?? "{}";

    let parsed: { segments?: unknown[] };
    try {
      parsed = JSON.parse(raw);
    } catch {
      req.log.error({ raw }, "Gemini returned invalid JSON");
      res.status(502).json({ error: "Gemini returned invalid JSON. Please try again." });
      return;
    }

    const segments = parsed.segments ?? [];
    if (!Array.isArray(segments) || segments.length === 0) {
      req.log.warn({ raw }, "Gemini returned empty segments");
      res.status(502).json({ error: "Gemini returned no segments. Please try again." });
      return;
    }

    res.json({ segments });
  } catch (err) {
    req.log.error({ err }, "Gemini analyze-script failed");
    const message = (err as Error)?.message ?? "Unknown error";
    res.status(500).json({ error: `Gemini error: ${message}` });
  }
});

export default router;
