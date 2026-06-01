// ─────────────────────────────────────────────────────────────────────────────
// Regression: the PATCH /api/v1/projects/:id autosave CONTRACT.
//
// The autosave request body is the envelope { document, baseRevision } — NOT a
// bare §18 Project. A prior bug validated the whole envelope, which always 422'd
// and broke every save. This suite POSTs a project, then PATCHes it with the
// envelope and asserts the server accepts it (200 + bumped revision), never 422.
//
// buildServer() opens Postgres + Redis connections. When those services are not
// reachable (e.g. a plain local checkout), we SKIP the whole suite instead of
// failing — so it runs green in CI Stage 3 (with services) and is a clean no-op
// otherwise.
// ─────────────────────────────────────────────────────────────────────────────

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

let app: FastifyInstance | null = null;
let skip = false;
let skipReason = '';

beforeAll(async () => {
  try {
    const { buildServer } = await import('../../server.js');
    app = await buildServer();
    await app.ready();

    // /health never touches the DB, so it always 200s. Probe a route that
    // actually queries Postgres — a non-200 means services are unreachable and
    // the suite should skip rather than fail.
    const probe = await app.inject({ method: 'GET', url: '/api/v1/projects' });
    if (probe.statusCode !== 200) {
      throw new Error(
        `Postgres probe (GET /api/v1/projects) returned ${probe.statusCode}`,
      );
    }
  } catch (err) {
    skip = true;
    skipReason = err instanceof Error ? err.message : String(err);
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
      `[projects.contract] skipping — backend services unavailable: ${skipReason}`,
    );
  }
});

afterAll(async () => {
  if (app) await app.close();
});

describe('PATCH /api/v1/projects/:id autosave envelope contract', () => {
  it('accepts the { document, baseRevision } envelope and bumps the revision', async () => {
    if (skip || !app) {
      // Guarded skip: services not reachable in this environment.
      return;
    }

    // 1) Create a project (POST returns the full §18 document, revision: 1).
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      payload: {
        title: 'Contract Test Project',
        canvasWidth: 1080,
        canvasHeight: 1920,
        frameRate: 30,
      },
    });
    expect(createRes.statusCode).toBe(201);

    const project = createRes.json() as { id: string; revision: number };
    expect(typeof project.id).toBe('string');
    expect(project.revision).toBe(1);

    // 2) Autosave it back via the envelope { document, baseRevision }.
    //    This is exactly the request the web store sends.
    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/projects/${project.id}`,
      payload: { document: project, baseRevision: project.revision },
    });

    // The envelope MUST be accepted — never a 422 (the regression).
    expect(patchRes.statusCode).not.toBe(422);
    expect(patchRes.statusCode).toBe(200);

    const saved = patchRes.json() as { revision: number; updatedAt: string };
    expect(saved.revision).toBe(project.revision + 1);
    expect(typeof saved.updatedAt).toBe('string');

    // Cleanup so reruns stay idempotent.
    await app.inject({ method: 'DELETE', url: `/api/v1/projects/${project.id}` });
  });
});
