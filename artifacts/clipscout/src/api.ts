import type { Clip, Segment } from './types';
import { storage } from './storage';

const PEXELS_PROXY = '/api/pexels-proxy';
const PEXELS_VIDEO_PROXY = '/api/pexels-video';
const ANALYZE_SCRIPT_ENDPOINT = '/api/analyze-script';
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchPexelsClips(segment: Segment, page: number, signal?: AbortSignal): Promise<Clip[]> {
  const keywords = (segment.pexels_keywords ?? '').trim();
  if (!keywords) return [];

  const isLandscape = (width?: number, height?: number) =>
    typeof width === 'number' && typeof height === 'number' && width > height;

  const mapClips = (data: Array<{ id: string; thumbnail_url: string; media_url: string; width?: number; height?: number; duration?: number }>) =>
    data.slice(0, 4).map((item) => ({
    id: `pexels-${item.id}-${page}`,
    segmentId: segment.id,
    source: 'pexels' as const,
    thumbnail_url: item.thumbnail_url,
    media_url: item.media_url,
    width: item.width,
    height: item.height,
    duration: item.duration,
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

  const url = `https://api.pexels.com/videos/search?query=${encodeURIComponent(keywords)}&per_page=20&page=${page}&min_duration=5&max_duration=30`;
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
      duration?: number;
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
      duration: video.duration,
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

export async function analyzeScript(script: string, onStatus?: (msg: string) => void): Promise<RawSegment[]> {
  onStatus?.('Reading your script…');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180_000);

  try {
    const groqKey = storage.getGroqKey().trim();
    const res = await fetch(ANALYZE_SCRIPT_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ script, groqKey: groqKey || undefined }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string };
      throw new Error(body.error ?? `Server error: ${res.status}`);
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error('No response stream available.');

    const decoder = new TextDecoder();
    let buffer = '';
    let segments: RawSegment[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const event = JSON.parse(line.slice(6)) as {
            type: string;
            message?: string;
            segments?: RawSegment[];
          };
          if (event.type === 'progress' && event.message) {
            onStatus?.(event.message);
          } else if (event.type === 'result' && event.segments) {
            segments = event.segments;
          } else if (event.type === 'error' && event.message) {
            throw new Error(event.message);
          }
        } catch (parseErr) {
          if ((parseErr as Error).message !== 'Unexpected end of JSON input') throw parseErr;
        }
      }
    }

    if (segments.length === 0) {
      throw new Error('Groq returned no segments. Please try again.');
    }

    segments.forEach((seg, i) => { seg.order_index = i + 1; });
    return segments;
  } catch (e) {
    clearTimeout(timeout);
    if ((e as Error).name === 'AbortError') throw new Error('TIMEOUT');
    throw e;
  }
}
