// ─────────────────────────────────────────────────────────────────────────────
// Script Studio v2 — Contract A: the scene plan (LLM / heuristic output).
//
// A `ScenePlan` is ORCHESTRATION-TIER data: the LLM (Groq strict json_schema) or
// the always-on key-free heuristic fallback produces it; the pure assembler maps
// it into a validated §18 `Project`. It is NEVER persisted inline in the document
// — it rides the `ScriptManifest` sidecar.
//
// `scenePlanSchema` is the Zod validator the API reuses to validate Groq output
// (and to re-validate before assembly). It MIRRORS Research_Tech §1's JSON Schema:
// every field required, no extra keys (`.strict()`), bounded sizes → CPU is capped
// by construction (≤ 40 scenes).
//
// `planFromHeuristic(script)` derives a valid `ScenePlan` from the existing pure
// `segment.ts` — the zero-key, no-network, deterministic fallback. Same input ⇒
// same plan (asserted by tests). No I/O, no clock, no rng.
// ─────────────────────────────────────────────────────────────────────────────

import { z } from "zod";
import { segmentScript } from "./segment.js";

// ── Types (Contract A) ───────────────────────────────────────────────────────

export interface BrollSuggestion {
  mediaType: "photo" | "video";
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
  /** 800..20000 — ADVISORY ONLY; assembler overrides with probed TTS duration. */
  suggestedDurationMs: number;
}

/** 1..40 scenes (bounded → CPU capped). */
export interface ScenePlan {
  scenes: PlannedScene[];
}

// ── Zod validator — mirrors Research_Tech §1 exactly ─────────────────────────

/** Max scenes per plan. Bounded → TTS / render CPU is capped by construction. */
export const MAX_SCENES = 40;

export const brollSuggestionSchema = z
  .object({
    mediaType: z.enum(["photo", "video"]),
    keywords: z.array(z.string()).min(1).max(8),
    description: z.string().max(200),
  })
  .strict();

export const plannedSceneSchema = z
  .object({
    voiceoverText: z.string().min(1).max(600),
    smallCaption: z.string().max(80),
    bigCaptionWords: z.array(z.string()).min(1).max(60),
    brollSuggestion: brollSuggestionSchema,
    suggestedDurationMs: z.number().int().min(800).max(20000),
  })
  .strict();

export const scenePlanSchema = z
  .object({
    scenes: z.array(plannedSceneSchema).min(1).max(MAX_SCENES),
  })
  .strict();

/** Parse-and-validate result for a scene plan (mirrors validateProject's shape). */
export type ValidateScenePlanResult =
  | { ok: true; value: ScenePlan; errors: null }
  | { ok: false; value: null; errors: z.ZodIssue[] };

/** Non-throwing scene-plan validation. The API uses this on Groq output. */
export function validateScenePlan(json: unknown): ValidateScenePlanResult {
  const result = scenePlanSchema.safeParse(json);
  if (result.success) return { ok: true, value: result.data as ScenePlan, errors: null };
  return { ok: false, value: null, errors: result.error.issues };
}

// ── Heuristic plan (the zero-key, deterministic fallback) ────────────────────

/** Words considered too generic to be useful b-roll search keywords. */
const STOPWORDS = new Set<string>([
  "the", "a", "an", "and", "or", "but", "if", "then", "than", "so", "as", "of",
  "to", "in", "on", "at", "by", "for", "with", "about", "into", "over", "after",
  "is", "are", "was", "were", "be", "been", "being", "am", "do", "does", "did",
  "have", "has", "had", "this", "that", "these", "those", "it", "its", "i", "you",
  "he", "she", "we", "they", "them", "his", "her", "their", "our", "your", "my",
  "me", "us", "him", "not", "no", "yes", "can", "will", "would", "could", "should",
  "from", "up", "down", "out", "off", "all", "any", "some", "more", "most", "just",
  "now", "here", "there", "when", "where", "what", "which", "who", "how", "why",
]);

const PHOTO_HINTS = ["photo", "picture", "image", "portrait", "headshot", "diagram", "chart", "screenshot"];
const VIDEO_HINTS = ["video", "clip", "footage", "motion", "action", "demo", "scene", "moving"];

/** Lowercase + strip non-alphanumerics for keyword normalisation. Deterministic. */
function normaliseWord(w: string): string {
  return w.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/**
 * Naive, deterministic "noun-ish" keyword extraction: drop stopwords + very short
 * tokens, keep insertion order, dedupe, cap at 8. No POS model — just a stable
 * heuristic that gives the b-roll search something concrete. If nothing survives,
 * fall back to the first whitespace token (guarantees keywords.length ≥ 1).
 */
function extractKeywords(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of text.split(/\s+/)) {
    const w = normaliseWord(raw);
    if (w.length < 3 || STOPWORDS.has(w) || seen.has(w)) continue;
    seen.add(w);
    out.push(w);
    if (out.length >= 8) break;
  }
  if (out.length === 0) {
    const first = normaliseWord(text.split(/\s+/)[0] ?? "");
    out.push(first.length > 0 ? first : "scene");
  }
  return out;
}

/** Deterministic photo-vs-video guess from explicit cue words; defaults to "video". */
function guessMediaType(text: string): "photo" | "video" {
  const lower = text.toLowerCase();
  for (const hint of PHOTO_HINTS) if (lower.includes(hint)) return "photo";
  for (const hint of VIDEO_HINTS) if (lower.includes(hint)) return "video";
  return "video";
}

/** Clamp helper. */
function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
}

/**
 * Per-segment advisory duration from word count: `wordCount * 380ms`, clamped to
 * the schema range [800, 20000]. Integer ms. Advisory only — the assembler always
 * overrides with the probed TTS duration.
 */
export function heuristicDurationMs(wordCount: number): number {
  return clamp(Math.round(wordCount * 380), 800, 20000);
}

/**
 * Derive a valid `ScenePlan` from the raw script using the existing pure
 * `segment.ts`. Pure + deterministic + no network — the always-on fallback when
 * no Groq key is configured (Contract A's "key-free producer").
 *
 *   - one scene per `ScriptSegment` (capped at MAX_SCENES)
 *   - voiceoverText  = the segment text (clamped to ≤ 600 chars to stay valid)
 *   - smallCaption   = first ~6 words of the segment (≤ 80 chars)
 *   - bigCaptionWords = whitespace tokens of the segment (capped at 60)
 *   - keywords       = naive noun-ish keyword extraction (≥ 1, ≤ 8)
 *   - suggestedDurationMs = clamp(wordCount * 380, 800, 20000)
 *   - mediaType      = cue-word heuristic (defaults to "video")
 *
 * Returns a plan that ALWAYS passes `scenePlanSchema`. An empty / whitespace-only
 * script yields a single safe placeholder scene (the schema requires ≥ 1 scene),
 * so the downstream Generate step never receives an invalid plan.
 */
export function planFromHeuristic(script: string): ScenePlan {
  const segments = segmentScript(script).slice(0, MAX_SCENES);

  if (segments.length === 0) {
    return {
      scenes: [
        {
          voiceoverText: "Add your script to get started.",
          smallCaption: "Add your script",
          bigCaptionWords: ["Add", "your", "script"],
          brollSuggestion: { mediaType: "video", keywords: ["intro"], description: "Opening b-roll." },
          suggestedDurationMs: 800,
        },
      ],
    };
  }

  const scenes: PlannedScene[] = segments.map((seg) => {
    const tokens = seg.text.split(/\s+/).filter((t) => t.length > 0);
    const bigCaptionWords = tokens.slice(0, 60);
    const smallCaption = tokens.slice(0, 6).join(" ").slice(0, 80);
    const keywords = extractKeywords(seg.text);
    const mediaType = guessMediaType(seg.text);
    return {
      voiceoverText: seg.text.slice(0, 600),
      smallCaption,
      // bigCaptionWords must be ≥ 1; segmentScript never yields empty text, so
      // tokens is non-empty, but guard anyway for total safety.
      bigCaptionWords: bigCaptionWords.length > 0 ? bigCaptionWords : [seg.text.slice(0, 60) || "scene"],
      brollSuggestion: {
        mediaType,
        keywords,
        description: `B-roll for: ${smallCaption || keywords.join(", ")}`.slice(0, 200),
      },
      suggestedDurationMs: heuristicDurationMs(tokens.length),
    };
  });

  return { scenes };
}
