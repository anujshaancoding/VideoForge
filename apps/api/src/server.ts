// ─────────────────────────────────────────────────────────────────────────────
// @videoforge/api — Fastify application (M1 production backend).
//
// Wires: Postgres (Drizzle), S3 presign, BullMQ queues, WebSocket hub,
// JWT auth stub, and the three §14 route groups.
//
// Spec map: §14 API Reference, §10.2 render path, §18 data model.
// ─────────────────────────────────────────────────────────────────────────────

// MUST be first: loads the root .env into process.env before any S3/DB/Redis client
// module is evaluated (otherwise S3_ENDPOINT is undefined → presigner emits AWS URLs).
import './bootstrap-env.js';

// ── Sentry (ROADMAP #10) ───────────────────────────────────────────────────
// Import AFTER bootstrap-env so SENTRY_DSN is already in process.env.
// `enabled: false` when DSN is absent/blank — every Sentry call is a no-op.
import * as Sentry from '@sentry/node';
// `SENTRY_DSN` is empty string when unset; only pass `dsn` when it is truthy
// so we never hand `undefined` into a field typed as `string` (exactOptionalPropertyTypes).
const _apiSentryDsn = process.env['SENTRY_DSN'] || '';
Sentry.init({
  ...(_apiSentryDsn ? { dsn: _apiSentryDsn } : {}),
  enabled: !!_apiSentryDsn,
});

import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import fastifyJwt from '@fastify/jwt';
import fastifyCookie from '@fastify/cookie';
import fastifyWebsocket from '@fastify/websocket';

import { eq } from 'drizzle-orm';
import { projectRoutes } from './routes/projects.js';
import { assetRoutes } from './routes/assets.js';
import { exportRoutes } from './routes/exports.js';
import { authRoutes } from './routes/auth.js';
import { versionRoutes } from './routes/versions.js';
import { scriptRoutes } from './routes/script.js';
import { createScriptWorker } from './script/worker.js';
import { registerAuthDecorator, resolveJwtSecret } from './auth/plugin.js';
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

  // Resolve BOTH JWT secrets eagerly at startup. In production an unset/empty
  // secret throws here (fail-fast) rather than silently signing tokens with a
  // public dev constant — a prod deploy that forgot the env must not boot.
  // We resolve the refresh secret too (not just access) so a missing refresh
  // secret also fails at startup, not lazily on the first refresh.
  resolveJwtSecret('JWT_REFRESH_SECRET', 'dev_refresh_secret');
  await app.register(fastifyJwt, {
    secret: resolveJwtSecret('JWT_ACCESS_SECRET', 'dev_secret'),
  });

  // Auth: the `authenticate` preHandler decorator (verifies the access JWT and
  // sets request.user = { userId, email }). Must run after @fastify/jwt so the
  // jwtVerify augmentation is available on the request.
  registerAuthDecorator(app);

  await app.register(fastifyWebsocket);

  // ── Health probe ───────────────────────────────────────────────────────────

  app.get('/health', async () => ({
    status: 'ok',
    service: '@videoforge/api',
    uptimeSeconds: Math.round(process.uptime()),
    now: new Date().toISOString(),
  }));

  // ── WebSocket hub ──────────────────────────────────────────────────────────

  // Route: GET /ws?token=<accessJWT>
  // The WS room key is the authenticated userId (== workspaceId in the
  // user-is-the-workspace MVP model). Browsers can't set an Authorization header
  // on a WebSocket, so the SHORT-LIVED access token is passed as the `token`
  // query param. We deliberately do NOT accept the 30-day refresh cookie here —
  // a leaked WS URL should expire with the access token, not grant a month of
  // socket access. A connection with no valid access token is closed immediately
  // (1008 policy violation).
  app.register(async (wsApp: FastifyInstance) => {
    // websocket: true is provided by @fastify/websocket plugin augmentation.
    // Cast away the missing types until the package is installed.
    type AnyFn = (...args: unknown[]) => void;
    const wsGet = (wsApp as unknown as { get: AnyFn }).get.bind(wsApp);
    wsGet(
      '/ws',
      { websocket: true },
      (connection: unknown, request: FastifyRequest) => {
        // @fastify/websocket v8 passes a WebSocketStream whose `.socket` is the
        // raw `ws` WebSocket; the raw socket is the object that actually has
        // `.send()` / `.close(code, reason)` and is what ws.ts's room needs.
        // (v9+ passes the raw socket directly — fall back to `connection`.)
        const ws =
          (connection as { socket?: unknown })?.socket ?? connection;
        const qs = request.query as Record<string, string | undefined>;
        const userId = resolveWsUserId(app, qs['token']);
        if (!userId) {
          // Reject unauthenticated sockets with a 1008 policy-violation close.
          try {
            (ws as { close?: (code?: number, reason?: string) => void }).close?.(
              1008,
              'unauthorized',
            );
          } catch {
            /* socket already gone */
          }
          app.log.debug('ws client rejected: no valid token');
          return;
        }
        // ws.ts accepts any object with send/on — validated at runtime by @fastify/websocket.
        registerWs(ws as Parameters<typeof registerWs>[0], userId);
        app.log.debug({ userId }, 'ws client connected');
      },
    );
  });

  // ── Redis pub/sub → WS broadcast ──────────────────────────────────────────

  // Worker processes publish progress events on Redis channels.
  // We subscribe here and relay them to the matching workspace WS room.
  void setupRedisSubscriber(app);

  // ── §14 route groups ───────────────────────────────────────────────────────

  await app.register(authRoutes, { prefix: `${API_PREFIX}/auth` });
  await app.register(projectRoutes, { prefix: `${API_PREFIX}/projects` });
  // Project version history (snapshots/restore). Same /projects prefix so paths are
  // /api/v1/projects/:projectId/versions[/...]. Registered as its own plugin so it
  // owns its routes without touching projectRoutes (sibling-owned file).
  await app.register(versionRoutes, { prefix: `${API_PREFIX}/projects` });
  await app.register(assetRoutes, { prefix: `${API_PREFIX}/assets` });
  await app.register(exportRoutes, { prefix: `${API_PREFIX}/exports` });
  // Script Studio v2 (Contract C): /plan, /generate, /arrange.
  await app.register(scriptRoutes, { prefix: `${API_PREFIX}/script` });

  // Boot the bounded `script` worker IN-PROCESS (concurrency 1). It writes the
  // project + manifest rows (Postgres) and originals (S3) — both API-owned — so it
  // runs here rather than in render-worker. Short scripts run inline in the route;
  // this only handles the long-script async path. Guarded so tests that build the
  // app without Redis don't spin a live worker.
  if (process.env['SCRIPT_WORKER_DISABLED'] !== 'true') {
    try {
      const scriptWorker = createScriptWorker();
      app.addHook('onClose', async () => {
        await scriptWorker.close();
      });
    } catch (err) {
      app.log.warn({ err }, 'script worker failed to start; long-script path disabled');
    }
  }

  // ── Sentry error capture ───────────────────────────────────────────────────
  // Fastify's setErrorHandler is the single funnel for all unhandled route
  // errors.  We capture to Sentry (no-op when DSN is blank) then re-throw so
  // Fastify's default JSON error serialiser still sends the right HTTP status.
  app.setErrorHandler((error, _request, reply) => {
    Sentry.captureException(error);
    void reply.status(error.statusCode ?? 500).send({
      error: error.name ?? 'InternalServerError',
      message: error.message,
      statusCode: error.statusCode ?? 500,
    });
  });

  return app;
}

// ── WS auth ──────────────────────────────────────────────────────────────────

/**
 * Resolve the authenticated userId for a WebSocket connection from the
 * short-lived access JWT passed as the `token` query param. Returns null when
 * the token is missing or invalid.
 *
 * The refresh cookie is intentionally NOT accepted as a WS credential: it lives
 * for 30 days, so honoring it here would broaden the blast radius of a leaked
 * socket URL far beyond the access-token window. WS auth is access-token-only.
 *
 * The returned userId is the WS room key — the same value stored in
 * `workspace_id` everywhere else (user-is-the-workspace MVP model).
 */
function resolveWsUserId(
  app: FastifyInstance,
  token: string | undefined,
): string | null {
  if (!token) return null;
  try {
    const claims = app.jwt.verify<{ sub: string }>(token);
    return claims?.sub ?? null;
  } catch {
    return null;
  }
}

// ── Redis subscriber ───────────────────────────────────────────────────────

/** The exact channels the media + render workers publish on. */
const WORKER_CHANNELS = [
  'asset:ready',
  'asset:failed',
  'export:progress',
  'export:complete',
  'export:failed',
  // Script Studio v2 long-script job events. The script worker persists the project
  // + manifest itself, so these are relay-only (broadcast to the workspace WS room).
  'script:progress',
  'script:complete',
  'script:failed',
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
  // The worker echoes back the `workspaceId` it was given on the job — which is
  // now the authenticated userId (user-is-the-workspace MVP model). It is the WS
  // room key. A missing value means we can't target a room; relay to '' (no-op).
  const workspaceId = payload.workspaceId ?? '';

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
