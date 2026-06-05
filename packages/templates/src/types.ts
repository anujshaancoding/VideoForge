// ─────────────────────────────────────────────────────────────────────────────
// Template slot model — the SIDECAR manifest (Templates_Architecture.md §2.2).
//
// A template is an ordinary, fully-valid `Project` document. The metadata describing
// *which* clips / overlays / caption blocks are user-replaceable lives OUTSIDE the
// document, in a per-template `TemplateManifest` that addresses placeholders by the
// document's OWN element ids. This is load-bearing: `ProjectSchema` is `.strict()`,
// so an inline `slot` field on a Clip/Overlay would make `validateProject()` reject
// the document. The sidecar keeps the document pristine and the validator green, for
// both the template doc and the project a user derives from it.
//
// These types intentionally do NOT live in @videoforge/project-schema and are never
// persisted into a project document — they are consumed entirely on the client during
// the create-from-template + slot-fill + export-prune flow.
// ─────────────────────────────────────────────────────────────────────────────

import type { Project } from "@videoforge/project-schema";

/** What a slot accepts / how it is filled. */
export type SlotKind = "image" | "video" | "text";

/**
 * The element a slot maps to, addressed by the Project document's OWN ids:
 *   • media slots (image|video) → a Clip.id on a media track (with its trackId)
 *   • text slots                → a TextOverlay.id (overlay) OR a CaptionBlock.id
 * Exactly one target is set. These ids are rewritten in lock-step when the template
 * is cloned into a new project (cloneTemplateToProject) so the manifest stays valid
 * against the derived document.
 */
export type SlotTarget =
  | { type: "clip"; clipId: string; trackId: string }
  | { type: "overlay"; overlayId: string }
  | { type: "captionBlock"; captionTrackId: string; blockId: string };

/**
 * The placeholder shown until a slot is filled.
 *   • media → the bundled placeholder/sentinel assetId (mirrors the value already on
 *     the target element, so the UI can detect "unfilled" structurally).
 *   • text  → the default copy string (mirrors TextOverlay.text / CaptionBlock.text).
 */
export type SlotPlaceholder =
  | { kind: "asset"; assetId: string }
  | { kind: "text"; text: string };

/** One user-replaceable region of a template, addressed by an existing element id. */
export interface TemplateSlot {
  /** Stable slot id, unique within the template (e.g. "photo-1", "headline"). */
  id: string;
  kind: SlotKind;
  /** Human label shown in the slot-fill UI ("Photo 1", "Headline", "CTA line"). */
  label: string;
  /** 1-based ordinal within the template's slots of the SAME media/text grouping, for the "N of M" badge. */
  index: number;
  /** Total slots in the "N of M" badge grouping (media slots, or text slots). */
  total: number;
  /** The element this slot maps to, by the document's own ids. */
  target: SlotTarget;
  /** Placeholder shown until filled. */
  placeholder: SlotPlaceholder;
  /**
   * When true, an unfilled slot is PRUNED from the document before export
   * (Templates_Architecture §5). When false, the placeholder asset/text is KEPT
   * (intentional template furniture whose placeholder is a permanent prod-seeded asset).
   */
  optional: boolean;
}

/** Card metadata for the gallery + the slot list. The document is co-located on `Template`. */
export interface TemplateManifest {
  /** Stable template id (UUID v4) — also stamped onto Project.templateId on apply. */
  id: string;
  name: string;
  description: string;
  /** Derived from the document — duplicated for cheap gallery rendering. */
  durationMs: number;
  /** "9:16" | "16:9" | "1:1" | … — all 5 launch templates ship 9:16. */
  aspectRatio: string;
  /** One-line duration+slot summary for the card meta row (e.g. "35s · 4 photos"). */
  meta: string;
  /** Feature tags for the gallery ("ken-burns", "captions", "text", "xfade"). */
  tags: string[];
  slots: TemplateSlot[];
}

/** A template = its manifest + its valid Project document, co-located + co-versioned. */
export interface Template {
  manifest: TemplateManifest;
  /** MUST pass validateProject() — asserted in CI (__tests__/templates.valid.test.ts). */
  document: Project;
}
