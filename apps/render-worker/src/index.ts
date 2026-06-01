// ─────────────────────────────────────────────────────────────────────────────
// @videoforge/render-worker — process entry point.
//
// Boots both BullMQ workers:
//   • "render" queue (src/worker.ts)  — full FFmpeg export pipeline
//   • "media"  queue (src/mediaWorker.ts) — proxy/thumbnail/waveform generation
//
// Wires graceful shutdown so containers stop fast and `tsx watch` reloads cleanly.
// ─────────────────────────────────────────────────────────────────────────────

import { createRenderWorker, RENDER_QUEUE } from './worker.js';
import { createMediaWorker, MEDIA_QUEUE } from './mediaWorker.js';
import type { Worker } from 'bullmq';

function main(): void {
  const renderWorker = createRenderWorker();
  const mediaWorker = createMediaWorker();

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
