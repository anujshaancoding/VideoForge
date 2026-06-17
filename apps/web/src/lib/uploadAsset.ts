// uploadAsset — the shared presign → PUT/multipart → confirm → poll(+WS) upload flow,
// extracted from MediaPanel so the Script Studio Auto-arrange tray can reuse the EXACT
// same pipeline instead of reinventing it. Returns the READY AssetRecord (registered
// in assetStore by the caller) or throws with a friendly message.
//
// This is the same sequence MediaPanel.uploadFile() runs; the WS `asset:ready` push is
// still handled there for the library grid. Here the HTTP poll (apiPollAssetReady) is
// the source of truth so a one-shot uploader doesn't need to wire its own WS handler.

import {
  apiPresign,
  apiUploadToS3,
  apiMultipartUpload,
  MULTIPART_THRESHOLD,
  apiConfirmUpload,
  apiPollAssetReady,
  fileHash,
  isAcceptedFormat,
  SIZE_LIMITS,
  formatBytes,
  type AssetRecord,
} from './api.js';

export type UploadAssetKind = 'video' | 'audio' | 'image';

export function kindFromMime(mime: string): UploadAssetKind {
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('image/')) return 'image';
  return 'video';
}

export class UploadError extends Error {}

export interface UploadCallbacks {
  /** assetId is known after presign (or dedup); fires once. */
  onAssetId?: (assetId: string) => void;
  /** 0–100 byte-upload progress. */
  onProgress?: (pct: number) => void;
  /** Bytes done, server-side processing started (no byte progress from here). */
  onProcessing?: () => void;
}

/**
 * Run the full upload pipeline for one File. Validates format/size up-front (the
 * server re-validates with 415/413 anyway), uploads (single-shot or resumable
 * multipart by size), confirms, then polls until READY.
 */
export async function uploadAsset(file: File, cb: UploadCallbacks = {}): Promise<AssetRecord> {
  const kind = kindFromMime(file.type);

  if (!isAcceptedFormat(file.type, file.name)) {
    throw new UploadError('Format not supported. Use MP4/MOV, MP3/WAV/AAC, or JPG/PNG.');
  }
  const sizeLimit = SIZE_LIMITS[kind];
  if (file.size > sizeLimit) {
    throw new UploadError(`Too large — ${kind} files must be under ${formatBytes(sizeLimit)}.`);
  }

  const contentHash = await fileHash(file);
  const presign = await apiPresign({
    filename: file.name,
    contentType: file.type,
    fileSize: file.size,
    contentHash,
  });

  // Dedup: the workspace already has this exact file — reuse it.
  if (presign.existingAssetId) {
    cb.onAssetId?.(presign.existingAssetId);
    cb.onProcessing?.();
    return apiPollAssetReady(presign.existingAssetId);
  }

  const assetId = presign.assetId!;
  cb.onAssetId?.(assetId);

  if (file.size >= MULTIPART_THRESHOLD) {
    await apiMultipartUpload(assetId, file, (pct) => cb.onProgress?.(pct));
  } else {
    await apiUploadToS3(presign.uploadUrl!, file, (pct) => cb.onProgress?.(pct));
  }

  await apiConfirmUpload(assetId);
  cb.onProcessing?.();

  return apiPollAssetReady(assetId);
}
