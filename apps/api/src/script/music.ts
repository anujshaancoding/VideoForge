// ─────────────────────────────────────────────────────────────────────────────
// Script Studio v2 — bundled FreePD-tier CC0 music beds (Contract C #5).
//
// A small, BUNDLED, CC0 music set under fixtures/music/ (no runtime fetch). When a
// generate request asks for music we deterministically pick one bed (seeded), copy
// it through the EXISTING originals-bucket/media asset pipeline so it becomes a
// normal media asset, and hand its assetId+durationMs to the assembler. The
// assembler loops/trims + ducks it via the existing volume envelope (no new filter).
//
// Provenance is logged (see fixtures/music/LICENSE.md). CC0 needs no attribution.
// ─────────────────────────────────────────────────────────────────────────────

import { readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

/** Resolve the bundled fixtures/music dir relative to this source file. */
function musicDir(): string {
  // apps/api/src/script → ../../../../fixtures/music
  return resolve(dirname(fileURLToPath(import.meta.url)), '../../../../fixtures/music');
}

export interface MusicBed {
  /** Absolute path to the bundled WAV. */
  path: string;
  /** Filename (display + provenance). */
  filename: string;
}

const AUDIO_EXT = /\.(wav|mp3)$/i;

/** List the bundled CC0 beds. Returns [] if the dir is missing/empty. */
export async function listMusicBeds(): Promise<MusicBed[]> {
  try {
    const dir = musicDir();
    const entries = await readdir(dir);
    return entries
      .filter((f) => AUDIO_EXT.test(f))
      .sort() // stable order → deterministic seeded pick
      .map((filename) => ({ filename, path: join(dir, filename) }));
  } catch {
    return [];
  }
}

/**
 * Deterministically pick one bed for a given seed (so the same generate request
 * always selects the same bed). Returns null when no beds are bundled.
 */
export async function pickMusicBed(seed: string): Promise<MusicBed | null> {
  const beds = await listMusicBeds();
  if (beds.length === 0) return null;
  const h = createHash('sha256').update(seed).digest();
  const idx = h.readUInt32BE(0) % beds.length;
  return beds[idx] ?? null;
}
