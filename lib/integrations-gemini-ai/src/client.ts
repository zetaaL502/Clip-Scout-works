import { GoogleGenAI } from "@google/genai";

if (!process.env.AI_INTEGRATIONS_GEMINI_BASE_URL) {
  throw new Error(
    "AI_INTEGRATIONS_GEMINI_BASE_URL must be set. Set it to https://generativelanguage.googleapis.com and provide AI_INTEGRATIONS_GEMINI_API_KEY.",
  );
}

if (!process.env.AI_INTEGRATIONS_GEMINI_API_KEY) {
  throw new Error(
    "AI_INTEGRATIONS_GEMINI_API_KEY must be set.",
  );
}

const baseUrl = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;
const isStandardGoogleApi = baseUrl.includes("generativelanguage.googleapis.com");

export const ai = new GoogleGenAI({
  apiKey: process.env.AI_INTEGRATIONS_GEMINI_API_KEY,
  ...(isStandardGoogleApi
    ? {}
    : {
        httpOptions: {
          apiVersion: "",
          baseUrl,
        },
      }),
});
