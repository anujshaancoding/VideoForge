// ─────────────────────────────────────────────────────────────────────────────
// Drizzle ORM client — postgres.js driver, connection pool of 10.
// DATABASE_URL defaults to the local dev Postgres container.
// ─────────────────────────────────────────────────────────────────────────────

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

const url =
  process.env['DATABASE_URL'] ??
  'postgresql://videoforge:videoforge_dev@localhost:5432/videoforge';

const queryClient = postgres(url, { max: 10 });
export const db = drizzle(queryClient, { schema });
