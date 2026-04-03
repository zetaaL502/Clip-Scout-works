import { useState, useRef, useCallback } from 'react';
import { Upload, FileAudio, Download, CheckCircle, Loader2, AlertCircle } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';

const LANGUAGES = [
  { value: 'english', label: 'English (Translated)' },
  { value: 'spanish', label: 'Spanish' },
  { value: 'hindi', label: 'Hindi' },
  { value: 'french', label: 'French' },
  { value: 'german', label: 'German' },
  { value: 'portuguese', label: 'Portuguese' },
  { value: 'japanese', label: 'Japanese' },
  { value: 'chinese', label: 'Chinese' },
  { value: 'arabic', label: 'Arabic' },
  { value: 'korean', label: 'Korean' },
];

const CHUNK_SIZE = 50 * 1024; // 50KB binary per chunk → ~68KB base64 JSON body — safely under all proxy limits

type Step = 'idle' | 'compressing' | 'uploading' | 'processing' | 'done' | 'error';

interface Result {
  transcript: string;
  srtFileName: string;
  downloadUrl: string;
}

// --- Client-side audio compression ---
// Decodes any audio file and resamples to 16kHz mono WAV
function writeWavHeader(pcmBuffer: ArrayBuffer, sampleRate: number): ArrayBuffer {
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + pcmBuffer.byteLength, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, pcmBuffer.byteLength, true);
  const out = new Uint8Array(44 + pcmBuffer.byteLength);
  out.set(new Uint8Array(header), 0);
  out.set(new Uint8Array(pcmBuffer), 44);
  return out.buffer;
}

async function compressInBrowser(file: File): Promise<ArrayBuffer> {
  const TARGET_RATE = 16000;
  const raw = await file.arrayBuffer();
  const tempCtx = new AudioContext();
  const decoded = await tempCtx.decodeAudioData(raw);
  await tempCtx.close();

  const frames = Math.ceil(decoded.duration * TARGET_RATE);
  const offline = new OfflineAudioContext(1, frames, TARGET_RATE);
  const src = offline.createBufferSource();
  src.buffer = decoded;
  src.connect(offline.destination);
  src.start(0);
  const rendered = await offline.startRendering();

  const floats = rendered.getChannelData(0);
  const int16 = new Int16Array(floats.length);
  for (let i = 0; i < floats.length; i++) {
    const s = Math.max(-1, Math.min(1, floats[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return writeWavHeader(int16.buffer, TARGET_RATE);
}

// --- Chunked upload (JSON + base64 to avoid proxy multipart limits) ---
async function uploadInChunks(
  data: ArrayBuffer,
  sessionId: string,
  onProgress: (pct: number) => void,
): Promise<void> {
  const total = Math.ceil(data.byteLength / CHUNK_SIZE);
  for (let i = 0; i < total; i++) {
    const start = i * CHUNK_SIZE;
    const chunkBytes = new Uint8Array(data, start, Math.min(CHUNK_SIZE, data.byteLength - start));
    // encode binary → base64 string
    let binary = '';
    for (let j = 0; j < chunkBytes.byteLength; j++) binary += String.fromCharCode(chunkBytes[j]);
    const b64 = btoa(binary);
    const res = await fetch('/api/subtitles/chunk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, chunkIndex: i, totalChunks: total, data: b64 }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error((err as { error?: string }).error ?? 'Chunk upload failed');
    }
    onProgress(Math.round(((i + 1) / total) * 100));
  }
}

function StepIndicator({ step, uploadPct }: { step: Step; uploadPct: number }) {
  const steps: { id: Step; label: string }[] = [
    { id: 'compressing', label: 'Step 1: Compressing in browser' },
    { id: 'uploading', label: `Step 2: Uploading${step === 'uploading' ? ` (${uploadPct}%)` : ''}` },
    { id: 'processing', label: 'Step 3: Transcribing & building SRT' },
  ];
  const order: Step[] = ['compressing', 'uploading', 'processing', 'done'];
  const cur = order.indexOf(step);
  return (
    <div className="flex flex-col gap-2 my-4">
      {steps.map((s) => {
        const idx = order.indexOf(s.id);
        const done = cur > idx;
        const active = cur === idx;
        return (
          <div key={s.id} className="flex items-center gap-2 text-sm">
            {done ? (
              <CheckCircle size={16} className="text-[#22c55e] shrink-0" />
            ) : active ? (
              <Loader2 size={16} className="text-[#22c55e] animate-spin shrink-0" />
            ) : (
              <div className="w-4 h-4 rounded-full border border-gray-600 shrink-0" />
            )}
            <span className={done || active ? 'text-white' : 'text-gray-500'}>
              {s.label}{active ? '...' : ''}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function SubtitlePage() {
  const [file, setFile] = useState<File | null>(null);
  const [language, setLanguage] = useState('english');
  const [step, setStep] = useState<Step>('idle');
  const [uploadPct, setUploadPct] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = (f: File) => {
    setFile(f);
    setResult(null);
    setStep('idle');
    setErrorMsg('');
    setUploadPct(0);
  };

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) handleFile(dropped);
  }, []);

  const onDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
  const onDragLeave = () => setIsDragging(false);

  const process = async () => {
    if (!file) return;
    setErrorMsg('');
    setResult(null);
    setUploadPct(0);

    try {
      // Step 1: compress in browser
      setStep('compressing');
      const compressed = await compressInBrowser(file);
      const compressedMB = (compressed.byteLength / (1024 * 1024)).toFixed(1);
      console.log(`Compressed to ${compressedMB} MB`);

      // Step 2: chunked upload
      setStep('uploading');
      const sessionId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const totalChunks = Math.ceil(compressed.byteLength / CHUNK_SIZE);
      await uploadInChunks(compressed, sessionId, setUploadPct);

      // Step 3: tell server to assemble + transcribe
      setStep('processing');
      const res = await fetch('/api/subtitles/process-chunks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, totalChunks: String(totalChunks), language }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error((err as { error?: string }).error ?? 'Processing failed');
      }

      const data = (await res.json()) as Result;
      setResult(data);
      setStep('done');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Something went wrong');
      setStep('error');
    }
  };

  const downloadUrl = result ? `${window.location.origin}${result.downloadUrl}` : '';

  const downloadSrt = () => {
    if (!result) return;
    const a = document.createElement('a');
    a.href = result.downloadUrl;
    a.download = result.srtFileName;
    a.click();
  };

  const isProcessing = step !== 'idle' && step !== 'done' && step !== 'error';

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      <div className="border-b border-gray-800 px-6 py-4">
        <h1 className="text-lg font-semibold">AI Subtitle Generator</h1>
        <p className="text-sm text-gray-400 mt-0.5">Upload any audio — compressed in browser, uploaded in chunks, transcribed by AI</p>
      </div>

      <div className="flex flex-col lg:flex-row gap-0 h-[calc(100vh-73px)]">
        {/* Left panel */}
        <div className="lg:w-96 shrink-0 border-r border-gray-800 p-6 flex flex-col gap-5 overflow-y-auto">

          {/* Drop zone */}
          <div
            onDrop={onDrop}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onClick={() => fileInputRef.current?.click()}
            className={`relative border-2 border-dashed rounded-xl p-6 cursor-pointer transition-colors text-center
              ${isDragging ? 'border-[#22c55e] bg-[#22c55e]/5' : 'border-gray-700 hover:border-gray-500'}`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*,video/*"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
            />
            {file ? (
              <div className="flex flex-col items-center gap-2">
                <FileAudio size={32} className="text-[#22c55e]" />
                <p className="text-sm font-medium text-white truncate max-w-[200px]">{file.name}</p>
                <p className="text-xs text-gray-400">{(file.size / (1024 * 1024)).toFixed(1)} MB</p>
                <p className="text-xs text-gray-500">Click to change file</p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <Upload size={32} className="text-gray-500" />
                <p className="text-sm font-medium text-gray-300">Drop audio or video file here</p>
                <p className="text-xs text-gray-500">WAV, MP3, MP4, M4A and more · Any size</p>
              </div>
            )}
          </div>

          {/* Language */}
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">Output Language</label>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="w-full bg-[#1a1a1a] border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#22c55e] transition-colors"
            >
              {LANGUAGES.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
            </select>
            <p className="text-xs text-gray-500 mt-1">"English" translates everything to English. Others transcribe natively.</p>
          </div>

          {/* Process button */}
          <button
            onClick={process}
            disabled={!file || isProcessing}
            className="w-full py-2.5 rounded-xl text-sm font-semibold bg-[#22c55e] text-black hover:bg-[#16a34a] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {isProcessing ? 'Processing...' : 'Generate Subtitles'}
          </button>

          {step !== 'idle' && step !== 'error' && <StepIndicator step={step} uploadPct={uploadPct} />}

          {step === 'error' && (
            <div className="flex items-start gap-2 text-sm text-red-400 bg-red-950/30 border border-red-900/40 rounded-xl p-3">
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {step === 'done' && result && (
            <div className="flex flex-col items-center gap-4 pt-2 border-t border-gray-800">
              <p className="text-xs text-gray-400 text-center">Scan to download on mobile</p>
              <div className="bg-white p-3 rounded-xl">
                <QRCodeSVG value={downloadUrl} size={140} />
              </div>
              <button
                onClick={downloadSrt}
                className="flex items-center gap-2 w-full justify-center py-2.5 rounded-xl text-sm font-semibold border border-[#22c55e] text-[#22c55e] hover:bg-[#22c55e]/10 transition-colors"
              >
                <Download size={16} />
                Download {result.srtFileName}
              </button>
              <p className="text-xs text-gray-500 text-center">File auto-deletes after download or in 10 minutes</p>
            </div>
          )}
        </div>

        {/* Right panel */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="border-b border-gray-800 px-6 py-3 flex items-center gap-2">
            <span className="text-sm font-medium text-gray-300">Live Script Preview</span>
            {step === 'done' && (
              <span className="ml-auto text-xs text-[#22c55e] flex items-center gap-1">
                <CheckCircle size={12} /> Done
              </span>
            )}
          </div>
          <div className="flex-1 overflow-y-auto p-6">
            {!result && step === 'idle' && (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
                <FileAudio size={40} className="text-gray-700" />
                <p className="text-gray-500 text-sm">Your transcript will appear here once processing is complete.</p>
              </div>
            )}
            {isProcessing && (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
                <Loader2 size={32} className="text-[#22c55e] animate-spin" />
                <p className="text-gray-400 text-sm">
                  {step === 'compressing' && 'Compressing audio in your browser...'}
                  {step === 'uploading' && `Uploading chunks... ${uploadPct}%`}
                  {step === 'processing' && 'Transcribing with Groq Whisper...'}
                </p>
              </div>
            )}
            {result && (
              <p className="text-gray-200 leading-relaxed whitespace-pre-wrap text-sm">{result.transcript}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
