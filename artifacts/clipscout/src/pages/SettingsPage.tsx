import { useState } from 'react';
import { storage } from '../storage';
import { useToastCtx } from '../context/ToastContext';

interface Props {
  onSave: () => void;
  onBack?: () => void;
  isOverlay?: boolean;
}

export function SettingsPage({ onSave, onBack, isOverlay = false }: Props) {
  const [groqKey, setGroqKey] = useState(storage.getGroqKey());
  const [giphyKey, setGiphyKey] = useState(storage.getGiphyKey());
  const [pexelsKey, setPexelsKey] = useState(storage.getPexelsKey());
  const { addToast } = useToastCtx();

  function handleSave() {
    if (!giphyKey.trim()) {
      addToast('error', 'Giphy API key is required.');
      return;
    }
    storage.setGroqKey(groqKey.trim());
    storage.setGiphyKey(giphyKey.trim());
    storage.setPexelsKey(pexelsKey.trim());
    addToast('success', 'Settings saved!');
    onSave();
  }

  return (
    <div className={isOverlay ? 'fixed inset-0 bg-[#0a0a0a] z-50 flex items-center justify-center p-4' : 'min-h-screen bg-[#0a0a0a] flex items-center justify-center p-4'}>
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
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Groq API Key
            </label>
            <input
              type="password"
              value={groqKey}
              onChange={(e) => setGroqKey(e.target.value)}
              placeholder="Your Groq API key (console.groq.com)"
              className="w-full bg-[#1a1a1a] border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-[#22c55e] text-base"
            />
            <p className="mt-1 text-xs text-gray-500">Used for script analysis with Llama 3.1 8B. Get a free key at console.groq.com</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Giphy API Key
            </label>
            <input
              type="password"
              value={giphyKey}
              onChange={(e) => setGiphyKey(e.target.value)}
              placeholder="Your Giphy API key"
              className="w-full bg-[#1a1a1a] border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-[#22c55e] text-base"
            />
            <p className="mt-1 text-xs text-gray-500">Used to fetch GIFs for each segment</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Pexels API Key <span className="text-gray-600">(optional fallback)</span>
            </label>
            <input
              type="password"
              value={pexelsKey}
              onChange={(e) => setPexelsKey(e.target.value)}
              placeholder="Your Pexels API key"
              className="w-full bg-[#1a1a1a] border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-[#22c55e] text-base"
            />
            <p className="mt-1 text-xs text-gray-500">
              Videos load via server proxy. This key is only used if the proxy is unavailable.
            </p>
          </div>

          <button
            onClick={handleSave}
            className="w-full bg-[#22c55e] hover:bg-[#16a34a] text-white font-semibold py-4 rounded-xl text-lg transition-colors active:scale-95"
          >
            Save Settings
          </button>
        </div>
      </div>
    </div>
  );
}
