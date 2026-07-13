import { useState, useRef, useCallback } from 'react';
import type { TaskAttachment } from '@/types';
import { api } from '@/lib/api';
import { PixelIcon } from './PixelIcon';

const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'];
const MAX_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_ATTACHMENTS = 10;

interface PendingFile {
  file: File;
  preview: string;
}

interface ImageUploadProps {
  /** Task ID — when set, uploads go to the server immediately */
  taskId?: string;
  /** Existing attachments (edit mode or loaded from server) */
  existing?: TaskAttachment[];
  /** Called when pending files change (create mode, no taskId yet) */
  onPendingChange?: (files: File[]) => void;
  /** Called after a server-side upload or delete */
  onAttachmentsChange?: (attachments: TaskAttachment[]) => void;
}

export default function ImageUpload({ taskId, existing = [], onPendingChange, onAttachmentsChange }: ImageUploadProps) {
  const [pending, setPending] = useState<PendingFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const totalCount = existing.length + pending.length;

  const validateFiles = useCallback((files: File[]): File[] => {
    setError(null);
    const valid: File[] = [];
    for (const f of files) {
      if (!ALLOWED_TYPES.includes(f.type)) {
        setError(`${f.name}: unsupported type. Use PNG, JPEG, GIF, WebP, or SVG.`);
        continue;
      }
      if (f.size > MAX_SIZE) {
        setError(`${f.name}: exceeds 10MB limit.`);
        continue;
      }
      if (totalCount + valid.length >= MAX_ATTACHMENTS) {
        setError(`Maximum ${MAX_ATTACHMENTS} images allowed.`);
        break;
      }
      valid.push(f);
    }
    return valid;
  }, [totalCount]);

  const addFiles = useCallback(async (files: File[]) => {
    const valid = validateFiles(files);
    if (valid.length === 0) return;

    if (taskId) {
      // Upload immediately to server
      setUploading(true);
      try {
        const uploaded = await api.uploadAttachments(taskId, valid);
        onAttachmentsChange?.([...existing, ...uploaded]);
      } catch (e: any) {
        setError(e.message || 'Upload failed');
      } finally {
        setUploading(false);
      }
    } else {
      // Hold in local state for create mode
      const newPending = valid.map(file => ({
        file,
        preview: URL.createObjectURL(file),
      }));
      const updated = [...pending, ...newPending];
      setPending(updated);
      onPendingChange?.(updated.map(p => p.file));
    }
  }, [taskId, existing, pending, validateFiles, onAttachmentsChange, onPendingChange]);

  const removePending = useCallback((index: number) => {
    URL.revokeObjectURL(pending[index].preview);
    const updated = pending.filter((_, i) => i !== index);
    setPending(updated);
    onPendingChange?.(updated.map(p => p.file));
  }, [pending, onPendingChange]);

  const removeExisting = useCallback(async (attachment: TaskAttachment) => {
    try {
      await api.deleteAttachment(attachment.id);
      onAttachmentsChange?.(existing.filter(a => a.id !== attachment.id));
    } catch (e: any) {
      setError(e.message || 'Delete failed');
    }
  }, [existing, onAttachmentsChange]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    addFiles(files);
  }, [addFiles]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  }, []);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      addFiles(Array.from(e.target.files));
      e.target.value = '';
    }
  }, [addFiles]);

  const hasImages = existing.length > 0 || pending.length > 0;

  return (
    <div className="space-y-2">
      {/* Drop zone */}
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => inputRef.current?.click()}
        className={`
          border-2 border-dashed rounded-2xl p-5 text-center cursor-pointer transition-colors
          ${dragOver
            ? 'border-neon-pink bg-[color-mix(in_srgb,var(--color-neon-pink)_12%,transparent)]'
            : 'border-border bg-card hover:border-neon-pink/60'}
          ${uploading ? 'opacity-60 pointer-events-none' : ''}
        `}
      >
        <input ref={inputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleInputChange} />
        <div className="flex flex-col items-center gap-2">
          <PixelIcon name="camera-1" className="animate-px-bob h-8 w-8 text-neon-pink" />
          <span className="font-pixel text-[11px] text-foreground/80 [text-transform:lowercase]">
            {uploading ? 'uploading…' : 'drop images here or click to browse'}
          </span>
          <span className="font-pixel text-[10px] text-muted-foreground [text-transform:lowercase]">
            png · jpeg · gif · webp · svg — max 10mb — {MAX_ATTACHMENTS - totalCount} left
          </span>
        </div>
      </div>

      {/* Error */}
      {error && (
        <p className="flex items-center gap-1.5 font-pixel text-[10px] text-destructive">
          <PixelIcon name="alert-triangle-1" className="h-3.5 w-3.5 shrink-0" />
          {error}
        </p>
      )}

      {/* Thumbnails */}
      {hasImages && (
        <div className="flex flex-wrap gap-2">
          {/* Existing server-side attachments */}
          {existing.map(a => (
            <div key={a.id} className="relative group">
              <img
                src={api.getAttachmentUrl(a.id)}
                alt={a.originalName}
                className="w-16 h-16 object-cover rounded-xl border-2 border-ink"
              />
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); removeExisting(a); }}
                className="sticker-sm absolute -top-2 -right-2 w-6 h-6 rounded-full bg-destructive font-pixel text-cream text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              >
                ✕
              </button>
              <span className="absolute bottom-0 left-0 right-0 bg-ink/70 text-cream font-pixel text-[8px] px-1 truncate rounded-b-xl">
                {a.originalName}
              </span>
            </div>
          ))}
          {/* Pending local files */}
          {pending.map((p, i) => (
            <div key={`pending-${i}`} className="relative group">
              <img
                src={p.preview}
                alt={p.file.name}
                className="w-16 h-16 object-cover rounded-xl border-2 border-ink"
              />
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); removePending(i); }}
                className="sticker-sm absolute -top-2 -right-2 w-6 h-6 rounded-full bg-destructive font-pixel text-cream text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              >
                ✕
              </button>
              <span className="absolute bottom-0 left-0 right-0 bg-ink/70 text-cream font-pixel text-[8px] px-1 truncate rounded-b-xl">
                {p.file.name}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
