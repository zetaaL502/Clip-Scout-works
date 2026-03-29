import { useState, useEffect, useCallback, useRef } from 'react';
import { ArrowLeft, Download, Settings } from 'lucide-react';
import { SegmentCard } from '../components/SegmentCard';
import { storage } from '../storage';
import { fetchPexelsClips } from '../api';
import { useToastCtx } from '../context/ToastContext';
import { downloadZip } from 'client-zip';
import type { Clip, Segment } from '../types';

interface Props {
  onBack: () => void;
  onSettings: () => void;
}

export function GridPage({ onBack, onSettings }: Props) {
  const { addToast } = useToastCtx();
  const [segments, setSegments] = useState<Segment[]>([]);
  const [preloadedClips, setPreloadedClips] = useState<Record<string, Clip[]>>({});
  const [preloadedSet, setPreloadedSet] = useState<Set<string>>(new Set());
  const [selections, setSelections] = useState<string[]>([]);
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState({ current: 0, total: 0 });
  const project = storage.getProject();
  const hasPreloaded = useRef(false);

  useEffect(() => {
    const segs = storage.getSegments();
    setSegments(segs);
    setSelections(storage.getSelections());
  }, []);

  useEffect(() => {
    if (hasPreloaded.current || segments.length === 0) return;
    hasPreloaded.current = true;

    const first5 = segments.slice(0, 5);
    const existingClips = storage.getClips();

    Promise.all(
      first5.map(async (seg) => {
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

  const refreshSelections = useCallback(() => {
    setSelections(storage.getSelections());
  }, []);

  const selectedCount = selections.length;
  const segmentsWithSelection = segments.filter((seg) => {
    const segClips = storage.getSegmentClips(seg.id);
    return segClips.some((c) => selections.includes(c.id));
  }).length;

  async function handleExport() {
    if (selectedCount === 0) return;

    const allClips = storage.getClips();
    const allFlat: Clip[] = [];
    segments.forEach((seg) => {
      const segClips = allClips[seg.id] ?? [];
      segClips.forEach((c) => {
        if (selections.includes(c.id)) allFlat.push(c);
      });
    });

    setExporting(true);
    setExportProgress({ current: 0, total: allFlat.length });

    const files: { name: string; input: Blob }[] = [];

    for (let i = 0; i < allFlat.length; i++) {
      const clip = allFlat[i];
      const num = String(i + 1).padStart(2, '0');
      const ext = clip.source === 'giphy' ? 'gif' : 'mp4';
      const filename = `${num}_scene.${ext}`;

      try {
        const res = await fetch(clip.media_url);
        if (!res.ok) throw new Error('fetch failed');
        const blob = await res.blob();
        files.push({ name: filename, input: blob });
      } catch {
        addToast('error', `Clip ${i + 1} failed to download, skipping.`);
      }

      setExportProgress({ current: i + 1, total: allFlat.length });
    }

    const scriptContent = project?.fullScript ?? '';
    const scriptBlob = new Blob([scriptContent], { type: 'text/plain' });
    files.push({ name: 'script.txt', input: scriptBlob });

    try {
      const blob = await downloadZip(files).blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'clipscout_export.zip';
      a.click();
      URL.revokeObjectURL(url);
      addToast('success', 'Export ready! Downloading now…');
    } catch {
      addToast('error', 'Export failed. Please try again.');
    }

    setExporting(false);
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a]">
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
              Export ZIP ({selectedCount})
            </button>
          </div>
        </div>

        <div className="px-4 sm:px-6 pb-3">
          <p className="text-xs text-gray-400 mb-1.5">
            {segmentsWithSelection} of {segments.length} segments have clips selected
          </p>
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
