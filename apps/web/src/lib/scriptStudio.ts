// Script Studio v2 — web client for the L2 AI backend (Contract C).
//
// This file owns the EXACT Contract-A / Contract-C JSON shapes the UI consumes and
// the three `/api/v1/script/*` calls (plan / generate / arrange). The shapes mirror
// `packages/script-studio` (Contract A) but are declared locally because apps/web
// must not depend on that package (Lane L3 touches ONLY apps/web; the type contract
// is what's pinned, not a code import).
//
// INTEGRATION SEAM: the API lane (L2) is built in parallel. Every call goes through
// `request()` first and, when the route is not reachable yet (404 / network), falls
// back to a clearly-marked local mock so the whole UI is buildable + demoable with
// no backend. Flip `SCRIPT_STUDIO_USE_MOCK` to force the mock in any environment.

import { getAccessToken, refreshSession, ApiError } from './api.js';

const BASE =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:4000/api/v1';

/** Force the local mock regardless of backend reachability (demo / offline / tests). */
export const SCRIPT_STUDIO_USE_MOCK =
  (import.meta.env.VITE_SCRIPT_STUDIO_MOCK as string | undefined) === '1';

// ── Contract A — Scene plan shapes (LLM / heuristic output) ─────────────────────

export type BrollMediaType = 'photo' | 'video';

export interface BrollSuggestion {
  mediaType: BrollMediaType;
  keywords: string[];
  description: string;
}

export interface PlannedScene {
  /** 1..600 chars — what TTS speaks. */
  voiceoverText: string;
  /** 0..80 chars — lower-third caption text. */
  smallCaption: string;
  /** 1..60 tokens — full-screen word-by-word caption. */
  bigCaptionWords: string[];
  brollSuggestion: BrollSuggestion;
  /** 800..20000 — ADVISORY ONLY; the assembler overrides with the probed TTS duration. */
  suggestedDurationMs: number;
}

export interface ScenePlan {
  /** 1..40 scenes (bounded → CPU capped). */
  scenes: PlannedScene[];
}

/** Whether the plan came from the LLM or the always-on key-free heuristic fallback. */
export type PlanSource = 'groq' | 'heuristic';

// ── Contract C — route response shapes ──────────────────────────────────────────

export interface PlanResponse {
  plan: ScenePlan;
  source: PlanSource;
}

/** Voice options for the picker. v1 is a small fixed set; the API treats `voiceId`
 *  as an opaque string, so this list can grow without a contract change. */
export interface VoiceOption {
  id: string;
  label: string;
  hint: string;
}

export const VOICE_OPTIONS: VoiceOption[] = [
  { id: 'af_heart', label: 'Aria', hint: 'Warm female · narration' },
  { id: 'am_adam', label: 'Adam', hint: 'Neutral male · explainer' },
  { id: 'af_bella', label: 'Bella', hint: 'Bright female · social' },
  { id: 'am_michael', label: 'Michael', hint: 'Deep male · documentary' },
];

export const DEFAULT_VOICE_ID = VOICE_OPTIONS[0]!.id;

// ── Scene visuals — auto-illustrate each scene ────────────────────────────────────
// 'line'                   = minimal single-line ink art, AI base kept unfiltered (FLUX
//                            renders the look; no sharp filter). The default — keeps the
//                            image light so the narration + captions stay the hero.
// 'pen'/'graphite'/'color' = AI base image stylised at $0 (filtered into one hand).
// 'photo'                  = real web images, kept authentic (search → AI fallback) —
//                            for scripts about real, named subjects (games, people,
//                            brands) where a generated picture looks wrong.
// 'none'                   = text-card-only video (bring your own footage via Arrange).
export type SketchStyle = 'none' | 'line' | 'photo' | 'pen' | 'graphite' | 'color';

export interface SketchStyleOption {
  id: SketchStyle;
  label: string;
  hint: string;
}

export const SKETCH_STYLE_OPTIONS: SketchStyleOption[] = [
  { id: 'line', label: 'Line art', hint: 'Minimal ink, one line' },
  { id: 'photo', label: 'Real photos', hint: 'Authentic web images' },
  { id: 'pen', label: 'Pen', hint: 'Ink line art' },
  { id: 'graphite', label: 'Pencil', hint: 'Graphite shading' },
  { id: 'color', label: 'Color', hint: 'Colored pencil' },
  { id: 'none', label: 'None', hint: 'Bring your own footage' },
];

export const DEFAULT_SKETCH_STYLE: SketchStyle = 'line';

// ── low-level request helper (mirrors lib/api.ts auth handling) ─────────────────

async function scriptRequest<T>(path: string, body: unknown): Promise<T> {
  const doFetch = async (): Promise<Response> => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const token = getAccessToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return fetch(`${BASE}/script${path}`, {
      method: 'POST',
      credentials: 'include',
      headers,
      body: JSON.stringify(body),
    });
  };

  let res = await doFetch();
  if (res.status === 401) {
    // Single silent refresh + replay (same policy as lib/api.ts request()).
    const session = await refreshSession();
    if (session) res = await doFetch();
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new ApiError(`API ${res.status} /script${path}: ${text}`, res.status);
  }
  return (await res.json()) as T;
}

/** True when an error means "the route isn't there yet" so the mock is the right
 *  fallback during parallel development — NOT a content/validation failure. */
function isRouteUnreachable(err: unknown): boolean {
  if (err instanceof ApiError) return err.status === 404 || err.status >= 500;
  // A native fetch TypeError ("Failed to fetch") = the API isn't running.
  return err instanceof TypeError;
}

// ── Contract C — POST /script/plan ──────────────────────────────────────────────

export async function planScript(input: {
  script: string;
  voiceId?: string;
}): Promise<PlanResponse> {
  if (SCRIPT_STUDIO_USE_MOCK) return mockPlan(input.script);
  try {
    return await scriptRequest<PlanResponse>('/plan', input);
  } catch (err) {
    // INTEGRATION: backend route not up yet → heuristic-style mock so the plan step
    // works key-free and the UI is demoable. A real content error (4xx) re-throws.
    if (isRouteUnreachable(err)) return mockPlan(input.script);
    throw err;
  }
}

// ── Contract C — POST /script/generate ──────────────────────────────────────────

export interface GenerateResponse {
  /** Present on the inline (201) path. Absent on the queued (202) path → use the
   *  WS `script:complete` event for the projectId instead. */
  projectId?: string;
  /** 'queued' on the async path (long scripts, or any sketch run). */
  mode?: string;
  jobId?: string;
}

export async function generateScript(input: {
  title: string;
  plan: ScenePlan;
  voiceId: string;
  withMusic: boolean;
  /** Auto-illustrate scenes with this sketch style; 'none'/omitted → no sketches. */
  sketchStyle?: SketchStyle;
}): Promise<GenerateResponse> {
  if (SCRIPT_STUDIO_USE_MOCK) return mockGenerate();
  try {
    return await scriptRequest<GenerateResponse>('/generate', input);
  } catch (err) {
    if (isRouteUnreachable(err)) return mockGenerate();
    throw err;
  }
}

// ── Contract C — POST /script/arrange ───────────────────────────────────────────

import type { Project } from '@videoforge/project-schema';

export interface ArrangeResponse {
  project: Project;
}

export async function arrangeScript(input: {
  projectId: string;
  assetIds: string[];
}): Promise<ArrangeResponse> {
  // No offline mock: arrange mutates a real persisted project. If the route is down
  // the caller surfaces a friendly error (nothing to fabricate that the editor could
  // meaningfully refresh from).
  return scriptRequest<ArrangeResponse>('/arrange', input);
}

// ─────────────────────────────────────────────────────────────────────────────
// INTEGRATION MOCKS — heuristic, dependency-free, deterministic.
// These mirror the always-on `segment.ts` heuristic the API falls back to, so the
// "draft plan" UI path is exercised even with no backend and no API key.
// ─────────────────────────────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'for', 'with',
  'is', 'are', 'was', 'were', 'be', 'this', 'that', 'it', 'as', 'at', 'by',
  'from', 'we', 'you', 'your', 'our', 'i', 'they', 'he', 'she', 'so', 'if',
]);

function keywordsFrom(sentence: string): string[] {
  const words = sentence
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOP_WORDS.has(w));
  // de-dup, keep order, cap at 4
  return [...new Set(words)].slice(0, 4);
}

/** Local heuristic plan — split into sentences, derive a shot brief per scene. */
export function mockPlan(script: string): PlanResponse {
  const sentences = script
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 40); // bounded → CPU capped (Contract A: ≤40 scenes)

  const list = sentences.length > 0 ? sentences : [script.trim() || 'Your script goes here.'];

  const scenes: PlannedScene[] = list.map((text, i) => {
    const kw = keywordsFrom(text);
    const wordCount = text.split(/\s+/).filter(Boolean).length;
    // ~130 wpm → ms; clamp to the advisory 800..20000 window.
    const suggestedDurationMs = Math.min(
      20_000,
      Math.max(800, Math.round((wordCount / 130) * 60_000)),
    );
    const mediaType: BrollMediaType = i % 3 === 2 ? 'photo' : 'video';
    return {
      voiceoverText: text.slice(0, 600),
      smallCaption: text.slice(0, 80),
      bigCaptionWords: text
        .replace(/[^a-zA-Z0-9\s]/g, '')
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 60),
      brollSuggestion: {
        mediaType,
        keywords: kw.length ? kw : ['scene', 'background'],
        description: kw.length
          ? `a ${mediaType} of: ${kw.join(', ')}`
          : `a ${mediaType} that matches this line`,
      },
      suggestedDurationMs,
    };
  });

  return { plan: { scenes }, source: 'heuristic' };
}

function mockGenerate(): GenerateResponse {
  // A stable, recognisably-fake id so demo flows can route to a (local) project.
  return { projectId: `mock-script-${crypto.randomUUID()}` };
}
