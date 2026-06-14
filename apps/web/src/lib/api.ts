// API client for apps/web — talks to @videoforge/api (localhost:4000).
// All functions throw on non-2xx so callers can catch and surface errors.
//
// Auth (Wave 2): the access token lives ONLY in memory (never localStorage — a
// stolen-XSS token can't be persisted). Every request attaches it as a Bearer
// header and sends `credentials:'include'` so the httpOnly `vf_refresh` cookie
// rides along. On a 401 we transparently `POST /refresh` exactly ONCE, store the
// rotated access token, and retry the original request; if refresh itself fails
// we emit a "needs-login" signal and stop (no retry loop).

const BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:4000/api/v1';

// ── Auth contract types ────────────────────────────────────────────────────────

export interface AuthUser {
  id: string;
  email: string;
  displayName: string | null;
}

export interface AuthSession {
  accessToken: string;
  user: AuthUser;
}

/** Structured API error so callers can branch on status / server error code. */
export class ApiError extends Error {
  constructor(
    message: string,
    /** HTTP status (e.g. 401, 409, 429). */
    readonly status: number,
    /** Machine code from the JSON body (e.g. "EmailTaken", "InvalidCredentials"). */
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// ── In-memory access token + "needs-login" signal ──────────────────────────────

let accessToken: string | null = null;
type NeedsLoginListener = () => void;
const needsLoginListeners = new Set<NeedsLoginListener>();

/** Read the current in-memory access token (null when logged out). */
export function getAccessToken(): string | null {
  return accessToken;
}

/**
 * True when we currently hold an access token (i.e. an authenticated session is
 * live in memory). Used by the persistence layer to tell a *transient auth race*
 * (no token yet, refresh still resolving) apart from a *genuine offline* failure,
 * so a 401-before-refresh never masks/overwrites the user's saved server document
 * with stale localStorage data.
 */
export function hasSession(): boolean {
  return accessToken != null;
}

/** Store/clear the in-memory access token (called by the auth store). */
export function setAccessToken(token: string | null): void {
  accessToken = token;
}

/**
 * Subscribe to the "needs-login" signal — fired when a refresh attempt fails, so
 * the auth layer can drop the session and route to /login. Returns an unsubscribe.
 */
export function onNeedsLogin(listener: NeedsLoginListener): () => void {
  needsLoginListeners.add(listener);
  return () => needsLoginListeners.delete(listener);
}

function emitNeedsLogin(): void {
  accessToken = null;
  for (const l of needsLoginListeners) {
    try {
      l();
    } catch {
      // a listener throwing must not break the request that triggered it
    }
  }
}

/** Parse a JSON error body into a machine code, tolerating non-JSON bodies. */
function errorCodeFromBody(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body) as { error?: unknown };
    return typeof parsed.error === 'string' ? parsed.error : undefined;
  } catch {
    return undefined;
  }
}

/** Raw fetch with Bearer + cookies; does NOT attempt refresh (used by refresh itself). */
async function rawFetch(path: string, init?: RequestInit): Promise<Response> {
  // Only declare a JSON body when one is actually sent. Fastify rejects an empty
  // body that carries `Content-Type: application/json` (FST_ERR_CTP_EMPTY_JSON_BODY),
  // which would 400 body-less POSTs like asset confirm and project duplicate.
  const headers: Record<string, string> = { ...((init?.headers as Record<string, string>) ?? {}) };
  if (init?.body != null && headers['Content-Type'] == null) {
    headers['Content-Type'] = 'application/json';
  }
  if (accessToken && headers['Authorization'] == null) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }
  return fetch(`${BASE}${path}`, {
    credentials: 'include',
    ...init,
    headers,
  });
}

/**
 * POST /refresh using the httpOnly cookie (no body). On success stores the rotated
 * access token and returns the session; on failure emits "needs-login" and returns
 * null. Concurrent callers share a single in-flight refresh (no thundering herd).
 */
let refreshInFlight: Promise<AuthSession | null> | null = null;
export function refreshSession(): Promise<AuthSession | null> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      const res = await rawFetch('/auth/refresh', { method: 'POST' });
      if (!res.ok) {
        emitNeedsLogin();
        return null;
      }
      const session = (await res.json()) as AuthSession;
      accessToken = session.accessToken;
      return session;
    } catch {
      emitNeedsLogin();
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

async function request<T>(path: string, init?: RequestInit, _retried = false): Promise<T> {
  const res = await rawFetch(path, init);

  if (res.status === 401 && !_retried && !path.startsWith('/auth/')) {
    // Try a single silent refresh, then replay the original request once.
    const session = await refreshSession();
    if (session) return request<T>(path, init, true);
    // Refresh failed — emitNeedsLogin already fired; surface a clean 401.
    throw new ApiError(`API 401 ${path}: unauthorized`, 401, 'Unauthorized');
  }

  if (!res.ok) {
    const body = await res.text();
    const code = errorCodeFromBody(body);
    // Exports are rate-limited (429) — surface a friendly, non-crashing message.
    if (res.status === 429) {
      throw new ApiError(
        "You're exporting too fast — wait a moment and try again.",
        429,
        code ?? 'RateLimited',
      );
    }
    throw new ApiError(`API ${res.status} ${path}: ${body}`, res.status, code);
  }
  return res.json() as Promise<T>;
}

// ── Auth API ────────────────────────────────────────────────────────────────────

export async function apiSignup(body: {
  email: string;
  password: string;
  displayName?: string;
}): Promise<AuthSession> {
  const session = await request<AuthSession>('/auth/signup', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  accessToken = session.accessToken;
  return session;
}

export async function apiLogin(body: { email: string; password: string }): Promise<AuthSession> {
  const session = await request<AuthSession>('/auth/login', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  accessToken = session.accessToken;
  return session;
}

export async function apiLogout(): Promise<void> {
  try {
    await request('/auth/logout', { method: 'POST' });
  } finally {
    // Always drop the in-memory token, even if the network call fails.
    accessToken = null;
  }
}

export async function apiMe(): Promise<AuthUser> {
  const { user } = await request<{ user: AuthUser }>('/auth/me');
  return user;
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

export interface PatchProjectResponse {
  revision: number;
  updatedAt: string;
}

export async function apiPatchProject(
  id: string,
  body: { document: unknown; baseRevision: number },
  /**
   * When true, send the request with `keepalive` so it survives page unload/hide.
   * Used by autosave's flush-on-`pagehide`/`visibilitychange` so the user's last
   * edits are persisted even when the browser is tearing the page down on reload.
   */
  opts?: { keepalive?: boolean },
): Promise<PatchProjectResponse> {
  return request<PatchProjectResponse>(`/projects/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
    ...(opts?.keepalive ? { keepalive: true } : {}),
  });
}

export async function apiDeleteProject(id: string): Promise<void> {
  await request(`/projects/${id}`, { method: 'DELETE' });
}

export async function apiDuplicateProject(id: string): Promise<ApiProject> {
  return request<ApiProject>(`/projects/${id}/duplicate`, { method: 'POST' });
}

// ── Accepted formats + size ceilings (MVP §3.1) ─────────────────────────────────
// Single decode path: MP4/MOV (H.264), MP3/WAV/AAC, JPG/PNG only. Everything else
// (H.265/MKV/AVI/…) is rejected up-front rather than presigned + uploaded then
// failed late in the worker. Mirrored server-side in /presign (415 / 413).

export type MediaKindLabel = 'video' | 'audio' | 'image';

/** Accepted MIME content-types. Some browsers emit variant audio MIMEs, so the
 *  audio set is intentionally broad within the WAV/MP3/AAC family. */
export const ACCEPTED_MIME = new Set<string>([
  // video — MP4 / MOV containers (H.264)
  'video/mp4',
  'video/quicktime',
  // audio — MP3 / WAV / AAC
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
  'audio/aac',
  'audio/mp4',
  'audio/x-m4a',
  'audio/m4a',
  // image — JPG / PNG
  'image/jpeg',
  'image/png',
]);

/** Accepted file extensions (fallback when the browser supplies no/empty MIME). */
export const ACCEPTED_EXTENSIONS = new Set<string>([
  '.mp4', '.mov',
  '.mp3', '.wav', '.aac', '.m4a',
  '.jpg', '.jpeg', '.png',
]);

/** Per-kind upload ceilings (bytes): 20 GB video / 2 GB audio / 100 MB image. */
export const SIZE_LIMITS: Record<MediaKindLabel, number> = {
  video: 20 * 1024 * 1024 * 1024,
  audio: 2 * 1024 * 1024 * 1024,
  image: 100 * 1024 * 1024,
};

function extOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot >= 0 ? filename.slice(dot).toLowerCase() : '';
}

/** True when the (contentType, filename) pair is an accepted MVP input format. */
export function isAcceptedFormat(contentType: string, filename: string): boolean {
  if (contentType && ACCEPTED_MIME.has(contentType.toLowerCase())) return true;
  return ACCEPTED_EXTENSIONS.has(extOf(filename));
}

/** Human-readable byte size, for friendly limit messages. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(bytes % 1024 ** 3 === 0 ? 0 : 1)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
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
  /** Workspace dedup hash (SHA-256 hex). Renamed from the misleading `md5Hash`. */
  contentHash: string | null;
}): Promise<PresignResponse> {
  return request<PresignResponse>('/assets/presign', { method: 'POST', body: JSON.stringify(body) });
}

/** Rename an asset's display filename. */
export async function apiRenameAsset(assetId: string, filename: string): Promise<AssetRecord> {
  return request<AssetRecord>(`/assets/${assetId}`, {
    method: 'PATCH',
    body: JSON.stringify({ filename }),
  });
}

/** Delete an asset (and its S3 objects) from the workspace. */
export async function apiDeleteAsset(assetId: string): Promise<void> {
  await request(`/assets/${assetId}`, { method: 'DELETE' });
}

/**
 * PUT a file directly to a presigned S3 URL, reporting upload progress (0–100).
 * Uses XMLHttpRequest because fetch() cannot surface upload-progress events.
 */
export function apiUploadToS3(
  uploadUrl: string,
  file: File,
  onProgress?: (pct: number) => void,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl);
    xhr.setRequestHeader('Content-Type', file.type);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`S3 upload failed: ${xhr.status} ${xhr.statusText}`));
    };
    xhr.onerror = () => reject(new Error('S3 upload network error'));
    xhr.onabort = () => reject(new Error('S3 upload aborted'));
    xhr.send(file);
  });
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
  // Non-empty when a referenced clip's ORIGINAL asset is missing
  // (proxy-downgrade warning, surfaced on the POST /exports response).
  warnings?: string[];
}

export async function apiCreateExport(body: {
  projectId: string;
  settings: Record<string, unknown>;
  /**
   * Optional full `Project` render-snapshot. When present the worker renders THIS
   * exact document instead of re-loading the saved project — so the export matches
   * the on-screen preview (WYCIWYG), with unfilled template slots already pruned by
   * the caller. Omitted ⇒ server renders the persisted project (legacy path).
   */
  document?: unknown;
}): Promise<ExportRecord> {
  return request<ExportRecord>('/exports', { method: 'POST', body: JSON.stringify(body) });
}

export async function apiGetExport(exportId: string): Promise<ExportRecord> {
  return request<ExportRecord>(`/exports/${exportId}`);
}

export async function apiGetDownloadUrl(exportId: string): Promise<{ downloadUrl: string }> {
  // Must be POST to match the server route (which mints a fresh 1h signed URL on each call).
  // Using GET would 404 (no GET handler registered for the download action).
  return request<{ downloadUrl: string }>(`/exports/${exportId}/download`, { method: 'POST' });
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

// ── Content-hash helper (browser) ──────────────────────────────────────────────

/** Compute the SHA-256 hex content hash of a File via SubtleCrypto, used as the
 *  workspace dedup key (sent to /presign as `contentHash`). */
export async function fileHash(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const hashBuf = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
