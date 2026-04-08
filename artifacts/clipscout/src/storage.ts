import type { Project, Segment, Clip } from "./types";

const KEYS = {
  PROJECT: "clipscout_project",
  SEGMENTS: "clipscout_segments",
  CLIPS: "clipscout_clips",
  SELECTIONS: "clipscout_selections",
  GROQ_KEY: "clipscout_groq_key",
  GEMINI_KEY: "clipscout_gemini_key",
  GIPHY_KEY: "clipscout_giphy_key",
  PEXELS_KEY: "clipscout_pexels_key",
  PIXABAY_KEY: "clipscout_pixabay_key",
  YOUTUBE_KEY: "clipscout_youtube_key",
};

function get<T>(key: string): T | null {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : null;
  } catch {
    return null;
  }
}

function set(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // QuotaExceededError — storage is full; silently ignore to prevent crash.
  }
}

function keepHorizontalClip(clip: Clip): boolean {
  if (clip.source !== "pexels") return true;
  if (typeof clip.width !== "number" || typeof clip.height !== "number")
    return false;
  return clip.width > clip.height;
}

function sanitizeClipMap(
  input: Record<string, Clip[]>,
): Record<string, Clip[]> {
  const next: Record<string, Clip[]> = {};
  Object.entries(input).forEach(([segmentId, clips]) => {
    next[segmentId] = (clips ?? []).filter(keepHorizontalClip);
  });
  return next;
}

export const storage = {
  getGroqKey: () => localStorage.getItem(KEYS.GROQ_KEY) ?? "",
  setGroqKey: (k: string) => localStorage.setItem(KEYS.GROQ_KEY, k),
  getGeminiKey: () => localStorage.getItem(KEYS.GEMINI_KEY) ?? "",
  setGeminiKey: (k: string) => localStorage.setItem(KEYS.GEMINI_KEY, k),
  getGiphyKey: () => localStorage.getItem(KEYS.GIPHY_KEY) ?? "",
  setGiphyKey: (k: string) => localStorage.setItem(KEYS.GIPHY_KEY, k),
  getPexelsKey: () => localStorage.getItem(KEYS.PEXELS_KEY) ?? "",
  setPexelsKey: (k: string) => localStorage.setItem(KEYS.PEXELS_KEY, k),
  getPixabayKey: () => localStorage.getItem(KEYS.PIXABAY_KEY) ?? "",
  setPixabayKey: (k: string) => localStorage.setItem(KEYS.PIXABAY_KEY, k),
  getYouTubeKey: () => localStorage.getItem(KEYS.YOUTUBE_KEY) ?? "",
  setYouTubeKey: (k: string) => localStorage.setItem(KEYS.YOUTUBE_KEY, k),

  getProject: () => get<Project>(KEYS.PROJECT),
  setProject: (p: Project) => set(KEYS.PROJECT, p),
  clearProject: () => {
    localStorage.removeItem(KEYS.PROJECT);
    localStorage.removeItem(KEYS.SEGMENTS);
    localStorage.removeItem(KEYS.CLIPS);
    localStorage.removeItem(KEYS.SELECTIONS);
  },

  getSegments: () => get<Segment[]>(KEYS.SEGMENTS) ?? [],
  setSegments: (s: Segment[]) => set(KEYS.SEGMENTS, s),

  getClips: () => {
    const raw = get<Record<string, Clip[]>>(KEYS.CLIPS) ?? {};
    const sanitized = sanitizeClipMap(raw);
    set(KEYS.CLIPS, sanitized);
    return sanitized;
  },
  setClips: (c: Record<string, Clip[]>) => set(KEYS.CLIPS, sanitizeClipMap(c)),
  addClips: (segmentId: string, newClips: Clip[]) => {
    const all = storage.getClips();
    const sanitizedNew = newClips.filter(keepHorizontalClip);
    all[segmentId] = [...(all[segmentId] ?? []), ...sanitizedNew];
    set(KEYS.CLIPS, all);
    return all;
  },
  getSegmentClips: (segmentId: string) => {
    const all = storage.getClips();
    return all[segmentId] ?? [];
  },

  selectionKey: (segmentIndex: number, clipIndex: number): string =>
    `segment_${segmentIndex}_clip_${clipIndex}`,
  isPositionalKey: (key: string): boolean => /^segment_\d+_clip_\d+$/.test(key),
  getSelections: (): string[] => {
    const raw = get<string[]>(KEYS.SELECTIONS) ?? [];
    const filtered = raw.filter((key) => /^segment_\d+_clip_\d+$/.test(key));
    if (filtered.length !== raw.length) {
      set(KEYS.SELECTIONS, filtered);
    }
    return filtered;
  },
  setSelections: (ids: string[]) => {
    const positional = ids.filter((key) => /^segment_\d+_clip_\d+$/.test(key));
    set(KEYS.SELECTIONS, positional);
  },
  toggleSelection: (segmentIndex: number, clipIndex: number): string[] => {
    const id = `segment_${segmentIndex}_clip_${clipIndex}`;
    const current = get<string[]>(KEYS.SELECTIONS) ?? [];
    const filtered = current.filter((key) =>
      /^segment_\d+_clip_\d+$/.test(key),
    );
    const updated = filtered.includes(id)
      ? filtered.filter((x) => x !== id)
      : [...filtered, id];
    set(KEYS.SELECTIONS, updated);
    return updated;
  },
  isSelected: (segmentIndex: number, clipIndex: number): boolean => {
    const id = `segment_${segmentIndex}_clip_${clipIndex}`;
    const current = get<string[]>(KEYS.SELECTIONS) ?? [];
    const filtered = current.filter((key) =>
      /^segment_\d+_clip_\d+$/.test(key),
    );
    return filtered.includes(id);
  },
};
