import { useState, useEffect, useRef } from 'react';
import { Settings } from 'lucide-react';
import { analyzeScript } from '../api';
import { storage } from '../storage';
import { useToastCtx } from '../context/ToastContext';
import type { Segment } from '../types';

interface Props {
  onAnalyzed: () => void;
  onSettings: () => void;
}

export function HomePage({ onAnalyzed, onSettings }: Props) {
  const { addToast } = useToastCtx();
  const [script, setScript] = useState('');
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState('Analyzing script…');
  const [scriptError, setScriptError] = useState('');
  const [hasProject, setHasProject] = useState(false);
  const statusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const project = storage.getProject();
    const segments = storage.getSegments();
    setHasProject(!!(project && segments.length > 0));
  }, []);

  useEffect(() => {
    if (!loading) {
      setStatusMsg('Analyzing script…');
    }
  }, [loading]);

  function validate(): boolean {
    if (script.trim().length < 200) {
      setScriptError('Script must be at least 200 characters.');
      return false;
    }
    setScriptError('');
    return true;
  }

  async function handleSubmit() {
    if (!validate()) return;
    if (!navigator.onLine) {
      addToast('error', 'No internet connection detected.');
      return;
    }

    setLoading(true);
    setStatusMsg('Reading your script…');
    try {
      const rawSegments = await analyzeScript(script, (msg) => {
        setStatusMsg(msg);
      });

      if (rawSegments.length === 0) {
        addToast('error', 'Groq returned no segments. Please try again.');
        return;
      }

      const segments: Segment[] = rawSegments.map((s, i) => ({
        ...s,
        id: `seg-${Date.now()}-${i}`,
        pexels_page: 1,
        giphy_page: 0,
        pexels_keywords: s.pexels_keywords ?? '',
        giphy_keywords: s.giphy_keywords ?? '',
        text_body: s.text_body ?? '',
        duration_estimate: s.duration_estimate ?? '',
      }));

      storage.setProject({ title: 'ClipScout Project', fullScript: script });
      storage.setSegments(segments);

      addToast('success', `Script analyzed! ${segments.length} segments created.`);
      onAnalyzed();
    } catch (err) {
      const msg = (err as Error).message ?? '';
      if (msg === 'TIMEOUT') {
        addToast('error', 'Groq timed out. Please try again.');
      } else if (msg.toLowerCase().includes('rate limit') || msg.toLowerCase().includes('rate limited')) {
        addToast('error', msg);
      } else {
        addToast('error', `Script analysis failed: ${msg || 'Please try again.'}`);
      }
    } finally {
      if (statusTimeoutRef.current) clearTimeout(statusTimeoutRef.current);
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex flex-col">
      <div className="flex items-center justify-end p-4">
        <button
          onClick={onSettings}
          className="text-gray-400 hover:text-white transition-colors p-2 rounded-lg hover:bg-[#1a1a1a]"
          aria-label="Settings"
        >
          <Settings size={22} />
        </button>
      </div>
      <div className="flex-1 flex flex-col items-center justify-center px-4 pb-8">
        <div className="w-full max-w-xl">
          <h1 className="text-5xl font-black text-white tracking-tight mb-3">ClipScout</h1>
          <p className="text-gray-400 text-lg mb-8">
            Paste your script. Find your B-roll. Download everything.
          </p>

          {hasProject && (
            <div className="flex gap-3 mb-8">
              <button
                onClick={onAnalyzed}
                className="flex-1 bg-[#1a1a1a] hover:bg-[#222] border border-gray-700 text-white font-semibold py-3 rounded-xl text-sm transition-colors active:scale-95"
              >
                Resume Last Project
              </button>
              <button
                onClick={() => {
                  storage.clearProject();
                  setHasProject(false);
                }}
                className="flex-1 bg-[#1a1a1a] hover:bg-[#222] border border-gray-700 text-gray-400 font-semibold py-3 rounded-xl text-sm transition-colors active:scale-95"
              >
                Start New Project
              </button>
            </div>
          )}

          <div className="space-y-4">
            <div>
              <textarea
                value={script}
                onChange={(e) => setScript(e.target.value)}
                placeholder="Paste your full YouTube script here…"
                className="w-full bg-[#111] border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-[#22c55e] text-base resize-y min-h-[250px] sm:min-h-[300px] md:min-h-[400px]"
                disabled={loading}
              />
              {scriptError && (
                <p className="mt-1 text-sm text-red-500">{scriptError}</p>
              )}
            </div>

            <button
              onClick={handleSubmit}
              disabled={loading}
              className="w-full hover:bg-[#16a34a] disabled:bg-[#16a34a]/60 text-white font-bold py-4 rounded-xl text-lg transition-colors active:scale-95 flex items-center justify-center gap-3 bg-[#161ba3]"
            >
              {loading ? (
                <>
                  <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin flex-shrink-0" />
                  <span className="text-sm text-center leading-snug">{statusMsg}</span>
                </>
              ) : (
                'Analyze Script & Find Clips →'
              )}
            </button>

            {loading && (
              <p className="text-center text-xs text-gray-500">
                Long scripts may take 1–2 minutes. Do not close this tab.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
