import { Router, type Request, type Response } from "express";
import multer from "multer";
import archiver from "archiver";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

const router = Router();

const TRANSFERS_DIR = "/tmp/transfers";
const AUTO_DELETE_MS = 20 * 60 * 1000;
const INCOMING_DIR = "/tmp/incoming";
const INCOMING_AUTO_DELETE_MS = 5 * 60 * 1000;

interface TransferEntry {
  filePath: string;
  originalName: string;
  mimeType: string;
  timer: ReturnType<typeof setTimeout>;
}

interface IncomingFile {
  id: string;
  filePath: string;
  originalName: string;
  size: number;
  receivedAt: number;
}

const transfers = new Map<string, TransferEntry>();
const incomingFiles: IncomingFile[] = [];

fsp.mkdir(TRANSFERS_DIR, { recursive: true }).catch(() => {});
fsp.mkdir(INCOMING_DIR, { recursive: true }).catch(() => {});

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    fsp
      .mkdir(TRANSFERS_DIR, { recursive: true })
      .then(() => cb(null, TRANSFERS_DIR))
      .catch((err) => cb(err as Error, TRANSFERS_DIR));
  },
  filename: (_req, _file, cb) => {
    cb(null, `${randomUUID()}-${Date.now()}`);
  },
});

const ALLOWED_MIME = [
  "audio/mpeg",
  "audio/wav",
  "audio/x-wav",
  "audio/mp4",
  "audio/aac",
  "text/plain",
  "text/srt",
  "application/x-subrip",
  "video/mp4",
  "video/quicktime",
  "video/x-msvideo",
  "video/webm",
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "application/octet-stream",
];

const ALLOWED_EXTS = [
  ".mp3",
  ".wav",
  ".m4a",
  ".aac",
  ".ogg",
  ".srt",
  ".vtt",
  ".mp4",
  ".mov",
  ".avi",
  ".webm",
  ".pdf",
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".svg",
];

const incomingStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    fsp
      .mkdir(INCOMING_DIR, { recursive: true })
      .then(() => cb(null, INCOMING_DIR))
      .catch((err) => cb(err as Error, INCOMING_DIR));
  },
  filename: (_req, _file, cb) => {
    cb(
      null,
      `${randomUUID()}-${Date.now()}${path.extname(_file.originalname)}`,
    );
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_MIME.includes(file.mimetype) || ALLOWED_EXTS.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`File type not allowed: ${file.originalname}`));
    }
  },
});

const incomingUpload = multer({
  storage: incomingStorage,
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_MIME.includes(file.mimetype) || ALLOWED_EXTS.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`File type not allowed: ${file.originalname}`));
    }
  },
});

router.post(
  "/transfers/upload",
  upload.array("files", 20),
  async (req: Request, res: Response) => {
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
        const file = files[0];
        const ext = path.extname(file.originalname).toLowerCase();
        finalPath = path.join(TRANSFERS_DIR, `${transferId}${ext}`);
        await fsp.rename(file.path, finalPath);
        originalName = file.originalname;
        mimeType = file.mimetype;
      } else {
        finalPath = path.join(TRANSFERS_DIR, `${transferId}.zip`);
        originalName = `transfer_${transferId.slice(0, 8)}.zip`;
        mimeType = "application/zip";

        await new Promise<void>((resolve, reject) => {
          const output = fs.createWriteStream(finalPath);
          const archive = archiver("zip", { store: true });
          output.on("close", resolve);
          archive.on("error", reject);
          archive.pipe(output);
          for (const file of files) {
            archive.file(file.path, { name: file.originalname });
          }
          archive.finalize();
        });

        await Promise.all(files.map((f) => fsp.unlink(f.path).catch(() => {})));
      }

      const timer = setTimeout(async () => {
        await fsp.unlink(finalPath).catch(() => {});
        transfers.delete(transferId);
      }, AUTO_DELETE_MS);

      transfers.set(transferId, {
        filePath: finalPath,
        originalName,
        mimeType,
        timer,
      });

      res.json({ transferId, fileCount: files.length, originalName });
    } catch (err) {
      await Promise.all(
        (files ?? []).map((f) => fsp.unlink(f.path).catch(() => {})),
      );
      res
        .status(500)
        .json({ error: (err as Error).message ?? "Upload failed" });
    }
  },
);

router.get("/transfers/download/:transferId", (req: Request, res: Response) => {
  const { transferId } = req.params as { transferId: string };
  const entry = transfers.get(transferId);

  if (!entry || !fs.existsSync(entry.filePath)) {
    res
      .status(404)
      .json({ error: "Transfer not found or expired (20-minute limit)" });
    return;
  }

  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${encodeURIComponent(entry.originalName)}"`,
  );
  res.setHeader("Content-Type", entry.mimeType);
  res.setHeader("Cache-Control", "no-store");

  fs.createReadStream(entry.filePath).pipe(res);
});

router.post(
  "/transfers/receive",
  incomingUpload.array("files", 20),
  async (req: Request, res: Response) => {
    const files = req.files as Express.Multer.File[] | undefined;
    if (!files || files.length === 0) {
      res.status(400).json({ error: "No files uploaded" });
      return;
    }

    const newFiles: IncomingFile[] = [];
    for (const file of files) {
      const ext = path.extname(file.originalname).toLowerCase();
      const finalPath = path.join(INCOMING_DIR, `${randomUUID()}${ext}`);
      try {
        await fsp.rename(file.path, finalPath);
        const incoming: IncomingFile = {
          id: randomUUID(),
          filePath: finalPath,
          originalName: file.originalname,
          size: file.size,
          receivedAt: Date.now(),
        };
        newFiles.push(incoming);
        incomingFiles.push(incoming);
      } catch (err) {
        console.error("Failed to save incoming file:", err);
      }
    }

    res.json({ success: true, fileCount: newFiles.length });
  },
);

router.get("/transfers/incoming", (_req: Request, res: Response) => {
  const cutoff = Date.now() - INCOMING_AUTO_DELETE_MS;
  const validFiles = incomingFiles.filter((f) => f.receivedAt > cutoff);
  res.json({ files: validFiles });
});

router.delete("/transfers/incoming/:id", (req: Request, res: Response) => {
  const { id } = req.params;
  const index = incomingFiles.findIndex((f) => f.id === id);
  if (index !== -1) {
    const file = incomingFiles[index];
    fsp.unlink(file.filePath).catch(() => {});
    incomingFiles.splice(index, 1);
  }
  res.json({ success: true });
});

router.get(
  "/transfers/incoming/:id/download",
  (req: Request, res: Response) => {
    const { id } = req.params;
    const file = incomingFiles.find((f) => f.id === id);

    if (!file || !fs.existsSync(file.filePath)) {
      res.status(404).json({ error: "File not found or expired" });
      return;
    }

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${encodeURIComponent(file.originalName)}"`,
    );
    res.setHeader("Cache-Control", "no-store");

    fs.createReadStream(file.filePath).pipe(res);
  },
);

router.get("/receive", (_req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/html");
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>ClipScout - Quick Send</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0a0a0a; color: #fff; min-height: 100vh; display: flex; flex-direction: column; }
    .header { background: #111; padding: 16px; border-bottom: 1px solid #333; display: flex; align-items: center; gap: 10px; }
    .header span { font-weight: 900; font-size: 18px; color: #22c55e; }
    .container { flex: 1; display: flex; flex-direction: column; padding: 20px; max-width: 480px; margin: 0 auto; width: 100%; }
    h1 { font-size: 24px; margin-bottom: 8px; }
    p { color: #888; margin-bottom: 20px; font-size: 14px; }
    .drop-zone { border: 2px dashed #333; border-radius: 16px; padding: 40px 20px; text-align: center; cursor: pointer; transition: all 0.2s; background: #111; }
    .drop-zone.dragover { border-color: #22c55e; background: rgba(34, 197, 94, 0.1); }
    .drop-zone:hover { border-color: #555; }
    .drop-zone svg { width: 48px; height: 48px; margin: 0 auto 12px; color: #555; }
    .drop-zone p { margin: 0; color: #fff; font-weight: 600; }
    .drop-zone span { color: #666; font-size: 12px; }
    input[type="file"] { display: none; }
    .btn { width: 100%; background: #22c55e; color: #fff; border: none; padding: 16px; border-radius: 12px; font-size: 16px; font-weight: 700; cursor: pointer; margin-top: 16px; transition: all 0.2s; }
    .btn:hover { background: #16a34a; }
    .btn:active { transform: scale(0.98); }
    .btn:disabled { background: #333; color: #666; cursor: not-allowed; }
    .progress { margin-top: 12px; background: #222; border-radius: 8px; height: 8px; overflow: hidden; }
    .progress-bar { height: 100%; background: #22c55e; width: 0%; transition: width 0.3s; }
    .status { margin-top: 12px; text-align: center; color: #888; font-size: 14px; }
    .success { color: #22c55e; }
    .footer { text-align: center; padding: 20px; color: #555; font-size: 12px; }
  </style>
</head>
<body>
  <div class="header">
    <span>ClipScout</span>
  </div>
  <div class="container">
    <h1>Quick Send</h1>
    <p>Select files from your phone to send to your laptop</p>
    <div class="drop-zone" id="dropZone">
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/>
      </svg>
      <p>Tap to select files</p>
      <span>or drag & drop here</span>
    </div>
    <input type="file" id="fileInput" multiple accept=".mp3,.wav,.m4a,.aac,.ogg,.srt,.vtt,.mp4,.mov,.avi,.webm,.pdf,.jpg,.jpeg,.png,.gif,.webp,.svg">
    <button class="btn" id="uploadBtn" disabled>Send Files</button>
    <div class="progress" id="progress" style="display:none"><div class="progress-bar" id="progressBar"></div></div>
    <div class="status" id="status"></div>
  </div>
  <div class="footer">Files sent to your laptop via ClipScout</div>
  <script>
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('fileInput');
    const uploadBtn = document.getElementById('uploadBtn');
    const progress = document.getElementById('progress');
    const progressBar = document.getElementById('progressBar');
    const status = document.getElementById('status');
    let selectedFiles = [];

    dropZone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', handleFiles);

    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
    dropZone.addEventListener('drop', (e) => { e.preventDefault(); dropZone.classList.remove('dragover'); handleFiles({ target: { files: e.dataTransfer.files } }); });

    function handleFiles(e) {
      selectedFiles = Array.from(e.target.files);
      if (selectedFiles.length > 0) {
        const names = selectedFiles.map(f => f.name).join(', ');
        status.textContent = selectedFiles.length + ' file(s) selected';
        status.className = 'status';
        uploadBtn.disabled = false;
      }
    }

    uploadBtn.addEventListener('click', async () => {
      if (selectedFiles.length === 0) return;
      uploadBtn.disabled = true;
      uploadBtn.textContent = 'Sending...';
      progress.style.display = 'block';
      progressBar.style.width = '0%';
      status.textContent = 'Uploading...';
      status.className = 'status';

      const form = new FormData();
      selectedFiles.forEach(f => form.append('files', f));

      try {
        const xhr = new XMLHttpRequest();
        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) {
            progressBar.style.width = (e.loaded / e.total * 100) + '%';
          }
        });
        xhr.addEventListener('load', () => {
          if (xhr.status === 200) {
            progressBar.style.width = '100%';
            status.textContent = selectedFiles.length + ' file(s) sent successfully!';
            status.className = 'status success';
            uploadBtn.textContent = 'Sent!';
            selectedFiles = [];
            setTimeout(() => { window.location.reload(); }, 2000);
          } else {
            throw new Error(xhr.responseText || 'Upload failed');
          }
        });
        xhr.addEventListener('error', () => { throw new Error('Network error'); });
        xhr.open('POST', '/api/transfers/receive');
        xhr.send(form);
      } catch (err) {
        status.textContent = 'Error: ' + err.message;
        status.className = 'status';
        status.style.color = '#f87171';
        uploadBtn.disabled = false;
        uploadBtn.textContent = 'Send Files';
      }
    });
  </script>
</body>
</html>`);
});

export default router;
