// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/assets/:id exposes hasOriginal: boolean — derived from whether the
// asset still has a (non-proxy) original S3 key. Pixel consumes this for the
// pre-export proxy-warning badge (a missing original ⇒ export renders from the
// lower-quality proxy).
//
// Asserts both branches:
//   • presigned asset (s3_key_original set)         → hasOriginal === true
//   • asset row with s3_key_original = null         → hasOriginal === false
//
// The false branch is seeded directly via Drizzle because the presign flow
// always sets an original key (the "no original" state only arises later, after
// proxy-only retention deletes the original).
//
// Needs Postgres (buildServer + db). Self-skips when unreachable.
// ─────────────────────────────────────────────────────────────────────────────

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';

let app: FastifyInstance | null = null;
let skip = false;
let accessToken = '';
let userId = '';
const seededAssetIds: string[] = [];

const email = `asset-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
const password = 'asset-test-pass-123';

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
    const body = signup.json() as { accessToken: string; user: { id: string } };
    accessToken = body.accessToken;
    userId = body.user.id;
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
      `[assets-hasoriginal.contract] skipping — backend services unavailable: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
});

afterAll(async () => {
  if (app && seededAssetIds.length > 0) {
    try {
      const { db } = await import('../../db/client.js');
      const { assets } = await import('../../db/schema.js');
      const { inArray } = await import('drizzle-orm');
      await db.delete(assets).where(inArray(assets.id, seededAssetIds));
    } catch {
      /* ignore cleanup failure */
    }
  }
  if (app) await app.close();
});

describe('GET /api/v1/assets/:id hasOriginal', () => {
  it('reports hasOriginal: true for a presigned asset (original key present)', async () => {
    if (skip || !app) return;

    const presign = await app.inject({
      method: 'POST',
      url: '/api/v1/assets/presign',
      headers: authHeaders(),
      payload: {
        filename: 'clip.mp4',
        contentType: 'video/mp4',
        fileSize: 1024,
      },
    });
    expect(presign.statusCode).toBe(201);
    const assetId = (presign.json() as { assetId: string }).assetId;
    seededAssetIds.push(assetId);

    const get = await app.inject({
      method: 'GET',
      url: `/api/v1/assets/${assetId}`,
      headers: authHeaders(),
    });
    expect(get.statusCode).toBe(200);
    const asset = get.json() as { id: string; hasOriginal: unknown };
    expect(asset).toHaveProperty('hasOriginal');
    expect(asset.hasOriginal).toBe(true);
  });

  it('reports hasOriginal: false when the asset has no original key', async () => {
    if (skip || !app) return;

    // Seed a proxy-only asset directly (no original key) — the post-retention
    // state the presign flow never produces.
    const { db } = await import('../../db/client.js');
    const { assets } = await import('../../db/schema.js');
    const assetId = randomUUID();
    seededAssetIds.push(assetId);
    await db.insert(assets).values({
      id: assetId,
      workspaceId: userId,
      filename: 'proxy-only.mp4',
      contentType: 'video/mp4',
      fileSize: 2048,
      status: 'READY',
      s3KeyOriginal: null,
      s3KeyProxy: `${assetId}/proxy.mp4`,
    });

    const get = await app.inject({
      method: 'GET',
      url: `/api/v1/assets/${assetId}`,
      headers: authHeaders(),
    });
    expect(get.statusCode).toBe(200);
    const asset = get.json() as { hasOriginal: unknown };
    expect(asset).toHaveProperty('hasOriginal');
    expect(asset.hasOriginal).toBe(false);
  });
});
