// ─────────────────────────────────────────────────────────────────────────────
// Script Studio — the assembler (P0, pure / headless).
//
// `assembleScript(input)` turns segments + caller-supplied VO asset ids + probed
// durations into a valid §18 `Project` + a `ScriptManifest` sidecar. It is PURE:
// no I/O, no clock, no rng. Element ids are derived deterministically from a
// caller-supplied `seed` via the SAME FNV-1a→xorshift `id(key)` trick already used
// by @videoforge/templates (reused, not re-implemented). Same input ⇒ byte-identical
// document + manifest (asserted by the golden assembly test).
//
// Reuse (Script_Studio_Architecture §2.4): the track/clip/caption builders come
// from @videoforge/templates/authoring — one set of "emit valid §18 shapes" builders,
// no second drift surface. The ONE thing authored locally is the text card, because
// the WYCIWYG frontier (§3.1 / AC-6) requires it be constrained to the export-rendered
// drawtext subset — the templates `textOverlay()` helper layers on shadow/animation
// which the export path honestly DROPS. A script card must never lean on a property
// the exporter ignores, or preview != export. See `EXPORTABLE_TEXT_STYLE_KEYS`.
//
// This package NEVER imports @videoforge/ffmpeg-graph; it depends only on the schema
// (+ templates authoring). It adds NO render path.
// ─────────────────────────────────────────────────────────────────────────────

import type { Project, TextOverlay, TextStyle, Clip, CaptionBlock } from "@videoforge/project-schema";
import {
  audioTrack,
  audioSlotClip,
  captionBlock,
  captionTrack,
  CANVAS_9_16,
  id,
  overlayTrack,
} from "@videoforge/templates/authoring";
import { segmentScript, type ScriptSegment } from "./segment.js";
import type {
  AssembledScript,
  ScriptManifest,
  ScriptSceneStyle,
  ScriptSegmentMapping,
} from "./types.js";

// ── The export-rendered text style subset (the WYCIWYG frontier, AC-6) ───────────
//
// The export `drawtext` stage (ffmpeg-graph buildFilterComplex §4b) renders ONLY
// these TextStyle keys; it honestly OMITS gradient, shadow, letterSpacing,
// backgroundColor (and overlay-level rotation/animation). A script text card must
// therefore set ONLY these keys, so what the preview shows is exactly what exports.
// The guard test asserts every authored card's style keys are a subset of this set.
export const EXPORTABLE_TEXT_STYLE_KEYS = [
  "fontFamily",
  "fontSize",
  "fontWeight",
  "italic",
  "color",
  "align",
  "lineHeight",
  "outline",
] as const satisfies readonly (keyof TextStyle)[];

/** Default scene style — solid white type + dark outline, all within the export subset. */
export const DEFAULT_SCENE_STYLE: ScriptSceneStyle = {
  fontFamily: "Inter",
  fontSize: 84,
  fontWeight: 700,
  color: "#FFFFFF",
  align: "center",
  outline: { width: 3, color: "#000000", position: "outside" },
};

// Text-card geometry (percent of canvas): a centred band, comfortably inside the
// 9:16 safe area. Fixed across segments so the assembly is deterministic.
const CARD_X = 8;
const CARD_Y = 38;
const CARD_W = 84;
const CARD_H = 24;

// Free-tier identity for a freshly-assembled doc. The server overwrites ownership
// on POST /projects (forceServerOwnedFields); these are valid placeholders so the
// pure output validates in isolation. Mirrors the Templates identity constants.
const SCRIPT_OWNER_ID = "00000000-0000-4000-8000-0000000000b1";
const SCRIPT_WORKSPACE_ID = "00000000-0000-4000-8000-0000000000b2";
const SCRIPT_CREATED_AT = "2026-06-05T00:00:00.000Z";

const MANIFEST_VERSION = 1;

/** Per-segment timing/asset input. Durations are CALLER-supplied (probed, not estimated). */
export interface SegmentInput {
  /** Caller-supplied VO asset id this segment's voice clip references (P1 injects the asset). */
  voiceAssetId: string;
  /** Caller-supplied probed VO duration (ms) for this segment. MUST be a positive integer. */
  durationMs: number;
}

export interface AssembleScriptInput {
  /** The raw script string (segmented internally) OR pre-computed segments. */
  script: string;
  /**
   * Per-segment inputs, in segment order. Length MUST equal the number of segments
   * produced from `script`. Durations are probed values (AC-7), never estimated here.
   */
  segments: SegmentInput[];
  /** Caller-supplied voice id (opaque in P0). */
  voiceId: string;
  /** Stable seed for deterministic id derivation. Same seed + input ⇒ same document. */
  seed: string;
  /** Project title. */
  title: string;
  /** Optional scene-style override (still constrained to the export subset). */
  sceneStyle?: ScriptSceneStyle;
  /** Optional gap (ms) inserted between consecutive segments on the timeline. Default 0. */
  gapMs?: number;
}

/** Build the single text-card overlay for a segment within the export-rendered subset. */
function buildTextCard(o: {
  overlayId: string;
  trackId: string;
  text: string;
  startMs: number;
  endMs: number;
  style: ScriptSceneStyle;
}): TextOverlay {
  // CRITICAL: only export-rendered style keys are set. NO gradient, NO shadow, NO
  // letterSpacing, NO backgroundColor. rotation:0 and no animation so nothing the
  // exporter drops can change the picture (WYCIWYG, AC-6).
  const style: TextStyle = {
    fontFamily: o.style.fontFamily,
    fontSize: o.style.fontSize,
    fontWeight: o.style.fontWeight,
    color: o.style.color,
    align: o.style.align,
    lineHeight: 1.2,
    outline: { ...o.style.outline },
  };
  return {
    id: o.overlayId,
    trackId: o.trackId,
    kind: "text",
    startOnTimeline: o.startMs,
    endOnTimeline: o.endMs,
    canvasX: CARD_X,
    canvasY: CARD_Y,
    width: CARD_W,
    height: CARD_H,
    rotation: 0,
    opacity: 100,
    animation: {},
    keyframes: {},
    text: o.text,
    style,
  };
}

/**
 * Assemble a script into a valid §18 `Project` + `ScriptManifest`. Pure & deterministic.
 *
 * Layout per segment: one voice-over clip (referencing the caller's VO asset id +
 * probed duration), one text-card `TextOverlay`, one `CaptionBlock`. Segments are
 * laid back-to-back from t=0 (plus an optional inter-segment gap). All times are
 * integer ms; all geometry is percent 0–100.
 */
export function assembleScript(input: AssembleScriptInput): AssembledScript {
  const segments = segmentScript(input.script);
  const gapMs = input.gapMs ?? 0;
  const sceneStyle = input.sceneStyle ?? DEFAULT_SCENE_STYLE;

  if (input.segments.length !== segments.length) {
    throw new Error(
      `assembleScript: expected ${segments.length} segment input(s) for the ` +
        `${segments.length} parsed segment(s), received ${input.segments.length}.`,
    );
  }
  for (const [i, si] of input.segments.entries()) {
    if (!Number.isInteger(si.durationMs) || si.durationMs <= 0) {
      throw new Error(
        `assembleScript: segment ${i} durationMs must be a positive integer (got ${si.durationMs}).`,
      );
    }
  }

  const k = (s: string): string => id(`${input.seed}:${s}`);

  const VOICE_TRACK = k("track:voiceover");
  const OVERLAY_TRACK = k("track:overlay");
  const CAPTION_TRACK = k("track:caption");

  const voiceClips: Clip[] = [];
  const textCards: TextOverlay[] = [];
  const captionBlocks: CaptionBlock[] = [];
  const mappings: ScriptSegmentMapping[] = [];

  let cursor = 0;
  for (const seg of segments) {
    const si = input.segments[seg.index]!;
    const startMs = cursor;
    const endMs = startMs + si.durationMs;

    const voiceClipId = k(`vo:${seg.index}`);
    const overlayId = k(`card:${seg.index}`);
    const blockId = k(`cap:${seg.index}`);

    // Voice-over clip: references the caller-provided asset id; trims the full span.
    voiceClips.push(
      audioSlotClip({
        clipId: voiceClipId,
        trackId: VOICE_TRACK,
        assetId: si.voiceAssetId,
        startMs,
        endMs,
      }),
    );

    // Text card: export-subset only.
    textCards.push(
      buildTextCard({
        overlayId,
        trackId: OVERLAY_TRACK,
        text: seg.text,
        startMs,
        endMs,
        style: sceneStyle,
      }),
    );

    // Caption block: text + timing straight from the segment + probed duration.
    captionBlocks.push(captionBlock({ blockId, text: seg.text, startMs, endMs }));

    mappings.push({
      segmentIndex: seg.index,
      paragraphIndex: seg.paragraphIndex,
      text: seg.text,
      startMs,
      endMs,
      voiceAssetId: si.voiceAssetId,
      durationMs: si.durationMs,
      voiceClipId,
      textOverlayId: overlayId,
      captionBlockId: blockId,
    });

    cursor = endMs + gapMs;
  }

  // The voiceover track is built as a plain audio track (audio-bearing, mix fields)
  // then re-typed to "voiceover" so the VO lands on a dedicated lane (max 1 on Free).
  const voTrack = audioTrack(VOICE_TRACK, "Voice-over", voiceClips);

  const document: Project = {
    schemaVersion: 1,
    revision: 1,
    id: k("doc"),
    title: input.title,
    canvas: { ...CANVAS_9_16 },
    tracks: [
      { ...voTrack, type: "voiceover" },
      overlayTrack(OVERLAY_TRACK, "Text cards", textCards),
    ],
    captionTracks: [captionTrack({ trackId: CAPTION_TRACK, name: "Captions", blocks: captionBlocks })],
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

  const manifest: ScriptManifest = {
    id: k("manifest"),
    manifestVersion: MANIFEST_VERSION,
    projectId: document.id,
    voiceId: input.voiceId,
    sceneStyle,
    segments: mappings,
    attributions: [],
  };

  return { document, manifest };
}

export type { ScriptSegment };
