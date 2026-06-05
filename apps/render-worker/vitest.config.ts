import { defineConfig } from 'vitest/config';

// Node-env config for @videoforge/render-worker unit tests. These tests mock the
// S3 helpers (./s3.js) so they run with NO network / NO Redis / NO FFmpeg — pure
// logic assertions on asset resolution (the export-parity rendition choice).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts'],
    testTimeout: 10_000,
  },
});
