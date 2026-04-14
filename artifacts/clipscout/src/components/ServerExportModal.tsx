import { useEffect, useRef } from "react";
import { X, Smartphone, Download } from "lucide-react";

export interface ServerExportState {
  jobId: string;
  current: number;
  total: number;
  status: "processing" | "done" | "error";
  zipId?: string;
  qrDataUrl?: string;
  error?: string;
}

interface Props {
  state: ServerExportState;
  onUpdate: (update: Partial<ServerExportState>) => void;
  onClose: () => void;
}

export function ServerExportModal({ state, onUpdate, onClose }: Props) {
  const esRef = useRef<EventSource | null>(null);
  const retryCountRef = useRef(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (state.status !== "processing") return;
    if (esRef.current) return;

    retryCountRef.current = 0;

    function connect() {
      const es = new EventSource(`/api/export-progress/${state.jobId}`);
      esRef.current = es;

      es.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data) as Partial<ServerExportState>;
          retryCountRef.current = 0; // Reset retry count on successful message
          onUpdate(data);
          if (data.status === "done" || data.status === "error") {
            es.close();
            esRef.current = null;
          }
        } catch {
          // ignore parse errors
        }
      };

      es.onerror = () => {
        es.close();
        esRef.current = null;
        retryCountRef.current++;

        // The Replit proxy drops SSE connections every ~800ms, so we need many
        // retries. Give up only after 90 failed reconnections (~3 minutes).
        if (retryCountRef.current >= 90) {
          onUpdate({
            status: "error",
            error: "Connection lost. Please try again.",
          });
        } else {
          // Retry after 2 seconds
          timeoutRef.current = setTimeout(connect, 2000);
        }
      };
    }

    // Timeout after 5 minutes
    timeoutRef.current = setTimeout(
      () => {
        if (esRef.current) {
          esRef.current.close();
          esRef.current = null;
        }
        onUpdate({
          status: "error",
          error: "Export timed out. Please try again.",
        });
      },
      5 * 60 * 1000,
    );

    connect();

    return () => {
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [state.jobId, state.status, onUpdate]);

  const progress = state.total > 0 ? (state.current / state.total) * 100 : 0;

  function handleDownload() {
    if (!state.zipId) return;
    const link = document.createElement("a");
    link.href = `/api/download/${state.zipId}`;
    link.download = "";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-6">
      <div className="bg-[#111] rounded-2xl p-8 w-full max-w-sm text-center relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-500 hover:text-white transition-colors"
          aria-label="Close"
        >
          <X size={18} />
        </button>

        {state.status === "processing" && (
          <>
            <div className="w-10 h-10 border-2 border-[#22c55e]/30 border-t-[#22c55e] rounded-full animate-spin mx-auto mb-4" />
            <p className="text-white font-semibold mb-2">Building your ZIP…</p>
            <p className="text-gray-400 text-sm mb-4">
              Processing {state.current} of {state.total} videos
            </p>
            <div className="w-full h-2 bg-gray-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-[#22c55e] rounded-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </>
        )}

        {state.status === "done" && state.qrDataUrl && (
          <>
            <div className="flex items-center justify-center gap-2 mb-4">
              <Smartphone size={20} className="text-[#22c55e]" />
              <p className="text-white font-semibold text-lg">
                Export Complete!
              </p>
            </div>
            <div className="bg-white rounded-xl p-3 inline-block mb-4">
              <img
                src={state.qrDataUrl}
                alt="Download QR Code"
                className="w-48 h-48"
              />
            </div>
            <p className="text-gray-400 text-xs mb-4">
              Scan with your phone camera to download the ZIP.
              <br />
              Link expires in{" "}
              <span className="text-gray-300 font-medium">60 minutes</span>.
            </p>
            <button
              onClick={handleDownload}
              className="flex items-center justify-center gap-2 w-full bg-[#22c55e] hover:bg-[#16a34a] text-white font-semibold py-3 px-4 rounded-xl transition-colors active:scale-95"
            >
              <Download size={18} />
              Download ZIP
            </button>
          </>
        )}

        {state.status === "error" && (
          <>
            <p className="text-red-400 font-semibold mb-2">Export failed</p>
            <p className="text-gray-400 text-sm">
              {state.error ?? "An unknown error occurred."}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
