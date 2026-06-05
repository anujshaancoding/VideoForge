// ─────────────────────────────────────────────────────────────────────────────
// Unit tests for resolveJwtSecret — the production fail-fast guard for JWT
// secrets. PURE (no Postgres/Redis), so it always runs.
//
// Footgun being guarded: when JWT_ACCESS_SECRET / JWT_REFRESH_SECRET are unset,
// the app used to silently sign tokens with a public dev constant ('dev_secret'
// / 'dev_refresh_secret') — account takeover if shipped to prod. Now, in
// NODE_ENV=production an unset/empty secret THROWS; in non-production the dev
// fallback is kept so local/test boots stay zero-config.
// ─────────────────────────────────────────────────────────────────────────────

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveJwtSecret } from '../plugin.js';

const SECRET_VARS = ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'] as const;

let savedNodeEnv: string | undefined;
let savedSecrets: Record<string, string | undefined>;

beforeEach(() => {
  savedNodeEnv = process.env['NODE_ENV'];
  savedSecrets = {};
  for (const v of SECRET_VARS) savedSecrets[v] = process.env[v];
});

afterEach(() => {
  // Restore the env so we never leak NODE_ENV=production into other suites.
  if (savedNodeEnv === undefined) delete process.env['NODE_ENV'];
  else process.env['NODE_ENV'] = savedNodeEnv;
  for (const v of SECRET_VARS) {
    const prev = savedSecrets[v];
    if (prev === undefined) delete process.env[v];
    else process.env[v] = prev;
  }
});

describe('resolveJwtSecret production fail-fast', () => {
  it('THROWS in production when the secret is missing', () => {
    process.env['NODE_ENV'] = 'production';
    delete process.env['JWT_ACCESS_SECRET'];
    expect(() => resolveJwtSecret('JWT_ACCESS_SECRET', 'dev_secret')).toThrow(
      /JWT_ACCESS_SECRET must be set in production/,
    );
  });

  it('THROWS in production when the secret is empty', () => {
    process.env['NODE_ENV'] = 'production';
    process.env['JWT_REFRESH_SECRET'] = '';
    expect(() =>
      resolveJwtSecret('JWT_REFRESH_SECRET', 'dev_refresh_secret'),
    ).toThrow(/JWT_REFRESH_SECRET must be set in production/);
  });

  it('returns the real secret in production when it IS set (no throw)', () => {
    process.env['NODE_ENV'] = 'production';
    process.env['JWT_ACCESS_SECRET'] = 'a-real-prod-secret';
    expect(resolveJwtSecret('JWT_ACCESS_SECRET', 'dev_secret')).toBe(
      'a-real-prod-secret',
    );
  });

  it('falls back to the dev default OUTSIDE production when missing (still boots)', () => {
    process.env['NODE_ENV'] = 'development';
    delete process.env['JWT_ACCESS_SECRET'];
    expect(resolveJwtSecret('JWT_ACCESS_SECRET', 'dev_secret')).toBe('dev_secret');

    // 'test' is also non-production → fallback kept.
    process.env['NODE_ENV'] = 'test';
    delete process.env['JWT_REFRESH_SECRET'];
    expect(
      resolveJwtSecret('JWT_REFRESH_SECRET', 'dev_refresh_secret'),
    ).toBe('dev_refresh_secret');
  });
});
