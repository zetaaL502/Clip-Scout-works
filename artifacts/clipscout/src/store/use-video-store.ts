import { create } from "zustand";

export type Gender = "M" | "F";
export type Format = "9:16" | "16:9";

export interface ScriptLine {
  index: number;
  character: string;
  text: string;
  isImage?: boolean;
}

export interface CharacterState {
  voice: string;
  gender: Gender;
  avatarFileId?: string;
  avatarUrl?: string;
}

export interface TimelineEntry {
  lineIndex: number;
  startTime: number;
  duration: number;
  type: "text" | "image";
}

export interface Settings {
  darkMode: boolean;
  format: Format;
  showFrame: boolean;
}

interface VideoState {
  scriptText: string;
  genderMap: Record<string, Gender>;
  parsedLines: ScriptLine[];
  characters: Record<string, CharacterState>;
  settings: Settings;
  backgroundVideoId?: string;
  backgroundMusicId?: string;
  jobId?: string;
  timeline: TimelineEntry[];
  exportId?: string;
  contactName: string;
  contactStatus: string;

  setScriptText: (text: string) => void;
  setGenderMap: (map: Record<string, Gender>) => void;
  setParsedLines: (lines: ScriptLine[]) => void;
  updateCharacter: (name: string, state: Partial<CharacterState>) => void;
  setSettings: (settings: Partial<Settings>) => void;
  setBackgroundVideoId: (id?: string) => void;
  setBackgroundMusicId: (id?: string) => void;
  setJobId: (id?: string) => void;
  setTimeline: (timeline: TimelineEntry[]) => void;
  setExportId: (id?: string) => void;
  setContactName: (name: string) => void;
  setContactStatus: (status: string) => void;
  reset: () => void;
}

const initialState = {
  scriptText: "",
  genderMap: {},
  parsedLines: [],
  characters: {},
  settings: { darkMode: true, format: "9:16" as Format, showFrame: true },
  timeline: [],
  contactName: "",
  contactStatus: "iMessage",
};

export const useVideoStore = create<VideoState>((set) => ({
  ...initialState,

  setScriptText: (scriptText) => set({ scriptText }),
  setGenderMap: (genderMap) => set({ genderMap }),
  setParsedLines: (parsedLines) => set({ parsedLines }),
  updateCharacter: (name, state) =>
    set((prev) => ({
      characters: { ...prev.characters, [name]: { ...prev.characters[name], ...state } },
    })),
  setSettings: (settings) =>
    set((prev) => ({ settings: { ...prev.settings, ...settings } })),
  setBackgroundVideoId: (backgroundVideoId) => set({ backgroundVideoId }),
  setBackgroundMusicId: (backgroundMusicId) => set({ backgroundMusicId }),
  setJobId: (jobId) => set({ jobId }),
  setTimeline: (timeline) => set({ timeline }),
  setExportId: (exportId) => set({ exportId }),
  setContactName: (contactName) => set({ contactName }),
  setContactStatus: (contactStatus) => set({ contactStatus }),
  reset: () => set({ ...initialState }),
}));
