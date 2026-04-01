import type { Clip, Segment } from './types';
import { storage } from './storage';

const PEXELS_PROXY = '/api/pexels-proxy';
const PEXELS_VIDEO_PROXY = '/api/pexels-video';
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchPexelsClips(segment: Segment, page: number, signal?: AbortSignal): Promise<Clip[]> {
  const keywords = (segment.pexels_keywords ?? '').trim();
  if (!keywords) return [];

  const isLandscape = (width?: number, height?: number) =>
    typeof width === 'number' && typeof height === 'number' && width > height;

  const mapClips = (data: Array<{ id: string; thumbnail_url: string; media_url: string; width?: number; height?: number }>) =>
    data.slice(0, 4).map((item) => ({
    id: `pexels-${item.id}-${page}`,
    segmentId: segment.id,
    source: 'pexels' as const,
    thumbnail_url: item.thumbnail_url,
    media_url: item.media_url,
    width: item.width,
    height: item.height,
    }));

  try {
    const res = await fetch(PEXELS_PROXY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keywords, page }),
      signal,
    });

    if (res.ok) {
      const data: Array<{ id: string; thumbnail_url: string; media_url: string; width?: number; height?: number }> = await res.json();
      return mapClips(data);
    }
  } catch {
    // Swallow proxy network errors and try client-side fallback below.
  }

  const pexelsKey = storage.getPexelsKey().trim();
  if (!pexelsKey) {
    throw new Error('Pexels unavailable: server proxy failed and no fallback key in Settings.');
  }

  const url = `https://api.pexels.com/videos/search?query=${encodeURIComponent(keywords)}&per_page=20&page=${page}`;
  let directRes: Response | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      directRes = await fetch(url, {
        headers: { Authorization: pexelsKey },
        signal,
      });
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e;
      if (attempt === 1) throw e;
      await delay(300);
      continue;
    }

    if (directRes.ok) break;
    if (!RETRYABLE_STATUS.has(directRes.status) || attempt === 1) {
      const errText = await directRes.text().catch(() => '');
      throw new Error(`Pexels fallback error: ${directRes.status} — ${errText}`);
    }
    await delay(300);
  }
  if (!directRes?.ok) {
    throw new Error('Pexels fallback failed after retry.');
  }

  const directData = (await directRes.json()) as {
    videos: Array<{
      id: number;
      image: string;
      width?: number;
      height?: number;
      video_files: Array<{ quality: string; link: string; file_type: string; width?: number; height?: number }>;
    }>;
  };
  const normalized = (directData.videos ?? [])
    .filter((video) => isLandscape(video.width, video.height))
    .map((video) => {
    const hdFile =
      video.video_files.find((f) => f.quality === 'hd' && f.file_type === 'video/mp4') ??
      video.video_files.find((f) => f.file_type === 'video/mp4' && isLandscape(f.width, f.height)) ??
      video.video_files.find((f) => f.file_type === 'video/mp4') ??
      video.video_files[0];
    return {
      id: String(video.id),
      thumbnail_url: video.image,
      media_url: hdFile?.link ?? '',
      width: video.width,
      height: video.height,
    };
  });
  return mapClips(normalized);
}

export async function fetchGiphyClips(segment: Segment, page: number): Promise<Clip[]> {
  const apiKey = storage.getGiphyKey();
  const keywords = (segment.giphy_keywords ?? '').trim();
  if (!keywords) return [];
  const offset = (page - 1) * 4;
  const url = `https://api.giphy.com/v1/gifs/search?api_key=${apiKey}&q=${encodeURIComponent(keywords)}&limit=4&offset=${offset}&rating=g`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Giphy error: ${res.status}`);
  const data = await res.json();
  return (data.data ?? []).slice(0, 4).map((item: Record<string, unknown>) => {
    const images = item.images as Record<string, Record<string, string>>;
    return {
      id: `giphy-${item.id}-${page}`,
      segmentId: segment.id,
      source: 'giphy' as const,
      thumbnail_url: images?.fixed_height_still?.url ?? '',
      media_url: images?.original?.url ?? images?.original_mp4?.mp4 ?? '',
    };
  });
}

export async function fetchBestPexelsExportUrl(videoId: string): Promise<string> {
  const res = await fetch(`${PEXELS_VIDEO_PROXY}/${encodeURIComponent(videoId)}`);
  if (!res.ok) {
    throw new Error(`Pexels video details error: ${res.status}`);
  }
  const data = (await res.json()) as { media_url?: string };
  if (!data.media_url) {
    throw new Error('Pexels video details response missing media_url');
  }
  return data.media_url;
}

type RawSegment = Omit<Segment, 'id' | 'pexels_page' | 'giphy_page'>;

const GROQ_PROMPT = (script: string) => `You are a video production assistant helping a YouTube creator scout B-roll footage.

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


// Makes a single Groq API call for one chunk of the script.
// Retries up to 3 times on 429 (rate limit) with a 60-second wait between attempts.
async function callGroq(scriptChunk: string, onStatus?: (msg: string) => void): Promise<RawSegment[]> {
  const apiKey = storage.getGroqKey();
  const MAX_ATTEMPTS = 3;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90000);

    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          response_format: { type: 'json_object' },
          max_tokens: 6000,
          messages: [{ role: 'user', content: GROQ_PROMPT(scriptChunk) }],
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (res.status === 429) {
        if (attempt < MAX_ATTEMPTS - 1) {
          onStatus?.(`Groq rate limited. Waiting 60 seconds before retry ${attempt + 1} of ${MAX_ATTEMPTS - 1}…`);
          await delay(60000);
          onStatus?.('Retrying Groq…');
          continue;
        }
        throw new Error('Groq is rate limited. Please wait a few minutes and try again.');
      }

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error?.message ?? `Groq error: ${res.status}`);
      }

      const data = await res.json();
      const content = data.choices?.[0]?.message?.content ?? '{}';
      const parsed = JSON.parse(content);
      const segments: RawSegment[] = parsed.segments ?? [];

      // If we got zero segments for a non-trivial chunk, retry once
      const wordCount = scriptChunk.trim().split(/\s+/).length;
      if (segments.length === 0 && wordCount > 30 && attempt < MAX_ATTEMPTS - 1) {
        onStatus?.('Groq returned incomplete segments. Retrying…');
        await delay(3000);
        continue;
      }

      return segments;
    } catch (e) {
      clearTimeout(timeout);
      if ((e as Error).name === 'AbortError') throw new Error('TIMEOUT');
      // Re-throw rate limit messages and other terminal errors
      if (attempt === MAX_ATTEMPTS - 1) throw e;
      // Unexpected network error — retry
      onStatus?.(`Groq request failed. Retrying in 5 seconds…`);
      await delay(5000);
    }
  }

  return [];
}

// Finds a good sentence boundary split point near the middle of the script.
function findSplitPoint(script: string): number {
  const mid = Math.floor(script.length / 2);
  const forward = script.indexOf('. ', mid);
  if (forward !== -1) return forward + 2;
  const backward = script.lastIndexOf('. ', mid);
  if (backward !== -1) return backward + 2;
  return mid;
}

export async function analyzeScript(script: string, onStatus?: (msg: string) => void): Promise<RawSegment[]> {
  const wordCount = script.trim().split(/\s+/).length;

  // For long scripts, split into two halves and make two sequential Groq calls
  // with a delay between them to avoid rate limiting.
  if (wordCount > 400) {
    const splitAt = findSplitPoint(script);
    const firstHalf = script.slice(0, splitAt).trim();
    const secondHalf = script.slice(splitAt).trim();

    onStatus?.('Analyzing first half of script…');
    const firstSegs = await callGroq(firstHalf, onStatus);

    onStatus?.('Waiting before second Groq call…');
    await delay(10000);

    onStatus?.('Analyzing second half of script…');
    const secondSegs = await callGroq(secondHalf, onStatus);

    // Re-index order_index across both halves
    const combined = [...firstSegs, ...secondSegs];
    combined.forEach((seg, i) => { seg.order_index = i + 1; });
    return combined;
  }

  onStatus?.('Analyzing script…');
  return callGroq(script, onStatus);
}
