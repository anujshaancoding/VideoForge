// ─────────────────────────────────────────────────────────────────────────────
// VideoForge project document — TypeScript types (faithful to Spec v1.1 §18.2).
//
// The project is a single JSON document and the authoritative source of truth for
// the entire edit state. Media binaries live in S3 and are referenced by assetId
// only — never embedded here. See VideoForge_Spec_v1.1.md §18 for the full prose.
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Primitives & aliases
// ─────────────────────────────────────────────────────────────────────────────

/** UUID v4 string, e.g. "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d". All ids use this. */
export type UUID = string;

/** Integer milliseconds from the project origin (timeline) or asset origin (trims). */
export type Millis = number;

/** Percentage of canvas dimension, 0–100. Enables resolution-independence. */
export type Percent = number;

/** "#RRGGBB" or "#RRGGBBAA". */
export type HexColor = string;

/** ISO-8601 UTC timestamp, e.g. "2026-06-01T12:00:00.000Z". */
export type ISODateTime = string;

// ─────────────────────────────────────────────────────────────────────────────
// Project root
// ─────────────────────────────────────────────────────────────────────────────

export interface Project {
  /** Increment on breaking schema changes. Server migrates older docs on open. */
  schemaVersion: number;

  /**
   * Server-owned, monotonically increasing integer. Bumped by the server on every
   * successful write (online patch apply or PATCH save). Used for stale-base
   * detection on offline reconnect (§18.3). Distinct from schemaVersion (migrations)
   * and from version snapshots (history). Clients send the baseRevision they edited
   * against; they never invent or increment this value.
   */
  revision: number;

  id: UUID;
  title: string;
  description?: string;

  canvas: CanvasConfig;

  /** Ordered. Index = z-order (bottom→top in array) and audio mix order. */
  tracks: Track[];

  /** Caption tracks are modeled separately from media tracks. Max 4. */
  captionTracks: CaptionTrack[];

  /** Transitions are first-class objects referencing two adjacent clips (E-6). */
  transitions: Transition[];

  markers: Marker[];

  /** Saved export configurations for quick re-use. */
  exportPresets: ExportPreset[];

  // Settings / ownership
  ownerId: UUID;
  workspaceId: UUID;
  collaborators: Collaborator[];
  isPublic: boolean;
  templateId?: UUID | null;

  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface Collaborator {
  userId: UUID;
  /** Canonical four-role set (§18.3): Admin > Editor > Commenter > Viewer. */
  role: "viewer" | "commenter" | "editor" | "admin";
}

// ─────────────────────────────────────────────────────────────────────────────
// Canvas
// ─────────────────────────────────────────────────────────────────────────────

export interface CanvasConfig {
  /** Logical pixel width, e.g. 1920. Bounded ≤ 4096 (canvas cap). */
  width: number;
  /** Logical pixel height, e.g. 1080. Bounded ≤ 4096. */
  height: number;
  /** Project frames per second, e.g. 24 | 25 | 30 | 50 | 60. */
  frameRate: number;
  /** "16:9", "9:16", "1:1", "4:5", "21:9", or "custom". Derived display value. */
  aspectRatio: string;
  /**
   * Project canvas background (maps to data model per finding A-13). Exported as a
   * solid colour where no clip covers the area. Default "#111111". This is NOT the
   * (non-exported) editor surround colour.
   */
  backgroundColor: HexColor;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tracks — discriminated union on `type`
// ─────────────────────────────────────────────────────────────────────────────

export type Track =
  | VideoTrack
  | AudioTrack
  | CaptionTrack
  | OverlayTrack
  | VoiceOverTrack;

/** Fields shared by every track. */
export interface TrackBase {
  id: UUID;
  name: string;
  /** Track-header tint, "#RRGGBB". */
  colour: HexColor;
  /** Rendered lane height in px in the timeline UI. */
  height: number;
  /** Audio-applicable; harmless/false on visual-only tracks. */
  muted: boolean;
  solo: boolean;
  locked: boolean;
  /** UI-only: whether the track is hidden in the timeline (does not affect export but is persisted for UX). */
  hidden: boolean;
}

/** Per-track audio mix controls (audio-bearing tracks only — finding E-7). */
export interface AudioTrackMix {
  /** Track volume as percent gain; 100 = 0 dB. Range 0–200, default 100. */
  volume: number;
  /** L/R balance; -100 = full left, +100 = full right. Default 0. */
  pan: number;
  /**
   * Ordered volume automation. When empty, `volume` applies flat; when populated,
   * envelope keyframes override `volume` over time. value is percent 0–200.
   */
  volumeEnvelope: Array<{ timeMs: Millis; value: number }>;
}

export interface VideoTrack extends TrackBase {
  type: "video";
  clips: Clip[];
}

export interface AudioTrack extends TrackBase, AudioTrackMix {
  type: "audio";
  clips: Clip[];
}

/** Dedicated voice-over track. Audio-bearing, so carries the mix fields. */
export interface VoiceOverTrack extends TrackBase, AudioTrackMix {
  type: "voiceover";
  clips: Clip[];
  /** Default ducking trigger for music tracks (§7.1). */
  isDuckingTrigger?: boolean;
}

/** Holds OverlayClips (text/image/shape/lottie/sticker). Index = z-order. */
export interface OverlayTrack extends TrackBase {
  type: "overlay";
  clips: OverlayClip[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Clip (video / audio / voiceover)
// ─────────────────────────────────────────────────────────────────────────────

export interface Clip {
  id: UUID;
  /** Reference to the uploaded media asset (S3-backed). */
  sourceAssetId: UUID;
  /** Owning track id (denormalised for fast lookup; tracks[].clips[] is canonical). */
  trackId: UUID;

  /** Position on the project timeline. */
  startOnTimeline: Millis;
  endOnTimeline: Millis;

  /** In/out points within the SOURCE asset (asset-relative ms). */
  trimIn: Millis;
  trimOut: Millis;

  /** Playback rate multiplier. 1 = normal, 0.5 = half, 2 = double. */
  speed: number;

  /** Per-clip gain (percent, 100 = 0 dB). Combined with track volume on mix. */
  gain?: number;

  /** Per-clip linear audio fade-in duration (ms). Maps to FFmpeg `afade=t=in`. */
  fadeInMs?: number;
  /** Per-clip linear audio fade-out duration (ms). Maps to FFmpeg `afade=t=out`. */
  fadeOutMs?: number;

  effects: Effect[];

  /** Per-property animation. Key = animatable property path; value = ordered keyframes. */
  keyframes: Record<string, Keyframe[]>;

  /**
   * One color-grade pass (brightness/contrast/saturation). Per MVP_Scope §5 this is
   * a first-class clip field (the single MVP effect). Maps to FFmpeg `eq` on export.
   */
  colorGrade?: ColorGrade;

  /** Ken Burns pan-zoom (start→end scale). Maps to FFmpeg `zoompan` on export. */
  kenBurns?: KenBurns | null;

  /** A/V link group (e.g. split video+audio that move together). */
  linkedClipId?: UUID | null;

  /**
   * On-canvas placement (picture-in-picture / manual transform). Percent of the
   * canvas, like OverlayClip geometry: x/y = top-left, width/height = size. ABSENT
   * means the clip fills the frame with aspect-fit (the historical default — leaving
   * it undefined keeps existing projects/exports byte-identical). The preview and the
   * FFmpeg export BOTH honour this (scale-to-box + overlay-at-position), so a moved /
   * resized clip looks the same in the export — the fidelity invariant holds.
   */
  transform?: ClipTransform;

  /** Mirror the clip horizontally (FFmpeg `hflip`; preview flips on the X axis). */
  flipH?: boolean;
  /** Mirror the clip vertically (FFmpeg `vflip`). */
  flipV?: boolean;

  // NOTE: transitions live in Project.transitions[], NOT here (finding E-6).
}

/**
 * Per-clip canvas transform (PiP). All values are PERCENT of the canvas (0–100 for
 * on-canvas; x/y may go slightly out of range while dragging). `rotation` is degrees,
 * reserved for a later increment (not yet rendered/exported, so always 0 for now).
 */
export interface ClipTransform {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
}

/** Per-clip color grade. UI-centred values: 0 = neutral, range −100..100. */
export interface ColorGrade {
  brightness: number;
  contrast: number;
  saturation: number;
}

/** Ken Burns pan-zoom: a slow scale ramp from `startScale` to `endScale` (e.g. 1.0→1.5). */
export interface KenBurns {
  startScale: number;
  endScale: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// OverlayClip — discriminated union on `kind`
// ─────────────────────────────────────────────────────────────────────────────

export type OverlayClip =
  | TextOverlay
  | ImageOverlay
  | ShapeOverlay
  | LottieOverlay
  | StickerOverlay;

/** Geometry & timing shared by all overlay kinds. All geometry in percent. */
export interface OverlayBase {
  id: UUID;
  trackId: UUID;

  startOnTimeline: Millis;
  endOnTimeline: Millis;

  /** Top-left anchor as percentage of canvas (resolution-independent). */
  canvasX: Percent;
  canvasY: Percent;
  width: Percent;
  height: Percent;
  /** Clockwise degrees. */
  rotation: number;
  /** 0–100. */
  opacity: number;

  /** Entrance/exit/loop animation preset config. */
  animation: OverlayAnimation;

  /** Animatable property paths (e.g. "canvasX", "opacity", "rotation"). */
  keyframes: Record<string, Keyframe[]>;
}

export interface OverlayAnimation {
  in?: { preset: string; durationMs: Millis };
  out?: { preset: string; durationMs: Millis };
  loop?: { preset: string; durationMs: Millis } | null;
}

export interface TextOverlay extends OverlayBase {
  kind: "text";
  text: string;
  style: TextStyle;
}

export interface ImageOverlay extends OverlayBase {
  kind: "image";
  sourceAssetId: UUID;
  /** "contain" | "cover" | "fill" | "none". */
  fit?: string;
}

export interface ShapeOverlay extends OverlayBase {
  kind: "shape";
  shape: "rectangle" | "ellipse" | "line" | "polygon";
  style: ShapeStyle;
}

export interface LottieOverlay extends OverlayBase {
  kind: "lottie";
  sourceAssetId: UUID;
  /** Loop the Lottie for the clip duration. */
  loop: boolean;
  /** Recolour overrides applied to named layers (persisted so export can rasterise). */
  recolor?: Record<string, HexColor>;
}

export interface StickerOverlay extends OverlayBase {
  kind: "sticker";
  sourceAssetId: UUID;
  /** Animated stickers loop; static ones do not. */
  animated: boolean;
}

export interface TextStyle {
  fontFamily: string;
  fontSize: number; // logical px at canvas resolution
  fontWeight: number;
  italic?: boolean;
  /** Solid fill colour. */
  color: HexColor;
  /** Optional gradient fill (rasterised on export — drawtext cannot render it). */
  gradient?: {
    type: "linear" | "radial";
    stops: Array<{ offset: number; color: HexColor }>;
    angle?: number;
  } | null;
  align: "left" | "center" | "right";
  lineHeight?: number;
  letterSpacing?: number;
  outline?: { width: number; color: HexColor; position: "outside" | "inside" | "center" };
  shadow?: { color: HexColor; offsetX: number; offsetY: number; blur: number };
  backgroundColor?: HexColor | null;
}

export interface ShapeStyle {
  fill?: HexColor | null;
  stroke?: HexColor | null;
  strokeWidth?: number;
  cornerRadius?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Captions
// ─────────────────────────────────────────────────────────────────────────────

export interface CaptionTrack extends TrackBase {
  type: "caption";
  /** Track-wide default styling; per-block `styleOverride` wins where set. */
  style: CaptionStyle;
  /** BCP-47 language tag, e.g. "en", "es". */
  language: string;
  blocks: CaptionBlock[];
}

export interface CaptionBlock {
  id: UUID;
  startMs: Millis;
  endMs: Millis;
  /** Display text (≤ 42 chars/line, ≤ 2 lines for hand-edited blocks). */
  text: string;
  /** Per-block overrides on top of the track CaptionStyle. */
  styleOverride?: Partial<CaptionStyle>;
  /**
   * Optional per-word timings (findings F-2, C-11). Populated by AI auto-caption
   * (all tiers). Absent for manual/imported/translated blocks — karaoke then
   * synthesises even timing from character counts.
   */
  words?: Array<{ text: string; startMs: Millis; endMs: Millis }>;
}

export interface CaptionStyle {
  fontFamily: string;
  fontSize: number;
  color: HexColor;
  backgroundColor?: HexColor | null;
  outline?: { width: number; color: HexColor };
  /** Position anchor of the caption block within the canvas. */
  position: "top" | "center" | "bottom";
  align: "left" | "center" | "right";
}

// ─────────────────────────────────────────────────────────────────────────────
// Markers
// ─────────────────────────────────────────────────────────────────────────────

export interface Marker {
  id: UUID;
  timeMs: Millis;
  type: "chapter" | "comment" | "todo" | "generic";
  label: string;
  colour: HexColor;
  note?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Effects & Keyframes
// ─────────────────────────────────────────────────────────────────────────────

export interface Effect {
  id: UUID;
  /** e.g. "colorGrade" | "chromaKey" | "blur" | "eq" | "compressor" | "reverb" | "mask". */
  type: string;
  enabled: boolean;
  /** Parameter bag (e.g. { contrast: 0, saturation: 0 }). UI-centred values. */
  params: Record<string, number | string | boolean>;
}

export interface Keyframe {
  /** Stable id for UI add/remove/update (optional; absent on imported/synthesised kfs). */
  id?: UUID;
  timeMs: Millis;
  /** Target value at this time (number for numeric props; string for e.g. colour). */
  value: number | string;
  /** Interpolation into the NEXT keyframe. */
  easing: "linear" | "easeIn" | "easeOut" | "easeInOut" | "hold" | "bezier";
  /** Cubic-bezier control points when easing === "bezier". */
  bezier?: [number, number, number, number];
}

// ─────────────────────────────────────────────────────────────────────────────
// Transitions — top-level, reference two adjacent clips (finding E-6)
// ─────────────────────────────────────────────────────────────────────────────

export interface Transition {
  id: UUID;
  trackId: UUID;
  fromClipId: UUID;
  toClipId: UUID;
  /** e.g. "crossfade" | "dipToColor" | "slide" | "wipe" | "zoom". */
  type: string;
  /** Default 500. Integer ms. */
  durationMs: Millis;
  /** direction / easing / colour, per §6.4. */
  params: Record<string, number | string | boolean>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Export presets
// ─────────────────────────────────────────────────────────────────────────────

export interface ExportPreset {
  id: UUID;
  name: string;
  format: "mp4" | "webm" | "mov" | "gif" | "mp3" | "wav";
  /** "1080p" | "2K" | "4K" | "source" | "custom". Plan-gated at export time. */
  resolution: string;
  customWidth?: number;
  customHeight?: number;
  fps: number;
  videoCodec?: "h264" | "h265" | "vp9" | "prores";
  /** "auto" (CRF) or explicit kbps. */
  videoBitrate?: "auto" | number;
  audioCodec?: "aac" | "mp3" | "opus" | "pcm";
  audioBitrate?: number | "lossless";
  audioChannels?: "stereo" | "mono";
}
