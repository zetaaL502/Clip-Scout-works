import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { randomUUID } from "node:crypto";

const router = Router();

const uploadDir = path.join("/tmp", "conversation_media");
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${randomUUID()}${ext}`);
  },
});

const upload = multer({ storage, limits: { fileSize: 100 * 1024 * 1024 } });

export const conversationMediaRegistry = new Map<
  string,
  { path: string; mimetype: string }
>();

router.post(
  "/conversation/upload-media",
  upload.single("file"),
  async (req, res): Promise<void> => {
    if (!req.file) {
      res.status(400).json({ error: "No file uploaded" });
      return;
    }
    const mediaId = randomUUID();
    conversationMediaRegistry.set(mediaId, {
      path: req.file.path,
      mimetype: req.file.mimetype,
    });
    res.json({ mediaId, url: `/api/conversation/media/${mediaId}` });
  }
);

router.get("/conversation/media/:mediaId", async (req, res): Promise<void> => {
  const mediaId = Array.isArray(req.params.mediaId)
    ? req.params.mediaId[0]
    : req.params.mediaId;
  const entry = conversationMediaRegistry.get(mediaId);
  if (!entry || !fs.existsSync(entry.path)) {
    res.status(404).json({ error: "Media not found" });
    return;
  }
  res.setHeader("Content-Type", entry.mimetype);
  fs.createReadStream(entry.path).pipe(res);
});

export default router;
