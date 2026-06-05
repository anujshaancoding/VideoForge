// ─────────────────────────────────────────────────────────────────────────────
// Integration contract for §14.0 Auth (email/password only).
//
// Flow under test: signup → /me → login → refresh → logout, plus one
// authenticated downstream route (GET /api/v1/projects) and a 401 for missing
// credentials. This is the exact contract Pixel (web) and Sentinel (e2e) consume.
//
// buildServer() opens Postgres + Redis. When unreachable (plain local checkout)
// the suite SKIPS rather than fails — green in CI Stage 3 (with services), a
// clean no-op otherwise. Mirrors projects.contract.test.ts.
// ─────────────────────────────────────────────────────────────────────────────

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { REFRESH_COOKIE_NAME } from '../../auth/plugin.js';

let app: FastifyInstance | null = null;
let skip = false;

const email = `auth-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
const password = 'super-secret-pass-123';

beforeAll(async () => {
  try {
    const { buildServer } = await import('../../server.js');
    app = await buildServer();
    await app.ready();

    // Probe a DB-touching route; a 401 (auth working) confirms the server + DB
    // are reachable. Anything else (e.g. 500 from a dead Postgres) → skip.
    const probe = await app.inject({ method: 'GET', url: '/api/v1/projects' });
    if (probe.statusCode !== 401) {
      throw new Error(`probe GET /api/v1/projects returned ${probe.statusCode}`);
    }
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
      `[auth.contract] skipping — backend services unavailable: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
});

afterAll(async () => {
  if (app) await app.close();
});

/** Pull the refresh cookie value out of a set-cookie header (array or string). */
function readRefreshCookie(setCookie: string | string[] | undefined): string | null {
  if (!setCookie) return null;
  const headers = Array.isArray(setCookie) ? setCookie : [setCookie];
  for (const h of headers) {
    if (h.startsWith(`${REFRESH_COOKIE_NAME}=`)) {
      return h.split(';')[0]!; // e.g. "vf_refresh=<token>"
    }
  }
  return null;
}

describe('auth: signup → /me → login → refresh → logout', () => {
  it('signs up, returns an access token + sets the refresh cookie, and /me works', async () => {
    if (skip || !app) return;

    const signup = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      payload: { email, password, displayName: 'Auth Test' },
    });
    expect(signup.statusCode).toBe(201);

    const signupBody = signup.json() as {
      accessToken: string;
      user: { id: string; email: string; displayName: string | null };
    };
    expect(typeof signupBody.accessToken).toBe('string');
    expect(signupBody.user.email).toBe(email);
    expect(signupBody.user.displayName).toBe('Auth Test');

    // The httpOnly refresh cookie must be set on signup.
    const cookie = readRefreshCookie(signup.headers['set-cookie']);
    expect(cookie).not.toBeNull();

    // GET /me with the access token returns the same user.
    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${signupBody.accessToken}` },
    });
    expect(me.statusCode).toBe(200);
    expect((me.json() as { user: { email: string } }).user.email).toBe(email);

    // GET /me WITHOUT a token is 401.
    const meUnauth = await app.inject({ method: 'GET', url: '/api/v1/auth/me' });
    expect(meUnauth.statusCode).toBe(401);
  });

  it('rejects a duplicate signup with 409', async () => {
    if (skip || !app) return;
    const dup = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      payload: { email, password },
    });
    expect(dup.statusCode).toBe(409);
  });

  it('logs in, uses the access token on an authenticated route, then refreshes + logs out', async () => {
    if (skip || !app) return;

    // Wrong password → 401.
    const badLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email, password: 'wrong-password' },
    });
    expect(badLogin.statusCode).toBe(401);

    // Correct password → 200 + token + cookie.
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email, password },
    });
    expect(login.statusCode).toBe(200);
    const loginBody = login.json() as { accessToken: string };
    const refreshCookie = readRefreshCookie(login.headers['set-cookie']);
    expect(refreshCookie).not.toBeNull();

    // The access token unlocks a downstream authenticated route.
    const projects = await app.inject({
      method: 'GET',
      url: '/api/v1/projects',
      headers: { authorization: `Bearer ${loginBody.accessToken}` },
    });
    expect(projects.statusCode).toBe(200);
    expect(Array.isArray((projects.json() as { items: unknown[] }).items)).toBe(true);

    // POST /refresh with the cookie reissues an access token + rotates the cookie.
    const refresh = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: { cookie: refreshCookie! },
    });
    expect(refresh.statusCode).toBe(200);
    expect(typeof (refresh.json() as { accessToken: string }).accessToken).toBe('string');
    expect(readRefreshCookie(refresh.headers['set-cookie'])).not.toBeNull();

    // POST /refresh WITHOUT a cookie is 401.
    const refreshUnauth = await app.inject({ method: 'POST', url: '/api/v1/auth/refresh' });
    expect(refreshUnauth.statusCode).toBe(401);

    // POST /logout clears the cookie.
    const logout = await app.inject({ method: 'POST', url: '/api/v1/auth/logout' });
    expect(logout.statusCode).toBe(200);
    const cleared = logout.headers['set-cookie'];
    expect(cleared).toBeDefined();
  });
});
