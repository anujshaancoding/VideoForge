#!/usr/bin/env tsx
import postgres from 'postgres';
import manifest from '../../fixtures/manifest.json' assert { type: 'json' };

const url = process.env.DATABASE_URL ?? 'postgresql://videoforge:videoforge_dev@localhost:5432/videoforge';
const sql = postgres(url);

async function seed() {
  // Create a dev workspace user if not exists
  await sql`
    INSERT INTO users (id, email, display_name, created_at)
    VALUES ('dev-user', 'dev@videoforge.local', 'Dev User', NOW())
    ON CONFLICT (id) DO NOTHING
  `;

  // Seed fixture assets
  for (const fixture of manifest.fixtures) {
    await sql`
      INSERT INTO assets (id, workspace_id, filename, content_type, file_size, md5_hash, status, s3_key_original, duration_ms, width, height, created_at)
      VALUES (
        ${fixture.id},
        'dev-workspace',
        ${fixture.filename},
        ${fixture.contentType},
        1000000,
        ${fixture.md5 ?? null},
        'READY',
        ${fixture.s3Key},
        ${fixture.durationMs},
        ${'width' in fixture ? (fixture as any).width : null},
        ${'height' in fixture ? (fixture as any).height : null},
        NOW()
      )
      ON CONFLICT (id) DO NOTHING
    `;
  }

  console.log('DB seeded.');
  await sql.end();
}

seed().catch(console.error);
