import { Router, type IRouter } from "express";
import Groq from "groq-sdk";

const router: IRouter = Router();

const GROQ_MODEL = "llama-3.1-8b-instant";
const CHUNK_WORD_LIMIT = 400;

function splitIntoChunks(script: string): string[] {
  const sentences = script.match(/[^.!?]+[.!?]+["']?|[^.!?]+$/g) ?? [script];
  const chunks: string[] = [];
  let current: string[] = [];
  let wordCount = 0;

  for (const sentence of sentences) {
    const words = sentence.trim().split(/\s+/).length;
    if (wordCount + words > CHUNK_WORD_LIMIT && current.length > 0) {
      chunks.push(current.join(" ").trim());
      current = [];
      wordCount = 0;
    }
    current.push(sentence.trim());
    wordCount += words;
  }
  if (current.length > 0) chunks.push(current.join(" ").trim());
  return chunks.filter((c) => c.length > 0);
}

const buildPrompt = (script: string) => `You are a video production assistant helping a YouTube creator scout B-roll footage.

CRITICAL RULE — COVER THE ENTIRE SCRIPT: You MUST cover every single word of the script from the very first word to the very last word. Do NOT stop early. Do NOT skip any part. Do NOT summarize. Every sentence must appear verbatim in exactly one segment. Create as many segments as needed to cover everything.

Segmentation rules:
- Split the full script into logical segments of approximately 50–75 words each.
- Never cut mid-sentence.
- Each segment must be between 30 and 100 words — never shorter, never longer.
- The text_body of every segment must be the EXACT script text copied verbatim.
- All segments combined must reproduce the ENTIRE script word for word with nothing missing.

For pexels_keywords — STRICT RULES:
Your ONLY job for keywords is to generate 4 extremely high-quality search phrases that will return professional, cinematic, relevant stock video footage that visually matches the exact content of that segment.

Rules for each of the 4 keyword phrases:
- Keywords must describe ONLY what can be SEEN in a video (visuals, actions, people, objects, environment, camera movement). Never use abstract concepts like "success", "innovation", "AI revolution" — translate them into concrete visuals.
- Be VERY specific and descriptive (usually 5–12 words per phrase). Best format: [subject] + [action/motion] + [environment/setting] + [lighting/time] + [camera style if it helps].
- Prioritize footage that looks premium, 4K-ready, clean, professional (cinematic, realistic, high production value).
- Keywords must be in natural English that real people would type into Pexels search.
- Always produce video-only keywords (never photos/images).
- The resulting videos must be easy to trim to 15–30 seconds, so prefer dynamic scenes with movement rather than completely static shots.
- Keep everything organized and consistent with the segment's topic — no loose or generic matches.
- Base the first 2 keywords strongly on the FIRST sentence / first main idea / opening words of the segment.
- Base the last 2 keywords on secondary ideas, synonyms, or alternative visual angles from the rest of the segment.

Format: Output all 4 keyword phrases as a single comma-separated string. Each phrase is separated by a comma.
GOOD example: "young woman scrolling instagram feed on smartphone in cafe close-up, huge glowing social media algorithm brain made of code and data floating, diverse group of people staring at phone screens in dark room, hands typing on laptop with multiple social media apps open on screen"
BAD example: "social media, algorithm, phones, people online"

For giphy_keywords:
- 2–3 words for a fun expressive GIF. Example: "mind blown", "money rain", "shocked face"

For duration_estimate:
- Estimated speaking time in seconds as a plain integer. Minimum 15, maximum 30. No units, no tilde, no text — just the number. Examples: 15, 20, 25, 30

Return ONLY valid raw JSON with no markdown, no explanation, no code blocks:
{
  "segments": [
    {
      "order_index": 1,
      "text_body": "exact script text for this segment",
      "pexels_keywords": "young woman scrolling instagram feed on smartphone in cafe close-up, huge glowing social media algorithm brain made of code and data floating, diverse group of people staring at phone screens in dark room, hands typing on laptop with multiple social media apps open on screen",
      "giphy_keywords": "mind blown",
      "duration_estimate": 20
    }
  ]
}

Full script to segment (cover ALL of it):
${script}`;

async function analyzeChunk(client: Groq, chunk: string): Promise<unknown[]> {
  const completion = await client.chat.completions.create({
    model: GROQ_MODEL,
    messages: [{ role: "user", content: buildPrompt(chunk) }],
    response_format: { type: "json_object" },
    temperature: 0.3,
    max_tokens: 4096,
  });

  const raw = completion.choices[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(raw) as { segments?: unknown[] };
  return parsed.segments ?? [];
}

router.post("/analyze-script", async (req, res) => {
  const { script, groqKey } = req.body as { script?: string; groqKey?: string };

  if (!script || typeof script !== "string" || script.trim().length < 50) {
    res.status(400).json({ error: "script is required and must be at least 50 characters" });
    return;
  }

  const apiKey = groqKey?.trim() || process.env.GROQ_API_KEY || "";
  if (!apiKey) {
    res.status(400).json({ error: "Groq API key is required. Add it in Settings." });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const send = (data: object) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const client = new Groq({ apiKey });
    const chunks = splitIntoChunks(script.trim());
    const total = chunks.length;

    send({ type: "progress", message: `Starting analysis — ${total} part${total !== 1 ? "s" : ""} to process…` });

    const allSegments: unknown[] = [];

    for (let i = 0; i < chunks.length; i++) {
      send({ type: "progress", message: `Analyzing part ${i + 1} of ${total}…` });
      const segments = await analyzeChunk(client, chunks[i]);
      allSegments.push(...segments);
    }

    if (allSegments.length === 0) {
      send({ type: "error", message: "AI returned no segments. Please try again." });
      res.end();
      return;
    }

    const MIN_DURATION = 15;
    const MAX_DURATION = 30;
    const clamped = allSegments.map((seg) => {
      const raw_duration = (seg as Record<string, unknown>).duration_estimate;
      const parsed_duration = parseFloat(String(raw_duration).replace(/[^0-9.]/g, ""));
      const clamped_duration = isNaN(parsed_duration)
        ? 20
        : Math.min(MAX_DURATION, Math.max(MIN_DURATION, parsed_duration));
      return { ...(seg as object), duration_estimate: clamped_duration };
    });

    send({ type: "result", segments: clamped });
    res.end();
  } catch (err) {
    req.log.error({ err }, "Groq analyze-script failed");
    const message = (err as Error)?.message ?? "Unknown error";
    send({ type: "error", message: `Groq error: ${message}` });
    res.end();
  }
});

export default router;
