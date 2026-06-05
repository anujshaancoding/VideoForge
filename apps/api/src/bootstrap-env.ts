// ─────────────────────────────────────────────────────────────────────────────
// Env bootstrap — MUST be the first import in server.ts (and any standalone entry).
//
// The host-run API uses `tsx` with no dotenv, so the monorepo-root `.env` was never
// loaded → S3_ENDPOINT was undefined → the S3 presigner emitted real-AWS URLs
// (vf-originals.s3.amazonaws.com) instead of MinIO (localhost:9000), so browser
// uploads 403'd and proxy/thumbnail GET URLs were unreachable. (Postgres/Redis only
// "worked" because their clients fall back to localhost defaults.)
//
// This loads root `.env` into process.env BEFORE s3.ts / db / queues construct their
// clients. Containerised processes (the worker) get env via docker-compose env_file,
// so this is a no-op there. Dependency-free: uses Node's built-in process.loadEnvFile
// (Node ≥ 20.12). Does not override variables already present in the environment.
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const candidates = [
  // repo root relative to this source file (apps/api/src → ../../../.env)
  resolve(dirname(fileURLToPath(import.meta.url)), '../../../.env'),
  // and relative to the current working directory (covers compiled / alt layouts)
  resolve(process.cwd(), '.env'),
  resolve(process.cwd(), '../../.env'),
];

const loadEnvFile = (process as { loadEnvFile?: (p: string) => void }).loadEnvFile;
if (typeof loadEnvFile === 'function') {
  for (const path of candidates) {
    if (existsSync(path)) {
      try {
        loadEnvFile(path);
      } catch {
        /* malformed/locked .env — fall back to process env + code defaults */
      }
      break;
    }
  }
}
