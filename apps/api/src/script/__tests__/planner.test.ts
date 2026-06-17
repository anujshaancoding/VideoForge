// ─────────────────────────────────────────────────────────────────────────────
// Planner fallback contract (Contract C #1): with NO GROQ_API_KEY the planner MUST
// fall back to the key-free heuristic and return a valid Contract-A plan with
// source:"heuristic" — never throw, never 5xx-for-content. Pure (no DB/Redis/S3).
// ─────────────────────────────────────────────────────────────────────────────

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { planScript, clearPlanCache, planCacheKey } from '../planner.js';
import { scenePlanSchema } from '../l1.js';

const SCRIPT =
  'Welcome to VideoForge. It turns a script into a finished short. ' +
  'Paste your words. Pick a voice. Hit generate and watch it assemble.';

describe('planScript — heuristic fallback (no GROQ_API_KEY)', () => {
  let savedKey: string | undefined;

  beforeEach(() => {
    savedKey = process.env['GROQ_API_KEY'];
    delete process.env['GROQ_API_KEY'];
    clearPlanCache();
  });

  afterEach(() => {
    if (savedKey === undefined) delete process.env['GROQ_API_KEY'];
    else process.env['GROQ_API_KEY'] = savedKey;
    clearPlanCache();
  });

  it('returns source:"heuristic" and a schema-valid plan with no key', async () => {
    const { plan, source } = await planScript(SCRIPT, 'af_heart');
    expect(source).toBe('heuristic');
    // The plan MUST satisfy Contract A.
    expect(scenePlanSchema.safeParse(plan).success).toBe(true);
    expect(plan.scenes.length).toBeGreaterThanOrEqual(1);
    expect(plan.scenes.length).toBeLessThanOrEqual(40);
  });

  it('treats a blank/whitespace key as no key (still heuristic)', async () => {
    process.env['GROQ_API_KEY'] = '   ';
    const { source } = await planScript(SCRIPT, '');
    expect(source).toBe('heuristic');
  });

  it('never throws for content reasons (degenerate single-word script)', async () => {
    const { plan, source } = await planScript('Hi', 'af_heart');
    expect(source).toBe('heuristic');
    expect(scenePlanSchema.safeParse(plan).success).toBe(true);
  });

  it('caches by hash(script+voiceId) — same key returns the same object', async () => {
    const first = await planScript(SCRIPT, 'af_heart');
    const second = await planScript(SCRIPT, 'af_heart');
    expect(second).toBe(first); // identity: served from cache
    // Different voiceId is a different cache key.
    expect(planCacheKey(SCRIPT, 'af_heart')).not.toBe(
      planCacheKey(SCRIPT, 'other'),
    );
  });
});
