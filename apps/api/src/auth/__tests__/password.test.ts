// ─────────────────────────────────────────────────────────────────────────────
// Unit tests for the node:crypto scrypt password helpers. These are PURE — no
// Postgres/Redis — so they always run (the strongest signal the hashing path is
// correct regardless of CI service availability).
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../password.js';

describe('scrypt password hashing', () => {
  it('produces a self-describing scrypt$ hash and verifies the same password', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(hash.startsWith('scrypt$')).toBe(true);
    // Format: scrypt$N$r$p$saltHex$keyHex
    expect(hash.split('$')).toHaveLength(6);

    await expect(verifyPassword('correct horse battery staple', hash)).resolves.toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('s3cret-password');
    await expect(verifyPassword('wrong-password', hash)).resolves.toBe(false);
  });

  it('uses a unique salt so two hashes of the same password differ', async () => {
    const a = await hashPassword('same-password-123');
    const b = await hashPassword('same-password-123');
    expect(a).not.toBe(b);
    // Both still verify.
    await expect(verifyPassword('same-password-123', a)).resolves.toBe(true);
    await expect(verifyPassword('same-password-123', b)).resolves.toBe(true);
  });

  it('returns false for null/malformed/legacy hashes instead of throwing', async () => {
    await expect(verifyPassword('x', null)).resolves.toBe(false);
    await expect(verifyPassword('x', undefined)).resolves.toBe(false);
    await expect(verifyPassword('x', 'not-a-scrypt-hash')).resolves.toBe(false);
    await expect(verifyPassword('x', 'scrypt$bad$params')).resolves.toBe(false);
  });
});
