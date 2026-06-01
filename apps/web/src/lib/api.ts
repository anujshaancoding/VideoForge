// API client for apps/web — talks to @videoforge/api (localhost:4000).
// All functions throw on non-2xx so callers can catch and surface errors.

const BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:4000/api/v1';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    credentials: 'include',
    ...init,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API ${res.status} ${path}: ${body}`);
  }
  return res.json() as Promise<T>;
}

// ── Project API ───────────────────────────────────────────────────────────────

export interface ApiProject {
  id: string;
  name: string;
  document: unknown;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export async function apiListProjects(): Promise<ApiProject[]> {
  // API returns { items, total } shape
  const res = await request<{ items: ApiProject[] } | ApiProject[]>('/projects');
  return Array.isArray(res) ? res : (res as { items: ApiProject[] }).items;
}

export async function apiGetProject(id: string): Promise<ApiProject> {
  return request<ApiProject>(`/projects/${id}`);
}

export async function apiCreateProject(body: { name: string; document: unknown }): Promise<ApiProject> {
  return request<ApiProject>('/projects', { method: 'POST', body: JSON.stringify(body) });
}

export async function apiPatchProject(id: string, body: { document: unknown; baseRevision: number }): Promise<ApiProject> {
  return request<ApiProject>(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
}

export async function apiDeleteProject(id: string): Promise<void> {
  await request(`/projects/${id}`, { method: 'DELETE' });
}

export async function apiDuplicateProject(id: string): Promise<ApiProject> {
  return request<ApiProject>(`/projects/${id}/duplicate`, { method: 'POST' });
}

// ── Asset API ─────────────────────────────────────────────────────────────────

export interface PresignResponse {
  assetId?: string;
  existingAssetId?: string;
  uploadUrl?: string;
  partSizeBytes?: number;
  expiresAt?: string;
}

export interface AssetRecord {
  id: string;
  status: 'AWAITING_UPLOAD' | 'PROCESSING' | 'READY' | 'FAILED';
  filename: string;
  contentType: string;
  fileSize: number;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  proxyUrl: string | null;
  thumbnailUrl: string | null;
  waveformUrl: string | null;
  createdAt: string;
}

export async function apiPresign(body: {
  filename: string;
  contentType: string;
  fileSize: number;
  md5Hash: string | null;
}): Promise<PresignResponse> {
  return request<PresignResponse>('/assets/presign', { method: 'POST', body: JSON.stringify(body) });
}

export async function apiConfirmUpload(assetId: string): Promise<AssetRecord> {
  return request<AssetRecord>(`/assets/${assetId}/confirm`, { method: 'POST' });
}

export async function apiGetAsset(assetId: string): Promise<AssetRecord> {
  return request<AssetRecord>(`/assets/${assetId}`);
}

/** Poll until asset.status === 'READY' or timeout, returning the READY record. */
export async function apiPollAssetReady(assetId: string, timeoutMs = 120_000): Promise<AssetRecord> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const asset = await apiGetAsset(assetId);
    if (asset.status === 'READY') return asset;
    if (asset.status === 'FAILED') throw new Error(`Asset ${assetId} processing failed`);
    await new Promise<void>((r) => setTimeout(r, 2000));
  }
  throw new Error(`Asset ${assetId} not ready within ${timeoutMs}ms`);
}

// ── Export API ────────────────────────────────────────────────────────────────

export interface ExportRecord {
  exportId: string;
  projectId: string;
  status: 'QUEUED' | 'RUNNING' | 'COMPLETE' | 'FAILED';
  progress: number;
  outputUrl: string | null;
  errorMessage: string | null;
  previewCommand?: string;
}

export async function apiCreateExport(body: {
  projectId: string;
  settings: Record<string, unknown>;
}): Promise<ExportRecord> {
  return request<ExportRecord>('/exports', { method: 'POST', body: JSON.stringify(body) });
}

export async function apiGetExport(exportId: string): Promise<ExportRecord> {
  return request<ExportRecord>(`/exports/${exportId}`);
}

export async function apiGetDownloadUrl(exportId: string): Promise<{ downloadUrl: string }> {
  return request<{ downloadUrl: string }>(`/exports/${exportId}/download`);
}

/** Poll until export is COMPLETE or FAILED. Calls onProgress with 0–100. */
export async function apiPollExportComplete(
  exportId: string,
  onProgress: (pct: number) => void,
  timeoutMs = 30 * 60 * 1000,
): Promise<ExportRecord> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const rec = await apiGetExport(exportId);
    onProgress(Math.round(rec.progress));
    if (rec.status === 'COMPLETE') return rec;
    if (rec.status === 'FAILED') throw new Error(rec.errorMessage ?? 'Export failed');
    await new Promise<void>((r) => setTimeout(r, 3000));
  }
  throw new Error(`Export ${exportId} did not complete within timeout`);
}

// ── MD5 helper (browser) ──────────────────────────────────────────────────────

/** Compute MD5 hex of a File using SubtleCrypto (SHA-256 proxy for dedup — close enough for MVP). */
export async function fileHash(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const hashBuf = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
