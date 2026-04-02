import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { ArrowLeft, Download, Settings, SquareCheck as CheckSquare, Square, Smartphone } from 'lucide-react';
import { SegmentCard } from '../components/SegmentCard';
import { storage } from '../storage';
import { fetchBestPexelsExportUrl, fetchPexelsClips } from '../api';
import { useToastCtx } from '../context/ToastContext';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import type { Clip, Segment } from '../types';
import { ServerExportModal, type ServerExportState } from '../components/ServerExportModal';

interface Props {
  onBack: () => void;
  onSettings: () => void;
}

const EXPORT_FILE_TIME_STEP_MS = 60_000;

type ExportProgressUpdater = (current: number, total: number) => void;

function downloadZipBlob(zipBlob: Blob, filename: string): void {
  const nav = navigator as unknown as { msSaveOrOpenBlob?: (blob: Blob, name: string) => void };
  if (typeof nav.msSaveOrOpenBlob === 'function') {
    nav.msSaveOrOpenBlob(zipBlob, filename);
    return;
  }

  try {
    const zipFile = new File([zipBlob], filename, { type: 'application/zip' });
    saveAs(zipFile, filename);
    return;
  } catch {
    // Fall through to <a download> approach.
  }

  const url = URL.createObjectURL(zipBlob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function isPexelsClipId(clipId: string): boolean {
  return clipId.startsWith('pexels-');
}

function parsePexelsVideoId(clipId: string): string | null {
  const match = /^pexels-(.+)-\d+$/.exec(clipId);
  return match?.[1] ?? null;
}

const TRIM_VIDEO_URL_ENDPOINT = '/api/trim-video-url';
const GIPHY_DOWNLOAD_PROXY = '/api/video-download';

async function resolvePexelsCdnUrl(clip: Clip): Promise<string | null> {
  if (clip.source !== 'pexels') return null;
  if (isPexelsClipId(clip.id)) {
    const videoId = parsePexelsVideoId(clip.id);
    if (videoId) {
      try {
        const bestUrl = await fetchBestPexelsExportUrl(videoId);
        if (bestUrl) return bestUrl;
      } catch {
        // Fall through to stored media_url
      }
    }
  }
  return clip.media_url || null;
}

async function exportAllVideos(
  videoDataArray: Clip[],
  onProgress: ExportProgressUpdater,
  addToast: (type: 'success' | 'error' | 'info', message: string) => void,
): Promise<void> {
  const total = videoDataArray.length;
  const baseTimestamp = Date.now();
  let processed = 0;
  const zip = new JSZip();
  const folderName = 'youtube_export';

  // Download all clips in parallel — each clip starts immediately without waiting
  // for others, so total export time ≈ slowest single clip instead of sum of all clips.
  const results = await Promise.all(
    videoDataArray.map(async (clip, i) => {
      const fileNumber = String(i + 1).padStart(3, '0');
      const isGif = clip.source === 'giphy';
      const ext = isGif ? 'gif' : 'mp4';
      const filename = `${fileNumber}.${ext}`;

      try {
        let finalBlob: Blob;

        if (isGif) {
          const rawUrl = clip.media_url;
          if (!rawUrl) throw new Error('No GIF URL');
          const proxyUrl = `${GIPHY_DOWNLOAD_PROXY}?url=${encodeURIComponent(rawUrl)}`;
          const dlController = new AbortController();
          const dlTimeout = setTimeout(() => dlController.abort(), 60000);
          let dlRes: Response;
          try {
            dlRes = await fetch(proxyUrl, { signal: dlController.signal });
          } finally {
            clearTimeout(dlTimeout);
          }
          if (!dlRes.ok) throw new Error(`GIF proxy HTTP ${dlRes.status}`);
          finalBlob = await dlRes.blob();
        } else {
          // Pexels: server fetches CDN URL, runs FFmpeg to fix duration metadata,
          // and returns the corrected MP4.
          const cdnUrl = await resolvePexelsCdnUrl(clip);
          if (!cdnUrl) throw new Error('No Pexels CDN URL');

          const trimController = new AbortController();
          const trimTimeout = setTimeout(() => trimController.abort(), 90000);
          let trimRes: Response;
          try {
            trimRes = await fetch(TRIM_VIDEO_URL_ENDPOINT, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ url: cdnUrl }),
              signal: trimController.signal,
            });
          } finally {
            clearTimeout(trimTimeout);
          }
          if (!trimRes.ok) throw new Error(`Trim-URL HTTP ${trimRes.status}`);
          finalBlob = await trimRes.blob();
        }

        processed += 1;
        onProgress(processed, total);
        return { filename, blob: finalBlob, index: i };
      } catch {
        addToast('error', `Clip ${i + 1} failed to download, skipped.`);
        processed += 1;
        onProgress(processed, total);
        return null;
      }
    })
  );

  // Add to ZIP in original order
  results.forEach((result) => {
    if (!result) return;
    zip.file(`${folderName}/${result.filename}`, result.blob, {
      date: new Date(baseTimestamp + result.index * EXPORT_FILE_TIME_STEP_MS),
    });
  });

  const zipBlob = await zip.generateAsync({ type: 'blob' });
  downloadZipBlob(zipBlob, `${folderName}.zip`);
}

export function GridPage({ onBack, onSettings }: Props) {
  const { addToast } = useToastCtx();
  const [segments, setSegments] = useState<Segment[]>([]);
  const [preloadedClips, setPreloadedClips] = useState<Record<string, Clip[]>>({});
  const [preloadedSet, setPreloadedSet] = useState<Set<string>>(new Set());
  const [selections, setSelections] = useState<string[]>([]);
  // Used to keep the "Deselect All" label visible after using Select All,
  // even if the user deselects one clip afterwards.
  const [bulkSelectArmed, setBulkSelectArmed] = useState(false);
  // Nonce that triggers the card cascade animation when Select All is clicked.
  const [bulkSelectNonce, setBulkSelectNonce] = useState(0);
  const [exporting, setExporting] = useState(false);
  const exportInFlightRef = useRef(false);
  const [serverExportState, setServerExportState] = useState<ServerExportState | null>(null);
  const exportLockKey = '__clipscout_export_lock__';
  const [exportProgress, setExportProgress] = useState({ current: 0, total: 0 });
  const [scrollProgress, setScrollProgress] = useState(0);
  const project = storage.getProject();
  const hasPreloaded = useRef(false);
  const [selectAllBumping, setSelectAllBumping] = useState(false);
  const scrollRafRef = useRef<number | null>(null);
  const lastScrollProgressRef = useRef(-1);

  useEffect(() => {
    function onScroll() {
      if (scrollRafRef.current !== null) return;
      scrollRafRef.current = window.requestAnimationFrame(() => {
        const scrollTop = window.scrollY;
        const docHeight = document.documentElement.scrollHeight - window.innerHeight;
        const next = docHeight > 0 ? scrollTop / docHeight : 0;
        // Avoid tiny state churn during scroll.
        if (Math.abs(next - lastScrollProgressRef.current) > 0.002) {
          lastScrollProgressRef.current = next;
          setScrollProgress(next);
        }
        scrollRafRef.current = null;
      });
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (scrollRafRef.current !== null) {
        window.cancelAnimationFrame(scrollRafRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const segs = storage.getSegments();
    setSegments(segs);
    setSelections(storage.getSelections());
  }, []);

  useEffect(() => {
    if (hasPreloaded.current || segments.length === 0) return;
    hasPreloaded.current = true;

    const first10 = segments.slice(0, 10);
    const existingClips = storage.getClips();

    Promise.all(
      first10.map(async (seg) => {
        const cached = existingClips[seg.id];
        if (cached && cached.length > 0) return { id: seg.id, clips: cached };
        try {
          const clips = await fetchPexelsClips(seg, 1);
          if (clips.length > 0) {
            storage.addClips(seg.id, clips);
          }
          return { id: seg.id, clips };
        } catch {
          return { id: seg.id, clips: [] };
        }
      })
    ).then((results) => {
      const newClips: Record<string, Clip[]> = {};
      const newSet = new Set<string>();
      results.forEach(({ id, clips }) => {
        newClips[id] = clips;
        if (clips.length > 0) newSet.add(id);
      });
      setPreloadedClips(newClips);
      setPreloadedSet(newSet);
    });
  }, [segments]);

  useEffect(() => {
    if (segments.length <= 10) return;

    let cancelled = false;
    const batchSize = 6;

    async function prefetchRemainingInBatches() {
      for (let i = 10; i < segments.length; i += batchSize) {
        if (cancelled) return;

        const batch = segments.slice(i, i + batchSize);
        const existingClips = storage.getClips();

        const results = await Promise.all(
          batch.map(async (seg) => {
            const cached = existingClips[seg.id];
            if (cached && cached.length > 0) return { id: seg.id, clips: cached };
            try {
              const clips = await fetchPexelsClips(seg, 1);
              if (clips.length > 0) {
                storage.addClips(seg.id, clips);
              }
              return { id: seg.id, clips };
            } catch {
              return { id: seg.id, clips: [] as Clip[] };
            }
          })
        );

        if (cancelled) return;

        setPreloadedClips((prev) => {
          const next = { ...prev };
          results.forEach(({ id, clips }) => {
            if (clips.length > 0) next[id] = clips;
          });
          return next;
        });
        setPreloadedSet((prev) => {
          const next = new Set(prev);
          results.forEach(({ id, clips }) => {
            if (clips.length > 0) next.add(id);
          });
          return next;
        });

        // Small pause between batches to avoid hammering APIs.
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }

    prefetchRemainingInBatches();

    return () => {
      cancelled = true;
    };
  }, [segments]);

  const refreshSelections = useCallback((nextSelections?: string[]) => {
    if (nextSelections) {
      setSelections(nextSelections);
      return;
    }
    setSelections(storage.getSelections());
  }, []);

  const allClips = useMemo(() => storage.getClips(), [segments, preloadedClips, selections]);
  const selectedSet = useMemo(() => new Set(selections), [selections]);
  const selectedCount = selections.length;

  const allSelected = useMemo(() => {
    const allClipsCount = segments.reduce((sum, seg) => sum + (allClips[seg.id] ?? []).length, 0);
    return allClipsCount > 0 && selectedCount === allClipsCount;
  }, [segments, allClips, selectedCount]);

  // Label rule from the spec:
  // - "Select All" when nothing is selected.
  // - Otherwise, show "Deselect All" when all are selected OR when the user has used Select All.
  const showDeselectAll = selectedCount > 0 && (allSelected || bulkSelectArmed);

  useEffect(() => {
    // If the user manually deselects everything, return to the initial mode.
    if (selections.length === 0) setBulkSelectArmed(false);
  }, [selections.length]);

  useEffect(() => {
    // If everything becomes selected (whether via the Select All button or
    // by manually selecting every clip), keep the "Deselect All" label
    // available until the user clears selections.
    const allClipsCount = segments.reduce((sum, seg) => {
      return sum + (allClips[seg.id] ?? []).length;
    }, 0);
    if (allClipsCount > 0 && selectedCount === allClipsCount) {
      setBulkSelectArmed(true);
    }
  }, [selectedCount, segments, allClips]);

  function handleSelectAll() {
    // Bounce/press animation on the button itself.
    setSelectAllBumping(false);
    requestAnimationFrame(() => setSelectAllBumping(true));

    const allLoadedNow: string[] = [];
    segments.forEach((seg, segIdx) => {
      const segClips = allClips[seg.id] ?? [];
      segClips.forEach((_, clipIdx) => {
        allLoadedNow.push(`segment_${segIdx}_clip_${clipIdx}`);
      });
    });

    if (showDeselectAll) {
      storage.setSelections([]);
      setBulkSelectArmed(false);
    } else {
      storage.setSelections(allLoadedNow);
      setBulkSelectArmed(true);
      setBulkSelectNonce((n) => n + 1);
    }
    refreshSelections();
  }

  function handleSelectTwo(side: 'left' | 'right') {
    const currentSelections = new Set(selections);
    const targetKeys = new Set<string>();

    segments.forEach((seg, segIdx) => {
      const segClips = allClips[seg.id] ?? [];
      // "Original clips only": initial Pexels page=1 clips (never Add 4 More).
      const originalClips = segClips
        .filter((clip) => clip.source === 'pexels' && clip.id.endsWith('-1'))
        .slice(0, 4);

      const n = originalClips.length;
      if (n === 0) return;

      let indices: number[] = [];
      if (side === 'left') {
        // Edge cases: 1 -> [1], 2 -> [1,2], 3 -> [1,2], 4 -> [1,2]
        indices = n === 1 ? [0] : [0, 1];
      } else {
        // Edge cases: 1 -> [1], 2 -> [1,2], 3 -> [2,3], 4 -> [3,4]
        if (n === 1) indices = [0];
        else if (n === 2) indices = [0, 1];
        else if (n === 3) indices = [1, 2];
        else indices = [2, 3];
      }

      indices.forEach((i) => {
        const clipIdx = segClips.findIndex((c) => c === originalClips[i]);
        if (clipIdx >= 0) {
          targetKeys.add(`segment_${segIdx}_clip_${clipIdx}`);
        }
      });
    });

    // Toggle behavior:
    // - if all target clips are already selected, deselect only those target clips
    // - otherwise, select missing target clips
    const allTargetsSelected =
      targetKeys.size > 0 && Array.from(targetKeys).every((id) => currentSelections.has(id));

    const nextSelections = new Set(currentSelections);
    if (allTargetsSelected) {
      targetKeys.forEach((id) => nextSelections.delete(id));
    } else {
      targetKeys.forEach((id) => nextSelections.add(id));
    }

    const updated = Array.from(nextSelections);
    storage.setSelections(updated);
    setSelections(updated);
  }
  const segmentsWithSelection = useMemo(
    () =>
      segments.filter((seg, segIdx) => {
        const segClips = allClips[seg.id] ?? [];
        return segClips.some((_, clipIdx) => selectedSet.has(`segment_${segIdx}_clip_${clipIdx}`));
      }).length,
    [segments, allClips, selectedSet]
  );

  async function handleExport() {
    const g = globalThis as unknown as Record<string, unknown>;
    if (selectedCount === 0 || exportInFlightRef.current || g[exportLockKey] === true) return;
    exportInFlightRef.current = true;
    g[exportLockKey] = true;

    // Build map: segment_N_clip_M -> Clip
    const clipByKey = new Map<string, Clip>();
    segments.forEach((seg, segIdx) => {
      const segClips = allClips[seg.id] ?? [];
      segClips.forEach((clip, clipIdx) => {
        const key = `segment_${segIdx}_clip_${clipIdx}`;
        clipByKey.set(key, clip);
      });
    });

    // Sort selections so the zip always exports 001, 002, 003... in script segment order.
    // Across segments: sort by segment index (1 before 2 before 3...).
    // Within the same segment: preserve the order the user clicked/selected them.
    const sortedSelections = selections
      .map((key, idx) => ({ key, idx }))
      .sort((a, b) => {
        const partsA = a.key.split('_');
        const partsB = b.key.split('_');
        const segA = parseInt(partsA[1] ?? '0', 10);
        const segB = parseInt(partsB[1] ?? '0', 10);
        if (segA !== segB) return segA - segB;
        // Same segment — preserve selection/click order via original array index
        return a.idx - b.idx;
      })
      .map(({ key }) => key);

    // Build ordered clip list from sorted selections
    const selectedClips: Clip[] = [];
    for (const key of sortedSelections) {
      const clip = clipByKey.get(key);
      if (clip) selectedClips.push(clip);
    }

    const exportable = selectedClips;
    if (exportable.length === 0) {
      addToast('error', 'No clips selected for export.');
      exportInFlightRef.current = false;
      g[exportLockKey] = false;
      return;
    }

    setExporting(true);
    setExportProgress({ current: 0, total: exportable.length });

    try {
      await exportAllVideos(
        exportable,
        (current, total) => setExportProgress({ current, total }),
        addToast,
      );
      addToast('success', 'Export ready! Downloading now…');
    } catch {
      addToast('error', 'Export failed. Please try again.');
    } finally {
      setExporting(false);
      exportInFlightRef.current = false;
      g[exportLockKey] = false;
    }
  }

  async function handleServerExport() {
    if (selectedCount === 0 || serverExportState?.status === 'processing') return;

    const clipByKey = new Map<string, Clip>();
    segments.forEach((seg, segIdx) => {
      const segClips = allClips[seg.id] ?? [];
      segClips.forEach((clip, clipIdx) => {
        clipByKey.set(`segment_${segIdx}_clip_${clipIdx}`, clip);
      });
    });

    const sortedSelections = selections
      .map((key, idx) => ({ key, idx }))
      .sort((a, b) => {
        const [, sA] = a.key.split('_');
        const [, sB] = b.key.split('_');
        const diff = parseInt(sA ?? '0', 10) - parseInt(sB ?? '0', 10);
        return diff !== 0 ? diff : a.idx - b.idx;
      })
      .map(({ key }) => key);

    const urls: string[] = [];
    for (const key of sortedSelections) {
      const clip = clipByKey.get(key);
      if (!clip) continue;
      try {
        const url = clip.source === 'pexels'
          ? await resolvePexelsCdnUrl(clip)
          : clip.media_url ?? null;
        if (url) urls.push(url);
      } catch {
        // skip unresolvable clips
      }
    }

    if (urls.length === 0) {
      addToast('error', 'Could not resolve any clip URLs.');
      return;
    }

    try {
      const res = await fetch('/api/server-export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls }),
      });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const { jobId } = await res.json() as { jobId: string };
      setServerExportState({ jobId, current: 0, total: urls.length, status: 'processing' });
    } catch {
      addToast('error', 'Failed to start server export. Please try again.');
    }
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a]">
      <style>
        {`
          @keyframes selectAllBounce {
            0% { transform: scale(1); }
            18% { transform: scale(0.95); }
            60% { transform: scale(1.03); }
            100% { transform: scale(1); }
          }
        `}
      </style>
      {/* Scroll progress indicator — fixed right edge */}
      <div className="fixed right-0 top-0 bottom-0 w-1 bg-gray-800 z-50 pointer-events-none">
        <div
          className="w-full bg-[#22c55e]"
          style={{ height: `${scrollProgress * 100}%`, transition: 'height 50ms linear' }}
        />
      </div>
      <div className="sticky top-0 z-30 bg-[#0a0a0a]/95 backdrop-blur border-b border-gray-800">
        <div className="flex items-center justify-between px-4 py-3 sm:px-6">
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 text-gray-400 hover:text-white transition-colors text-sm font-medium active:scale-95"
          >
            <ArrowLeft size={18} />
            Back
          </button>
          <span className="font-black text-white text-lg">ClipScout</span>
          <div className="flex items-center gap-2">
            <button
              onClick={onSettings}
              className="text-gray-400 hover:text-white transition-colors p-1.5"
              aria-label="Settings"
            >
              <Settings size={18} />
            </button>
            <button
              onClick={handleExport}
              disabled={selectedCount === 0 || exporting}
              className="flex items-center gap-1.5 bg-[#22c55e] disabled:bg-gray-700 disabled:text-gray-500 text-white font-semibold py-2 px-3 rounded-xl text-sm transition-colors active:scale-95"
            >
              <Download size={16} />
              <span className="hidden sm:inline">Export ZIP</span>
              <span>({selectedCount})</span>
            </button>
            <button
              onClick={handleServerExport}
              disabled={selectedCount === 0 || serverExportState?.status === 'processing'}
              className="flex items-center gap-1.5 bg-[#6366f1] disabled:bg-gray-700 disabled:text-gray-500 text-white font-semibold py-2 px-3 rounded-xl text-sm transition-colors active:scale-95"
              title="Export to phone via QR code"
            >
              <Smartphone size={16} />
              <span className="hidden sm:inline">Phone</span>
            </button>
          </div>
        </div>

        <div className="px-4 sm:px-6 pb-3">
          <div className="flex items-start justify-between mb-1.5 gap-2">
            <p className="text-xs text-gray-400">
              {segmentsWithSelection} of {segments.length} segments have clips selected
            </p>
            <div className="flex flex-wrap items-start justify-end gap-3">
              <button
                onClick={handleSelectAll}
                className="flex items-center gap-1 text-xs font-semibold text-gray-300 hover:text-white transition-colors min-h-[44px] px-2 active:scale-95"
                aria-label={showDeselectAll ? 'Deselect all clips' : 'Select all clips'}
                style={{
                  animation: selectAllBumping ? 'selectAllBounce 220ms ease-out' : undefined,
                }}
                onAnimationEnd={() => setSelectAllBumping(false)}
              >
                {showDeselectAll ? (
                  <>
                    <CheckSquare size={13} className="text-[#22c55e]" />
                    <span className="text-[#22c55e]">Deselect All</span>
                  </>
                ) : (
                  <>
                    <Square size={13} />
                    Select All
                  </>
                )}
              </button>

              <div className="flex flex-col items-end gap-1">
                <span className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                  Select 2 Clips
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleSelectTwo('left')}
                    className="text-xs font-semibold text-gray-300 hover:text-white transition-colors min-h-[36px] px-2.5 rounded-lg border border-gray-700 hover:border-gray-500 active:scale-95"
                    aria-label="Select left two original clips in each segment"
                  >
                    Left
                  </button>
                  <button
                    onClick={() => handleSelectTwo('right')}
                    className="text-xs font-semibold text-gray-300 hover:text-white transition-colors min-h-[36px] px-2.5 rounded-lg border border-gray-700 hover:border-gray-500 active:scale-95"
                    aria-label="Select right two original clips in each segment"
                  >
                    Right
                  </button>
                </div>
              </div>
            </div>
          </div>
          <div className="w-full h-1.5 bg-gray-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-[#22c55e] rounded-full transition-all duration-300"
              style={{ width: segments.length > 0 ? `${(segmentsWithSelection / segments.length) * 100}%` : '0%' }}
            />
          </div>
        </div>
      </div>

      <div className="px-4 sm:px-6 py-6 space-y-6 max-w-5xl mx-auto">
        {segments.map((seg, i) => (
          <SegmentCard
            key={seg.id}
            segment={seg}
            index={i}
            total={segments.length}
            initialClips={preloadedClips[seg.id] ?? []}
            isPreloaded={preloadedSet.has(seg.id)}
            selectedSet={selectedSet}
            bulkSelectNonce={bulkSelectNonce}
            onSelectionChange={refreshSelections}
          />
        ))}
      </div>

      {serverExportState && (
        <ServerExportModal
          state={serverExportState}
          onUpdate={(update) => setServerExportState((prev) => prev ? { ...prev, ...update } : null)}
          onClose={() => setServerExportState(null)}
        />
      )}

      {exporting && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-6">
          <div className="bg-[#111] rounded-2xl p-8 w-full max-w-sm text-center">
            <div className="w-10 h-10 border-2 border-[#22c55e]/30 border-t-[#22c55e] rounded-full animate-spin mx-auto mb-4" />
            <p className="text-white font-semibold mb-2">Preparing your clips…</p>
            <p className="text-gray-400 text-sm mb-4">
              Downloading {exportProgress.current} of {exportProgress.total}
            </p>
            <div className="w-full h-2 bg-gray-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-[#22c55e] rounded-full transition-all duration-300"
                style={{
                  width: exportProgress.total > 0
                    ? `${(exportProgress.current / exportProgress.total) * 100}%`
                    : '0%',
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
