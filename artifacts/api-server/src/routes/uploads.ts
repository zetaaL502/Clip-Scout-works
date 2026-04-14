import { Router, type Request, type Response } from "express";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { spawn } from "node:child_process";

const router = Router();

const UPLOADS_DIR =
  process.platform === "win32"
    ? path.join(
        process.env.TEMP || process.env.TMP || "C:\\Windows\\Temp",
        "clipscout_uploads",
      )
    : "/tmp/clipscout_uploads";

const SUPPORTED_VIDEO = [".mp4", ".webm", ".mov", ".avi", ".mkv", ".m4v"];
const SUPPORTED_IMAGE = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"];

console.log(`[uploads] Using uploads directory: ${UPLOADS_DIR}`);
fsp.mkdir(UPLOADS_DIR, { recursive: true }).catch((err) => {
  console.error(`[uploads] Failed to create uploads directory: ${err}`);
});

function getExt(filename: string): string {
  return path.extname(filename).toLowerCase();
}

function isSupported(filename: string): boolean {
  const ext = getExt(filename);
  return SUPPORTED_VIDEO.includes(ext) || SUPPORTED_IMAGE.includes(ext);
}

function getMediaType(filename: string): "video" | "image" | null {
  const ext = getExt(filename);
  if (SUPPORTED_VIDEO.includes(ext)) return "video";
  if (SUPPORTED_IMAGE.includes(ext)) return "image";
  return null;
}

router.post("/extract-zip", async (req: Request, res: Response) => {
  console.log("[uploads] Received ZIP upload request");

  const contentType = req.headers["content-type"] || "";

  if (!contentType.includes("multipart/form-data")) {
    res.status(400).json({ error: "Expected multipart/form-data" });
    return;
  }

  try {
    // Get boundary
    const boundaryMatch = contentType.match(/boundary=(.+)/);
    if (!boundaryMatch) {
      res.status(400).json({ error: "No boundary found in content-type" });
      return;
    }
    const boundary = boundaryMatch[1];

    // Collect body as Buffer
    const chunks: Buffer[] = [];
    for await (const chunk of req as any) {
      chunks.push(Buffer.from(chunk));
    }
    const body = Buffer.concat(chunks);
    console.log(`[uploads] Received ${body.length} bytes`);

    if (!Buffer.isBuffer(body)) {
      res.status(500).json({ error: "Failed to read request body" });
      return;
    }

    function splitBuffer(buf: Buffer, sep: Buffer): Buffer[] {
      const result: Buffer[] = [];
      let start = 0;
      while (true) {
        const idx = buf.indexOf(sep, start);
        if (idx === -1) {
          result.push(buf.slice(start));
          break;
        }
        result.push(buf.slice(start, idx));
        start = idx + sep.length;
      }
      return result;
    }

    const boundaryBuffer = Buffer.from(`--${boundary}`);
    const endBoundary = Buffer.from(`--${boundary}--`);

    const parts = splitBuffer(body, boundaryBuffer);
    let zipBuffer: Buffer | null = null;

    for (const part of parts) {
      if (part.length === 0 || part.equals(endBoundary)) continue;

      // Remove trailing \r\n
      const trimmed = part.slice(0, part.length > 2 ? part.length - 2 : 0);
      const headerEndIndex = trimmed.indexOf(Buffer.from("\r\n\r\n"));
      if (headerEndIndex === -1) continue;

      const headers = trimmed.slice(0, headerEndIndex).toString();
      const content = trimmed.slice(headerEndIndex + 4);

      // Look for filename in headers
      const filenameMatch = headers.match(/filename="([^"]+)"/);
      if (filenameMatch && filenameMatch[1].toLowerCase().endsWith(".zip")) {
        zipBuffer = content;
        console.log(
          `[uploads] Found ZIP: ${filenameMatch[1]}, size: ${content.length}`,
        );
        break;
      }
    }

    if (!zipBuffer || zipBuffer.length === 0) {
      res.status(400).json({ error: "No ZIP file found in request" });
      return;
    }

    // Save ZIP
    const zipId = randomUUID();
    const zipPath = path.join(UPLOADS_DIR, `${zipId}.zip`);
    fs.writeFileSync(zipPath, zipBuffer);

    // Extract
    const extractDir = path.join(UPLOADS_DIR, zipId);
    await fsp.mkdir(extractDir, { recursive: true });

    let extractedFiles: {
      name: string;
      type: "video" | "image";
      path: string;
    }[] = [];

    try {
      if (process.platform === "win32") {
        await new Promise<void>((resolve, reject) => {
          const ps = spawn("powershell", [
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            `Expand-Archive -Path '${zipPath.replace(/'/g, "''")}' -DestinationPath '${extractDir.replace(/'/g, "''")}' -Force`,
          ]);

          let stderr = "";
          ps.stderr.on("data", (data) => {
            stderr += data.toString();
          });

          ps.on("close", (code) => {
            if (code === 0) resolve();
            else reject(new Error(`Expand-Archive failed: ${stderr}`));
          });
          ps.on("error", reject);
        });
      } else {
        await new Promise<void>((resolve, reject) => {
          const unzip = spawn("unzip", ["-o", zipPath, "-d", extractDir]);
          unzip.on("close", (code) => {
            if (code === 0) resolve();
            else reject(new Error(`unzip failed with code ${code}`));
          });
          unzip.on("error", reject);
        });
      }

      async function scanDir(dir: string): Promise<void> {
        const entries = await fsp.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            await scanDir(fullPath);
          } else if (entry.isFile() && isSupported(entry.name)) {
            const mediaType = getMediaType(entry.name);
            if (mediaType) {
              extractedFiles.push({
                name: entry.name,
                type: mediaType,
                path: fullPath,
              });
            }
          }
        }
      }

      await scanDir(extractDir);
      fs.unlinkSync(zipPath);

      res.json({
        success: true,
        uploadId: zipId,
        files: extractedFiles.map((f) => ({
          name: f.name,
          type: f.type,
          url: `/api/uploaded-file/${zipId}/${encodeURIComponent(f.name)}`,
        })),
      });
    } catch (err) {
      try {
        fs.unlinkSync(zipPath);
      } catch {}
      try {
        await fsp.rm(extractDir, { recursive: true, force: true });
      } catch {}
      res.status(500).json({
        error: `Failed to extract ZIP: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  } catch (err) {
    console.error(`[uploads] Error: ${err}`);
    res.status(500).json({ error: String(err) });
  }
});

router.get(
  "/uploaded-file/:uploadId/:filename",
  async (req: Request, res: Response) => {
    const { uploadId, filename } = req.params as {
      uploadId: string;
      filename: string;
    };
    const filePath = path.join(UPLOADS_DIR, uploadId, filename);

    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: "File not found" });
      return;
    }

    const ext = getExt(filename);
    const contentTypes: Record<string, string> = {
      ".mp4": "video/mp4",
      ".webm": "video/webm",
      ".mov": "video/quicktime",
      ".avi": "video/x-msvideo",
      ".mkv": "video/x-matroska",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
      ".gif": "image/gif",
      ".webp": "image/webp",
      ".bmp": "image/bmp",
    };

    res.setHeader(
      "Content-Type",
      contentTypes[ext] || "application/octet-stream",
    );
    res.setHeader("Cache-Control", "no-store");
    createReadStream(filePath).pipe(res);
  },
);

router.post("/upload-image", async (req: Request, res: Response) => {
  const contentType = req.headers["content-type"] || "";

  if (!contentType.includes("multipart/form-data")) {
    res.status(400).json({ error: "Expected multipart/form-data" });
    return;
  }

  try {
    const boundaryMatch = contentType.match(/boundary=(.+)/);
    if (!boundaryMatch) {
      res.status(400).json({ error: "No boundary found in content-type" });
      return;
    }
    const boundary = boundaryMatch[1];

    const chunks: Buffer[] = [];
    for await (const chunk of req as any) {
      chunks.push(Buffer.from(chunk));
    }
    const body = Buffer.concat(chunks);

    function splitBuffer(buf: Buffer, sep: Buffer): Buffer[] {
      const result: Buffer[] = [];
      let start = 0;
      while (true) {
        const idx = buf.indexOf(sep, start);
        if (idx === -1) {
          result.push(buf.slice(start));
          break;
        }
        result.push(buf.slice(start, idx));
        start = idx + sep.length;
      }
      return result;
    }

    const boundaryBuffer = Buffer.from(`--${boundary}`);
    const endBoundary = Buffer.from(`--${boundary}--`);

    const parts = splitBuffer(body, boundaryBuffer);

    for (const part of parts) {
      if (part.length === 0 || part.equals(endBoundary)) continue;

      const trimmed = part.slice(0, part.length > 2 ? part.length - 2 : 0);
      const headerEndIndex = trimmed.indexOf(Buffer.from("\r\n\r\n"));
      if (headerEndIndex === -1) continue;

      const headers = trimmed.slice(0, headerEndIndex).toString();
      const content = trimmed.slice(headerEndIndex + 4);

      const filenameMatch = headers.match(/filename="([^"]+)"/);
      if (!filenameMatch) continue;

      const filename = filenameMatch[1];
      const ext = path.extname(filename).toLowerCase();

      // Only accept images
      if (![".jpg", ".jpeg", ".png", ".webp"].includes(ext)) {
        res.status(400).json({ error: "Only JPG, PNG and WEBP accepted" });
        return;
      }

      // Check file size (10MB limit)
      if (content.length > 10 * 1024 * 1024) {
        res.status(400).json({ error: "File too large (max 10MB)" });
        return;
      }

      const imageId = randomUUID();
      const imageDir = path.join(UPLOADS_DIR, imageId);
      await fsp.mkdir(imageDir, { recursive: true });
      const imagePath = path.join(imageDir, filename);
      fs.writeFileSync(imagePath, content);

      res.json({
        success: true,
        imageId,
        filename,
        url: `/api/uploaded-file/${imageId}/${encodeURIComponent(filename)}`,
        fileType: `image/${ext.replace(".", "")}`,
      });
      return;
    }

    res.status(400).json({ error: "No image file found" });
  } catch (err) {
    console.error(`[uploads] Image upload error: ${err}`);
    res.status(500).json({ error: String(err) });
  }
});

export default router;
