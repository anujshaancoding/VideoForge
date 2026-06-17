// ─────────────────────────────────────────────────────────────────────────────
// Script Studio v2 — Contract B: `assemblePlannedProject` (pure / headless).
//
// Maps a validated `ScenePlan` + probed per-scene VO durations (+ optional user
// assets + optional music bed) into a valid §18 `Project` + `PlannedScriptManifest`.
// PURE: no I/O, no clock, no rng. Element ids derive deterministically from a
// caller `seed` via the SAME `id(key)` trick v1 uses. Same input ⇒ byte-identical
// document + manifest (golden-tested).
//
// It NEVER modifies v1 `assembleScript`. It reuses the `@videoforge/templates`
// authoring builders (videoTrack/audioTrack/overlayTrack/audioSlotClip/captionBlock/…)
// and the v1 `buildTextCard` style discipline (export-rendered subset only). It NEVER
// imports `@videoforge/ffmpeg-graph` and adds NO render path.
//
// Tracks/overlays emitted (all integer-ms, percent geometry, track-index z-order):
//   • voiceover : one VO clip per scene, back-to-back from t=0; window = probed durationMs
//   • video     : round-robin asset→scene b-roll, trim/loop fit, photo spans window, gap if none
//   • overlay   : small-caption lower-third (one per scene) + big-caption full-screen
//                 word-by-word SEQUENCE (one centred TextOverlay per ~3-word chunk)
//   • caption   : a real CaptionBlock per scene (with words[] when available)
//   • audio     : optional FreePD music bed, looped/trimmed to length, ducked via
//                 volumeEnvelope keyframes (low under VO, higher in gaps; NO sidechain)
// ─────────────────────────────────────────────────────────────────────────────

import type {
  Project,
  TextOverlay,
  TextStyle,
  Clip,
  CaptionBlock,
  AudioTrack,
  RevealWipe,
} from "@videoforge/project-schema";
import {
  audioTrack,
  audioSlotClip,
  mediaSlotClip,
  captionBlock,
  captionTrack,
  videoTrack,
  CANVAS_9_16,
  id,
  overlayTrack,
} from "@videoforge/templates/authoring";
import {
  EXPORTABLE_TEXT_STYLE_KEYS,
  DEFAULT_SCENE_STYLE,
} from "./assemble.js";
import type { ScenePlan, PlannedScene, BrollSuggestion } from "./plan.js";
import type {
  AssembledPlannedScript,
  PlannedScriptManifest,
  PlannedSceneMapping,
  ScriptSceneStyle,
  ScriptAttribution,
} from "./types.js";

export { EXPORTABLE_TEXT_STYLE_KEYS, DEFAULT_SCENE_STYLE };

const MANIFEST_VERSION = 2;

// Free-tier identity (mirrors v1 assemble.ts — server overwrites on POST).
const SCRIPT_OWNER_ID = "00000000-0000-4000-8000-0000000000b1";
const SCRIPT_WORKSPACE_ID = "00000000-0000-4000-8000-0000000000b2";
const SCRIPT_CREATED_AT = "2026-06-05T00:00:00.000Z";

// ── Geometry (percent of canvas) ──────────────────────────────────────────────
// SUBTITLE = bottom band, showing the NARRATION in short synced phrases (the spoken
// words appear at the bottom as they're said). Fixed → deterministic. (The old static
// title lower-third is removed; its track stays as an empty overlay track.)
const BIG_X = 6;
const BIG_Y = 72; // bottom third — synced narration subtitle
const BIG_W = 88;
const BIG_H = 20;
const BIG_FONT = 40;

/** Words per subtitle phrase — readable bottom captions synced to the voice-over. */
const BIG_CHUNK_WORDS = 5;

/** Music duck gains, in track-volume PERCENT (100 = unity). Low under VO, higher in gaps. */
const DUCK_UNDER_VO = 15; // ≈ 0.15 linear
const DUCK_IN_GAP = 50; // ≈ 0.5 linear — also the full music-only "bed" level (intro/outro swell).
/** Short ramp (ms) into/out of each duck so the bed breathes without a hard step. */
const DUCK_RAMP_MS = 150;

// ── Music swell defaults (applied ONLY when `music` is provided) ──────────────
// A short music-only intro/outro so the duck is audibly DYNAMIC even when VO is
// continuous back-to-back: the bed swells to full level before the first VO and
// after the last, dipping to the low duck across the VO span. Pure timeline shift
// (timeline still starts at 0; integer-ms preserved).
const DEFAULT_MUSIC_LEAD_IN_MS = 1200;
const DEFAULT_MUSIC_LEAD_OUT_MS = 1200;

// ── Inputs (Contract B) ──────────────────────────────────────────────────────

export interface SceneVo {
  /** Index into plan.scenes (0-based). */
  sceneIndex: number;
  /** The registered WAV asset id (uuid). */
  voiceAssetId: string;
  /** PROBED (ffprobe) positive-integer ms — the source of truth for timing. */
  durationMs: number;
  /** Optional per-word timings (aeneas fast-follow); else even-distributed. */
  words?: { text: string; startMs: number; endMs: number }[];
}

export interface PlacedAsset {
  assetId: string;
  mediaType: "photo" | "video";
  /** Probed source duration (ms) for video fit; ignored/optional for photos. */
  durationMs?: number;
  /** Stable upload order (0-based) — placement is round-robin over this order. */
  uploadOrder: number;
  /** Optional whiteboard "draw-on" reveal applied to this asset's clip (photo only). */
  revealWipe?: RevealWipe;
  /** Optional quick opacity fade-in (ms) at the clip start (photo only). */
  fadeInMs?: number;
}

export interface AssemblePlannedInput {
  plan: ScenePlan;
  /** length === plan.scenes.length; sceneIndex values must cover [0, n). */
  vo: SceneVo[];
  /** User uploads (Arrange step). Empty/omitted on first build → text-card-only video track. */
  assets?: PlacedAsset[];
  /** FreePD bed (optional). durationMs = probed source length. */
  music?: { assetId: string; durationMs: number } | null;
  /**
   * Music-only intro swell (ms) before the first VO. Applied ONLY when `music` is
   * provided (no-op + ignored when `music` is null/omitted). Defaults to ~1200ms.
   * Shifts all VO/overlays/captions/b-roll to start at this offset so the bed can
   * swell to full level before the voice ducks it. Integer-ms; clamped to ≥0.
   */
  musicLeadInMs?: number;
  /**
   * Music-only outro swell (ms) after the last VO. Applied ONLY when `music` is
   * provided. Defaults to ~1200ms. The bed swells back to full level here.
   */
  musicLeadOutMs?: number;
  voiceId: string;
  seed: string;
  title: string;
  sceneStyle?: ScriptSceneStyle;
}

// ── Scene window (computed from probed VO durations) ─────────────────────────

interface SceneWindow {
  sceneIndex: number;
  startMs: number;
  endMs: number;
  vo: SceneVo;
  scene: PlannedScene;
}

/**
 * Compute back-to-back probed scene windows starting at `startOffsetMs` (default 0).
 * The timeline itself still starts at 0; `startOffsetMs` is the music lead-in swell so
 * VO/overlays/captions/b-roll begin after the music-only intro. Pure.
 */
function computeWindows(plan: ScenePlan, vo: SceneVo[], startOffsetMs = 0): SceneWindow[] {
  const byIndex = new Map<number, SceneVo>();
  for (const v of vo) byIndex.set(v.sceneIndex, v);
  const windows: SceneWindow[] = [];
  let cursor = startOffsetMs;
  plan.scenes.forEach((scene, i) => {
    const v = byIndex.get(i);
    if (!v) throw new Error(`assemblePlannedProject: missing SceneVo for scene ${i}.`);
    const startMs = cursor;
    const endMs = startMs + v.durationMs;
    windows.push({ sceneIndex: i, startMs, endMs, vo: v, scene });
    cursor = endMs;
  });
  return windows;
}

// ── Text-card style (export-rendered subset only — the AC-6 WYCIWYG frontier) ─

function subsetStyle(style: ScriptSceneStyle, fontSize: number): TextStyle {
  return {
    fontFamily: style.fontFamily,
    fontSize,
    fontWeight: style.fontWeight,
    color: style.color,
    align: style.align,
    lineHeight: 1.2,
    outline: { ...style.outline },
  };
}

function buildOverlay(o: {
  overlayId: string;
  trackId: string;
  text: string;
  startMs: number;
  endMs: number;
  canvasX: number;
  canvasY: number;
  width: number;
  height: number;
  style: TextStyle;
}): TextOverlay {
  // CRITICAL: only export-rendered style keys are set (no gradient/shadow/
  // letterSpacing/backgroundColor); rotation:0 + animation:{} so nothing the
  // exporter drops can change the picture. WYCIWYG (AC-6).
  return {
    id: o.overlayId,
    trackId: o.trackId,
    kind: "text",
    startOnTimeline: o.startMs,
    endOnTimeline: o.endMs,
    canvasX: o.canvasX,
    canvasY: o.canvasY,
    width: o.width,
    height: o.height,
    rotation: 0,
    opacity: 100,
    animation: {},
    keyframes: {},
    text: o.text,
    style: o.style,
  };
}

// ── Big-caption chunk timing ─────────────────────────────────────────────────

interface Chunk {
  text: string;
  startMs: number;
  endMs: number;
}

/**
 * Split a scene's `bigCaptionWords` into ~3-word chunks and time each chunk.
 * If per-word timings are present, the chunk spans [firstWord.start, lastWord.end]
 * (clamped into the scene window). Otherwise the words are even-distributed across
 * the window. Deterministic; contiguous; integer ms; tiles [startMs, endMs).
 */
function chunkBigCaption(w: SceneWindow): Chunk[] {
  // Subtitle source is the NARRATION (voice-over text), so the bottom captions show
  // what's actually being said. vo.words (one per narration word) give the timing.
  const words = w.scene.voiceoverText.split(/\s+/).filter((t) => t.length > 0);
  const groups: string[][] = [];
  for (let i = 0; i < words.length; i += BIG_CHUNK_WORDS) {
    groups.push(words.slice(i, i + BIG_CHUNK_WORDS));
  }
  if (groups.length === 0) return [];

  const start = w.startMs;
  const end = w.endMs;

  // Path A: real per-word timings (aeneas). Map each group's word span by ordinal.
  // SceneVo.words are scene-relative; offset by the window start.
  const vw = w.vo.words;
  if (vw && vw.length >= words.length) {
    const chunks: Chunk[] = [];
    let wordCursor = 0;
    for (let g = 0; g < groups.length; g++) {
      const groupLen = groups[g]!.length;
      const firstWord = vw[wordCursor]!;
      const lastWord = vw[wordCursor + groupLen - 1]!;
      const cs = start + Math.round(firstWord.startMs);
      const ce = start + Math.round(lastWord.endMs);
      wordCursor += groupLen;
      chunks.push({ text: groups[g]!.join(" "), startMs: cs, endMs: ce });
    }
    // Clamp + enforce contiguity/monotonicity inside the window so spans are valid
    // and tile the timeline (overlapping/te past-end timings can't smuggle in).
    return normaliseChunks(chunks, start, end);
  }

  // Path B: even distribution across the window (export-correct approximation).
  const total = groups.length;
  const span = end - start;
  const chunks: Chunk[] = groups.map((g, i) => {
    const cs = start + Math.round((span * i) / total);
    const ce = start + Math.round((span * (i + 1)) / total);
    return { text: g.join(" "), startMs: cs, endMs: ce };
  });
  return normaliseChunks(chunks, start, end);
}

/** Clamp every chunk into [start,end], force monotonic non-overlapping spans. */
function normaliseChunks(chunks: Chunk[], start: number, end: number): Chunk[] {
  let prevEnd = start;
  const out: Chunk[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i]!;
    let cs = Math.max(prevEnd, Math.min(c.startMs, end));
    let ce = Math.max(cs + 1, Math.min(Math.max(c.endMs, cs + 1), end));
    // Last chunk extends to the window end so the sequence tiles fully.
    if (i === chunks.length - 1) ce = end;
    // Guard against a zero/negative window: keep at least 1ms.
    if (ce <= cs) ce = Math.min(cs + 1, end > start ? end : cs + 1);
    out.push({ text: c.text, startMs: cs, endMs: ce });
    prevEnd = ce;
  }
  return out;
}

// ── B-roll placement (round-robin + trim/loop fit) ───────────────────────────

/**
 * Produce the b-roll Clip(s) that tile scene window `w` from the round-robin-assigned
 * asset (if any). Pure + deterministic:
 *   • no asset (N===0)         → [] (gap; exporter fills canvas bg)
 *   • photo                    → one clip spanning the whole window
 *   • video, D>=W              → trim: head-of-source [0, W]
 *   • video, D<W               → loop: back-to-back repeats of [0, D], final trimmed
 *                                to the remainder (NO atempo / setpts)
 * `idFor(suffix)` derives the per-clip ids deterministically.
 */
function placeBroll(
  w: SceneWindow,
  assets: PlacedAsset[],
  trackId: string,
  idFor: (suffix: string) => string,
): Clip[] {
  const n = assets.length;
  if (n === 0) return [];
  const asset = assets[w.sceneIndex % n]!;
  const W = w.endMs - w.startMs;
  if (W <= 0) return [];

  if (asset.mediaType === "photo") {
    const clip = mediaSlotClip({
      clipId: idFor(`broll:${w.sceneIndex}:0`),
      trackId,
      assetId: asset.assetId,
      startMs: w.startMs,
      endMs: w.endMs,
    });
    // Whiteboard "draw-on" reveal for the (full-window) photo, if requested.
    if (asset.revealWipe) clip.revealWipe = asset.revealWipe;
    // Quick opacity fade-in (0→100 over fadeInMs at the clip start), then hold. Reuses
    // the existing opacity-keyframe export path; times are ABSOLUTE timeline ms.
    if (asset.fadeInMs && asset.fadeInMs > 0) {
      clip.keyframes = {
        ...clip.keyframes,
        opacity: [
          { timeMs: w.startMs, value: 0, easing: "linear" },
          { timeMs: w.startMs + asset.fadeInMs, value: 100, easing: "linear" },
        ],
      };
    }
    return [clip];
  }

  // Video. Need a positive source duration to decide trim vs loop; if unknown,
  // treat it as long enough to fill the window (single trimmed clip) — safe + simple.
  const D = asset.durationMs && asset.durationMs > 0 ? asset.durationMs : W;

  if (D >= W) {
    // Trim head-of-source to the window. One clip.
    const clip = mediaSlotClip({
      clipId: idFor(`broll:${w.sceneIndex}:0`),
      trackId,
      assetId: asset.assetId,
      startMs: w.startMs,
      endMs: w.endMs,
    });
    clip.trimIn = 0;
    clip.trimOut = W;
    return [clip];
  }

  // Loop: repeat [0, D] back-to-back until W is covered; final repeat trimmed to remainder.
  const clips: Clip[] = [];
  let offset = 0;
  let rep = 0;
  while (offset < W) {
    const remaining = W - offset;
    const segLen = Math.min(D, remaining);
    const clip = mediaSlotClip({
      clipId: idFor(`broll:${w.sceneIndex}:${rep}`),
      trackId,
      assetId: asset.assetId,
      startMs: w.startMs + offset,
      endMs: w.startMs + offset + segLen,
    });
    clip.trimIn = 0;
    clip.trimOut = segLen;
    clips.push(clip);
    offset += segLen;
    rep += 1;
  }
  return clips;
}

// ── Music duck envelope (parity-safe; existing volumeEnvelope only) ──────────

/**
 * Build a deterministic ducking `volumeEnvelope` for the music track from the scene
 * windows: FULL bed level (~0.5 → 50%) during the music-only intro/outro swell regions,
 * a short RAMP DOWN (~150ms) to the low duck (~0.15 → 15%) when VO starts, the low duck
 * held across the (continuous) VO span, a short RAMP UP at the last VO end, and the bed
 * restored to full level through the outro. Inter-scene gaps (if the caller leaves any)
 * also swell back up. Uses ONLY the existing volume-envelope field the exporter already
 * renders → audibly DYNAMIC AND WYCIWYG-safe (NO sidechaincompress).
 *
 * The intro (`leadInMs`) and outro (`leadOutMs`) are music-only regions the assembler
 * pads around the VO. With them present the duck swells in and out audibly even when the
 * VO itself is one continuous block. Keyframes are de-duplicated + sorted; integer-ms.
 */
function buildDuckEnvelope(
  windows: SceneWindow[],
  projectEndMs: number,
): Array<{ timeMs: number; value: number }> {
  if (windows.length === 0) {
    // No VO → flat gap-level bed for the whole project.
    return [{ timeMs: 0, value: DUCK_IN_GAP }];
  }
  // Build raw (time,value) points, then sort + dedupe by time (last wins on collision
  // after we resolve to the lower — VO duck — value, which is the safe choice).
  const points: Array<{ timeMs: number; value: number }> = [];
  const push = (timeMs: number, value: number) => {
    points.push({ timeMs: Math.max(0, Math.round(timeMs)), value });
  };

  // Intro swell: bed at FULL level from t=0, held flat across the music-only lead-in,
  // then ramping down to the VO duck level by the first VO start.
  const first = windows[0]!;
  push(0, DUCK_IN_GAP);
  if (first.startMs > 0) {
    push(Math.max(0, first.startMs - DUCK_RAMP_MS), DUCK_IN_GAP);
  }

  let prev: SceneWindow | null = null;
  for (const w of windows) {
    // Gap between prev VO end and this VO start → swell back to bed level mid-gap.
    if (prev && w.startMs - prev.endMs > 2 * DUCK_RAMP_MS) {
      push(prev.endMs + DUCK_RAMP_MS, DUCK_IN_GAP);
      push(w.startMs - DUCK_RAMP_MS, DUCK_IN_GAP);
    }
    // Duck down for this VO window (ramp in by start, hold low, ramp begins at end).
    push(w.startMs, DUCK_UNDER_VO);
    push(Math.max(w.startMs, w.endMs - DUCK_RAMP_MS), DUCK_UNDER_VO);
    prev = w;
  }

  // Outro swell: from the last VO end ramp back UP to full bed level, then hold flat
  // across the music-only lead-out through project end.
  const last = windows[windows.length - 1]!;
  if (projectEndMs > last.endMs) {
    push(last.endMs, DUCK_UNDER_VO);
    push(Math.min(projectEndMs, last.endMs + DUCK_RAMP_MS), DUCK_IN_GAP);
    push(projectEndMs, DUCK_IN_GAP);
  }

  // Sort by time; collapse duplicate timestamps to the lower (safer) value.
  points.sort((a, b) => a.timeMs - b.timeMs || a.value - b.value);
  const out: Array<{ timeMs: number; value: number }> = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && last.timeMs === p.timeMs) {
      last.value = Math.min(last.value, p.value);
      continue;
    }
    out.push({ timeMs: p.timeMs, value: p.value });
  }
  return out;
}

/** Build the music track: looped/trimmed bed to project length + duck envelope. */
function buildMusicTrack(o: {
  trackId: string;
  clipId: string;
  assetId: string;
  sourceDurationMs: number;
  projectEndMs: number;
  windows: SceneWindow[];
}): { track: AudioTrack; clipId: string } {
  const { projectEndMs } = o;
  const clips: Clip[] = [];
  if (projectEndMs > 0) {
    // One bed clip spanning the project, trimmed to project length (or full source
    // when source ≥ project). Loop-fill when source is shorter — same trim+repeat
    // discipline as b-roll, no time-stretch. The PRIMARY clip keeps the manifest id.
    const D = o.sourceDurationMs > 0 ? o.sourceDurationMs : projectEndMs;
    let offset = 0;
    let rep = 0;
    while (offset < projectEndMs) {
      const remaining = projectEndMs - offset;
      const segLen = Math.min(D, remaining);
      const clip = audioSlotClip({
        clipId: rep === 0 ? o.clipId : id(`${o.clipId}:loop:${rep}`),
        trackId: o.trackId,
        assetId: o.assetId,
        startMs: offset,
        endMs: offset + segLen,
      });
      clip.trimIn = 0;
      clip.trimOut = segLen;
      clips.push(clip);
      offset += segLen;
      rep += 1;
    }
  }

  const base = audioTrack(o.trackId, "Music", clips);
  const track: AudioTrack = {
    ...base,
    // The envelope drives the dynamic duck; keep the flat `volume` at unity so the
    // envelope is the single source of gain truth.
    volume: 100,
    volumeEnvelope: buildDuckEnvelope(o.windows, projectEndMs),
  };
  return { track, clipId: o.clipId };
}

// ── The assembler (Contract B) ────────────────────────────────────────────────

/**
 * Assemble a planned project into a valid §18 `Project` + `PlannedScriptManifest`.
 * Pure & deterministic. See file header for the emitted track layout.
 */
export function assemblePlannedProject(input: AssemblePlannedInput): AssembledPlannedScript {
  const { plan } = input;
  const sceneStyle = input.sceneStyle ?? DEFAULT_SCENE_STYLE;

  // ── Validate inputs (cheap, deterministic guards) ──
  const n = plan.scenes.length;
  if (n < 1 || n > 40) {
    throw new Error(`assemblePlannedProject: plan must have 1..40 scenes (got ${n}).`);
  }
  if (input.vo.length !== n) {
    throw new Error(
      `assemblePlannedProject: expected ${n} SceneVo input(s) for ${n} scene(s), got ${input.vo.length}.`,
    );
  }
  for (const v of input.vo) {
    if (!Number.isInteger(v.durationMs) || v.durationMs <= 0) {
      throw new Error(
        `assemblePlannedProject: scene ${v.sceneIndex} durationMs must be a positive integer (got ${v.durationMs}).`,
      );
    }
  }

  const k = (s: string): string => id(`${input.seed}:${s}`);

  const VOICE_TRACK = k("track:voiceover");
  const VIDEO_TRACK = k("track:video");
  const SMALL_TRACK = k("track:overlay:small");
  const BIG_TRACK = k("track:overlay:big");
  const CAPTION_TRACK = k("track:caption");
  const MUSIC_TRACK = k("track:music");

  // Music-only swell padding — ONLY when a bed is present (else 0; no-music timeline
  // is unchanged and VO still starts at t=0). Integer-ms, clamped ≥0.
  const hasMusic = !!input.music;
  const leadInMs = hasMusic
    ? Math.max(0, Math.round(input.musicLeadInMs ?? DEFAULT_MUSIC_LEAD_IN_MS))
    : 0;
  const leadOutMs = hasMusic
    ? Math.max(0, Math.round(input.musicLeadOutMs ?? DEFAULT_MUSIC_LEAD_OUT_MS))
    : 0;

  const windows = computeWindows(plan, input.vo, leadInMs);
  // VO span ends at the last window; the project extends through the outro swell.
  const voEndMs = windows.length > 0 ? windows[windows.length - 1]!.endMs : leadInMs;
  const projectEndMs = windows.length > 0 ? voEndMs + leadOutMs : 0;

  // Order assets by upload order (stable) for round-robin determinism.
  const assets = [...(input.assets ?? [])].sort((a, b) => a.uploadOrder - b.uploadOrder);

  const voiceClips: Clip[] = [];
  const videoClips: Clip[] = [];
  const smallCards: TextOverlay[] = [];
  const bigCards: TextOverlay[] = [];
  const captionBlocks: CaptionBlock[] = [];
  const mappings: PlannedSceneMapping[] = [];

  for (const w of windows) {
    const { sceneIndex: i, startMs, endMs, scene, vo } = w;

    // Voice-over clip.
    const voiceClipId = k(`vo:${i}`);
    voiceClips.push(
      audioSlotClip({
        clipId: voiceClipId,
        trackId: VOICE_TRACK,
        assetId: vo.voiceAssetId,
        startMs,
        endMs,
      }),
    );

    // B-roll video clip(s).
    const brollClips = placeBroll(w, assets, VIDEO_TRACK, k);
    videoClips.push(...brollClips);

    // Title lower-third removed — the bottom band now shows synced narration subtitles
    // (the sequence built below). Kept null for manifest compatibility.
    const smallCaptionOverlayId: string | null = null;

    // Bottom SUBTITLE — a SEQUENCE of bottom-band overlays, one per ~5-word phrase of
    // the NARRATION, each timed to its words so the captions track the voice-over.
    const chunks = chunkBigCaption(w);
    const bigCaptionOverlayIds: string[] = [];
    chunks.forEach((c, ci) => {
      const overlayId = k(`big:${i}:${ci}`);
      bigCaptionOverlayIds.push(overlayId);
      bigCards.push(
        buildOverlay({
          overlayId,
          trackId: BIG_TRACK,
          text: c.text,
          startMs: c.startMs,
          endMs: c.endMs,
          canvasX: BIG_X,
          canvasY: BIG_Y,
          width: BIG_W,
          height: BIG_H,
          style: subsetStyle(sceneStyle, BIG_FONT),
        }),
      );
    });

    // Caption block (sidecar SRT/VTT). Attach scene-relative→absolute words[] when present.
    const blockId = k(`cap:${i}`);
    const block: CaptionBlock = captionBlock({
      blockId,
      text: scene.smallCaption.trim().length > 0 ? scene.smallCaption : scene.voiceoverText,
      startMs,
      endMs,
    });
    if (vo.words && vo.words.length > 0) {
      block.words = vo.words.map((wd) => ({
        text: wd.text,
        startMs: startMs + Math.max(0, Math.round(wd.startMs)),
        endMs: startMs + Math.max(0, Math.round(wd.endMs)),
      }));
    }
    captionBlocks.push(block);

    mappings.push({
      sceneIndex: i,
      voiceoverText: scene.voiceoverText,
      startMs,
      endMs,
      voiceAssetId: vo.voiceAssetId,
      durationMs: vo.durationMs,
      voiceClipId,
      videoClipIds: brollClips.map((c) => c.id),
      smallCaptionOverlayId,
      bigCaptionOverlayIds,
      captionBlockId: blockId,
      brollSuggestion: cloneSuggestion(scene.brollSuggestion),
    });
  }

  // VO track: built as audio, re-typed to "voiceover" (dedicated lane, max 1 on Free).
  const voBase = audioTrack(VOICE_TRACK, "Voice-over", voiceClips);

  const tracks: Project["tracks"] = [
    // Video (b-roll) at the bottom of the z-order so overlays sit above it.
    videoTrack(VIDEO_TRACK, "B-roll", videoClips),
    { ...voBase, type: "voiceover" },
    overlayTrack(SMALL_TRACK, "Lower-third captions", smallCards),
    overlayTrack(BIG_TRACK, "Big captions", bigCards),
  ];

  let musicClipId: string | null = null;
  let musicTrackId: string | null = null;
  const attributions: ScriptAttribution[] = [];
  if (input.music) {
    const { track, clipId } = buildMusicTrack({
      trackId: MUSIC_TRACK,
      clipId: k("music:clip"),
      assetId: input.music.assetId,
      sourceDurationMs: input.music.durationMs,
      projectEndMs,
      windows,
    });
    tracks.push(track);
    musicClipId = clipId;
    musicTrackId = MUSIC_TRACK;
    // CC0 FreePD: no attribution legally required, but log provenance.
    attributions.push({
      assetId: input.music.assetId,
      provider: "freepd",
      author: "FreePD (CC0 1.0)",
      url: "https://freepd.com",
    });
  }

  const document: Project = {
    schemaVersion: 1,
    revision: 1,
    id: k("doc"),
    title: input.title,
    canvas: { ...CANVAS_9_16 },
    tracks,
    captionTracks: [
      captionTrack({ trackId: CAPTION_TRACK, name: "Captions", blocks: captionBlocks }),
    ],
    transitions: [],
    markers: [],
    exportPresets: [],
    ownerId: SCRIPT_OWNER_ID,
    workspaceId: SCRIPT_WORKSPACE_ID,
    collaborators: [{ userId: SCRIPT_OWNER_ID, role: "admin" }],
    isPublic: false,
    templateId: null,
    createdAt: SCRIPT_CREATED_AT,
    updatedAt: SCRIPT_CREATED_AT,
  };

  const manifest: PlannedScriptManifest = {
    id: k("manifest"),
    manifestVersion: MANIFEST_VERSION,
    projectId: document.id,
    voiceId: input.voiceId,
    sceneStyle,
    scenes: mappings,
    videoTrackId: VIDEO_TRACK,
    musicClipId,
    musicTrackId,
    attributions,
  };

  return { document, manifest };
}

function cloneSuggestion(s: BrollSuggestion): BrollSuggestion {
  return { mediaType: s.mediaType, keywords: [...s.keywords], description: s.description };
}

// ── Arrange (re-place uploaded assets onto already-built scene windows) ──────

/**
 * Pure helper for Contract C's `/arrange`: given an already-assembled planned
 * `document` + its `manifest` + the user's uploaded `assets`, REBUILD only the
 * b-roll video track (round-robin assign + trim/loop fit) onto the EXISTING scene
 * windows stored in the manifest — no re-planning, no re-probing. Returns a NEW
 * document (the input is not mutated) + the updated manifest (videoClipIds refreshed).
 *
 * Deterministic: same (document, manifest, assets) ⇒ byte-identical result. Ids are
 * derived from each scene's stored window via the manifest projectId as the seed root,
 * so re-arranging is idempotent and stable.
 */
export function arrangeAssets(
  document: Project,
  manifest: PlannedScriptManifest,
  assets: PlacedAsset[],
): AssembledPlannedScript {
  const ordered = [...assets].sort((a, b) => a.uploadOrder - b.uploadOrder);
  const trackId = manifest.videoTrackId;

  // Derive arrange clip ids from a stable root tied to the project + a salt so they
  // never collide with the original assemble-time ids (which used the assemble seed).
  const idFor = (suffix: string): string => id(`${manifest.projectId}:arrange:${suffix}`);

  const newVideoClips: Clip[] = [];
  const newScenes: PlannedSceneMapping[] = manifest.scenes.map((m) => {
    const w: SceneWindow = {
      sceneIndex: m.sceneIndex,
      startMs: m.startMs,
      endMs: m.endMs,
      // placeBroll only reads sceneIndex + start/end; vo/scene are unused there.
      vo: { sceneIndex: m.sceneIndex, voiceAssetId: m.voiceAssetId, durationMs: m.durationMs },
      scene: undefined as unknown as PlannedScene,
    };
    const clips = placeBroll(w, ordered, trackId, idFor);
    newVideoClips.push(...clips);
    return { ...m, videoClipIds: clips.map((c) => c.id) };
  });

  // Replace the b-roll track's clips; leave every other track untouched.
  const newTracks = document.tracks.map((t) => {
    if (t.id === trackId && t.type === "video") {
      return { ...t, clips: newVideoClips };
    }
    return t;
  });

  const newDocument: Project = { ...document, tracks: newTracks };
  const newManifest: PlannedScriptManifest = { ...manifest, scenes: newScenes };
  return { document: newDocument, manifest: newManifest };
}
