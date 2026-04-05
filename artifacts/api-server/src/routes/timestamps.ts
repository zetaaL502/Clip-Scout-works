import { Router, type IRouter } from "express";

const router: IRouter = Router();

function timeToSeconds(ts: string): number {
  // Handles 00:00:00,000 and 00:00:00.000
  const normalized = ts.replace(",", ".");
  const parts = normalized.split(":");
  if (parts.length !== 3) return 0;
  const hours = parseFloat(parts[0] ?? "0");
  const minutes = parseFloat(parts[1] ?? "0");
  const seconds = parseFloat(parts[2] ?? "0");
  return hours * 3600 + minutes * 60 + seconds;
}

function extractKeywords(text: string): string {
  const stopwords = new Set([
    "the","a","an","and","or","but","in","on","at","to","for","of","with",
    "by","from","is","it","its","be","are","was","were","been","has","have",
    "had","do","did","does","will","would","could","should","may","might",
    "this","that","these","those","i","you","he","she","we","they","my",
    "your","his","her","our","their","what","when","where","how","why","who",
    "which","as","if","so","not","no","can","just","about","up","out","there",
    "then","than","into","through","after","before","over","under","between",
    "very","more","most","also","some","all","any","each","every","both",
  ]);
  const words = text
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !stopwords.has(w));
  const unique = [...new Set(words)];
  return unique.slice(0, 4).join(", ");
}

interface RawBlock {
  start: number;
  end: number;
  text: string;
}

router.post("/parse-timestamps", (req, res) => {
  const { text } = req.body as { text?: string };

  if (!text || typeof text !== "string" || !text.trim()) {
    res.status(400).json({ error: "text is required" });
    return;
  }

  // Match SRT timestamp blocks: optional index line, then timestamp, then text
  const blockPattern = /(?:^\d+\s*\n)?(\d{2}:\d{2}:\d{2}[,.:]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,.:]\d{3})\s*\n([\s\S]*?)(?=\n\s*\n|\n\d{2}:\d{2}:\d{2}|$)/gm;

  const rawBlocks: RawBlock[] = [];
  let match: RegExpExecArray | null;
  while ((match = blockPattern.exec(text)) !== null) {
    const start = timeToSeconds(match[1] ?? "");
    const end = timeToSeconds(match[2] ?? "");
    const blockText = (match[3] ?? "").trim().replace(/\n/g, " ");
    if (blockText && end > start) {
      rawBlocks.push({ start, end, text: blockText });
    }
  }

  if (rawBlocks.length === 0) {
    res.status(422).json({ error: "No valid timestamp blocks found. Make sure your text uses SRT format (00:00:00,000 --> 00:00:00,000)." });
    return;
  }

  // Apply merge rule: if a block is < 20s, merge with the next block
  const merged: RawBlock[] = [];
  let i = 0;
  while (i < rawBlocks.length) {
    const block = rawBlocks[i]!;
    const duration = block.end - block.start;
    if (duration < 20 && i + 1 < rawBlocks.length) {
      const next = rawBlocks[i + 1]!;
      merged.push({ start: block.start, end: next.end, text: block.text + " " + next.text });
      i += 2;
    } else {
      merged.push(block);
      i++;
    }
  }

  // Apply split rule: if a block is > 40s, split into equal halves
  const final: RawBlock[] = [];
  for (const block of merged) {
    const duration = block.end - block.start;
    if (duration > 40) {
      const mid = block.start + duration / 2;
      const words = block.text.split(" ");
      const half = Math.floor(words.length / 2);
      final.push({ start: block.start, end: mid, text: words.slice(0, half).join(" ") });
      final.push({ start: mid, end: block.end, text: words.slice(half).join(" ") });
    } else {
      final.push(block);
    }
  }

  const segments = final.map((block, idx) => {
    const duration = Math.round(block.end - block.start);
    const keywords = extractKeywords(block.text);
    return {
      order_index: idx + 1,
      text_body: block.text,
      pexels_keywords: keywords,
      giphy_keywords: keywords,
      duration_estimate: `${duration}s`,
      duration_seconds: duration,
    };
  });

  res.json({ segments });
});

export default router;
