// ─────────────────────────────────────────────────────────────────────────────
// Drizzle migration runner — reads SQL files from ./drizzle/ and applies them.
// Called on server startup before accepting traffic.
// ─────────────────────────────────────────────────────────────────────────────

import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { db } from './client.js';

export async function runMigrations(): Promise<void> {
  await migrate(db, { migrationsFolder: './drizzle' });
}
