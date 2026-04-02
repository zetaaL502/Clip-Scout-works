import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import router from "./routes";
import { logger } from "./lib/logger";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app: Express = express();

// --- Simple in-memory rate limiter: max 200 requests per IP per minute ---
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
function rateLimiter(req: Request, res: Response, next: NextFunction): void {
  const ip = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ?? req.socket?.remoteAddress ?? "unknown";
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + 60_000 });
    next();
    return;
  }
  entry.count += 1;
  if (entry.count > 200) {
    res.status(429).json({ error: "Too many requests. Please slow down." });
    return;
  }
  next();
}

// --- CORS ---
const corsOptions: cors.CorsOptions = {
  origin(origin, callback) {
    if (
      !origin ||
      /^https?:\/\/localhost(:\d+)?$/.test(origin) ||
      origin.endsWith(".replit.dev") ||
      origin.endsWith(".replit.app") ||
      origin.endsWith(".pike.replit.dev") ||
      origin.endsWith(".railway.app") ||
      origin.endsWith(".up.railway.app")
    ) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
};

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors(corsOptions));
app.use(rateLimiter);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

// --- Serve frontend static files ---
const frontendDist = path.resolve(__dirname, "../../clipscout/dist/public");
app.use(express.static(frontendDist));

// --- Catch-all: serve index.html for client-side routing ---
app.get(/.*/, (_req: Request, res: Response) => {
  res.sendFile(path.join(frontendDist, "index.html"));
});

export default app;
