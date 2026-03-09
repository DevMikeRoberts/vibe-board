import { Router, Request, Response } from 'express';
import multer from 'multer';
import { v4 as uuid } from 'uuid';
import path from 'path';
import fs from 'fs';
import type { TaskAttachment } from '../types.js';
import type { TaskRepository } from '../repositories/types.js';
import type { AttachmentStore } from '../repositories/attachment-types.js';
import { asyncHandler, paramId } from './helpers.js';

export const UPLOADS_DIR = path.join(process.cwd(), 'data', 'uploads');
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const CACHE_MAX_AGE = 86400;
const MAX_ATTACHMENTS_PER_TASK = 10;
const ALLOWED_MIME_TYPES = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp',
]);

fs.mkdirSync(UPLOADS_DIR, { recursive: true });

export type { AttachmentStore } from '../repositories/attachment-types.js';

// ─── Multer config ──────────────────────────────────────────────────

function createUpload() {
  const storage = multer.diskStorage({
    destination(_req, _file, cb) {
      const taskId = typeof _req.params.id === 'string' ? _req.params.id : _req.params.id[0];
      const dir = path.join(UPLOADS_DIR, taskId);
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename(_req, file, cb) {
      const ext = path.extname(file.originalname);
      cb(null, `${uuid()}${ext}`);
    },
  });

  return multer({
    storage,
    limits: { fileSize: MAX_FILE_SIZE, files: MAX_ATTACHMENTS_PER_TASK },
    fileFilter(_req, file, cb) {
      if (ALLOWED_MIME_TYPES.has(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new Error(`Unsupported file type: ${file.mimetype}. Allowed: ${[...ALLOWED_MIME_TYPES].join(', ')}`));
      }
    },
  });
}

// ─── Router ─────────────────────────────────────────────────────────

export function createAttachmentsRouter(
  taskRepo: TaskRepository,
  store: AttachmentStore,
): Router {
  const router = Router();
  const upload = createUpload();

  // POST /tasks/:id/attachments — upload images
  router.post('/tasks/:id/attachments', asyncHandler(async (req: Request, res: Response) => {
    const taskId = paramId(req);
    const task = await taskRepo.getById(taskId);
    if (!task) {
      res.status(404).json({ error: 'task not found' });
      return;
    }

    const count = await store.countByTaskId(taskId);
    if (count >= MAX_ATTACHMENTS_PER_TASK) {
      res.status(400).json({ error: `Maximum ${MAX_ATTACHMENTS_PER_TASK} attachments per task` });
      return;
    }

    const remaining = MAX_ATTACHMENTS_PER_TASK - count;
    await new Promise<void>((resolve) => {
      upload.array('images', remaining)(req, res, (err) => {
        if (err instanceof multer.MulterError) {
          if (err.code === 'LIMIT_FILE_SIZE') {
            res.status(400).json({ error: `File too large. Maximum size: ${MAX_FILE_SIZE / 1024 / 1024}MB` });
          } else if (err.code === 'LIMIT_FILE_COUNT') {
            res.status(400).json({ error: `Too many files. Maximum ${remaining} more allowed` });
          } else {
            res.status(400).json({ error: err.message });
          }
          resolve();
          return;
        }
        if (err) {
          res.status(400).json({ error: err.message });
          resolve();
          return;
        }
        resolve();
      });
    });

    if (res.headersSent) return;
    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) {
      res.status(400).json({ error: 'No image files provided' });
      return;
    }

    const attachments: TaskAttachment[] = [];

    try {
      for (const file of files) {
        const attachment: TaskAttachment = {
          id: uuid(),
          taskId,
          filename: file.filename,
          originalName: file.originalname,
          mimeType: file.mimetype,
          size: file.size,
          createdAt: Date.now(),
        };
        await store.insert(attachment);
        attachments.push(attachment);
      }
      res.status(201).json(attachments);
    } catch (err) {
      // Clean up uploaded files on DB error
      for (const file of files) {
        fs.unlink(file.path, () => {});
      }
      res.status(500).json({ error: 'Failed to save attachment metadata' });
    }
  }));

  // GET /tasks/:id/attachments — list attachments
  router.get('/tasks/:id/attachments', asyncHandler(async (req: Request, res: Response) => {
    const taskId = paramId(req);
    const task = await taskRepo.getById(taskId);
    if (!task) {
      res.status(404).json({ error: 'task not found' });
      return;
    }
    const attachments = await store.getByTaskId(taskId);
    res.json(attachments);
  }));

  // GET /attachments/:id/file — serve image file
  router.get('/attachments/:id/file', asyncHandler(async (req: Request, res: Response) => {
    const attachment = await store.getById(paramId(req));
    if (!attachment) {
      res.status(404).json({ error: 'attachment not found' });
      return;
    }
    const filePath = path.join(UPLOADS_DIR, attachment.taskId, attachment.filename);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'file not found on disk' });
      return;
    }
    res.setHeader('Content-Type', attachment.mimeType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', `public, max-age=${CACHE_MAX_AGE}`);
    res.sendFile(filePath);
  }));

  // DELETE /attachments/:id — remove attachment
  router.delete('/attachments/:id', asyncHandler(async (req: Request, res: Response) => {
    const attachment = await store.getById(paramId(req));
    if (!attachment) {
      res.status(404).json({ error: 'attachment not found' });
      return;
    }
    const filePath = path.join(UPLOADS_DIR, attachment.taskId, attachment.filename);
    fs.unlink(filePath, () => {}); // ignore missing
    await store.deleteById(attachment.id);
    res.status(204).end();
  }));

  return router;
}
