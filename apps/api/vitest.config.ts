import { defineConfig } from 'vitest/config';

// Minimal node-env config for @videoforge/api contract tests. The suite guards
// itself and skips cleanly when Postgres/Redis are unreachable (see
// src/routes/__tests__/projects.contract.test.ts), so it runs green in CI
// Stage 3 (with services) and is a no-op locally.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts'],
    // buildServer() opens DB/Redis connections; give the guarded beforeAll room.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
