import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  Plus,
  ChevronDown,
  Search,
  Trash2,
  Image as ImageIcon,
} from "lucide-react";
import { ClipCard } from "./ClipCard";
import { storage } from "../storage";
import { fetchPexelsClips, fetchGiphyClips, fetchPixabayClips } from "../api";
import { useToastCtx } from "../context/ToastContext";
import type { Clip, Segment, CustomUpload } from "../types";

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

function buildPexelsKeywordCycles(keywords?: string | null): string[] {
  const kw = keywords ?? "";
  const phrases = kw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return phrases.length > 0 ? phrases : [kw];
}

type ManualSource = "pexels" | "pixabay" | "giphy";

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
  const [loadingInitial, setLoadingInitial] = useState(
    !isPreloaded || initialClips.length === 0,
  );
  const [showDropdown, setShowDropdown] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [giphyPage, setGiphyPage] = useState(segment.giphy_page);
  const cardRef = useRef<HTMLDivElement>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const loadedRef = useRef(isPreloaded && initialClips.length > 0);
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const pexelsKeywordIndexRef = useRef(1);
  const pexelsKeywordCycles = useRef(
    buildPexelsKeywordCycles(segment.pexels_keywords),
  );

  const [manualKeyword, setManualKeyword] = useState("");
  const [manualSource, setManualSource] = useState<ManualSource>("pexels");
  const [loadingManual, setLoadingManual] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const manualPageRef = useRef(1);
  const [textExpanded, setTextExpanded] = useState(false);

  // Track clips added by "Add 4 More" using clip IDs
  const [add4MoreClipIds, setAdd4MoreClipIds] = useState<Set<string>>(
    new Set(),
  );

  // Track manual search groups: each group = { keyword, source, clipIds }
  const [searchGroups, setSearchGroups] = useState<
    { keyword: string; source: string; clipIds: Set<string> }[]
  >([]);

  const suggestedKeywords = useMemo(() => {
    const STOPWORDS = new Set([
      "the",
      "a",
      "an",
      "and",
      "or",
      "but",
      "in",
      "on",
      "at",
      "to",
      "for",
      "of",
      "with",
      "by",
      "is",
      "it",
      "be",
      "are",
      "was",
      "were",
      "has",
      "have",
      "do",
      "did",
      "will",
      "this",
      "that",
      "i",
      "you",
      "he",
      "she",
      "we",
      "they",
      "my",
      "your",
      "his",
      "her",
      "our",
      "their",
      "what",
      "when",
      "where",
      "how",
      "why",
      "who",
      "which",
      "as",
      "if",
      "so",
      "not",
      "can",
      "just",
      "about",
      "up",
      "out",
      "there",
      "then",
      "than",
      "very",
      "more",
      "all",
      "any",
      "some",
      "get",
      "go",
      "know",
      "think",
      "see",
      "look",
      "like",
      "make",
      "take",
      "come",
      "want",
      "need",
      "tell",
      "say",
      "said",
      "one",
      "two",
      "three",
      "really",
      "actually",
      "also",
      "even",
      "still",
      "back",
      "right",
      "okay",
      "yeah",
      "let",
      "re",
      "ve",
      "ll",
      "don",
    ]);

    const suggestions: string[] = [];

    // First: use existing AI-generated keywords from pexels_keywords
    const fromKeywords = (segment.pexels_keywords ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 2);
    for (const kw of fromKeywords) {
      if (!suggestions.includes(kw)) suggestions.push(kw);
      if (suggestions.length >= 5) break;
    }

    // Fill remaining slots from the segment text body
    if (suggestions.length < 5) {
      const words = (segment.text_body ?? "")
        .replace(/[^a-zA-Z\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 4 && !STOPWORDS.has(w.toLowerCase()));

      // Score by frequency
      const freq = new Map<string, number>();
      for (const w of words) {
        const lw = w.toLowerCase();
        freq.set(lw, (freq.get(lw) ?? 0) + 1);
      }
      const ranked = Array.from(freq.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([w]) => w);

      for (const w of ranked) {
        const alreadyIn = suggestions.some((s) => s.toLowerCase() === w);
        if (!alreadyIn) suggestions.push(w);
        if (suggestions.length >= 5) break;
      }
    }

    return suggestions.slice(0, 5);
  }, [segment.pexels_keywords, segment.text_body]);

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

    // If clips are already cached in storage, use them directly — no fetch needed.
    // This is critical: storage is the source of truth for clip indices used during export.
    const alreadyCached = storage.getSegmentClips(segment.id);
    if (alreadyCached.length > 0) {
      setClips(alreadyCached);
      setLoadingInitial(false);
      return;
    }

    setLoadingInitial(true);

    const controller = new AbortController();
    const hardTimeout = setTimeout(() => {
      controller.abort();
      setLoadingInitial(false);
    }, 40000);

    try {
      const firstKeyword =
        pexelsKeywordCycles.current[0] ?? segment.pexels_keywords ?? "";
      const initialSegment = { ...segment, pexels_keywords: firstKeyword };
      let newClips = await fetchPexelsClips(
        initialSegment,
        1,
        controller.signal,
      );

      if (!controller.signal.aborted && newClips.length === 0) {
        const simplified = firstKeyword
          .split(" ")
          .filter((w) => w.length > 0)
          .slice(0, 2)
          .join(" ");
        const retrySegment = { ...segment, pexels_keywords: simplified };
        newClips = await fetchPexelsClips(retrySegment, 1, controller.signal);
      }

      clearTimeout(hardTimeout);
      if (!controller.signal.aborted) {
        if (newClips.length > 0) {
          // addClips filters out non-horizontal Pexels clips before storing.
          // Use the stored result for setClips so UI indices always match storage indices.
          const stored = storage.addClips(segment.id, newClips);
          setClips(stored[segment.id] ?? []);
        }
        setLoadingInitial(false);
      }
    } catch (e) {
      clearTimeout(hardTimeout);
      if ((e as Error).name !== "AbortError") setLoadingInitial(false);
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
      { threshold: 0.1 },
    );
    observerRef.current.observe(el);
    return () => observerRef.current?.disconnect();
  }, [isPreloaded, initialClips.length, loadInitialClips]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  async function loadMore(source: "pexels" | "giphy" | "pixabay") {
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

    const timeoutMs = source === "giphy" ? 15000 : 20000;
    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      setLoadingMore(false);
      setLoadMoreError(true);
    }, timeoutMs);

    try {
      let newClips: Clip[] = [];
      if (source === "pexels") {
        const cycles = pexelsKeywordCycles.current;
        const idx = pexelsKeywordIndexRef.current;
        const keyword = cycles[idx % cycles.length];
        const page = Math.floor(idx / cycles.length) + 1;
        pexelsKeywordIndexRef.current += 1;
        newClips = await fetchPexelsClips(
          { ...segment, pexels_keywords: keyword },
          page,
        );
      } else if (source === "pixabay") {
        const keyword =
          (segment.pexels_keywords ?? "").split(",")[0]?.trim() ||
          segment.pexels_keywords;
        newClips = await fetchPixabayClips(keyword, 1, segment.id);
      } else {
        const nextPage = giphyPage + 1;
        newClips = await fetchGiphyClips(segment, nextPage);
        setGiphyPage(nextPage);
      }

      clearTimeout(timeoutId);
      if (!timedOut) {
        if (newClips.length > 0) {
          // Use the stored result so UI indices always match storage indices.
          const stored = storage.addClips(segment.id, newClips);
          const updatedClips = stored[segment.id] ?? [];
          setClips(updatedClips);
          // Track the new clip IDs for delete button
          const newIds = new Set(newClips.map((c) => c.id));
          setAdd4MoreClipIds((prev) => new Set([...prev, ...newIds]));
        } else {
          setLoadMoreError(true);
        }
      }
    } catch (err) {
      clearTimeout(timeoutId);
      if (!timedOut) {
        if (source === "pexels") {
          const msg = (err as Error)?.message ?? "";
          addToast(
            "error",
            msg.includes("no fallback key")
              ? "Pexels failed: add Pexels key in Settings for fallback."
              : "Pexels request failed. Please try again.",
          );
        } else if (source === "pixabay") {
          addToast("error", "Pixabay request failed. Please try again.");
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
      if (manualSource === "pexels") {
        newClips = await fetchPexelsClips(
          { ...segment, pexels_keywords: query },
          page,
        );
      } else if (manualSource === "pixabay") {
        newClips = await fetchPixabayClips(query, page, segment.id);
      } else {
        newClips = await fetchGiphyClips(
          { ...segment, giphy_keywords: query },
          page,
        );
      }
      manualPageRef.current += 1;
      if (newClips.length > 0) {
        // Use the stored result so UI indices always match storage indices.
        const stored = storage.addClips(segment.id, newClips);
        const updatedClips = stored[segment.id] ?? [];
        setClips(updatedClips);
        // Track the new clip IDs for delete button
        const newIds = new Set(newClips.map((c) => c.id));
        setSearchGroups((prev) => [
          ...prev,
          { keyword: query, source: manualSource, clipIds: newIds },
        ]);
      } else {
        addToast("info", "No clips found for that keyword.");
      }
    } catch (err) {
      addToast(
        "error",
        (err as Error)?.message ?? "Search failed. Please try again.",
      );
    } finally {
      setLoadingManual(false);
    }
  }

  function handleManualKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      manualPageRef.current = 1;
      handleManualSearch();
    }
  }

  // Delete all "Add 4 More" clips
  function deleteAdd4MoreClips() {
    if (add4MoreClipIds.size === 0) return;
    const currentClips = storage.getSegmentClips(segment.id);
    const toKeep = currentClips.filter((c) => !add4MoreClipIds.has(c.id));
    const newMap = { ...storage.getClips(), [segment.id]: toKeep };
    storage.setClips(newMap);
    setClips(toKeep);
    setAdd4MoreClipIds(new Set());
  }

  // Delete a search group
  function deleteSearchGroup(groupIndex: number) {
    const group = searchGroups[groupIndex];
    if (!group) return;
    const currentClips = storage.getSegmentClips(segment.id);
    const toKeep = currentClips.filter((c) => !group.clipIds.has(c.id));
    const newMap = { ...storage.getClips(), [segment.id]: toKeep };
    storage.setClips(newMap);
    setClips(toKeep);
    setSearchGroups((prev) => prev.filter((_, i) => i !== groupIndex));
  }

  // Handle image upload
  function handleImageUploadClick() {
    imageInputRef.current?.click();
  }

  async function handleImageSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const ext = file.name.split(".").pop()?.toLowerCase() || "";
    if (!["jpg", "jpeg", "png", "webp"].includes(ext)) {
      addToast("error", "Only JPG, PNG and WEBP accepted");
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      addToast("error", "File too large (max 10MB)");
      return;
    }

    setUploadingImage(true);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/upload-image", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Upload failed");
      }

      const data = (await res.json()) as {
        imageId: string;
        filename: string;
        url: string;
        fileType: string;
      };

      const upload: CustomUpload = {
        id: data.imageId,
        segmentId: segment.id,
        fileName: data.filename,
        fileType: data.fileType,
        fileSize: file.size,
        mediaData: data.url,
        thumbnailData: data.url,
      };

      storage.addCustomUpload(segment.id, upload);

      const newClip: Clip = {
        id: `custom-img-${data.imageId}`,
        segmentId: segment.id,
        source: "custom",
        thumbnail_url: data.url,
        media_url: data.url,
        width: 1920,
        height: 1080,
        duration: 5,
        fileName: data.filename,
        fileType: data.fileType,
      } as Clip;

      const currentClips = storage.getSegmentClips(segment.id);
      const newClips = [...currentClips, newClip];
      storage.setClips({ ...storage.getClips(), [segment.id]: newClips });
      setClips(newClips);

      addToast("success", "Image uploaded!");
    } catch (err) {
      addToast("error", (err as Error).message || "Failed to upload image");
    } finally {
      setUploadingImage(false);
      if (imageInputRef.current) imageInputRef.current.value = "";
    }
  }

  const skeletons = Array.from({ length: 4 });

  return (
    <div
      ref={cardRef}
      className="bg-[#111] rounded-2xl overflow-hidden shadow-lg"
    >
      {/* Header */}
      <div className="px-4 py-3 sm:px-6 sm:py-4 flex items-center justify-between border-b border-gray-800">
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
          Segment {index + 1} of {total}
        </span>
        <span className="text-xs text-gray-500">
          {segment.duration_estimate}
        </span>
      </div>

      {/* Script text */}
      <div className="px-4 py-3 sm:px-6 sm:py-4 border-b border-gray-800">
        <p
          className={`text-gray-300 text-sm leading-relaxed ${textExpanded ? "" : "line-clamp-3"}`}
        >
          {segment.text_body}
        </p>
        <button
          onClick={() => setTextExpanded((v) => !v)}
          className="mt-1.5 flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 transition-colors"
        >
          <ChevronDown
            size={13}
            className={`transition-transform duration-200 ${textExpanded ? "rotate-180" : ""}`}
          />
          {textExpanded ? "Show less" : "Show full text"}
        </button>
      </div>

      {/* Single control bar: search LEFT, Add 4 More RIGHT */}
      <div className="px-4 py-2 sm:px-6 border-b border-gray-800 flex items-center gap-2">
        {/* Source pills */}
        <div className="flex rounded-lg overflow-hidden border border-gray-700 text-xs shrink-0">
          {(["pexels", "pixabay", "giphy"] as ManualSource[]).map((src) => (
            <button
              key={src}
              onClick={() => setManualSource(src)}
              className={`px-2.5 py-1.5 capitalize transition-colors ${
                manualSource === src
                  ? "bg-gray-700 text-white font-medium"
                  : "text-gray-500 hover:text-gray-300 hover:bg-gray-800"
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
          onChange={(e) => {
            setManualKeyword(e.target.value);
            manualPageRef.current = 1;
          }}
          onKeyDown={handleManualKeyDown}
          placeholder="Type your own keyword..."
          className="flex-1 bg-[#1a1a1a] border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-gray-500 min-w-0"
        />

        {/* Search button */}
        <button
          onClick={() => {
            manualPageRef.current = 1;
            handleManualSearch();
          }}
          disabled={loadingManual || !manualKeyword.trim()}
          className="flex items-center gap-1.5 text-xs font-medium text-gray-300 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors px-3 py-1.5 rounded-lg hover:bg-gray-800 active:scale-95 border border-gray-700 shrink-0"
        >
          {loadingManual ? "Searching…" : "Search"}
          <Search size={12} />
        </button>

        {/* Divider */}
        <div className="h-5 w-px bg-gray-700 shrink-0" />

        {/* Add 4 More */}
        <div className="relative shrink-0" ref={dropdownRef}>
          <button
            disabled={cooldown > 0 || loadingMore}
            onClick={() => {
              setShowDropdown((v) => !v);
              setLoadMoreError(false);
            }}
            className="flex items-center gap-1.5 text-sm font-medium text-gray-300 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors px-3 py-1.5 rounded-lg hover:bg-gray-800 active:scale-95"
          >
            <Plus size={15} />
            {cooldown > 0
              ? `Wait ${cooldown}s…`
              : loadingMore
                ? "Loading…"
                : "Add 4 More"}
            <ChevronDown size={13} />
          </button>

          {showDropdown && (
            <div className="absolute top-full right-0 mt-1 bg-[#1a1a1a] border border-gray-700 rounded-xl shadow-xl z-20 overflow-hidden min-w-[130px]">
              <button
                onClick={() => loadMore("pexels")}
                className="w-full text-left px-4 py-3 text-sm text-gray-300 hover:text-white hover:bg-gray-800 transition-colors"
              >
                Pexels
              </button>
              <button
                onClick={() => loadMore("pixabay")}
                className="w-full text-left px-4 py-3 text-sm text-gray-300 hover:text-white hover:bg-gray-800 transition-colors border-t border-gray-800"
              >
                Pixabay
              </button>
              <button
                onClick={() => loadMore("giphy")}
                className="w-full text-left px-4 py-3 text-sm text-gray-300 hover:text-white hover:bg-gray-800 transition-colors border-t border-gray-800"
              >
                Giphy
              </button>
            </div>
          )}
        </div>

        {/* Delete Add 4 More clips button */}
        {add4MoreClipIds.size > 0 && (
          <button
            onClick={deleteAdd4MoreClips}
            className="flex items-center gap-1.5 text-xs font-medium text-red-400 hover:text-red-300 transition-colors px-2 py-1.5 rounded-lg hover:bg-red-900/20 shrink-0"
            title={`Delete ${add4MoreClipIds.size} Add 4 More clips`}
          >
            <Trash2 size={14} />
            <span>Delete</span>
          </button>
        )}

        {/* Divider */}
        <div className="h-5 w-px bg-gray-700 shrink-0" />

        {/* Image upload button */}
        <button
          onClick={handleImageUploadClick}
          disabled={uploadingImage}
          className="flex items-center gap-1.5 text-xs font-medium text-gray-300 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors px-3 py-1.5 rounded-lg hover:bg-gray-800 active:scale-95 border border-gray-700 shrink-0"
          title="Upload image (JPG, PNG, WEBP)"
        >
          {uploadingImage ? (
            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          ) : (
            <ImageIcon size={14} />
          )}
          <span>IMG</span>
        </button>

        {/* Hidden file input */}
        <input
          ref={imageInputRef}
          type="file"
          accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={handleImageSelected}
        />
      </div>

      {/* Search groups delete buttons */}
      {searchGroups.length > 0 && (
        <div className="px-4 py-2 sm:px-6 border-b border-gray-800 flex items-center gap-2 flex-wrap">
          {searchGroups.map((group, i) => (
            <button
              key={i}
              onClick={() => deleteSearchGroup(i)}
              className="flex items-center gap-1.5 text-xs font-medium text-red-400 hover:text-red-300 transition-colors px-2.5 py-1.5 rounded-lg bg-red-900/20 hover:bg-red-900/30 border border-red-900/50"
            >
              <Trash2 size={12} />
              <span>
                Delete "{group.keyword}" ({group.clipIds.size})
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Clips grid */}
      <div className="p-4 sm:p-6">
        {loadingInitial ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {skeletons.map((_, i) => (
              <div
                key={i}
                className="aspect-video animate-pulse bg-gray-800 rounded-lg"
              />
            ))}
          </div>
        ) : clips.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-gray-500 text-sm">
              No clips found. Click "Add 4 More" to load stock videos.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {clips.map((clip, clipIndex) => (
              <ClipCard
                key={`segment_${index}_clip_${clipIndex}`}
                clip={clip}
                isSelected={selectedSet.has(
                  `segment_${index}_clip_${clipIndex}`,
                )}
                animIndex={clipIndex}
                bulkSelectNonce={bulkSelectNonce}
                segmentIndex={index}
                clipIndex={clipIndex}
                onSelectionChange={onSelectionChange}
              />
            ))}
            {loadingMore &&
              skeletons.map((_, i) => (
                <div
                  key={`sk-${i}`}
                  className="aspect-video animate-pulse bg-gray-800 rounded-lg"
                />
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
  );
}
