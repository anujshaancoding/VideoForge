// ─────────────────────────────────────────────────────────────────────────────
// Auth plugin — JWT type augmentation, token helpers, and the `authenticate`
// preHandler decorator shared by every protected route group.
//
// Tokens:
//   • access  — short-lived JWT signed with JWT_ACCESS_SECRET (via @fastify/jwt,
//               already registered in server.ts). Sent in `Authorization: Bearer`.
//   • refresh — longer-lived JWT signed with JWT_REFRESH_SECRET, delivered as an
//               httpOnly + sameSite + secure(in prod) cookie. Verified manually
//               (see verifyRefreshToken) because the @fastify/jwt instance is
//               bound to the ACCESS secret.
//
// "User-is-the-workspace" MVP model: there is no separate workspace entity. The
// authenticated `userId` IS the workspace id. Routes keep the DB column name
// `workspace_id` but store/query the userId in it.
// ─────────────────────────────────────────────────────────────────────────────

import { createHmac, createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

/** Name of the httpOnly refresh-token cookie. Web + e2e clients reference this. */
export const REFRESH_COOKIE_NAME = 'vf_refresh';

/** Access token lifetime (seconds) — short so a leaked token expires fast. */
export const ACCESS_TTL_SECONDS = 15 * 60; // 15 minutes
/** Refresh token lifetime (seconds) — the rolling session window. */
export const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

/** Shape of our JWT claims. `sub` carries the userId (== workspaceId in MVP). */
export interface AccessClaims {
  sub: string;
  email: string;
}

// @fastify/jwt declaration merge: type request.user and the signed payload.
declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: AccessClaims;
    user: { userId: string; email: string };
  }
}

/** True in production so cookies require HTTPS; relaxed in dev/test for localhost + inject(). */
function isProd(): boolean {
  return process.env['NODE_ENV'] === 'production';
}

/**
 * Resolve a required JWT secret from the environment.
 *
 * Production safety (account-takeover footgun): in `NODE_ENV === 'production'`
 * an unset/empty secret THROWS — a prod deploy that forgot the env must fail
 * loudly at startup rather than silently sign tokens with a public dev constant.
 * Outside production we keep the dev fallback so local/test boots are zero-config.
 *
 * @param name       env var name (e.g. `JWT_ACCESS_SECRET`)
 * @param devDefault fallback used ONLY in non-production
 */
export function resolveJwtSecret(name: string, devDefault: string): string {
  const value = process.env[name];
  if (value && value.length > 0) return value;
  if (isProd()) {
    throw new Error(
      `${name} must be set in production (refusing to sign JWTs with a public dev default)`,
    );
  }
  return devDefault;
}

/** Resolve the refresh-token secret (throws in prod if unset; dev fallback otherwise). */
function refreshSecret(): string {
  return resolveJwtSecret('JWT_REFRESH_SECRET', 'dev_refresh_secret');
}

// ── Refresh token (self-signed HS256-style HMAC over a JSON payload) ──────────
//
// We sign refresh tokens manually rather than through @fastify/jwt (which is
// bound to the access secret). A compact `base64url(payload).base64url(sig)`
// keeps it dependency-free while still being a real signed, expiring token.

interface RefreshPayload {
  sub: string;
  email: string;
  /** Rotation id — changes on every issue so a rotated token is distinguishable. */
  jti: string;
  /** Issued-at (epoch seconds). */
  iat: number;
  /** Expiry (epoch seconds). */
  exp: number;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function sign(payloadJson: string): string {
  return createHmac('sha256', refreshSecret()).update(payloadJson).digest('base64url');
}

/** Mint a fresh, signed refresh token string for a user. */
export function issueRefreshToken(userId: string, email: string): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: RefreshPayload = {
    sub: userId,
    email,
    jti: randomUUID(),
    iat: now,
    exp: now + REFRESH_TTL_SECONDS,
  };
  const payloadJson = JSON.stringify(payload);
  return `${b64url(payloadJson)}.${sign(payloadJson)}`;
}

/**
 * Verify + decode a refresh token. Returns the payload on success, or null when
 * the token is malformed, has a bad signature, or is expired.
 */
export function verifyRefreshToken(token: string | undefined): RefreshPayload | null {
  if (!token) return null;
  const dot = token.indexOf('.');
  if (dot < 0) return null;
  const payloadB64 = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  let payloadJson: string;
  try {
    payloadJson = Buffer.from(payloadB64, 'base64url').toString('utf8');
  } catch {
    return null;
  }

  // Constant-time signature check.
  const expectedSig = sign(payloadJson);
  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let payload: RefreshPayload;
  try {
    payload = JSON.parse(payloadJson) as RefreshPayload;
  } catch {
    return null;
  }

  if (typeof payload.sub !== 'string' || typeof payload.exp !== 'number') return null;
  if (Math.floor(Date.now() / 1000) >= payload.exp) return null;
  return payload;
}

// ── Cookie helpers ───────────────────────────────────────────────────────────

/** Set the httpOnly refresh cookie on a reply. */
export function setRefreshCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProd(),
    sameSite: 'lax',
    path: '/',
    maxAge: REFRESH_TTL_SECONDS,
  });
}

/** Clear the refresh cookie (logout). */
export function clearRefreshCookie(reply: FastifyReply): void {
  reply.clearCookie(REFRESH_COOKIE_NAME, { path: '/' });
}

// ── Access token helper ──────────────────────────────────────────────────────

/** Sign a short-lived access JWT via the registered @fastify/jwt instance. */
export async function issueAccessToken(
  app: FastifyInstance,
  userId: string,
  email: string,
): Promise<string> {
  return app.jwt.sign({ sub: userId, email }, { expiresIn: ACCESS_TTL_SECONDS });
}

// ── Deterministic user id from email (stable, avoids a second lookup) ─────────

/** Derive a stable user id namespace-free from a UUID; exported for route use. */
export function newUserId(): string {
  return randomUUID();
}

/** Normalize an email for storage + uniqueness (trim + lowercase). */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Cheap email shape check — not RFC-perfect, just enough to reject junk. */
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// Re-export createHash so the auth route can build deterministic ids if needed.
export { createHash };

// ── The `authenticate` preHandler decorator ──────────────────────────────────

/**
 * Register `app.authenticate` — a preHandler that verifies the access JWT and
 * sets `request.user = { userId, email }`. Returns 401 on any failure. Applied
 * to every protected route group (projects / assets / exports).
 */
export function registerAuthDecorator(app: FastifyInstance): void {
  app.decorate(
    'authenticate',
    async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      try {
        const claims = await request.jwtVerify<AccessClaims>();
        request.user = { userId: claims.sub, email: claims.email };
      } catch {
        await reply
          .code(401)
          .send({ error: 'Unauthorized', message: 'missing or invalid access token' });
      }
    },
  );
}

// Augment FastifyInstance with the decorator signature.
declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}
