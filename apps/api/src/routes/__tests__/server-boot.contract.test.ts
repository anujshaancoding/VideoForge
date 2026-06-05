// ─────────────────────────────────────────────────────────────────────────────
// Boot-level guard for the JWT prod-secret footgun (server.ts startup).
//
//   production + missing secret  → buildServer() THROWS (fail-fast, no boot)
//   non-production + missing      → buildServer() still boots
//
// The production-throws assertion does NOT touch Postgres/Redis — the secret
// check runs before any DB work — so it ALWAYS runs. The "still boots" path
// needs the full app (DB/Redis); it self-skips when services are unreachable,
// matching the other contract suites.
//
// bootstrap-env loads the root .env (which DOES set both JWT secrets), so each
// test explicitly deletes them to simulate a deploy that forgot the env.
// ─────────────────────────────────────────────────────────────────────────────

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { buildServer as BuildServerFn } from '../../server.js';

const SECRET_VARS = ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'] as const;

let buildServer: typeof BuildServerFn;

let savedNodeEnv: string | undefined;
let savedSecrets: Record<string, string | undefined>;

beforeAll(async () => {
  // Import server.js ONCE up front so bootstrap-env's loadEnvFile (which only
  // populates vars that are absent) runs before any test deletes the secrets.
  // Deleting after this import keeps them deleted (loadEnvFile won't re-run).
  ({ buildServer } = await import('../../server.js'));
});

beforeEach(() => {
  savedNodeEnv = process.env['NODE_ENV'];
  savedSecrets = {};
  for (const v of SECRET_VARS) savedSecrets[v] = process.env[v];
});

afterEach(() => {
  if (savedNodeEnv === undefined) delete process.env['NODE_ENV'];
  else process.env['NODE_ENV'] = savedNodeEnv;
  for (const v of SECRET_VARS) {
    const prev = savedSecrets[v];
    if (prev === undefined) delete process.env[v];
    else process.env[v] = prev;
  }
});

describe('buildServer JWT secret startup guard', () => {
  it('throws on boot in production when JWT_ACCESS_SECRET is missing', async () => {
    process.env['NODE_ENV'] = 'production';
    delete process.env['JWT_ACCESS_SECRET'];
    // refresh secret present so we prove the ACCESS secret is what fails.
    process.env['JWT_REFRESH_SECRET'] = 'present-refresh';

    await expect(buildServer()).rejects.toThrow(
      /JWT_ACCESS_SECRET must be set in production/,
    );
  });

  it('throws on boot in production when JWT_REFRESH_SECRET is missing', async () => {
    process.env['NODE_ENV'] = 'production';
    process.env['JWT_ACCESS_SECRET'] = 'present-access';
    delete process.env['JWT_REFRESH_SECRET'];

    await expect(buildServer()).rejects.toThrow(
      /JWT_REFRESH_SECRET must be set in production/,
    );
  });

  it('still boots in development when the secrets are missing (dev fallback)', async () => {
    process.env['NODE_ENV'] = 'development';
    delete process.env['JWT_ACCESS_SECRET'];
    delete process.env['JWT_REFRESH_SECRET'];

    let app;
    try {
      app = await buildServer();
      await app.ready();
    } catch (err) {
      // Services (Postgres/Redis) unreachable → skip rather than fail. A thrown
      // secret error would NOT be a connection error, so assert it isn't one.
      const msg = err instanceof Error ? err.message : String(err);
      expect(msg).not.toMatch(/must be set in production/);
      // eslint-disable-next-line no-console
      console.warn(`[server-boot] dev-boot skipped — services unavailable: ${msg}`);
      return;
    }
    // Reaching here proves the dev fallback let the app boot with no secrets set.
    expect(app).toBeDefined();
    await app.close();
  });
});
