import React, { createContext, useCallback, useContext, useState } from 'react';

interface PlayingContextValue {
  playingId: string | null;
  setPlayingId: (id: string | null) => void;
}

const PlayingContext = createContext<PlayingContextValue | null>(null);

export function PlayingProvider({ children }: { children: React.ReactNode }) {
  const [playingId, setPlayingIdRaw] = useState<string | null>(null);

  const setPlayingId = useCallback((id: string | null) => {
    setPlayingIdRaw(id);
  }, []);

  return (
    <PlayingContext.Provider value={{ playingId, setPlayingId }}>
      {children}
    </PlayingContext.Provider>
  );
}

export function usePlaying() {
  const ctx = useContext(PlayingContext);
  if (!ctx) throw new Error('usePlaying must be used within PlayingProvider');
  return ctx;
}
