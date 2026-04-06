import { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Plus, Trash2, ChevronRight, ArrowLeft, Download,
  Loader2, Play, Pause, Upload, CheckCircle2,
  Image as ImageIcon, Video as VideoIcon, AlertCircle, Mic,
  Sun, Moon, Volume2, VolumeX,
} from 'lucide-react';

/* ─── Constants ─────────────────────────────────────────────────────── */

const KOKORO_VOICES = [
  { id: 'af_heart',    label: 'Heart',    accent: 'American', gender: 'Female' },
  { id: 'af_bella',    label: 'Bella',    accent: 'American', gender: 'Female' },
  { id: 'af_sarah',    label: 'Sarah',    accent: 'American', gender: 'Female' },
  { id: 'af_sky',      label: 'Sky',      accent: 'American', gender: 'Female' },
  { id: 'af_nicole',   label: 'Nicole',   accent: 'American', gender: 'Female' },
  { id: 'am_adam',     label: 'Adam',     accent: 'American', gender: 'Male'   },
  { id: 'am_michael',  label: 'Michael',  accent: 'American', gender: 'Male'   },
  { id: 'bf_emma',     label: 'Emma',     accent: 'British',  gender: 'Female' },
  { id: 'bf_isabella', label: 'Isabella', accent: 'British',  gender: 'Female' },
  { id: 'bm_george',   label: 'George',   accent: 'British',  gender: 'Male'   },
  { id: 'bm_lewis',    label: 'Lewis',    accent: 'British',  gender: 'Male'   },
] as const;

type KokoroVoiceId = typeof KOKORO_VOICES[number]['id'];

/* ─── Types ─────────────────────────────────────────────────────────── */

type Step = 'setup' | 'script' | 'preview' | 'audio' | 'done';

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
  type: 'text' | 'image' | 'video';
  text: string;
  mediaFile?: File;
  mediaUrl?: string;
  mediaServerId?: string;
}

/* ─── Helpers ─────────────────────────────────────────────────────── */

function uid() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

function getInitials(name: string): string {
  const words = name.trim().split(/\s+/);
  if (words.length >= 2) return (words[0][0] + words[words.length - 1][0]).toUpperCase();
  const n = words[0] || '';
  if (!n) return '?';
  if (n.length === 1) return n.toUpperCase();
  return (n[0] + n[n.length - 1]).toUpperCase();
}

function cn(...cls: (string | boolean | undefined | null)[]): string {
  return cls.filter(Boolean).join(' ');
}

function parseScript(raw: string, chars: Character[]): { lines: ParsedLine[]; error: string | null } {
  const rows = raw.split('\n').filter((l) => l.trim());
  if (!rows.length) return { lines: [], error: 'Script is empty.' };
  const lines: ParsedLine[] = [];
  for (let i = 0; i < rows.length; i++) {
    const colon = rows[i].indexOf(':');
    if (colon === -1) return { lines: [], error: `Line ${i + 1}: missing colon — use "Name: message"` };
    const charName = rows[i].slice(0, colon).trim();
    const text = rows[i].slice(colon + 1).trim();
    const char = chars.find((c) => c.name.trim().toLowerCase() === charName.toLowerCase());
    if (!char) return { lines: [], error: `Character "${charName}" not found — add them first.` };
    if (!text) return { lines: [], error: `Line ${i + 1}: empty message for ${charName}.` };
    const lower = text.toLowerCase();
    const type: 'text' | 'image' | 'video' = lower === '[image]' ? 'image' : lower === '[video]' ? 'video' : 'text';
    lines.push({ id: uid(), charId: char.id, charName: char.name, isMe: char.isMe, type, text: type === 'text' ? text : '' });
  }
  return { lines, error: null };
}

/* ─── Voice Preview Hook ─────────────────────────────────────────── */

function useVoicePreview() {
  const [previewing, setPreviewing] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const preview = useCallback(async (voice: string) => {
    if (previewing === voice) {
      audioRef.current?.pause();
      setPreviewing(null);
      return;
    }
    setPreviewing(voice);
    try {
      const res = await fetch('/api/imessage/preview-voice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voice, text: 'Hey, this is how I sound when I speak.' }),
      });
      if (!res.ok) throw new Error('Preview failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      if (audioRef.current) { audioRef.current.pause(); URL.revokeObjectURL(audioRef.current.src); }
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.play();
      audio.onended = () => setPreviewing(null);
    } catch {
      setPreviewing(null);
    }
  }, [previewing]);

  return { previewing, preview };
}

/* ─── StepBar ─────────────────────────────────────────────────────── */

const STEPS: { id: Step; label: string }[] = [
  { id: 'setup',   label: 'Cast'    },
  { id: 'script',  label: 'Script'  },
  { id: 'preview', label: 'Preview' },
  { id: 'audio',   label: 'Audio'   },
  { id: 'done',    label: 'Done'    },
];

function StepBar({ current }: { current: Step }) {
  const idx = STEPS.findIndex((s) => s.id === current);
  return (
    <div className="flex items-center px-6 py-3 border-b border-white/5 bg-[#0a0a0a]">
      {STEPS.map((s, i) => {
        const past = i < idx; const active = i === idx;
        return (
          <div key={s.id} className="flex items-center flex-1 min-w-0">
            <div className="flex items-center gap-1.5 shrink-0">
              <div className={cn('w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold',
                active ? 'bg-green-500 text-white' : past ? 'bg-green-500/20 text-green-400' : 'bg-white/6 text-white/20')}>
                {past ? '✓' : i + 1}
              </div>
              <span className={cn('text-xs font-medium hidden sm:block',
                active ? 'text-white' : past ? 'text-green-400' : 'text-white/20')}>{s.label}</span>
            </div>
            {i < STEPS.length - 1 && <div className={cn('h-px flex-1 mx-2', past ? 'bg-green-500/30' : 'bg-white/5')} />}
          </div>
        );
      })}
    </div>
  );
}

/* ─── VoiceSelector ─────────────────────────────────────────────── */

function VoiceSelector({ value, onChange }: { value: string; onChange: (v: KokoroVoiceId) => void }) {
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
            <SelectItem key={v.id} value={v.id} className="text-xs text-white/80 hover:text-white">
              {v.label} <span className="text-white/35 ml-1">({v.accent[0]}, {v.gender[0]})</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <button
        onClick={() => preview(value)}
        title={isPreviewing ? 'Stop preview' : 'Preview voice'}
        className={cn(
          'w-8 h-8 rounded-lg flex items-center justify-center transition-all shrink-0',
          isPreviewing ? 'bg-green-500/20 text-green-400 animate-pulse' : 'bg-white/5 text-white/40 hover:bg-white/10 hover:text-white/70'
        )}
      >
        {isPreviewing ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}

/* ─── InitialsAvatar ─────────────────────────────────────────────── */

function Avatar({ name, isMe, size = 'md' }: { name: string; isMe: boolean; size?: 'sm' | 'md' | 'lg' }) {
  const dim = size === 'sm' ? 'w-6 h-6 text-[9px]' : size === 'lg' ? 'w-14 h-14 text-lg' : 'w-8 h-8 text-xs';
  return (
    <div className={cn(dim, 'rounded-full flex items-center justify-center font-bold shrink-0',
      isMe ? 'bg-green-500/20 text-green-300' : 'bg-white/10 text-white/60')}>
      {getInitials(name || '?')}
    </div>
  );
}

/* ─── Step 1: Setup ─────────────────────────────────────────────── */

function SetupStep({ characters, onChange, onNext }: {
  characters: Character[]; onChange: (c: Character[]) => void; onNext: () => void;
}) {
  const [err, setErr] = useState('');
  const me = characters.find((c) => c.isMe)!;
  const them = characters.filter((c) => !c.isMe);

  const update = (id: string, patch: Partial<Character>) =>
    onChange(characters.map((c) => (c.id === id ? { ...c, ...patch } : c)));

  const handleNext = () => {
    if (!me.name.trim()) { setErr('Enter your name.'); return; }
    if (!them.length || !them[0].name.trim()) { setErr('Enter at least one contact name.'); return; }
    const names = characters.map((c) => c.name.trim().toLowerCase());
    const dup = names.find((n, i) => n && names.indexOf(n) !== i);
    if (dup) { setErr(`"${dup}" appears twice.`); return; }
    setErr(''); onNext();
  };

  return (
    <div className="p-8 max-w-xl mx-auto space-y-8">
      <div>
        <h2 className="text-lg font-semibold text-white">Set up your cast</h2>
        <p className="text-sm text-white/35 mt-0.5">Give each person a name and pick their Kokoro voice.</p>
      </div>

      {/* You */}
      <div className="space-y-2">
        <p className="text-[10px] font-semibold tracking-widest text-white/30 uppercase">You — sender (green bubbles)</p>
        <div className="flex items-center gap-2 p-3 rounded-xl bg-green-500/5 border border-green-500/15">
          <Avatar name={me.name || 'Y'} isMe={true} />
          <Input value={me.name} onChange={(e) => { update(me.id, { name: e.target.value }); setErr(''); }}
            placeholder="Your name (e.g. Maria)"
            className="flex-1 bg-white/4 border-white/8 text-white placeholder:text-white/20 h-8 text-sm" />
          <VoiceSelector value={me.voice} onChange={(v) => update(me.id, { voice: v })} />
        </div>
      </div>

      {/* Contacts */}
      <div className="space-y-2">
        <p className="text-[10px] font-semibold tracking-widest text-white/30 uppercase">Who are you texting? (gray bubbles)</p>
        <div className="space-y-2">
          {them.map((char, i) => (
            <div key={char.id} className="flex items-center gap-2 p-3 rounded-xl bg-white/3 border border-white/6">
              <Avatar name={char.name || '?'} isMe={false} />
              <Input value={char.name} onChange={(e) => { update(char.id, { name: e.target.value }); setErr(''); }}
                placeholder={i === 0 ? 'Contact name (e.g. Kaleb)' : 'Character name'}
                className="flex-1 bg-white/4 border-white/8 text-white placeholder:text-white/20 h-8 text-sm" />
              <VoiceSelector value={char.voice} onChange={(v) => update(char.id, { voice: v })} />
              {them.length > 1 && (
                <button onClick={() => onChange(characters.filter((c) => c.id !== char.id))}
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-white/25 hover:text-red-400 hover:bg-red-500/10 transition-colors shrink-0">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
        <button onClick={() => onChange([...characters, { id: uid(), name: '', voice: 'am_adam', isMe: false }])}
          className="flex items-center gap-2 text-xs text-white/30 hover:text-white/60 transition-colors mt-1">
          <div className="w-6 h-6 rounded-full border border-dashed border-white/15 flex items-center justify-center">
            <Plus className="h-3 w-3" />
          </div>
          Add another character
        </button>
      </div>

      {err && <p className="flex items-center gap-2 text-red-400 text-xs"><AlertCircle className="h-3.5 w-3.5" />{err}</p>}

      <div className="flex justify-end">
        <Button onClick={handleNext} className="bg-green-600 hover:bg-green-700 h-9 text-sm px-5">
          Next: Script <ChevronRight className="ml-1 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

/* ─── Step 2: Script ─────────────────────────────────────────────── */

function ScriptStep({ characters, initialScript, onParsed, onBack }: {
  characters: Character[]; initialScript: string;
  onParsed: (lines: ParsedLine[], script: string) => void; onBack: () => void;
}) {
  const [text, setText] = useState(initialScript);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ParsedLine[]>([]);
  const me = characters.find((c) => c.isMe);
  const contact = characters.find((c) => !c.isMe);

  useEffect(() => {
    if (!text.trim()) { setPreview([]); setError(null); return; }
    const { lines, error: err } = parseScript(text, characters);
    if (err) { setError(err); setPreview([]); } else { setError(null); setPreview(lines); }
  }, [text, characters]);

  const handleProcess = () => {
    const { lines, error: err } = parseScript(text, characters);
    if (err) { setError(err); return; }
    if (!lines.length) { setError('Script is empty.'); return; }
    onParsed(lines, text);
  };

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-white">Write the script</h2>
        <p className="text-sm text-white/35 mt-0.5">
          Format: <code className="text-green-400 text-xs bg-green-500/10 px-1 rounded">Name: message</code>
          {' '}— use <code className="text-blue-400 text-xs bg-blue-500/10 px-1 rounded">[image]</code> or{' '}
          <code className="text-blue-400 text-xs bg-blue-500/10 px-1 rounded">[video]</code> for media slots.
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {characters.map((c) => (
          <span key={c.id} className={cn('px-2 py-0.5 rounded-full text-[11px] font-medium',
            c.isMe ? 'bg-green-500/15 text-green-300' : 'bg-white/8 text-white/50')}>
            {c.name || '(unnamed)'} · {KOKORO_VOICES.find(v => v.id === c.voice)?.label}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
        <div className="lg:col-span-3 space-y-3">
          <Textarea value={text} onChange={(e) => setText(e.target.value)}
            placeholder={`${me?.name || 'You'}: hey you free later?\n${contact?.name || 'Kaleb'}: yeah why whats up\n${me?.name || 'You'}: [image]\n${contact?.name || 'Kaleb'}: [video]`}
            className="min-h-[300px] bg-white/3 border-white/8 text-white font-mono text-sm resize-none leading-relaxed focus:border-green-500/40 focus:ring-0"
            spellCheck={false} />
          {error && <p className="flex items-center gap-1.5 text-red-400 text-xs"><AlertCircle className="h-3.5 w-3.5 shrink-0" />{error}</p>}
          <Button onClick={handleProcess} disabled={!text.trim() || !!error} className="bg-green-600 hover:bg-green-700 h-9 text-sm w-full">
            Process Script →
          </Button>
        </div>

        <div className="lg:col-span-2">
          <div className="rounded-xl border border-white/6 bg-white/3 overflow-hidden h-[334px] flex flex-col">
            <div className="px-3 py-2 border-b border-white/5">
              <p className="text-[10px] text-white/25 font-medium uppercase tracking-wider">Preview · {preview.length} lines</p>
            </div>
            <div className="flex-1 overflow-auto p-3 space-y-1.5">
              {!preview.length
                ? <p className="text-xs text-white/20 text-center mt-10">Start typing…</p>
                : preview.map((line) => (
                  <div key={line.id} className={cn('flex', line.isMe ? 'justify-end' : 'justify-start')}>
                    {!line.isMe && <Avatar name={line.charName} isMe={false} size="sm" />}
                    <div className="max-w-[78%] ml-1.5">
                      {!line.isMe && <p className="text-[9px] text-white/30 mb-0.5 ml-1">{line.charName}</p>}
                      <div className={cn('px-2.5 py-1.5 rounded-xl text-[11px] leading-snug',
                        line.isMe ? 'bg-[#34c759] text-white rounded-br-none' : 'bg-white/10 text-white/75 rounded-bl-none')}>
                        {line.type === 'image' && <span className="flex items-center gap-1 opacity-60"><ImageIcon className="h-3 w-3" /> image</span>}
                        {line.type === 'video' && <span className="flex items-center gap-1 opacity-60"><VideoIcon className="h-3 w-3" /> video</span>}
                        {line.type === 'text' && line.text}
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        </div>
      </div>

      <div className="flex justify-between">
        <Button variant="ghost" onClick={onBack} className="text-white/35 hover:text-white h-9 text-sm">
          <ArrowLeft className="mr-2 h-3.5 w-3.5" /> Back
        </Button>
      </div>
    </div>
  );
}

/* ─── Typing Indicator ──────────────────────────────────────────── */

function TypingDots({ isMe, dark }: { isMe: boolean; dark: boolean }) {
  const bg = isMe ? 'bg-[#34c759]' : dark ? 'bg-[#3A3A3C]' : 'bg-[#E5E5EA]';
  const dot = isMe ? 'bg-white/60' : dark ? 'bg-white/50' : 'bg-gray-500/60';
  return (
    <div className={cn('flex items-center gap-1 px-3 py-2.5 rounded-2xl w-fit', bg,
      isMe ? 'rounded-br-sm ml-auto mr-3' : 'rounded-bl-sm ml-3')}>
      {[0,1,2].map((i) => (
        <span key={i} className={cn('w-1.5 h-1.5 rounded-full animate-bounce', dot)}
          style={{ animationDelay: `${i * 0.15}s` }} />
      ))}
    </div>
  );
}

/* ─── Step 3: Preview ───────────────────────────────────────────── */

function PreviewStep({ characters, lines, onLinesChange, onGenerate, onBack }: {
  characters: Character[]; lines: ParsedLine[];
  onLinesChange: (l: ParsedLine[]) => void; onGenerate: () => void; onBack: () => void;
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

  useEffect(() => { scrollMessages(); }, [visibleCount, showTyping]);

  const playSequence = useCallback((idx: number) => {
    if (!playRef.current || idx >= lines.length) {
      setPlaying(false); setShowTyping(false); playRef.current = false; return;
    }
    const line = lines[idx];
    setShowTyping(true); setTypingIsMe(line.isMe);
    timerRef.current = setTimeout(() => {
      if (!playRef.current) return;
      setShowTyping(false);
      setVisibleCount(idx + 1);
      timerRef.current = setTimeout(() => { if (playRef.current) playSequence(idx + 1); }, 350);
    }, 950);
  }, [lines]);

  const togglePlay = () => {
    if (playing) {
      playRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      setPlaying(false); setShowTyping(false);
    } else {
      setVisibleCount(0); playRef.current = true; setPlaying(true);
      timerRef.current = setTimeout(() => playSequence(0), 250);
    }
  };

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  const handleMediaUpload = async (lineId: string, file: File) => {
    const url = URL.createObjectURL(file);
    onLinesChange(lines.map((l) => l.id === lineId ? { ...l, mediaFile: file, mediaUrl: url } : l));
    const form = new FormData();
    form.append('file', file);
    try {
      const res = await fetch('/api/conversation/upload-media', { method: 'POST', body: form });
      const data = await res.json() as { mediaId?: string };
      if (data.mediaId) {
        onLinesChange(lines.map((l) => l.id === lineId
          ? { ...l, mediaFile: file, mediaUrl: `/api/conversation/media/${data.mediaId}`, mediaServerId: data.mediaId } : l));
      }
    } catch (_) {}
  };

  const visibleLines = lines.slice(0, visibleCount);
  const nextLine = lines[visibleCount] ?? null;
  const hasMedia = lines.some((l) => l.type !== 'text');
  const missingMedia = lines.filter((l) => l.type !== 'text' && !l.mediaUrl);

  // Dark mode phone colors
  const phoneBg      = dark ? '#1C1C1E' : '#FFFFFF';
  const headerBg     = dark ? '#1C1C1E' : '#FFFFFF';
  const headerBorder = dark ? '#2C2C2E' : '#E5E5EA';
  const msgsBg       = dark ? '#000000' : '#FFFFFF';
  const themBubble   = dark ? '#3A3A3C' : '#E5E5EA';
  const themText     = dark ? '#FFFFFF' : '#000000';
  const inputBg      = dark ? '#1C1C1E' : '#F2F2F7';
  const inputBorder  = dark ? '#2C2C2E' : '#E5E5EA';
  const timeColor    = dark ? '#EBEBF599' : '#000000';
  const nameColor    = dark ? '#FFFFFF' : '#000000';

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Preview</h2>
          <p className="text-sm text-white/35 mt-0.5">Play the animation, upload media, then generate audio.</p>
        </div>
        {/* Dark/Light toggle */}
        <button onClick={() => setDark(!dark)}
          className={cn('flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border transition-all',
            dark ? 'bg-white/8 border-white/15 text-white/70 hover:bg-white/12' : 'bg-white/5 border-white/10 text-white/50 hover:bg-white/8')}>
          {dark ? <Moon className="h-3.5 w-3.5" /> : <Sun className="h-3.5 w-3.5" />}
          {dark ? 'Dark' : 'Light'}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {/* Phone mockup — fixed height, no page scroll */}
        <div className="mx-auto w-64 flex-shrink-0">
          <div className="rounded-[32px] overflow-hidden border-[3px]"
            style={{ borderColor: dark ? '#3A3A3C' : 'rgba(255,255,255,0.15)', background: phoneBg, boxShadow: '0 24px 60px rgba(0,0,0,0.5)' }}>

            {/* Status bar */}
            <div className="px-5 pt-3 pb-1 flex justify-between items-center" style={{ background: headerBg }}>
              <span className="text-[10px] font-semibold" style={{ color: timeColor }}>9:41</span>
              <div className="flex items-center gap-1">
                <div className="w-4 h-2 border rounded-[2px] relative" style={{ borderColor: `${timeColor}60` }}>
                  <div className="absolute inset-[2px] left-[2px] rounded-[1px]" style={{ width: '70%', background: timeColor }} />
                </div>
              </div>
            </div>

            {/* iMessage header */}
            <div className="px-3 pb-3" style={{ background: headerBg, borderBottom: `1px solid ${headerBorder}` }}>
              <div className="flex items-center justify-between mb-2">
                <button className="flex items-center gap-0.5 text-[#007AFF] text-sm font-medium">
                  <span className="text-xl leading-none">‹</span>
                  <span className="text-[10px] font-bold bg-[#007AFF] text-white rounded-full px-1.5 py-0.5 ml-0.5">99+</span>
                </button>
                <div className="w-9 h-9 rounded-full bg-gray-400 flex items-center justify-center text-xs font-bold text-white shrink-0">
                  {getInitials(contact?.name || '?')}
                </div>
                <button className="text-[#007AFF]"><VideoIcon className="h-4 w-4" /></button>
              </div>
              <p className="text-center text-xs font-semibold flex items-center justify-center gap-0.5" style={{ color: nameColor }}>
                {contact?.name || 'Contact'} <ChevronRight className="h-3 w-3 text-gray-400" />
              </p>
            </div>

            {/* Messages — scroll INSIDE this div only */}
            <div ref={messagesRef} className="h-72 overflow-y-auto flex flex-col py-2 px-2 space-y-0.5"
              style={{ background: msgsBg }}>
              {visibleLines.map((line) => (
                <div key={line.id}>
                  {!line.isMe && (
                    <p className="text-[9px] ml-8 mb-0.5" style={{ color: dark ? '#98989E' : '#6D6D72' }}>{line.charName}</p>
                  )}
                  <div className={cn('flex items-end gap-1', line.isMe ? 'justify-end' : 'justify-start')}>
                    {!line.isMe && (
                      <div className="w-5 h-5 rounded-full bg-gray-400 flex items-center justify-center text-[8px] font-bold text-white shrink-0 mb-0.5">
                        {getInitials(line.charName)}
                      </div>
                    )}
                    <div className={cn('max-w-[72%] px-2.5 py-1.5 rounded-2xl text-[11px] leading-snug',
                      line.isMe ? 'bg-[#34c759] text-white rounded-br-sm' : 'rounded-bl-sm')}
                      style={!line.isMe ? { background: themBubble, color: themText } : {}}>
                      {line.type === 'text' && line.text}
                      {line.type === 'image' && (line.mediaUrl
                        ? <img src={line.mediaUrl} alt="img" className="rounded-lg max-w-full max-h-28 object-cover" />
                        : <span className="flex items-center gap-1 opacity-50 text-[10px]"><ImageIcon className="h-3 w-3" /> image</span>)}
                      {line.type === 'video' && (line.mediaUrl
                        ? <video src={line.mediaUrl} autoPlay muted loop playsInline className="rounded-lg max-w-full max-h-28 object-cover" />
                        : <span className="flex items-center gap-1 opacity-50 text-[10px]"><VideoIcon className="h-3 w-3" /> video</span>)}
                    </div>
                  </div>
                </div>
              ))}
              {showTyping && nextLine && <TypingDots isMe={typingIsMe} dark={dark} />}
            </div>

            {/* iOS input bar */}
            <div className="px-2 py-2 flex items-center gap-2" style={{ borderTop: `1px solid ${inputBorder}`, background: headerBg }}>
              <div className="flex-1 rounded-full px-3 py-1 text-[10px]" style={{ background: inputBg, color: dark ? '#98989E' : '#8E8E93' }}>
                iMessage
              </div>
              <div className="w-5 h-5 rounded-full bg-[#34c759] flex items-center justify-center shrink-0">
                <span className="text-white text-[8px] font-bold">↑</span>
              </div>
            </div>
          </div>

          {/* Playback controls */}
          <div className="flex items-center justify-center gap-2 mt-4">
            <button onClick={togglePlay}
              className={cn('flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-medium transition-colors',
                playing ? 'bg-red-500/15 text-red-400 hover:bg-red-500/25' : 'bg-white/8 text-white/60 hover:bg-white/12')}>
              {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
              {playing ? 'Stop' : 'Play'}
            </button>
            <button onClick={() => setVisibleCount(lines.length)}
              className="px-4 py-1.5 rounded-full text-xs text-white/30 hover:text-white/50 transition-colors">
              Show all
            </button>
          </div>
        </div>

        {/* Right panel */}
        <div className="space-y-4">
          {/* Media slots */}
          {hasMedia && (
            <div className="space-y-2">
              <p className="text-[10px] font-semibold tracking-widest text-white/30 uppercase">Media slots</p>
              {lines.filter((l) => l.type !== 'text').map((line) => (
                <div key={line.id} className="flex items-center gap-3 p-3 rounded-xl bg-white/3 border border-white/6">
                  <div className={cn('w-7 h-7 rounded-lg flex items-center justify-center shrink-0',
                    line.type === 'image' ? 'bg-blue-500/15 text-blue-400' : 'bg-purple-500/15 text-purple-400')}>
                    {line.type === 'image' ? <ImageIcon className="h-3.5 w-3.5" /> : <VideoIcon className="h-3.5 w-3.5" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-white/60 truncate">{line.charName}'s {line.type}</p>
                    {line.mediaUrl && <p className="text-[10px] text-green-400">✓ uploaded</p>}
                  </div>
                  <label className={cn('flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs cursor-pointer transition-colors shrink-0',
                    line.mediaUrl ? 'bg-green-500/10 text-green-400 hover:bg-green-500/15' : 'bg-white/8 text-white/50 hover:bg-white/12')}>
                    <Upload className="h-3 w-3" />
                    {line.mediaUrl ? 'Replace' : 'Upload'}
                    <input ref={(el) => { mediaInputRefs.current[line.id] = el; }} type="file"
                      accept={line.type === 'image' ? 'image/*' : 'video/*'} className="hidden"
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) handleMediaUpload(line.id, f); }} />
                  </label>
                </div>
              ))}
              {missingMedia.length > 0 && (
                <p className="text-xs text-amber-400/80 flex items-center gap-1.5">
                  <AlertCircle className="h-3 w-3" />
                  {missingMedia.length} slot{missingMedia.length > 1 ? 's' : ''} without media (optional)
                </p>
              )}
            </div>
          )}

          {/* Script summary */}
          <div className="rounded-xl border border-white/6 bg-white/3 p-4 space-y-2">
            <p className="text-[10px] font-semibold tracking-widest text-white/30 uppercase">Script</p>
            <div className="space-y-1 max-h-44 overflow-auto">
              {lines.map((line) => (
                <div key={line.id} className="flex items-center gap-2 text-[11px]">
                  <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', line.isMe ? 'bg-green-400' : 'bg-white/25')} />
                  <span className={cn('w-14 truncate font-medium shrink-0', line.isMe ? 'text-green-300' : 'text-white/50')}>
                    {line.charName}
                  </span>
                  <span className="text-white/25 truncate">
                    {line.type === 'text' ? `"${line.text.slice(0, 35)}${line.text.length > 35 ? '…' : ''}"` : `[${line.type}]`}
                  </span>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-white/20 pt-1">
              {lines.filter(l => l.type === 'text').length} voice lines · {lines.filter(l => l.type !== 'text').length} media
            </p>
          </div>

          <Button onClick={onGenerate} className="w-full bg-green-600 hover:bg-green-700 h-9 text-sm">
            <Mic className="mr-2 h-4 w-4" /> Generate Audio
          </Button>
        </div>
      </div>

      <div className="flex justify-between pt-1">
        <Button variant="ghost" onClick={onBack} className="text-white/35 hover:text-white h-9 text-sm">
          <ArrowLeft className="mr-2 h-3.5 w-3.5" /> Back
        </Button>
      </div>
    </div>
  );
}

/* ─── Step 4: Audio ─────────────────────────────────────────────── */

function AudioStep({ lines, characters, onDone, onBack }: {
  lines: ParsedLine[]; characters: Character[];
  onDone: (jobId: string) => void; onBack: () => void;
}) {
  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ status: string; completed: number; total: number; errorMessage?: string } | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const payload = lines.filter((l) => l.type === 'text').map((l) => {
      const char = characters.find((c) => c.id === l.charId);
      return { text: l.text, voice: char?.voice ?? 'af_heart', type: 'text' as const };
    });
    fetch('/api/conversation/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lines: payload }),
    })
      .then((r) => r.json())
      .then((d: { jobId?: string; error?: string }) => {
        if (d.error) { setStartError(d.error); return; }
        if (d.jobId) setJobId(d.jobId);
      })
      .catch((e) => setStartError(String(e)));
  }, []);

  useEffect(() => {
    if (!jobId) return;
    const iv = setInterval(async () => {
      const res = await fetch(`/api/conversation/progress/${jobId}`);
      const data = await res.json() as { status: string; completed: number; total: number; errorMessage?: string };
      setProgress(data);
      if (data.status === 'done') { clearInterval(iv); onDone(jobId); }
      if (data.status === 'error') clearInterval(iv);
    }, 1500);
    return () => clearInterval(iv);
  }, [jobId]);

  const total = progress?.total ?? lines.filter(l => l.type === 'text').length;
  const done  = progress?.completed ?? 0;
  const pct   = total > 0 ? Math.round((done / total) * 100) : 0;
  const isErr = progress?.status === 'error';

  return (
    <div className="p-8 max-w-md mx-auto space-y-6">
      <div className="text-center space-y-1">
        <h2 className="text-lg font-semibold text-white">Generating audio</h2>
        <p className="text-sm text-white/35">Kokoro TTS is synthesising each line with emotion…</p>
      </div>

      {startError ? (
        <div className="rounded-xl border border-red-500/25 bg-red-500/5 p-5 text-center space-y-2">
          <AlertCircle className="h-7 w-7 text-red-400 mx-auto" />
          <p className="text-sm text-red-400">{startError}</p>
        </div>
      ) : (
        <div className="rounded-xl border border-white/6 bg-white/3 p-5 space-y-4">
          <div className="space-y-2">
            <div className="flex justify-between text-xs">
              <span className="text-white/40">{isErr ? 'Failed' : !jobId ? 'Starting…' : `Line ${done} of ${total}`}</span>
              <span className="text-green-400 font-semibold">{pct}%</span>
            </div>
            <Progress value={pct} className="h-1" />
          </div>
          {isErr ? (
            <p className="text-sm text-red-400 flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {progress?.errorMessage}
            </p>
          ) : (
            <p className="text-xs text-white/30 text-center flex items-center justify-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Each line may take 5–15 seconds on first use
            </p>
          )}
        </div>
      )}

      <Button variant="ghost" onClick={onBack} className="text-white/35 hover:text-white h-9 text-sm w-full">
        <ArrowLeft className="mr-2 h-3.5 w-3.5" /> Cancel
      </Button>
    </div>
  );
}

/* ─── Step 5: Done ──────────────────────────────────────────────── */

function DoneStep({ jobId, onReset }: { jobId: string; onReset: () => void }) {
  return (
    <div className="p-8 max-w-md mx-auto space-y-6 text-center">
      <div className="w-14 h-14 rounded-full bg-green-500/15 flex items-center justify-center mx-auto">
        <CheckCircle2 className="h-7 w-7 text-green-400" />
      </div>
      <div>
        <h2 className="text-lg font-semibold text-white">Audio ready!</h2>
        <p className="text-sm text-white/35 mt-0.5">Your conversation MP3 has been generated.</p>
      </div>
      <div className="flex flex-col gap-3">
        <a href={`/api/conversation/download/${jobId}`} download
          className="flex items-center justify-center gap-2 h-10 px-5 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg transition-colors">
          <Download className="h-4 w-4" /> Download MP3
        </a>
        <Button variant="ghost" onClick={onReset} className="text-white/35 hover:text-white h-9 text-sm">
          Create another
        </Button>
      </div>
    </div>
  );
}

/* ─── Root ──────────────────────────────────────────────────────── */

export function TextAutomation() {
  const [step, setStep]               = useState<Step>('setup');
  const [characters, setCharacters]   = useState<Character[]>([
    { id: uid(), name: 'You', voice: 'af_heart', isMe: true  },
    { id: uid(), name: '',    voice: 'am_adam',  isMe: false },
  ]);
  const [scriptText, setScriptText]   = useState('');
  const [parsedLines, setParsedLines] = useState<ParsedLine[]>([]);
  const [audioJobId, setAudioJobId]   = useState<string | null>(null);

  const reset = () => {
    setStep('setup');
    setCharacters([
      { id: uid(), name: 'You', voice: 'af_heart', isMe: true  },
      { id: uid(), name: '',    voice: 'am_adam',  isMe: false },
    ]);
    setScriptText(''); setParsedLines([]); setAudioJobId(null);
  };

  return (
    <div className="min-h-screen bg-[#080808] flex flex-col">
      <StepBar current={step} />
      <div className="flex-1">
        {step === 'setup' && (
          <SetupStep characters={characters} onChange={setCharacters} onNext={() => setStep('script')} />
        )}
        {step === 'script' && (
          <ScriptStep characters={characters} initialScript={scriptText}
            onParsed={(lines, script) => { setParsedLines(lines); setScriptText(script); setStep('preview'); }}
            onBack={() => setStep('setup')} />
        )}
        {step === 'preview' && (
          <PreviewStep characters={characters} lines={parsedLines}
            onLinesChange={setParsedLines} onGenerate={() => setStep('audio')} onBack={() => setStep('script')} />
        )}
        {step === 'audio' && (
          <AudioStep lines={parsedLines} characters={characters}
            onDone={(jid) => { setAudioJobId(jid); setStep('done'); }} onBack={() => setStep('preview')} />
        )}
        {step === 'done' && audioJobId && <DoneStep jobId={audioJobId} onReset={reset} />}
      </div>
    </div>
  );
}
