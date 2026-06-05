// ─────────────────────────────────────────────────────────────────────────────
// @videoforge/render-worker — process entry point.
//
// Boots both BullMQ workers:
//   • "render" queue (src/worker.ts)  — full FFmpeg export pipeline
//   • "media"  queue (src/mediaWorker.ts) — proxy/thumbnail/waveform generation
//
// Wires graceful shutdown so containers stop fast and `tsx watch` reloads cleanly.
// ─────────────────────────────────────────────────────────────────────────────

// ── Sentry (ROADMAP #10) ───────────────────────────────────────────────────
// Init before any workers are created so the SDK is in place before jobs run.
// `enabled: false` when SENTRY_DSN is absent/blank — every call is a no-op.
import * as Sentry from '@sentry/node';
// `SENTRY_DSN` is empty string when unset; only pass `dsn` when it is truthy
// so we never hand `undefined` into a field typed as `string` (exactOptionalPropertyTypes).
const _workerSentryDsn = process.env['SENTRY_DSN'] || '';
Sentry.init({
  ...(_workerSentryDsn ? { dsn: _workerSentryDsn } : {}),
  enabled: !!_workerSentryDsn,
});

import { createRenderWorker, RENDER_QUEUE } from './worker.js';
import { createMediaWorker, MEDIA_QUEUE } from './mediaWorker.js';
import type { Worker } from 'bullmq';

function main(): void {
  const renderWorker = createRenderWorker();
  const mediaWorker = createMediaWorker();

  // Report failed render jobs to Sentry (no-op when DSN is blank).
  // The BullMQ 'failed' event fires after the processor throws; we capture
  // the error with the job id and export id as extra context.
  renderWorker.on('failed', (job, err) => {
    Sentry.captureException(err, {
      extra: {
        queue: RENDER_QUEUE,
        jobId: job?.id,
        exportId: (job?.data as { exportId?: string } | undefined)?.exportId,
      },
    });
  });

  mediaWorker.on('failed', (job, err) => {
    Sentry.captureException(err, {
      extra: {
        queue: MEDIA_QUEUE,
        jobId: job?.id,
        assetId: (job?.data as { assetId?: string } | undefined)?.assetId,
      },
    });
  });

  console.info(
    `[render-worker] started; queues="${RENDER_QUEUE}", "${MEDIA_QUEUE}"`,
  );

  const workers: Worker[] = [renderWorker, mediaWorker];

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      console.info(`[render-worker] received ${signal}, closing workers`);
      void Promise.allSettled(workers.map((w) => w.close()))
        .then(() => process.exit(0))
        .catch((err: unknown) => {
          console.error(`[render-worker] error during shutdown: ${String(err)}`);
          process.exit(1);
        });
    });
  }
}

// ESM entry-point guard: run only when executed directly (not when imported).
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
