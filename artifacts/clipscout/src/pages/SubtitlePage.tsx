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

type Step = 'idle' | 'compressing' | 'uploading' | 'transcribing' | 'generating' | 'done' | 'error';

interface Result {
  transcript: string;
  srtFileName: string;
  downloadUrl: string;
}

// --- Client-side audio compression via Web Audio API ---
// Resamples any audio file to 16kHz mono WAV (~3MB for a 30min file)
function writeWavHeader(buffer: ArrayBuffer, numChannels: number, sampleRate: number): ArrayBuffer {
  const samples = buffer.byteLength / 2; // 16-bit PCM
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + buffer.byteLength, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * 2, true);
  view.setUint16(32, numChannels * 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, buffer.byteLength, true);
  const combined = new Uint8Array(header.byteLength + buffer.byteLength);
  combined.set(new Uint8Array(header), 0);
  combined.set(new Uint8Array(buffer), 44);
  return combined.buffer;
}

async function compressAudioClientSide(file: File): Promise<File> {
  const TARGET_SAMPLE_RATE = 16000;
  const arrayBuffer = await file.arrayBuffer();

  // Decode with the browser's built-in audio decoder
  const tempCtx = new AudioContext();
  const decoded = await tempCtx.decodeAudioData(arrayBuffer);
  await tempCtx.close();

  // Render to offline context at 16kHz mono
  const numFrames = Math.ceil((decoded.duration * TARGET_SAMPLE_RATE));
  const offlineCtx = new OfflineAudioContext(1, numFrames, TARGET_SAMPLE_RATE);
  const source = offlineCtx.createBufferSource();
  source.buffer = decoded;
  source.connect(offlineCtx.destination);
  source.start(0);
  const rendered = await offlineCtx.startRendering();

  // Convert float32 PCM to int16
  const channelData = rendered.getChannelData(0);
  const int16 = new Int16Array(channelData.length);
  for (let i = 0; i < channelData.length; i++) {
    const s = Math.max(-1, Math.min(1, channelData[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }

  const wavBuffer = writeWavHeader(int16.buffer, 1, TARGET_SAMPLE_RATE);
  const blob = new Blob([wavBuffer], { type: 'audio/wav' });
  return new File([blob], 'compressed.wav', { type: 'audio/wav' });
}

function StepIndicator({ step }: { step: Step }) {
  const steps = [
    { id: 'compressing', label: 'Step 1: Compressing in browser' },
    { id: 'uploading', label: 'Step 2: Uploading' },
    { id: 'transcribing', label: 'Step 3: Transcribing with AI' },
    { id: 'generating', label: 'Step 4: Generating SRT' },
  ];

  const stepOrder: Step[] = ['compressing', 'uploading', 'transcribing', 'generating', 'done'];
  const currentIndex = stepOrder.indexOf(step);

  return (
    <div className="flex flex-col gap-2 my-4">
      {steps.map((s) => {
        const stepIdx = stepOrder.indexOf(s.id as Step);
        const isDone = currentIndex > stepIdx;
        const isActive = currentIndex === stepIdx;
        return (
          <div key={s.id} className="flex items-center gap-2 text-sm">
            {isDone ? (
              <CheckCircle size={16} className="text-[#22c55e] shrink-0" />
            ) : isActive ? (
              <Loader2 size={16} className="text-[#22c55e] animate-spin shrink-0" />
            ) : (
              <div className="w-4 h-4 rounded-full border border-gray-600 shrink-0" />
            )}
            <span className={isDone || isActive ? 'text-white' : 'text-gray-500'}>
              {s.label}{isActive ? '...' : ''}
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
  const [result, setResult] = useState<Result | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = (f: File) => {
    setFile(f);
    setResult(null);
    setStep('idle');
    setErrorMsg('');
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

    try {
      // Always compress in the browser to keep upload size small
      setStep('compressing');
      let uploadFile = file;
      const fileSizeMB = file.size / (1024 * 1024);
      if (fileSizeMB > 5) {
        uploadFile = await compressAudioClientSide(file);
      }

      setStep('uploading');
      const form = new FormData();
      form.append('audio', uploadFile, uploadFile.name);
      form.append('language', language);

      const res = await fetch('/api/subtitles/process', {
        method: 'POST',
        body: form,
      });

      setStep('transcribing');

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error((err as { error?: string }).error ?? 'Unknown error');
      }

      setStep('generating');
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
        <p className="text-sm text-gray-400 mt-0.5">Upload audio or video — compressed in your browser, then transcribed by AI</p>
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
              {LANGUAGES.map((l) => (
                <option key={l.value} value={l.value}>{l.label}</option>
              ))}
            </select>
            <p className="text-xs text-gray-500 mt-1">
              "English" translates everything to English. Others transcribe natively.
            </p>
          </div>

          {/* Process button */}
          <button
            onClick={process}
            disabled={!file || isProcessing}
            className="w-full py-2.5 rounded-xl text-sm font-semibold bg-[#22c55e] text-black hover:bg-[#16a34a] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {isProcessing ? 'Processing...' : 'Generate Subtitles'}
          </button>

          {/* Step progress */}
          {step !== 'idle' && step !== 'error' && <StepIndicator step={step} />}

          {/* Error */}
          {step === 'error' && (
            <div className="flex items-start gap-2 text-sm text-red-400 bg-red-950/30 border border-red-900/40 rounded-xl p-3">
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* QR + Download */}
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
                  {step === 'compressing' && 'Compressing audio in your browser — no upload needed yet...'}
                  {step === 'uploading' && 'Uploading compressed file...'}
                  {step === 'transcribing' && 'Groq Whisper is transcribing your audio...'}
                  {step === 'generating' && 'Building SRT file...'}
                </p>
              </div>
            )}
            {result && (
              <div className="prose prose-invert max-w-none">
                <p className="text-gray-200 leading-relaxed whitespace-pre-wrap text-sm">{result.transcript}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
