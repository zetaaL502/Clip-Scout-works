import { GoogleGenAI } from "@google/genai";

// Priority 1: user's own Google AI Studio key (works on Replit + Railway)
const plainApiKey = process.env.GEMINI_API_KEY;

// Priority 2: Replit integration proxy vars
const replitBaseUrl = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;
const replitApiKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY;

if (!plainApiKey && !replitBaseUrl) {
  throw new Error(
    "No Gemini credentials found. Set GEMINI_API_KEY (get one free at aistudio.google.com).",
  );
}

// Use plain key directly with Google's API (most reliable)
// Fall back to Replit integration proxy if no plain key
export const ai = plainApiKey
  ? new GoogleGenAI({ apiKey: plainApiKey })
  : new GoogleGenAI({
      apiKey: replitApiKey!,
      httpOptions: {
        apiVersion: "",
        baseUrl: replitBaseUrl!,
      },
    });
