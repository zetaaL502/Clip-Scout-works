import { useState } from 'react';
import { Check, Play } from 'lucide-react';
import type { Clip } from '../types';
import { storage } from '../storage';

interface Props {
  clip: Clip;
  onSelectionChange: () => void;
}

export function ClipCard({ clip, onSelectionChange }: Props) {
  const [selected, setSelected] = useState(() => storage.isSelected(clip.id));
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgError, setImgError] = useState(false);

  function toggle() {
    storage.toggleSelection(clip.id);
    setSelected((prev) => !prev);
    onSelectionChange();
  }

  return (
    <button
      onClick={toggle}
      className="relative w-full overflow-hidden rounded-lg bg-gray-800 aspect-video focus:outline-none group"
      style={{
        border: selected ? '4px solid #22c55e' : '4px solid transparent',
        minHeight: '44px',
        minWidth: '44px',
      }}
    >
      {!imgLoaded && !imgError && (
        <div className="absolute inset-0 animate-pulse bg-gray-800 rounded-lg" />
      )}
      {!imgError && (
        <img
          src={clip.thumbnail_url}
          alt=""
          loading="lazy"
          className={`w-full h-full object-cover transition-opacity ${imgLoaded ? 'opacity-100' : 'opacity-0'}`}
          onLoad={() => setImgLoaded(true)}
          onError={() => setImgError(true)}
        />
      )}
      {imgError && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-800 text-gray-500 text-xs">
          No preview
        </div>
      )}

      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center">
        <Play className="text-white opacity-0 group-hover:opacity-100 transition-opacity" size={32} fill="white" />
      </div>

      {selected && (
        <div className="absolute top-1.5 right-1.5 w-6 h-6 bg-[#22c55e] rounded-full flex items-center justify-center shadow-lg">
          <Check size={14} className="text-white" strokeWidth={3} />
        </div>
      )}

      {clip.source === 'giphy' && (
        <div className="absolute bottom-1 left-1 text-xs bg-black/60 text-white px-1.5 py-0.5 rounded font-medium">
          GIF
        </div>
      )}
    </button>
  );
}
