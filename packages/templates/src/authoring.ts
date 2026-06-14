// ─────────────────────────────────────────────────────────────────────────────
// Authoring helpers for the starter templates.
//
// These pure builders emit schema-valid §18 shapes (Clip, TextOverlay, CaptionTrack,
// tracks) so each template file stays declarative and within the invariants the Zod
// schema enforces: lowercase UUID v4 ids, integer-ms time, percent geometry, the
// ColorGrade/KenBurns first-class clip fields. They are NOT exported from the package
// index — they are an internal authoring convenience only.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  AudioTrack,
  CaptionBlock,
  CaptionTrack,
  Clip,
  ColorGrade,
  KenBurns,
  OverlayTrack,
  TextOverlay,
  Transition,
  VideoTrack,
} from "@videoforge/project-schema";

// ── Deterministic, schema-valid UUID v4 generation ─────────────────────────────
//
// Template element ids must be stable across runs (the manifest addresses elements
// by id and CI asserts they resolve) AND must be lowercase UUID v4 per the schema's
// UUID_V4_RE. We derive ids from a string seed via a tiny FNV-1a → xorshift PRNG so
// the same key always yields the same valid v4 uuid, with no `uuid` dependency.

function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Deterministic, valid lowercase UUID v4 derived from a stable string key. */
export function id(key: string): string {
  // Seed two independent 32-bit streams so the 128-bit space is well covered.
  let s0 = fnv1a(key) || 1;
  let s1 = fnv1a(`${key}::salt`) || 1;
  const nextByte = (): number => {
    // xorshift32 on s0; reseed low bits from s1 occasionally for spread.
    s0 ^= s0 << 13; s0 >>>= 0;
    s0 ^= s0 >> 17;
    s0 ^= s0 << 5; s0 >>>= 0;
    s1 = (Math.imul(s1, 0x9e3779b1) + 0x6d2b79f5) >>> 0;
    return (s0 ^ s1) & 0xff;
  };
  const bytes: number[] = [];
  for (let i = 0; i < 16; i++) bytes.push(nextByte());
  // Set version (4) and variant (8|9|a|b) nibbles per RFC 4122 §4.4.
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.map((b) => b.toString(16).padStart(2, "0"));
  return (
    `${hex[0]}${hex[1]}${hex[2]}${hex[3]}-${hex[4]}${hex[5]}-${hex[6]}${hex[7]}-` +
    `${hex[8]}${hex[9]}-${hex[10]}${hex[11]}${hex[12]}${hex[13]}${hex[14]}${hex[15]}`
  );
}

// ── Track builders ─────────────────────────────────────────────────────────────

export function videoTrack(trackId: string, name: string, clips: Clip[]): VideoTrack {
  return {
    id: trackId,
    type: "video",
    name,
    colour: "#2BC4B0",
    height: 72,
    muted: false,
    solo: false,
    locked: false,
    hidden: false,
    clips,
  };
}

export function overlayTrack(trackId: string, name: string, clips: TextOverlay[]): OverlayTrack {
  return {
    id: trackId,
    type: "overlay",
    name,
    colour: "#FF9EC4",
    height: 56,
    muted: false,
    solo: false,
    locked: false,
    hidden: false,
    clips,
  };
}

export function audioTrack(trackId: string, name: string, clips: Clip[]): AudioTrack {
  return {
    id: trackId,
    type: "audio",
    name,
    colour: "#7C9CFF",
    height: 56,
    muted: false,
    solo: false,
    locked: false,
    hidden: false,
    volume: 100,
    pan: 0,
    volumeEnvelope: [],
    clips,
  };
}

// ── Clip builder ─────────────────────────────────────────────────────────────────

export interface MediaSlotClipOpts {
  clipId: string;
  trackId: string;
  /** Bundled placeholder/sentinel asset id this slot references until filled. */
  assetId: string;
  startMs: number;
  endMs: number;
  colorGrade?: ColorGrade;
  kenBurns?: KenBurns;
}

/**
 * A placeholder media-slot clip: spans [startMs,endMs] on the timeline, trims the full
 * span from the (stand-in) source, and carries the template's Ken Burns + color grade.
 * The slot's duration is fixed by the template; filling the slot only swaps the asset.
 */
export function mediaSlotClip(o: MediaSlotClipOpts): Clip {
  const span = o.endMs - o.startMs;
  const clip: Clip = {
    id: o.clipId,
    sourceAssetId: o.assetId,
    trackId: o.trackId,
    startOnTimeline: o.startMs,
    endOnTimeline: o.endMs,
    trimIn: 0,
    trimOut: span,
    speed: 1,
    effects: [],
    keyframes: {},
    linkedClipId: null,
  };
  if (o.colorGrade) clip.colorGrade = o.colorGrade;
  if (o.kenBurns) clip.kenBurns = o.kenBurns;
  return clip;
}

/** An audio (background-music) placeholder clip with optional linear fades. */
export function audioSlotClip(o: {
  clipId: string;
  trackId: string;
  assetId: string;
  startMs: number;
  endMs: number;
  gain?: number;
  fadeInMs?: number;
  fadeOutMs?: number;
}): Clip {
  const span = o.endMs - o.startMs;
  const clip: Clip = {
    id: o.clipId,
    sourceAssetId: o.assetId,
    trackId: o.trackId,
    startOnTimeline: o.startMs,
    endOnTimeline: o.endMs,
    trimIn: 0,
    trimOut: span,
    speed: 1,
    gain: o.gain ?? 100,
    effects: [],
    keyframes: {},
    linkedClipId: null,
  };
  if (o.fadeInMs !== undefined) clip.fadeInMs = o.fadeInMs;
  if (o.fadeOutMs !== undefined) clip.fadeOutMs = o.fadeOutMs;
  return clip;
}

// ── Text overlay builder ─────────────────────────────────────────────────────────

export interface TextSlotOpts {
  overlayId: string;
  trackId: string;
  text: string;
  startMs: number;
  endMs: number;
  /** Top-left anchor + size, percent of canvas 0–100. */
  canvasX: number;
  canvasY: number;
  width: number;
  height: number;
  fontSize: number;
  fontWeight?: number;
  italic?: boolean;
  color?: string;
  align?: "left" | "center" | "right";
}

/** A pre-filled, editable text overlay (the user edits the string only). */
export function textOverlay(o: TextSlotOpts): TextOverlay {
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
    animation: {
      in: { preset: "fadeIn", durationMs: 300 },
      out: { preset: "fadeOut", durationMs: 300 },
      loop: null,
    },
    keyframes: {},
    text: o.text,
    style: {
      fontFamily: "Inter",
      fontSize: o.fontSize,
      fontWeight: o.fontWeight ?? 700,
      italic: o.italic ?? false,
      color: o.color ?? "#FFFFFF",
      align: o.align ?? "center",
      lineHeight: 1.2,
      letterSpacing: 0,
      outline: { width: 2, color: "#000000", position: "outside" },
      shadow: { color: "#00000066", offsetX: 0, offsetY: 3, blur: 6 },
      backgroundColor: null,
    },
  };
}

// ── Caption builders ───────────────────────────────────────────────────────────

export function captionBlock(o: {
  blockId: string;
  text: string;
  startMs: number;
  endMs: number;
}): CaptionBlock {
  return { id: o.blockId, startMs: o.startMs, endMs: o.endMs, text: o.text };
}

export function captionTrack(o: {
  trackId: string;
  name: string;
  blocks: CaptionBlock[];
}): CaptionTrack {
  return {
    id: o.trackId,
    type: "caption",
    name: o.name,
    colour: "#06B6D4",
    height: 48,
    muted: false,
    solo: false,
    locked: false,
    hidden: false,
    language: "en",
    style: {
      fontFamily: "Inter",
      fontSize: 48,
      color: "#FFFFFF",
      backgroundColor: "#000000A6",
      outline: { width: 2, color: "#000000" },
      position: "bottom",
      align: "center",
    },
    blocks: o.blocks,
  };
}

// ── Transition builder ───────────────────────────────────────────────────────────

export function crossfade(o: {
  transitionId: string;
  trackId: string;
  fromClipId: string;
  toClipId: string;
  durationMs: number;
}): Transition {
  return {
    id: o.transitionId,
    trackId: o.trackId,
    fromClipId: o.fromClipId,
    toClipId: o.toClipId,
    type: "crossfade",
    durationMs: o.durationMs,
    params: { easing: "linear" },
  };
}

// ── Color grades (Iris §4.6) ─────────────────────────────────────────────────────

export const GRADES = {
  birthday: { brightness: 8, contrast: 12, saturation: 15 },
  travel: { brightness: -5, contrast: 20, saturation: -8 },
  memories: { brightness: 3, contrast: 8, saturation: -12 },
  quote: { brightness: -25, contrast: 15, saturation: -40 },
  promo: { brightness: 0, contrast: 10, saturation: 10 },
} satisfies Record<string, ColorGrade>;

// ── 9:16 canvas (all 5 launch templates) ─────────────────────────────────────────

export const CANVAS_9_16 = {
  width: 1080,
  height: 1920,
  frameRate: 30,
  aspectRatio: "9:16",
  backgroundColor: "#111111",
} as const;

/** Fixed project-identity fields shared by every template document. */
export const TEMPLATE_OWNER_ID = "00000000-0000-4000-8000-0000000000a1";
export const TEMPLATE_WORKSPACE_ID = "00000000-0000-4000-8000-0000000000a2";
export const TEMPLATE_CREATED_AT = "2026-06-04T00:00:00.000Z";
