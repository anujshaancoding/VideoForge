// ─────────────────────────────────────────────────────────────────────────────
// Drizzle migration runner — reads SQL files from ./drizzle/ and applies them.
// Called on server startup before accepting traffic.
// ─────────────────────────────────────────────────────────────────────────────

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { db } from './client.js';

// Resolve ./drizzle relative to this module (apps/api/{src,dist}/db/migrate.*),
// so migrations work regardless of the process cwd.
const here = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(here, '../../drizzle');

export async function runMigrations(): Promise<void> {
  await migrate(db, { migrationsFolder });
}

// Allow running directly: `tsx src/db/migrate.ts` (used by the db:migrate script).
if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations()
    .then(() => {
      console.info('[migrate] migrations applied');
      process.exit(0);
    })
    .catch((err: unknown) => {
      console.error('[migrate] failed:', err);
      process.exit(1);
    });
}
