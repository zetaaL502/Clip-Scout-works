import type { Clip, Segment } from './types';
import { storage } from './storage';

const PEXELS_PROXY = '/api/pexels-proxy';

export async function fetchPexelsClips(segment: Segment, page: number, signal?: AbortSignal): Promise<Clip[]> {
  const res = await fetch(PEXELS_PROXY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keywords: segment.pexels_keywords, page }),
    signal,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Pexels proxy error: ${res.status} — ${errText}`);
  }

  const data: Array<{ id: string; thumbnail_url: string; media_url: string }> = await res.json();
  return data.slice(0, 4).map((item) => ({
    id: `pexels-${item.id}-${page}`,
    segmentId: segment.id,
    source: 'pexels' as const,
    thumbnail_url: item.thumbnail_url,
    media_url: item.media_url,
  }));
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

const GROQ_PROMPT = (script: string) => `You are a video production assistant helping a YouTube creator scout B-roll footage.

CRITICAL RULE: You MUST cover the ENTIRE script from the very first word to the very last word. Do NOT stop early. Do NOT skip any part of the script. Every single sentence must appear in exactly one segment. If the script is long, create as many segments as needed — 40, 50, 60, or more is fine.

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

export async function analyzeScript(script: string): Promise<Omit<Segment, 'id' | 'pexels_page' | 'giphy_page'>[]> {
  const apiKey = storage.getGroqKey();
  const controller = new AbortController();
  // 90 second timeout — long scripts with many segments need time to generate
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
        max_tokens: 8192,
        messages: [{ role: 'user', content: GROQ_PROMPT(script) }],
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
    if ((e as Error).name === 'AbortError') {
      throw new Error('TIMEOUT');
    }
    throw e;
  }
}
