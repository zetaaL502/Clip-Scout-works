import type { Project, Segment, Clip } from './types';

const KEYS = {
  PROJECT: 'clipscout_project',
  SEGMENTS: 'clipscout_segments',
  CLIPS: 'clipscout_clips',
  SELECTIONS: 'clipscout_selections',
  GROQ_KEY: 'clipscout_groq_key',
  GIPHY_KEY: 'clipscout_giphy_key',
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
  localStorage.setItem(key, JSON.stringify(value));
}

export const storage = {
  getGroqKey: () => localStorage.getItem(KEYS.GROQ_KEY) ?? '',
  setGroqKey: (k: string) => localStorage.setItem(KEYS.GROQ_KEY, k),
  getGiphyKey: () => localStorage.getItem(KEYS.GIPHY_KEY) ?? '',
  setGiphyKey: (k: string) => localStorage.setItem(KEYS.GIPHY_KEY, k),

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

  getClips: () => get<Record<string, Clip[]>>(KEYS.CLIPS) ?? {},
  setClips: (c: Record<string, Clip[]>) => set(KEYS.CLIPS, c),
  addClips: (segmentId: string, newClips: Clip[]) => {
    const all = get<Record<string, Clip[]>>(KEYS.CLIPS) ?? {};
    all[segmentId] = [...(all[segmentId] ?? []), ...newClips];
    set(KEYS.CLIPS, all);
    return all;
  },
  getSegmentClips: (segmentId: string) => {
    const all = get<Record<string, Clip[]>>(KEYS.CLIPS) ?? {};
    return all[segmentId] ?? [];
  },

  getSelections: () => get<string[]>(KEYS.SELECTIONS) ?? [],
  setSelections: (ids: string[]) => set(KEYS.SELECTIONS, ids),
  toggleSelection: (id: string): string[] => {
    const current = get<string[]>(KEYS.SELECTIONS) ?? [];
    const updated = current.includes(id)
      ? current.filter((x) => x !== id)
      : [...current, id];
    set(KEYS.SELECTIONS, updated);
    return updated;
  },
  isSelected: (id: string): boolean => {
    const current = get<string[]>(KEYS.SELECTIONS) ?? [];
    return current.includes(id);
  },
};
