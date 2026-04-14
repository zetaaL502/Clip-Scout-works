import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { randomUUID } from "node:crypto";

const router = Router();

const uploadDir = path.join("/tmp", "uploads");
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${randomUUID()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 },
});

const fileRegistry = new Map<string, { path: string; type: string; url: string }>();

router.post(
  "/imessage/upload",
  upload.single("file"),
  async (req, res): Promise<void> => {
    if (!req.file) {
      res.status(400).json({ error: "No file uploaded" });
      return;
    }

    const fileType = (req.body as Record<string, string>).type || "unknown";
    const fileId = randomUUID();
    const url = `/api/imessage/media/${fileId}`;

    fileRegistry.set(fileId, {
      path: req.file.path,
      type: fileType,
      url,
    });

    res.json({ fileId, url, type: fileType });
  }
);

router.get("/imessage/media/:fileId", async (req, res): Promise<void> => {
  const fileId = Array.isArray(req.params.fileId)
    ? req.params.fileId[0]
    : req.params.fileId;
  const entry = fileRegistry.get(fileId);

  if (!entry || !fs.existsSync(entry.path)) {
    res.status(404).json({ error: "File not found" });
    return;
  }

  res.sendFile(entry.path);
});

export { fileRegistry };
export default router;
