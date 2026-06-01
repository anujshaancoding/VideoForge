// ─────────────────────────────────────────────────────────────────────────────
// Runtime validator — Zod schema mirroring src/types.ts and the §18.4 JSON Schema.
//
// Enforces the load-bearing invariants from §18.3:
//   • ids are UUID v4 (lowercase, version nibble 4, variant nibble 8|9|a|b)
//   • time is non-negative INTEGER milliseconds everywhere
//   • canvas geometry is PERCENT 0–100
//   • discriminated unions on Track.type and OverlayClip.kind
//   • captionTracks max 4
//
// The schema is intentionally `.strict()` on object shapes to mirror the JSON
// Schema's `additionalProperties: false` / `unevaluatedProperties: false`, so
// stray fields are rejected rather than silently passed through.
// ─────────────────────────────────────────────────────────────────────────────

import { z } from "zod";
import type {
  Project,
  Track,
  OverlayClip,
  Clip,
  CaptionTrack,
  Transition,
  ExportPreset,
  Marker,
  Effect,
  Keyframe,
  Collaborator,
  CanvasConfig,
} from "./types.js";

// ── Primitives ───────────────────────────────────────────────────────────────

/** UUID v4 pattern from §18.3 (lowercase). */
export const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const uuid = z.string().regex(UUID_V4_RE, "must be a lowercase UUID v4");

/** Non-negative integer milliseconds. */
const millis = z.number().int("must be an integer (ms)").min(0, "ms must be ≥ 0");

/** Percentage of a canvas dimension, 0–100. */
const percent = z.number().min(0).max(100);

const hexColor = z
  .string()
  .regex(/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, 'must be "#RRGGBB" or "#RRGGBBAA"');

const isoDateTime = z.string().datetime({ offset: false });

const paramBag = z.record(z.union([z.number(), z.string(), z.boolean()]));

// ── Keyframes & effects ──────────────────────────────────────────────────────

export const KeyframeSchema = z
  .object({
    timeMs: millis,
    value: z.union([z.number(), z.string()]),
    easing: z.enum(["linear", "easeIn", "easeOut", "easeInOut", "hold", "bezier"]),
    bezier: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
  })
  .strict();

const keyframeMap = z.record(z.array(KeyframeSchema));

export const EffectSchema = z
  .object({
    id: uuid,
    type: z.string(),
    enabled: z.boolean(),
    params: paramBag,
  })
  .strict();

// ── Clip ─────────────────────────────────────────────────────────────────────

export const ClipSchema = z
  .object({
    id: uuid,
    sourceAssetId: uuid,
    trackId: uuid,
    startOnTimeline: millis,
    endOnTimeline: millis,
    trimIn: millis,
    trimOut: millis,
    speed: z.number().gt(0, "speed must be > 0"),
    gain: z.number().min(0).max(200).optional(),
    effects: z.array(EffectSchema),
    keyframes: keyframeMap,
    linkedClipId: uuid.nullable().optional(),
  })
  .strict();

// ── Track audio mix ────────────────────────────────────────────────────────────

const audioMixShape = {
  volume: z.number().min(0).max(200),
  pan: z.number().min(-100).max(100),
  volumeEnvelope: z.array(
    z.object({ timeMs: millis, value: z.number().min(0).max(200) }).strict(),
  ),
};

const trackBaseShape = {
  id: uuid,
  name: z.string(),
  colour: hexColor,
  height: z.number().gt(0),
  muted: z.boolean(),
  solo: z.boolean(),
  locked: z.boolean(),
};

// ── Overlay clips ──────────────────────────────────────────────────────────────

const animationStep = z.object({ preset: z.string(), durationMs: millis }).strict();

export const OverlayAnimationSchema = z
  .object({
    in: animationStep.optional(),
    out: animationStep.optional(),
    loop: animationStep.nullable().optional(),
  })
  .strict();

const gradientStop = z.object({ offset: z.number().min(0).max(1), color: hexColor }).strict();

export const TextStyleSchema = z
  .object({
    fontFamily: z.string(),
    fontSize: z.number().gt(0),
    fontWeight: z.number(),
    italic: z.boolean().optional(),
    color: hexColor,
    gradient: z
      .object({
        type: z.enum(["linear", "radial"]),
        stops: z.array(gradientStop),
        angle: z.number().optional(),
      })
      .strict()
      .nullable()
      .optional(),
    align: z.enum(["left", "center", "right"]),
    lineHeight: z.number().optional(),
    letterSpacing: z.number().optional(),
    outline: z
      .object({
        width: z.number(),
        color: hexColor,
        position: z.enum(["outside", "inside", "center"]),
      })
      .strict()
      .optional(),
    shadow: z
      .object({
        color: hexColor,
        offsetX: z.number(),
        offsetY: z.number(),
        blur: z.number().min(0),
      })
      .strict()
      .optional(),
    backgroundColor: hexColor.nullable().optional(),
  })
  .strict();

export const ShapeStyleSchema = z
  .object({
    fill: hexColor.nullable().optional(),
    stroke: hexColor.nullable().optional(),
    strokeWidth: z.number().min(0).optional(),
    cornerRadius: z.number().min(0).optional(),
  })
  .strict();

const overlayBaseShape = {
  id: uuid,
  trackId: uuid,
  startOnTimeline: millis,
  endOnTimeline: millis,
  canvasX: percent,
  canvasY: percent,
  width: percent,
  height: percent,
  rotation: z.number(),
  opacity: z.number().min(0).max(100),
  animation: OverlayAnimationSchema,
  keyframes: keyframeMap,
};

const TextOverlaySchema = z
  .object({ ...overlayBaseShape, kind: z.literal("text"), text: z.string(), style: TextStyleSchema })
  .strict();

const ImageOverlaySchema = z
  .object({
    ...overlayBaseShape,
    kind: z.literal("image"),
    sourceAssetId: uuid,
    fit: z.enum(["contain", "cover", "fill", "none"]).optional(),
  })
  .strict();

const ShapeOverlaySchema = z
  .object({
    ...overlayBaseShape,
    kind: z.literal("shape"),
    shape: z.enum(["rectangle", "ellipse", "line", "polygon"]),
    style: ShapeStyleSchema,
  })
  .strict();

const LottieOverlaySchema = z
  .object({
    ...overlayBaseShape,
    kind: z.literal("lottie"),
    sourceAssetId: uuid,
    loop: z.boolean(),
    recolor: z.record(hexColor).optional(),
  })
  .strict();

const StickerOverlaySchema = z
  .object({
    ...overlayBaseShape,
    kind: z.literal("sticker"),
    sourceAssetId: uuid,
    animated: z.boolean(),
  })
  .strict();

export const OverlayClipSchema = z.discriminatedUnion("kind", [
  TextOverlaySchema,
  ImageOverlaySchema,
  ShapeOverlaySchema,
  LottieOverlaySchema,
  StickerOverlaySchema,
]);

// ── Captions ───────────────────────────────────────────────────────────────────

export const CaptionStyleSchema = z
  .object({
    fontFamily: z.string(),
    fontSize: z.number().gt(0),
    color: hexColor,
    backgroundColor: hexColor.nullable().optional(),
    outline: z.object({ width: z.number(), color: hexColor }).strict().optional(),
    position: z.enum(["top", "center", "bottom"]),
    align: z.enum(["left", "center", "right"]),
  })
  .strict();

export const CaptionBlockSchema = z
  .object({
    id: uuid,
    startMs: millis,
    endMs: millis,
    text: z.string(),
    // Per-block overrides: a partial of the track CaptionStyle.
    styleOverride: CaptionStyleSchema.partial().optional(),
    words: z
      .array(z.object({ text: z.string(), startMs: millis, endMs: millis }).strict())
      .optional(),
  })
  .strict();

const CaptionTrackSchema = z
  .object({
    ...trackBaseShape,
    type: z.literal("caption"),
    style: CaptionStyleSchema,
    language: z.string(),
    blocks: z.array(CaptionBlockSchema),
  })
  .strict();

// ── Tracks ───────────────────────────────────────────────────────────────────

const VideoTrackSchema = z
  .object({ ...trackBaseShape, type: z.literal("video"), clips: z.array(ClipSchema) })
  .strict();

const AudioTrackSchema = z
  .object({
    ...trackBaseShape,
    ...audioMixShape,
    type: z.literal("audio"),
    clips: z.array(ClipSchema),
  })
  .strict();

const VoiceOverTrackSchema = z
  .object({
    ...trackBaseShape,
    ...audioMixShape,
    type: z.literal("voiceover"),
    clips: z.array(ClipSchema),
    isDuckingTrigger: z.boolean().optional(),
  })
  .strict();

const OverlayTrackSchema = z
  .object({
    ...trackBaseShape,
    type: z.literal("overlay"),
    clips: z.array(OverlayClipSchema),
  })
  .strict();

export const TrackSchema = z.discriminatedUnion("type", [
  VideoTrackSchema,
  AudioTrackSchema,
  VoiceOverTrackSchema,
  OverlayTrackSchema,
  CaptionTrackSchema,
]);

// ── Markers / transitions / presets / canvas / collaborator ────────────────────

export const MarkerSchema = z
  .object({
    id: uuid,
    timeMs: millis,
    type: z.enum(["chapter", "comment", "todo", "generic"]),
    label: z.string(),
    colour: hexColor,
    note: z.string().optional(),
  })
  .strict();

export const TransitionSchema = z
  .object({
    id: uuid,
    trackId: uuid,
    fromClipId: uuid,
    toClipId: uuid,
    type: z.string(),
    durationMs: millis,
    params: paramBag,
  })
  .strict();

export const ExportPresetSchema = z
  .object({
    id: uuid,
    name: z.string(),
    format: z.enum(["mp4", "webm", "mov", "gif", "mp3", "wav"]),
    resolution: z.string(),
    customWidth: z.number().int().min(1).max(4096).optional(),
    customHeight: z.number().int().min(1).max(4096).optional(),
    fps: z.number().gt(0),
    videoCodec: z.enum(["h264", "h265", "vp9", "prores"]).optional(),
    videoBitrate: z.union([z.literal("auto"), z.number().int().min(1)]).optional(),
    audioCodec: z.enum(["aac", "mp3", "opus", "pcm"]).optional(),
    audioBitrate: z.union([z.number().int().min(1), z.literal("lossless")]).optional(),
    audioChannels: z.enum(["stereo", "mono"]).optional(),
  })
  .strict();

export const CollaboratorSchema = z
  .object({ userId: uuid, role: z.enum(["viewer", "commenter", "editor", "admin"]) })
  .strict();

export const CanvasConfigSchema = z
  .object({
    width: z.number().int().min(1).max(4096),
    height: z.number().int().min(1).max(4096),
    frameRate: z.number().gt(0).max(120),
    aspectRatio: z.string(),
    backgroundColor: hexColor,
  })
  .strict();

// ── Project root ───────────────────────────────────────────────────────────────

export const ProjectSchema = z
  .object({
    schemaVersion: z.number().int().min(1),
    revision: z.number().int().min(0),
    id: uuid,
    title: z.string().min(1),
    description: z.string().optional(),
    canvas: CanvasConfigSchema,
    tracks: z.array(TrackSchema),
    captionTracks: z.array(CaptionTrackSchema).max(4, "max 4 caption tracks (§18.3)"),
    transitions: z.array(TransitionSchema),
    markers: z.array(MarkerSchema),
    exportPresets: z.array(ExportPresetSchema),
    ownerId: uuid,
    workspaceId: uuid,
    collaborators: z.array(CollaboratorSchema),
    isPublic: z.boolean(),
    templateId: uuid.nullable().optional(),
    createdAt: isoDateTime,
    updatedAt: isoDateTime,
  })
  .strict();

/** The exact type produced by parsing with {@link ProjectSchema}. */
export type ProjectInput = z.input<typeof ProjectSchema>;
export type ProjectOutput = z.output<typeof ProjectSchema>;

// ── Compile-time guard: Zod output ≈ hand-written §18 types ──────────────────────
//
// We do NOT annotate the schemas with `z.ZodType<Project>` because, under
// `exactOptionalPropertyTypes`, Zod infers `field?: T | undefined` while the §18
// types use `field?: T` — assignable in one direction only, which the annotation
// rejects. Instead we assert (in the direction that makes `parseProject`'s cast
// sound) that the schema's parsed OUTPUT is structurally a §18 type once optional
// properties are deeply relaxed to `T | undefined` on the target. If a field is
// added/renamed/retyped in either the types or the schema and they drift, this
// block fails to compile.

type Prim = string | number | boolean | bigint | symbol | null | undefined;
/** Recursively widen every property of `T` to also permit `undefined`. */
type DeepUndefinedOptional<T> = T extends Prim
  ? T
  : T extends Array<infer E>
    ? Array<DeepUndefinedOptional<E>>
    : { [K in keyof T]: DeepUndefinedOptional<T[K]> | undefined };

type AssertExtends<_A extends B, B> = true;

// Each line errors at compile time if the schema output diverges from the type.
type _ClipOk = AssertExtends<z.output<typeof ClipSchema>, DeepUndefinedOptional<Clip>>;
type _EffectOk = AssertExtends<z.output<typeof EffectSchema>, DeepUndefinedOptional<Effect>>;
type _KeyframeOk = AssertExtends<z.output<typeof KeyframeSchema>, DeepUndefinedOptional<Keyframe>>;
type _OverlayOk = AssertExtends<z.output<typeof OverlayClipSchema>, DeepUndefinedOptional<OverlayClip>>;
type _TrackOk = AssertExtends<z.output<typeof TrackSchema>, DeepUndefinedOptional<Track>>;
type _CaptionTrackOk = AssertExtends<z.output<typeof CaptionTrackSchema>, DeepUndefinedOptional<CaptionTrack>>;
type _MarkerOk = AssertExtends<z.output<typeof MarkerSchema>, DeepUndefinedOptional<Marker>>;
type _TransitionOk = AssertExtends<z.output<typeof TransitionSchema>, DeepUndefinedOptional<Transition>>;
type _ExportPresetOk = AssertExtends<z.output<typeof ExportPresetSchema>, DeepUndefinedOptional<ExportPreset>>;
type _CollaboratorOk = AssertExtends<z.output<typeof CollaboratorSchema>, DeepUndefinedOptional<Collaborator>>;
type _CanvasOk = AssertExtends<z.output<typeof CanvasConfigSchema>, DeepUndefinedOptional<CanvasConfig>>;
type _ProjectOk = AssertExtends<ProjectOutput, DeepUndefinedOptional<Project>>;

// Reference the guard aliases so `noUnusedLocals` does not flag them.
export type _SchemaTypeGuards = [
  _ClipOk, _EffectOk, _KeyframeOk, _OverlayOk, _TrackOk, _CaptionTrackOk,
  _MarkerOk, _TransitionOk, _ExportPresetOk, _CollaboratorOk, _CanvasOk, _ProjectOk,
];

// ── Public validation API ──────────────────────────────────────────────────────

/**
 * Parse + validate. Throws a {@link z.ZodError} on invalid input.
 *
 * The cast bridges the `exactOptionalPropertyTypes` gap between the inferred and
 * the hand-written types (see the compile-time guard above) — at runtime the
 * parsed value is exactly a valid §18 {@link Project}.
 */
export function parseProject(json: unknown): Project {
  return ProjectSchema.parse(json) as Project;
}

/** Validation result for {@link validateProject}. */
export type ValidateResult =
  | { ok: true; value: Project; errors: null }
  | { ok: false; value: null; errors: z.ZodIssue[] };

/** Non-throwing validation. Returns `{ ok, value|errors }`. */
export function validateProject(json: unknown): ValidateResult {
  const result = ProjectSchema.safeParse(json);
  if (result.success) return { ok: true, value: result.data as Project, errors: null };
  return { ok: false, value: null, errors: result.error.issues };
}
