// ─────────────────────────────────────────────────────────────────────────────
// Script Studio v2 — bounded `script` BullMQ worker (Contract C #3, long path).
//
// Runs INSIDE the API process (concurrency 1) because the orchestration writes to
// Postgres (project + manifest rows) and S3 (originals bucket), both API-owned. For
// LONG scripts the route enqueues a `script` job instead of running inline; this
// worker runs the SAME `runGenerate` off the request thread, publishes
// `script:progress` while synthesizing and `script:complete{projectId}` (or
// `script:failed`) when done. The API's existing Redis→WS relay forwards these to
// the workspace room.
//
// CPU-bounded by design: concurrency 1 here + the TTS single-flight mutex means at
// most one synth runs at a time. No new uncapped pool, no busy-loop. (CEO-approved
// `script` infra delta, 2026-06-05.)
// ─────────────────────────────────────────────────────────────────────────────

import { Worker, type Job, type ConnectionOptions } from 'bullmq';
import { Redis } from 'ioredis';
import { redisClient, type ScriptJobData } from '../queues.js';
import { runGenerate, parsePlan } from './generate.js';
import { isSketchStyle } from './sketch.js';

export const SCRIPT_QUEUE = 'script';

/** A dedicated publisher connection (BullMQ owns the worker's own connection). */
let _pub: Redis | undefined;
function getPub(): Redis {
  if (!_pub) _pub = redisClient.duplicate();
  return _pub;
}

async function publish(channel: string, payload: object): Promise<void> {
  try {
    await getPub().publish(channel, JSON.stringify(payload));
  } catch {
    // WS relay is best-effort; the project is still persisted regardless.
  }
}

async function processScriptJob(job: Job<ScriptJobData>): Promise<{ projectId: string }> {
  const { workspaceId, title, voiceId, withMusic } = job.data;
  const plan = parsePlan(job.data.plan);
  const sketchStyle = isSketchStyle(job.data.sketchStyle) ? job.data.sketchStyle : null;

  const { projectId } = await runGenerate(
    { workspaceId, title, plan, voiceId, withMusic, sketchStyle },
    async ({ progress }) => {
      await publish('script:progress', {
        type: 'script:progress',
        workspaceId,
        jobId: job.id,
        progress,
      });
    },
  );

  await publish('script:complete', {
    type: 'script:complete',
    workspaceId,
    jobId: job.id,
    projectId,
  });

  return { projectId };
}

export function createScriptWorker(): Worker<ScriptJobData, { projectId: string }> {
  const worker = new Worker<ScriptJobData, { projectId: string }>(
    SCRIPT_QUEUE,
    processScriptJob,
    {
      connection: redisClient.duplicate() as unknown as ConnectionOptions,
      // One script job at a time — bounded TTS CPU.
      concurrency: 1,
    },
  );

  worker.on('failed', (job, err) => {
    void publish('script:failed', {
      type: 'script:failed',
      workspaceId: job?.data.workspaceId ?? '',
      jobId: job?.id,
      message: err.message,
    });
  });
  worker.on('error', (err) => {
    console.error(`[script-worker] worker error: ${err.message}`);
  });

  return worker;
}
