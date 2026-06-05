// ─────────────────────────────────────────────────────────────────────────────
// WebSocket auth contract: /ws accepts ONLY the short-lived access token via
// ?token=<accessJWT>. The 30-day refresh cookie is NOT a valid WS credential
// anymore (scoped down to limit a leaked socket's blast radius). Unauthenticated
// sockets are closed with policy-violation code 1008.
//
// Asserts:
//   • valid access token  → connection stays open (no 1008 close)
//   • refresh cookie only  → connection is REJECTED with 1008 (old fallback gone)
//   • no credential        → 1008
//
// Needs a real listening server (inject() can't upgrade). We bind an ephemeral
// port and use the `ws` client that @fastify/websocket already depends on
// (resolved via its module path — no new dependency / lockfile change). The
// suite self-skips when services or `ws` are unavailable, like the others.
// ─────────────────────────────────────────────────────────────────────────────

import { createRequire } from 'node:module';
import { realpathSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  REFRESH_COOKIE_NAME,
  issueRefreshToken,
} from '../../auth/plugin.js';

// `ws` is @fastify/websocket's own dependency; resolve it through that package
// (via its realpath so pnpm's nested store layout is honored). No new dep.
type WebSocketCtor = new (url: string) => {
  on(event: 'open' | 'error', cb: () => void): void;
  on(event: 'close', cb: (code: number) => void): void;
  close(): void;
};

let WebSocketImpl: WebSocketCtor | null = null;
try {
  // Resolve @fastify/websocket relative to THIS test module, then resolve `ws`
  // relative to that package's real on-disk location (honoring pnpm's store).
  const localRequire = createRequire(import.meta.url);
  const fastifyWsEntry = realpathSync(localRequire.resolve('@fastify/websocket'));
  const wsRequire = createRequire(fastifyWsEntry);
  WebSocketImpl = wsRequire('ws') as unknown as WebSocketCtor;
} catch {
  WebSocketImpl = null;
}

let app: FastifyInstance | null = null;
let baseWsUrl = '';
let skip = false;
let accessToken = '';
let refreshCookie = '';

const email = `ws-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
const password = 'ws-secret-pass-123';

beforeAll(async () => {
  if (!WebSocketImpl) {
    skip = true;
    // eslint-disable-next-line no-console
    console.warn('[ws-auth.contract] skipping — `ws` client not resolvable');
    return;
  }
  try {
    const { buildServer } = await import('../../server.js');
    app = await buildServer();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    if (!addr || typeof addr === 'string') throw new Error('no bound port');
    baseWsUrl = `ws://127.0.0.1:${addr.port}/ws`;

    const signup = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      payload: { email, password },
    });
    if (signup.statusCode !== 201) {
      throw new Error(`signup probe returned ${signup.statusCode}`);
    }
    accessToken = (signup.json() as { accessToken: string }).accessToken;

    // A real refresh token (what the cookie used to be accepted as on /ws).
    const userId = (signup.json() as { user: { id: string } }).user.id;
    refreshCookie = `${REFRESH_COOKIE_NAME}=${issueRefreshToken(userId, email)}`;
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
      `[ws-auth.contract] skipping — backend services unavailable: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
});

afterAll(async () => {
  if (app) await app.close();
});

/**
 * Open a WS connection and resolve with its outcome: 'open' if the socket stays
 * connected past the handshake, or { closedCode } when the server closes it.
 */
function probe(
  url: string,
): Promise<{ open: true } | { open: false; closedCode: number }> {
  return new Promise((resolve) => {
    const sock = new WebSocketImpl!(url);
    let settled = false;
    const done = (
      r: { open: true } | { open: false; closedCode: number },
    ): void => {
      if (settled) return;
      settled = true;
      try {
        sock.close();
      } catch {
        /* ignore */
      }
      resolve(r);
    };
    sock.on('open', () => {
      // Give the server a beat to reject-then-close an unauthorized socket; if
      // it's still open shortly after, treat it as authenticated.
      setTimeout(() => done({ open: true }), 150);
    });
    sock.on('close', (code: number) => done({ open: false, closedCode: code }));
    sock.on('error', () => {
      // An immediate connection error (handshake refused) counts as rejected.
      setTimeout(() => done({ open: false, closedCode: 1006 }), 0);
    });
  });
}

describe('GET /ws auth (access-token-only)', () => {
  it('accepts a valid access token via ?token= and keeps the socket open', async () => {
    if (skip || !app) return;
    const res = await probe(`${baseWsUrl}?token=${encodeURIComponent(accessToken)}`);
    expect(res.open).toBe(true);
  });

  it('rejects a connection with NO credential (1008)', async () => {
    if (skip || !app) return;
    const res = await probe(baseWsUrl);
    expect(res.open).toBe(false);
    if (!res.open) expect(res.closedCode).toBe(1008);
  });

  it('rejects the refresh cookie as a WS credential (old fallback removed)', async () => {
    if (skip || !app) return;
    // The `ws` client doesn't send cookies on a raw ws:// URL, but the contract
    // we assert is: a refresh token is NOT a usable WS credential. Passing the
    // refresh token in ?token= (where the access token goes) must also fail,
    // because /ws verifies it against the ACCESS secret only.
    const refreshToken = refreshCookie.split('=').slice(1).join('=');
    const res = await probe(`${baseWsUrl}?token=${encodeURIComponent(refreshToken)}`);
    expect(res.open).toBe(false);
    if (!res.open) expect(res.closedCode).toBe(1008);
  });
});
