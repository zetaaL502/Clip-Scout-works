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
import { YouTubeAnalytics } from "./features/youtube-analytics/YouTubeAnalytics";
import { GeminiChat } from "./components/GeminiChat";
import { Bot } from "lucide-react";
import { storage } from "./storage";
import type { Page } from "./types";

function AppContent() {
  const [page, setPage] = useState<Page>("home");
  const [showSettings, setShowSettings] = useState(false);
  const [keysChecked, setKeysChecked] = useState(false);
  const [needsKeys, setNeedsKeys] = useState(false);
  const [showGemini, setShowGemini] = useState(false);

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
          if (p === "grid") {
            const project = storage.getProject();
            const segments = storage.getSegments();
            if (!project || segments.length === 0) {
              setPage("home");
              return;
            }
          }
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
        {page === "youtube-analytics" && <YouTubeAnalytics />}
      </div>

      {/* Gemini Chat Button */}
      <button
        onClick={() => setShowGemini(true)}
        className="fixed bottom-4 right-4 w-14 h-14 bg-gradient-to-br from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white rounded-full shadow-xl flex items-center justify-center transition-all z-40 hover:scale-110"
      >
        <Bot size={24} />
      </button>

      {/* Gemini Chat Widget */}
      <GeminiChat isOpen={showGemini} onClose={() => setShowGemini(false)} />
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
