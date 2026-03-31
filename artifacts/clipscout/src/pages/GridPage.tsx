import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { ArrowLeft, Download, Settings, SquareCheck as CheckSquare, Square } from 'lucide-react';
import { SegmentCard } from '../components/SegmentCard';
import { storage } from '../storage';
import { fetchBestPexelsExportUrl, fetchPexelsClips } from '../api';
import { useToastCtx } from '../context/ToastContext';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import type { Clip, Segment } from '../types';

interface Props {
  onBack: () => void;
  onSettings: () => void;
}

const EXPORT_BATCH_SIZE = 100;
const EXPORT_BATCH_DELAY_MS = 2000;
const EXPORT_FILE_TIME_STEP_MS = 60_000;

type ExportProgressUpdater = (current: number, total: number) => void;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

function isLandscapeClip(clip: Clip): boolean {
  if (typeof clip.width === 'number' && typeof clip.height === 'number') {
    return clip.width > clip.height;
  }
  // Keep non-Pexels clips and unknown-size clips untouched.
  return clip.source !== 'pexels';
}

async function resolveExportMediaUrl(clip: Clip): Promise<string | null> {
  if (clip.source !== 'pexels' || !isPexelsClipId(clip.id)) {
    return clip.media_url;
  }
  const videoId = parsePexelsVideoId(clip.id);
  if (!videoId) return null;
  try {
    return await fetchBestPexelsExportUrl(videoId);
  } catch {
    return null;
  }
}

async function exportVideosInBatches(
  videoDataArray: Clip[],
  onProgress: ExportProgressUpdater,
  addToast: (type: 'success' | 'error' | 'info', message: string) => void,
  scriptContent?: string,
): Promise<void> {
  // Extra safety: dedupe again at export-time in case cached selections/clips contain repeats.
  // Preserves first-seen order.
  const seenExportKeys = new Set<string>();
  const dedupedVideoDataArray: Clip[] = [];
  for (const clip of videoDataArray) {
    const pexelsVideoId = clip.source === 'pexels' ? parsePexelsVideoId(clip.id) : null;
    const key = pexelsVideoId ? `pexels:${pexelsVideoId}` : `${clip.source}:${clip.media_url}`;
    if (seenExportKeys.has(key)) continue;
    seenExportKeys.add(key);
    dedupedVideoDataArray.push(clip);
  }

  const total = dedupedVideoDataArray.length;
  const baseTimestamp = Date.now();
  let processed = 0;
  const totalBatches = Math.ceil(total / EXPORT_BATCH_SIZE);

  for (let batchStart = 0; batchStart < total; batchStart += EXPORT_BATCH_SIZE) {
    const batchIndex = Math.floor(batchStart / EXPORT_BATCH_SIZE);
    const batchItems = dedupedVideoDataArray.slice(batchStart, batchStart + EXPORT_BATCH_SIZE);
    let zip: JSZip | null = new JSZip();
    const folderName = `youtube_export_part${batchIndex + 1}`;

    for (let i = 0; i < batchItems.length; i++) {
      const clip = batchItems[i];
      const globalIndex = batchStart + i;
      const fileNumber = String(globalIndex + 1).padStart(3, '0');
      const ext = clip.source === 'giphy' ? 'gif' : 'mp4';
      const filename = `${fileNumber}.${ext}`;

      try {
        const mediaUrl = await resolveExportMediaUrl(clip);
        if (!mediaUrl) throw new Error('No landscape media URL');
        const res = await fetch(mediaUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();

        zip.file(`${folderName}/${filename}`, blob, {
          date: new Date(baseTimestamp + globalIndex * EXPORT_FILE_TIME_STEP_MS),
        });
      } catch {
        addToast('error', `Video ${globalIndex + 1} failed, skipped.`);
      }

      processed += 1;
      onProgress(processed, total);
      console.log(`Downloading Video ${processed} of ${total}`);
    }

    try {
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const partName = `${folderName}.zip`;
      downloadZipBlob(zipBlob, partName);
    } finally {
      zip = null;
    }

    if (batchIndex < totalBatches - 1) {
      await sleep(EXPORT_BATCH_DELAY_MS);
    }
  }
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

    // Get selected clips in order, preserving each individually even if same URL
    const selectedClips: Clip[] = [];
    for (const key of selections) {
      const clip = clipByKey.get(key);
      if (clip) {
        selectedClips.push(clip);
      }
    }

    // Deduplicate by underlying media identity:
    // - Pexels: stable video id (ignores page suffix)
    // - Others: media URL fallback
    const uniqueByMedia = new Map<string, Clip>();
    selectedClips.forEach((clip) => {
      const pexelsVideoId = clip.source === 'pexels' ? parsePexelsVideoId(clip.id) : null;
      const mediaKey = pexelsVideoId ? `pexels:${pexelsVideoId}` : `${clip.source}:${clip.media_url}`;
      if (!uniqueByMedia.has(mediaKey)) {
        uniqueByMedia.set(mediaKey, clip);
      }
    });

    const exportable = Array.from(uniqueByMedia.values()).filter(isLandscapeClip);
    if (exportable.length === 0) {
      addToast('error', 'No horizontal clips selected for export.');
      exportInFlightRef.current = false;
      return;
    }
    if (exportable.length < uniqueByMedia.size) {
      addToast('info', `${uniqueByMedia.size - exportable.length} vertical clip(s) skipped.`);
    }

    setExporting(true);
    setExportProgress({ current: 0, total: exportable.length });

    const scriptContent = project?.fullScript ?? '';

    try {
      await exportVideosInBatches(
        exportable,
        (current, total) => setExportProgress({ current, total }),
        addToast,
        scriptContent,
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
