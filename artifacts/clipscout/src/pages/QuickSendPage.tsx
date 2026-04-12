import { useState, useRef, useCallback, useEffect } from "react";
import {
  Upload,
  FileAudio,
  FileText,
  X,
  Send,
  Clock,
  Wifi,
  Download,
  Smartphone,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";

interface UploadedTransfer {
  transferId: string;
  originalName: string;
  fileCount: number;
}

interface IncomingFile {
  id: string;
  originalName: string;
  size: number;
  receivedAt: number;
}

const ALLOWED_EXTS = [".mp3", ".wav", ".srt"];
const ALLOWED_MIME = [
  "audio/mpeg",
  "audio/wav",
  "audio/x-wav",
  "text/plain",
  "application/x-subrip",
  "application/octet-stream",
];

function getFileIcon(name: string) {
  const ext = name.split(".").pop()?.toLowerCase();
  if (ext === "srt") return FileText;
  return FileAudio;
}

function isAllowed(file: File): boolean {
  const ext = "." + (file.name.split(".").pop()?.toLowerCase() ?? "");
  return ALLOWED_EXTS.includes(ext) || ALLOWED_MIME.includes(file.type);
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function QuickSendPage() {
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transfer, setTransfer] = useState<UploadedTransfer | null>(null);
  const [mode, setMode] = useState<"send" | "receive">("send");
  const [receiveMode, setReceiveMode] = useState(false);
  const [incomingFiles, setIncomingFiles] = useState<IncomingFile[]>([]);
  const [showDownloadPopup, setShowDownloadPopup] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevIncomingRef = useRef<IncomingFile[]>([]);

  useEffect(() => {
    if (receiveMode) {
      pollingRef.current = setInterval(async () => {
        try {
          const res = await fetch("/api/transfers/incoming");
          if (res.ok) {
            const data = (await res.json()) as { files: IncomingFile[] };
            const newFiles = data.files.filter(
              (f) => !prevIncomingRef.current.some((prev) => prev.id === f.id),
            );
            if (newFiles.length > 0) {
              setIncomingFiles((prev) => {
                const existingIds = new Set(prev.map((p) => p.id));
                const toAdd = newFiles.filter((f) => !existingIds.has(f.id));
                return [...prev, ...toAdd];
              });
              prevIncomingRef.current = data.files;
              setShowDownloadPopup(true);
            } else {
              setIncomingFiles(data.files);
              prevIncomingRef.current = data.files;
            }
          }
        } catch (err) {
          console.error("Polling error:", err);
        }
      }, 2000);
    } else {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    }
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
    };
  }, [receiveMode]);

  const addFiles = useCallback((incoming: FileList | File[]) => {
    const valid = Array.from(incoming).filter(isAllowed);
    const invalid = Array.from(incoming).filter((f) => !isAllowed(f));
    if (invalid.length > 0) {
      setError(
        `Unsupported file(s): ${invalid.map((f) => f.name).join(", ")}. Only .mp3, .wav, .srt allowed.`,
      );
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

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      addFiles(e.dataTransfer.files);
    },
    [addFiles],
  );

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(true);
  };
  const onDragLeave = () => setDragging(false);

  const removeFile = (name: string) => {
    setFiles((prev) => prev.filter((f) => f.name !== name));
  };

  const handleUpload = async () => {
    if (files.length === 0 || uploading) return;
    setUploading(true);
    setError(null);

    const form = new FormData();
    files.forEach((f) => form.append("files", f));

    try {
      const res = await fetch("/api/transfers/upload", {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const body = (await res
          .json()
          .catch(() => ({ error: "Upload failed" }))) as { error?: string };
        throw new Error(body.error ?? "Upload failed");
      }
      const data = (await res.json()) as UploadedTransfer;
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
    : "";

  const reset = () => {
    setTransfer(null);
    setFiles([]);
    setError(null);
  };

  const downloadIncoming = async (id: string, fileName: string) => {
    const link = document.createElement("a");
    link.href = `/api/transfers/incoming/${id}/download`;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    try {
      await fetch(`/api/transfers/incoming/${id}`, { method: "DELETE" });
      setIncomingFiles((prev) => prev.filter((f) => f.id !== id));
      if (incomingFiles.length <= 1) {
        setShowDownloadPopup(false);
      }
    } catch (err) {
      console.error("Failed to delete incoming file:", err);
    }
  };

  const downloadAll = async () => {
    for (const file of incomingFiles) {
      const link = document.createElement("a");
      link.href = `/api/transfers/incoming/${file.id}/download`;
      link.download = file.originalName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      await new Promise((r) => setTimeout(r, 500));
    }
    try {
      for (const file of incomingFiles) {
        await fetch(`/api/transfers/incoming/${file.id}`, { method: "DELETE" });
      }
      setIncomingFiles([]);
      setShowDownloadPopup(false);
    } catch (err) {
      console.error("Failed to clear incoming files:", err);
    }
  };

  const receiveUrl = `${window.location.origin}/api/receive`;

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      <div className="sticky top-0 z-30 bg-[#0a0a0a]/95 backdrop-blur border-b border-gray-800">
        <div className="flex items-center gap-3 px-4 py-3 sm:px-6">
          <Send size={18} className="text-[#22c55e]" />
          <span className="font-black text-white text-lg">Quick Send</span>
        </div>
        <div className="flex gap-2 px-4 pb-3 sm:px-6">
          <button
            onClick={() => {
              setMode("send");
              setReceiveMode(false);
            }}
            className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-medium transition-all duration-200 ${
              mode === "send"
                ? "bg-[#8b5cf6] text-white"
                : "bg-[#1a1a1a] text-gray-400 hover:bg-[#222] hover:text-gray-200 border border-gray-800"
            }`}
          >
            <Send size={12} />
            Send
          </button>
          <button
            onClick={() => {
              setMode("receive");
              setReceiveMode(true);
            }}
            className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-medium transition-all duration-200 ${
              mode === "receive"
                ? "bg-[#8b5cf6] text-white"
                : "bg-[#1a1a1a] text-gray-400 hover:bg-[#222] hover:text-gray-200 border border-gray-800"
            }`}
          >
            <Smartphone size={12} />
            Receive
          </button>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-10 sm:px-6">
        {mode === "send" ? (
          <>
            {!transfer ? (
              <>
                <p className="text-gray-400 text-sm mb-6 text-center">
                  Upload .mp3, .wav, or .srt files and get a QR code to download
                  them on any device.
                </p>

                <div
                  onClick={() => inputRef.current?.click()}
                  onDrop={onDrop}
                  onDragOver={onDragOver}
                  onDragLeave={onDragLeave}
                  className={`relative rounded-2xl border-2 border-dashed transition-colors cursor-pointer p-10 text-center
                    ${
                      dragging
                        ? "border-[#22c55e] bg-[#22c55e]/5"
                        : "border-gray-700 hover:border-gray-500 bg-[#111]"
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
                  <p className="text-white font-semibold mb-1">
                    Drag & drop files here
                  </p>
                  <p className="text-gray-500 text-sm">or click to browse</p>
                  <p className="text-gray-600 text-xs mt-2">
                    .mp3 · .wav · .srt
                  </p>
                </div>

                {files.length > 0 && (
                  <ul className="mt-4 space-y-2">
                    {files.map((file) => {
                      const Icon = getFileIcon(file.name);
                      return (
                        <li
                          key={file.name}
                          className="flex items-center gap-3 bg-[#111] rounded-xl px-4 py-3 border border-gray-800"
                        >
                          <Icon size={16} className="text-gray-400 shrink-0" />
                          <span className="text-sm text-white flex-1 truncate">
                            {file.name}
                          </span>
                          <span className="text-xs text-gray-500 shrink-0">
                            {formatSize(file.size)}
                          </span>
                          <button
                            onClick={() => removeFile(file.name)}
                            className="text-gray-600 hover:text-red-400 transition-colors shrink-0"
                          >
                            <X size={14} />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}

                {error && (
                  <p className="mt-4 text-red-400 text-sm text-center">
                    {error}
                  </p>
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
                      {files.length > 1 && (
                        <span className="text-xs opacity-75">
                          (will ZIP {files.length} files)
                        </span>
                      )}
                    </>
                  )}
                </button>
              </>
            ) : (
              <div className="text-center">
                <p className="text-white font-semibold text-lg mb-1">
                  Ready to scan
                </p>
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
          </>
        ) : (
          <div className="text-center">
            <div className="flex items-center justify-center gap-2 mb-4">
              <Wifi size={20} className="text-[#22c55e]" />
              <span className="text-white font-semibold text-lg">
                Receive Mode Active
              </span>
            </div>
            <p className="text-gray-400 text-sm mb-6">
              Scan the QR code with your phone to open the upload page
            </p>

            <div className="bg-white rounded-2xl p-4 inline-block mb-6">
              <QRCodeSVG value={receiveUrl} size={200} />
            </div>

            <div className="bg-[#111] rounded-xl p-4 border border-gray-800 mb-6">
              <p className="text-gray-400 text-xs mb-2">Upload URL</p>
              <p className="text-white text-sm font-mono break-all">
                {receiveUrl}
              </p>
            </div>

            <div className="flex items-center justify-center gap-1.5 text-amber-400 text-xs mb-6">
              <Clock size={13} />
              <span>Waiting for files from your phone...</span>
            </div>

            {incomingFiles.length > 0 && (
              <div className="text-left bg-[#111] rounded-xl p-4 border border-gray-800">
                <p className="text-gray-400 text-xs mb-3">
                  Incoming Files ({incomingFiles.length})
                </p>
                <div className="space-y-2">
                  {incomingFiles.map((file) => (
                    <div
                      key={file.id}
                      className="flex items-center gap-3 bg-[#0a0a0a] rounded-lg px-3 py-2"
                    >
                      <FileAudio size={14} className="text-gray-500 shrink-0" />
                      <span className="text-white text-sm flex-1 truncate">
                        {file.originalName}
                      </span>
                      <span className="text-gray-500 text-xs shrink-0">
                        {formatSize(file.size)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {transfer && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
            onClick={reset}
          >
            <div
              className="bg-[#111] rounded-2xl p-6 flex flex-col items-center gap-4 shadow-2xl border border-gray-800 mx-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between w-full">
                <p className="text-white font-semibold">Scan to download</p>
                <button
                  onClick={reset}
                  className="text-gray-500 hover:text-white transition-colors ml-6"
                >
                  <X size={18} />
                </button>
              </div>
              <div className="bg-white rounded-xl p-3">
                <QRCodeSVG value={downloadUrl} size={220} />
              </div>
              <div className="flex items-center gap-1.5 text-amber-400 text-xs">
                <Clock size={13} />
                <span>Link expires in 20 minutes</span>
              </div>
              <a
                href={downloadUrl}
                className="w-full text-center bg-gray-800 hover:bg-gray-700 text-white font-semibold py-2.5 px-4 rounded-xl transition-colors text-sm"
                download
              >
                Download on this device
              </a>
            </div>
          </div>
        )}

        {showDownloadPopup && incomingFiles.length > 0 && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
            <div className="bg-[#111] rounded-2xl p-6 flex flex-col items-center gap-4 shadow-2xl border border-gray-800 mx-4 max-w-sm w-full">
              <div className="flex items-center gap-3 w-full">
                <div className="w-10 h-10 rounded-full bg-[#22c55e]/20 flex items-center justify-center">
                  <Download size={20} className="text-[#22c55e]" />
                </div>
                <div className="flex-1">
                  <p className="text-white font-semibold">Incoming Files!</p>
                  <p className="text-gray-400 text-sm">
                    {incomingFiles.length} file(s) ready
                  </p>
                </div>
              </div>

              <div className="w-full bg-[#0a0a0a] rounded-xl p-3 max-h-40 overflow-y-auto">
                {incomingFiles.map((file) => (
                  <div key={file.id} className="flex items-center gap-2 py-1">
                    <FileAudio size={12} className="text-gray-500 shrink-0" />
                    <span className="text-white text-xs flex-1 truncate">
                      {file.originalName}
                    </span>
                    <span className="text-gray-500 text-xs">
                      {formatSize(file.size)}
                    </span>
                  </div>
                ))}
              </div>

              <div className="flex gap-3 w-full">
                <button
                  onClick={() => setShowDownloadPopup(false)}
                  className="flex-1 py-3 px-4 rounded-xl bg-gray-800 hover:bg-gray-700 text-white font-semibold transition-colors text-sm"
                >
                  Later
                </button>
                <button
                  onClick={downloadAll}
                  className="flex-1 py-3 px-4 rounded-xl bg-[#22c55e] hover:bg-[#16a34a] text-white font-semibold transition-colors text-sm"
                >
                  Download All
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
