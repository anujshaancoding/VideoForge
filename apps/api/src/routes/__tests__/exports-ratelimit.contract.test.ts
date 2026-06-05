// ─────────────────────────────────────────────────────────────────────────────
// Export rate-limit contract: the per-user sliding window (5/min) is enforced
// ATOMICALLY via a single Redis Lua eval (prune+count+conditional-add), closing
// the prior TOCTOU race where separate zremrangebyscore/zcard/zadd calls let
// concurrent requests all slip past.
//
// Boundary assertion: within one window the FIRST `limit` requests are admitted
// past the rate gate, and the (limit+1)-th is rejected with 429. We also fire a
// concurrent burst to confirm the atomic path never admits more than `limit`.
//
// Each request hits the rate gate BEFORE the FFmpeg graph build, so a request
// "consumes a slot" as long as it passes auth + project lookup. We assert on the
// 429 status specifically (rate denied), independent of graph-build outcome.
//
// Needs Postgres + Redis (buildServer). Self-skips when unreachable.
// ─────────────────────────────────────────────────────────────────────────────

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

let app: FastifyInstance | null = null;
let skip = false;
let accessToken = '';
let projectId = '';

const email = `rl-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
const password = 'rate-limit-pass-123';

function authHeaders(): Record<string, string> {
  return { authorization: `Bearer ${accessToken}` };
}

beforeAll(async () => {
  try {
    const { buildServer } = await import('../../server.js');
    app = await buildServer();
    await app.ready();

    const signup = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      payload: { email, password },
    });
    if (signup.statusCode !== 201) {
      throw new Error(`signup probe returned ${signup.statusCode}`);
    }
    accessToken = (signup.json() as { accessToken: string }).accessToken;

    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: authHeaders(),
      payload: {
        title: 'Rate Limit Project',
        canvasWidth: 1080,
        canvasHeight: 1920,
        frameRate: 30,
      },
    });
    if (create.statusCode !== 201) {
      throw new Error(`project create returned ${create.statusCode}`);
    }
    projectId = (create.json() as { id: string }).id;
  } catch (err) {
    skip = true;
    if (app) {
      try {
        await app.close();
      } catch {
        /* ignore */
      }
      app = null;
    }
    // eslint-disable-next-line no-console
    console.warn(
      `[exports-ratelimit.contract] skipping — backend services unavailable: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
});

afterAll(async () => {
  if (app) {
    if (projectId) {
      try {
        await app.inject({
          method: 'DELETE',
          url: `/api/v1/projects/${projectId}`,
          headers: authHeaders(),
        });
      } catch {
        /* ignore */
      }
    }
    await app.close();
  }
});

function postExport(): Promise<number> {
  return app!
    .inject({
      method: 'POST',
      url: '/api/v1/exports',
      headers: authHeaders(),
      payload: { projectId },
    })
    .then((r) => r.statusCode);
}

describe('POST /api/v1/exports rate limit (5/min, atomic)', () => {
  it('admits the first 5 in the window and rejects the 6th with 429', async () => {
    if (skip || !app) return;

    // Sequential: requests 1..5 must NOT be 429 (admitted past the gate); the
    // 6th must be 429 (rate denied).
    for (let i = 1; i <= 5; i += 1) {
      const code = await postExport();
      expect(code).not.toBe(429);
    }
    const sixth = await postExport();
    expect(sixth).toBe(429);
  });

  it('never admits more than the limit under a concurrent burst (atomicity)', async () => {
    if (skip || !app) return;

    // Fresh user → fresh window, so this test is independent of the first.
    const burstEmail = `rl-burst-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
    const signup = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      payload: { email: burstEmail, password },
    });
    expect(signup.statusCode).toBe(201);
    const burstToken = (signup.json() as { accessToken: string }).accessToken;
    const burstAuth = { authorization: `Bearer ${burstToken}` };

    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: burstAuth,
      payload: { title: 'Burst', canvasWidth: 1080, canvasHeight: 1920, frameRate: 30 },
    });
    expect(create.statusCode).toBe(201);
    const burstProjectId = (create.json() as { id: string }).id;

    // Fire 10 exports concurrently. Atomic limiter ⇒ at most 5 pass the gate
    // (non-429), the rest are 429. With the old TOCTOU code more than 5 could
    // pass under this concurrency.
    const codes = await Promise.all(
      Array.from({ length: 10 }, () =>
        app!
          .inject({
            method: 'POST',
            url: '/api/v1/exports',
            headers: burstAuth,
            payload: { projectId: burstProjectId },
          })
          .then((r) => r.statusCode),
      ),
    );

    const admitted = codes.filter((c) => c !== 429).length;
    const denied = codes.filter((c) => c === 429).length;
    expect(admitted).toBeLessThanOrEqual(5);
    expect(admitted + denied).toBe(10);
    expect(denied).toBeGreaterThanOrEqual(5);

    await app.inject({
      method: 'DELETE',
      url: `/api/v1/projects/${burstProjectId}`,
      headers: burstAuth,
    });
  });
});
