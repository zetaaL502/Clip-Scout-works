import { useState, useRef, useEffect } from 'react';
import { Check, Play, Pause, SquareCheck } from 'lucide-react';
import type { Clip } from '../types';
import { storage } from '../storage';
import { usePlaying } from '../context/PlayingContext';

interface Props {
  clip: Clip;
  onSelectionChange: () => void;
}

export function ClipCard({ clip, onSelectionChange }: Props) {
  const [selected, setSelected] = useState(() => storage.isSelected(clip.id));
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showVideo, setShowVideo] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const { playingId, setPlayingId } = usePlaying();

  useEffect(() => {
    if (playingId !== clip.id && showVideo) {
      videoRef.current?.pause();
      setIsPlaying(false);
    }
  }, [playingId, clip.id, showVideo]);

  function handleSelect(e: React.MouseEvent) {
    e.stopPropagation();
    storage.toggleSelection(clip.id);
    setSelected((prev) => !prev);
    onSelectionChange();
  }

  function handlePlayPause(e: React.MouseEvent) {
    e.stopPropagation();

    if (!showVideo) {
      setShowVideo(true);
      setPlayingId(clip.id);
      setIsPlaying(true);
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.play().catch(() => {});
        }
      }, 50);
      return;
    }

    if (isPlaying) {
      videoRef.current?.pause();
      setIsPlaying(false);
    } else {
      setPlayingId(clip.id);
      videoRef.current?.play().catch(() => {});
      setIsPlaying(true);
    }
  }

  function handleVideoEnded() {
    setIsPlaying(false);
  }

  const isGif = clip.source === 'giphy';

  return (
    <div
      className="relative rounded-lg overflow-hidden bg-gray-800 aspect-video group"
      style={{
        border: selected ? '3px solid #22c55e' : '3px solid transparent',
        minHeight: '44px',
        minWidth: '44px',
      }}
    >
      {/* Thumbnail */}
      {!imgLoaded && !imgError && !showVideo && (
        <div className="absolute inset-0 animate-pulse bg-gray-800 rounded-lg" />
      )}
      {!imgError && !showVideo && (
        <img
          src={clip.thumbnail_url}
          alt=""
          loading="lazy"
          className={`w-full h-full object-cover transition-opacity ${imgLoaded ? 'opacity-100' : 'opacity-0'}`}
          onLoad={() => setImgLoaded(true)}
          onError={() => setImgError(true)}
        />
      )}
      {imgError && !showVideo && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-800 text-gray-500 text-xs">
          No preview
        </div>
      )}

      {/* Video player */}
      {showVideo && (
        <video
          ref={videoRef}
          src={clip.media_url}
          className="w-full h-full object-cover"
          loop
          playsInline
          onEnded={handleVideoEnded}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
        />
      )}

      {/* Play / Pause button — center overlay */}
      {!isGif && (
        <button
          onClick={handlePlayPause}
          className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/30 transition-colors focus:outline-none"
          aria-label={isPlaying ? 'Pause' : 'Play'}
        >
          <div className="w-10 h-10 rounded-full bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
            {isPlaying ? (
              <Pause size={18} className="text-white" fill="white" />
            ) : (
              <Play size={18} className="text-white" fill="white" />
            )}
          </div>
        </button>
      )}

      {/* GIF label */}
      {isGif && (
        <div className="absolute bottom-7 left-1.5 text-xs bg-black/60 text-white px-1.5 py-0.5 rounded font-medium pointer-events-none">
          GIF
        </div>
      )}

      {/* Select button — bottom bar */}
      <button
        onClick={handleSelect}
        className={`absolute bottom-0 left-0 right-0 flex items-center justify-center gap-1 py-1 text-xs font-semibold transition-colors ${
          selected
            ? 'bg-[#22c55e] text-white'
            : 'bg-black/60 text-gray-300 hover:bg-black/80 hover:text-white'
        }`}
        aria-label={selected ? 'Deselect clip' : 'Select clip'}
      >
        {selected ? (
          <>
            <Check size={11} strokeWidth={3} />
            Selected
          </>
        ) : (
          <>
            <SquareCheck size={11} />
            Select
          </>
        )}
      </button>

      {/* Selected checkmark badge */}
      {selected && (
        <div className="absolute top-1.5 right-1.5 w-5 h-5 bg-[#22c55e] rounded-full flex items-center justify-center shadow pointer-events-none">
          <Check size={11} className="text-white" strokeWidth={3} />
        </div>
      )}
    </div>
  );
}
