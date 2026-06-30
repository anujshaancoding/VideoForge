// ─────────────────────────────────────────────────────────────────────────────
// captionTypewriter — the ONE pure helper that drives the character-by-character
// "typewriter" caption reveal in BOTH the web preview (PreviewEngine) and the
// FFmpeg export (buildFilterComplex). Because both paths import THESE functions,
// the revealed text at any playhead cannot diverge — the WYCIWYG invariant holds
// by construction (CLAUDE.md "the invariant"; DECISIONS 2026-06-27).
//
// SCOPE: Script Studio's big-caption TextOverlay track only. The reveal is opt-in:
// it activates only when the overlay carries `animation.typewriter.words[]`. When
// that data is ABSENT (every overlay today), getRevealedPrefix() returns the full
// text and getCharRevealSteps() returns a SINGLE whole-text step — so the export's
// drawtext output is byte-identical to the historical static stage. No regression.
//
// TIMING MODEL (v1, even-distribution; aeneas forced-alignment is a fast-follow,
// NOT a dependency): the overlay's text is revealed one character at a time. Each
// WORD owns a [startMs, endMs) window (timeline-absolute ms, the same units as
// startOnTimeline). Within a word the characters reveal by EVEN distribution of
// that word's window. The whitespace that separates two words is revealed at the
// next word's start (it appears together with that word's first char). Characters
// stay visible once revealed, through the end of the overlay (a growing prefix).
// ─────────────────────────────────────────────────────────────────────────────

import type { TextOverlay } from "./types.js";

/** A word with its timeline-absolute reveal window. Mirrors CaptionBlock.words. */
export interface TypewriterWord {
  text: string;
  /** Timeline-absolute ms the word begins revealing. */
  startMs: number;
  /** Timeline-absolute ms the word finishes revealing. */
  endMs: number;
}

/**
 * Per-character reveal step. `charStartMs` is the timeline-absolute ms at which
 * `prefix` (a growing prefix of the overlay text) becomes visible; `charEndMs` is
 * the timeline-absolute ms at which it STOPS being the drawn prefix (i.e. the NEXT
 * step takes over, or the overlay ends for the final step).
 *
 * The exporter turns each step into ONE drawtext stage bounded to its OWN window:
 *   enable='between(t, charStartMs/1000, charEndMs/1000 − ε)'
 * so at any time EXACTLY ONE step is enabled and the single drawn prefix equals the
 * prefix `getRevealedPrefix(t)` returns to the preview (WYCIWYG by construction).
 * This is the Option-A fix for Forge's BLOCKER 1: chaining every step to a shared
 * overlay-end bound made all started steps draw simultaneously — for center/right
 * align each prefix is centred independently and painted over the others, doubling
 * glyphs. A per-step window means only the longest revealed prefix is ever visible.
 *
 * Steps are ordered by ascending `charStartMs`; the last step's prefix == full text
 * and its `charEndMs` == the overlay end (so the full caption holds to the end).
 */
export interface RevealStep {
  /** Growing prefix of the overlay's full text (1..text.length chars). */
  prefix: string;
  /** Timeline-absolute ms this prefix turns visible. */
  charStartMs: number;
  /**
   * Timeline-absolute ms this prefix stops being the drawn prefix: the NEXT step's
   * `charStartMs`, or the overlay end for the final step. The exporter bounds the
   * drawtext window to [charStartMs, charEndMs) — a HALF-OPEN interval so the
   * boundary frame belongs to the starting step, matching the preview's `<=`.
   */
  charEndMs: number;
}

/**
 * Extract the typewriter word-timings from an overlay, or null if absent/empty.
 * Defensive: any malformed words[] (non-array, zero-length) ⇒ null ⇒ static.
 */
export function getTypewriterWords(overlay: TextOverlay): TypewriterWord[] | null {
  const tw = overlay.animation?.typewriter;
  if (!tw || !Array.isArray(tw.words) || tw.words.length === 0) return null;
  return tw.words;
}

/**
 * Build the ordered per-character reveal schedule for an overlay: one entry per
 * character of `overlay.text`, giving the timeline-absolute ms that character
 * turns visible. The schedule is derived ONLY from the overlay's text + word
 * windows, so preview and export compute the identical mapping.
 *
 * Returns null when the overlay has no typewriter timing (caller uses static text).
 *
 * Algorithm (pure, deterministic):
 *   • Walk the overlay text left→right, consuming words in order. For each run of
 *     non-whitespace characters we match the next word window; its characters are
 *     spread by EVEN distribution across [word.startMs, word.endMs).
 *   • Whitespace characters BETWEEN words inherit the NEXT word's startMs (they
 *     appear together with that word). Leading whitespace inherits the first word.
 *   • Trailing whitespace / any chars after the last word inherit the last reveal.
 *   • Times are clamped monotonic non-decreasing so the prefix only ever grows.
 */
function buildCharTimes(overlay: TextOverlay, words: TypewriterWord[]): number[] | null {
  const text = overlay.text;
  if (text.length === 0) return null;

  const charTimes = new Array<number>(text.length).fill(NaN);

  // Tokenise the TEXT into word-runs (matching words[] by ordinal). We pair the
  // i-th non-whitespace run with words[i]; surplus runs reuse the last word window.
  let wordIdx = 0;
  let i = 0;
  while (i < text.length) {
    if (/\s/.test(text[i]!)) {
      // Whitespace run: time it to the NEXT word's start (revealed with that word).
      const next = words[wordIdx];
      const t = next ? next.startMs : (words[words.length - 1]?.endMs ?? overlay.startOnTimeline);
      while (i < text.length && /\s/.test(text[i]!)) {
        charTimes[i] = t;
        i += 1;
      }
      continue;
    }
    // Non-whitespace run = one word. Find its [start,end) window.
    const runStart = i;
    while (i < text.length && !/\s/.test(text[i]!)) i += 1;
    const runLen = i - runStart;
    const word = words[Math.min(wordIdx, words.length - 1)]!;
    const span = Math.max(0, word.endMs - word.startMs);
    for (let c = 0; c < runLen; c++) {
      // Even distribution: char c of a runLen-char word reveals at start + span*c/runLen.
      charTimes[runStart + c] = word.startMs + Math.round((span * c) / runLen);
    }
    wordIdx += 1;
  }

  // Enforce monotonic non-decreasing (prefix only grows) and finite values.
  let prev = overlay.startOnTimeline;
  for (let k = 0; k < charTimes.length; k++) {
    let t = charTimes[k]!;
    if (!Number.isFinite(t)) t = prev;
    if (t < prev) t = prev;
    charTimes[k] = t;
    prev = t;
  }
  return charTimes;
}

/**
 * The revealed substring (a prefix of `overlay.text`) at `playheadMs`.
 *
 * • No typewriter timing ⇒ returns the FULL text (static, byte-identical to today).
 * • Before the first char's time ⇒ "".
 * • Otherwise the longest prefix whose chars have all turned visible by `playheadMs`.
 *
 * BOTH PreviewEngine and buildFilterComplex call THIS — they cannot diverge.
 */
export function getRevealedPrefix(overlay: TextOverlay, playheadMs: number): string {
  const words = getTypewriterWords(overlay);
  if (!words) return overlay.text;
  const charTimes = buildCharTimes(overlay, words);
  if (!charTimes) return overlay.text;

  // Count chars whose reveal time is <= playhead. charTimes is non-decreasing.
  let count = 0;
  for (let k = 0; k < charTimes.length; k++) {
    if (charTimes[k]! <= playheadMs) count += 1;
    else break;
  }
  return overlay.text.slice(0, count);
}

/**
 * The ordered per-reveal-step schedule the EXPORTER emits as `enable=between(...)`
 * drawtext stages. Each step's `prefix` is the drawn prefix for its OWN window
 * [charStartMs, charEndMs); the exporter draws exactly one step at a time, so the
 * visible prefix equals `getRevealedPrefix(t)` at every t (WYCIWYG by construction).
 *
 * ALL timing math lives here — the exporter never re-derives the schedule. The end
 * bound of each step is the NEXT step's `charStartMs`; the final step's end is the
 * overlay end (`endOnTimeline`), so the full caption holds to the end.
 *
 * • No typewriter timing ⇒ a SINGLE step { prefix: fullText, charStartMs:
 *   overlay.startOnTimeline, charEndMs: overlay.endOnTimeline } — so the exporter
 *   produces today's one drawtext stage spanning the whole overlay window
 *   (byte-identical output; backward-compat guardrail).
 * • With timing ⇒ one step per DISTINCT reveal time (consecutive chars sharing a
 *   reveal time collapse into one step, which keeps the filtergraph small: an
 *   N-char caption costs at most N stages, typically ≈ word-count + 1). The final
 *   step's prefix is always the full text.
 */
export function getCharRevealSteps(overlay: TextOverlay): RevealStep[] {
  const words = getTypewriterWords(overlay);
  if (!words) {
    return [
      { prefix: overlay.text, charStartMs: overlay.startOnTimeline, charEndMs: overlay.endOnTimeline },
    ];
  }
  const charTimes = buildCharTimes(overlay, words);
  if (!charTimes || charTimes.length === 0) {
    return [
      { prefix: overlay.text, charStartMs: overlay.startOnTimeline, charEndMs: overlay.endOnTimeline },
    ];
  }

  // First pass: collapse consecutive same-time chars into one step (start only).
  const steps: RevealStep[] = [];
  let lastTime = Number.NEGATIVE_INFINITY;
  for (let k = 0; k < charTimes.length; k++) {
    const t = charTimes[k]!;
    const prefix = overlay.text.slice(0, k + 1);
    if (t === lastTime && steps.length > 0) {
      // Same reveal time as previous char → extend the previous step's prefix
      // instead of emitting a redundant drawtext stage (collapse per-char to
      // per-distinct-time; this is what keeps a 30-char caption affordable).
      steps[steps.length - 1]!.prefix = prefix;
    } else {
      // charEndMs is filled in the second pass once the next step's start is known.
      steps.push({ prefix, charStartMs: t, charEndMs: overlay.endOnTimeline });
      lastTime = t;
    }
  }

  // Second pass: each step's end is the NEXT step's start; the final step ends at the
  // overlay end. This is what makes the windows non-overlapping (the exporter draws
  // only the longest revealed prefix at any t). Clamp so end >= start (defensive
  // against any pathological window where a later reveal time would precede the end).
  for (let s = 0; s < steps.length; s++) {
    const end = s + 1 < steps.length ? steps[s + 1]!.charStartMs : overlay.endOnTimeline;
    steps[s]!.charEndMs = Math.max(steps[s]!.charStartMs, end);
  }
  return steps;
}
