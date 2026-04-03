import { useState, useRef, useCallback } from 'react';
import { Upload, FileAudio, Download, CheckCircle, Loader2, AlertCircle, X } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';

const LANGUAGES = [
  { value: 'english', label: 'English' },
  { value: 'es', label: 'Spanish' },
  { value: 'hi', label: 'Hindi' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'ja', label: 'Japanese' },
  { value: 'zh', label: 'Chinese' },
  { value: 'ar', label: 'Arabic' },
  { value: 'ko', label: 'Korean' },
];

const MAX_FILES = 5;
const CHUNK_SIZE = 256 * 1024;
const PARALLEL_CHUNKS = 4;

type OverallStep = 'idle' | 'uploading' | 'processing' | 'done' | 'error';

interface SrtFile {
  srtFileName: string;
  downloadUrl: string;
}

interface FileProgress {
  name: string;
  size: number;
  uploadPct: number;
  uploaded: boolean;
}

async function encodeChunk(file: File, index: number, total: number): Promise<string> {
  const start = index * CHUNK_SIZE;
  const chunk = file.slice(start, start + CHUNK_SIZE);
  const arrayBuffer = await chunk.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = '';
  for (let j = 0; j < bytes.byteLength; j++) binary += String.fromCharCode(bytes[j]);
  return btoa(binary);
}

async function sendChunk(sessionId: string, chunkIndex: number, totalChunks: number, b64: string): Promise<void> {
  const res = await fetch('/api/subtitles/chunk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, chunkIndex, totalChunks, data: b64 }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? 'Chunk upload failed');
  }
}

async function uploadFileInChunks(
  file: File,
  sessionId: string,
  onProgress: (pct: number) => void,
): Promise<number> {
  const total = Math.ceil(file.size / CHUNK_SIZE);
  let done = 0;

  for (let batch = 0; batch < total; batch += PARALLEL_CHUNKS) {
    const indices = Array.from({ length: Math.min(PARALLEL_CHUNKS, total - batch) }, (_, k) => batch + k);
    await Promise.all(
      indices.map(async (i) => {
        const b64 = await encodeChunk(file, i, total);
        await sendChunk(sessionId, i, total, b64);
        done++;
        onProgress(Math.round((done / total) * 100));
      }),
    );
  }
  return total;
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function SubtitlePage() {
  const [files, setFiles] = useState<File[]>([]);
  const [language, setLanguage] = useState('english');
  const [step, setStep] = useState<OverallStep>('idle');
  const [fileProgress, setFileProgress] = useState<FileProgress[]>([]);
  const [srtFiles, setSrtFiles] = useState<SrtFile[]>([]);
  const [errorMsg, setErrorMsg] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addFiles = (incoming: FileList | File[]) => {
    setFiles(prev => {
      const existing = new Set(prev.map(f => f.name));
      const toAdd = Array.from(incoming).filter(f => !existing.has(f.name));
      return [...prev, ...toAdd].slice(0, MAX_FILES);
    });
  };

  const removeFile = (name: string) => setFiles(prev => prev.filter(f => f.name !== name));

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    addFiles(e.dataTransfer.files);
  }, []);

  const process = async () => {
    if (files.length === 0) return;
    setErrorMsg('');
    setSrtFiles([]);
    setQrOpen(false);

    const progress: FileProgress[] = files.map(f => ({
      name: f.name,
      size: f.size,
      uploadPct: 0,
      uploaded: false,
    }));
    setFileProgress(progress);
    setStep('uploading');

    try {
      const sessions: Array<{ sessionId: string; totalChunks: string; originalName: string }> = [];

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const sessionId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

        const totalChunks = await uploadFileInChunks(file, sessionId, (pct) => {
          setFileProgress(prev => prev.map((p, idx) => idx === i ? { ...p, uploadPct: pct } : p));
        });

        setFileProgress(prev => prev.map((p, idx) => idx === i ? { ...p, uploaded: true } : p));
        sessions.push({ sessionId, totalChunks: String(totalChunks), originalName: file.name });
      }

      setStep('processing');

      const res = await fetch('/api/subtitles/process-many', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessions, language }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error((err as { error?: string }).error ?? 'Processing failed');
      }

      const data = await res.json() as { srtFiles: SrtFile[] };
      setSrtFiles(data.srtFiles);
      setStep('done');
      setQrOpen(true);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Something went wrong');
      setStep('error');
    }
  };

  const isProcessing = step === 'uploading' || step === 'processing';
  const qrSize = srtFiles.length > 2 ? 140 : 200;

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      <div className="border-b border-gray-800 px-6 py-4">
        <h1 className="text-lg font-semibold">AI Subtitle Generator</h1>
        <p className="text-sm text-gray-400 mt-0.5">Upload up to 5 audio files — transcribed by AssemblyAI</p>
      </div>

      <div className="flex flex-col lg:flex-row gap-0 h-[calc(100vh-73px)]">
        {/* Left panel */}
        <div className="lg:w-96 shrink-0 border-r border-gray-800 p-6 flex flex-col gap-5 overflow-y-auto">

          {/* Drop zone */}
          <div
            onDrop={onDrop}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onClick={() => !isProcessing && fileInputRef.current?.click()}
            className={`relative border-2 border-dashed rounded-xl p-6 transition-colors text-center
              ${isProcessing ? 'cursor-default opacity-50' : 'cursor-pointer hover:border-gray-500'}
              ${isDragging ? 'border-[#22c55e] bg-[#22c55e]/5' : 'border-gray-700'}`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*,video/*"
              multiple
              className="hidden"
              onChange={(e) => { if (e.target.files) addFiles(e.target.files); }}
            />
            <Upload size={28} className="text-gray-500 mx-auto mb-2" />
            <p className="text-sm font-medium text-gray-300">Drop up to {MAX_FILES} audio files</p>
            <p className="text-xs text-gray-500 mt-1">MP3, WAV, MP4, M4A and more</p>
            {files.length > 0 && (
              <p className="text-xs text-[#22c55e] mt-2">{files.length}/{MAX_FILES} added</p>
            )}
          </div>

          {/* File list */}
          {files.length > 0 && (
            <ul className="space-y-2">
              {files.map((file, i) => {
                const prog = fileProgress[i];
                return (
                  <li key={file.name} className="bg-[#1a1a1a] rounded-xl px-4 py-3 border border-gray-800">
                    <div className="flex items-center gap-2 mb-1.5">
                      <FileAudio size={14} className="text-[#22c55e] shrink-0" />
                      <span className="text-sm text-white truncate flex-1">{file.name}</span>
                      <span className="text-xs text-gray-500 shrink-0">{formatSize(file.size)}</span>
                      {!isProcessing && (
                        <button onClick={() => removeFile(file.name)} className="text-gray-600 hover:text-red-400 transition-colors">
                          <X size={13} />
                        </button>
                      )}
                      {prog?.uploaded && <CheckCircle size={13} className="text-[#22c55e] shrink-0" />}
                    </div>
                    {prog && (
                      <div className="w-full bg-gray-800 rounded-full h-1">
                        <div
                          className="bg-[#22c55e] h-1 rounded-full transition-all duration-200"
                          style={{ width: `${prog.uploaded ? 100 : prog.uploadPct}%` }}
                        />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {/* Language */}
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">Output Language</label>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              disabled={isProcessing}
              className="w-full bg-[#1a1a1a] border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#22c55e] transition-colors disabled:opacity-50"
            >
              {LANGUAGES.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
            </select>
          </div>

          {/* Generate button */}
          <button
            onClick={process}
            disabled={files.length === 0 || isProcessing}
            className="w-full py-2.5 rounded-xl text-sm font-semibold bg-[#22c55e] text-black hover:bg-[#16a34a] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {isProcessing ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 size={15} className="animate-spin" />
                {step === 'uploading' ? 'Uploading...' : 'Transcribing with AssemblyAI...'}
              </span>
            ) : `Generate Subtitle${files.length > 1 ? `s (${files.length} files)` : ''}`}
          </button>

          {step === 'error' && (
            <div className="flex items-start gap-2 text-sm text-red-400 bg-red-950/30 border border-red-900/40 rounded-xl p-3">
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {step === 'done' && srtFiles.length > 0 && (
            <div className="flex flex-col gap-2 pt-2 border-t border-gray-800">
              {srtFiles.map((f) => (
                <a
                  key={f.srtFileName}
                  href={`${window.location.origin}${f.downloadUrl}`}
                  download={f.srtFileName}
                  className="flex items-center gap-2 w-full justify-center py-2 rounded-xl text-sm font-semibold border border-[#22c55e] text-[#22c55e] hover:bg-[#22c55e]/10 transition-colors"
                >
                  <Download size={14} />
                  {f.srtFileName}
                </a>
              ))}
              <button
                onClick={() => setQrOpen(true)}
                className="text-xs text-gray-400 hover:text-white transition-colors text-center py-1"
              >
                Show QR code{srtFiles.length > 1 ? 's' : ''} again
              </button>
            </div>
          )}
        </div>

        {/* Right panel — status */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="border-b border-gray-800 px-6 py-3">
            <span className="text-sm font-medium text-gray-300">
              {step === 'idle' && 'Ready'}
              {step === 'uploading' && 'Uploading files...'}
              {step === 'processing' && 'Transcribing...'}
              {step === 'done' && `${srtFiles.length} file${srtFiles.length !== 1 ? 's' : ''} ready`}
              {step === 'error' && 'Error'}
            </span>
          </div>
          <div className="flex-1 flex flex-col items-center justify-center gap-4 p-6">
            {step === 'idle' && (
              <>
                <FileAudio size={44} className="text-gray-700" />
                <p className="text-gray-500 text-sm text-center">
                  Add up to 5 audio files and click Generate.<br />
                  No compression — your original file goes straight to AssemblyAI.
                </p>
              </>
            )}
            {step === 'uploading' && (
              <>
                <Loader2 size={36} className="text-[#22c55e] animate-spin" />
                <p className="text-gray-400 text-sm">Uploading in chunks...</p>
                <div className="w-full max-w-xs space-y-1.5">
                  {fileProgress.map((fp) => (
                    <div key={fp.name} className="flex items-center justify-between text-xs text-gray-500">
                      <span className="truncate max-w-[200px]">{fp.name}</span>
                      <span className="shrink-0 ml-2 text-[#22c55e]">
                        {fp.uploaded ? '✓ done' : `${fp.uploadPct}%`}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
            {step === 'processing' && (
              <>
                <Loader2 size={36} className="text-[#22c55e] animate-spin" />
                <p className="text-gray-400 text-sm">AssemblyAI is transcribing your audio...</p>
                <p className="text-gray-600 text-xs">Usually takes 1–3 minutes</p>
              </>
            )}
            {step === 'done' && (
              <>
                <CheckCircle size={44} className="text-[#22c55e]" />
                <p className="text-white font-semibold text-lg">
                  {srtFiles.length} SRT file{srtFiles.length !== 1 ? 's' : ''} ready!
                </p>
                <p className="text-gray-500 text-sm">Scan the QR code{srtFiles.length > 1 ? 's' : ''} to download on your phone</p>
              </>
            )}
            {step === 'error' && (
              <AlertCircle size={44} className="text-red-400" />
            )}
          </div>
        </div>
      </div>

      {/* QR popup — one QR per SRT file */}
      {qrOpen && srtFiles.length > 0 && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
          onClick={() => setQrOpen(false)}
        >
          <div
            className="bg-[#111] rounded-2xl p-6 flex flex-col items-center gap-5 shadow-2xl border border-gray-800 max-h-[90vh] overflow-y-auto w-full max-w-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between w-full">
              <p className="text-white font-semibold">
                Scan to download{srtFiles.length > 1 ? ` (${srtFiles.length} files)` : ''}
              </p>
              <button onClick={() => setQrOpen(false)} className="text-gray-500 hover:text-white transition-colors">
                <X size={18} />
              </button>
            </div>

            <div className={`grid gap-6 w-full ${srtFiles.length > 1 ? 'grid-cols-2' : 'grid-cols-1 place-items-center'}`}>
              {srtFiles.map((f) => (
                <div key={f.srtFileName} className="flex flex-col items-center gap-3">
                  <div className="bg-white rounded-xl p-3">
                    <QRCodeSVG
                      value={`${window.location.origin}${f.downloadUrl}`}
                      size={qrSize}
                    />
                  </div>
                  <p className="text-xs text-gray-400 text-center max-w-[160px] truncate">{f.srtFileName}</p>
                  <a
                    href={`${window.location.origin}${f.downloadUrl}`}
                    download={f.srtFileName}
                    className="flex items-center gap-1.5 text-xs font-semibold border border-[#22c55e] text-[#22c55e] hover:bg-[#22c55e]/10 transition-colors px-4 py-2 rounded-lg"
                  >
                    <Download size={12} />
                    Download .srt
                  </a>
                </div>
              ))}
            </div>

            <p className="text-xs text-gray-600">Files auto-delete after download or in 15 minutes</p>
          </div>
        </div>
      )}
    </div>
  );
}
