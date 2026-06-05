// ─────────────────────────────────────────────────────────────────────────────
// Template session store — holds the (rewritten) TemplateManifest for the project
// currently open in the editor, so the slot-fill panel + export prune can address
// the document's elements by id.
//
// The manifest is NOT persisted into the project document (Templates_Architecture
// §2.4); it lives in client UI state. Two ways it gets populated:
//   1. Apply flow → setManifestForProject(projectId, rewrittenManifest) right after
//      cloneTemplateToProject (the common, in-session path).
//   2. Reload (cache miss) → reconstructManifest(project) rebuilds it structurally
//      from the source template (matched by Project.templateId), remapping slot
//      targets onto the loaded document's ids by element ORDER. The clone preserves
//      track/clip/overlay/caption order, so positional remap is exact.
// ─────────────────────────────────────────────────────────────────────────────

import { create } from "zustand";
import type { Project } from "@videoforge/project-schema";
import { getTemplate, type TemplateManifest, type TemplateSlot } from "@videoforge/templates";

interface TemplateState {
  /** projectId → rewritten manifest for the open template-derived project. */
  manifestByProjectId: Record<string, TemplateManifest>;
  setManifestForProject: (projectId: string, manifest: TemplateManifest) => void;
  clearManifestForProject: (projectId: string) => void;
}

export const useTemplateStore = create<TemplateState>((set) => ({
  manifestByProjectId: {},
  setManifestForProject: (projectId, manifest) =>
    set((s) => ({ manifestByProjectId: { ...s.manifestByProjectId, [projectId]: manifest } })),
  clearManifestForProject: (projectId) =>
    set((s) => {
      const next = { ...s.manifestByProjectId };
      delete next[projectId];
      return { manifestByProjectId: next };
    }),
}));

/**
 * Resolve the manifest for a loaded project: the cached rewritten manifest if present,
 * otherwise a structural reconstruction from the source template (reload path), or
 * null if the project is not template-derived / its template is unknown.
 */
export function resolveManifest(project: Project): TemplateManifest | null {
  const cached = useTemplateStore.getState().manifestByProjectId[project.id];
  if (cached) return cached;
  const reconstructed = reconstructManifest(project);
  if (reconstructed) {
    useTemplateStore.getState().setManifestForProject(project.id, reconstructed);
  }
  return reconstructed;
}

/**
 * Rebuild the rewritten manifest for a template-derived `project` by matching the
 * source template's slots onto the loaded document's elements BY ORDER (the clone
 * preserves order). Returns null when the project has no templateId or the template
 * isn't bundled. Used only on the reload cache-miss path.
 */
export function reconstructManifest(project: Project): TemplateManifest | null {
  const templateId = project.templateId ?? null;
  if (!templateId) return null;
  const template = getTemplate(templateId);
  if (!template) return null;
  const src = template.manifest;

  // Build ordered id lists for the SOURCE document and the LOADED document, per element
  // class, so we can map source ids → loaded ids positionally.
  const srcDoc = template.document;

  const orderedClipIds = (p: Project): string[] => {
    const ids: string[] = [];
    for (const t of p.tracks) {
      if (t.type === "video" || t.type === "audio" || t.type === "voiceover") {
        for (const c of t.clips) ids.push(c.id);
      }
    }
    return ids;
  };
  const orderedClipTrackIds = (p: Project): string[] => {
    const ids: string[] = [];
    for (const t of p.tracks) {
      if (t.type === "video" || t.type === "audio" || t.type === "voiceover") {
        for (const _ of t.clips) ids.push(t.id);
      }
    }
    return ids;
  };
  const orderedOverlayIds = (p: Project): string[] => {
    const ids: string[] = [];
    for (const t of p.tracks) if (t.type === "overlay") for (const ov of t.clips) ids.push(ov.id);
    return ids;
  };
  const orderedCaptionTrackIds = (p: Project): string[] => p.captionTracks.map((c) => c.id);
  const orderedCaptionBlockIds = (p: Project): Array<{ trackId: string; blockId: string }> => {
    const out: Array<{ trackId: string; blockId: string }> = [];
    for (const ct of p.captionTracks) for (const b of ct.blocks) out.push({ trackId: ct.id, blockId: b.id });
    return out;
  };

  const srcClips = orderedClipIds(srcDoc);
  const dstClips = orderedClipIds(project);
  const srcClipTracks = orderedClipTrackIds(srcDoc);
  const dstClipTracks = orderedClipTrackIds(project);
  const srcOverlays = orderedOverlayIds(srcDoc);
  const dstOverlays = orderedOverlayIds(project);
  const srcCapTracks = orderedCaptionTrackIds(srcDoc);
  const dstCapTracks = orderedCaptionTrackIds(project);
  const srcCapBlocks = orderedCaptionBlockIds(srcDoc);
  const dstCapBlocks = orderedCaptionBlockIds(project);

  // If shapes diverge (user added/removed elements before reload), bail rather than mis-map.
  if (
    srcClips.length !== dstClips.length ||
    srcOverlays.length !== dstOverlays.length ||
    srcCapBlocks.length !== dstCapBlocks.length
  ) {
    return null;
  }

  const clipMap = new Map(srcClips.map((id, i) => [id, dstClips[i]!] as const));
  const clipTrackMap = new Map(srcClipTracks.map((id, i) => [id, dstClipTracks[i]!] as const));
  const overlayMap = new Map(srcOverlays.map((id, i) => [id, dstOverlays[i]!] as const));
  const capTrackMap = new Map(srcCapTracks.map((id, i) => [id, dstCapTracks[i]!] as const));
  const capBlockMap = new Map(srcCapBlocks.map((b, i) => [b.blockId, dstCapBlocks[i]!.blockId] as const));

  const slots: TemplateSlot[] = src.slots.map((slot): TemplateSlot => {
    switch (slot.target.type) {
      case "clip":
        return {
          ...slot,
          target: {
            type: "clip",
            clipId: clipMap.get(slot.target.clipId) ?? slot.target.clipId,
            trackId: clipTrackMap.get(slot.target.trackId) ?? slot.target.trackId,
          },
        };
      case "overlay":
        return {
          ...slot,
          target: { type: "overlay", overlayId: overlayMap.get(slot.target.overlayId) ?? slot.target.overlayId },
        };
      case "captionBlock":
        return {
          ...slot,
          target: {
            type: "captionBlock",
            captionTrackId: capTrackMap.get(slot.target.captionTrackId) ?? slot.target.captionTrackId,
            blockId: capBlockMap.get(slot.target.blockId) ?? slot.target.blockId,
          },
        };
    }
  });

  return { ...src, slots };
}
