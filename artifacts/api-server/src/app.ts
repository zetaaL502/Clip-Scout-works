import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

// --- Simple in-memory rate limiter: max 60 requests per IP per minute ---
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
  if (entry.count > 60) {
    res.status(429).json({ error: "Too many requests. Please slow down." });
    return;
  }
  next();
}

// --- CORS: only allow Replit-hosted origins ---
const corsOptions: cors.CorsOptions = {
  origin(origin, callback) {
    if (
      !origin ||
      /^https?:\/\/localhost(:\d+)?$/.test(origin) ||
      origin.endsWith(".replit.dev") ||
      origin.endsWith(".replit.app") ||
      origin.endsWith(".pike.replit.dev")
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

export default app;
