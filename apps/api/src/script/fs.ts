// Tiny fs helper — best-effort temp-file cleanup (never throws).
import { unlink } from 'node:fs/promises';

export async function cleanupFile(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch {
    // temp-file cleanup failures are non-fatal
  }
}
