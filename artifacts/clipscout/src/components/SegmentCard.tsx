import { useState, useEffect, useRef, useCallback } from 'react';
import { Plus, ChevronDown } from 'lucide-react';
import { ClipCard } from './ClipCard';
import { storage } from '../storage';
import { fetchPexelsClips, fetchGiphyClips } from '../api';
import { useToastCtx } from '../context/ToastContext';
import type { Clip, Segment } from '../types';

interface Props {
  segment: Segment;
  index: number;
  total: number;
  initialClips: Clip[];
  isPreloaded: boolean;
  onSelectionChange: () => void;
}

export function SegmentCard({ segment, index, total, initialClips, isPreloaded, onSelectionChange }: Props) {
  const { addToast } = useToastCtx();
  const [clips, setClips] = useState<Clip[]>(initialClips);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadingInitial, setLoadingInitial] = useState(!isPreloaded || initialClips.length === 0);
  const [showDropdown, setShowDropdown] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [pexelsPage, setPexelsPage] = useState(segment.pexels_page);
  const [giphyPage, setGiphyPage] = useState(segment.giphy_page);
  const cardRef = useRef<HTMLDivElement>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const loadedRef = useRef(isPreloaded && initialClips.length > 0);
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const loadInitialClips = useCallback(async () => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    setLoadingInitial(true);
    try {
      const newClips = await fetchPexelsClips(segment, 1);
      if (newClips.length > 0) {
        storage.addClips(segment.id, newClips);
        setClips(newClips);
      }
    } catch {
      // silent fallback
    } finally {
      setLoadingInitial(false);
    }
  }, [segment]);

  useEffect(() => {
    if (isPreloaded) return;
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
  }, [isPreloaded, loadInitialClips]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  async function loadMore(source: 'pexels' | 'giphy') {
    setShowDropdown(false);
    setLoadingMore(true);
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

    try {
      let newClips: Clip[] = [];
      if (source === 'pexels') {
        const nextPage = pexelsPage + 1;
        newClips = await fetchPexelsClips(segment, nextPage);
        setPexelsPage(nextPage);
      } else {
        const nextPage = giphyPage + 1;
        newClips = await fetchGiphyClips(segment, nextPage);
        setGiphyPage(nextPage);
      }

      if (newClips.length === 0) {
        addToast('info', 'No clips found for this segment.');
      } else {
        storage.addClips(segment.id, newClips);
        setClips((prev) => [...prev, ...newClips]);
      }
    } catch {
      addToast('error', 'Failed to load more clips.');
    } finally {
      setLoadingMore(false);
    }
  }

  const skeletons = Array.from({ length: 4 });

  return (
    <div ref={cardRef} className="bg-[#111] rounded-2xl overflow-hidden">
      <div className="px-4 py-3 sm:px-6 sm:py-4 flex items-center justify-between border-b border-gray-800">
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
          Segment {index + 1} of {total}
        </span>
        <span className="text-xs text-gray-500">{segment.duration_estimate}</span>
      </div>

      <div className="px-4 py-3 sm:px-6 sm:py-4 border-b border-gray-800">
        <p className="text-gray-300 text-sm leading-relaxed line-clamp-3">{segment.text_body}</p>
      </div>

      <div className="px-4 py-3 sm:px-6 border-b border-gray-800 flex justify-center">
        <div className="relative" ref={dropdownRef}>
          <button
            disabled={cooldown > 0 || loadingMore}
            onClick={() => setShowDropdown((v) => !v)}
            className="flex items-center gap-1.5 text-sm font-medium text-gray-300 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors px-3 py-2 rounded-lg hover:bg-gray-800 active:scale-95"
          >
            <Plus size={16} />
            {cooldown > 0 ? `Wait ${cooldown}s…` : loadingMore ? 'Loading…' : 'Add 4 More'}
            <ChevronDown size={14} />
          </button>

          {showDropdown && (
            <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 bg-[#1a1a1a] border border-gray-700 rounded-xl shadow-xl z-20 overflow-hidden min-w-[140px]">
              <button
                onClick={() => loadMore('pexels')}
                className="w-full text-left px-4 py-3 text-sm text-gray-300 hover:text-white hover:bg-gray-800 transition-colors"
              >
                Pexels
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

      <div className="p-4 sm:p-6">
        {loadingInitial ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {skeletons.map((_, i) => (
              <div key={i} className="aspect-video animate-pulse bg-gray-800 rounded-lg" />
            ))}
          </div>
        ) : clips.length === 0 ? (
          <p className="text-gray-500 text-sm text-center py-4">
            No clips found. Try Add 4 More.
          </p>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {clips.map((clip) => (
              <ClipCard key={clip.id} clip={clip} onSelectionChange={onSelectionChange} />
            ))}
            {loadingMore &&
              skeletons.map((_, i) => (
                <div key={`sk-${i}`} className="aspect-video animate-pulse bg-gray-800 rounded-lg" />
              ))}
          </div>
        )}
      </div>
    </div>
  );
}
