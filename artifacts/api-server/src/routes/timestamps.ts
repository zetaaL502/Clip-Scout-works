import { Router, type IRouter } from "express";

const router: IRouter = Router();

function timeToSeconds(ts: string): number {
  const normalized = ts.replace(",", ".");
  const parts = normalized.split(":");
  if (parts.length !== 3) return 0;
  const hours = parseFloat(parts[0] ?? "0");
  const minutes = parseFloat(parts[1] ?? "0");
  const seconds = parseFloat(parts[2] ?? "0");
  return hours * 3600 + minutes * 60 + seconds;
}

const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "but",
  "in",
  "on",
  "at",
  "to",
  "for",
  "of",
  "with",
  "by",
  "from",
  "is",
  "it",
  "its",
  "be",
  "are",
  "was",
  "were",
  "been",
  "has",
  "have",
  "had",
  "do",
  "did",
  "does",
  "will",
  "would",
  "could",
  "should",
  "may",
  "might",
  "this",
  "that",
  "these",
  "those",
  "i",
  "you",
  "he",
  "she",
  "we",
  "they",
  "my",
  "your",
  "his",
  "her",
  "our",
  "their",
  "what",
  "when",
  "where",
  "how",
  "why",
  "who",
  "which",
  "as",
  "if",
  "so",
  "not",
  "no",
  "can",
  "just",
  "about",
  "up",
  "out",
  "there",
  "then",
  "than",
  "into",
  "through",
  "after",
  "before",
  "over",
  "under",
  "between",
  "very",
  "more",
  "most",
  "also",
  "some",
  "all",
  "any",
  "each",
  "every",
  "both",
  "get",
  "got",
  "go",
  "going",
  "know",
  "think",
  "see",
  "look",
  "like",
  "make",
  "take",
  "come",
  "want",
  "need",
  "tell",
  "say",
  "said",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "us",
  "me",
  "him",
  "them",
  "here",
  "now",
  "only",
  "even",
  "still",
  "back",
  "much",
  "well",
  "way",
  "time",
  "thing",
  "things",
  "people",
  "really",
  "actually",
  "basically",
  "literally",
  "right",
  "okay",
  "yeah",
  "yes",
  "lot",
  "lots",
  "kind",
  "sort",
  "re",
  "ve",
  "ll",
  "don",
  "didn",
  "doesn",
  "isn",
  "aren",
  "wasn",
  "weren",
  "hadn",
  "hasn",
  "haven",
  "wouldn",
  "couldn",
  "shouldn",
  "let",
  "let's",
  "i'm",
  "i've",
  "i'll",
  "i'd",
  "that's",
  "it's",
  "he's",
  "she's",
  "we're",
  "they're",
  "you're",
]);

function extractSmartKeywords(text: string): string {
  // 1. Find proper nouns (capitalized words mid-sentence, likely names/places)
  const properNouns = (text.match(/\b[A-Z][a-z]{2,}\b/g) ?? []).filter(
    (w) =>
      ![
        "The",
        "A",
        "An",
        "And",
        "Or",
        "But",
        "In",
        "On",
        "At",
        "To",
        "For",
        "Of",
        "With",
        "This",
        "That",
        "I",
        "You",
        "He",
        "She",
        "We",
        "They",
      ].includes(w),
  );

  // 2. Find multi-word capitalized phrases (e.g. "Dubai Marina", "Ferrari", "Burj Khalifa")
  const phrases: string[] = [];
  const phraseMatch = text.match(/\b([A-Z][a-z]+ [A-Z][a-z]+)\b/g) ?? [];
  phrases.push(...phraseMatch);

  // 3. Find strong visual/descriptive nouns — longer words that aren't stopwords
  const allWords = text
    .replace(/[^a-zA-Z\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 4 && !STOPWORDS.has(w.toLowerCase()));

  // Score words: proper nouns score higher, longer words score higher
  const wordScore = new Map<string, number>();
  const lowerText = text.toLowerCase();
  for (const w of allWords) {
    const lw = w.toLowerCase();
    if (STOPWORDS.has(lw)) continue;
    const isProper = /^[A-Z]/.test(w);
    const freq = (lowerText.match(new RegExp(`\\b${lw}\\b`, "g")) ?? []).length;
    const score = (isProper ? 3 : 1) + freq + Math.min(w.length - 4, 3);
    wordScore.set(lw, (wordScore.get(lw) ?? 0) + score);
  }

  // Sort by score descending
  const topWords = Array.from(wordScore.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([w]) => w)
    .slice(0, 6);

  // Build keyword list: start with multi-word phrases, then best individual words
  const seen = new Set<string>();
  const keywords: string[] = [];

  for (const phrase of phrases.slice(0, 2)) {
    const lp = phrase.toLowerCase();
    if (!seen.has(lp)) {
      seen.add(lp);
      keywords.push(phrase);
    }
  }

  for (const pn of properNouns) {
    const lp = pn.toLowerCase();
    if (!seen.has(lp) && keywords.length < 4) {
      seen.add(lp);
      keywords.push(pn);
    }
  }

  for (const w of topWords) {
    if (!seen.has(w) && keywords.length < 4) {
      seen.add(w);
      keywords.push(w);
    }
  }

  // Fallback: take the first few meaningful words if nothing found
  if (keywords.length === 0) {
    const fallback = text
      .split(/\s+/)
      .filter((w) => w.length > 3 && !STOPWORDS.has(w.toLowerCase()))
      .slice(0, 3);
    keywords.push(...fallback);
  }

  return keywords.join(", ");
}

interface RawBlock {
  start: number;
  end: number;
  text: string;
}

const SEGMENT_DURATION = 60; // seconds per segment

router.post("/parse-timestamps", (req, res) => {
  const { text } = req.body as { text?: string };

  if (!text || typeof text !== "string" || !text.trim()) {
    res.status(400).json({ error: "text is required" });
    return;
  }

  // Match SRT timestamp blocks
  const blockPattern =
    /(\d{2}:\d{2}:\d{2}[,.:]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,.:]\d{3})\s*\n([\s\S]*?)(?=\n\s*\n\d|\n\d{2}:\d{2}:\d{2}|$)/gm;

  const rawBlocks: RawBlock[] = [];
  let match: RegExpExecArray | null;
  while ((match = blockPattern.exec(text)) !== null) {
    const start = timeToSeconds(match[1] ?? "");
    const end = timeToSeconds(match[2] ?? "");
    const blockText = (match[3] ?? "")
      .trim()
      .replace(/\n/g, " ")
      .replace(/\s+/g, " ");
    if (blockText && end > start) {
      rawBlocks.push({ start, end, text: blockText });
    }
  }

  if (rawBlocks.length === 0) {
    res.status(422).json({
      error:
        "No valid timestamp blocks found. Make sure your text uses SRT format (00:00:00,000 --> 00:00:00,000).",
    });
    return;
  }

  // Group subtitles into strict 60-second windows based on START time
  // Segment 1: 0-59s, Segment 2: 1:00-1:59, etc.
  const redistributed: Array<{
    startSec: number;
    endSec: number;
    text: string;
  }> = [];

  let currentWindow = 0;
  let currentSegmentBlocks: RawBlock[] = [];

  for (const block of rawBlocks) {
    // Calculate which 60-second window this subtitle's START time falls into
    const blockWindow = Math.floor(block.start / SEGMENT_DURATION);

    if (blockWindow !== currentWindow && currentSegmentBlocks.length > 0) {
      // New window - close current segment
      const firstBlock = currentSegmentBlocks[0];
      const lastBlock = currentSegmentBlocks[currentSegmentBlocks.length - 1];
      const segText = currentSegmentBlocks
        .map((b) => b.text)
        .join(" ")
        .trim();
      if (segText) {
        redistributed.push({
          startSec: firstBlock.start,
          endSec: lastBlock.end,
          text: segText,
        });
      }
      currentSegmentBlocks = [block];
      currentWindow = blockWindow;
    } else {
      currentSegmentBlocks.push(block);
    }
  }

  // Don't forget the last segment (whatever remains)
  if (currentSegmentBlocks.length > 0) {
    const firstBlock = currentSegmentBlocks[0];
    const lastBlock = currentSegmentBlocks[currentSegmentBlocks.length - 1];
    const segText = currentSegmentBlocks
      .map((b) => b.text)
      .join(" ")
      .trim();
    if (segText) {
      redistributed.push({
        startSec: firstBlock.start,
        endSec: lastBlock.end,
        text: segText,
      });
    }
  }

  if (redistributed.length === 0) {
    res.status(422).json({
      error: "Could not redistribute timestamp blocks into segments.",
    });
    return;
  }

  const segments = redistributed.map((seg, idx) => {
    const duration = seg.endSec - seg.startSec; // Use full precision
    const keywords = extractSmartKeywords(seg.text);
    return {
      order_index: idx + 1,
      text_body: seg.text,
      pexels_keywords: keywords,
      giphy_keywords: keywords,
      duration_estimate: `${duration}s`,
      duration_seconds: duration,
    };
  });

  res.json({ segments });
});

export default router;
