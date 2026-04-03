import { useState, useRef, useCallback } from 'react';
import { Upload, FileAudio, Download, CheckCircle, Loader2, AlertCircle, X } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';

const LANGUAGES = [
  { value: 'english',    label: 'English' },
  { value: 'spanish',    label: 'Spanish' },
  { value: 'hindi',      label: 'Hindi' },
  { value: 'nepali',     label: 'Nepali' },
  { value: 'french',     label: 'French' },
  { value: 'german',     label: 'German' },
  { value: 'portuguese', label: 'Portuguese' },
  { value: 'arabic',     label: 'Arabic' },
  { value: 'chinese',    label: 'Chinese' },
  { value: 'japanese',   label: 'Japanese' },
  { value: 'korean',     label: 'Korean' },
  { value: 'italian',    label: 'Italian' },
  { value: 'russian',    label: 'Russian' },
  { value: 'turkish',    label: 'Turkish' },
  { value: 'dutch',      label: 'Dutch' },
];

const MAX_FILES = 5;
const CHUNK_SIZE = 50 * 1024;
const PARALLEL_CHUNKS = 4;

interface FileEntry {
  file: File;
  checked: boolean;
  language: string;
}

interface SrtResult {
  srtFileName: string;
  downloadUrl: string;
}

type FileStatus = 'pending' | 'uploading' | 'queued' | 'done' | 'error';

interface ProcState {
  statuses: FileStatus[];
  uploadPcts: number[];
  results: SrtResult[];
  errorMsg: string;
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function uploadFile(
  file: File,
  sessionId: string,
  onProgress: (pct: number) => void,
): Promise<number> {
  const total = Math.ceil(file.size / CHUNK_SIZE);
  let done = 0;
  for (let batch = 0; batch < total; batch += PARALLEL_CHUNKS) {
    const indices = Array.from(
      { length: Math.min(PARALLEL_CHUNKS, total - batch) },
      (_, k) => batch + k,
    );
    await Promise.all(
      indices.map(async (i) => {
        const start = i * CHUNK_SIZE;
        const slice = file.slice(start, start + CHUNK_SIZE);
        const ab = await slice.arrayBuffer();
        const bytes = new Uint8Array(ab);
        let bin = '';
        for (let j = 0; j < bytes.byteLength; j++) bin += String.fromCharCode(bytes[j]);
        const b64 = btoa(bin);

        const res = await fetch('/api/subtitles/chunk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId, chunkIndex: i, totalChunks: total, data: b64 }),
        });
        if (!res.ok) {
          const e = await res.json().catch(() => ({})) as { error?: string };
          throw new Error(e.error ?? 'Chunk upload failed');
        }
        done++;
        onProgress(Math.round((done / total) * 100));
      }),
    );
  }
  return total;
}

export function SubtitlePage() {
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [stage, setStage] = useState<'setup' | 'processing' | 'done'>('setup');
  const [proc, setProc] = useState<ProcState | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /* ---- file management ---- */
  const addFiles = useCallback((incoming: FileList | File[]) => {
    setEntries(prev => {
      const existing = new Set(prev.map(e => e.file.name));
      const toAdd = Array.from(incoming)
        .filter(f => !existing.has(f.name))
        .map(f => ({ file: f, checked: false, language: 'english' }));
      return [...prev, ...toAdd].slice(0, MAX_FILES);
    });
  }, []);

  const removeEntry = (name: string) =>
    setEntries(prev => prev.filter(e => e.file.name !== name));

  const toggleCheck = (name: string) =>
    setEntries(prev => prev.map(e => e.file.name === name ? { ...e, checked: !e.checked } : e));

  const setLang = (name: string, lang: string) =>
    setEntries(prev => prev.map(e => e.file.name === name ? { ...e, language: lang } : e));

  const allChecked = entries.length > 0 && entries.every(e => e.checked);

  /* ---- start processing ---- */
  const startProcessing = async () => {
    if (!allChecked) return;
    const n = entries.length;

    const initial: ProcState = {
      statuses: Array(n).fill('pending') as FileStatus[],
      uploadPcts: Array(n).fill(0),
      results: [],
      errorMsg: '',
    };
    setProc(initial);
    setStage('processing');

    // 1. Upload all files (fast, parallel chunks per file, sequential between files)
    const sessions: Array<{ sessionId: string; totalChunks: string; originalName: string; language: string }> = [];

    for (let i = 0; i < n; i++) {
      const { file, language } = entries[i];
      const sessionId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

      setProc(prev => {
        if (!prev) return prev;
        const s = [...prev.statuses];
        s[i] = 'uploading';
        return { ...prev, statuses: s };
      });

      try {
        const totalChunks = await uploadFile(file, sessionId, (pct) => {
          setProc(prev => {
            if (!prev) return prev;
            const u = [...prev.uploadPcts];
            u[i] = pct;
            return { ...prev, uploadPcts: u };
          });
        });

        setProc(prev => {
          if (!prev) return prev;
          const s = [...prev.statuses];
          s[i] = 'queued';
          const u = [...prev.uploadPcts];
          u[i] = 100;
          return { ...prev, statuses: s, uploadPcts: u };
        });

        sessions.push({ sessionId, totalChunks: String(totalChunks), originalName: file.name, language });
      } catch (err) {
        setProc(prev => {
          if (!prev) return prev;
          const s = [...prev.statuses];
          s[i] = 'error';
          return { ...prev, statuses: s, errorMsg: String(err) };
        });
        setStage('setup');
        return;
      }
    }

    // 2. Backend processes one at a time (12s pause between, auto-retry on 429)
    try {
      const res = await fetch('/api/subtitles/process-many', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessions }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(e.error ?? 'Processing failed');
      }
      const data = await res.json() as { srtFiles: SrtResult[] };

      setProc(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          statuses: Array(n).fill('done') as FileStatus[],
          results: data.srtFiles,
        };
      });
      setStage('done');
      setShowQr(true);
    } catch (err) {
      setProc(prev =>
        prev ? { ...prev, errorMsg: err instanceof Error ? err.message : String(err) } : prev,
      );
      setStage('setup');
    }
  };

  const reset = () => { setEntries([]); setStage('setup'); setProc(null); setShowQr(false); };

  const results = proc?.results ?? [];

  // QR encodes a download-page URL with all file download links
  const qrPageUrl = (() => {
    if (results.length === 0) return '';
    const params = new URLSearchParams();
    results.forEach(r => params.append('u', `${window.location.origin}${r.downloadUrl}`));
    return `${window.location.origin}/api/subtitles/download-page?${params.toString()}`;
  })();

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white flex flex-col">

      {/* Header */}
      <div className="border-b border-gray-800 px-6 py-4 flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-lg font-semibold">AI Subtitle Generator</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            Drop up to 5 audio files — processed one at a time by AssemblyAI
          </p>
        </div>
        {stage === 'done' && (
          <button
            onClick={reset}
            className="text-sm text-gray-400 hover:text-white border border-gray-700 rounded-lg px-3 py-1.5 transition-colors"
          >
            Start Over
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto p-6 flex flex-col gap-5">

          {/* ===================== SETUP ===================== */}
          {stage === 'setup' && (
            <>
              {/* Drop zone */}
              <div
                onDrop={(e) => { e.preventDefault(); setIsDragging(false); addFiles(e.dataTransfer.files); }}
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all
                  ${isDragging ? 'border-[#22c55e] bg-[#22c55e]/5' : 'border-gray-700 hover:border-gray-500'}`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="audio/*,video/*"
                  multiple
                  className="hidden"
                  onChange={(e) => { if (e.target.files) addFiles(e.target.files); }}
                />
                <Upload size={32} className="text-gray-500 mx-auto mb-3" />
                <p className="font-medium text-gray-300">Drop audio files here or click to browse</p>
                <p className="text-xs text-gray-500 mt-1">MP3, WAV, MP4, M4A · max {MAX_FILES} files</p>
                {entries.length > 0 && (
                  <p className="text-xs text-[#22c55e] mt-2 font-medium">{entries.length}/{MAX_FILES} added</p>
                )}
              </div>

              {/* File boxes */}
              {entries.map((entry, i) => (
                <div
                  key={entry.file.name}
                  className={`rounded-2xl border p-4 transition-colors
                    ${entry.checked ? 'border-[#22c55e] bg-[#22c55e]/5' : 'border-gray-700 bg-[#111]'}`}
                >
                  <div className="flex items-start gap-3">
                    {/* Checkbox */}
                    <button
                      onClick={() => toggleCheck(entry.file.name)}
                      className={`mt-0.5 w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors
                        ${entry.checked ? 'bg-[#22c55e] border-[#22c55e]' : 'border-gray-600 hover:border-gray-400'}`}
                    >
                      {entry.checked && <CheckCircle size={13} className="text-black" />}
                    </button>

                    <div className="flex-1 min-w-0">
                      {/* File name row */}
                      <div className="flex items-center justify-between gap-2 mb-3">
                        <div className="flex items-center gap-2 min-w-0">
                          <FileAudio size={14} className="text-[#22c55e] shrink-0" />
                          <span className="text-sm font-medium truncate">
                            Audio {i + 1}: {entry.file.name}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-xs text-gray-500">{formatSize(entry.file.size)}</span>
                          <button
                            onClick={() => removeEntry(entry.file.name)}
                            className="text-gray-600 hover:text-red-400 transition-colors"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      </div>

                      {/* Language selectors */}
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">Input language</label>
                          <div className="bg-[#0a0a0a] border border-gray-800 rounded-lg px-3 py-2 text-xs text-gray-500">
                            Auto-detect
                          </div>
                        </div>
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">Output language *</label>
                          <select
                            value={entry.language}
                            onChange={(e) => setLang(entry.file.name, e.target.value)}
                            className="w-full bg-[#0a0a0a] border border-gray-700 rounded-lg px-2 py-2 text-xs text-white focus:outline-none focus:border-[#22c55e] transition-colors"
                          >
                            {LANGUAGES.map(l => (
                              <option key={l.value} value={l.value}>{l.label}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}

              {/* Start section */}
              {entries.length > 0 && (
                <div className="flex flex-col gap-3 pt-1">
                  {!allChecked && (
                    <p className="text-center text-sm text-gray-500">
                      ☑ Tick all boxes above and click START to begin processing
                    </p>
                  )}
                  <button
                    onClick={startProcessing}
                    disabled={!allChecked}
                    className="w-full py-4 rounded-2xl text-base font-bold bg-[#22c55e] text-black hover:bg-[#16a34a] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    ✅ Tick all boxes and click START to begin processing
                  </button>
                </div>
              )}

              {proc?.errorMsg && (
                <div className="flex items-start gap-2 text-sm text-red-400 bg-red-950/30 border border-red-900/40 rounded-xl p-3">
                  <AlertCircle size={16} className="shrink-0 mt-0.5" />
                  <span>{proc.errorMsg}</span>
                </div>
              )}
            </>
          )}

          {/* ===================== PROCESSING ===================== */}
          {stage === 'processing' && proc && (
            <>
              <div className="flex items-center gap-3">
                <Loader2 size={22} className="text-[#22c55e] animate-spin" />
                <div>
                  <p className="font-semibold">Processing your files…</p>
                  <p className="text-xs text-gray-500">One file at a time · 12 s pause between each</p>
                </div>
              </div>

              {entries.map((entry, i) => {
                const status = proc.statuses[i];
                const pct = proc.uploadPcts[i];
                return (
                  <div
                    key={entry.file.name}
                    className={`rounded-2xl border p-4 transition-colors
                      ${status === 'done'    ? 'border-[#22c55e] bg-[#22c55e]/5' :
                        status === 'uploading' || status === 'queued' ? 'border-blue-500 bg-blue-500/5' :
                        status === 'error'   ? 'border-red-500 bg-red-500/5' :
                        'border-gray-800 bg-[#111]'}`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="shrink-0">
                        {status === 'done'     && <CheckCircle size={20} className="text-[#22c55e]" />}
                        {(status === 'uploading' || status === 'queued') && <Loader2 size={20} className="text-blue-400 animate-spin" />}
                        {status === 'pending'  && <div className="w-5 h-5 rounded-full border-2 border-gray-600" />}
                        {status === 'error'    && <AlertCircle size={20} className="text-red-400" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium truncate">{entry.file.name}</span>
                          <span className="text-xs text-gray-400 shrink-0 ml-2">{entry.language}.srt</span>
                        </div>
                        <p className="text-xs text-gray-500">
                          {status === 'pending'  && 'Waiting…'}
                          {status === 'uploading' && `Uploading ${pct}%`}
                          {status === 'queued'   && 'Uploaded — AssemblyAI transcribing…'}
                          {status === 'done'     && 'SRT ready ✓'}
                          {status === 'error'    && 'Failed'}
                        </p>
                        {status === 'uploading' && (
                          <div className="mt-1.5 w-full bg-gray-800 rounded-full h-1">
                            <div
                              className="bg-blue-400 h-1 rounded-full transition-all duration-200"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}

              <p className="text-xs text-gray-600 text-center">
                Automatic 12 s pause between files · rate-limit errors auto-retry after 20 s
              </p>
            </>
          )}

          {/* ===================== DONE ===================== */}
          {stage === 'done' && results.length > 0 && (
            <>
              <div className="flex items-center gap-3">
                <CheckCircle size={28} className="text-[#22c55e]" />
                <div>
                  <p className="font-bold text-lg">{results.length} SRT file{results.length !== 1 ? 's' : ''} ready!</p>
                  <p className="text-xs text-gray-500">Download below or scan the QR to get all files on your phone</p>
                </div>
              </div>

              {/* Individual download buttons */}
              <div className="flex flex-col gap-2">
                {results.map((r) => (
                  <a
                    key={r.srtFileName}
                    href={`${window.location.origin}${r.downloadUrl}`}
                    download={r.srtFileName}
                    className="flex items-center gap-3 w-full py-3.5 px-5 rounded-2xl border border-[#22c55e] text-[#22c55e] hover:bg-[#22c55e]/10 transition-colors font-semibold text-sm"
                  >
                    <Download size={16} />
                    Download {r.srtFileName}
                  </a>
                ))}
              </div>

              {/* Reopen QR button */}
              <button
                onClick={() => setShowQr(true)}
                className="w-full py-3 rounded-2xl border border-gray-700 text-gray-400 hover:text-white hover:border-gray-500 transition-colors text-sm font-medium"
              >
                Show QR code again
              </button>
            </>
          )}

        </div>
      </div>

      {/* QR popup modal */}
      {showQr && qrPageUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
          onClick={() => setShowQr(false)}
        >
          <div
            className="bg-[#111] rounded-2xl p-7 flex flex-col items-center gap-5 shadow-2xl border border-gray-800 w-full max-w-sm"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between w-full">
              <p className="font-semibold text-base">Scan to download on your phone</p>
              <button onClick={() => setShowQr(false)} className="text-gray-500 hover:text-white transition-colors">
                <X size={20} />
              </button>
            </div>
            <div className="bg-white rounded-2xl p-4">
              <QRCodeSVG value={qrPageUrl} size={220} />
            </div>
            <p className="text-xs text-gray-500 text-center">
              Opens a download page with all {results.length} SRT file{results.length !== 1 ? 's' : ''}.<br />
              Files available for 30 minutes.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
