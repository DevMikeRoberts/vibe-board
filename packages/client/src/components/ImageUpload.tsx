import { useState, useRef, useCallback } from 'react';
import type { TaskAttachment } from '@/types';
import { api } from '@/lib/api';

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
          border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors
          ${dragOver
            ? 'border-blue-400 bg-blue-50 dark:bg-blue-900/20'
            : 'border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500'}
          ${uploading ? 'opacity-60 pointer-events-none' : ''}
        `}
      >
        <input ref={inputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleInputChange} />
        <div className="flex flex-col items-center gap-1">
          <svg className="w-6 h-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <span className="text-sm text-gray-500 dark:text-gray-400">
            {uploading ? 'Uploading…' : 'Drop images here or click to browse'}
          </span>
          <span className="text-xs text-gray-400 dark:text-gray-500">
            PNG, JPEG, GIF, WebP, SVG · Max 10MB · {MAX_ATTACHMENTS - totalCount} remaining
          </span>
        </div>
      </div>

      {/* Error */}
      {error && <p className="text-xs text-red-500">{error}</p>}

      {/* Thumbnails */}
      {hasImages && (
        <div className="flex flex-wrap gap-2">
          {/* Existing server-side attachments */}
          {existing.map(a => (
            <div key={a.id} className="relative group">
              <img
                src={api.getAttachmentUrl(a.id)}
                alt={a.originalName}
                className="w-16 h-16 object-cover rounded-lg border border-gray-200 dark:border-gray-700"
              />
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); removeExisting(a); }}
                className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500 text-white text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-sm"
              >
                ×
              </button>
              <span className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-[9px] px-1 truncate rounded-b-lg">
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
                className="w-16 h-16 object-cover rounded-lg border border-gray-200 dark:border-gray-700"
              />
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); removePending(i); }}
                className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500 text-white text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-sm"
              >
                ×
              </button>
              <span className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-[9px] px-1 truncate rounded-b-lg">
                {p.file.name}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
