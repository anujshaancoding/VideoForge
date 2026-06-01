// ─────────────────────────────────────────────────────────────────────────────
// @videoforge/api — Fastify application (M1 production backend).
//
// Wires: Postgres (Drizzle), S3 presign, BullMQ queues, WebSocket hub,
// JWT auth stub, and the three §14 route groups.
//
// Spec map: §14 API Reference, §10.2 render path, §18 data model.
// ─────────────────────────────────────────────────────────────────────────────

import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import fastifyJwt from '@fastify/jwt';
import fastifyCookie from '@fastify/cookie';
import fastifyWebsocket from '@fastify/websocket';

import { eq } from 'drizzle-orm';
import { projectRoutes } from './routes/projects.js';
import { assetRoutes } from './routes/assets.js';
import { exportRoutes } from './routes/exports.js';
import { registerWs, broadcast } from './ws.js';
import { redisClient } from './queues.js';
import { db } from './db/client.js';
import { assets, exportJobs } from './db/schema.js';
import { runMigrations } from './db/migrate.js';

/** API version prefix used by every §14 route group. */
export const API_PREFIX = '/api/v1';

/**
 * Build (but do not start) the Fastify app. Exported so tests / embedders can
 * `inject()` without binding a port.
 */
export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: process.env['LOG_LEVEL'] ?? 'info',
    },
  });

  // ── Plugins ────────────────────────────────────────────────────────────────

  // Dev CORS: permissive for the Vite web app; production tightens to the
  // app origin (§19 security).
  await app.register(cors, {
    origin: true,
    credentials: true,
  });

  await app.register(fastifyCookie);

  await app.register(fastifyJwt, {
    secret: process.env['JWT_ACCESS_SECRET'] ?? 'dev_secret',
  });

  await app.register(fastifyWebsocket);

  // ── Health probe ───────────────────────────────────────────────────────────

  app.get('/health', async () => ({
    status: 'ok',
    service: '@videoforge/api',
    uptimeSeconds: Math.round(process.uptime()),
    now: new Date().toISOString(),
  }));

  // ── WebSocket hub ──────────────────────────────────────────────────────────

  // Route: GET /ws?workspaceId=xxx
  // Clients subscribe here and receive asset:ready / export:* events.
  app.register(async (wsApp: FastifyInstance) => {
    // websocket: true is provided by @fastify/websocket plugin augmentation.
    // Cast away the missing types until the package is installed.
    type AnyFn = (...args: unknown[]) => void;
    const wsGet = (wsApp as unknown as { get: AnyFn }).get.bind(wsApp);
    wsGet(
      '/ws',
      { websocket: true },
      (socket: unknown, request: FastifyRequest) => {
        const qs = request.query as Record<string, string | undefined>;
        const workspaceId = qs['workspaceId'] ?? 'dev-workspace';
        // ws.ts accepts any object with send/on — validated at runtime by @fastify/websocket.
        registerWs(socket as Parameters<typeof registerWs>[0], workspaceId);
        app.log.debug({ workspaceId }, 'ws client connected');
      },
    );
  });

  // ── Redis pub/sub → WS broadcast ──────────────────────────────────────────

  // Worker processes publish progress events on Redis channels.
  // We subscribe here and relay them to the matching workspace WS room.
  void setupRedisSubscriber(app);

  // ── §14 route groups ───────────────────────────────────────────────────────

  await app.register(projectRoutes, { prefix: `${API_PREFIX}/projects` });
  await app.register(assetRoutes, { prefix: `${API_PREFIX}/assets` });
  await app.register(exportRoutes, { prefix: `${API_PREFIX}/exports` });

  return app;
}

// ── Redis subscriber ───────────────────────────────────────────────────────

/** The exact channels the media + render workers publish on. */
const WORKER_CHANNELS = [
  'asset:ready',
  'asset:failed',
  'export:progress',
  'export:complete',
  'export:failed',
] as const;

interface WorkerEvent {
  type?: string;
  workspaceId?: string;
  assetId?: string;
  exportId?: string;
  progress?: number;
  proxyKey?: string;
  thumbnailKey?: string;
  waveformKey?: string;
  durationMs?: number;
  width?: number;
  height?: number;
  s3Key?: string;
  message?: string;
  [key: string]: unknown;
}

/**
 * Subscribe to worker-published Redis channels. The API is the single owner of
 * Postgres, so this subscriber is where worker progress is PERSISTED (status
 * transitions, S3 keys) and then relayed to the workspace WebSocket room.
 *
 * Channels (workers publish flat JSON, no per-id suffix):
 *   asset:ready      → { type, assetId, workspaceId, proxyKey, thumbnailKey, waveformKey, durationMs?, width?, height? }
 *   asset:failed     → { type, assetId, workspaceId, message }
 *   export:progress  → { type, exportId, workspaceId, progress, etaSeconds }
 *   export:complete  → { type, exportId, workspaceId, s3Key }
 *   export:failed    → { type, exportId, workspaceId, message }
 */
async function setupRedisSubscriber(app: FastifyInstance): Promise<void> {
  try {
    // ioredis requires a dedicated connection for subscribe mode.
    const sub = redisClient.duplicate();

    sub.on('error', (err: Error) => {
      app.log.warn({ err }, 'redis subscriber error');
    });

    await sub.subscribe(...WORKER_CHANNELS);

    sub.on('message', (channel: string, message: string) => {
      void handleWorkerEvent(app, channel, message);
    });

    app.log.info('redis pub/sub subscriber ready');
  } catch (err) {
    // Non-fatal: WS push will simply not work until Redis is available.
    app.log.warn({ err }, 'failed to connect redis subscriber; WS push disabled');
  }
}

/** Persist a worker event to Postgres, then broadcast it to the workspace WS room. */
async function handleWorkerEvent(
  app: FastifyInstance,
  channel: string,
  message: string,
): Promise<void> {
  let payload: WorkerEvent;
  try {
    payload = JSON.parse(message) as WorkerEvent;
  } catch {
    return; // malformed message — ignore
  }
  const workspaceId = payload.workspaceId ?? 'dev-workspace';

  try {
    switch (channel) {
      case 'asset:ready':
        if (payload.assetId) {
          await db
            .update(assets)
            .set({
              status: 'READY',
              ...(payload.proxyKey ? { s3KeyProxy: payload.proxyKey } : {}),
              ...(payload.thumbnailKey ? { s3KeyThumbnail: payload.thumbnailKey } : {}),
              ...(payload.waveformKey ? { s3KeyWaveform: payload.waveformKey } : {}),
              ...(typeof payload.durationMs === 'number' ? { durationMs: payload.durationMs } : {}),
              ...(typeof payload.width === 'number' ? { width: payload.width } : {}),
              ...(typeof payload.height === 'number' ? { height: payload.height } : {}),
            })
            .where(eq(assets.id, payload.assetId));
        }
        break;

      case 'asset:failed':
        if (payload.assetId) {
          await db
            .update(assets)
            .set({ status: 'FAILED' })
            .where(eq(assets.id, payload.assetId));
        }
        break;

      case 'export:progress':
        if (payload.exportId) {
          await db
            .update(exportJobs)
            .set({
              status: 'RUNNING',
              progress: typeof payload.progress === 'number' ? payload.progress : 0,
              updatedAt: new Date(),
            })
            .where(eq(exportJobs.id, payload.exportId));
        }
        break;

      case 'export:complete':
        if (payload.exportId) {
          await db
            .update(exportJobs)
            .set({
              status: 'COMPLETE',
              progress: 100,
              ...(payload.s3Key ? { s3KeyOutput: payload.s3Key } : {}),
              updatedAt: new Date(),
            })
            .where(eq(exportJobs.id, payload.exportId));
        }
        break;

      case 'export:failed':
        if (payload.exportId) {
          await db
            .update(exportJobs)
            .set({
              status: 'FAILED',
              errorMessage: payload.message ?? 'render failed',
              updatedAt: new Date(),
            })
            .where(eq(exportJobs.id, payload.exportId));
        }
        break;
    }
  } catch (err) {
    app.log.error({ err, channel }, 'failed to persist worker event');
  }

  // Relay to the workspace WS room regardless of persistence outcome.
  broadcast(workspaceId, payload);
}

// ── Entry point ────────────────────────────────────────────────────────────

/** Resolve the listen port from PORT env (Pipeline.md §2 dev env), default 4000. */
function resolvePort(): number {
  const raw = process.env['PORT'];
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 4000;
}

/** Start the HTTP server. Invoked when this module is the process entry point. */
async function start(): Promise<void> {
  const app = await buildServer();
  const port = resolvePort();
  const host = process.env['HOST'] ?? '0.0.0.0';

  // Apply DB migrations before accepting traffic so a fresh database just works
  // (CREATE TABLE IF NOT EXISTS — idempotent). Fatal on failure: the API cannot
  // serve without its schema.
  try {
    await runMigrations();
    app.log.info('database migrations applied');
  } catch (err) {
    app.log.error({ err }, 'database migration failed; cannot start');
    process.exit(1);
  }

  try {
    await app.listen({ port, host });
    app.log.info(
      `@videoforge/api listening on http://${host}:${port}${API_PREFIX}`,
    );
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }

  // Graceful shutdown so `tsx watch` reloads cleanly and containers stop fast.
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      app.log.info(`received ${signal}, closing server`);
      void app.close().then(() => process.exit(0));
    });
  }
}

// ESM entry-point guard: run only when executed directly (not when imported).
if (import.meta.url === `file://${process.argv[1]}`) {
  void start();
}
