import { useState, useEffect, useRef } from 'react';
import { useVideoStore, type Gender, type ScriptLine, type TimelineEntry } from '@/store/use-video-store';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  AlertCircle, ArrowRight, ArrowLeft, User, CheckCircle2, Loader2,
  Play, Pause, Download, Upload, Music, Video, Home
} from 'lucide-react';

type Step = 'script' | 'characters' | 'generate' | 'preview' | 'export';

const STEPS: { id: Step; title: string; description: string }[] = [
  { id: 'script', title: 'Script Input', description: 'Write your conversation' },
  { id: 'characters', title: 'Characters', description: 'Assign voices & avatars' },
  { id: 'generate', title: 'Generate Audio', description: 'Create voice lines' },
  { id: 'preview', title: 'Preview', description: 'Watch the conversation' },
  { id: 'export', title: 'Export', description: 'Render final video' },
];

function cn(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ');
}

function parseScript(raw: string): { genderMap: Record<string, Gender>; lines: ScriptLine[]; error: string | null } {
  try {
    if (!raw.trim()) return { genderMap: {}, lines: [], error: null };
    const textLines = raw.split('\n').filter((l) => l.trim().length > 0);
    if (textLines.length === 0) throw new Error('Script is empty');
    const firstLine = textLines[0];
    if (!firstLine.includes('=')) throw new Error("First line must be a gender map, e.g., 'Sarah=F, Michael=M'");
    const genderMap: Record<string, Gender> = {};
    for (const part of firstLine.split(',')) {
      const [name, gender] = part.split('=').map((s) => s.trim());
      if (!name || (gender !== 'M' && gender !== 'F')) throw new Error("Invalid gender map. Use 'Name=M' or 'Name=F'.");
      genderMap[name] = gender as Gender;
    }
    const lines: ScriptLine[] = [];
    for (let i = 1; i < textLines.length; i++) {
      const line = textLines[i];
      const colonIdx = line.indexOf(':');
      if (colonIdx === -1) throw new Error(`Line ${i + 1} is missing a colon (:). Format: "Name: message"`);
      const character = line.substring(0, colonIdx).trim();
      const text = line.substring(colonIdx + 1).trim();
      if (!genderMap[character]) throw new Error(`Character "${character}" not in gender map.`);
      lines.push({ index: i - 1, character, text, isImage: text.startsWith('[img:') && text.endsWith(']') });
    }
    return { genderMap, lines, error: null };
  } catch (e: unknown) {
    return { genderMap: {}, lines: [], error: (e as Error).message };
  }
}

function ScriptStep({ onNext }: { onNext: () => void }) {
  const { scriptText, setScriptText, setGenderMap, setParsedLines, characters, updateCharacter } = useVideoStore();
  const [localScript, setLocalScript] = useState(
    scriptText || 'Sarah=F, Michael=M\nSarah: Hey! Are we still on for tonight?\nMichael: Yeah definitely. 7pm at the usual spot?'
  );
  const { genderMap, lines, error } = parseScript(localScript);

  const handleNext = () => {
    if (error || lines.length === 0) return;
    setScriptText(localScript);
    setGenderMap(genderMap);
    setParsedLines(lines);
    Object.entries(genderMap).forEach(([name, gender]) => {
      if (!characters[name]) {
        updateCharacter(name, { gender, voice: gender === 'F' ? 'en-US-AriaNeural' : 'en-US-GuyNeural' });
      }
    });
    onNext();
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">Script Input</h2>
        <p className="text-gray-400 text-sm mt-1">Write a conversation script. First line defines character genders.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-3">
          <Label className="text-gray-300">Script</Label>
          <Textarea
            value={localScript}
            onChange={(e) => setLocalScript(e.target.value)}
            className="min-h-64 bg-gray-900 border-gray-700 text-white font-mono text-sm resize-none"
            placeholder={'Sarah=F, Michael=M\nSarah: Hey!\nMichael: Hi there!'}
          />
          {error && (
            <div className="flex items-start gap-2 text-red-400 text-sm bg-red-950/30 border border-red-800/50 rounded-lg p-3">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
          <div className="text-xs text-gray-500">
            <p>Format: First line = <code className="text-green-400">Name=F, Name=M</code></p>
            <p>Messages = <code className="text-green-400">Name: message text</code></p>
          </div>
        </div>

        <div className="space-y-4">
          <Card className="bg-gray-900 border-gray-700">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm text-gray-300">Detected Characters</CardTitle>
            </CardHeader>
            <CardContent>
              {Object.keys(genderMap).length === 0 ? (
                <p className="text-gray-500 text-sm text-center py-4">No characters detected yet.</p>
              ) : (
                <div className="space-y-2">
                  {Object.entries(genderMap).map(([name, gender]) => (
                    <div key={name} className="flex items-center justify-between p-2 rounded-lg bg-gray-800/50">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-green-500/20 flex items-center justify-center text-green-400">
                          <User className="h-3.5 w-3.5" />
                        </div>
                        <span className="text-sm font-medium text-white">{name}</span>
                      </div>
                      <Badge variant="outline" className={gender === 'F' ? 'border-pink-500/30 text-pink-400' : 'border-blue-500/30 text-blue-400'}>
                        {gender === 'F' ? 'Female' : 'Male'}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="bg-gray-900 border-gray-700">
            <CardContent className="pt-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col items-center justify-center p-3 rounded-lg bg-gray-800/50">
                  <span className="text-2xl font-bold text-green-400">{lines.length}</span>
                  <span className="text-xs text-gray-500 uppercase tracking-wider mt-1">Lines</span>
                </div>
                <div className="flex flex-col items-center justify-center p-3 rounded-lg bg-gray-800/50">
                  <span className="text-2xl font-bold text-green-400">{Object.keys(genderMap).length}</span>
                  <span className="text-xs text-gray-500 uppercase tracking-wider mt-1">Cast</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="flex justify-end">
        <Button onClick={handleNext} disabled={!!error || lines.length === 0} className="bg-green-600 hover:bg-green-700">
          Continue <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function CharactersStep({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const {
    characters, genderMap, updateCharacter, settings, setSettings,
    setBackgroundMusicId, setBackgroundVideoId, backgroundVideoId, backgroundMusicId,
  } = useVideoStore();
  const [voices, setVoices] = useState<Array<{ shortName: string; name: string; gender: string; locale: string }>>([]);
  const [loadingVoices, setLoadingVoices] = useState(false);
  const [playingVoice, setPlayingVoice] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    setLoadingVoices(true);
    fetch('/api/imessage/voices')
      .then((r) => r.json())
      .then((d) => setVoices(d.voices || []))
      .catch(() => {})
      .finally(() => setLoadingVoices(false));
  }, []);

  const handlePlayPreview = async (voice: string) => {
    if (playingVoice === voice && audioRef.current) {
      audioRef.current.pause();
      setPlayingVoice(null);
      return;
    }
    try {
      const res = await fetch('/api/imessage/preview-voice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voice, text: 'Hello, this is a voice preview.' }),
      });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      if (audioRef.current) audioRef.current.pause();
      const audio = new Audio(url);
      audioRef.current = audio;
      setPlayingVoice(voice);
      audio.play();
      audio.onended = () => setPlayingVoice(null);
    } catch (_) {}
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>, charName: string) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    form.append('type', 'avatar');
    form.append('characterName', charName);
    const res = await fetch('/api/imessage/upload', { method: 'POST', body: form });
    const data = await res.json();
    if (data.fileId) updateCharacter(charName, { avatarFileId: data.fileId, avatarUrl: data.url });
  };

  const handleBgVideoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    form.append('type', 'background_video');
    const res = await fetch('/api/imessage/upload', { method: 'POST', body: form });
    const data = await res.json();
    if (data.fileId) setBackgroundVideoId(data.fileId);
  };

  const handleBgMusicUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    form.append('type', 'background_music');
    const res = await fetch('/api/imessage/upload', { method: 'POST', body: form });
    const data = await res.json();
    if (data.fileId) setBackgroundMusicId(data.fileId);
  };

  const charNames = Object.keys(genderMap);

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">Characters & Settings</h2>
        <p className="text-gray-400 text-sm mt-1">Assign voices and customize the video appearance.</p>
      </div>

      {charNames.map((name) => {
        const char = characters[name] || {};
        const charVoices = voices.filter((v) => v.gender === (genderMap[name] === 'F' ? 'Female' : 'Male'));
        return (
          <Card key={name} className="bg-gray-900 border-gray-700">
            <CardContent className="pt-5 space-y-4">
              <div className="flex items-center gap-4">
                <div className="relative">
                  <Avatar className="h-14 w-14">
                    <AvatarImage src={char.avatarUrl ? `/api${char.avatarUrl.replace('/api', '')}` : undefined} />
                    <AvatarFallback className="bg-gray-700 text-white text-lg">{name[0]}</AvatarFallback>
                  </Avatar>
                  <label className="absolute -bottom-1 -right-1 bg-gray-700 rounded-full p-0.5 cursor-pointer hover:bg-gray-600">
                    <Upload className="h-3 w-3 text-gray-300" />
                    <input type="file" accept="image/*" className="hidden" onChange={(e) => handleAvatarUpload(e, name)} />
                  </label>
                </div>
                <div>
                  <p className="font-medium text-white">{name}</p>
                  <Badge variant="outline" className={genderMap[name] === 'F' ? 'border-pink-500/30 text-pink-400' : 'border-blue-500/30 text-blue-400'}>
                    {genderMap[name] === 'F' ? 'Female' : 'Male'}
                  </Badge>
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-gray-300 text-sm">Voice</Label>
                <div className="flex gap-2">
                  <Select
                    value={char.voice || ''}
                    onValueChange={(v) => updateCharacter(name, { voice: v })}
                    disabled={loadingVoices}
                  >
                    <SelectTrigger className="bg-gray-800 border-gray-600 text-white flex-1">
                      <SelectValue placeholder={loadingVoices ? 'Loading voices...' : 'Select a voice'} />
                    </SelectTrigger>
                    <SelectContent className="bg-gray-800 border-gray-600 max-h-48">
                      {charVoices.map((v) => (
                        <SelectItem key={v.shortName} value={v.shortName} className="text-gray-200">
                          {v.shortName.split('-').slice(2).join('-')} ({v.locale})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-gray-600 text-gray-300"
                    onClick={() => handlePlayPreview(char.voice || '')}
                    disabled={!char.voice}
                  >
                    {playingVoice === char.voice ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}

      <Card className="bg-gray-900 border-gray-700">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm text-gray-300">Video Settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <Label className="text-gray-300">Dark Mode</Label>
            <Switch checked={settings.darkMode} onCheckedChange={(v) => setSettings({ darkMode: v })} />
          </div>
          <div className="flex items-center justify-between">
            <Label className="text-gray-300">Show Phone Frame</Label>
            <Switch checked={settings.showFrame} onCheckedChange={(v) => setSettings({ showFrame: v })} />
          </div>
          <div className="space-y-2">
            <Label className="text-gray-300">Format</Label>
            <div className="grid grid-cols-2 gap-2">
              {(['9:16', '16:9'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setSettings({ format: f })}
                  className={cn(
                    'p-2 rounded-lg border text-sm font-medium transition-colors',
                    settings.format === f
                      ? 'border-green-500 bg-green-500/10 text-green-400'
                      : 'border-gray-700 text-gray-400 hover:border-gray-500'
                  )}
                >
                  {f === '9:16' ? '9:16 Vertical (TikTok/Reels)' : '16:9 Landscape (YouTube)'}
                </button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3">
        <div className="border border-dashed border-gray-700 rounded-xl p-4 flex flex-col items-center gap-2 bg-gray-900/50 relative hover:bg-gray-800/50 transition-colors">
          <Video className="h-6 w-6 text-gray-500" />
          <p className="text-xs font-medium text-gray-300">Background Video</p>
          <p className="text-xs text-gray-600">Gameplay/Nature (MP4)</p>
          {backgroundVideoId && <Badge className="bg-green-500/10 text-green-400 border-green-500/30">Uploaded</Badge>}
          <input type="file" accept="video/mp4" className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" onChange={handleBgVideoUpload} />
        </div>
        <div className="border border-dashed border-gray-700 rounded-xl p-4 flex flex-col items-center gap-2 bg-gray-900/50 relative hover:bg-gray-800/50 transition-colors">
          <Music className="h-6 w-6 text-gray-500" />
          <p className="text-xs font-medium text-gray-300">Background Music</p>
          <p className="text-xs text-gray-600">Lo-fi/Trending (MP3)</p>
          {backgroundMusicId && <Badge className="bg-green-500/10 text-green-400 border-green-500/30">Uploaded</Badge>}
          <input type="file" accept="audio/*" className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" onChange={handleBgMusicUpload} />
        </div>
      </div>

      <div className="flex justify-between">
        <Button variant="ghost" onClick={onBack} className="text-gray-400">
          <ArrowLeft className="mr-2 h-4 w-4" /> Back
        </Button>
        <Button onClick={onNext} className="bg-green-600 hover:bg-green-700">
          Generate Audio <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function GenerateStep({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const { parsedLines, characters, jobId, setJobId, setTimeline } = useVideoStore();
  const [progress, setProgress] = useState<{ completed: number; total: number; status: string; durations: Record<string, number> } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const hasStarted = useRef(false);

  useEffect(() => {
    const start = async () => {
      if (hasStarted.current || jobId || parsedLines.length === 0) return;
      hasStarted.current = true;
      const textLines = parsedLines.filter((l) => !l.isImage);
      if (textLines.length === 0) {
        buildTimeline({});
        onNext();
        return;
      }
      const linesPayload = textLines.map((l) => ({
        index: l.index,
        character: l.character,
        text: l.text,
        voice: characters[l.character]?.voice || 'en-US-AriaNeural',
      }));
      try {
        const res = await fetch('/api/imessage/generate-audio', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lines: linesPayload }),
        });
        const data = await res.json();
        setJobId(data.jobId);
      } catch (e) {
        setError('Failed to start audio generation.');
      }
    };
    start();
  }, []);

  useEffect(() => {
    if (!jobId) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/imessage/audio-progress/${jobId}`);
        const data = await res.json();
        setProgress(data);
        if (data.status === 'done') {
          clearInterval(interval);
          buildTimeline(data.durations || {});
        }
        if (data.status === 'error') {
          clearInterval(interval);
          setError('Audio generation failed.');
        }
      } catch (_) {}
    }, 1000);
    return () => clearInterval(interval);
  }, [jobId]);

  const buildTimeline = (durations: Record<string, number>) => {
    const timeline: TimelineEntry[] = [];
    let currentTime = 0;
    for (const line of parsedLines) {
      const duration = line.isImage ? 3000 : (durations[line.index] || 2) * 1000;
      timeline.push({ lineIndex: line.index, startTime: currentTime, duration, type: line.isImage ? 'image' : 'text' });
      currentTime += duration + 800;
    }
    setTimeline(timeline);
  };

  const isDone = progress?.status === 'done';
  const completed = progress?.completed || 0;
  const total = progress?.total || parsedLines.filter((l) => !l.isImage).length || 1;
  const percent = Math.min(100, Math.round((completed / total) * 100));

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-bold text-white">Generating Audio</h2>
        <p className="text-gray-400 text-sm">Synthesizing voices for your conversation...</p>
      </div>

      <Card className="bg-gray-900 border-gray-700">
        <CardContent className="p-6 space-y-6">
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-300">{isDone ? 'Complete!' : 'Processing...'}</span>
              <span className="text-green-400 font-bold">{percent}%</span>
            </div>
            <Progress value={percent} className="h-2" />
            <p className="text-xs text-gray-500 text-center">{completed} of {total} lines generated</p>
          </div>

          {error && (
            <div className="flex items-start gap-2 text-red-400 text-sm bg-red-950/30 border border-red-800/50 rounded-lg p-3">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <ScrollArea className="h-48 border border-gray-700 rounded-lg bg-gray-800/30 p-3">
            <div className="space-y-2">
              {parsedLines.map((line) => {
                const done = progress?.durations?.[line.index] !== undefined;
                const failed = progress && Array.isArray(progress.status) ? false : false;
                return (
                  <div key={line.index} className="flex items-center gap-2 text-sm">
                    {done ? <CheckCircle2 className="h-4 w-4 text-green-400 shrink-0" />
                      : isDone ? <CheckCircle2 className="h-4 w-4 text-green-400 shrink-0" />
                      : <Loader2 className="h-4 w-4 text-green-400 animate-spin shrink-0" />}
                    <span className="text-gray-400 font-medium w-20 truncate">{line.character}</span>
                    <span className="text-gray-500 truncate flex-1">"{line.text}"</span>
                  </div>
                );
              })}
            </div>
          </ScrollArea>

          <div className="flex justify-between">
            <Button variant="ghost" onClick={onBack} className="text-gray-400">
              <ArrowLeft className="mr-2 h-4 w-4" /> Cancel
            </Button>
            <Button onClick={onNext} disabled={!isDone} className="bg-green-600 hover:bg-green-700">
              Preview <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function PreviewStep({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const { parsedLines, characters, timeline, jobId, settings, setExportId } = useVideoStore();
  const [isPlaying, setIsPlaying] = useState(false);
  const [visibleCount, setVisibleCount] = useState(0);
  const [isExporting, setIsExporting] = useState(false);
  const audioRefs = useRef<Record<number, HTMLAudioElement>>({});
  const playbackRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!jobId) return;
    parsedLines.forEach((line) => {
      if (!line.isImage) {
        audioRefs.current[line.index] = new Audio(`/api/imessage/audio-file/${jobId}/${line.index}`);
      }
    });
    return () => { Object.values(audioRefs.current).forEach((a) => a.pause()); };
  }, [jobId, parsedLines]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [visibleCount]);

  const myCharacter = parsedLines[0]?.character || 'Me';

  const playSequence = (idx: number) => {
    if (!playbackRef.current || idx >= timeline.length) {
      setIsPlaying(false);
      playbackRef.current = false;
      return;
    }
    const entry = timeline[idx];
    setVisibleCount(idx + 1);
    const line = parsedLines[entry.lineIndex];
    if (entry.type === 'text') {
      const audio = audioRefs.current[entry.lineIndex];
      if (audio) {
        audio.currentTime = 0;
        audio.onended = () => { if (playbackRef.current) timerRef.current = setTimeout(() => playSequence(idx + 1), 400); };
        audio.play().catch(() => { if (playbackRef.current) timerRef.current = setTimeout(() => playSequence(idx + 1), entry.duration || 2000); });
      } else {
        timerRef.current = setTimeout(() => { if (playbackRef.current) playSequence(idx + 1); }, entry.duration || 2000);
      }
    } else {
      timerRef.current = setTimeout(() => { if (playbackRef.current) playSequence(idx + 1); }, 3000);
    }
  };

  const togglePlayback = () => {
    if (isPlaying) {
      playbackRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      Object.values(audioRefs.current).forEach((a) => a.pause());
      setIsPlaying(false);
    } else {
      setVisibleCount(0);
      playbackRef.current = true;
      setIsPlaying(true);
      timerRef.current = setTimeout(() => playSequence(0), 300);
    }
  };

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const res = await fetch('/api/imessage/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId, timeline, settings }),
      });
      const data = await res.json();
      setExportId(data.exportId);
      onNext();
    } catch (_) {
      setIsExporting(false);
    }
  };

  const visibleLines = parsedLines.slice(0, visibleCount);

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">Preview</h2>
        <p className="text-gray-400 text-sm mt-1">Watch the conversation play out and then export.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className={cn(
          'rounded-3xl overflow-hidden border border-gray-700 mx-auto',
          settings.format === '9:16' ? 'w-64 h-[460px]' : 'w-full h-48'
        )} style={{ background: settings.darkMode ? '#000' : '#f2f2f7' }}>
          <div className="h-full flex flex-col">
            <div className={cn('px-4 py-3 border-b', settings.darkMode ? 'border-gray-800' : 'border-gray-200')}>
              <p className={cn('text-center text-sm font-semibold', settings.darkMode ? 'text-white' : 'text-black')}>
                {parsedLines.find((l) => l.character !== myCharacter)?.character || 'Contact'}
              </p>
            </div>
            <div className="flex-1 overflow-auto p-3 space-y-2">
              {visibleLines.map((entry, i) => {
                const line = entry;
                const isMe = line.character === myCharacter;
                return (
                  <div key={i} className={cn('flex', isMe ? 'justify-end' : 'justify-start')}>
                    <div className={cn(
                      'rounded-2xl px-3 py-1.5 max-w-[75%] text-xs',
                      isMe
                        ? 'bg-green-500 text-white rounded-br-md'
                        : cn('rounded-bl-md', settings.darkMode ? 'bg-gray-700 text-white' : 'bg-white text-black')
                    )}>
                      {line.text}
                    </div>
                  </div>
                );
              })}
              <div ref={chatEndRef} />
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <Card className="bg-gray-900 border-gray-700">
            <CardContent className="p-4 space-y-4">
              <div className="flex items-center gap-4">
                <Button
                  size="icon"
                  className={cn('h-12 w-12 rounded-full', isPlaying ? 'bg-red-600 hover:bg-red-700' : 'bg-green-600 hover:bg-green-700')}
                  onClick={togglePlayback}
                >
                  {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 ml-0.5" />}
                </Button>
                <div>
                  <p className="text-sm font-medium text-white">{isPlaying ? 'Playing...' : 'Press to Play'}</p>
                  <p className="text-xs text-gray-500">Message {Math.min(visibleCount, timeline.length)} / {timeline.length}</p>
                </div>
              </div>

              <ScrollArea className="h-32 border border-gray-700 rounded-lg bg-gray-800/30 p-2">
                {timeline.map((entry, i) => {
                  const line = parsedLines[entry.lineIndex];
                  const isMe = line?.character === myCharacter;
                  return (
                    <div key={i} className={cn('flex items-center gap-2 text-xs py-1', i < visibleCount ? 'text-white' : 'text-gray-600')}>
                      <div className={cn('h-1.5 w-1.5 rounded-full shrink-0', i < visibleCount ? (isMe ? 'bg-green-400' : 'bg-blue-400') : 'bg-gray-700')} />
                      <span className="w-16 truncate font-medium">{line?.character}</span>
                      <span className="truncate">{line?.text?.substring(0, 30)}{(line?.text?.length || 0) > 30 ? '…' : ''}</span>
                    </div>
                  );
                })}
              </ScrollArea>
            </CardContent>
          </Card>

          <Button
            className="w-full h-11 bg-green-600 hover:bg-green-700"
            onClick={handleExport}
            disabled={isExporting}
          >
            {isExporting ? 'Starting Export...' : 'Export Video'}
            <Download className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="flex justify-between">
        <Button variant="ghost" onClick={onBack} className="text-gray-400">
          <ArrowLeft className="mr-2 h-4 w-4" /> Back
        </Button>
      </div>
    </div>
  );
}

function ExportStep({ onReset }: { onReset: () => void }) {
  const { exportId } = useVideoStore();
  const [progress, setProgress] = useState<{ status: string; progress: number; errorMessage?: string } | null>(null);

  useEffect(() => {
    if (!exportId) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/imessage/export-progress/${exportId}`);
        const data = await res.json();
        setProgress(data);
        if (data.status === 'done' || data.status === 'error') clearInterval(interval);
      } catch (_) {}
    }, 1000);
    return () => clearInterval(interval);
  }, [exportId]);

  const isDone = progress?.status === 'done';
  const isError = progress?.status === 'error' || !exportId;
  const percent = progress?.progress || 0;

  const handleDownload = () => {
    if (!exportId) return;
    window.open(`/api/imessage/download/${exportId}`, '_blank');
  };

  return (
    <div className="p-6 max-w-xl mx-auto space-y-6">
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-bold text-white">Rendering Video</h2>
        <p className="text-gray-400 text-sm">Combining audio, frames, and background media...</p>
      </div>

      <Card className="bg-gray-900 border-gray-700">
        <CardContent className="p-6 space-y-6">
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-2">
                {isDone ? <CheckCircle2 className="h-5 w-5 text-green-400" />
                  : isError ? <AlertCircle className="h-5 w-5 text-red-400" />
                  : <Loader2 className="h-5 w-5 text-green-400 animate-spin" />}
                <span className="text-sm text-gray-300">
                  {isDone ? 'Render Complete!' : isError ? 'Render Failed' : 'Processing...'}
                </span>
              </div>
              <span className="text-2xl font-bold text-green-400">{Math.round(percent)}%</span>
            </div>
            <Progress value={percent} className="h-3" />
          </div>

          {isError && !isDone && (
            <div className="flex items-start gap-2 text-red-400 text-sm bg-red-950/30 border border-red-800/50 rounded-lg p-3">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{progress?.errorMessage || 'There was a problem rendering your video.'}</span>
            </div>
          )}

          <div className="space-y-3">
            <Button
              className="w-full h-11 bg-green-600 hover:bg-green-700"
              onClick={handleDownload}
              disabled={!isDone}
            >
              Download MP4 <Download className="ml-2 h-4 w-4" />
            </Button>

            {isDone && (
              <Button
                variant="outline"
                className="w-full border-gray-700 text-gray-300 hover:text-white"
                onClick={onReset}
              >
                Create Another <Home className="ml-2 h-4 w-4" />
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function TextAutomation() {
  const [step, setStep] = useState<Step>('script');
  const { reset } = useVideoStore();

  const currentIdx = STEPS.findIndex((s) => s.id === step);

  const handleReset = () => {
    reset();
    setStep('script');
  };

  return (
    <div className="flex min-h-screen bg-[#0a0a0a]">
      <aside className="w-52 border-r border-gray-800 bg-[#0d0d0d] p-4 flex flex-col shrink-0 hidden sm:flex">
        <div className="mb-6">
          <p className="text-xs text-gray-500 uppercase tracking-wider">iMessage Video Studio</p>
        </div>
        <nav className="space-y-5 flex-1">
          {STEPS.map((s, i) => {
            const isActive = s.id === step;
            const isPast = i < currentIdx;
            return (
              <div key={s.id} className="relative">
                {i < STEPS.length - 1 && (
                  <div className={cn('absolute left-3 top-8 bottom-[-20px] w-px', isPast ? 'bg-green-500' : 'bg-gray-700')} />
                )}
                <div className={cn('flex gap-3 items-start', i > currentIdx ? 'opacity-40 pointer-events-none' : '')}>
                  <div className={cn(
                    'w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold border-2 shrink-0 relative z-10',
                    isActive ? 'bg-green-500 border-green-500 text-white' : isPast ? 'bg-green-500/20 border-green-500 text-green-400' : 'bg-transparent border-gray-600 text-gray-500'
                  )}>
                    {isPast ? <CheckCircle2 className="h-3.5 w-3.5" /> : i + 1}
                  </div>
                  <div>
                    <p className={cn('text-xs font-medium', isActive ? 'text-white' : 'text-gray-500')}>{s.title}</p>
                    <p className="text-xs text-gray-600 mt-0.5">{s.description}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </nav>
        <div className="pt-4 border-t border-gray-800">
          <button onClick={handleReset} className="text-xs text-gray-600 hover:text-gray-400">Reset wizard</button>
        </div>
      </aside>

      <main className="flex-1 overflow-auto">
        {step === 'script' && <ScriptStep onNext={() => setStep('characters')} />}
        {step === 'characters' && <CharactersStep onNext={() => setStep('generate')} onBack={() => setStep('script')} />}
        {step === 'generate' && <GenerateStep onNext={() => setStep('preview')} onBack={() => setStep('characters')} />}
        {step === 'preview' && <PreviewStep onNext={() => setStep('export')} onBack={() => setStep('generate')} />}
        {step === 'export' && <ExportStep onReset={handleReset} />}
      </main>
    </div>
  );
}
