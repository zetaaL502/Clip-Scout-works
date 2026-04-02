import { useState, useRef, useCallback } from 'react';
import { Upload, FileAudio, FileText, X, Send, Clock } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';

interface UploadedTransfer {
  transferId: string;
  originalName: string;
  fileCount: number;
}

const ALLOWED_EXTS = ['.mp3', '.wav', '.srt'];
const ALLOWED_MIME = ['audio/mpeg', 'audio/wav', 'audio/x-wav', 'text/plain', 'application/x-subrip', 'application/octet-stream'];

function getFileIcon(name: string) {
  const ext = name.split('.').pop()?.toLowerCase();
  if (ext === 'srt') return FileText;
  return FileAudio;
}

function isAllowed(file: File): boolean {
  const ext = '.' + (file.name.split('.').pop()?.toLowerCase() ?? '');
  return ALLOWED_EXTS.includes(ext) || ALLOWED_MIME.includes(file.type);
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function QuickSendPage() {
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transfer, setTransfer] = useState<UploadedTransfer | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback((incoming: FileList | File[]) => {
    const valid = Array.from(incoming).filter(isAllowed);
    const invalid = Array.from(incoming).filter((f) => !isAllowed(f));
    if (invalid.length > 0) {
      setError(`Unsupported file(s): ${invalid.map((f) => f.name).join(', ')}. Only .mp3, .wav, .srt allowed.`);
    } else {
      setError(null);
    }
    if (valid.length > 0) {
      setFiles((prev) => {
        const names = new Set(prev.map((f) => f.name));
        return [...prev, ...valid.filter((f) => !names.has(f.name))];
      });
    }
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    addFiles(e.dataTransfer.files);
  }, [addFiles]);

  const onDragOver = (e: React.DragEvent) => { e.preventDefault(); setDragging(true); };
  const onDragLeave = () => setDragging(false);

  const removeFile = (name: string) => {
    setFiles((prev) => prev.filter((f) => f.name !== name));
  };

  const handleUpload = async () => {
    if (files.length === 0 || uploading) return;
    setUploading(true);
    setError(null);

    const form = new FormData();
    files.forEach((f) => form.append('files', f));

    try {
      const res = await fetch('/api/transfers/upload', { method: 'POST', body: form });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Upload failed' })) as { error?: string };
        throw new Error(body.error ?? 'Upload failed');
      }
      const data = await res.json() as UploadedTransfer;
      setTransfer(data);
      setFiles([]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const downloadUrl = transfer
    ? `${window.location.origin}/api/transfers/download/${transfer.transferId}`
    : '';

  const reset = () => {
    setTransfer(null);
    setFiles([]);
    setError(null);
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      <div className="sticky top-0 z-30 bg-[#0a0a0a]/95 backdrop-blur border-b border-gray-800">
        <div className="flex items-center gap-3 px-4 py-3 sm:px-6">
          <Send size={18} className="text-[#22c55e]" />
          <span className="font-black text-white text-lg">Quick Send</span>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-10 sm:px-6">
        {!transfer ? (
          <>
            <p className="text-gray-400 text-sm mb-6 text-center">
              Upload .mp3, .wav, or .srt files and get a QR code to download them on any device.
            </p>

            {/* Drop zone */}
            <div
              onClick={() => inputRef.current?.click()}
              onDrop={onDrop}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              className={`relative rounded-2xl border-2 border-dashed transition-colors cursor-pointer p-10 text-center
                ${dragging
                  ? 'border-[#22c55e] bg-[#22c55e]/5'
                  : 'border-gray-700 hover:border-gray-500 bg-[#111]'
                }`}
            >
              <input
                ref={inputRef}
                type="file"
                multiple
                accept=".mp3,.wav,.srt"
                className="hidden"
                onChange={(e) => e.target.files && addFiles(e.target.files)}
              />
              <Upload size={32} className="mx-auto mb-3 text-gray-500" />
              <p className="text-white font-semibold mb-1">Drag & drop files here</p>
              <p className="text-gray-500 text-sm">or click to browse</p>
              <p className="text-gray-600 text-xs mt-2">.mp3 · .wav · .srt</p>
            </div>

            {/* File list */}
            {files.length > 0 && (
              <ul className="mt-4 space-y-2">
                {files.map((file) => {
                  const Icon = getFileIcon(file.name);
                  return (
                    <li key={file.name} className="flex items-center gap-3 bg-[#111] rounded-xl px-4 py-3 border border-gray-800">
                      <Icon size={16} className="text-gray-400 shrink-0" />
                      <span className="text-sm text-white flex-1 truncate">{file.name}</span>
                      <span className="text-xs text-gray-500 shrink-0">{formatSize(file.size)}</span>
                      <button onClick={() => removeFile(file.name)} className="text-gray-600 hover:text-red-400 transition-colors shrink-0">
                        <X size={14} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            {error && (
              <p className="mt-4 text-red-400 text-sm text-center">{error}</p>
            )}

            <button
              onClick={handleUpload}
              disabled={files.length === 0 || uploading}
              className="mt-6 w-full flex items-center justify-center gap-2 bg-[#22c55e] disabled:bg-gray-700 disabled:text-gray-500 text-white font-semibold py-3 px-4 rounded-xl transition-colors active:scale-95"
            >
              {uploading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Uploading…
                </>
              ) : (
                <>
                  <Send size={16} />
                  Generate QR Code
                  {files.length > 1 && <span className="text-xs opacity-75">(will ZIP {files.length} files)</span>}
                </>
              )}
            </button>
          </>
        ) : (
          <div className="text-center">
            <p className="text-white font-semibold text-lg mb-1">Ready to scan</p>
            <p className="text-gray-400 text-sm mb-6">
              {transfer.fileCount > 1
                ? `${transfer.fileCount} files bundled into a ZIP`
                : transfer.originalName}
            </p>

            <div className="bg-white rounded-2xl p-4 inline-block mb-6">
              <QRCodeSVG value={downloadUrl} size={220} />
            </div>

            <div className="flex items-center justify-center gap-1.5 text-amber-400 text-xs mb-8">
              <Clock size={13} />
              <span>Link expires in 20 minutes</span>
            </div>

            <a
              href={downloadUrl}
              className="block w-full text-center bg-gray-800 hover:bg-gray-700 text-white font-semibold py-3 px-4 rounded-xl transition-colors mb-3 text-sm"
              download
            >
              Download on this device
            </a>

            <button
              onClick={reset}
              className="w-full text-center text-gray-400 hover:text-white transition-colors text-sm py-2"
            >
              Send another file
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
