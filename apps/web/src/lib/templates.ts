// ─────────────────────────────────────────────────────────────────────────────
// Create-from-template client orchestration (Templates_Architecture §4-5).
//
// Two pure helpers + a derived-state type:
//   • cloneTemplateToProject() — deep-clone a template's document, re-stamp identity,
//     regenerate EVERY element id, rewrite ALL cross-references AND the manifest's
//     slot targets in lock-step, set Project.templateId. The result is an ordinary
//     Project that passes validateProject() and is persisted through the existing
//     POST /projects path.
//   • isSlotFilled() / unfilledSlotCount() — the STRUCTURAL "filled" check
//     (clip.sourceAssetId !== placeholder.assetId; edited text !== placeholder).
//   • pruneUnfilledSlots() — at export, on a CLONE of the doc, drop unfilled optional
//     placeholder clips/overlays/caption-blocks (+ their transitions) so the graph is
//     always valid (the render worker hard-fails on assets with no media).
//
// This package is consumed entirely on the client; manifests are never persisted.
// ─────────────────────────────────────────────────────────────────────────────

import { v4 as uuidv4 } from "uuid";
import {
  validateProject,
  type CaptionBlock,
  type Clip,
  type OverlayClip,
  type Project,
  type Transition,
} from "@videoforge/project-schema";
import type { Template, TemplateManifest, TemplateSlot } from "@videoforge/templates";

export interface CloneOptions {
  /** Project title; falls back to the template name. */
  title?: string;
  /** Owning user/workspace id for the new project (self). */
  ownerId: string;
  workspaceId: string;
}

export interface ClonedTemplate {
  /** A fresh, valid Project derived from the template document. */
  document: Project;
  /** The manifest with its slot target ids rewritten to the cloned document's ids. */
  manifest: TemplateManifest;
}

/** Generate a fresh lowercase UUID v4 (delegates to the uuid lib). */
function freshId(): string {
  return uuidv4();
}

/**
 * Deep-clone a template into a brand-new Project: fresh identity, every element id
 * regenerated, all cross-references + manifest slot targets rewritten in lock-step.
 * Throws if the result somehow fails validation (belt-and-suspenders, mirrors the
 * server validator). See Templates_Architecture §4.2 for the exhaustive cross-ref list.
 */
export function cloneTemplateToProject(template: Template, opts: CloneOptions): ClonedTemplate {
  // 1. Deep-clone so the package constant is never mutated.
  const doc = structuredClone(template.document) as Project;

  // 3. Build an old→new id map while regenerating EVERY element id.
  const idMap = new Map<string, string>();
  const remap = (oldId: string): string => {
    let next = idMap.get(oldId);
    if (!next) {
      next = freshId();
      idMap.set(oldId, next);
    }
    return next;
  };

  // Tracks + their clips / overlays / caption blocks + keyframe ids.
  for (const track of doc.tracks) {
    const newTrackId = remap(track.id);
    track.id = newTrackId;
    // Normalize hidden to boolean (default false) so older template docs / clones
    // always satisfy the strict ProjectSchema (TrackBase.hidden: boolean).
    (track as any).hidden = typeof (track as any).hidden === "boolean" ? (track as any).hidden : false;
    if (track.type === "video" || track.type === "audio" || track.type === "voiceover") {
      for (const clip of track.clips) {
        clip.id = remap(clip.id);
        clip.trackId = newTrackId;
        regenKeyframeIds(clip.keyframes, freshId);
        for (const eff of clip.effects) eff.id = remap(eff.id);
      }
    } else if (track.type === "overlay") {
      for (const ov of track.clips) {
        ov.id = remap(ov.id);
        ov.trackId = newTrackId;
        regenKeyframeIds(ov.keyframes, freshId);
      }
    }
  }
  for (const ct of doc.captionTracks) {
    const newCtId = remap(ct.id);
    ct.id = newCtId;
    (ct as any).hidden = typeof (ct as any).hidden === "boolean" ? (ct as any).hidden : false;
    for (const b of ct.blocks) b.id = remap(b.id);
  }
  for (const m of doc.markers) m.id = remap(m.id);

  // 4. Rewrite every cross-reference through the id map (second pass, after all
  //    primary ids exist in the map).
  for (const track of doc.tracks) {
    if (track.type === "video" || track.type === "audio" || track.type === "voiceover") {
      for (const clip of track.clips) {
        if (clip.linkedClipId) clip.linkedClipId = idMap.get(clip.linkedClipId) ?? clip.linkedClipId;
      }
    }
  }
  for (const tr of doc.transitions) {
    tr.id = remap(tr.id);
    tr.trackId = idMap.get(tr.trackId) ?? tr.trackId;
    tr.fromClipId = idMap.get(tr.fromClipId) ?? tr.fromClipId;
    tr.toClipId = idMap.get(tr.toClipId) ?? tr.toClipId;
  }

  // 2. Re-stamp project identity (after element remap so we control the project id too).
  const now = new Date().toISOString();
  doc.id = freshId();
  doc.title = (opts.title ?? "").trim() || template.manifest.name;
  doc.ownerId = opts.ownerId;
  doc.workspaceId = opts.workspaceId;
  doc.revision = 1;
  doc.collaborators = [{ userId: opts.ownerId, role: "admin" }];
  doc.isPublic = false;
  doc.templateId = template.manifest.id; // provenance (C4)
  doc.createdAt = now;
  doc.updatedAt = now;

  // 5. Rewrite the manifest's slot targets through the same id map.
  const manifest = rewriteManifestTargets(template.manifest, idMap);

  // 6. Validate before persist (mirrors the server validator).
  const result = validateProject(doc);
  if (!result.ok) {
    throw new Error(
      `cloneTemplateToProject produced an invalid document: ${JSON.stringify(
        result.errors?.slice(0, 3),
      )}`,
    );
  }

  return { document: doc, manifest };
}

/** Regenerate optional keyframe ids in place (only where one was present). */
function regenKeyframeIds(
  keyframes: Record<string, Array<{ id?: string }>>,
  gen: () => string,
): void {
  for (const prop of Object.keys(keyframes)) {
    for (const kf of keyframes[prop] ?? []) {
      if (kf.id !== undefined) kf.id = gen();
    }
  }
}

/** Return a copy of the manifest with all slot target ids rewritten via the id map. */
function rewriteManifestTargets(
  manifest: TemplateManifest,
  idMap: Map<string, string>,
): TemplateManifest {
  const mapId = (id: string): string => idMap.get(id) ?? id;
  return {
    ...manifest,
    slots: manifest.slots.map((slot): TemplateSlot => {
      switch (slot.target.type) {
        case "clip":
          return {
            ...slot,
            target: { type: "clip", clipId: mapId(slot.target.clipId), trackId: mapId(slot.target.trackId) },
          };
        case "overlay":
          return { ...slot, target: { type: "overlay", overlayId: mapId(slot.target.overlayId) } };
        case "captionBlock":
          return {
            ...slot,
            target: {
              type: "captionBlock",
              captionTrackId: mapId(slot.target.captionTrackId),
              blockId: mapId(slot.target.blockId),
            },
          };
      }
    }),
  };
}

// ── Structural "filled" detection (Templates_Architecture §5.3) ──────────────────

function findClipById(p: Project, trackId: string, clipId: string): Clip | undefined {
  const track = p.tracks.find((t) => t.id === trackId);
  if (!track || (track.type !== "video" && track.type !== "audio" && track.type !== "voiceover")) {
    // Fall back to scanning media tracks if the trackId drifted.
    for (const t of p.tracks) {
      if (t.type === "video" || t.type === "audio" || t.type === "voiceover") {
        const c = t.clips.find((x) => x.id === clipId);
        if (c) return c;
      }
    }
    return undefined;
  }
  return track.clips.find((c) => c.id === clipId);
}

function findOverlayById(p: Project, overlayId: string): OverlayClip | undefined {
  for (const t of p.tracks) {
    if (t.type !== "overlay") continue;
    const ov = t.clips.find((c) => c.id === overlayId);
    if (ov) return ov;
  }
  return undefined;
}

function findCaptionBlockById(p: Project, trackId: string, blockId: string): CaptionBlock | undefined {
  const ct = p.captionTracks.find((c) => c.id === trackId);
  return ct?.blocks.find((b) => b.id === blockId);
}

/**
 * True when the user has filled this slot — a structural check that survives reloads
 * without UI session state:
 *   • media: the clip's asset id differs from the placeholder asset id.
 *   • text : the overlay/caption text differs from the placeholder text and is non-empty.
 * A slot whose target element no longer exists counts as filled (nothing to prune).
 */
export function isSlotFilled(project: Project, slot: TemplateSlot): boolean {
  switch (slot.target.type) {
    case "clip": {
      const clip = findClipById(project, slot.target.trackId, slot.target.clipId);
      if (!clip) return true;
      if (slot.placeholder.kind !== "asset") return true;
      return clip.sourceAssetId !== slot.placeholder.assetId;
    }
    case "overlay": {
      const ov = findOverlayById(project, slot.target.overlayId);
      if (!ov || ov.kind !== "text") return true;
      if (slot.placeholder.kind !== "text") return true;
      const text = ov.text.trim();
      return text.length > 0 && text !== slot.placeholder.text.trim();
    }
    case "captionBlock": {
      const block = findCaptionBlockById(project, slot.target.captionTrackId, slot.target.blockId);
      if (!block) return true;
      if (slot.placeholder.kind !== "text") return true;
      const text = block.text.trim();
      return text.length > 0 && text !== slot.placeholder.text.trim();
    }
  }
}

/** The list of unfilled MEDIA slots (used for the export warning copy). */
export function unfilledMediaSlots(project: Project, manifest: TemplateManifest): TemplateSlot[] {
  return manifest.slots.filter((s) => s.kind !== "text" && !isSlotFilled(project, s));
}

/** Count of unfilled media slots (the headline number in the export warning). */
export function unfilledMediaSlotCount(project: Project, manifest: TemplateManifest): number {
  return unfilledMediaSlots(project, manifest).length;
}

// ── Export-time prune (Templates_Architecture §5.3) ──────────────────────────────

/**
 * Return a CLONE of `project` with every unfilled, `optional` placeholder slot removed
 * so the exported graph references only real, resolvable media:
 *   • media slot → remove the target Clip from its track + any Transition referencing it.
 *   • text slot  → remove the target TextOverlay / CaptionBlock.
 * `optional:false` slots are KEPT (intentional, prod-seeded furniture). The result is
 * re-validated; the saved project is untouched (the user can still fill the slots later).
 */
export function pruneUnfilledSlots(project: Project, manifest: TemplateManifest): Project {
  const pruned = structuredClone(project) as Project;

  // Normalize hidden: boolean on every track (default false). This makes prune
  // robust for legacy documents (pre-hidden schema, old saves, direct clones)
  // so validateProject never sees undefined for a required boolean field.
  for (const track of pruned.tracks) {
    (track as any).hidden = typeof (track as any).hidden === "boolean" ? (track as any).hidden : false;
  }
  for (const ct of pruned.captionTracks) {
    (ct as any).hidden = typeof (ct as any).hidden === "boolean" ? (ct as any).hidden : false;
  }

  const clipIdsToDrop = new Set<string>();
  const overlayIdsToDrop = new Set<string>();
  const captionToDrop = new Map<string, Set<string>>(); // captionTrackId → blockIds

  for (const slot of manifest.slots) {
    if (!slot.optional) continue;
    if (isSlotFilled(pruned, slot)) continue;
    switch (slot.target.type) {
      case "clip":
        clipIdsToDrop.add(slot.target.clipId);
        break;
      case "overlay":
        overlayIdsToDrop.add(slot.target.overlayId);
        break;
      case "captionBlock": {
        const set = captionToDrop.get(slot.target.captionTrackId) ?? new Set<string>();
        set.add(slot.target.blockId);
        captionToDrop.set(slot.target.captionTrackId, set);
        break;
      }
    }
  }

  // Remove dropped clips + overlays from their tracks.
  for (const track of pruned.tracks) {
    if (track.type === "video" || track.type === "audio" || track.type === "voiceover") {
      track.clips = track.clips.filter((c) => !clipIdsToDrop.has(c.id));
    } else if (track.type === "overlay") {
      track.clips = track.clips.filter((c) => !overlayIdsToDrop.has(c.id));
    }
  }

  // Drop transitions referencing any removed clip (mirrors editorStore.deleteSelected).
  pruned.transitions = pruned.transitions.filter(
    (t: Transition) => !clipIdsToDrop.has(t.fromClipId) && !clipIdsToDrop.has(t.toClipId),
  );

  // Remove dropped caption blocks.
  for (const [ctId, blockIds] of captionToDrop) {
    const ct = pruned.captionTracks.find((c) => c.id === ctId);
    if (ct) ct.blocks = ct.blocks.filter((b) => !blockIds.has(b.id));
  }

  // Re-validate the pruned subset before handing it to the export path.
  const result = validateProject(pruned);
  if (!result.ok) {
    throw new Error(
      `pruneUnfilledSlots produced an invalid document: ${JSON.stringify(result.errors?.slice(0, 3))}`,
    );
  }
  return pruned;
}

/** True when an asset id is the placeholder of any UNFILLED media slot in the manifest. */
export function isPlaceholderClip(project: Project, manifest: TemplateManifest, clipId: string): boolean {
  return manifest.slots.some(
    (s) => s.target.type === "clip" && s.target.clipId === clipId && !isSlotFilled(project, s),
  );
}

// ── Export snapshot builder (single source of truth for preflight + POST) ─────────

/**
 * The §18 `TextStyle` keys the strict validator accepts (mirror of `TextStyleSchema`
 * in `packages/project-schema`). Anything else on a text overlay's `style` — e.g. the
 * legacy `fontStyle` / `textDecoration` keys written by older builds of the Italic /
 * Underline controls — makes the WHOLE document fail §18 validation at export with
 * `Unrecognized key(s) in object`. We strip unknown keys so a project saved before
 * that bug was fixed can still export. New writes only ever use the fields below.
 */
const ALLOWED_TEXT_STYLE_KEYS = new Set<string>([
  "fontFamily", "fontSize", "fontWeight", "italic", "color", "gradient",
  "align", "lineHeight", "letterSpacing", "outline", "shadow", "backgroundColor",
]);

/** Remove non-§18 keys from every text overlay's `style` (in place). */
function stripUnknownTextStyleKeys(doc: Project): void {
  for (const track of doc.tracks) {
    if (track.type !== "overlay") continue;
    for (const ov of track.clips) {
      if (ov.kind !== "text") continue;
      const style = ov.style as unknown as Record<string, unknown>;
      if (!style || typeof style !== "object") continue;
      for (const key of Object.keys(style)) {
        if (!ALLOWED_TEXT_STYLE_KEYS.has(key)) delete style[key];
      }
    }
  }
}

/**
 * Build the EXACT §18 snapshot the render worker will receive — the one place that
 * decides "what we validate is what we send", so the export preflight and the export
 * POST can never disagree. Pure: takes a clone, never mutates the live project.
 *
 *   1. strip legacy unknown style keys (so old corrupted docs validate),
 *   2. prune unfilled OPTIONAL template slots (placeholder media the user didn't fill),
 *   3. drop clips whose `sourceAssetId` has no real backing asset for this user
 *      (template demo/placeholder assets the worker can't fetch), and
 *   4. drop transitions left dangling by 2–3.
 *
 * @param realAssetIds ids of assets the user actually owns (asset registry keys).
 */
export function buildExportDocument(
  project: Project,
  manifest: TemplateManifest | null,
  realAssetIds: Set<string>,
): Project {
  // Strip BEFORE prune: pruneUnfilledSlots re-validates internally and would throw on
  // a doc that still carries legacy bad style keys.
  const stripped = structuredClone(project) as Project;
  stripUnknownTextStyleKeys(stripped);

  let document: Project = manifest ? pruneUnfilledSlots(stripped, manifest) : stripped;

  const sanitizedTracks = document.tracks.map((t) => {
    if (t.type === "video" || t.type === "audio" || t.type === "voiceover") {
      return { ...t, clips: t.clips.filter((c) => !c.sourceAssetId || realAssetIds.has(c.sourceAssetId)) };
    }
    return t;
  });
  const keptClipIds = new Set<string>();
  for (const t of sanitizedTracks) {
    if (t.type === "video" || t.type === "audio" || t.type === "voiceover") {
      for (const c of t.clips) keptClipIds.add(c.id);
    }
  }
  const sanitizedTransitions = document.transitions.filter(
    (tr) => keptClipIds.has(tr.fromClipId) && keptClipIds.has(tr.toClipId),
  );

  return { ...document, tracks: sanitizedTracks, transitions: sanitizedTransitions };
}
