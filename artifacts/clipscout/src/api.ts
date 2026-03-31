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
  const offset = (page - 1) * 4;
  const url = `https://api.giphy.com/v1/gifs/search?api_key=${apiKey}&q=${encodeURIComponent(segment.giphy_keywords)}&limit=4&offset=${offset}&rating=g`;
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

CRITICAL RULE: You MUST cover the ENTIRE script from the very first word to the very last word. Do NOT stop early. Do NOT skip any part of the script. Every single sentence must appear in exactly one segment. Create as many segments as needed.

Instructions:
- Split the full script into logical segments of approximately 50–75 words each.
- Never cut mid-sentence. Never make a segment shorter than 30 words or longer than 100 words.
- The text_body of every segment must be the exact script text for that segment, copied verbatim.
- The segments, taken together, must reproduce the entire script with no words missing.

For each segment generate:
- "pexels_keywords": 3–5 specific visual words describing cinematic, landscape, nature, or action footage. Example: "busy city street night rain"
- "giphy_keywords": 2–3 words for a fun expressive GIF. Example: "mind blown"
- "duration_estimate": estimated speaking time e.g. "~15 seconds"

Return ONLY valid raw JSON with no markdown, no explanation, no code blocks:
{
  "segments": [
    {
      "order_index": 1,
      "text_body": "exact script text for this segment",
      "pexels_keywords": "keywords here",
      "giphy_keywords": "giphy search terms",
      "duration_estimate": "~15 seconds"
    }
  ]
}

Full script:
${script}`;

// Makes a single Groq API call for one chunk of the script.
async function callGroq(scriptChunk: string): Promise<RawSegment[]> {
  const apiKey = storage.getGroqKey();
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
        max_tokens: 8000,
        messages: [{ role: 'user', content: GROQ_PROMPT(scriptChunk) }],
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message ?? `Groq error: ${res.status}`);
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content ?? '{}';
    const parsed = JSON.parse(content);
    return parsed.segments ?? [];
  } catch (e) {
    clearTimeout(timeout);
    if ((e as Error).name === 'AbortError') throw new Error('TIMEOUT');
    throw e;
  }
}

// Finds a good sentence boundary split point near the middle of the script.
// Returns the index just after a period+space near the midpoint.
function findSplitPoint(script: string): number {
  const mid = Math.floor(script.length / 2);
  // Search forward from midpoint for a ". " boundary
  const forward = script.indexOf('. ', mid);
  if (forward !== -1) return forward + 2; // after ". "
  // Fallback: search backward
  const backward = script.lastIndexOf('. ', mid);
  if (backward !== -1) return backward + 2;
  // No good split found — return mid
  return mid;
}

export async function analyzeScript(script: string): Promise<RawSegment[]> {
  const wordCount = script.trim().split(/\s+/).length;

  // For long scripts, split into two halves and make two parallel Groq calls.
  // This avoids hitting the max_tokens output limit and getting a truncated response.
  if (wordCount > 1200) {
    const splitAt = findSplitPoint(script);
    const firstHalf = script.slice(0, splitAt).trim();
    const secondHalf = script.slice(splitAt).trim();

    // Run both halves in parallel
    const [firstSegs, secondSegs] = await Promise.all([
      callGroq(firstHalf),
      callGroq(secondHalf),
    ]);

    return [...firstSegs, ...secondSegs];
  }

  return callGroq(script);
}
