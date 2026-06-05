// ─────────────────────────────────────────────────────────────────────────────
// Password hashing — Node's built-in `node:crypto` scrypt (zero new deps).
//
// CEO decision (this round): email/password auth ONLY. We deliberately avoid
// bcrypt/argon2 so nothing touches package.json / pnpm-lock.yaml. scrypt is a
// memory-hard KDF shipped in Node core and is a sound choice for MVP.
//
// Stored format (single text column `users.password_hash`):
//   scrypt$N$r$p$<saltHex>$<derivedKeyHex>
// The cost params are embedded so future tuning stays backward-compatible.
// Verification is constant-time via crypto.timingSafeEqual.
// ─────────────────────────────────────────────────────────────────────────────

import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

/**
 * Promise wrapper around the callback-form scrypt that PRESERVES the options
 * argument. `promisify(scrypt)` picks the no-options overload, so we wrap it
 * by hand to keep the N/r/p cost params.
 */
function scryptAsync(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, options, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

/** scrypt cost parameters. N=2^15 keeps signup/login well under ~100ms. */
const SCRYPT_N = 32_768; // CPU/memory cost (must be a power of two)
const SCRYPT_R = 8; // block size
const SCRYPT_P = 1; // parallelization
const KEY_LEN = 64; // derived key length in bytes
const SALT_LEN = 16; // salt length in bytes

/**
 * Hash a plaintext password into a self-describing `scrypt$...` string suitable
 * for storage in `users.password_hash`.
 */
export async function hashPassword(plaintext: string): Promise<string> {
  const salt = randomBytes(SALT_LEN);
  const derived = await scryptAsync(plaintext, salt, KEY_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    // scrypt needs a larger maxmem ceiling once N climbs past defaults.
    maxmem: 64 * 1024 * 1024,
  });
  return [
    'scrypt',
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString('hex'),
    derived.toString('hex'),
  ].join('$');
}

/**
 * Verify a plaintext password against a stored `scrypt$...` hash using a
 * constant-time comparison. Returns false for any malformed/legacy/null hash
 * rather than throwing, so the login path can treat it as "wrong credentials".
 */
export async function verifyPassword(
  plaintext: string,
  stored: string | null | undefined,
): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const saltHex = parts[4]!;
  const expectedHex = parts[5]!;
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) {
    return false;
  }

  let expected: Buffer;
  let salt: Buffer;
  try {
    expected = Buffer.from(expectedHex, 'hex');
    salt = Buffer.from(saltHex, 'hex');
  } catch {
    return false;
  }

  let derived: Buffer;
  try {
    derived = await scryptAsync(plaintext, salt, expected.length, {
      N,
      r,
      p,
      maxmem: 64 * 1024 * 1024,
    });
  } catch {
    return false;
  }

  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}
