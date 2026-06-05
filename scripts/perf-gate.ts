#!/usr/bin/env tsx
// ─────────────────────────────────────────────────────────────────────────────
// scripts/perf-gate.ts — Performance gate entry point.
//
// REWRITTEN as part of ROADMAP Now #2 (Sentinel, 2026-06-04).
//
// The old implementation measured FFmpeg encode speed (>= 4x realtime). That
// was the WRONG metric for a browser-first editor: it tested the render-worker
// backend, not the user-facing preview performance.
//
// NEW APPROACH: real browser check via Playwright headless Chromium.
// The actual test logic lives in e2e/perf.spec.ts (the authoritative spec).
// This script is a thin shell entry point so `pnpm test:perf` remains a
// single command (matching the CLAUDE.md pnpm test:perf entry).
//
// WHAT IS MEASURED (see e2e/perf.spec.ts for full detail):
//
//   1. Preview FPS (target ≥ 30 fps)
//      Load the 4-track sampleProject (Summer Sale Promo) into the editor,
//      start playback, sample requestAnimationFrame timestamps for 2 seconds,
//      compute average fps. The RAF loop is the Canvas 2D preview engine
//      (PreviewEngine._drawLoop in apps/web/src/engine/PreviewEngine.ts).
//
//   2. Seek latency (p95 < 100ms)
//      Click the timeline ruler at 4 positions. For each: measure wall-clock
//      time from click to editorStore.playheadMs update (read via aria-valuenow
//      on the playhead slider). p95 < 100ms is the product threshold.
//
// RESULTS are written to test-results/perf-fps.json and test-results/perf-seek.json.
//
// DETERMINISM RISK (decision pending — see company/DECISIONS.md):
//   Absolute fps thresholds are noisy on GitHub-hosted runners (shared vCPUs,
//   no GPU). The spec uses an absolute floor of 10 fps (breakdown-only detector)
//   and logs the real number. Anchor/CEO must decide:
//
//   Option A: RELATIVE REGRESSION — store a per-branch baseline and fail when
//     current is >15% below. Works on any CI hardware. Recommended for CI.
//
//   Option B: PINNED HARDWARE — run only on a self-hosted runner with fixed GPU.
//     Absolute 30 fps threshold is then trustworthy. Recommended for the
//     release gate.
//
//   Until the decision is recorded in DECISIONS.md, the spec uses Option A
//   logic with a conservative absolute floor.
//
// HOW TO RUN:
//   pnpm test:perf
//
//   Prerequisites:
//     - Playwright Chromium: pnpm exec playwright install chromium
//     - Dev server: pnpm dev:web (or it will start automatically)
//     - API + services (optional — falls back to localStorage):
//         pnpm services:up && pnpm dev:api
//
// ─────────────────────────────────────────────────────────────────────────────

// This script is intentionally a no-op shell: `pnpm test:perf` in package.json
// now calls `playwright test --project=perf` directly. This file is kept for
// documentation and as a future hook point for pre/post processing (e.g. reading
// the JSON artifacts and printing a summary, or gating on relative regression).

console.log('pnpm test:perf → running e2e/perf.spec.ts via Playwright (project: perf)');
console.log('See e2e/perf.spec.ts for full metric documentation and thresholds.');
console.log('');
console.log('Metrics:');
console.log('  1. Preview FPS  (target ≥ 30 fps;  absolute floor 10 fps in CI)');
console.log('  2. Seek latency (p95 < 100ms across 4 ruler seeks)');
console.log('');
console.log(
  'DETERMINISM NOTE: see company/DECISIONS.md "perf-gate threshold strategy" for the',
);
console.log(
  'absolute-vs-relative-regression decision (tracked, pending Anchor/CEO).',
);
