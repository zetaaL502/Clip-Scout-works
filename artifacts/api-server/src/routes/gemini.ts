import { Router, type Request, type Response } from "express";

const router = Router();

router.post("/gemini", async (req: Request, res: Response) => {
  const { message, apiKey } = req.body as { message?: string; apiKey?: string };

  if (!message) {
    res.status(400).json({ error: "message is required" });
    return;
  }

  const key = apiKey || process.env.GEMINI_API_KEY;
  if (!key) {
    res.status(400).json({ error: "Gemini API key required" });
    return;
  }

  let lastError = "";

  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: message }] }],
            generationConfig: {
              temperature: 0.7,
              maxOutputTokens: 4096,
            },
          }),
        },
      );

      if (response.status === 429) {
        lastError = "Rate limited. Waiting...";
        const waitTime = (attempt + 1) * 3000;
        await new Promise((r) => setTimeout(r, waitTime));
        continue;
      }

      if (!response.ok) {
        const errorText = await response.text();
        console.error("[gemini] API error:", response.status, errorText);
        res
          .status(response.status)
          .json({ error: `API error: ${response.status}`, details: errorText });
        return;
      }

      const data = await response.json();
      const text =
        data.candidates?.[0]?.content?.parts?.[0]?.text || "No response";
      res.json({ text });
      return;
    } catch (err) {
      console.error("[gemini] Error:", err);
      lastError = String(err);
    }
  }

  res
    .status(429)
    .json({ error: `Rate limited. Please wait a few seconds. (${lastError})` });
});

export default router;
