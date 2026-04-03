import { GoogleGenAI } from "@google/genai";

// Accept either Replit integration vars OR a plain GEMINI_API_KEY (for Railway / self-hosted)
const apiKey =
  process.env.AI_INTEGRATIONS_GEMINI_API_KEY ||
  process.env.GEMINI_API_KEY;

if (!apiKey) {
  throw new Error(
    "Gemini API key not found. Set AI_INTEGRATIONS_GEMINI_API_KEY (Replit) or GEMINI_API_KEY (Railway/self-hosted).",
  );
}

const baseUrl = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL ?? "https://generativelanguage.googleapis.com";
const isStandardGoogleApi = baseUrl.includes("generativelanguage.googleapis.com");

export const ai = new GoogleGenAI({
  apiKey,
  ...(isStandardGoogleApi
    ? {}
    : {
        httpOptions: {
          apiVersion: "",
          baseUrl,
        },
      }),
});
