// ─────────────────────────────────────────────────────────────────────────────
// Script Studio — the SIDECAR manifest (modelled on @videoforge/templates'
// TemplateManifest; Script_Studio_Architecture §2.4).
//
// The assembled document is an ordinary, fully-valid §18 `Project`. ProjectSchema
// is `.strict()`, so any "this came from a script" metadata would be REJECTED if
// embedded inline. Exactly as Templates keeps `slot` out of the `Clip`, Script
// Studio keeps all provenance OUTSIDE the document, in this `ScriptManifest`. The
// manifest addresses generated elements by the document's OWN ids, so the UI can
// map a timeline element back to its source segment (re-roll is a v2 affordance).
//
// These types intentionally do NOT live in @videoforge/project-schema and are
// never persisted into the project document.
// ─────────────────────────────────────────────────────────────────────────────

import type { Project } from "@videoforge/project-schema";

/**
 * One assembled segment, mapping a source `ScriptSegment` to the generated
 * elements it produced (all addressed by the document's own ids) and to the
 * caller-supplied timing/asset inputs it was built from. The VO asset itself is
 * NOT generated in P0 — `voiceAssetId`/`durationMs` are inputs (P1 will inject
 * the real TTS asset). `voiceClipId`, `textOverlayId`, `captionBlockId` resolve
 * against the emitted `Project`.
 */
export interface ScriptSegmentMapping {
  /** Source segment ordinal (matches ScriptSegment.index). */
  segmentIndex: number;
  /** Source paragraph ordinal. */
  paragraphIndex: number;
  /** The spoken text (mirrors the segment + the VO clip / caption block text). */
  text: string;
  /** [startMs, endMs] window on the timeline this segment occupies. */
  startMs: number;
  endMs: number;
  /** Caller-supplied VO asset id this segment's voice clip references (P1 injects the real asset). */
  voiceAssetId: string;
  /** Caller-supplied probed duration (ms) of the VO for this segment. */
  durationMs: number;
  /** The voice-over Clip.id emitted on the voiceover track. */
  voiceClipId: string;
  /** The TextOverlay.id emitted on the overlay track (the text card), or null if none. */
  textOverlayId: string | null;
  /** The CaptionBlock.id emitted on the caption track. */
  captionBlockId: string;
}

/**
 * The style applied to every text card, captured for the sidecar so the UI can
 * surface / re-roll scene styling without re-reading the document. This is the
 * EXPORT-RENDERED subset only — see assemble.ts EXPORTABLE_TEXT_STYLE_KEYS and the
 * AC-6 guard. No gradient/shadow/letterSpacing/backgroundColor/rotation/animation.
 */
export interface ScriptSceneStyle {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  color: string;
  align: "left" | "center" | "right";
  outline: { width: number; color: string; position: "outside" | "inside" | "center" };
}

/** Sidecar metadata for a Script-Studio-assembled project. Never persisted inline. */
export interface ScriptManifest {
  /** Stable manifest id (UUID v4), derived from the assembly seed. */
  id: string;
  /** Schema/shape version of the manifest itself (independent of Project.schemaVersion). */
  manifestVersion: number;
  /** The id of the document this manifest describes. */
  projectId: string;
  /** Caller-supplied voice id (e.g. a Piper voice key). Opaque string in P0. */
  voiceId: string;
  /** The scene style every text card was authored with. */
  sceneStyle: ScriptSceneStyle;
  /** Per-segment provenance + element id map, in segment order. */
  segments: ScriptSegmentMapping[];
  /**
   * Attribution placeholder for v2 stock media (Pexels/Pixabay). Empty in P0
   * (text-cards only, no stock). Reserved so the shape is stable for v2.
   */
  attributions: ScriptAttribution[];
}

/** v2 stock attribution record (reserved; always empty in P0). */
export interface ScriptAttribution {
  /** The asset id the attribution applies to. */
  assetId: string;
  /** Provider, e.g. "pexels" | "pixabay". */
  provider: string;
  /** Author/creator name. */
  author: string;
  /** Source URL. */
  url: string;
}

/** The assembler's return shape: a clean §18 document + its sidecar. */
export interface AssembledScript {
  /** MUST pass validateProject() — asserted in CI. */
  document: Project;
  manifest: ScriptManifest;
}
