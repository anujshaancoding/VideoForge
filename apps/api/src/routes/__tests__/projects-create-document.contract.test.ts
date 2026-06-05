// ─────────────────────────────────────────────────────────────────────────────
// Contract: POST /api/v1/projects accepting an OPTIONAL `document`
// (create-from-template path — Forge's "Option A", additive + backward-compatible).
//
// Covers:
//   (a) create WITH a valid document → 201, persisted; GET returns that document.
//   (b) create WITHOUT a document    → still seeds a blank project (NO regression).
//   (c) create with an INVALID document → 400, NO insert.
//   (d) plan-limit enforcement applies to a provided document → 422.
//   (e) the server OVERRIDES client-supplied id/ownerId/workspaceId/collaborators/
//       revision/isPublic — a client cannot inject another user's id or spoof
//       ownership. `templateId` round-trips as provenance.
//   (+) autosave (PATCH envelope) on a template-created project is UNREGRESSED.
//
// Harness mirrors projects.contract.test.ts: buildServer() opens Postgres+Redis;
// when unreachable we SKIP the whole suite (clean no-op locally, green in CI
// Stage 3 with services up). Auth: a throwaway user is signed up in beforeAll and
// its access token is sent on every project request.
// ─────────────────────────────────────────────────────────────────────────────

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Project } from '@videoforge/project-schema';

let app: FastifyInstance | null = null;
let skip = false;
let skipReason = '';
let accessToken = '';
/** The authenticated user's id (== workspaceId in the MVP model). */
let selfUserId = '';

function authHeaders(): Record<string, string> {
  return { authorization: `Bearer ${accessToken}` };
}

/** The trail of created project ids, cleaned up in afterAll for idempotent reruns. */
const created: string[] = [];

/**
 * Obtain a real, server-blessed valid §18 document to drive the document-create
 * path: POST a blank project (Path A) and read back its full document via GET.
 * This avoids coupling the test to schema-fixture internals and uses exactly the
 * shape the server itself produces.
 */
async function freshValidDocument(): Promise<Project> {
  const res = await app!.inject({
    method: 'POST',
    url: '/api/v1/projects',
    headers: authHeaders(),
    payload: { title: 'Seed', canvasWidth: 1080, canvasHeight: 1920, frameRate: 30 },
  });
  expect(res.statusCode).toBe(201);
  const doc = res.json() as Project;
  created.push(doc.id);
  return doc;
}

beforeAll(async () => {
  try {
    const { buildServer } = await import('../../server.js');
    app = await buildServer();
    await app.ready();

    const unauth = await app.inject({ method: 'GET', url: '/api/v1/projects' });
    if (unauth.statusCode !== 401) {
      throw new Error(
        `Unauthenticated GET /api/v1/projects returned ${unauth.statusCode} (expected 401)`,
      );
    }

    const signup = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      payload: {
        email: `create-doc-${Date.now()}@example.test`,
        password: 'contract-pass-1234',
      },
    });
    if (signup.statusCode !== 201) {
      throw new Error(`signup probe returned ${signup.statusCode}`);
    }
    const json = signup.json() as { accessToken: string; user: { id: string } };
    accessToken = json.accessToken;
    selfUserId = json.user.id;
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
      `[projects-create-document.contract] skipping — backend services unavailable: ${skipReason}`,
    );
  }
});

afterAll(async () => {
  if (app) {
    for (const id of created) {
      try {
        await app.inject({
          method: 'DELETE',
          url: `/api/v1/projects/${id}`,
          headers: authHeaders(),
        });
      } catch {
        /* ignore */
      }
    }
    await app.close();
  }
});

describe('POST /api/v1/projects with an optional document', () => {
  // (a) valid document → 201, persisted, GET returns it.
  it('(a) creates from a valid document and round-trips it via GET', async () => {
    if (skip || !app) return;

    const base = await freshValidDocument();
    const document: Project = {
      ...base,
      title: 'From Template — Valid',
      // A distinguishing marker so we can confirm the SAME document was persisted.
      description: 'template-doc-marker',
    };

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: authHeaders(),
      payload: { document },
    });
    expect(res.statusCode).toBe(201);

    const persisted = res.json() as Project;
    created.push(persisted.id);
    expect(persisted.title).toBe('From Template — Valid');
    expect(persisted.description).toBe('template-doc-marker');

    // GET returns the same document.
    const getRes = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${persisted.id}`,
      headers: authHeaders(),
    });
    expect(getRes.statusCode).toBe(200);
    const fetched = getRes.json() as { document: Project };
    expect(fetched.document.id).toBe(persisted.id);
    expect(fetched.document.title).toBe('From Template — Valid');
    expect(fetched.document.description).toBe('template-doc-marker');
    // The persisted document preserves the (non-identity) graph: same track count.
    expect(fetched.document.tracks.length).toBe(document.tracks.length);
  });

  // (b) no document → blank seed, unchanged behaviour (no regression).
  it('(b) still seeds a blank project when no document is supplied', async () => {
    if (skip || !app) return;

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: authHeaders(),
      payload: { title: 'Blank Seed', canvasWidth: 1080, canvasHeight: 1920, frameRate: 30 },
    });
    expect(res.statusCode).toBe(201);

    const project = res.json() as Project;
    created.push(project.id);
    expect(project.title).toBe('Blank Seed');
    expect(project.revision).toBe(1);
    expect(project.templateId ?? null).toBeNull();
    // newProject() seeds exactly one empty video track.
    expect(project.tracks.length).toBe(1);
    expect(project.tracks[0]?.type).toBe('video');
  });

  // (c) invalid document → 400, NO insert.
  it('(c) rejects an invalid document with 400 and does not insert', async () => {
    if (skip || !app) return;

    const before = await app.inject({
      method: 'GET',
      url: '/api/v1/projects',
      headers: authHeaders(),
    });
    const countBefore = (before.json() as { total: number }).total;

    // Structurally broken: missing required fields, bad id, wrong types.
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: authHeaders(),
      payload: { document: { id: 'not-a-uuid', title: '', tracks: 'nope' } },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe('ValidationError');

    // No row was inserted.
    const after = await app.inject({
      method: 'GET',
      url: '/api/v1/projects',
      headers: authHeaders(),
    });
    const countAfter = (after.json() as { total: number }).total;
    expect(countAfter).toBe(countBefore);
  });

  // (d) plan-limit enforcement applies to a provided document → 422.
  it('(d) enforces plan limits on a provided document (over-cap → 422)', async () => {
    if (skip || !app) return;

    const base = await freshValidDocument();
    // 4 video tracks exceeds the Free cap of 3 → checkPlanLimits must reject.
    const overCap: Project = {
      ...base,
      title: 'Over Cap',
      tracks: [0, 1, 2, 3].map((i) => ({
        id: `00000000-0000-4000-8000-00000000000${i}`,
        type: 'video' as const,
        name: `Video ${i + 1}`,
        colour: '#3A6BFF',
        height: 72,
        muted: false,
        solo: false,
        locked: false,
        clips: [],
      })),
    };

    const before = await app.inject({
      method: 'GET',
      url: '/api/v1/projects',
      headers: authHeaders(),
    });
    const countBefore = (before.json() as { total: number }).total;

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: authHeaders(),
      payload: { document: overCap },
    });
    expect(res.statusCode).toBe(422);
    expect((res.json() as { error: string }).error).toBe('PlanLimitExceeded');

    // No insert on a plan-limit rejection.
    const after = await app.inject({
      method: 'GET',
      url: '/api/v1/projects',
      headers: authHeaders(),
    });
    expect((after.json() as { total: number }).total).toBe(countBefore);
  });

  // (e) server overrides client-supplied identity/ownership; templateId round-trips.
  it('(e) overrides client-supplied id/ownerId/workspaceId/collaborators/revision', async () => {
    if (skip || !app) return;

    const base = await freshValidDocument();
    const SPOOFED_ID = '11111111-1111-4111-8111-111111111111';
    const VICTIM_OWNER = '22222222-2222-4222-8222-222222222222';
    const VICTIM_WS = '33333333-3333-4333-8333-333333333333';
    const PROVENANCE = '44444444-4444-4444-8444-444444444444';

    const document: Project = {
      ...base,
      id: SPOOFED_ID,
      ownerId: VICTIM_OWNER,
      workspaceId: VICTIM_WS,
      collaborators: [{ userId: VICTIM_OWNER, role: 'admin' }],
      isPublic: true,
      revision: 999,
      templateId: null,
    };

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: authHeaders(),
      // templateId provenance supplied on the body (not derivable from auth).
      payload: { document, templateId: PROVENANCE },
    });
    expect(res.statusCode).toBe(201);

    const persisted = res.json() as Project;
    created.push(persisted.id);

    // The server REJECTED the spoofed id and minted its own.
    expect(persisted.id).not.toBe(SPOOFED_ID);
    // Ownership is forced to the authenticated user — a client can't plant
    // another user's id.
    expect(persisted.ownerId).toBe(selfUserId);
    expect(persisted.workspaceId).toBe(selfUserId);
    expect(persisted.collaborators).toEqual([{ userId: selfUserId, role: 'admin' }]);
    // Server-owned scalar fields are reset.
    expect(persisted.isPublic).toBe(false);
    expect(persisted.revision).toBe(1);
    // Provenance round-trips.
    expect(persisted.templateId).toBe(PROVENANCE);

    // The spoofed-id document is NOT fetchable (the server never used it).
    const ghost = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${SPOOFED_ID}`,
      headers: authHeaders(),
    });
    expect(ghost.statusCode).toBe(404);

    // The real (server-minted) row IS owned by us and fetchable.
    const real = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${persisted.id}`,
      headers: authHeaders(),
    });
    expect(real.statusCode).toBe(200);
    expect((real.json() as { document: Project }).document.ownerId).toBe(selfUserId);
  });

  // (+) autosave (PATCH envelope) on a template-created project is unregressed.
  it('(+) a template-created project autosaves via the { document, baseRevision } envelope', async () => {
    if (skip || !app) return;

    const base = await freshValidDocument();
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: authHeaders(),
      payload: { document: { ...base, title: 'Template + Autosave' } },
    });
    expect(createRes.statusCode).toBe(201);
    const project = createRes.json() as Project & { revision: number };
    created.push(project.id);
    expect(project.revision).toBe(1);

    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/projects/${project.id}`,
      headers: authHeaders(),
      payload: { document: project, baseRevision: project.revision },
    });
    expect(patchRes.statusCode).not.toBe(422);
    expect(patchRes.statusCode).toBe(200);
    expect((patchRes.json() as { revision: number }).revision).toBe(project.revision + 1);
  });
});
