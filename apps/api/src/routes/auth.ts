// ─────────────────────────────────────────────────────────────────────────────
// §14.0 Auth — email/password only (CEO decision this round; NO Google OAuth,
// NO password reset).
//
//   POST /api/v1/auth/signup   → create user; returns { accessToken, user } + sets refresh cookie
//   POST /api/v1/auth/login    → verify credentials; same return shape
//   POST /api/v1/auth/refresh  → rotate refresh cookie + reissue access token
//   POST /api/v1/auth/logout   → clear refresh cookie
//   GET  /api/v1/auth/me       → current user (requires Bearer access token)
//
// Password hashing: Node's built-in node:crypto scrypt (see auth/password.ts) —
// no bcrypt/argon2, so the lockfile is untouched.
//
// "User-is-the-workspace" MVP model: the authenticated userId IS the workspace
// id. Other route groups store it in the `workspace_id` column.
// ─────────────────────────────────────────────────────────────────────────────

import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { users } from '../db/schema.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import {
  REFRESH_COOKIE_NAME,
  issueAccessToken,
  issueRefreshToken,
  verifyRefreshToken,
  setRefreshCookie,
  clearRefreshCookie,
  newUserId,
  normalizeEmail,
  isValidEmail,
} from '../auth/plugin.js';

interface CredentialsBody {
  email?: unknown;
  password?: unknown;
  displayName?: unknown;
}

/** Minimum password length — kept simple for MVP. */
const MIN_PASSWORD_LEN = 8;

/** Public-safe user projection (never leak password_hash). */
function publicUser(row: {
  id: string;
  email: string;
  displayName: string | null;
}): { id: string; email: string; displayName: string | null } {
  return { id: row.id, email: row.email, displayName: row.displayName };
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // ── POST /signup ───────────────────────────────────────────────────────────
  app.post<{ Body: CredentialsBody }>('/signup', async (request, reply) => {
    const body = request.body ?? {};
    const email = typeof body.email === 'string' ? normalizeEmail(body.email) : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const displayName =
      typeof body.displayName === 'string' && body.displayName.trim()
        ? body.displayName.trim()
        : null;

    if (!isValidEmail(email)) {
      return reply
        .code(400)
        .send({ error: 'ValidationError', message: 'a valid email is required' });
    }
    if (password.length < MIN_PASSWORD_LEN) {
      return reply.code(400).send({
        error: 'ValidationError',
        message: `password must be at least ${MIN_PASSWORD_LEN} characters`,
      });
    }

    // Unique-email guard (the column is UNIQUE; this gives a clean 409 instead of
    // a raw DB constraint error and avoids leaking which emails exist via timing).
    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email));
    if (existing) {
      return reply
        .code(409)
        .send({ error: 'EmailTaken', message: 'an account with this email already exists' });
    }

    const id = newUserId();
    const passwordHash = await hashPassword(password);

    try {
      await db.insert(users).values({ id, email, displayName, passwordHash });
    } catch {
      // Lost the race on the UNIQUE(email) constraint → same 409.
      return reply
        .code(409)
        .send({ error: 'EmailTaken', message: 'an account with this email already exists' });
    }

    const accessToken = await issueAccessToken(app, id, email);
    setRefreshCookie(reply, issueRefreshToken(id, email));

    return reply.code(201).send({
      accessToken,
      user: publicUser({ id, email, displayName }),
    });
  });

  // ── POST /login ────────────────────────────────────────────────────────────
  app.post<{ Body: CredentialsBody }>('/login', async (request, reply) => {
    const body = request.body ?? {};
    const email = typeof body.email === 'string' ? normalizeEmail(body.email) : '';
    const password = typeof body.password === 'string' ? body.password : '';

    if (!email || !password) {
      return reply
        .code(400)
        .send({ error: 'ValidationError', message: 'email and password are required' });
    }

    const [row] = await db
      .select()
      .from(users)
      .where(eq(users.email, email));

    // Always run a verify (even with no row) to keep timing roughly uniform and
    // return the SAME 401 whether the email or the password is wrong.
    const ok = await verifyPassword(password, row?.passwordHash ?? null);
    if (!row || !ok) {
      return reply
        .code(401)
        .send({ error: 'InvalidCredentials', message: 'invalid email or password' });
    }

    const accessToken = await issueAccessToken(app, row.id, row.email);
    setRefreshCookie(reply, issueRefreshToken(row.id, row.email));

    return reply.code(200).send({
      accessToken,
      user: publicUser(row),
    });
  });

  // ── POST /refresh ──────────────────────────────────────────────────────────
  // Rotates the refresh cookie and reissues a fresh access token.
  app.post('/refresh', async (request, reply) => {
    const cookies = request.cookies as Record<string, string | undefined>;
    const payload = verifyRefreshToken(cookies[REFRESH_COOKIE_NAME]);
    if (!payload) {
      clearRefreshCookie(reply);
      return reply
        .code(401)
        .send({ error: 'Unauthorized', message: 'missing or invalid refresh token' });
    }

    // Confirm the user still exists (e.g. deleted account) before reissuing.
    const [row] = await db
      .select({ id: users.id, email: users.email, displayName: users.displayName })
      .from(users)
      .where(eq(users.id, payload.sub));
    if (!row) {
      clearRefreshCookie(reply);
      return reply
        .code(401)
        .send({ error: 'Unauthorized', message: 'account no longer exists' });
    }

    const accessToken = await issueAccessToken(app, row.id, row.email);
    // Rotation: mint a brand-new refresh token (new jti) and replace the cookie.
    setRefreshCookie(reply, issueRefreshToken(row.id, row.email));

    return reply.code(200).send({
      accessToken,
      user: publicUser(row),
    });
  });

  // ── POST /logout ───────────────────────────────────────────────────────────
  app.post('/logout', async (_request, reply) => {
    clearRefreshCookie(reply);
    return reply.code(200).send({ ok: true });
  });

  // ── GET /me ────────────────────────────────────────────────────────────────
  // Requires a valid access token; returns the current user.
  app.get('/me', { preHandler: app.authenticate }, async (request, reply) => {
    const [row] = await db
      .select({ id: users.id, email: users.email, displayName: users.displayName })
      .from(users)
      .where(eq(users.id, request.user.userId));

    if (!row) {
      return reply
        .code(404)
        .send({ error: 'NotFound', message: 'user not found' });
    }
    return reply.code(200).send({ user: publicUser(row) });
  });
}
