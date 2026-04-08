import { useState, useEffect } from "react";
import { ToastProvider } from "./context/ToastContext";
import { PlayingProvider } from "./context/PlayingContext";
import { ToastContainer } from "./components/Toast";
import { SettingsPage } from "./pages/SettingsPage";
import { HomePage } from "./pages/HomePage";
import { GridPage } from "./pages/GridPage";
import { QuickSendPage } from "./pages/QuickSendPage";
import { SubtitlePage } from "./pages/SubtitlePage";
import { AppSidebar } from "./components/AppSidebar";
import { TextAutomation } from "./features/text-automation/TextAutomation";
import { YouTubeAnalytics } from "./features/youtube-analytics/YouTubeAnalytics";
import { storage } from "./storage";
import type { Page } from "./types";

function AppContent() {
  const [page, setPage] = useState<Page>("home");
  const [showSettings, setShowSettings] = useState(false);
  const [keysChecked, setKeysChecked] = useState(false);
  const [needsKeys, setNeedsKeys] = useState(false);

  useEffect(() => {
    const giphy = storage.getGiphyKey();
    if (!giphy) {
      setNeedsKeys(true);
    }
    setKeysChecked(true);
  }, []);

  if (!keysChecked) return null;

  if (needsKeys) {
    return (
      <SettingsPage onSave={() => setNeedsKeys(false)} isOverlay={false} />
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
    <div className="flex flex-col md:flex-row">
      <AppSidebar
        currentPage={page}
        onNavigate={(p) => {
          setPage(p);
        }}
      />
      <div className="flex-1 pl-0 md:pl-48 min-w-0 pb-20 md:pb-0">
        {page === "home" && (
          <HomePage
            onAnalyzed={() => setPage("grid")}
            onSettings={() => setShowSettings(true)}
          />
        )}
        {page === "grid" && (
          <GridPage
            onBack={() => setPage("home")}
            onSettings={() => setShowSettings(true)}
          />
        )}
        {page === "quicksend" && <QuickSendPage />}
        {page === "subtitles" && <SubtitlePage />}
        {page === "text-automation" && <TextAutomation />}
        {page === "youtube-analytics" && <YouTubeAnalytics />}
      </div>
    </div>
  );
}

function App() {
  return (
    <ToastProvider>
      <PlayingProvider>
        <AppContent />
        <ToastContainer />
      </PlayingProvider>
    </ToastProvider>
  );
}

export default App;
