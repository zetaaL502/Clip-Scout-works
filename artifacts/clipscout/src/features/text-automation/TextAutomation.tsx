import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { storage } from "@/storage";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Plus,
  Trash2,
  ChevronRight,
  ArrowLeft,
  Download,
  Loader2,
  Play,
  Pause,
  Upload,
  CheckCircle2,
  Image as ImageIcon,
  Video as VideoIcon,
  AlertCircle,
  Mic,
  Sun,
  Moon,
  Volume2,
  VolumeX,
  Smartphone,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";

/* ─── Constants ─────────────────────────────────────────────────────── */

const KOKORO_VOICES = [
  { id: "af_heart", label: "Heart", style: "American", gender: "Female" },
  { id: "af_bella", label: "Bella", style: "American", gender: "Female" },
  { id: "af_sarah", label: "Sarah", style: "American", gender: "Female" },
  { id: "af_sky", label: "Sky", style: "American", gender: "Female" },
  { id: "af_nicole", label: "Nicole", style: "American", gender: "Female" },
  { id: "am_adam", label: "Adam", style: "American", gender: "Male" },
  { id: "am_michael", label: "Michael", style: "American", gender: "Male" },
  { id: "bf_emma", label: "Emma", style: "British", gender: "Female" },
  { id: "bf_isabella", label: "Isabella", style: "British", gender: "Female" },
  { id: "bm_george", label: "George", style: "British", gender: "Male" },
  { id: "bm_lewis", label: "Lewis", style: "British", gender: "Male" },
] as const;

type KokoroVoiceId = (typeof KOKORO_VOICES)[number]["id"];

/* ─── Types ─────────────────────────────────────────────────────────── */

type Step = "setup" | "script" | "preview" | "audio" | "done";

interface Character {
  id: string;
  name: string;
  voice: KokoroVoiceId;
  isMe: boolean;
}

interface ParsedLine {
  id: string;
  charId: string;
  charName: string;
  isMe: boolean;
  type: "text" | "image" | "video";
  text: string;
  mediaSlotId?: string;
  mediaFile?: File;
  mediaUrl?: string;
  mediaServerId?: string;
}

/* ─── Helpers ─────────────────────────────────────────────────────── */

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function getInitials(name: string): string {
  const words = name.trim().split(/\s+/);
  if (words.length >= 2)
    return (words[0][0] + words[words.length - 1][0]).toUpperCase();
  const n = words[0] || "";
  if (!n) return "?";
  if (n.length === 1) return n.toUpperCase();
  return (n[0] + n[n.length - 1]).toUpperCase();
}

function cn(...cls: (string | boolean | undefined | null)[]): string {
  return cls.filter(Boolean).join(" ");
}

function parseScript(
  raw: string,
  chars: Character[],
): { lines: ParsedLine[]; error: string | null } {
  const rows = raw.split("\n").filter((l) => l.trim());
  if (!rows.length) return { lines: [], error: "Script is empty." };
  const lines: ParsedLine[] = [];
  for (let i = 0; i < rows.length; i++) {
    const colon = rows[i].indexOf(":");
    if (colon === -1)
      return {
        lines: [],
        error: `Line ${i + 1}: missing colon — use "Name: message"`,
      };
    const charName = rows[i].slice(0, colon).trim();
    const text = rows[i].slice(colon + 1).trim();
    const char = chars.find(
      (c) => c.name.trim().toLowerCase() === charName.toLowerCase(),
    );
    if (!char)
      return {
        lines: [],
        error: `Character "${charName}" not found — add them first.`,
      };
    if (!text)
      return {
        lines: [],
        error: `Line ${i + 1}: empty message for ${charName}.`,
      };
    const lower = text.toLowerCase();
    const imgIdMatch = /^\[img:([^\]]+)\]$/i.exec(text);
    const vidIdMatch = /^\[vid:([^\]]+)\]$/i.exec(text);
    const type: "text" | "image" | "video" =
      lower === "[image]" || imgIdMatch
        ? "image"
        : lower === "[video]" || vidIdMatch
          ? "video"
          : "text";
    const slotId = imgIdMatch?.[1] ?? vidIdMatch?.[1];
    lines.push({
      id: uid(),
      charId: char.id,
      charName: char.name,
      isMe: char.isMe,
      type,
      text: type === "text" ? text : "",
      ...(slotId ? { mediaSlotId: slotId } : {}),
    });
  }
  return { lines, error: null };
}

/* ─── Voice Preview Hook ─────────────────────────────────────────── */

function useVoicePreview() {
  const [previewing, setPreviewing] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const preview = useCallback(
    async (voice: string, characterName?: string) => {
      if (previewing === voice) {
        audioRef.current?.pause();
        setPreviewing(null);
        return;
      }
      setPreviewing(voice);
      const previewText = characterName
        ? `Hey, my name is ${characterName}. This is how I sound!`
        : "Hey, this is how I sound when I speak.";
      try {
        const res = await fetch("/api/imessage/preview-voice", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            voice,
            text: previewText,
            apiKey: storage.getGeminiKey(),
          }),
        });
        if (!res.ok) throw new Error("Preview failed");
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        if (audioRef.current) {
          audioRef.current.pause();
          URL.revokeObjectURL(audioRef.current.src);
        }
        const audio = new Audio(url);
        audioRef.current = audio;
        audio.play();
        audio.onended = () => setPreviewing(null);
      } catch {
        setPreviewing(null);
      }
    },
    [previewing],
  );

  return { previewing, preview };
}

/* ─── StepBar ─────────────────────────────────────────────────────── */

const STEPS: { id: Step; label: string }[] = [
  { id: "setup", label: "Cast" },
  { id: "script", label: "Script" },
  { id: "preview", label: "Preview" },
  { id: "audio", label: "Audio" },
  { id: "done", label: "Done" },
];

function StepBar({ current }: { current: Step }) {
  const idx = STEPS.findIndex((s) => s.id === current);
  return (
    <div className="flex items-center px-6 py-3 border-b border-white/5 bg-[#0a0a0a]">
      {STEPS.map((s, i) => {
        const past = i < idx;
        const active = i === idx;
        return (
          <div key={s.id} className="flex items-center flex-1 min-w-0">
            <div className="flex items-center gap-1.5 shrink-0">
              <div
                className={cn(
                  "w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold",
                  active
                    ? "bg-green-500 text-white"
                    : past
                      ? "bg-green-500/20 text-green-400"
                      : "bg-white/6 text-white/20",
                )}
              >
                {past ? "✓" : i + 1}
              </div>
              <span
                className={cn(
                  "text-xs font-medium hidden sm:block",
                  active
                    ? "text-white"
                    : past
                      ? "text-green-400"
                      : "text-white/20",
                )}
              >
                {s.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div
                className={cn(
                  "h-px flex-1 mx-2",
                  past ? "bg-green-500/30" : "bg-white/5",
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ─── VoiceSelector ─────────────────────────────────────────────── */

function VoiceSelector({
  value,
  onChange,
  characterName,
}: {
  value: string;
  onChange: (v: KokoroVoiceId) => void;
  characterName?: string;
}) {
  const { previewing, preview } = useVoicePreview();
  const isPreviewing = previewing === value;

  return (
    <div className="flex items-center gap-1.5">
      <Select value={value} onValueChange={(v) => onChange(v as KokoroVoiceId)}>
        <SelectTrigger className="w-40 h-8 text-xs bg-white/5 border-white/10 text-white">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="bg-[#1a1a1a] border-white/10 max-h-52">
          {KOKORO_VOICES.map((v) => (
            <SelectItem
              key={v.id}
              value={v.id}
              className="text-xs text-white/80 hover:text-white"
            >
              {v.label}{" "}
              <span className="text-white/35 ml-1">
                ({v.style}, {v.gender[0]})
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <button
        onClick={() => preview(value, characterName)}
        title={isPreviewing ? "Stop preview" : "Preview voice"}
        className={cn(
          "w-8 h-8 rounded-lg flex items-center justify-center transition-all shrink-0",
          isPreviewing
            ? "bg-green-500/20 text-green-400 animate-pulse"
            : "bg-white/5 text-white/40 hover:bg-white/10 hover:text-white/70",
        )}
      >
        {isPreviewing ? (
          <VolumeX className="h-3.5 w-3.5" />
        ) : (
          <Volume2 className="h-3.5 w-3.5" />
        )}
      </button>
    </div>
  );
}

/* ─── InitialsAvatar ─────────────────────────────────────────────── */

function Avatar({
  name,
  isMe,
  size = "md",
}: {
  name: string;
  isMe: boolean;
  size?: "sm" | "md" | "lg";
}) {
  const dim =
    size === "sm"
      ? "w-6 h-6 text-[9px]"
      : size === "lg"
        ? "w-14 h-14 text-lg"
        : "w-8 h-8 text-xs";
  return (
    <div
      className={cn(
        dim,
        "rounded-full flex items-center justify-center font-bold shrink-0",
        isMe ? "bg-green-500/20 text-green-300" : "bg-white/10 text-white/60",
      )}
    >
      {getInitials(name || "?")}
    </div>
  );
}

/* ─── Step 1: Setup ─────────────────────────────────────────────── */

function SetupStep({
  characters,
  onChange,
  onNext,
}: {
  characters: Character[];
  onChange: (c: Character[]) => void;
  onNext: () => void;
}) {
  const [err, setErr] = useState("");
  const me = characters.find((c) => c.isMe)!;
  const them = characters.filter((c) => !c.isMe);

  const update = (id: string, patch: Partial<Character>) =>
    onChange(characters.map((c) => (c.id === id ? { ...c, ...patch } : c)));

  const handleNext = () => {
    if (!me.name.trim()) {
      setErr("Enter your name.");
      return;
    }
    if (!them.length || !them[0].name.trim()) {
      setErr("Enter at least one contact name.");
      return;
    }
    const names = characters.map((c) => c.name.trim().toLowerCase());
    const dup = names.find((n, i) => n && names.indexOf(n) !== i);
    if (dup) {
      setErr(`"${dup}" appears twice.`);
      return;
    }
    setErr("");
    onNext();
  };

  return (
    <div className="p-8 max-w-xl mx-auto space-y-8">
      <div>
        <h2 className="text-lg font-semibold text-white">Set up your cast</h2>
        <p className="text-sm text-white/35 mt-0.5">
          Give each person a name and pick their Google AI voice.
        </p>
      </div>

      {/* You */}
      <div className="space-y-2">
        <p className="text-[10px] font-semibold tracking-widest text-white/30 uppercase">
          You — sender (green bubbles)
        </p>
        <div className="flex items-center gap-2 p-3 rounded-xl bg-green-500/5 border border-green-500/15">
          <Avatar name={me.name || "Y"} isMe={true} />
          <Input
            value={me.name}
            onChange={(e) => {
              update(me.id, { name: e.target.value });
              setErr("");
            }}
            placeholder="Your name (e.g. Maria)"
            className="flex-1 bg-white/4 border-white/8 text-white placeholder:text-white/20 h-8 text-sm"
          />
          <VoiceSelector
            value={me.voice}
            onChange={(v) => update(me.id, { voice: v })}
            characterName={me.name}
          />
        </div>
      </div>

      {/* Contacts */}
      <div className="space-y-2">
        <p className="text-[10px] font-semibold tracking-widest text-white/30 uppercase">
          Who are you texting? (gray bubbles)
        </p>
        <div className="space-y-2">
          {them.map((char, i) => (
            <div
              key={char.id}
              className="flex items-center gap-2 p-3 rounded-xl bg-white/3 border border-white/6"
            >
              <Avatar name={char.name || "?"} isMe={false} />
              <Input
                value={char.name}
                onChange={(e) => {
                  update(char.id, { name: e.target.value });
                  setErr("");
                }}
                placeholder={
                  i === 0 ? "Contact name (e.g. Kaleb)" : "Character name"
                }
                className="flex-1 bg-white/4 border-white/8 text-white placeholder:text-white/20 h-8 text-sm"
              />
              <VoiceSelector
                value={char.voice}
                onChange={(v) => update(char.id, { voice: v })}
                characterName={char.name}
              />
              {them.length > 1 && (
                <button
                  onClick={() =>
                    onChange(characters.filter((c) => c.id !== char.id))
                  }
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-white/25 hover:text-red-400 hover:bg-red-500/10 transition-colors shrink-0"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
        <button
          onClick={() =>
            onChange([
              ...characters,
              { id: uid(), name: "", voice: "af_sarah", isMe: false },
            ])
          }
          className="flex items-center gap-2 text-xs text-white/30 hover:text-white/60 transition-colors mt-1"
        >
          <div className="w-6 h-6 rounded-full border border-dashed border-white/15 flex items-center justify-center">
            <Plus className="h-3 w-3" />
          </div>
          Add another character
        </button>
      </div>

      {err && (
        <p className="flex items-center gap-2 text-red-400 text-xs">
          <AlertCircle className="h-3.5 w-3.5" />
          {err}
        </p>
      )}

      <div className="flex justify-end">
        <Button
          onClick={handleNext}
          className="bg-green-600 hover:bg-green-700 h-9 text-sm px-5"
        >
          Next: Script <ChevronRight className="ml-1 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

/* ─── Step 2: Script ─────────────────────────────────────────────── */

type ScriptMedia = Record<
  string,
  { file: File; url: string; type: "image" | "video" }
>;

function ScriptStep({
  characters,
  initialScript,
  onParsed,
  onBack,
}: {
  characters: Character[];
  initialScript: string;
  onParsed: (lines: ParsedLine[], script: string) => void;
  onBack: () => void;
}) {
  const [text, setText] = useState(initialScript);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ParsedLine[]>([]);
  const [mediaMap, setMediaMap] = useState<ScriptMedia>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingSlotId = useRef<string | null>(null);
  const pendingSlotType = useRef<"image" | "video" | null>(null);
  const me = characters.find((c) => c.isMe);
  const contact = characters.find((c) => !c.isMe);

  useEffect(() => {
    if (!text.trim()) {
      setPreview([]);
      setError(null);
      return;
    }
    const { lines, error: err } = parseScript(text, characters);
    if (err) {
      setError(err);
      setPreview([]);
    } else {
      setError(null);
      setPreview(lines);
    }
  }, [text, characters]);

  const handleTextChange = (newVal: string) => {
    const hadImage = /\[image\]/i.test(text);
    const hasImage = /\[image\]/i.test(newVal);
    if (hasImage && !hadImage) {
      const slotId = uid();
      const replaced = newVal.replace(/\[image\]/i, `[img:${slotId}]`);
      setText(replaced);
      pendingSlotId.current = slotId;
      pendingSlotType.current = "image";
      if (fileInputRef.current) {
        fileInputRef.current.accept = "image/*";
        fileInputRef.current.value = "";
        fileInputRef.current.click();
      }
      return;
    }
    const hadVideo = /\[video\]/i.test(text);
    const hasVideo = /\[video\]/i.test(newVal);
    if (hasVideo && !hadVideo) {
      const slotId = uid();
      const replaced = newVal.replace(/\[video\]/i, `[vid:${slotId}]`);
      setText(replaced);
      pendingSlotId.current = slotId;
      pendingSlotType.current = "video";
      if (fileInputRef.current) {
        fileInputRef.current.accept = "video/*";
        fileInputRef.current.value = "";
        fileInputRef.current.click();
      }
      return;
    }
    setText(newVal);
  };

  const handleFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const slotId = pendingSlotId.current;
    const slotType = pendingSlotType.current;
    if (!file || !slotId || !slotType) return;
    const url = URL.createObjectURL(file);
    setMediaMap((prev) => ({
      ...prev,
      [slotId]: { file, url, type: slotType },
    }));
    pendingSlotId.current = null;
    pendingSlotType.current = null;
  };

  const removeMedia = (slotId: string) => {
    setMediaMap((prev) => {
      const next = { ...prev };
      URL.revokeObjectURL(next[slotId]?.url ?? "");
      delete next[slotId];
      return next;
    });
    setText((prev) =>
      prev.replace(`[img:${slotId}]`, "").replace(`[vid:${slotId}]`, ""),
    );
  };

  const handleProcess = () => {
    const { lines, error: err } = parseScript(text, characters);
    if (err) {
      setError(err);
      return;
    }
    if (!lines.length) {
      setError("Script is empty.");
      return;
    }
    const linesWithMedia = lines.map((line) => {
      if (line.mediaSlotId && mediaMap[line.mediaSlotId]) {
        const { file, url } = mediaMap[line.mediaSlotId];
        return { ...line, mediaFile: file, mediaUrl: url };
      }
      return line;
    });
    onParsed(linesWithMedia, text);
  };

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-white">Write the script</h2>
        <p className="text-sm text-white/35 mt-0.5">
          Format:{" "}
          <code className="text-green-400 text-xs bg-green-500/10 px-1 rounded">
            Name: message
          </code>{" "}
          — type{" "}
          <code className="text-blue-400 text-xs bg-blue-500/10 px-1 rounded">
            [image]
          </code>{" "}
          or{" "}
          <code className="text-blue-400 text-xs bg-blue-500/10 px-1 rounded">
            [video]
          </code>{" "}
          to instantly attach media.
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {characters.map((c) => (
          <span
            key={c.id}
            className={cn(
              "px-2 py-0.5 rounded-full text-[11px] font-medium",
              c.isMe
                ? "bg-green-500/15 text-green-300"
                : "bg-white/8 text-white/50",
            )}
          >
            {c.name || "(unnamed)"} ·{" "}
            {KOKORO_VOICES.find((v) => v.id === c.voice)?.label ?? c.voice}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
        <div className="lg:col-span-3 space-y-3">
          <Textarea
            value={text}
            onChange={(e) => handleTextChange(e.target.value)}
            placeholder={`${me?.name || "You"}: hey you free later?\n${contact?.name || "Kaleb"}: yeah why whats up\n${me?.name || "You"}: [image]\n${contact?.name || "Kaleb"}: [video]`}
            className="min-h-[300px] bg-white/3 border-white/8 text-white font-mono text-sm resize-none leading-relaxed focus:border-green-500/40 focus:ring-0"
            spellCheck={false}
          />

          {/* Hidden file input — triggered when user types [image] or [video] */}
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={handleFileSelected}
          />

          {/* Attached media thumbnails */}
          {Object.keys(mediaMap).length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] text-white/25 uppercase tracking-wider font-semibold">
                Attached media
              </p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(mediaMap).map(
                  ([slotId, { url, type, file }]) => (
                    <div key={slotId} className="relative group">
                      {type === "image" ? (
                        <img
                          src={url}
                          alt={file.name}
                          className="w-16 h-16 rounded-lg object-cover border border-white/10"
                        />
                      ) : (
                        <video
                          src={url}
                          className="w-16 h-16 rounded-lg object-cover border border-white/10"
                          muted
                        />
                      )}
                      <button
                        onClick={() => removeMedia(slotId)}
                        className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        ×
                      </button>
                      <p className="text-[8px] text-white/30 mt-0.5 text-center truncate max-w-[64px]">
                        {file.name.slice(0, 12)}
                      </p>
                    </div>
                  ),
                )}
              </div>
            </div>
          )}

          {error && (
            <p className="flex items-center gap-1.5 text-red-400 text-xs">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              {error}
            </p>
          )}
          <Button
            onClick={handleProcess}
            disabled={!text.trim() || !!error}
            className="bg-green-600 hover:bg-green-700 h-9 text-sm w-full"
          >
            Process Script →
          </Button>
        </div>

        <div className="lg:col-span-2">
          <div className="rounded-xl border border-white/6 bg-white/3 overflow-hidden h-[334px] flex flex-col">
            <div className="px-3 py-2 border-b border-white/5">
              <p className="text-[10px] text-white/25 font-medium uppercase tracking-wider">
                Preview · {preview.length} lines
              </p>
            </div>
            <div className="flex-1 overflow-auto p-3 space-y-1.5">
              {!preview.length ? (
                <p className="text-xs text-white/20 text-center mt-10">
                  Start typing…
                </p>
              ) : (
                preview.map((line) => (
                  <div
                    key={line.id}
                    className={cn(
                      "flex",
                      line.isMe ? "justify-end" : "justify-start",
                    )}
                  >
                    {!line.isMe && (
                      <Avatar name={line.charName} isMe={false} size="sm" />
                    )}
                    <div className="max-w-[78%] ml-1.5">
                      {!line.isMe && (
                        <p className="text-[9px] text-white/30 mb-0.5 ml-1">
                          {line.charName}
                        </p>
                      )}
                      <div
                        className={cn(
                          "px-2.5 py-1.5 rounded-xl text-[11px] leading-snug",
                          line.isMe
                            ? "bg-[#34c759] text-white rounded-br-none"
                            : "bg-white/10 text-white/75 rounded-bl-none",
                        )}
                      >
                        {line.type === "image" &&
                          (line.mediaSlotId && mediaMap[line.mediaSlotId] ? (
                            <img
                              src={mediaMap[line.mediaSlotId].url}
                              alt="img"
                              className="rounded max-w-full max-h-16 object-cover"
                            />
                          ) : (
                            <span className="flex items-center gap-1 opacity-60">
                              <ImageIcon className="h-3 w-3" /> image
                            </span>
                          ))}
                        {line.type === "video" &&
                          (line.mediaSlotId && mediaMap[line.mediaSlotId] ? (
                            <video
                              src={mediaMap[line.mediaSlotId].url}
                              className="rounded max-w-full max-h-16 object-cover"
                              muted
                            />
                          ) : (
                            <span className="flex items-center gap-1 opacity-60">
                              <VideoIcon className="h-3 w-3" /> video
                            </span>
                          ))}
                        {line.type === "text" && line.text}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="flex justify-between">
        <Button
          variant="ghost"
          onClick={onBack}
          className="text-white/35 hover:text-white h-9 text-sm"
        >
          <ArrowLeft className="mr-2 h-3.5 w-3.5" /> Back
        </Button>
      </div>
    </div>
  );
}

/* ─── Typing Indicator ──────────────────────────────────────────── */

function TypingDots({ isMe, dark }: { isMe: boolean; dark: boolean }) {
  const bg = isMe ? "bg-[#34c759]" : dark ? "bg-[#3A3A3C]" : "bg-[#E5E5EA]";
  const dot = isMe ? "bg-white/60" : dark ? "bg-white/50" : "bg-gray-500/60";
  return (
    <div
      className={cn(
        "flex items-center gap-1 px-3 py-2.5 rounded-2xl w-fit",
        bg,
        isMe ? "rounded-br-sm ml-auto mr-3" : "rounded-bl-sm ml-3",
      )}
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className={cn("w-1.5 h-1.5 rounded-full animate-bounce", dot)}
          style={{ animationDelay: `${i * 0.15}s` }}
        />
      ))}
    </div>
  );
}

/* ─── Step 3: Preview ───────────────────────────────────────────── */

function PreviewStep({
  characters,
  lines,
  onLinesChange,
  onGenerate,
  onBack,
}: {
  characters: Character[];
  lines: ParsedLine[];
  onLinesChange: (l: ParsedLine[]) => void;
  onGenerate: (darkMode: boolean) => void;
  onBack: () => void;
}) {
  const [visibleCount, setVisibleCount] = useState(lines.length);
  const [playing, setPlaying] = useState(false);
  const [showTyping, setShowTyping] = useState(false);
  const [typingIsMe, setTypingIsMe] = useState(false);
  const [dark, setDark] = useState(false);
  const playRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messagesRef = useRef<HTMLDivElement>(null); // scroll the container itself, not the page
  const mediaInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const contact = characters.find((c) => !c.isMe);

  // Scroll messages container only — not the page
  const scrollMessages = useCallback(() => {
    if (messagesRef.current) {
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
    }
  }, []);

  useEffect(() => {
    scrollMessages();
  }, [visibleCount, showTyping]);

  const playSequence = useCallback(
    (idx: number) => {
      if (!playRef.current || idx >= lines.length) {
        setPlaying(false);
        setShowTyping(false);
        playRef.current = false;
        return;
      }
      const line = lines[idx];
      setShowTyping(true);
      setTypingIsMe(line.isMe);
      timerRef.current = setTimeout(() => {
        if (!playRef.current) return;
        setShowTyping(false);
        setVisibleCount(idx + 1);
        timerRef.current = setTimeout(() => {
          if (playRef.current) playSequence(idx + 1);
        }, 350);
      }, 950);
    },
    [lines],
  );

  const togglePlay = () => {
    if (playing) {
      playRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      setPlaying(false);
      setShowTyping(false);
    } else {
      setVisibleCount(0);
      playRef.current = true;
      setPlaying(true);
      timerRef.current = setTimeout(() => playSequence(0), 250);
    }
  };

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  const handleMediaUpload = async (lineId: string, file: File) => {
    const url = URL.createObjectURL(file);
    onLinesChange(
      lines.map((l) =>
        l.id === lineId ? { ...l, mediaFile: file, mediaUrl: url } : l,
      ),
    );
    const form = new FormData();
    form.append("file", file);
    try {
      const res = await fetch("/api/conversation/upload-media", {
        method: "POST",
        body: form,
      });
      const data = (await res.json()) as { mediaId?: string };
      if (data.mediaId) {
        onLinesChange(
          lines.map((l) =>
            l.id === lineId
              ? {
                  ...l,
                  mediaFile: file,
                  mediaUrl: `/api/conversation/media/${data.mediaId}`,
                  mediaServerId: data.mediaId,
                }
              : l,
          ),
        );
      }
    } catch (_) {}
  };

  const visibleLines = lines.slice(0, visibleCount);
  const nextLine = lines[visibleCount] ?? null;
  const hasMedia = lines.some((l) => l.type !== "text");
  const missingMedia = lines.filter((l) => l.type !== "text" && !l.mediaUrl);

  // Dark mode phone colors
  const phoneBg = dark ? "#1C1C1E" : "#FFFFFF";
  const headerBg = dark ? "#1C1C1E" : "#FFFFFF";
  const headerBorder = dark ? "#2C2C2E" : "#E5E5EA";
  const msgsBg = dark ? "#000000" : "#FFFFFF";
  const themBubble = dark ? "#3A3A3C" : "#E5E5EA";
  const themText = dark ? "#FFFFFF" : "#000000";
  const inputBg = dark ? "#1C1C1E" : "#F2F2F7";
  const inputBorder = dark ? "#2C2C2E" : "#E5E5EA";
  const timeColor = dark ? "#EBEBF599" : "#000000";
  const nameColor = dark ? "#FFFFFF" : "#000000";

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Preview</h2>
          <p className="text-sm text-white/35 mt-0.5">
            Play the animation, upload media, then generate audio.
          </p>
        </div>
        {/* Dark/Light toggle */}
        <button
          onClick={() => setDark(!dark)}
          className={cn(
            "flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border transition-all",
            dark
              ? "bg-white/8 border-white/15 text-white/70 hover:bg-white/12"
              : "bg-white/5 border-white/10 text-white/50 hover:bg-white/8",
          )}
        >
          {dark ? (
            <Moon className="h-3.5 w-3.5" />
          ) : (
            <Sun className="h-3.5 w-3.5" />
          )}
          {dark ? "Dark" : "Light"}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {/* Phone mockup — fixed height, no page scroll */}
        <div className="mx-auto w-64 flex-shrink-0">
          <div
            className="rounded-[32px] overflow-hidden border-[3px]"
            style={{
              borderColor: dark ? "#3A3A3C" : "rgba(255,255,255,0.15)",
              background: phoneBg,
              boxShadow: "0 24px 60px rgba(0,0,0,0.5)",
            }}
          >
            {/* Status bar */}
            <div
              className="px-5 pt-3 pb-1 flex justify-between items-center"
              style={{ background: headerBg }}
            >
              <span
                className="text-[10px] font-semibold"
                style={{ color: timeColor }}
              >
                9:41
              </span>
              <div className="flex items-center gap-1">
                <div
                  className="w-4 h-2 border rounded-[2px] relative"
                  style={{ borderColor: `${timeColor}60` }}
                >
                  <div
                    className="absolute inset-[2px] left-[2px] rounded-[1px]"
                    style={{ width: "70%", background: timeColor }}
                  />
                </div>
              </div>
            </div>

            {/* iMessage header */}
            <div
              className="px-3 pb-3"
              style={{
                background: headerBg,
                borderBottom: `1px solid ${headerBorder}`,
              }}
            >
              <div className="flex items-center justify-between mb-2">
                <button className="flex items-center gap-0.5 text-[#007AFF] text-sm font-medium">
                  <span className="text-xl leading-none">‹</span>
                  <span className="text-[10px] font-bold bg-[#007AFF] text-white rounded-full px-1.5 py-0.5 ml-0.5">
                    99+
                  </span>
                </button>
                <div className="w-9 h-9 rounded-full bg-gray-400 flex items-center justify-center text-xs font-bold text-white shrink-0">
                  {getInitials(contact?.name || "?")}
                </div>
                <button className="text-[#007AFF]">
                  <VideoIcon className="h-4 w-4" />
                </button>
              </div>
              <p
                className="text-center text-xs font-semibold flex items-center justify-center gap-0.5"
                style={{ color: nameColor }}
              >
                {contact?.name || "Contact"}{" "}
                <ChevronRight className="h-3 w-3 text-gray-400" />
              </p>
            </div>

            {/* Messages — scroll INSIDE this div only */}
            <div
              ref={messagesRef}
              className="h-72 overflow-y-auto flex flex-col py-2 px-2 space-y-0.5"
              style={{ background: msgsBg }}
            >
              {visibleLines.map((line) => (
                <div key={line.id}>
                  {!line.isMe && (
                    <p
                      className="text-[9px] ml-8 mb-0.5"
                      style={{ color: dark ? "#98989E" : "#6D6D72" }}
                    >
                      {line.charName}
                    </p>
                  )}
                  <div
                    className={cn(
                      "flex items-end gap-1",
                      line.isMe ? "justify-end" : "justify-start",
                    )}
                  >
                    {!line.isMe && (
                      <div className="w-5 h-5 rounded-full bg-gray-400 flex items-center justify-center text-[8px] font-bold text-white shrink-0 mb-0.5">
                        {getInitials(line.charName)}
                      </div>
                    )}
                    <div
                      className={cn(
                        "max-w-[72%] px-2.5 py-1.5 rounded-2xl text-[11px] leading-snug",
                        line.isMe
                          ? "bg-[#34c759] text-white rounded-br-sm"
                          : "rounded-bl-sm",
                      )}
                      style={
                        !line.isMe
                          ? { background: themBubble, color: themText }
                          : {}
                      }
                    >
                      {line.type === "text" && line.text}
                      {line.type === "image" &&
                        (line.mediaUrl ? (
                          <img
                            src={line.mediaUrl}
                            alt="img"
                            className="rounded-lg max-w-full max-h-28 object-cover"
                          />
                        ) : (
                          <span className="flex items-center gap-1 opacity-50 text-[10px]">
                            <ImageIcon className="h-3 w-3" /> image
                          </span>
                        ))}
                      {line.type === "video" &&
                        (line.mediaUrl ? (
                          <video
                            src={line.mediaUrl}
                            autoPlay
                            muted
                            loop
                            playsInline
                            className="rounded-lg max-w-full max-h-28 object-cover"
                          />
                        ) : (
                          <span className="flex items-center gap-1 opacity-50 text-[10px]">
                            <VideoIcon className="h-3 w-3" /> video
                          </span>
                        ))}
                    </div>
                  </div>
                </div>
              ))}
              {showTyping && nextLine && (
                <TypingDots isMe={typingIsMe} dark={dark} />
              )}
            </div>

            {/* iOS input bar */}
            <div
              className="px-2 py-2 flex items-center gap-2"
              style={{
                borderTop: `1px solid ${inputBorder}`,
                background: headerBg,
              }}
            >
              <div
                className="flex-1 rounded-full px-3 py-1 text-[10px]"
                style={{
                  background: inputBg,
                  color: dark ? "#98989E" : "#8E8E93",
                }}
              >
                iMessage
              </div>
              <div className="w-5 h-5 rounded-full bg-[#34c759] flex items-center justify-center shrink-0">
                <span className="text-white text-[8px] font-bold">↑</span>
              </div>
            </div>
          </div>

          {/* Playback controls */}
          <div className="flex items-center justify-center gap-2 mt-4">
            <button
              onClick={togglePlay}
              className={cn(
                "flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-medium transition-colors",
                playing
                  ? "bg-red-500/15 text-red-400 hover:bg-red-500/25"
                  : "bg-white/8 text-white/60 hover:bg-white/12",
              )}
            >
              {playing ? (
                <Pause className="h-3.5 w-3.5" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
              {playing ? "Stop" : "Play"}
            </button>
            <button
              onClick={() => setVisibleCount(lines.length)}
              className="px-4 py-1.5 rounded-full text-xs text-white/30 hover:text-white/50 transition-colors"
            >
              Show all
            </button>
          </div>
        </div>

        {/* Right panel */}
        <div className="space-y-4">
          {/* Media slots */}
          {hasMedia && (
            <div className="space-y-2">
              <p className="text-[10px] font-semibold tracking-widest text-white/30 uppercase">
                Media slots
              </p>
              {lines
                .filter((l) => l.type !== "text")
                .map((line) => (
                  <div
                    key={line.id}
                    className="flex items-center gap-3 p-3 rounded-xl bg-white/3 border border-white/6"
                  >
                    <div
                      className={cn(
                        "w-7 h-7 rounded-lg flex items-center justify-center shrink-0",
                        line.type === "image"
                          ? "bg-blue-500/15 text-blue-400"
                          : "bg-purple-500/15 text-purple-400",
                      )}
                    >
                      {line.type === "image" ? (
                        <ImageIcon className="h-3.5 w-3.5" />
                      ) : (
                        <VideoIcon className="h-3.5 w-3.5" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-white/60 truncate">
                        {line.charName}'s {line.type}
                      </p>
                      {line.mediaUrl && (
                        <p className="text-[10px] text-green-400">✓ uploaded</p>
                      )}
                    </div>
                    <label
                      className={cn(
                        "flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs cursor-pointer transition-colors shrink-0",
                        line.mediaUrl
                          ? "bg-green-500/10 text-green-400 hover:bg-green-500/15"
                          : "bg-white/8 text-white/50 hover:bg-white/12",
                      )}
                    >
                      <Upload className="h-3 w-3" />
                      {line.mediaUrl ? "Replace" : "Upload"}
                      <input
                        ref={(el) => {
                          mediaInputRefs.current[line.id] = el;
                        }}
                        type="file"
                        accept={line.type === "image" ? "image/*" : "video/*"}
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) handleMediaUpload(line.id, f);
                        }}
                      />
                    </label>
                  </div>
                ))}
              {missingMedia.length > 0 && (
                <p className="text-xs text-amber-400/80 flex items-center gap-1.5">
                  <AlertCircle className="h-3 w-3" />
                  {missingMedia.length} slot{missingMedia.length > 1 ? "s" : ""}{" "}
                  without media (optional)
                </p>
              )}
            </div>
          )}

          {/* Script summary */}
          <div className="rounded-xl border border-white/6 bg-white/3 p-4 space-y-2">
            <p className="text-[10px] font-semibold tracking-widest text-white/30 uppercase">
              Script
            </p>
            <div className="space-y-1 max-h-44 overflow-auto">
              {lines.map((line) => (
                <div
                  key={line.id}
                  className="flex items-center gap-2 text-[11px]"
                >
                  <span
                    className={cn(
                      "w-1.5 h-1.5 rounded-full shrink-0",
                      line.isMe ? "bg-green-400" : "bg-white/25",
                    )}
                  />
                  <span
                    className={cn(
                      "w-14 truncate font-medium shrink-0",
                      line.isMe ? "text-green-300" : "text-white/50",
                    )}
                  >
                    {line.charName}
                  </span>
                  <span className="text-white/25 truncate">
                    {line.type === "text"
                      ? `"${line.text.slice(0, 35)}${line.text.length > 35 ? "…" : ""}"`
                      : `[${line.type}]`}
                  </span>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-white/20 pt-1">
              {lines.filter((l) => l.type === "text").length} voice lines ·{" "}
              {lines.filter((l) => l.type !== "text").length} media
            </p>
          </div>

          <Button
            onClick={() => onGenerate(dark)}
            className="w-full bg-green-600 hover:bg-green-700 h-9 text-sm"
          >
            <Mic className="mr-2 h-4 w-4" /> Generate Video
          </Button>
        </div>
      </div>

      <div className="flex justify-between pt-1">
        <Button
          variant="ghost"
          onClick={onBack}
          className="text-white/35 hover:text-white h-9 text-sm"
        >
          <ArrowLeft className="mr-2 h-3.5 w-3.5" /> Back
        </Button>
      </div>
    </div>
  );
}

/* ─── Step 4: Audio + Video Generation ─────────────────────────── */

function AudioStep({
  lines,
  characters,
  darkMode,
  onDone,
  onBack,
}: {
  lines: ParsedLine[];
  characters: Character[];
  darkMode: boolean;
  onDone: (audioJobId: string, videoJobId: string) => void;
  onBack: () => void;
}) {
  const [phase, setPhase] = useState<"audio" | "video">("audio");
  const [audioJobId, setAudioJobId] = useState<string | null>(null);
  const [audioProgress, setAudioProgress] = useState<{
    status: string;
    completed: number;
    total: number;
    durations?: Record<number, number>;
  } | null>(null);
  const [videoJobId, setVideoJobId] = useState<string | null>(null);
  const [videoProgress, setVideoProgress] = useState<{
    status: string;
    progress: number;
    errorMessage?: string;
  } | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const started = useRef(false);

  /* ── Phase 1: start audio generation ── */
  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const textLines = lines.filter((l) => l.type === "text");
    const payload = textLines.map((l, idx) => {
      const char = characters.find((c) => c.id === l.charId);
      return {
        index: idx,
        character: l.charName,
        text: l.text,
        voice: char?.voice ?? "Aoede",
      };
    });

    fetch("/api/imessage/generate-audio", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lines: payload, apiKey: storage.getGeminiKey() }),
    })
      .then(async (r) => {
        const text = await r.text();
        if (!r.ok || !text) {
          throw new Error(
            `Server error: ${r.status} ${text || "Empty response - is the API server running?"}`,
          );
        }
        return JSON.parse(text) as { jobId?: string; error?: string };
      })
      .then((d) => {
        if (d.error) {
          setStartError(d.error);
          return;
        }
        if (d.jobId) setAudioJobId(d.jobId);
      })
      .catch((e) => setStartError(String(e)));
  }, []);

  /* ── Phase 1: poll audio ── */
  useEffect(() => {
    if (!audioJobId) return;
    const iv = setInterval(async () => {
      try {
        const res = await fetch(`/api/imessage/audio-progress/${audioJobId}`);
        const data = (await res.json()) as {
          status: string;
          completed: number;
          total: number;
          durations: Record<number, number>;
        };
        setAudioProgress(data);
        if (data.status === "done") {
          clearInterval(iv);
          startVideo(audioJobId, data.durations);
        }
        if (data.status === "error") clearInterval(iv);
      } catch (_) {}
    }, 1500);
    return () => clearInterval(iv);
  }, [audioJobId]);

  /* ── Phase 2: start video generation ── */
  const startVideo = async (
    aJobId: string,
    durations: Record<number, number>,
  ) => {
    setPhase("video");
    const textLines = lines.filter((l) => l.type === "text");
    const scriptLines = textLines.map((l, idx) => ({
      index: idx,
      text: l.text,
      charName: l.charName,
      isMe: l.isMe,
    }));

    try {
      const res = await fetch("/api/imessage/generate-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audioJobId: aJobId,
          lines: scriptLines,
          darkMode,
        }),
      });
      const d = (await res.json()) as { videoJobId?: string; error?: string };
      if (d.error) {
        setStartError(d.error);
        return;
      }
      if (d.videoJobId) setVideoJobId(d.videoJobId);
    } catch (e) {
      setStartError(String(e));
    }
  };

  /* ── Phase 2: poll video ── */
  useEffect(() => {
    if (!videoJobId) return;
    const iv = setInterval(async () => {
      try {
        const res = await fetch(`/api/imessage/video-progress/${videoJobId}`);
        const data = (await res.json()) as {
          status: string;
          progress: number;
          errorMessage?: string;
        };
        setVideoProgress(data);
        if (data.status === "done") {
          clearInterval(iv);
          onDone(audioJobId!, videoJobId);
        }
        if (data.status === "error") clearInterval(iv);
      } catch (_) {}
    }, 1500);
    return () => clearInterval(iv);
  }, [videoJobId]);

  const isErr =
    audioProgress?.status === "error" || videoProgress?.status === "error";
  const errMsg = videoProgress?.errorMessage ?? "";

  /* Audio progress display */
  const audioTotal =
    audioProgress?.total ?? lines.filter((l) => l.type === "text").length;
  const audioDone = audioProgress?.completed ?? 0;
  const audioPct =
    audioTotal > 0 ? Math.round((audioDone / audioTotal) * 100) : 0;

  /* Overall progress: audio = 0–50%, video = 50–100% */
  const overallPct =
    phase === "audio"
      ? Math.round(audioPct * 0.5)
      : 50 + Math.round((videoProgress?.progress ?? 0) * 0.5);

  const dark = darkMode;
  const phoneBg = dark ? "#1C1C1E" : "#FFFFFF";
  const headerBg = dark ? "#1C1C1E" : "#FFFFFF";
  const headerBorder = dark ? "#2C2C2E" : "#E5E5EA";
  const msgsBg = dark ? "#000000" : "#FFFFFF";
  const timeColor = dark ? "#EBEBF599" : "#000000";
  const nameColor = dark ? "#FFFFFF" : "#000000";
  const contact = characters.find((c) => !c.isMe);

  return (
    <div className="p-8 max-w-4xl mx-auto flex flex-col items-center">
      <div className="relative mx-auto w-64 flex-shrink-0">
        <div
          className="rounded-[32px] overflow-hidden border-[3px]"
          style={{
            borderColor: dark ? "#3A3A3C" : "rgba(255,255,255,0.15)",
            background: phoneBg,
            boxShadow: "0 24px 60px rgba(0,0,0,0.5)",
          }}
        >
          <div
            className="px-5 pt-3 pb-1 flex justify-between items-center"
            style={{ background: headerBg }}
          >
            <span
              className="text-[10px] font-semibold"
              style={{ color: timeColor }}
            >
              9:41
            </span>
            <div className="flex items-center gap-1">
              <div
                className="w-4 h-2 border rounded-[2px]"
                style={{ borderColor: `${timeColor}60` }}
              />
            </div>
          </div>
          <div
            className="px-3 pb-3"
            style={{
              background: headerBg,
              borderBottom: `1px solid ${headerBorder}`,
            }}
          >
            <div className="flex items-center justify-between mb-2">
              <button className="flex items-center gap-0.5 text-[#007AFF] text-sm font-medium">
                <span className="text-xl leading-none">‹</span>
              </button>
              <div className="w-9 h-9 rounded-full bg-gray-400 flex items-center justify-center text-xs font-bold text-white shrink-0">
                {getInitials(contact?.name || "?")}
              </div>
              <button className="text-[#007AFF]">
                <VideoIcon className="h-4 w-4" />
              </button>
            </div>
            <p
              className="text-center text-xs font-semibold flex items-center justify-center gap-0.5"
              style={{ color: nameColor }}
            >
              {contact?.name || "Contact"}{" "}
              <ChevronRight className="h-3 w-3 text-gray-400" />
            </p>
          </div>
          <div className="h-72" style={{ background: msgsBg }} />
          <div
            className="px-2 py-2 flex items-center gap-2"
            style={{
              borderTop: `1px solid ${headerBorder}`,
              background: headerBg,
            }}
          >
            <div
              className="flex-1 rounded-full px-3 py-1 text-[10px]"
              style={{
                background: dark ? "#1C1C1E" : "#F2F2F7",
                color: dark ? "#98989E" : "#8E8E93",
              }}
            >
              iMessage
            </div>
            <div className="w-5 h-5 rounded-full bg-[#34c759] flex items-center justify-center shrink-0">
              <span className="text-white text-[8px] font-bold">↑</span>
            </div>
          </div>
        </div>

        {/* Overlay */}
        <div className="absolute inset-0 bg-black/80 backdrop-blur-sm rounded-[32px] flex flex-col items-center justify-center p-5 text-center shadow-inner pt-16">
          {startError ? (
            <div className="space-y-2">
              <AlertCircle className="h-8 w-8 text-red-400 mx-auto" />
              <p className="text-[10px] text-red-400 font-medium">
                {startError}
              </p>
            </div>
          ) : (
            <>
              <h2 className="text-sm font-bold text-white mb-1">
                {phase === "audio" ? "Generating voices…" : "Rendering video…"}
              </h2>
              <div className="w-full space-y-1 mb-4 text-left">
                <div className="flex justify-between text-[9px]">
                  <span className="text-white/60">
                    Stage {phase === "audio" ? "1" : "2"} / 2
                  </span>
                  <span className="text-green-400 font-bold">
                    {overallPct}%
                  </span>
                </div>
                <Progress value={overallPct} className="h-1 bg-white/20" />
              </div>

              {isErr ? (
                <p className="text-[10px] text-red-400 flex items-center gap-1">
                  <AlertCircle className="h-3 w-3 shrink-0" /> Failed
                </p>
              ) : (
                <Loader2 className="h-4 w-4 animate-spin text-white/50 mx-auto" />
              )}
            </>
          )}
        </div>
      </div>

      <div className="mt-8">
        <Button
          variant="ghost"
          onClick={onBack}
          className="text-white/35 hover:text-white h-9 text-sm"
        >
          <ArrowLeft className="mr-2 h-3.5 w-3.5" /> Cancel
        </Button>
      </div>
    </div>
  );
}

/* ─── Step 5: Done ──────────────────────────────────────────────── */

function DoneStep({
  audioJobId,
  videoJobId,
  onReset,
  darkMode,
}: {
  audioJobId: string;
  videoJobId: string;
  onReset: () => void;
  darkMode: boolean;
}) {
  const videoPath = `/api/imessage/video-download/${videoJobId}`;
  const audioPath = `/api/imessage/audio-combined/${audioJobId}`;
  const videoUrl = `${window.location.origin}${videoPath}`;

  return (
    <div className="p-8 max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-10 items-center justify-center">
      {/* Phone Mockup Frame */}
      <div className="mx-auto w-64 flex-shrink-0 relative">
        <div
          className="rounded-[32px] overflow-hidden border-[4px] aspect-[9/16]"
          style={{
            borderColor: darkMode ? "#3A3A3C" : "#E5E5EA",
            background: "#000",
            boxShadow: "0 24px 60px rgba(0,0,0,0.5)",
          }}
        >
          <video
            controls
            src={videoPath}
            className="w-full h-full object-cover"
            playsInline
          />
        </div>
      </div>

      <div className="space-y-6 text-center md:text-left">
        <div className="w-14 h-14 rounded-full bg-green-500/15 flex items-center justify-center mx-auto md:mx-0">
          <CheckCircle2 className="h-7 w-7 text-green-400" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-white">Video ready!</h2>
          <p className="text-sm text-white/40 mt-1">
            Your iMessage conversation video is synced and ready to download.
          </p>
        </div>

        {/* QR code for mobile download */}
        <div className="rounded-xl border border-white/8 bg-white/3 p-4 flex items-center gap-4">
          <div className="p-1 bg-white rounded-lg shrink-0">
            <QRCodeSVG value={videoUrl} size={64} level="M" />
          </div>
          <div className="text-left">
            <div className="flex items-center gap-1">
              <Smartphone className="h-3.5 w-3.5 text-white/50" />
              <p className="text-xs text-white/50 font-semibold tracking-wider uppercase">
                Scan this
              </p>
            </div>
            <p className="text-[10px] text-white/30 mt-0.5">
              Point your phone camera here to download directly to mobile.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <a
            href={videoPath}
            download
            className="flex items-center justify-center gap-2 h-11 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-xl transition-colors"
          >
            <Download className="h-4 w-4" /> Download MP4 (Video)
          </a>
          <a
            href={audioPath}
            download
            className="flex items-center justify-center gap-2 h-11 bg-white/8 hover:bg-white/12 text-white/70 text-sm font-medium rounded-xl transition-colors border border-white/10"
          >
            <Download className="h-4 w-4" /> Download MP3 (Audio only)
          </a>
          <Button
            variant="ghost"
            onClick={onReset}
            className="text-white/35 hover:text-white h-9 text-sm w-full mt-2"
          >
            Create another
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ─── Root ──────────────────────────────────────────────────────── */

export function TextAutomation() {
  const [step, setStep] = useState<Step>("setup");
  const [characters, setCharacters] = useState<Character[]>([
    { id: uid(), name: "You", voice: "af_bella", isMe: true },
    { id: uid(), name: "", voice: "am_adam", isMe: false },
  ]);
  const [scriptText, setScriptText] = useState("");
  const [parsedLines, setParsedLines] = useState<ParsedLine[]>([]);
  const [darkMode, setDarkMode] = useState(true);
  const [audioJobId, setAudioJobId] = useState<string | null>(null);
  const [videoJobId, setVideoJobId] = useState<string | null>(null);

  const reset = () => {
    setStep("setup");
    setCharacters([
      { id: uid(), name: "You", voice: "af_bella", isMe: true },
      { id: uid(), name: "", voice: "am_adam", isMe: false },
    ]);
    setScriptText("");
    setParsedLines([]);
    setAudioJobId(null);
    setVideoJobId(null);
  };

  return (
    <div className="min-h-screen bg-[#080808] flex flex-col">
      <StepBar current={step} />
      <div className="flex-1">
        {step === "setup" && (
          <SetupStep
            characters={characters}
            onChange={setCharacters}
            onNext={() => setStep("script")}
          />
        )}
        {step === "script" && (
          <ScriptStep
            characters={characters}
            initialScript={scriptText}
            onParsed={(lines, script) => {
              setParsedLines(lines);
              setScriptText(script);
              setStep("preview");
            }}
            onBack={() => setStep("setup")}
          />
        )}
        {step === "preview" && (
          <PreviewStep
            characters={characters}
            lines={parsedLines}
            onLinesChange={setParsedLines}
            onGenerate={(dm: boolean) => {
              setDarkMode(dm);
              setStep("audio");
            }}
            onBack={() => setStep("script")}
          />
        )}
        {step === "audio" && (
          <AudioStep
            lines={parsedLines}
            characters={characters}
            darkMode={darkMode}
            onDone={(aId, vId) => {
              setAudioJobId(aId);
              setVideoJobId(vId);
              setStep("done");
            }}
            onBack={() => setStep("preview")}
          />
        )}
        {step === "done" && audioJobId && videoJobId && (
          <DoneStep
            audioJobId={audioJobId}
            videoJobId={videoJobId}
            onReset={reset}
            darkMode={darkMode}
          />
        )}
      </div>
    </div>
  );
}
