import { useState, useEffect, useRef, useCallback } from 'react';
import { Plus, ChevronDown, Search } from 'lucide-react';
import { ClipCard } from './ClipCard';
import { storage } from '../storage';
import { fetchPexelsClips, fetchGiphyClips, fetchPixabayClips } from '../api';
import { useToastCtx } from '../context/ToastContext';
import type { Clip, Segment } from '../types';

interface Props {
  segment: Segment;
  index: number;
  total: number;
  initialClips: Clip[];
  isPreloaded: boolean;
  selectedSet: Set<string>;
  bulkSelectNonce: number;
  onSelectionChange: (nextSelections?: string[]) => void;
}

// Splits comma-separated keyword phrases for "Add 4 More → Pexels".
function buildPexelsKeywordCycles(keywords?: string | null): string[] {
  const kw = keywords ?? '';
  const phrases = kw.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
  return phrases.length > 0 ? phrases : [kw];
}

type ManualSource = 'pexels' | 'pixabay' | 'giphy';

export function SegmentCard({
  segment,
  index,
  total,
  initialClips,
  isPreloaded,
  selectedSet,
  bulkSelectNonce,
  onSelectionChange,
}: Props) {
  const { addToast } = useToastCtx();
  const [clips, setClips] = useState<Clip[]>(initialClips);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState(false);
  const [loadingInitial, setLoadingInitial] = useState(!isPreloaded || initialClips.length === 0);
  const [showDropdown, setShowDropdown] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [giphyPage, setGiphyPage] = useState(segment.giphy_page);
  const cardRef = useRef<HTMLDivElement>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const loadedRef = useRef(isPreloaded && initialClips.length > 0);
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const pexelsKeywordIndexRef = useRef(1);
  const pexelsKeywordCycles = useRef(buildPexelsKeywordCycles(segment.pexels_keywords));

  // Manual keyword override state
  const [manualKeyword, setManualKeyword] = useState('');
  const [manualSource, setManualSource] = useState<ManualSource>('pexels');
  const [loadingManual, setLoadingManual] = useState(false);
  const manualPageRef = useRef(1);

  useEffect(() => {
    if (isPreloaded && initialClips.length > 0 && !loadedRef.current) {
      loadedRef.current = true;
      setClips(initialClips);
      setLoadingInitial(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPreloaded, initialClips.length]);

  const loadInitialClips = useCallback(async () => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    setLoadingInitial(true);

    const controller = new AbortController();
    const hardTimeout = setTimeout(() => {
      controller.abort();
      setLoadingInitial(false);
    }, 40000);

    try {
      const firstKeyword = pexelsKeywordCycles.current[0] ?? segment.pexels_keywords ?? '';
      const initialSegment = { ...segment, pexels_keywords: firstKeyword };
      let newClips = await fetchPexelsClips(initialSegment, 1, controller.signal);

      if (!controller.signal.aborted && newClips.length === 0) {
        const simplified = firstKeyword
          .split(' ')
          .filter((w) => w.length > 0)
          .slice(0, 2)
          .join(' ');
        const retrySegment = { ...segment, pexels_keywords: simplified };
        newClips = await fetchPexelsClips(retrySegment, 1, controller.signal);
      }

      clearTimeout(hardTimeout);

      if (!controller.signal.aborted) {
        if (newClips.length > 0) {
          storage.addClips(segment.id, newClips);
          setClips(newClips);
        }
        setLoadingInitial(false);
      }
    } catch (e) {
      clearTimeout(hardTimeout);
      if ((e as Error).name !== 'AbortError') {
        setLoadingInitial(false);
      }
    }
  }, [segment]);

  useEffect(() => {
    if (isPreloaded && initialClips.length > 0) return;
    const el = cardRef.current;
    if (!el) return;
    observerRef.current = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          loadInitialClips();
          observerRef.current?.disconnect();
        }
      },
      { threshold: 0.1 }
    );
    observerRef.current.observe(el);
    return () => observerRef.current?.disconnect();
  }, [isPreloaded, initialClips.length, loadInitialClips]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  async function loadMore(source: 'pexels' | 'giphy' | 'pixabay') {
    setShowDropdown(false);
    setLoadingMore(true);
    setLoadMoreError(false);
    setCooldown(3);
    cooldownRef.current = setInterval(() => {
      setCooldown((prev) => {
        if (prev <= 1) {
          clearInterval(cooldownRef.current!);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    const timeoutMs = source === 'giphy' ? 15000 : 20000;
    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      setLoadingMore(false);
      setLoadMoreError(true);
    }, timeoutMs);

    try {
      let newClips: Clip[] = [];
      if (source === 'pexels') {
        const cycles = pexelsKeywordCycles.current;
        const idx = pexelsKeywordIndexRef.current;
        const keyword = cycles[idx % cycles.length];
        const page = Math.floor(idx / cycles.length) + 1;
        pexelsKeywordIndexRef.current += 1;
        const broadSegment = { ...segment, pexels_keywords: keyword };
        newClips = await fetchPexelsClips(broadSegment, page);
      } else if (source === 'pixabay') {
        const keyword = (segment.pexels_keywords ?? '').split(',')[0]?.trim() || segment.pexels_keywords;
        newClips = await fetchPixabayClips(keyword, 1, segment.id);
      } else {
        const nextPage = giphyPage + 1;
        newClips = await fetchGiphyClips(segment, nextPage);
        setGiphyPage(nextPage);
      }

      clearTimeout(timeoutId);
      if (!timedOut) {
        if (newClips.length > 0) {
          storage.addClips(segment.id, newClips);
          setClips((prev) => [...prev, ...newClips]);
        } else {
          setLoadMoreError(true);
        }
      }
    } catch (err) {
      clearTimeout(timeoutId);
      if (!timedOut) {
        if (source === 'pexels') {
          const msg = (err as Error)?.message ?? '';
          if (msg.includes('no fallback key')) {
            addToast('error', 'Pexels failed: add Pexels key in Settings for fallback.');
          } else {
            addToast('error', 'Pexels request failed. Please try again.');
          }
        } else if (source === 'pixabay') {
          addToast('error', 'Pixabay request failed. Please try again.');
        }
        setLoadMoreError(true);
      }
    } finally {
      if (!timedOut) setLoadingMore(false);
    }
  }

  async function handleManualSearch() {
    const query = manualKeyword.trim();
    if (!query) return;
    setLoadingManual(true);
    const page = manualPageRef.current;
    try {
      let newClips: Clip[] = [];
      if (manualSource === 'pexels') {
        const fakeSegment = { ...segment, pexels_keywords: query };
        newClips = await fetchPexelsClips(fakeSegment, page);
      } else if (manualSource === 'pixabay') {
        newClips = await fetchPixabayClips(query, page, segment.id);
      } else {
        const fakeSegment = { ...segment, giphy_keywords: query };
        newClips = await fetchGiphyClips(fakeSegment, page);
      }
      manualPageRef.current += 1;
      if (newClips.length > 0) {
        storage.addClips(segment.id, newClips);
        setClips((prev) => [...prev, ...newClips]);
      } else {
        addToast('info', 'No clips found for that keyword.');
      }
    } catch (err) {
      addToast('error', (err as Error)?.message ?? 'Search failed. Please try again.');
    } finally {
      setLoadingManual(false);
    }
  }

  function handleManualKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      manualPageRef.current = 1;
      handleManualSearch();
    }
  }

  const skeletons = Array.from({ length: 4 });

  return (
    <div ref={cardRef} className="bg-[#111] rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 sm:px-6 sm:py-4 flex items-center justify-between border-b border-gray-800">
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
          Segment {index + 1} of {total}
        </span>
        <span className="text-xs text-gray-500">{segment.duration_estimate}</span>
      </div>

      {/* Script text */}
      <div className="px-4 py-3 sm:px-6 sm:py-4 border-b border-gray-800">
        <p className="text-gray-300 text-sm leading-relaxed line-clamp-3">{segment.text_body}</p>
      </div>

      {/* Add 4 More — right-aligned */}
      <div className="px-4 py-2 sm:px-6 border-b border-gray-800 flex justify-end">
        <div className="relative" ref={dropdownRef}>
          <button
            disabled={cooldown > 0 || loadingMore}
            onClick={() => { setShowDropdown((v) => !v); setLoadMoreError(false); }}
            className="flex items-center gap-1.5 text-sm font-medium text-gray-300 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors px-3 py-2 rounded-lg hover:bg-gray-800 active:scale-95"
          >
            <Plus size={16} />
            {cooldown > 0 ? `Wait ${cooldown}s…` : loadingMore ? 'Loading…' : 'Add 4 More'}
            <ChevronDown size={14} />
          </button>

          {showDropdown && (
            <div className="absolute top-full right-0 mt-1 bg-[#1a1a1a] border border-gray-700 rounded-xl shadow-xl z-20 overflow-hidden min-w-[140px]">
              <button
                onClick={() => loadMore('pexels')}
                className="w-full text-left px-4 py-3 text-sm text-gray-300 hover:text-white hover:bg-gray-800 transition-colors"
              >
                Pexels
              </button>
              <button
                onClick={() => loadMore('pixabay')}
                className="w-full text-left px-4 py-3 text-sm text-gray-300 hover:text-white hover:bg-gray-800 transition-colors border-t border-gray-800"
              >
                Pixabay
              </button>
              <button
                onClick={() => loadMore('giphy')}
                className="w-full text-left px-4 py-3 text-sm text-gray-300 hover:text-white hover:bg-gray-800 transition-colors border-t border-gray-800"
              >
                Giphy
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Main content: left search panel + right clips grid */}
      <div className="flex gap-0">
        {/* Left search panel */}
        <div className="flex-shrink-0 w-40 sm:w-48 border-r border-gray-800 p-3 flex flex-col gap-2">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wider leading-none">Search</p>

          {/* Source toggle */}
          <div className="flex flex-col gap-1">
            {(['pexels', 'pixabay', 'giphy'] as ManualSource[]).map((src) => (
              <button
                key={src}
                onClick={() => setManualSource(src)}
                className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs capitalize transition-colors ${
                  manualSource === src
                    ? 'bg-gray-700 text-white font-medium'
                    : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800'
                }`}
              >
                {src}
              </button>
            ))}
          </div>

          {/* Keyword input */}
          <input
            type="text"
            value={manualKeyword}
            onChange={(e) => { setManualKeyword(e.target.value); manualPageRef.current = 1; }}
            onKeyDown={handleManualKeyDown}
            placeholder="Type keyword..."
            className="w-full bg-[#1a1a1a] border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-gray-500"
          />

          {/* Search button */}
          <button
            onClick={() => { manualPageRef.current = 1; handleManualSearch(); }}
            disabled={loadingManual || !manualKeyword.trim()}
            className="flex items-center justify-center gap-1.5 w-full text-xs font-medium text-gray-300 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors px-2.5 py-1.5 rounded-lg hover:bg-gray-800 active:scale-95 border border-gray-700"
          >
            {loadingManual ? 'Searching…' : 'Search'}
            <Search size={12} />
          </button>
        </div>

        {/* Right clips area */}
        <div className="flex-1 p-4 sm:p-5 min-w-0">
          {loadingInitial ? (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {skeletons.map((_, i) => (
                <div key={i} className="aspect-video animate-pulse bg-gray-800 rounded-lg" />
              ))}
            </div>
          ) : clips.length === 0 ? (
            <p className="text-gray-500 text-sm text-center py-4">
              Clips not found. Try Add 4 More.
            </p>
          ) : (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {clips.map((clip, clipIndex) => (
                <ClipCard
                  key={`segment_${index}_clip_${clipIndex}`}
                  clip={clip}
                  isSelected={selectedSet.has(`segment_${index}_clip_${clipIndex}`)}
                  animIndex={clipIndex}
                  bulkSelectNonce={bulkSelectNonce}
                  segmentIndex={index}
                  clipIndex={clipIndex}
                  onSelectionChange={onSelectionChange}
                />
              ))}
              {loadingMore &&
                skeletons.map((_, i) => (
                  <div key={`sk-${i}`} className="aspect-video animate-pulse bg-gray-800 rounded-lg" />
                ))}
            </div>
          )}

          {loadMoreError && (
            <p className="text-gray-500 text-xs text-center mt-3">
              Could not find clips. Try Add 4 More again.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
