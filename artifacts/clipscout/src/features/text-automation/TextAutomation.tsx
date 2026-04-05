import { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
import {
  Select, SelectContent, SelectItem,
  SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Plus, Trash2, ChevronRight, ArrowLeft, Download,
  Loader2, Play, Pause, Upload, CheckCircle2,
  Image as ImageIcon, Video as VideoIcon, AlertCircle, Mic,
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

/* ─── Helpers ────────────────────────────────────────────────────────── */

function uid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function getInitials(name: string): string {
  const words = name.trim().split(/\s+/);
  if (words.length >= 2) {
    return (words[0][0] + words[words.length - 1][0]).toUpperCase();
  }
  const n = words[0] || '';
  if (n.length === 0) return '?';
  if (n.length === 1) return n.toUpperCase();
  return (n[0] + n[n.length - 1]).toUpperCase();
}

function cn(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ');
}

function parseScript(
  raw: string,
  chars: Character[]
): { lines: ParsedLine[]; error: string | null } {
  const rows = raw.split('\n').filter((l) => l.trim());
  if (rows.length === 0) return { lines: [], error: 'Script is empty.' };

  const lines: ParsedLine[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const colon = row.indexOf(':');
    if (colon === -1) {
      return { lines: [], error: `Line ${i + 1}: missing colon — use "Name: message"` };
    }
    const charName = row.slice(0, colon).trim();
    const text = row.slice(colon + 1).trim();

    const char = chars.find(
      (c) => c.name.trim().toLowerCase() === charName.toLowerCase()
    );
    if (!char) {
      return {
        lines: [],
        error: `Character "${charName}" not found — please add them first.`,
      };
    }
    if (!text) {
      return { lines: [], error: `Line ${i + 1}: empty message for ${charName}.` };
    }

    const lower = text.toLowerCase();
    const type: 'text' | 'image' | 'video' =
      lower === '[image]' ? 'image' : lower === '[video]' ? 'video' : 'text';

    lines.push({
      id: uid(),
      charId: char.id,
      charName: char.name,
      isMe: char.isMe,
      type,
      text: type === 'text' ? text : '',
    });
  }
  return { lines, error: null };
}

/* ─── StepBar ────────────────────────────────────────────────────────── */

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
    <div className="flex items-center gap-0 px-6 py-4 border-b border-white/5">
      {STEPS.map((s, i) => {
        const past   = i < idx;
        const active = i === idx;
        return (
          <div key={s.id} className="flex items-center flex-1 min-w-0">
            <div className="flex items-center gap-1.5 shrink-0">
              <div className={cn(
                'w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0',
                active ? 'bg-green-500 text-white' : '',
                past   ? 'bg-green-500/20 text-green-400' : '',
                !active && !past ? 'bg-white/5 text-white/20' : '',
              )}>
                {past ? <CheckCircle2 className="h-3 w-3" /> : i + 1}
              </div>
              <span className={cn(
                'text-xs font-medium hidden sm:block',
                active ? 'text-white' : '',
                past   ? 'text-green-400' : '',
                !active && !past ? 'text-white/25' : '',
              )}>{s.label}</span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={cn('h-px flex-1 mx-2', past ? 'bg-green-500/40' : 'bg-white/5')} />
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ─── VoiceLabel ─────────────────────────────────────────────────────── */

function VoiceLabel({ id }: { id: string }) {
  const v = KOKORO_VOICES.find((x) => x.id === id);
  if (!v) return <span>{id}</span>;
  return <span>{v.label} <span className="text-white/40">({v.accent}, {v.gender})</span></span>;
}

/* ─── InitialsAvatar ─────────────────────────────────────────────────── */

function InitialsAvatar({
  name, isMe, size = 'md',
}: { name: string; isMe: boolean; size?: 'sm' | 'md' | 'lg' }) {
  const initials = getInitials(name || '?');
  const dim = size === 'sm' ? 'w-7 h-7 text-[11px]' : size === 'lg' ? 'w-14 h-14 text-lg' : 'w-9 h-9 text-sm';
  return (
    <div className={cn(
      dim, 'rounded-full flex items-center justify-center font-bold shrink-0',
      isMe ? 'bg-green-500/20 text-green-300' : 'bg-white/10 text-white/70',
    )}>
      {initials}
    </div>
  );
}

/* ─── Step 1: Setup ──────────────────────────────────────────────────── */

function SetupStep({
  characters,
  onChange,
  onNext,
}: {
  characters: Character[];
  onChange: (chars: Character[]) => void;
  onNext: () => void;
}) {
  const [nameErr, setNameErr] = useState('');

  const updateChar = (id: string, patch: Partial<Character>) => {
    onChange(characters.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  };

  const addChar = () => {
    onChange([...characters, { id: uid(), name: '', voice: 'am_adam', isMe: false }]);
  };

  const removeChar = (id: string) => {
    onChange(characters.filter((c) => c.id !== id));
  };

  const handleNext = () => {
    const names = characters.map((c) => c.name.trim()).filter(Boolean);
    if (names.length < 2) { setNameErr('Add at least 2 characters (You + one contact).'); return; }
    const dup = names.find((n, i) => names.indexOf(n) !== i);
    if (dup) { setNameErr(`"${dup}" appears twice.`); return; }
    setNameErr('');
    onNext();
  };

  const them = characters.filter((c) => !c.isMe);
  const me   = characters.find((c) => c.isMe)!;

  return (
    <div className="p-8 max-w-2xl mx-auto space-y-7">
      <div>
        <h2 className="text-xl font-semibold text-white">Set up your cast</h2>
        <p className="text-sm text-white/40 mt-1">Define who is in the conversation and pick their voice.</p>
      </div>

      {/* You */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-white/40 uppercase tracking-wider">You (sender)</p>
        <div className="flex items-center gap-3 p-3 rounded-xl bg-green-500/5 border border-green-500/20">
          <InitialsAvatar name={me.name || 'You'} isMe={true} />
          <Input
            value={me.name}
            onChange={(e) => { updateChar(me.id, { name: e.target.value }); setNameErr(''); }}
            placeholder="Your name (e.g. Maria)"
            className="flex-1 bg-white/5 border-white/10 text-white placeholder:text-white/20 h-9 text-sm"
          />
          <Select
            value={me.voice}
            onValueChange={(v) => updateChar(me.id, { voice: v as KokoroVoiceId })}
          >
            <SelectTrigger className="w-44 h-9 text-xs bg-white/5 border-white/10 text-white shrink-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-[#1a1a1a] border-white/10 max-h-48">
              {KOKORO_VOICES.map((v) => (
                <SelectItem key={v.id} value={v.id} className="text-xs text-white/80">
                  {v.label} <span className="text-white/40">({v.accent}, {v.gender[0]})</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Contacts */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-white/40 uppercase tracking-wider">Who are you texting?</p>
        <div className="space-y-2">
          {them.map((char, i) => (
            <div key={char.id} className="flex items-center gap-3 p-3 rounded-xl bg-white/4 border border-white/6">
              <InitialsAvatar name={char.name || '?'} isMe={false} />
              <Input
                value={char.name}
                onChange={(e) => { updateChar(char.id, { name: e.target.value }); setNameErr(''); }}
                placeholder={i === 0 ? 'Contact name (e.g. Kaleb)' : 'Character name'}
                className="flex-1 bg-white/5 border-white/10 text-white placeholder:text-white/20 h-9 text-sm"
              />
              <Select
                value={char.voice}
                onValueChange={(v) => updateChar(char.id, { voice: v as KokoroVoiceId })}
              >
                <SelectTrigger className="w-44 h-9 text-xs bg-white/5 border-white/10 text-white shrink-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#1a1a1a] border-white/10 max-h-48">
                  {KOKORO_VOICES.map((v) => (
                    <SelectItem key={v.id} value={v.id} className="text-xs text-white/80">
                      {v.label} <span className="text-white/40">({v.accent}, {v.gender[0]})</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {them.length > 1 && (
                <button
                  onClick={() => removeChar(char.id)}
                  className="w-8 h-8 rounded-full bg-white/5 hover:bg-red-500/20 flex items-center justify-center text-white/30 hover:text-red-400 transition-colors shrink-0"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>

        <button
          onClick={addChar}
          className="flex items-center gap-2 text-sm text-white/40 hover:text-white/70 transition-colors mt-1"
        >
          <div className="w-7 h-7 rounded-full border border-dashed border-white/20 flex items-center justify-center">
            <Plus className="h-3.5 w-3.5" />
          </div>
          Add another character
        </button>
      </div>

      {nameErr && (
        <p className="flex items-center gap-2 text-red-400 text-sm">
          <AlertCircle className="h-4 w-4 shrink-0" /> {nameErr}
        </p>
      )}

      <div className="flex justify-end pt-2">
        <Button onClick={handleNext} className="bg-green-600 hover:bg-green-700 h-9 text-sm px-5">
          Next: Write Script <ChevronRight className="ml-1 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

/* ─── Step 2: Script ─────────────────────────────────────────────────── */

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

  const me = characters.find((c) => c.isMe);
  const contact = characters.find((c) => !c.isMe);

  const placeholderLines = [
    `${me?.name || 'You'}: hey you free later?`,
    `${contact?.name || 'Kaleb'}: yeah why whats up`,
    `${me?.name || 'You'}: [image]`,
    `${contact?.name || 'Kaleb'}: [video]`,
  ];

  useEffect(() => {
    if (!text.trim()) { setPreview([]); setError(null); return; }
    const { lines, error: err } = parseScript(text, characters);
    if (err) { setError(err); setPreview([]); }
    else { setError(null); setPreview(lines); }
  }, [text, characters]);

  const handleProcess = () => {
    const { lines, error: err } = parseScript(text, characters);
    if (err) { setError(err); return; }
    if (lines.length === 0) { setError('Script is empty.'); return; }
    onParsed(lines, text);
  };

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-white">Write the script</h2>
        <p className="text-sm text-white/40 mt-1">
          Each line: <code className="text-green-400 text-xs">Name: message</code>{' '}
          — use <code className="text-blue-400 text-xs">[image]</code> or{' '}
          <code className="text-blue-400 text-xs">[video]</code> for media.
        </p>
      </div>

      {/* Character pills */}
      <div className="flex flex-wrap gap-2">
        {characters.map((c) => (
          <div key={c.id} className={cn(
            'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium',
            c.isMe ? 'bg-green-500/20 text-green-300' : 'bg-white/10 text-white/70',
          )}>
            <span className={cn('w-1.5 h-1.5 rounded-full', c.isMe ? 'bg-green-400' : 'bg-white/40')} />
            {c.name || '(unnamed)'}{' '}
            <span className="opacity-50">— <VoiceLabel id={c.voice} /></span>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
        {/* Textarea */}
        <div className="lg:col-span-3 space-y-3">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={placeholderLines.join('\n')}
            className="min-h-[300px] bg-white/3 border-white/8 text-white font-mono text-sm resize-none leading-relaxed focus:border-green-500/40"
            spellCheck={false}
          />
          {error && (
            <p className="flex items-center gap-2 text-red-400 text-sm">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" /> {error}
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

        {/* Live preview */}
        <div className="lg:col-span-2">
          <div className="rounded-xl border border-white/8 bg-white/3 overflow-hidden h-[340px] flex flex-col">
            <div className="px-3 py-2 border-b border-white/5">
              <p className="text-xs text-white/30 font-medium uppercase tracking-wider">Live Preview</p>
            </div>
            <div className="flex-1 overflow-auto p-3 space-y-1.5">
              {preview.length === 0
                ? <p className="text-xs text-white/20 text-center mt-8">Start typing…</p>
                : preview.map((line) => (
                    <div key={line.id} className={cn('flex', line.isMe ? 'justify-end' : 'justify-start')}>
                      {!line.isMe && (
                        <div className="mr-1.5 mt-auto">
                          <InitialsAvatar name={line.charName} isMe={false} size="sm" />
                        </div>
                      )}
                      <div className="max-w-[75%]">
                        {!line.isMe && (
                          <p className="text-[10px] text-white/40 mb-0.5 ml-1">{line.charName}</p>
                        )}
                        <div className={cn(
                          'px-2.5 py-1.5 rounded-2xl text-xs leading-snug',
                          line.isMe
                            ? 'bg-[#34c759] text-white rounded-br-sm'
                            : 'bg-white/12 text-white/80 rounded-bl-sm',
                        )}>
                          {line.type === 'image' && (
                            <span className="flex items-center gap-1 text-white/60">
                              <ImageIcon className="h-3 w-3" /> [image]
                            </span>
                          )}
                          {line.type === 'video' && (
                            <span className="flex items-center gap-1 text-white/60">
                              <VideoIcon className="h-3 w-3" /> [video]
                            </span>
                          )}
                          {line.type === 'text' && line.text}
                        </div>
                      </div>
                    </div>
                  ))
              }
            </div>
          </div>
          <p className="text-xs text-white/25 text-right mt-1">{preview.length} messages</p>
        </div>
      </div>

      <div className="flex justify-between pt-1">
        <Button variant="ghost" onClick={onBack} className="text-white/40 hover:text-white h-9 text-sm">
          <ArrowLeft className="mr-2 h-3.5 w-3.5" /> Back
        </Button>
      </div>
    </div>
  );
}

/* ─── Typing Indicator ────────────────────────────────────────────────── */

function TypingIndicator({ isMe }: { isMe: boolean }) {
  return (
    <div className={cn('flex', isMe ? 'justify-end' : 'justify-start', 'px-4 py-1')}>
      <div className={cn(
        'flex items-center gap-1 px-3 py-2 rounded-2xl',
        isMe ? 'bg-[#34c759] rounded-br-sm' : 'bg-[#E5E5EA] rounded-bl-sm',
      )}>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className={cn('w-1.5 h-1.5 rounded-full animate-bounce', isMe ? 'bg-white/60' : 'bg-gray-500/60')}
            style={{ animationDelay: `${i * 0.15}s` }}
          />
        ))}
      </div>
    </div>
  );
}

/* ─── Step 3: Preview ────────────────────────────────────────────────── */

function PreviewStep({
  characters,
  lines,
  onLinesChange,
  onGenerate,
  onBack,
}: {
  characters: Character[];
  lines: ParsedLine[];
  onLinesChange: (lines: ParsedLine[]) => void;
  onGenerate: () => void;
  onBack: () => void;
}) {
  const [visibleCount, setVisibleCount] = useState(lines.length);
  const [playing, setPlaying] = useState(false);
  const [showTyping, setShowTyping] = useState(false);
  const [typingIsMe, setTypingIsMe] = useState(false);
  const playRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const mediaInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const contact = characters.find((c) => !c.isMe);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [visibleCount, showTyping]);

  const playSequence = useCallback((idx: number) => {
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
      }, 400);
    }, 900);
  }, [lines]);

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
      timerRef.current = setTimeout(() => playSequence(0), 300);
    }
  };

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  const handleMediaUpload = async (lineId: string, file: File) => {
    const url = URL.createObjectURL(file);
    onLinesChange(lines.map((l) =>
      l.id === lineId ? { ...l, mediaFile: file, mediaUrl: url } : l
    ));

    const form = new FormData();
    form.append('file', file);
    try {
      const res = await fetch('/api/conversation/upload-media', { method: 'POST', body: form });
      const data = await res.json() as { mediaId?: string };
      if (data.mediaId) {
        onLinesChange(lines.map((l) =>
          l.id === lineId ? { ...l, mediaFile: file, mediaUrl: `/api/conversation/media/${data.mediaId}`, mediaServerId: data.mediaId } : l
        ));
      }
    } catch (_) {}
  };

  const visibleLines = lines.slice(0, visibleCount);
  const nextLine = lines[visibleCount] ?? null;

  const hasMedia = lines.some((l) => l.type !== 'text');
  const missingMedia = lines.filter((l) => l.type !== 'text' && !l.mediaUrl);

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-white">Preview</h2>
        <p className="text-sm text-white/40 mt-1">
          {hasMedia ? 'Upload media for image/video slots, then ' : ''}
          Hit play to animate, then generate audio.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {/* Phone mockup */}
        <div className="mx-auto w-64">
          <div className="rounded-3xl overflow-hidden border-2 border-white/15 bg-white shadow-2xl">
            {/* Status bar */}
            <div className="bg-white px-5 pt-3 pb-1 flex justify-between items-center">
              <span className="text-[10px] font-semibold text-black">9:41</span>
              <div className="flex items-center gap-1">
                <div className="w-4 h-2 border border-black/40 rounded-[2px] relative">
                  <div className="absolute inset-0.5 left-0.5 bg-black rounded-[1px]" style={{ width: '70%' }} />
                </div>
              </div>
            </div>

            {/* iMessage header */}
            <div className="bg-white border-b border-gray-200 px-3 pb-3">
              <div className="flex items-center justify-between mb-2">
                <button className="flex items-center gap-0.5 text-[#007AFF] text-sm font-medium">
                  <span className="text-lg leading-none">‹</span>
                  <span className="text-xs font-bold bg-[#007AFF] text-white rounded-full px-1.5 py-0.5 ml-0.5">99+</span>
                </button>
                <div className="flex items-center gap-1">
                  <div className="w-8 h-8 rounded-full bg-gray-300 flex items-center justify-center text-xs font-bold text-gray-600">
                    {getInitials(contact?.name || '?')}
                  </div>
                </div>
                <button className="text-[#007AFF] text-sm">
                  <VideoIcon className="h-4 w-4" />
                </button>
              </div>
              <div className="text-center">
                <p className="text-xs font-semibold text-black flex items-center justify-center gap-0.5">
                  {contact?.name || 'Contact'}
                  <ChevronRight className="h-3 w-3 text-gray-400" />
                </p>
              </div>
            </div>

            {/* Messages */}
            <div className="bg-white h-80 overflow-auto flex flex-col py-2">
              <div className="flex-1 space-y-0.5 px-2">
                {visibleLines.map((line) => (
                  <div key={line.id}>
                    {!line.isMe && (
                      <p className="text-[9px] text-gray-400 ml-8 mb-0.5">{line.charName}</p>
                    )}
                    <div className={cn('flex items-end gap-1', line.isMe ? 'justify-end' : 'justify-start')}>
                      {!line.isMe && (
                        <div className="w-5 h-5 rounded-full bg-gray-300 flex items-center justify-center text-[8px] font-bold text-gray-600 shrink-0 mb-0.5">
                          {getInitials(line.charName)}
                        </div>
                      )}
                      <div className={cn(
                        'max-w-[72%] px-2.5 py-1.5 rounded-2xl text-[11px] leading-snug',
                        line.isMe
                          ? 'bg-[#34c759] text-white rounded-br-sm'
                          : 'bg-[#E5E5EA] text-black rounded-bl-sm',
                      )}>
                        {line.type === 'text' && line.text}
                        {line.type === 'image' && (
                          line.mediaUrl
                            ? <img src={line.mediaUrl} alt="uploaded" className="rounded-lg max-w-full max-h-32 object-cover" />
                            : <span className="flex items-center gap-1 text-current opacity-60 text-[10px]"><ImageIcon className="h-3 w-3" /> image</span>
                        )}
                        {line.type === 'video' && (
                          line.mediaUrl
                            ? <video src={line.mediaUrl} autoPlay muted loop playsInline className="rounded-lg max-w-full max-h-32 object-cover" />
                            : <span className="flex items-center gap-1 text-current opacity-60 text-[10px]"><VideoIcon className="h-3 w-3" /> video</span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
                {showTyping && nextLine && (
                  <TypingIndicator isMe={typingIsMe} />
                )}
                <div ref={endRef} />
              </div>

              {/* iOS-style input area */}
              <div className="border-t border-gray-200 mt-auto mx-2 pt-2 flex items-center gap-2 opacity-40">
                <div className="flex-1 bg-gray-100 rounded-full px-3 py-1 text-[10px] text-gray-400">iMessage</div>
                <div className="w-5 h-5 rounded-full bg-[#34c759] flex items-center justify-center">
                  <span className="text-white text-[8px] font-bold">↑</span>
                </div>
              </div>
            </div>
          </div>

          {/* Controls below phone */}
          <div className="flex items-center justify-center gap-3 mt-4">
            <button
              onClick={togglePlay}
              className={cn(
                'flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-colors',
                playing
                  ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                  : 'bg-white/10 text-white/70 hover:bg-white/15',
              )}
            >
              {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              {playing ? 'Stop' : 'Play'}
            </button>
            <button
              onClick={() => setVisibleCount(lines.length)}
              className="px-4 py-2 rounded-full text-sm text-white/40 hover:text-white/60 transition-colors"
            >
              Show all
            </button>
          </div>
        </div>

        {/* Right panel: media uploads + actions */}
        <div className="space-y-4">
          {/* Media upload slots */}
          {hasMedia && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-white/40 uppercase tracking-wider">Media slots</p>
              {lines.filter((l) => l.type !== 'text').map((line, i) => (
                <div key={line.id} className="flex items-center gap-3 p-3 rounded-xl bg-white/4 border border-white/8">
                  <div className={cn(
                    'w-8 h-8 rounded-lg flex items-center justify-center shrink-0',
                    line.type === 'image' ? 'bg-blue-500/20 text-blue-400' : 'bg-purple-500/20 text-purple-400',
                  )}>
                    {line.type === 'image' ? <ImageIcon className="h-4 w-4" /> : <VideoIcon className="h-4 w-4" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-white/70 truncate">
                      Message {lines.indexOf(line) + 1} — {line.charName}'s {line.type}
                    </p>
                    {line.mediaUrl && (
                      <p className="text-[10px] text-green-400 mt-0.5">✓ Uploaded</p>
                    )}
                  </div>
                  <label className={cn(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors',
                    line.mediaUrl
                      ? 'bg-green-500/10 text-green-400 hover:bg-green-500/20'
                      : 'bg-white/10 text-white/60 hover:bg-white/15',
                  )}>
                    <Upload className="h-3 w-3" />
                    {line.mediaUrl ? 'Replace' : 'Upload'}
                    <input
                      ref={(el) => { mediaInputRefs.current[line.id] = el; }}
                      type="file"
                      accept={line.type === 'image' ? 'image/*' : 'video/*'}
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
                <p className="text-xs text-amber-400 flex items-center gap-1.5">
                  <AlertCircle className="h-3.5 w-3.5" />
                  {missingMedia.length} media slot{missingMedia.length > 1 ? 's' : ''} still need{missingMedia.length === 1 ? 's' : ''} a file (optional).
                </p>
              )}
            </div>
          )}

          {/* Script summary */}
          <div className="rounded-xl border border-white/8 bg-white/3 p-4 space-y-2">
            <p className="text-xs font-semibold text-white/40 uppercase tracking-wider">Summary</p>
            <div className="space-y-1.5 max-h-40 overflow-auto">
              {lines.map((line, i) => (
                <div key={line.id} className="flex items-center gap-2 text-xs">
                  <div className={cn(
                    'w-1.5 h-1.5 rounded-full shrink-0',
                    line.isMe ? 'bg-green-400' : 'bg-white/30',
                  )} />
                  <span className={cn('w-16 truncate font-medium shrink-0', line.isMe ? 'text-green-300' : 'text-white/60')}>
                    {line.charName}
                  </span>
                  <span className="text-white/30 truncate">
                    {line.type === 'text'
                      ? `"${line.text.substring(0, 30)}${line.text.length > 30 ? '…' : ''}"`
                      : `[${line.type}]`}
                  </span>
                </div>
              ))}
            </div>
            <p className="text-xs text-white/25 pt-1">{lines.filter(l => l.type === 'text').length} voice lines · {lines.filter(l => l.type !== 'text').length} media slots</p>
          </div>

          {/* Generate audio button */}
          <Button
            onClick={onGenerate}
            className="w-full bg-green-600 hover:bg-green-700 h-10 text-sm"
          >
            <Mic className="mr-2 h-4 w-4" />
            Generate Audio
          </Button>
        </div>
      </div>

      <div className="flex justify-between pt-2">
        <Button variant="ghost" onClick={onBack} className="text-white/40 hover:text-white h-9 text-sm">
          <ArrowLeft className="mr-2 h-3.5 w-3.5" /> Back
        </Button>
      </div>
    </div>
  );
}

/* ─── Step 4: Audio ──────────────────────────────────────────────────── */

function AudioStep({
  lines,
  characters,
  onDone,
  onBack,
}: {
  lines: ParsedLine[];
  characters: Character[];
  onDone: (jobId: string) => void;
  onBack: () => void;
}) {
  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ status: string; completed: number; total: number; errorMessage?: string } | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const payload = lines
      .filter((l) => l.type === 'text')
      .map((l) => {
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
    }, 1000);
    return () => clearInterval(iv);
  }, [jobId]);

  const total    = progress?.total ?? lines.filter(l => l.type === 'text').length;
  const done     = progress?.completed ?? 0;
  const pct      = total > 0 ? Math.min(99, Math.round((done / total) * 100)) : 0;
  const isDone   = progress?.status === 'done';
  const isError  = progress?.status === 'error';

  return (
    <div className="p-8 max-w-lg mx-auto space-y-6">
      <div className="text-center space-y-1">
        <h2 className="text-xl font-semibold text-white">Generating audio</h2>
        <p className="text-sm text-white/40">Synthesising voices via Kokoro TTS…</p>
      </div>

      {startError ? (
        <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-5 text-center space-y-3">
          <AlertCircle className="h-8 w-8 text-red-400 mx-auto" />
          <p className="text-sm text-red-400">{startError}</p>
          {startError.includes('HUGGINGFACE_API_KEY') && (
            <p className="text-xs text-white/40">Add your HUGGINGFACE_API_KEY to the environment secrets.</p>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-white/6 bg-white/3 p-5 space-y-5">
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-white/50">
                {isError ? 'Failed' : isDone ? 'Done!' : !jobId ? 'Starting…' : 'Processing…'}
              </span>
              <span className="text-green-400 font-semibold">{pct}%</span>
            </div>
            <Progress value={isDone ? 100 : pct} className="h-1.5" />
            <p className="text-xs text-white/25 text-right">{done} / {total} lines</p>
          </div>

          {isError && (
            <p className="flex items-center gap-2 text-red-400 text-sm">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {progress?.errorMessage || 'Audio generation failed.'}
            </p>
          )}

          {!isDone && !isError && (
            <div className="flex items-center justify-center gap-2 text-white/40 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              This may take a moment per line…
            </div>
          )}
        </div>
      )}

      <div className="flex justify-between">
        <Button variant="ghost" onClick={onBack} className="text-white/40 hover:text-white h-9 text-sm">
          <ArrowLeft className="mr-2 h-3.5 w-3.5" /> Cancel
        </Button>
      </div>
    </div>
  );
}

/* ─── Step 5: Done ───────────────────────────────────────────────────── */

function DoneStep({ jobId, onReset }: { jobId: string; onReset: () => void }) {
  return (
    <div className="p-8 max-w-lg mx-auto space-y-6 text-center">
      <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center mx-auto">
        <CheckCircle2 className="h-8 w-8 text-green-400" />
      </div>
      <div>
        <h2 className="text-xl font-semibold text-white">Audio ready!</h2>
        <p className="text-sm text-white/40 mt-1">Your conversation MP3 has been generated.</p>
      </div>
      <div className="flex flex-col gap-3">
        <a
          href={`/api/conversation/download/${jobId}`}
          download
          className="flex items-center justify-center gap-2 h-10 px-5 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg transition-colors"
        >
          <Download className="h-4 w-4" />
          Download MP3
        </a>
        <Button
          variant="ghost"
          onClick={onReset}
          className="text-white/40 hover:text-white h-9 text-sm"
        >
          Create another
        </Button>
      </div>
    </div>
  );
}

/* ─── Root ───────────────────────────────────────────────────────────── */

export function TextAutomation() {
  const [step, setStep] = useState<Step>('setup');
  const [characters, setCharacters] = useState<Character[]>([
    { id: uid(), name: 'You', voice: 'af_heart', isMe: true },
    { id: uid(), name: '',    voice: 'am_adam',  isMe: false },
  ]);
  const [scriptText, setScriptText]   = useState('');
  const [parsedLines, setParsedLines] = useState<ParsedLine[]>([]);
  const [audioJobId, setAudioJobId]   = useState<string | null>(null);

  const handleReset = () => {
    setStep('setup');
    setCharacters([
      { id: uid(), name: 'You', voice: 'af_heart', isMe: true },
      { id: uid(), name: '',    voice: 'am_adam',  isMe: false },
    ]);
    setScriptText('');
    setParsedLines([]);
    setAudioJobId(null);
  };

  return (
    <div className="min-h-screen bg-[#080808] flex flex-col">
      <StepBar current={step} />
      <div className="flex-1">
        {step === 'setup' && (
          <SetupStep
            characters={characters}
            onChange={setCharacters}
            onNext={() => setStep('script')}
          />
        )}
        {step === 'script' && (
          <ScriptStep
            characters={characters}
            initialScript={scriptText}
            onParsed={(lines, script) => {
              setParsedLines(lines);
              setScriptText(script);
              setStep('preview');
            }}
            onBack={() => setStep('setup')}
          />
        )}
        {step === 'preview' && (
          <PreviewStep
            characters={characters}
            lines={parsedLines}
            onLinesChange={setParsedLines}
            onGenerate={() => setStep('audio')}
            onBack={() => setStep('script')}
          />
        )}
        {step === 'audio' && (
          <AudioStep
            lines={parsedLines}
            characters={characters}
            onDone={(jid) => { setAudioJobId(jid); setStep('done'); }}
            onBack={() => setStep('preview')}
          />
        )}
        {step === 'done' && audioJobId && (
          <DoneStep jobId={audioJobId} onReset={handleReset} />
        )}
      </div>
    </div>
  );
}
