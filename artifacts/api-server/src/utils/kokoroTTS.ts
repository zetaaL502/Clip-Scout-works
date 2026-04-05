import fs from "fs";
import path from "path";
import os from "os";
import { spawn } from "child_process";
import { logger } from "../lib/logger";

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

const CHUNK_SIZE = 500;

function chunkText(text: string): string[] {
  const trimmed = text.trim();
  if (trimmed.length <= CHUNK_SIZE) return [trimmed];
  const chunks: string[] = [];
  let remaining = trimmed;
  while (remaining.length > 0) {
    if (remaining.length <= CHUNK_SIZE) {
      chunks.push(remaining);
      break;
    }
    let idx = CHUNK_SIZE;
    const sentMatch = remaining.slice(0, CHUNK_SIZE).match(/[.!?]\s/g);
    if (sentMatch) {
      const lastSent = remaining.slice(0, CHUNK_SIZE).lastIndexOf(sentMatch[sentMatch.length - 1]);
      if (lastSent > CHUNK_SIZE * 0.4) idx = lastSent + 2;
    }
    if (idx === CHUNK_SIZE) {
      const spaceIdx = remaining.lastIndexOf(" ", CHUNK_SIZE);
      if (spaceIdx > 0) idx = spaceIdx;
    }
    chunks.push(remaining.slice(0, idx).trim());
    remaining = remaining.slice(idx).trim();
  }
  return chunks.filter((s) => s.length > 0);
}

async function callKokoroAPI(text: string, voice: string): Promise<Buffer> {
  const apiKey = process.env.HUGGINGFACE_API_KEY;
  if (!apiKey) throw new Error("HUGGINGFACE_API_KEY environment variable is not set");

  const res = await fetch(
    "https://api-inference.huggingface.co/models/hexgrad/Kokoro-82M",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ inputs: text, parameters: { voice } }),
    }
  );

  if (!res.ok) {
    const errText = await res.text().catch(() => "unknown error");
    throw new Error(`Kokoro API returned ${res.status}: ${errText}`);
  }

  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

function convertToMp3(inputPath: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", [
      "-y",
      "-i", inputPath,
      "-acodec", "libmp3lame",
      "-b:a", "128k",
      outputPath,
    ]);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg convert exited with code ${code}`));
    });
    child.on("error", reject);
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
      "-y", "-f", "concat", "-safe", "0",
      "-i", listFile,
      "-c", "copy",
      outputPath,
    ]);
    child.on("close", (code) => {
      try { fs.unlinkSync(listFile); } catch (_) {}
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg concat exited with code ${code}`));
    });
    child.on("error", (err) => {
      try { fs.unlinkSync(listFile); } catch (_) {}
      reject(err);
    });
  });
}

export async function generateAudio(
  text: string,
  voice: string,
  outputMp3Path: string
): Promise<void> {
  const chunks = chunkText(text);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kokoro_"));
  const chunkMp3s: string[] = [];

  try {
    for (let i = 0; i < chunks.length; i++) {
      const rawPath = path.join(tmpDir, `chunk_${i}.raw`);
      const mp3Path = path.join(tmpDir, `chunk_${i}.mp3`);
      logger.debug({ chunk: i, chars: chunks[i].length }, "Calling Kokoro API");
      const audioBytes = await callKokoroAPI(chunks[i], voice);
      fs.writeFileSync(rawPath, audioBytes);
      await convertToMp3(rawPath, mp3Path);
      try { fs.unlinkSync(rawPath); } catch (_) {}
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
