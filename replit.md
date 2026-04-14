# ClipScout

A video production SaaS app that uses AI for subtitle generation, video analysis, and clip scouting.

## Architecture

This is a pnpm monorepo with two main artifacts:

- **`artifacts/api-server`** — Express.js 5 backend on port 8080, serving REST API under `/api` prefix
- **`artifacts/clipscout`** — React 19 + Vite frontend on port 3001, routed at `/`
- **`artifacts/mockup-sandbox`** — UI prototyping sandbox

### Shared libraries (`lib/`)

- **`@workspace/api-spec`** — OpenAPI specification + Orval codegen
- **`@workspace/api-client-react`** — Generated React Query hooks
- **`@workspace/api-zod`** — Generated Zod schemas for validation
- **`@workspace/db`** — Drizzle ORM + PostgreSQL database layer
- **`@workspace/integrations-gemini-ai`** — Google Gemini AI wrapper (batch processing, image generation)

## Tech Stack

- **Language**: TypeScript throughout
- **Frontend**: React 19, Vite, Tailwind CSS 4, TanStack Query, Wouter (routing), Radix UI, Framer Motion
- **Backend**: Express.js 5, Zod validation, Pino logging, fluent-ffmpeg, Multer (file uploads)
- **Database**: PostgreSQL via Replit's built-in DB, Drizzle ORM
- **AI**: Google Gemini AI via Replit AI Integrations proxy
- **Build**: esbuild (server), Vite (frontend)

## Workflows

- **Start application** — `PORT=8080 NODE_ENV=development pnpm --filter @workspace/api-server run dev`
- **Start frontend** — `PORT=3001 BASE_PATH=/ pnpm --filter @workspace/clipscout run dev`

## Environment Variables

- `DATABASE_URL`, `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE` — PostgreSQL (auto-provisioned)
- `AI_INTEGRATIONS_GEMINI_BASE_URL` — Gemini AI proxy URL (auto-provisioned)
- `AI_INTEGRATIONS_GEMINI_API_KEY` — Gemini AI key (auto-provisioned, dummy value)
- `PEXELS_API_KEY` — (optional) for Pexels video search
- `ASSEMBLYAI_API_KEY` — (optional) for subtitle/transcription via AssemblyAI

## Key Patterns

- **API contract-first**: All routes defined in `lib/api-spec/openapi.yaml`, codegen via `pnpm --filter @workspace/api-spec run codegen`
- **DB migrations**: `pnpm --filter @workspace/db run push`
- **No `console.log` in server code** — use `req.log` in routes and `logger` singleton elsewhere
- **Vite proxy**: Dev frontend proxies `/api` to `localhost:8080`

## Routing

Replit's shared proxy at port 80 routes:
- `/api/*` → API server (port 8080)
- `/*` → Frontend (port 3001)
