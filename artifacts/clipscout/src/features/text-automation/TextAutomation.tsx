import { useState, useEffect, useRef, KeyboardEvent } from 'react';
import { useVideoStore, type Gender, type ScriptLine, type TimelineEntry } from '@/store/use-video-store';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import {
  ArrowRight, ArrowLeft, CheckCircle2, Loader2, Play, Pause,
  Download, Music, Video, Plus, Trash2, User, AlertCircle,
} from 'lucide-react';

type Step = 'cast' | 'script' | 'voices' | 'generate' | 'preview' | 'export';

const STEPS: { id: Step; label: string }[] = [
  { id: 'cast',     label: 'Cast'     },
  { id: 'script',   label: 'Script'   },
  { id: 'voices',   label: 'Voices'   },
  { id: 'generate', label: 'Generate' },
  { id: 'preview',  label: 'Preview'  },
  { id: 'export',   label: 'Export'   },
];

function cn(...c: (string | boolean | undefined | null)[]): string {
  return c.filter(Boolean).join(' ');
}

const CHAR_COLORS = [
  { bg: 'bg-violet-500/20', text: 'text-violet-300', dot: 'bg-violet-400' },
  { bg: 'bg-sky-500/20',    text: 'text-sky-300',    dot: 'bg-sky-400'    },
  { bg: 'bg-amber-500/20',  text: 'text-amber-300',  dot: 'bg-amber-400'  },
  { bg: 'bg-rose-500/20',   text: 'text-rose-300',   dot: 'bg-rose-400'   },
  { bg: 'bg-teal-500/20',   text: 'text-teal-300',   dot: 'bg-teal-400'   },
  { bg: 'bg-pink-500/20',   text: 'text-pink-300',   dot: 'bg-pink-400'   },
];

function charColor(name: string, allNames: string[]) {
  const idx = allNames.indexOf(name);
  return CHAR_COLORS[(idx >= 0 ? idx : 0) % CHAR_COLORS.length];
}

/* ─── Step Indicator ─────────────────────────────────────────────── */

function StepBar({ current }: { current: Step }) {
  const idx = STEPS.findIndex((s) => s.id === current);
  return (
    <div className="flex items-center gap-0 px-6 py-4 border-b border-white/5">
      {STEPS.map((s, i) => {
        const past    = i < idx;
        const active  = i === idx;
        const future  = i > idx;
        return (
          <div key={s.id} className="flex items-center flex-1 min-w-0">
            <div className="flex items-center gap-1.5 shrink-0">
              <div className={cn(
                'w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0',
                active  ? 'bg-green-500 text-white'              : '',
                past    ? 'bg-green-500/20 text-green-400'       : '',
                future  ? 'bg-white/5 text-white/20'             : '',
              )}>
                {past ? <CheckCircle2 className="h-3 w-3" /> : i + 1}
              </div>
              <span className={cn(
                'text-xs font-medium hidden sm:block',
                active ? 'text-white'    : '',
                past   ? 'text-green-400': '',
                future ? 'text-white/25' : '',
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

/* ─── Step 1: Cast ───────────────────────────────────────────────── */

interface CastMember { name: string; gender: Gender }

function CastStep({ onNext }: { onNext: () => void }) {
  const { genderMap, setGenderMap, updateCharacter } = useVideoStore();

  const [cast, setCast] = useState<CastMember[]>(() =>
    Object.keys(genderMap).length > 0
      ? Object.entries(genderMap).map(([name, gender]) => ({ name, gender }))
      : [{ name: '', gender: 'F' }]
  );
  const [nameErr, setNameErr] = useState('');

  const names = cast.map((c) => c.name.trim()).filter(Boolean);

  const addMember = () => setCast((prev) => [...prev, { name: '', gender: 'F' }]);

  const removeMember = (i: number) => {
    if (cast.length === 1) return;
    setCast((prev) => prev.filter((_, idx) => idx !== i));
  };

  const updateMember = (i: number, patch: Partial<CastMember>) =>
    setCast((prev) => prev.map((m, idx) => idx === i ? { ...m, ...patch } : m));

  const handleNext = () => {
    const trimmed = cast.map((c) => ({ ...c, name: c.name.trim() }));
    const validNames = trimmed.map((c) => c.name).filter(Boolean);

    if (validNames.length < 2) { setNameErr('Add at least 2 characters.'); return; }
    const dup = validNames.find((n, i) => validNames.indexOf(n) !== i);
    if (dup) { setNameErr(`"${dup}" appears twice.`); return; }

    const map: Record<string, Gender> = {};
    trimmed.filter((c) => c.name).forEach((c) => {
      map[c.name] = c.gender;
      updateCharacter(c.name, { gender: c.gender, voice: c.gender === 'F' ? 'en-US-AriaNeural' : 'en-US-GuyNeural' });
    });
    setGenderMap(map);
    onNext();
  };

  return (
    <div className="p-8 max-w-xl mx-auto space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-white">Define your cast</h2>
        <p className="text-sm text-white/40 mt-1">Add everyone who appears in the conversation.</p>
      </div>

      <div className="space-y-3">
        {cast.map((member, i) => {
          const col = charColor(member.name || '?', names);
          return (
            <div key={i} className="flex items-center gap-3">
              {/* Avatar letter */}
              <div className={cn('w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold shrink-0', col.bg, col.text)}>
                {member.name?.[0]?.toUpperCase() || <User className="h-4 w-4 opacity-30" />}
              </div>

              {/* Name */}
              <Input
                value={member.name}
                onChange={(e) => { updateMember(i, { name: e.target.value }); setNameErr(''); }}
                placeholder="Name (e.g. Maria)"
                className="flex-1 bg-white/5 border-white/10 text-white placeholder:text-white/20 h-9 text-sm focus:border-green-500/50"
                onKeyDown={(e: KeyboardEvent) => e.key === 'Enter' && addMember()}
              />

              {/* Gender toggle */}
              <div className="flex rounded-lg overflow-hidden border border-white/10 shrink-0">
                {(['F', 'M'] as Gender[]).map((g) => (
                  <button
                    key={g}
                    onClick={() => updateMember(i, { gender: g })}
                    className={cn(
                      'px-3 py-1.5 text-xs font-medium transition-colors',
                      member.gender === g
                        ? g === 'F' ? 'bg-pink-500/20 text-pink-300' : 'bg-blue-500/20 text-blue-300'
                        : 'text-white/30 hover:text-white/50'
                    )}
                  >
                    {g === 'F' ? '♀ Female' : '♂ Male'}
                  </button>
                ))}
              </div>

              {/* Remove */}
              <button
                onClick={() => removeMember(i)}
                className={cn('text-white/20 hover:text-red-400 transition-colors', cast.length === 1 && 'invisible')}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>

      <button
        onClick={addMember}
        className="flex items-center gap-2 text-sm text-white/40 hover:text-green-400 transition-colors"
      >
        <Plus className="h-4 w-4" /> Add character
      </button>

      {nameErr && (
        <p className="flex items-center gap-2 text-red-400 text-sm">
          <AlertCircle className="h-4 w-4 shrink-0" /> {nameErr}
        </p>
      )}

      <div className="flex justify-end pt-2">
        <Button onClick={handleNext} className="bg-green-600 hover:bg-green-700 h-9 text-sm px-5">
          Next <ArrowRight className="ml-2 h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

/* ─── Step 2: Script ─────────────────────────────────────────────── */

function parseScriptLines(
  raw: string,
  genderMap: Record<string, Gender>
): { lines: ScriptLine[]; error: string | null } {
  try {
    const textLines = raw.split('\n').filter((l) => l.trim());
    const lines: ScriptLine[] = [];
    for (let i = 0; i < textLines.length; i++) {
      const line = textLines[i];
      const colon = line.indexOf(':');
      if (colon === -1) throw new Error(`Line ${i + 1}: missing colon — use "Name: message"`);
      const character = line.substring(0, colon).trim();
      const text = line.substring(colon + 1).trim();
      if (!genderMap[character]) throw new Error(`"${character}" isn't in your cast.`);
      if (!text) throw new Error(`Line ${i + 1}: empty message for ${character}.`);
      lines.push({ index: i, character, text });
    }
    return { lines, error: null };
  } catch (e: unknown) {
    return { lines: [], error: (e as Error).message };
  }
}

function ScriptStep({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const { scriptText, genderMap, setScriptText, setParsedLines } = useVideoStore();
  const names = Object.keys(genderMap);

  const [local, setLocal] = useState(
    scriptText ||
    names.slice(0, 2).map((n, i) => (i === 0
      ? `${n}: Hey! Are we still on for tonight?`
      : `${n}: Yeah definitely, 7pm works.`
    )).join('\n')
  );

  const { lines, error } = parseScriptLines(local, genderMap);

  const handleNext = () => {
    if (error || lines.length === 0) return;
    setScriptText(local);
    setParsedLines(lines);
    onNext();
  };

  const insertName = (name: string) => {
    setLocal((prev) => {
      const parts = prev.split('\n');
      const last = parts[parts.length - 1] || '';
      if (!last.trim()) {
        parts[parts.length - 1] = `${name}: `;
      } else {
        parts.push(`${name}: `);
      }
      return parts.join('\n');
    });
  };

  const allNames = Object.keys(genderMap);

  return (
    <div className="p-8 max-w-3xl mx-auto space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-white">Write the script</h2>
        <p className="text-sm text-white/40 mt-1">Each line: <code className="text-green-400 text-xs">Name: message</code></p>
      </div>

      {/* Cast pill shortcuts */}
      <div className="flex flex-wrap gap-2">
        {names.map((name) => {
          const col = charColor(name, allNames);
          return (
            <button
              key={name}
              onClick={() => insertName(name)}
              className={cn('flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-opacity hover:opacity-80', col.bg, col.text)}
            >
              <span className={cn('w-1.5 h-1.5 rounded-full', col.dot)} />
              {name}
            </button>
          );
        })}
        <span className="text-xs text-white/25 self-center">← click to insert</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Textarea */}
        <div className="lg:col-span-3 space-y-2">
          <Textarea
            value={local}
            onChange={(e) => setLocal(e.target.value)}
            className="min-h-72 bg-white/3 border-white/8 text-white font-mono text-sm resize-none leading-relaxed focus:border-green-500/40"
            placeholder={names.slice(0,2).map((n,i)=>`${n}: ${i===0?'Hey!':'Hi there!'}`).join('\n')}
            spellCheck={false}
          />
          {error && (
            <p className="flex items-center gap-2 text-red-400 text-sm">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" /> {error}
            </p>
          )}
        </div>

        {/* Live preview */}
        <div className="lg:col-span-2">
          <div className="rounded-xl border border-white/8 bg-white/3 overflow-hidden h-72 flex flex-col">
            <div className="px-3 py-2 border-b border-white/5">
              <p className="text-xs text-white/30 font-medium uppercase tracking-wider">Preview</p>
            </div>
            <div className="flex-1 overflow-auto p-3 space-y-2">
              {lines.length === 0
                ? <p className="text-xs text-white/20 text-center mt-8">Start typing…</p>
                : lines.map((line, i) => {
                    const isFirst = line.character === lines[0].character;
                    const col = charColor(line.character, allNames);
                    return (
                      <div key={i} className={cn('flex', isFirst ? 'justify-end' : 'justify-start')}>
                        <div className={cn(
                          'rounded-2xl px-2.5 py-1.5 text-xs max-w-[78%]',
                          isFirst
                            ? 'bg-green-600/80 text-white rounded-br-sm'
                            : cn('bg-white/8 text-white/80 rounded-bl-sm')
                        )}>
                          {line.text}
                        </div>
                      </div>
                    );
                  })
              }
            </div>
          </div>
          <p className="text-xs text-white/25 text-right mt-1">{lines.length} lines</p>
        </div>
      </div>

      <div className="flex justify-between pt-1">
        <Button variant="ghost" onClick={onBack} className="text-white/40 hover:text-white h-9 text-sm">
          <ArrowLeft className="mr-2 h-3.5 w-3.5" /> Back
        </Button>
        <Button onClick={handleNext} disabled={!!error || lines.length === 0} className="bg-green-600 hover:bg-green-700 h-9 text-sm px-5">
          Next <ArrowRight className="ml-2 h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

/* ─── Step 3: Voices ─────────────────────────────────────────────── */

function VoicesStep({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const { genderMap, characters, updateCharacter, settings, setSettings,
          backgroundVideoId, backgroundMusicId, setBackgroundVideoId, setBackgroundMusicId } = useVideoStore();
  const [voices, setVoices] = useState<Array<{ shortName: string; gender: string; locale: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const allNames = Object.keys(genderMap);

  useEffect(() => {
    setLoading(true);
    fetch('/api/imessage/voices')
      .then((r) => r.json())
      .then((d) => setVoices(d.voices || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const preview = async (voice: string) => {
    if (playing === voice) { audioRef.current?.pause(); setPlaying(null); return; }
    try {
      const res = await fetch('/api/imessage/preview-voice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voice, text: 'Hey, this is how I sound.' }),
      });
      const blob = await res.blob();
      audioRef.current?.pause();
      const audio = new Audio(URL.createObjectURL(blob));
      audioRef.current = audio;
      setPlaying(voice);
      audio.play();
      audio.onended = () => setPlaying(null);
    } catch (_) {}
  };

  const uploadFile = async (file: File, type: string) => {
    const form = new FormData();
    form.append('file', file);
    form.append('type', type);
    const res = await fetch('/api/imessage/upload', { method: 'POST', body: form });
    return res.json();
  };

  return (
    <div className="p-8 max-w-2xl mx-auto space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-white">Voices & settings</h2>
        <p className="text-sm text-white/40 mt-1">Pick a voice for each character, then set the video style.</p>
      </div>

      {/* Characters */}
      <div className="space-y-3">
        {allNames.map((name) => {
          const char = characters[name] || {};
          const col = charColor(name, allNames);
          const charVoices = voices.filter((v) => v.gender === (genderMap[name] === 'F' ? 'Female' : 'Male'));
          return (
            <div key={name} className="flex items-center gap-3 p-3 rounded-xl bg-white/4 border border-white/6">
              <div className={cn('w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold shrink-0', col.bg, col.text)}>
                {name[0].toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white mb-1">{name}</p>
                <Select
                  value={char.voice || ''}
                  onValueChange={(v) => updateCharacter(name, { voice: v })}
                  disabled={loading}
                >
                  <SelectTrigger className="h-8 text-xs bg-white/5 border-white/10 text-white">
                    <SelectValue placeholder={loading ? 'Loading…' : 'Select voice'} />
                  </SelectTrigger>
                  <SelectContent className="bg-[#1a1a1a] border-white/10 max-h-44">
                    {charVoices.map((v) => (
                      <SelectItem key={v.shortName} value={v.shortName} className="text-xs text-white/80">
                        {v.shortName.split('-').slice(2).join('-')}
                        <span className="text-white/30 ml-1">({v.locale})</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <button
                onClick={() => preview(char.voice || '')}
                disabled={!char.voice}
                className="w-8 h-8 rounded-full bg-white/5 hover:bg-green-500/20 flex items-center justify-center text-white/50 hover:text-green-400 transition-colors disabled:opacity-30"
              >
                {playing === char.voice ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5 ml-0.5" />}
              </button>
            </div>
          );
        })}
      </div>

      {/* Video settings */}
      <div className="rounded-xl border border-white/6 bg-white/3 p-4 space-y-4">
        <p className="text-xs font-semibold text-white/40 uppercase tracking-wider">Video style</p>

        <div className="flex items-center justify-between">
          <span className="text-sm text-white/70">Dark chat theme</span>
          <Switch checked={settings.darkMode} onCheckedChange={(v) => setSettings({ darkMode: v })} />
        </div>

        <div className="flex items-center justify-between">
          <span className="text-sm text-white/70">Show phone frame</span>
          <Switch checked={settings.showFrame} onCheckedChange={(v) => setSettings({ showFrame: v })} />
        </div>

        <div className="space-y-2">
          <span className="text-sm text-white/70">Format</span>
          <div className="grid grid-cols-2 gap-2 mt-1.5">
            {(['9:16', '16:9'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setSettings({ format: f })}
                className={cn(
                  'py-2 rounded-lg border text-xs font-medium transition-all',
                  settings.format === f
                    ? 'border-green-500/50 bg-green-500/10 text-green-400'
                    : 'border-white/8 text-white/30 hover:border-white/20 hover:text-white/50'
                )}
              >
                {f === '9:16' ? '9∶16 — Vertical' : '16∶9 — Landscape'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Media uploads */}
      <div className="grid grid-cols-2 gap-3">
        {[
          { icon: Video, label: 'Background video', sub: 'MP4 gameplay / nature', type: 'background_video', accept: 'video/mp4', uploaded: !!backgroundVideoId, onUpload: (fid: string) => setBackgroundVideoId(fid) },
          { icon: Music, label: 'Background music', sub: 'MP3 lo-fi / trending', type: 'background_music', accept: 'audio/*', uploaded: !!backgroundMusicId, onUpload: (fid: string) => setBackgroundMusicId(fid) },
        ].map(({ icon: Icon, label, sub, type, accept, uploaded, onUpload }) => (
          <label key={label} className={cn(
            'relative flex flex-col items-center gap-2 p-4 rounded-xl border border-dashed cursor-pointer transition-colors',
            uploaded ? 'border-green-500/40 bg-green-500/5' : 'border-white/10 bg-white/3 hover:border-white/20'
          )}>
            <Icon className={cn('h-5 w-5', uploaded ? 'text-green-400' : 'text-white/30')} />
            <div className="text-center">
              <p className={cn('text-xs font-medium', uploaded ? 'text-green-400' : 'text-white/50')}>{uploaded ? 'Uploaded ✓' : label}</p>
              {!uploaded && <p className="text-[10px] text-white/25 mt-0.5">{sub}</p>}
            </div>
            <input
              type="file"
              accept={accept}
              className="absolute inset-0 opacity-0 cursor-pointer"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const data = await uploadFile(file, type);
                if (data.fileId) onUpload(data.fileId);
              }}
            />
          </label>
        ))}
      </div>

      <div className="flex justify-between pt-1">
        <Button variant="ghost" onClick={onBack} className="text-white/40 hover:text-white h-9 text-sm">
          <ArrowLeft className="mr-2 h-3.5 w-3.5" /> Back
        </Button>
        <Button onClick={onNext} className="bg-green-600 hover:bg-green-700 h-9 text-sm px-5">
          Generate audio <ArrowRight className="ml-2 h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

/* ─── Step 4: Generate ───────────────────────────────────────────── */

function GenerateStep({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const { parsedLines, characters, jobId, setJobId, setTimeline } = useVideoStore();
  const [progress, setProgress] = useState<{ completed: number; total: number; status: string; durations: Record<number, number> } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const started = useRef(false);
  const allNames = [...new Set(parsedLines.map((l) => l.character))];

  const buildTimeline = (durations: Record<number, number>) => {
    let t = 0;
    const timeline: TimelineEntry[] = parsedLines.map((line) => {
      const dur = (durations[line.index] ?? 2) * 1000;
      const entry: TimelineEntry = { lineIndex: line.index, startTime: t, duration: dur, type: 'text' };
      t += dur + 700;
      return entry;
    });
    setTimeline(timeline);
  };

  useEffect(() => {
    const start = async () => {
      if (started.current || jobId) return;
      started.current = true;
      const payload = parsedLines.map((l) => ({
        index: l.index,
        character: l.character,
        text: l.text,
        voice: characters[l.character]?.voice || 'en-US-AriaNeural',
      }));
      try {
        const res = await fetch('/api/imessage/generate-audio', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lines: payload }),
        });
        const data = await res.json();
        setJobId(data.jobId);
      } catch (_) { setErr('Failed to start audio generation.'); }
    };
    start();
  }, []);

  useEffect(() => {
    if (!jobId) return;
    const iv = setInterval(async () => {
      const res = await fetch(`/api/imessage/audio-progress/${jobId}`);
      const data = await res.json();
      setProgress(data);
      if (data.status === 'done') { clearInterval(iv); buildTimeline(data.durations || {}); }
      if (data.status === 'error') { clearInterval(iv); setErr('Audio generation failed.'); }
    }, 800);
    return () => clearInterval(iv);
  }, [jobId]);

  const total   = progress?.total   || parsedLines.length || 1;
  const done    = progress?.completed || 0;
  const pct     = Math.min(100, Math.round((done / total) * 100));
  const isDone  = progress?.status === 'done';

  return (
    <div className="p-8 max-w-lg mx-auto space-y-6">
      <div className="text-center space-y-1">
        <h2 className="text-xl font-semibold text-white">Generating audio</h2>
        <p className="text-sm text-white/40">Synthesising voices for {allNames.join(', ')}…</p>
      </div>

      <div className="rounded-xl border border-white/6 bg-white/3 p-5 space-y-5">
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-white/50">{isDone ? 'All done!' : 'Processing…'}</span>
            <span className="text-green-400 font-semibold">{pct}%</span>
          </div>
          <Progress value={pct} className="h-1.5" />
          <p className="text-xs text-white/25 text-right">{done} / {total} lines</p>
        </div>

        {err && (
          <p className="flex items-center gap-2 text-red-400 text-sm">
            <AlertCircle className="h-4 w-4 shrink-0" /> {err}
          </p>
        )}

        <div className="space-y-2 max-h-48 overflow-auto pr-1">
          {parsedLines.map((line) => {
            const lineDone = isDone || (progress?.durations?.[line.index] !== undefined);
            const col = charColor(line.character, allNames);
            return (
              <div key={line.index} className="flex items-center gap-2.5 text-xs">
                {lineDone
                  ? <CheckCircle2 className="h-3.5 w-3.5 text-green-400 shrink-0" />
                  : <Loader2 className="h-3.5 w-3.5 text-white/30 animate-spin shrink-0" />}
                <span className={cn('w-16 truncate font-medium shrink-0', col.text)}>{line.character}</span>
                <span className="text-white/30 truncate">"{line.text}"</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex justify-between">
        <Button variant="ghost" onClick={onBack} className="text-white/40 hover:text-white h-9 text-sm">
          <ArrowLeft className="mr-2 h-3.5 w-3.5" /> Cancel
        </Button>
        <Button onClick={onNext} disabled={!isDone} className="bg-green-600 hover:bg-green-700 h-9 text-sm px-5">
          Preview <ArrowRight className="ml-2 h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

/* ─── Step 5: Preview ────────────────────────────────────────────── */

function PreviewStep({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const { parsedLines, timeline, jobId, settings, setExportId } = useVideoStore();
  const [visible, setVisible] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [exporting, setExporting] = useState(false);
  const audios = useRef<Record<number, HTMLAudioElement>>({});
  const active = useRef(false);
  const timer  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const allNames = [...new Set(parsedLines.map((l) => l.character))];
  const sender = parsedLines[0]?.character || '';

  useEffect(() => {
    if (!jobId) return;
    parsedLines.forEach((l) => {
      audios.current[l.index] = new Audio(`/api/imessage/audio-file/${jobId}/${l.index}`);
    });
    return () => Object.values(audios.current).forEach((a) => a.pause());
  }, [jobId]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [visible]);

  const play = (idx: number) => {
    if (!active.current || idx >= timeline.length) { setPlaying(false); active.current = false; return; }
    setVisible(idx + 1);
    const entry = timeline[idx];
    const audio = audios.current[entry.lineIndex];
    if (audio) {
      audio.currentTime = 0;
      audio.onended = () => { if (active.current) timer.current = setTimeout(() => play(idx + 1), 400); };
      audio.play().catch((e: Error) => {
        if (e.name === 'AbortError') return;
        if (active.current) timer.current = setTimeout(() => play(idx + 1), entry.duration);
      });
    } else {
      timer.current = setTimeout(() => { if (active.current) play(idx + 1); }, entry.duration || 2000);
    }
  };

  const toggle = () => {
    if (playing) {
      active.current = false;
      if (timer.current) clearTimeout(timer.current);
      Object.values(audios.current).forEach((a) => a.pause());
      setPlaying(false);
    } else {
      setVisible(0);
      active.current = true;
      setPlaying(true);
      timer.current = setTimeout(() => play(0), 200);
    }
  };

  const doExport = async () => {
    setExporting(true);
    try {
      const res = await fetch('/api/imessage/export', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId, timeline, settings }),
      });
      const data = await res.json();
      setExportId(data.exportId);
      onNext();
    } catch (_) { setExporting(false); }
  };

  const chatLines = parsedLines.slice(0, visible);

  return (
    <div className="p-8 max-w-3xl mx-auto space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-white">Preview</h2>
        <p className="text-sm text-white/40 mt-1">Watch the conversation play through, then export.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
        {/* Phone mockup */}
        <div className={cn(
          'mx-auto rounded-3xl overflow-hidden border',
          settings.darkMode ? 'border-white/10 bg-black' : 'border-gray-300 bg-[#f2f2f7]',
          'w-56 h-[440px] flex flex-col'
        )}>
          {/* status bar */}
          <div className={cn('px-4 py-3 border-b shrink-0', settings.darkMode ? 'border-white/8' : 'border-gray-200')}>
            <p className={cn('text-center text-xs font-semibold', settings.darkMode ? 'text-white' : 'text-black')}>
              {parsedLines.find((l) => l.character !== sender)?.character || 'Contact'}
            </p>
          </div>
          {/* messages */}
          <div className="flex-1 overflow-auto p-2.5 space-y-1.5">
            {chatLines.map((line, i) => {
              const isMe = line.character === sender;
              return (
                <div key={i} className={cn('flex', isMe ? 'justify-end' : 'justify-start')}>
                  <div className={cn(
                    'px-2.5 py-1 rounded-2xl text-[11px] max-w-[80%] leading-snug',
                    isMe
                      ? 'bg-[#34c759] text-white rounded-br-sm'
                      : settings.darkMode
                        ? 'bg-white/12 text-white rounded-bl-sm'
                        : 'bg-white text-black rounded-bl-sm'
                  )}>
                    {line.text}
                  </div>
                </div>
              );
            })}
            <div ref={endRef} />
          </div>
        </div>

        {/* Controls */}
        <div className="space-y-4">
          <div className="rounded-xl border border-white/6 bg-white/3 p-4 space-y-4">
            <div className="flex items-center gap-3">
              <button
                onClick={toggle}
                className={cn(
                  'w-11 h-11 rounded-full flex items-center justify-center transition-colors shrink-0',
                  playing ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30' : 'bg-green-500/20 text-green-400 hover:bg-green-500/30'
                )}
              >
                {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 ml-0.5" />}
              </button>
              <div>
                <p className="text-sm text-white font-medium">{playing ? 'Playing…' : visible === 0 ? 'Press play' : 'Paused'}</p>
                <p className="text-xs text-white/30">{Math.min(visible, timeline.length)} / {timeline.length} messages</p>
              </div>
            </div>

            <div className="h-px bg-white/5" />

            {/* Script list */}
            <div className="space-y-1.5 max-h-36 overflow-auto">
              {parsedLines.map((line, i) => {
                const col = charColor(line.character, allNames);
                const shown = i < visible;
                return (
                  <div key={i} className={cn('flex items-center gap-2 text-xs transition-opacity', shown ? 'opacity-100' : 'opacity-20')}>
                    <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', col.dot)} />
                    <span className={cn('w-14 truncate font-medium shrink-0', col.text)}>{line.character}</span>
                    <span className="text-white/40 truncate">{line.text.substring(0, 35)}{line.text.length > 35 ? '…' : ''}</span>
                  </div>
                );
              })}
            </div>
          </div>

          <Button
            className="w-full h-10 bg-green-600 hover:bg-green-700 text-sm"
            onClick={doExport}
            disabled={exporting}
          >
            {exporting ? 'Starting export…' : 'Export video'}
            <Download className="ml-2 h-3.5 w-3.5" />
          </Button>
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

/* ─── Step 6: Export ─────────────────────────────────────────────── */

function ExportStep({ onReset }: { onReset: () => void }) {
  const { exportId } = useVideoStore();
  const [prog, setProg] = useState<{ status: string; progress: number; errorMessage?: string } | null>(null);

  useEffect(() => {
    if (!exportId) return;
    const iv = setInterval(async () => {
      const res = await fetch(`/api/imessage/export-progress/${exportId}`);
      const data = await res.json();
      setProg(data);
      if (data.status === 'done' || data.status === 'error') clearInterval(iv);
    }, 800);
    return () => clearInterval(iv);
  }, [exportId]);

  const isDone  = prog?.status === 'done';
  const isError = prog?.status === 'error';
  const pct     = prog?.progress || 0;

  return (
    <div className="p-8 max-w-md mx-auto space-y-6">
      <div className="text-center space-y-1">
        <h2 className="text-xl font-semibold text-white">Rendering video</h2>
        <p className="text-sm text-white/40">Combining audio, frames & background…</p>
      </div>

      <div className="rounded-xl border border-white/6 bg-white/3 p-6 space-y-5">
        <div className="space-y-2">
          <div className="flex justify-between items-center text-sm">
            <div className="flex items-center gap-2 text-white/60">
              {isDone   ? <CheckCircle2 className="h-4 w-4 text-green-400" /> :
               isError  ? <AlertCircle  className="h-4 w-4 text-red-400"   /> :
                          <Loader2      className="h-4 w-4 animate-spin text-white/30" />}
              {isDone ? 'Done!' : isError ? 'Failed' : 'Rendering…'}
            </div>
            <span className="text-green-400 font-semibold text-lg">{Math.round(pct)}%</span>
          </div>
          <Progress value={pct} className="h-2" />
        </div>

        {isError && (
          <p className="text-sm text-red-400 flex items-start gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            {prog?.errorMessage || 'Something went wrong during rendering.'}
          </p>
        )}

        <div className="space-y-2">
          <Button
            className="w-full h-10 bg-green-600 hover:bg-green-700 text-sm"
            onClick={() => window.open(`/api/imessage/download/${exportId}`, '_blank')}
            disabled={!isDone}
          >
            Download MP4 <Download className="ml-2 h-3.5 w-3.5" />
          </Button>
          {isDone && (
            <Button
              variant="ghost"
              className="w-full h-9 text-white/40 hover:text-white text-sm"
              onClick={onReset}
            >
              Create another
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Root ───────────────────────────────────────────────────────── */

export function TextAutomation() {
  const [step, setStep] = useState<Step>('cast');
  const { reset } = useVideoStore();

  const handleReset = () => { reset(); setStep('cast'); };

  return (
    <div className="min-h-screen bg-[#080808] flex flex-col">
      <StepBar current={step} />
      <div className="flex-1">
        {step === 'cast'     && <CastStep     onNext={() => setStep('script')}   />}
        {step === 'script'   && <ScriptStep   onNext={() => setStep('voices')}   onBack={() => setStep('cast')}     />}
        {step === 'voices'   && <VoicesStep   onNext={() => setStep('generate')} onBack={() => setStep('script')}   />}
        {step === 'generate' && <GenerateStep onNext={() => setStep('preview')}  onBack={() => setStep('voices')}   />}
        {step === 'preview'  && <PreviewStep  onNext={() => setStep('export')}   onBack={() => setStep('generate')} />}
        {step === 'export'   && <ExportStep   onReset={handleReset}              />}
      </div>
    </div>
  );
}
