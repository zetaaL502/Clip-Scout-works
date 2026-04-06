import fs from "fs";
import path from "path";
import os from "os";
import { spawn } from "child_process";
import { createRequire } from "module";
import { logger } from "../lib/logger";

// For CJS module in ESM context
const require = createRequire(import.meta.url);

// ---------------------------------------------------------------------------
// Voice catalogue
// ---------------------------------------------------------------------------

export const KOKORO_VOICES = [
  { id: "af_heart",     label: "Heart",     accent: "American", gender: "Female" },
  { id: "af_bella",     label: "Bella",     accent: "American", gender: "Female" },
  { id: "af_sarah",     label: "Sarah",     accent: "American", gender: "Female" },
  { id: "af_sky",       label: "Sky",       accent: "American", gender: "Female" },
  { id: "af_nicole",    label: "Nicole",    accent: "American", gender: "Female" },
  { id: "am_adam",      label: "Adam",      accent: "American", gender: "Male"   },
  { id: "am_michael",   label: "Michael",   accent: "American", gender: "Male"   },
  { id: "bf_emma",      label: "Emma",      accent: "British",  gender: "Female" },
  { id: "bf_isabella",  label: "Isabella",  accent: "British",  gender: "Female" },
  { id: "bm_george",    label: "George",    accent: "British",  gender: "Male"   },
  { id: "bm_lewis",     label: "Lewis",     accent: "British",  gender: "Male"   },
] as const;

export type KokoroVoiceId = typeof KOKORO_VOICES[number]["id"];

// Map each Kokoro voice → gTTS language code (used when Kokoro is unavailable)
const GTTS_LANG_MAP: Record<string, string> = {
  af_heart:    "en",
  af_bella:    "en",
  af_sarah:    "en",
  af_sky:      "en",
  af_nicole:   "en",
  am_adam:     "en",
  am_michael:  "en",
  bf_emma:     "en-uk",
  bf_isabella: "en-uk",
  bm_george:   "en-uk",
  bm_lewis:    "en-uk",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CHUNK_SIZE   = 500;
const MAX_RETRIES  = 3;
const RETRY_DELAY  = 6000;

// New HuggingFace router endpoint (api-inference.huggingface.co was retired Apr 2025)
const HF_ENDPOINT = "https://router.huggingface.co/hf-inference/models/hexgrad/Kokoro-82M";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Analyse text for emotional cues → TTS speed multiplier */
function detectSpeed(text: string): number {
  const exclamations = (text.match(/!/g) || []).length;
  const hasAllCaps   = /\b[A-Z]{3,}\b/.test(text);
  const hasEllipsis  = text.includes("...");
  const sadWords     = /\b(sorry|miss|cry|hurt|pain|broken|lost|alone|scared|afraid)\b/i.test(text);
  if (exclamations >= 2 || hasAllCaps) return 1.15;
  if (exclamations === 1)              return 1.05;
  if (hasEllipsis || sadWords)         return 0.9;
  return 1.0;
}

function chunkText(text: string): string[] {
  const trimmed = text.trim();
  if (trimmed.length <= CHUNK_SIZE) return [trimmed];
  const chunks: string[] = [];
  let remaining = trimmed;
  while (remaining.length > 0) {
    if (remaining.length <= CHUNK_SIZE) { chunks.push(remaining); break; }
    let idx = CHUNK_SIZE;
    const sentMatch = remaining.slice(0, CHUNK_SIZE).match(/[.!?]\s/g);
    if (sentMatch) {
      const last = remaining.slice(0, CHUNK_SIZE).lastIndexOf(sentMatch[sentMatch.length - 1]);
      if (last > CHUNK_SIZE * 0.4) idx = last + 2;
    }
    if (idx === CHUNK_SIZE) {
      const sp = remaining.lastIndexOf(" ", CHUNK_SIZE);
      if (sp > 0) idx = sp;
    }
    chunks.push(remaining.slice(0, idx).trim());
    remaining = remaining.slice(idx).trim();
  }
  return chunks.filter((s) => s.length > 0);
}

// ---------------------------------------------------------------------------
// ffmpeg helpers
// ---------------------------------------------------------------------------

function convertToMp3(inputPath: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const stderr: string[] = [];
    const child = spawn("ffmpeg", ["-y", "-i", inputPath, "-acodec", "libmp3lame", "-b:a", "128k", outputPath]);
    child.stderr.on("data", (d) => stderr.push(d.toString()));
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg convert (code ${code}): ${stderr.slice(-2).join("").trim()}`)));
    child.on("error", reject);
  });
}

function concatMp3Files(inputFiles: string[], outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const listFile = outputPath + ".list.txt";
    fs.writeFileSync(listFile, inputFiles.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join("\n"));
    const child = spawn("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", outputPath]);
    child.on("close", (code) => { try { fs.unlinkSync(listFile); } catch (_) {} code === 0 ? resolve() : reject(new Error(`ffmpeg concat (code ${code})`)); });
    child.on("error", (err) => { try { fs.unlinkSync(listFile); } catch (_) {} reject(err); });
  });
}

// ---------------------------------------------------------------------------
// Kokoro (HuggingFace Inference API)
// ---------------------------------------------------------------------------

async function callKokoroAPI(text: string, voice: string): Promise<Buffer> {
  const apiKey = process.env.HUGGINGFACE_API_KEY;
  if (!apiKey) throw new Error("HUGGINGFACE_API_KEY not set");

  const speed = detectSpeed(text);
  logger.info({ voice, speed, keyPrefix: apiKey.slice(0, 6) }, "Calling Kokoro API");

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    let res: Response;
    try {
      res = await fetch(HF_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "x-wait-for-model": "true",
        },
        body: JSON.stringify({ inputs: text, parameters: { voice, speed } }),
      });
    } catch (fetchErr) {
      throw new Error(`Network error: ${String(fetchErr)}`);
    }

    logger.info({ status: res.status, contentType: res.headers.get("content-type"), attempt }, "Kokoro API response");

    if (res.status === 503) { await sleep(RETRY_DELAY); continue; }

    if (res.status === 404) {
      throw new Error(
        "KOKORO_NOT_AUTHORIZED: The Kokoro-82M model requires you to accept its license. " +
        "Please visit https://huggingface.co/hexgrad/Kokoro-82M and click 'Access repository', " +
        "then try again."
      );
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => "unknown");
      throw new Error(`Kokoro API ${res.status}: ${errText}`);
    }

    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const json = await res.json() as { error?: string; estimated_time?: number };
      if (json.error && attempt < MAX_RETRIES - 1) {
        await sleep(json.estimated_time ? json.estimated_time * 1000 + 2000 : RETRY_DELAY);
        continue;
      }
      throw new Error(`Kokoro error: ${json.error ?? "unexpected JSON"}`);
    }

    return Buffer.from(await res.arrayBuffer());
  }

  throw new Error(`Kokoro failed after ${MAX_RETRIES} retries`);
}

async function generateKokoroAudio(text: string, voice: string, outputMp3Path: string): Promise<void> {
  const chunks = chunkText(text);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kokoro_"));
  const chunkMp3s: string[] = [];
  try {
    for (let i = 0; i < chunks.length; i++) {
      const rawPath = path.join(tmpDir, `chunk_${i}.raw`);
      const mp3Path = path.join(tmpDir, `chunk_${i}.mp3`);
      const audioBytes = await callKokoroAPI(chunks[i], voice);
      fs.writeFileSync(rawPath, audioBytes);
      await convertToMp3(rawPath, mp3Path);
      try { fs.unlinkSync(rawPath); } catch (_) {}
      chunkMp3s.push(mp3Path);
    }
    if (chunkMp3s.length === 1) { fs.copyFileSync(chunkMp3s[0], outputMp3Path); }
    else { await concatMp3Files(chunkMp3s, outputMp3Path); }
  } finally {
    for (const f of chunkMp3s) { try { fs.unlinkSync(f); } catch (_) {} }
    try { fs.rmdirSync(tmpDir); } catch (_) {}
  }
}

// ---------------------------------------------------------------------------
// gTTS fallback (Google Translate TTS — works without API key)
// ---------------------------------------------------------------------------

function generateGTTSAudio(text: string, voice: string, outputMp3Path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const gtts = require("node-gtts");
      const lang = GTTS_LANG_MAP[voice] ?? "en";
      const g = gtts(lang);
      g.save(outputMp3Path, text, (err?: Error) => {
        if (err) reject(new Error(`gTTS error: ${err.message}`));
        else resolve();
      });
    } catch (e) {
      reject(new Error(`gTTS load error: ${String(e)}`));
    }
  });
}

// ---------------------------------------------------------------------------
// Public API — tries Kokoro then falls back to gTTS
// ---------------------------------------------------------------------------

let kokoroUnavailable = false;

export async function generateAudio(text: string, voice: string, outputMp3Path: string): Promise<void> {
  if (!kokoroUnavailable) {
    try {
      await generateKokoroAudio(text, voice, outputMp3Path);
      return;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.startsWith("KOKORO_NOT_AUTHORIZED") || msg.includes("not set")) {
        logger.warn({ msg: msg.slice(0, 120) }, "Kokoro not available, switching to gTTS fallback");
        kokoroUnavailable = true; // don't retry Kokoro for the rest of this session
      } else {
        throw e; // re-throw network / ffmpeg errors
      }
    }
  }

  // gTTS fallback
  logger.info({ voice }, "Using gTTS fallback");
  await generateGTTSAudio(text, voice, outputMp3Path);
}

export function isKokoroAvailable(): boolean {
  return !kokoroUnavailable;
}
