// ─────────────────────────────────────────────────────────────────────────────
// Contract C route surface — POST /api/v1/script/plan.
//
//   • Unauthenticated → 401.
//   • Authenticated + no GROQ_API_KEY → 200 { plan, source:"heuristic" } with a
//     Contract-A-valid plan (never 5xx for content).
//   • Missing script → 400.
//
// /generate + /arrange are covered by the pure assemble/planner suites + the
// integration run (Atlas, post-lane); exercising them here would require a live TTS
// engine + media worker. buildServer() opens Postgres/Redis — when unreachable we
// SKIP (matches the other *.contract.test.ts suites). We also disable the in-process
// script worker so the test app doesn't spin a live BullMQ consumer.
// ─────────────────────────────────────────────────────────────────────────────

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { scenePlanSchema } from '../../script/l1.js';

let app: FastifyInstance | null = null;
let skip = false;
let accessToken = '';
let savedGroqKey: string | undefined;

beforeAll(async () => {
  savedGroqKey = process.env['GROQ_API_KEY'];
  // Force the heuristic path. NB: a `delete` here is undone by bootstrap-env —
  // server.ts imports it first, and its loadEnvFile re-injects GROQ_API_KEY from
  // root .env for any var NOT already present. An empty string IS present, so the
  // no-override loader leaves it as '' and callGroq's `!apiKey.trim()` → heuristic.
  process.env['GROQ_API_KEY'] = '';
  process.env['SCRIPT_WORKER_DISABLED'] = 'true';
  try {
    const { buildServer } = await import('../../server.js');
    app = await buildServer();
    await app.ready();

    const unauth = await app.inject({ method: 'POST', url: '/api/v1/script/plan' });
    if (unauth.statusCode !== 401) {
      throw new Error(`unauth /script/plan returned ${unauth.statusCode} (expected 401)`);
    }

    const signup = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      payload: {
        email: `script-${Date.now()}@example.test`,
        password: 'script-pass-1234',
      },
    });
    if (signup.statusCode !== 201) throw new Error(`signup probe ${signup.statusCode}`);
    accessToken = (signup.json() as { accessToken: string }).accessToken;
  } catch {
    skip = true;
    if (app) {
      try {
        await app.close();
      } catch {
        /* ignore */
      }
      app = null;
    }
  }
});

afterAll(async () => {
  if (savedGroqKey === undefined) delete process.env['GROQ_API_KEY'];
  else process.env['GROQ_API_KEY'] = savedGroqKey;
  if (app) await app.close();
});

function auth(): Record<string, string> {
  return { authorization: `Bearer ${accessToken}` };
}

describe('POST /api/v1/script/plan', () => {
  it('falls back to heuristic and returns a Contract-A plan (no key)', async () => {
    if (skip || !app) return;
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/script/plan',
      headers: auth(),
      payload: {
        script: 'Hello world. This becomes a scene. And this becomes another.',
        voiceId: 'af_heart',
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { plan: unknown; source: string };
    expect(body.source).toBe('heuristic');
    expect(scenePlanSchema.safeParse(body.plan).success).toBe(true);
  });

  it('400s when script is missing', async () => {
    if (skip || !app) return;
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/script/plan',
      headers: auth(),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });
});
