import { useState, useRef, useEffect } from 'react';
import { Check, Play, Pause, SquareCheck } from 'lucide-react';
import type { Clip } from '../types';
import { storage } from '../storage';
import { usePlaying } from '../context/PlayingContext';

interface Props {
  clip: Clip;
  isSelected: boolean;
  animIndex: number;
  onSelectionChange: () => void;
}

export function ClipCard({ clip, isSelected, animIndex, onSelectionChange }: Props) {
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showMedia, setShowMedia] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const { playingId, setPlayingId } = usePlaying();
  const isGif = clip.source === 'giphy';

  // Stagger delay: applied when selecting (going to selected), instant when deselecting
  const staggerDelay = isSelected ? `${Math.min(animIndex * 50, 200)}ms` : '0ms';

  // When a different clip starts playing, stop this one
  useEffect(() => {
    if (playingId !== clip.id && showMedia) {
      if (!isGif) {
        videoRef.current?.pause();
      }
      setShowMedia(false);
      setIsPlaying(false);
    }
  }, [playingId, clip.id, showMedia, isGif]);

  function handleSelect(e: React.MouseEvent) {
    e.stopPropagation();
    storage.toggleSelection(clip.id);
    onSelectionChange();
  }

  function handlePlayPause(e: React.MouseEvent) {
    e.stopPropagation();

    if (!showMedia) {
      setShowMedia(true);
      setPlayingId(clip.id);
      setIsPlaying(true);
      if (!isGif) {
        setTimeout(() => {
          videoRef.current?.play().catch(() => {});
        }, 50);
      }
      return;
    }

    if (isGif) {
      setShowMedia(false);
      setIsPlaying(false);
    } else {
      if (isPlaying) {
        videoRef.current?.pause();
        setIsPlaying(false);
      } else {
        setPlayingId(clip.id);
        videoRef.current?.play().catch(() => {});
        setIsPlaying(true);
      }
    }
  }

  return (
    <div
      className="relative rounded-lg overflow-hidden bg-gray-800 aspect-video group"
      style={{
        border: isSelected ? '3px solid #22c55e' : '3px solid transparent',
        minHeight: '44px',
        minWidth: '44px',
        transition: 'border-color 180ms ease',
        transitionDelay: staggerDelay,
      }}
    >
      {/* Thumbnail (shown when not playing) */}
      {!imgLoaded && !imgError && !showMedia && (
        <div className="absolute inset-0 animate-pulse bg-gray-800 rounded-lg" />
      )}
      {!imgError && !showMedia && (
        <img
          src={clip.thumbnail_url}
          alt=""
          loading="lazy"
          className={`w-full h-full object-cover transition-opacity ${imgLoaded ? 'opacity-100' : 'opacity-0'}`}
          onLoad={() => setImgLoaded(true)}
          onError={() => setImgError(true)}
        />
      )}
      {imgError && !showMedia && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-800 text-gray-500 text-xs">
          No preview
        </div>
      )}

      {/* Animated GIF (shown when playing for Giphy clips) */}
      {showMedia && isGif && (
        <img
          src={clip.media_url}
          alt=""
          className="w-full h-full object-cover"
        />
      )}

      {/* Video player (shown when playing for Pexels clips) */}
      {showMedia && !isGif && (
        <video
          ref={videoRef}
          src={clip.media_url}
          className="w-full h-full object-cover"
          loop
          playsInline
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
        />
      )}

      {/* Play / Pause button — center overlay */}
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

      {/* GIF label */}
      {isGif && (
        <div className="absolute bottom-7 left-1.5 text-xs bg-black/60 text-white px-1.5 py-0.5 rounded font-medium pointer-events-none">
          GIF
        </div>
      )}

      {/* Select button — bottom bar */}
      <button
        onClick={handleSelect}
        className={`absolute bottom-0 left-0 right-0 flex items-center justify-center gap-1 py-1 text-xs font-semibold ${
          isSelected
            ? 'bg-[#22c55e] text-white'
            : 'bg-black/60 text-gray-300 hover:bg-black/80 hover:text-white'
        }`}
        style={{
          transition: 'background-color 180ms ease',
          transitionDelay: staggerDelay,
        }}
        aria-label={isSelected ? 'Deselect clip' : 'Select clip'}
      >
        {isSelected ? (
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
      <div
        className="absolute top-1.5 right-1.5 w-5 h-5 bg-[#22c55e] rounded-full flex items-center justify-center shadow pointer-events-none"
        style={{
          opacity: isSelected ? 1 : 0,
          transform: isSelected ? 'scale(1)' : 'scale(0.5)',
          transition: 'opacity 180ms ease, transform 180ms ease',
          transitionDelay: staggerDelay,
        }}
      >
        <Check size={11} className="text-white" strokeWidth={3} />
      </div>
    </div>
  );
}
