import { Router, type Request, type Response } from "express";
import multer from "multer";
import archiver from "archiver";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

const router = Router();

const TRANSFERS_DIR = "/tmp/transfers";
const AUTO_DELETE_MS = 20 * 60 * 1000; // 20 minutes

interface TransferEntry {
  filePath: string;
  originalName: string;
  mimeType: string;
  timer: ReturnType<typeof setTimeout>;
}

const transfers = new Map<string, TransferEntry>();

fsp.mkdir(TRANSFERS_DIR, { recursive: true }).catch(() => {});

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    fsp.mkdir(TRANSFERS_DIR, { recursive: true })
      .then(() => cb(null, TRANSFERS_DIR))
      .catch((err) => cb(err as Error, TRANSFERS_DIR));
  },
  filename: (_req, _file, cb) => {
    cb(null, `${randomUUID()}-${Date.now()}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500 MB per file
  fileFilter: (_req, file, cb) => {
    const allowed = ["audio/mpeg", "audio/wav", "audio/x-wav", "text/plain", "application/x-subrip", "application/octet-stream"];
    const allowedExts = [".mp3", ".wav", ".srt"];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(file.mimetype) || allowedExts.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`File type not allowed: ${file.originalname}`));
    }
  },
});

router.post("/transfers/upload", upload.array("files", 20), async (req: Request, res: Response) => {
  const files = req.files as Express.Multer.File[] | undefined;
  if (!files || files.length === 0) {
    res.status(400).json({ error: "No files uploaded" });
    return;
  }

  const transferId = randomUUID();
  let finalPath: string;
  let originalName: string;
  let mimeType: string;

  try {
    if (files.length === 1) {
      // Zero-Zip rule: single file — keep it raw, no ZIP
      const file = files[0];
      const ext = path.extname(file.originalname).toLowerCase();
      finalPath = path.join(TRANSFERS_DIR, `${transferId}${ext}`);
      await fsp.rename(file.path, finalPath);
      originalName = file.originalname;
      mimeType = file.mimetype;
    } else {
      // Multiple files — bundle into a single ZIP
      finalPath = path.join(TRANSFERS_DIR, `${transferId}.zip`);
      originalName = `transfer_${transferId.slice(0, 8)}.zip`;
      mimeType = "application/zip";

      await new Promise<void>((resolve, reject) => {
        const output = fs.createWriteStream(finalPath);
        const archive = archiver("zip", { zlib: { level: 6 } });
        output.on("close", resolve);
        archive.on("error", reject);
        archive.pipe(output);
        for (const file of files) {
          archive.file(file.path, { name: file.originalname });
        }
        archive.finalize();
      });

      // Clean up the raw uploaded temp files after zipping
      await Promise.all(files.map((f) => fsp.unlink(f.path).catch(() => {})));
    }

    // Auto-delete after 20 minutes
    const timer = setTimeout(async () => {
      await fsp.unlink(finalPath).catch(() => {});
      transfers.delete(transferId);
    }, AUTO_DELETE_MS);

    transfers.set(transferId, { filePath: finalPath, originalName, mimeType, timer });

    res.json({ transferId, fileCount: files.length, originalName });
  } catch (err) {
    // Clean up any temp files on error
    await Promise.all((files ?? []).map((f) => fsp.unlink(f.path).catch(() => {})));
    res.status(500).json({ error: (err as Error).message ?? "Upload failed" });
  }
});

router.get("/transfers/download/:transferId", (req: Request, res: Response) => {
  const { transferId } = req.params;
  const entry = transfers.get(transferId);

  if (!entry || !fs.existsSync(entry.filePath)) {
    res.status(404).json({ error: "Transfer not found or expired (20-minute limit)" });
    return;
  }

  // Content-Disposition: attachment forces iPhones to save to Files app
  // instead of playing audio in the browser.
  res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(entry.originalName)}"`);
  res.setHeader("Content-Type", entry.mimeType);
  res.setHeader("Cache-Control", "no-store");

  fs.createReadStream(entry.filePath).pipe(res);
});

export default router;
