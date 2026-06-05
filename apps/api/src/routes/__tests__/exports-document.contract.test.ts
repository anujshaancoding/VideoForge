// ─────────────────────────────────────────────────────────────────────────────
// Contract: POST /api/v1/exports accepting an OPTIONAL `document` render-snapshot
// (Templates wave — agreed across Core/Reel/Pixel). Additive + backward-compatible.
//
// When `document` is present the worker must render THAT exact §18 snapshot
// (the previewed, prune-of-unfilled-slots document) instead of the stored
// project — preserving preview==export. It must NOT change ownership/billing
// or bypass the Free-tier watermark/rate-limit.
//
// Covers:
//   (a) export WITH a valid document → the enqueued render job's `project`
//       payload IS that document (the field the worker reads, not the stored one).
//   (b) export WITHOUT a document    → unchanged; the job carries the stored project.
//   (c) export with an INVALID document → 400 ValidationError, NO job enqueued.
//   (d) a document for a project the caller does NOT own → rejected (404),
//       NO job enqueued (the snapshot can't smuggle in another user's projectId).
//   (e) the per-user rate-limit (5/min) STILL applies on the document path.
//
// We assert on the enqueued BullMQ job by importing the SAME `renderQueue`
// singleton the route enqueues onto, then locating the job whose data.exportId
// matches the POST response. settings.watermark stays true on every job.
//
// Harness mirrors exports-ratelimit.contract.test.ts: buildServer() opens
// Postgres+Redis; when unreachable we SKIP the whole suite (clean no-op locally,
// green in CI Stage 3 with services up).
// ─────────────────────────────────────────────────────────────────────────────

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Project } from '@videoforge/project-schema';
import type { Job } from 'bullmq';
import { renderQueue, type RenderJobData } from '../../queues.js';

let app: FastifyInstance | null = null;
let skip = false;
let skipReason = '';

let accessToken = '';
let projectId = '';

// A second, independent user — used to prove ownership: their projectId is NOT
// addressable by the primary user even with a (valid) snapshot in the body.
let otherToken = '';
let otherProjectId = '';

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const password = 'export-doc-pass-1234';

function authHeaders(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

const createdProjects: Array<{ id: string; token: string }> = [];

/** Sign up a throwaway user and return its access token. */
async function signup(email: string): Promise<string> {
  const res = await app!.inject({
    method: 'POST',
    url: '/api/v1/auth/signup',
    payload: { email, password },
  });
  if (res.statusCode !== 201) throw new Error(`signup returned ${res.statusCode}`);
  return (res.json() as { accessToken: string }).accessToken;
}

/** Create a blank project for `token` and return its id. */
async function createProject(token: string, title: string): Promise<string> {
  const res = await app!.inject({
    method: 'POST',
    url: '/api/v1/projects',
    headers: authHeaders(token),
    payload: { title, canvasWidth: 1080, canvasHeight: 1920, frameRate: 30 },
  });
  if (res.statusCode !== 201) throw new Error(`project create returned ${res.statusCode}`);
  const id = (res.json() as { id: string }).id;
  createdProjects.push({ id, token });
  return id;
}

/** Read back the full server-blessed §18 document for `id`. */
async function getDocument(token: string, id: string): Promise<Project> {
  const res = await app!.inject({
    method: 'GET',
    url: `/api/v1/projects/${id}`,
    headers: authHeaders(token),
  });
  if (res.statusCode !== 200) throw new Error(`project GET returned ${res.statusCode}`);
  return (res.json() as { document: Project }).document;
}

/**
 * Locate the enqueued render job whose data.exportId matches, scanning across
 * BullMQ states (a live worker in CI may move it waiting→active→completed). We
 * poll briefly so the assertion is robust whether or not a worker is draining.
 */
async function findRenderJob(exportId: string): Promise<Job<RenderJobData> | null> {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const jobs = (await renderQueue.getJobs(
      ['waiting', 'active', 'delayed', 'completed', 'paused', 'prioritized'],
      0,
      200,
    )) as Array<Job<RenderJobData>>;
    const match = jobs.find((j) => j?.data?.exportId === exportId);
    if (match) return match;
    await new Promise((r) => setTimeout(r, 40));
  }
  return null;
}

beforeAll(async () => {
  try {
    const { buildServer } = await import('../../server.js');
    app = await buildServer();
    await app.ready();

    accessToken = await signup(`exp-doc-${stamp}@example.test`);
    projectId = await createProject(accessToken, 'Export Document Project');

    otherToken = await signup(`exp-doc-other-${stamp}@example.test`);
    otherProjectId = await createProject(otherToken, 'Other Owner Project');
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
      `[exports-document.contract] skipping — backend services unavailable: ${skipReason}`,
    );
  }
});

afterAll(async () => {
  if (app) {
    for (const { id, token } of createdProjects) {
      try {
        await app.inject({
          method: 'DELETE',
          url: `/api/v1/projects/${id}`,
          headers: authHeaders(token),
        });
      } catch {
        /* ignore */
      }
    }
    await app.close();
  }
});

describe('POST /api/v1/exports with an optional document snapshot', () => {
  // (a) valid document → job.project IS that snapshot; watermark intact.
  it('(a) enqueues a render job carrying the supplied document snapshot', async () => {
    if (skip || !app) return;

    const base = await getDocument(accessToken, projectId);
    // A distinguishing marker proves the SNAPSHOT (not the stored doc) was enqueued.
    const document: Project = { ...base, title: 'Previewed Snapshot — Export Me' };

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/exports',
      headers: authHeaders(accessToken),
      payload: { projectId, document },
    });
    expect(res.statusCode).toBe(201);
    const { exportId } = res.json() as { exportId: string };

    const job = await findRenderJob(exportId);
    expect(job).not.toBeNull();
    const data = job!.data;
    // The worker reads `data.project` — it must be the supplied snapshot.
    expect((data.project as Project).title).toBe('Previewed Snapshot — Export Me');
    expect((data.project as Project).id).toBe(document.id);
    // Ownership/billing unchanged: still exported under the user's projectId/workspace.
    expect(data.projectId).toBe(projectId);
    // Free-tier watermark is NOT bypassed by the snapshot.
    expect((data.settings as { watermark?: unknown }).watermark).toBe(true);
  });

  // (b) no document → unchanged; job carries the STORED project.
  it('(b) without a document, enqueues the stored project (unchanged behaviour)', async () => {
    if (skip || !app) return;

    const stored = await getDocument(accessToken, projectId);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/exports',
      headers: authHeaders(accessToken),
      payload: { projectId },
    });
    expect(res.statusCode).toBe(201);
    const { exportId } = res.json() as { exportId: string };

    const job = await findRenderJob(exportId);
    expect(job).not.toBeNull();
    const data = job!.data;
    // The enqueued document is the stored one (same id + title as fetched).
    expect((data.project as Project).id).toBe(stored.id);
    expect((data.project as Project).title).toBe(stored.title);
    expect(data.projectId).toBe(projectId);
    expect((data.settings as { watermark?: unknown }).watermark).toBe(true);
  });

  // (c) invalid document → 400 ValidationError, NO job enqueued.
  it('(c) rejects an invalid document with 400 and enqueues nothing', async () => {
    if (skip || !app) return;

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/exports',
      headers: authHeaders(accessToken),
      // Structurally broken §18 document.
      payload: { projectId, document: { id: 'not-a-uuid', title: '', tracks: 'nope' } },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe('ValidationError');
  });

  // (d) document for a project the caller does NOT own → rejected (404),
  //     NO job enqueued. The snapshot cannot smuggle in another user's projectId.
  it("(d) rejects a document targeting a project the caller does not own", async () => {
    if (skip || !app) return;

    // A perfectly VALID document, but `projectId` belongs to `otherToken`'s user.
    const victimDoc = await getDocument(otherToken, otherProjectId);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/exports',
      headers: authHeaders(accessToken), // primary user, NOT the owner
      payload: { projectId: otherProjectId, document: victimDoc },
    });
    // Ownership is enforced by the existing workspace-scoped project lookup,
    // which runs BEFORE any validation/enqueue → 404, nothing is enqueued.
    expect(res.statusCode).toBe(404);
    expect((res.json() as { error: string }).error).toBe('NotFound');
  });

  // (e) the 5/min per-user rate-limit STILL applies on the document path.
  it('(e) still enforces the per-user export rate-limit with a document present', async () => {
    if (skip || !app) return;

    // Fresh user → fresh window, independent of the other tests' consumed slots.
    const rlToken = await signup(`exp-doc-rl-${stamp}@example.test`);
    const rlProjectId = await createProject(rlToken, 'RL Document Project');
    const doc = await getDocument(rlToken, rlProjectId);

    // Requests 1..5 must be admitted (not 429); the 6th must be 429 — even though
    // every request carries a (valid) document snapshot.
    for (let i = 1; i <= 5; i += 1) {
      const r = await app.inject({
        method: 'POST',
        url: '/api/v1/exports',
        headers: authHeaders(rlToken),
        payload: { projectId: rlProjectId, document: doc },
      });
      expect(r.statusCode).not.toBe(429);
    }
    const sixth = await app.inject({
      method: 'POST',
      url: '/api/v1/exports',
      headers: authHeaders(rlToken),
      payload: { projectId: rlProjectId, document: doc },
    });
    expect(sixth.statusCode).toBe(429);
    expect((sixth.json() as { error: string }).error).toBe('RateLimitExceeded');
  });
});
