import { useState, useEffect, useCallback } from "react";
import { storage } from "../storage";
import { useToastCtx } from "../context/ToastContext";
import { PasswordInput } from "../components/PasswordInput";

interface Props {
  onSave: () => void;
  onBack?: () => void;
  isOverlay?: boolean;
}

export function SettingsPage({ onSave, onBack, isOverlay = false }: Props) {
  const [groqKey, setGroqKey] = useState("");
  const [geminiKey, setGeminiKey] = useState("");
  const [giphyKey, setGiphyKey] = useState("");
  const [pexelsKey, setPexelsKey] = useState("");
  const [pixabayKey, setPixabayKey] = useState("");
  const [youtubeKey, setYouTubeKey] = useState("");
  const [assemblyAIKey, setAssemblyAIKey] = useState("");
  const [gififyKey, setGififyKey] = useState("");
  const { addToast } = useToastCtx();

  const loadFromStorage = useCallback(() => {
    const groq = storage.getGroqKey();
    const gemini = storage.getGeminiKey();
    const giphy = storage.getGiphyKey();
    const pexels = storage.getPexelsKey();
    const pixabay = storage.getPixabayKey();
    const youtube = storage.getYouTubeKey();
    const assembly = storage.getAssemblyAIKey();
    const gifify = storage.getGififyKey();

    console.log(
      "[Settings] Loading from storage - Groq:",
      groq ? `${groq.slice(0, 5)}...` : "empty",
      "Pexels:",
      pexels ? `${pexels.slice(0, 5)}...` : "empty",
    );

    setGroqKey(groq);
    setGeminiKey(gemini);
    setGiphyKey(giphy);
    setPexelsKey(pexels);
    setPixabayKey(pixabay);
    setYouTubeKey(youtube);
    setAssemblyAIKey(assembly);
    setGififyKey(gifify);
  }, []);

  useEffect(() => {
    loadFromStorage();
  }, [loadFromStorage]);

  function handleSave() {
    console.log(
      "[Settings] Saving - Groq:",
      groqKey ? `${groqKey.slice(0, 5)}... (${groqKey.length} chars)` : "empty",
    );

    if (!giphyKey.trim() && !gififyKey.trim()) {
      addToast("error", "At least one of Giphy or Gifify API key is required.");
      return;
    }
    storage.setGroqKey(groqKey.trim());
    storage.setGeminiKey(geminiKey.trim());
    storage.setGiphyKey(giphyKey.trim());
    storage.setPexelsKey(pexelsKey.trim());
    storage.setPixabayKey(pixabayKey.trim());
    storage.setYouTubeKey(youtubeKey.trim());
    storage.setAssemblyAIKey(assemblyAIKey.trim());
    storage.setGififyKey(gififyKey.trim());

    console.log(
      "[Settings] After save - Groq:",
      storage.getGroqKey() ? `${storage.getGroqKey().slice(0, 5)}...` : "empty",
    );

    addToast("success", "Settings saved!");
    onSave();
  }

  function handleClearAll() {
    if (confirm("Clear all API keys? This cannot be undone.")) {
      storage.setGroqKey("");
      storage.setGeminiKey("");
      storage.setGiphyKey("");
      storage.setPexelsKey("");
      storage.setPixabayKey("");
      storage.setYouTubeKey("");
      storage.setAssemblyAIKey("");
      storage.setGififyKey("");

      setGroqKey("");
      setGeminiKey("");
      setGiphyKey("");
      setPexelsKey("");
      setPixabayKey("");
      setYouTubeKey("");
      setAssemblyAIKey("");
      setGififyKey("");

      console.log(
        "[Settings] Cleared all - Groq in storage:",
        storage.getGroqKey() ? "still has value" : "empty",
      );

      addToast("info", "All API keys cleared.");
    }
  }

  return (
    <div
      className={
        isOverlay
          ? "fixed inset-0 bg-[#0a0a0a] z-50 flex items-center justify-center p-4"
          : "min-h-screen bg-[#0a0a0a] flex items-center justify-center p-4"
      }
    >
      <div className="w-full max-w-md">
        <div className="flex items-center gap-3 mb-8">
          {onBack && (
            <button
              onClick={onBack}
              className="text-gray-400 hover:text-white transition-colors text-2xl leading-none"
            >
              ←
            </button>
          )}
          <h1 className="text-2xl font-bold text-white">Settings</h1>
        </div>

        <div className="space-y-6">
          <PasswordInput
            id="groq-key"
            label="Groq API Key"
            value={groqKey}
            onChange={setGroqKey}
            placeholder="Your Groq API key (console.groq.com)"
            description="Used for script analysis with Llama 3.1 8B. Get a free key at console.groq.com"
            showCharCount
          />

          <PasswordInput
            id="gemini-key"
            label="Gemini API Key"
            value={geminiKey}
            onChange={setGeminiKey}
            placeholder="Your Gemini API key"
            description="Used for Text-to-Speech voices in iMessage videos."
          />

          <PasswordInput
            id="pixabay-key"
            label="Pixabay API Key"
            value={pixabayKey}
            onChange={setPixabayKey}
            placeholder="Your Pixabay API key"
            description="Used for Pixabay video search. Get a free key at pixabay.com/api/docs/"
          />

          <PasswordInput
            id="youtube-key"
            label="YouTube API Key"
            value={youtubeKey}
            onChange={setYouTubeKey}
            placeholder="Your YouTube Data API v3 key"
            description="Used for YouTube Analytics. Get a free key at console.cloud.google.com → YouTube Data API v3"
          />

          <PasswordInput
            id="assemblyai-key"
            label="AssemblyAI API Key"
            value={assemblyAIKey}
            onChange={setAssemblyAIKey}
            placeholder="Your AssemblyAI API key"
            description="Used for AI subtitle generation. Get a free key at assemblyai.com"
          />

          <PasswordInput
            id="gifify-key"
            label="Gifify API Key"
            value={gififyKey}
            onChange={setGififyKey}
            placeholder="Your Gifify API key"
            description="Used for converting videos to GIFs."
          />

          <PasswordInput
            id="pexels-key"
            label="Pexels API Key (fallback)"
            value={pexelsKey}
            onChange={setPexelsKey}
            placeholder="Your Pexels API key"
            description="Videos load via server proxy. This key is only used if the proxy is unavailable."
          />

          <div className="border-t border-gray-800 pt-4 mt-6">
            <PasswordInput
              id="giphy-key"
              label="Giphy API Key"
              value={giphyKey}
              onChange={setGiphyKey}
              placeholder="Your Giphy API key"
              description="Used for GIF search. Get a free key at developers.giphy.com"
              required
            />
          </div>

          <button
            onClick={handleSave}
            className="w-full bg-[#22c55e] hover:bg-[#16a34a] text-white font-semibold py-4 rounded-xl text-lg transition-colors active:scale-95"
          >
            Save Settings
          </button>

          <button
            onClick={handleClearAll}
            className="w-full bg-transparent hover:bg-red-900/30 text-red-500 font-semibold py-3 rounded-xl text-sm transition-colors border border-red-900/50"
          >
            Clear All Keys
          </button>
        </div>
      </div>
    </div>
  );
}
