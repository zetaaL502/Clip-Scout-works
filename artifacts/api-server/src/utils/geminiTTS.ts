import fs from "fs";
import path from "path";
import os from "os";
import { spawn } from "child_process";
import { GoogleGenAI } from "@google/genai";
import { logger } from "../lib/logger";

// ---------------------------------------------------------------------------
// Google AI Studio voice catalogue
// ---------------------------------------------------------------------------

export const GEMINI_VOICES = [
  { id: "Aoede",          label: "Aoede",          style: "Breezy",      gender: "Female" },
  { id: "Leda",           label: "Leda",            style: "Youthful",    gender: "Female" },
  { id: "Zephyr",         label: "Zephyr",          style: "Bright",      gender: "Female" },
  { id: "Callisto",       label: "Callisto",         style: "Clear",       gender: "Female" },
  { id: "Kore",           label: "Kore",            style: "Firm",        gender: "Female" },
  { id: "Achernar",       label: "Achernar",         style: "Soft",        gender: "Female" },
  { id: "Vindemiatrix",   label: "Vindemiatrix",     style: "Gentle",      gender: "Female" },
  { id: "Pulcherrima",    label: "Pulcherrima",      style: "Forward",     gender: "Female" },
  { id: "Sadachbia",      label: "Sadachbia",        style: "Lively",      gender: "Female" },
  { id: "Sulafat",        label: "Sulafat",          style: "Warm",        gender: "Female" },
  { id: "Puck",           label: "Puck",            style: "Upbeat",      gender: "Male"   },
  { id: "Charon",         label: "Charon",          style: "Informative", gender: "Male"   },
  { id: "Fenrir",         label: "Fenrir",          style: "Excitable",   gender: "Male"   },
  { id: "Orus",           label: "Orus",            style: "Firm",        gender: "Male"   },
  { id: "Algieba",        label: "Algieba",          style: "Smooth",      gender: "Male"   },
  { id: "Alnilam",        label: "Alnilam",          style: "Firm",        gender: "Male"   },
  { id: "Gacrux",         label: "Gacrux",           style: "Mature",      gender: "Male"   },
  { id: "Achird",         label: "Achird",           style: "Friendly",    gender: "Male"   },
  { id: "Sadaltager",     label: "Sadaltager",       style: "Knowledgeable", gender: "Male" },
  { id: "Zubenelgenubi",  label: "Zubenelgenubi",    style: "Casual",      gender: "Male"   },
] as const;

export type GeminiVoiceId = typeof GEMINI_VOICES[number]["id"];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Strip emoji and special Unicode before TTS to prevent garbled output */
function stripEmoji(text: string): string {
  return text
    .replace(/\p{Emoji}/gu, "")
    .replace(/\u200D/gu, "")
    .replace(/[\uFE0E\uFE0F]/gu, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Convert raw PCM buffer to MP3 via ffmpeg */
function pcmToMp3(pcmBuffer: Buffer, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const stderr: string[] = [];
    // Gemini TTS returns LINEAR16 PCM at 24 kHz, mono
    const child = spawn("ffmpeg", [
      "-y",
      "-f", "s16le",
      "-ar", "24000",
      "-ac", "1",
      "-i", "pipe:0",
      "-acodec", "libmp3lame",
      "-b:a", "128k",
      outputPath,
    ]);
    child.stderr.on("data", (d) => stderr.push(d.toString()));
    child.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`ffmpeg PCM→MP3 (code ${code}): ${stderr.slice(-2).join("").trim()}`))
    );
    child.on("error", reject);
    child.stdin.write(pcmBuffer);
    child.stdin.end();
  });
}

function concatMp3Files(inputFiles: string[], outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const listFile = outputPath + ".list.txt";
    fs.writeFileSync(
      listFile,
      inputFiles.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join("\n")
    );
    const child = spawn("ffmpeg", [
      "-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", outputPath,
    ]);
    child.on("close", (code) => {
      try { fs.unlinkSync(listFile); } catch (_) {}
      code === 0 ? resolve() : reject(new Error(`ffmpeg concat (code ${code})`));
    });
    child.on("error", (err) => {
      try { fs.unlinkSync(listFile); } catch (_) {}
      reject(err);
    });
  });
}

const CHUNK_SIZE = 400;

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
// Gemini TTS call
// ---------------------------------------------------------------------------

async function callGeminiTTS(text: string, voiceName: string): Promise<Buffer> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");

  const ai = new GoogleGenAI({ apiKey });

  logger.info({ voice: voiceName, textLen: text.length }, "Calling Gemini TTS");

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-preview-tts",
    contents: [{ parts: [{ text }] }],
    config: {
      responseModalities: ["AUDIO"],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName },
        },
      },
    } as Parameters<typeof ai.models.generateContent>[0]["config"],
  });

  const part = response.candidates?.[0]?.content?.parts?.[0];
  if (!part?.inlineData?.data) {
    throw new Error("Gemini TTS returned no audio data");
  }

  return Buffer.from(part.inlineData.data, "base64");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function generateAudio(
  rawText: string,
  voice: string,
  outputMp3Path: string
): Promise<void> {
  const text = stripEmoji(rawText);
  if (!text) {
    throw new Error("Empty text after emoji strip");
  }

  const chunks = chunkText(text);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gemini_tts_"));
  const chunkMp3s: string[] = [];

  try {
    for (let i = 0; i < chunks.length; i++) {
      const mp3Path = path.join(tmpDir, `chunk_${i}.mp3`);
      const pcmBuffer = await callGeminiTTS(chunks[i], voice);
      await pcmToMp3(pcmBuffer, mp3Path);
      chunkMp3s.push(mp3Path);
    }

    if (chunkMp3s.length === 1) {
      fs.copyFileSync(chunkMp3s[0], outputMp3Path);
    } else {
      await concatMp3Files(chunkMp3s, outputMp3Path);
    }
  } finally {
    for (const f of chunkMp3s) { try { fs.unlinkSync(f); } catch (_) {} }
    try { fs.rmdirSync(tmpDir); } catch (_) {}
  }
}
