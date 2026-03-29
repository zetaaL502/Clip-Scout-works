import { useState, useEffect } from 'react';
import { ToastProvider } from './context/ToastContext';
import { ToastContainer } from './components/Toast';
import { SettingsPage } from './pages/SettingsPage';
import { HomePage } from './pages/HomePage';
import { GridPage } from './pages/GridPage';
import { storage } from './storage';
import type { Page } from './types';

function AppContent() {
  const [page, setPage] = useState<Page>('home');
  const [showSettings, setShowSettings] = useState(false);
  const [keysChecked, setKeysChecked] = useState(false);
  const [needsKeys, setNeedsKeys] = useState(false);

  useEffect(() => {
    const groq = storage.getGroqKey();
    const giphy = storage.getGiphyKey();
    if (!groq || !giphy) {
      setNeedsKeys(true);
    }
    setKeysChecked(true);
  }, []);

  if (!keysChecked) return null;

  if (needsKeys) {
    return (
      <SettingsPage
        onSave={() => setNeedsKeys(false)}
        isOverlay={false}
      />
    );
  }

  if (showSettings) {
    return (
      <SettingsPage
        onSave={() => setShowSettings(false)}
        onBack={() => setShowSettings(false)}
        isOverlay={false}
      />
    );
  }

  return (
    <>
      {page === 'home' && (
        <HomePage
          onAnalyzed={() => setPage('grid')}
          onSettings={() => setShowSettings(true)}
        />
      )}
      {page === 'grid' && (
        <GridPage
          onBack={() => setPage('home')}
          onSettings={() => setShowSettings(true)}
        />
      )}
    </>
  );
}

function App() {
  return (
    <ToastProvider>
      <AppContent />
      <ToastContainer />
    </ToastProvider>
  );
}

export default App;
