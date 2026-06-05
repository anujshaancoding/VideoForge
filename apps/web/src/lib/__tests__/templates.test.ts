import { describe, expect, it } from "vitest";
import { validateProject, type Clip, type Project, type Track } from "@videoforge/project-schema";
import {
  TEMPLATES,
  getTemplate,
  happyBirthday,
  photoMemories,
  simplePromo,
  type TemplateSlot,
} from "@videoforge/templates";
import {
  cloneTemplateToProject,
  isSlotFilled,
  pruneUnfilledSlots,
  unfilledMediaSlotCount,
} from "../templates.js";

const OWNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WS = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

// Collect every id used in a project (clips, tracks, overlays, captions, transitions).
function collectIds(p: Project): Set<string> {
  const ids = new Set<string>();
  for (const t of p.tracks) {
    ids.add(t.id);
    if (t.type === "video" || t.type === "audio" || t.type === "voiceover") {
      for (const c of t.clips) ids.add(c.id);
    } else if (t.type === "overlay") {
      for (const ov of t.clips) ids.add(ov.id);
    }
  }
  for (const ct of p.captionTracks) {
    ids.add(ct.id);
    for (const b of ct.blocks) ids.add(b.id);
  }
  for (const tr of p.transitions) ids.add(tr.id);
  return ids;
}

const mediaTracks = (p: Project) =>
  p.tracks.filter((t): t is Extract<Track, { clips: Clip[] }> =>
    t.type === "video" || t.type === "audio" || t.type === "voiceover",
  );

describe("cloneTemplateToProject", () => {
  it.each(TEMPLATES.map((t) => [t.manifest.name, t.manifest.id] as const))(
    "%s clones to a valid Project with fresh identity",
    (_name, id) => {
      const template = getTemplate(id)!;
      const { document } = cloneTemplateToProject(template, { ownerId: OWNER, workspaceId: WS });
      expect(validateProject(document).ok).toBe(true);
      expect(document.id).not.toBe(template.document.id);
      expect(document.ownerId).toBe(OWNER);
      expect(document.workspaceId).toBe(WS);
      expect(document.revision).toBe(1);
      expect(document.templateId).toBe(template.manifest.id); // provenance set
      expect(document.collaborators).toEqual([{ userId: OWNER, role: "admin" }]);
    },
  );

  it("regenerates EVERY element id (no id is shared with the source document)", () => {
    const src = happyBirthday;
    const { document } = cloneTemplateToProject(src, { ownerId: OWNER, workspaceId: WS });
    const srcIds = collectIds(src.document);
    const dstIds = collectIds(document);
    for (const dstId of dstIds) {
      expect(srcIds.has(dstId), `cloned id ${dstId} collides with the template`).toBe(false);
    }
    // Same number of elements survived the clone.
    expect(dstIds.size).toBe(srcIds.size);
  });

  it("rewrites clip.trackId, transitions, and linkedClipId to the NEW ids (no dangling refs)", () => {
    const { document } = cloneTemplateToProject(simplePromo, { ownerId: OWNER, workspaceId: WS });
    const trackIds = new Set(document.tracks.map((t) => t.id));
    const clipIds = new Set(mediaTracks(document).flatMap((t) => t.clips.map((c) => c.id)));

    // Every clip's denormalised trackId points at a real track in THIS document.
    for (const track of mediaTracks(document)) {
      for (const clip of track.clips) {
        expect(trackIds.has(clip.trackId)).toBe(true);
        expect(clip.trackId).toBe(track.id);
        if (clip.linkedClipId) expect(clipIds.has(clip.linkedClipId)).toBe(true);
      }
    }
    // Every transition references real clips + a real track in THIS document.
    for (const tr of document.transitions) {
      expect(trackIds.has(tr.trackId)).toBe(true);
      expect(clipIds.has(tr.fromClipId)).toBe(true);
      expect(clipIds.has(tr.toClipId)).toBe(true);
    }
  });

  it("rewrites the manifest slot targets in lock-step (every target resolves in the cloned doc)", () => {
    const { document, manifest } = cloneTemplateToProject(photoMemories, { ownerId: OWNER, workspaceId: WS });
    for (const slot of manifest.slots) {
      switch (slot.target.type) {
        case "clip": {
          const target = slot.target;
          const clip = mediaTracks(document).flatMap((t) => t.clips).find((c) => c.id === target.clipId);
          expect(clip, slot.id).toBeDefined();
          break;
        }
        case "overlay": {
          const ov = document.tracks
            .filter((t) => t.type === "overlay")
            .flatMap((t) => (t.type === "overlay" ? t.clips : []))
            .find((c) => c.id === (slot.target.type === "overlay" ? slot.target.overlayId : ""));
          expect(ov, slot.id).toBeDefined();
          break;
        }
        case "captionBlock": {
          const ct = document.captionTracks.find((c) => c.id === (slot.target.type === "captionBlock" ? slot.target.captionTrackId : ""));
          const block = ct?.blocks.find((b) => b.id === (slot.target.type === "captionBlock" ? slot.target.blockId : ""));
          expect(block, slot.id).toBeDefined();
          break;
        }
      }
    }
  });

  it("does not mutate the source template constant", () => {
    const beforeId = happyBirthday.document.id;
    const beforeFirstClipId = (happyBirthday.document.tracks[0] as Extract<Track, { clips: Clip[] }>).clips[0]!.id;
    cloneTemplateToProject(happyBirthday, { ownerId: OWNER, workspaceId: WS });
    expect(happyBirthday.document.id).toBe(beforeId);
    expect((happyBirthday.document.tracks[0] as Extract<Track, { clips: Clip[] }>).clips[0]!.id).toBe(beforeFirstClipId);
    expect(happyBirthday.document.templateId ?? null).toBeNull(); // still a template, not derived
  });
});

describe("isSlotFilled (structural)", () => {
  it("an untouched media slot reads as unfilled; a swapped asset reads as filled", () => {
    const { document, manifest } = cloneTemplateToProject(happyBirthday, { ownerId: OWNER, workspaceId: WS });
    const mediaSlot = manifest.slots.find((s): s is TemplateSlot => s.target.type === "clip")!;
    expect(isSlotFilled(document, mediaSlot)).toBe(false);

    // Swap the clip's asset → now filled.
    const next = structuredClone(document) as Project;
    if (mediaSlot.target.type === "clip") {
      for (const t of next.tracks) {
        if (t.type !== "video") continue;
        const c = t.clips.find((x) => x.id === (mediaSlot.target.type === "clip" ? mediaSlot.target.clipId : ""));
        if (c) c.sourceAssetId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
      }
    }
    expect(isSlotFilled(next, mediaSlot)).toBe(true);
  });

  it("an unedited text slot is unfilled; edited text is filled", () => {
    const { document, manifest } = cloneTemplateToProject(happyBirthday, { ownerId: OWNER, workspaceId: WS });
    const textSlot = manifest.slots.find((s) => s.target.type === "overlay")!;
    expect(isSlotFilled(document, textSlot)).toBe(false);

    const next = structuredClone(document) as Project;
    for (const t of next.tracks) {
      if (t.type !== "overlay") continue;
      const ov = t.clips.find((c) => c.id === (textSlot.target.type === "overlay" ? textSlot.target.overlayId : ""));
      if (ov && ov.kind === "text") ov.text = "Alice's Birthday";
    }
    expect(isSlotFilled(next, textSlot)).toBe(true);
  });
});

describe("pruneUnfilledSlots", () => {
  it("removes all unfilled optional placeholder clips + their transitions; output validates", () => {
    const { document, manifest } = cloneTemplateToProject(happyBirthday, { ownerId: OWNER, workspaceId: WS });
    const pruned = pruneUnfilledSlots(document, manifest);

    // No video clips remain (all 4 photo slots are unfilled + optional).
    const videoClips = mediaTracks(pruned).filter((t) => t.type === "video").flatMap((t) => t.clips);
    expect(videoClips).toHaveLength(0);
    // Transitions referencing the dropped clips are gone.
    expect(pruned.transitions).toHaveLength(0);
    // Still a valid Project.
    expect(validateProject(pruned).ok).toBe(true);
  });

  it("keeps a filled media slot and its clip", () => {
    const { document, manifest } = cloneTemplateToProject(simplePromo, { ownerId: OWNER, workspaceId: WS });
    // Fill scene-1 by swapping its asset.
    const slot = manifest.slots.find((s) => s.id === "scene-1")!;
    const filled = structuredClone(document) as Project;
    if (slot.target.type === "clip") {
      for (const t of filled.tracks) {
        if (t.type !== "video") continue;
        const c = t.clips.find((x) => x.id === (slot.target.type === "clip" ? slot.target.clipId : ""));
        if (c) c.sourceAssetId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
      }
    }
    const pruned = pruneUnfilledSlots(filled, manifest);
    const keptClipIds = mediaTracks(pruned).flatMap((t) => t.clips.map((c) => c.id));
    expect(slot.target.type === "clip" && keptClipIds.includes(slot.target.clipId)).toBe(true);
    expect(validateProject(pruned).ok).toBe(true);
  });

  it("removes unfilled optional text overlays + caption blocks; keeps edited ones", () => {
    const { document, manifest } = cloneTemplateToProject(photoMemories, { ownerId: OWNER, workspaceId: WS });
    // Edit one caption block so it survives the prune.
    const capSlot = manifest.slots.find((s) => s.target.type === "captionBlock")!;
    const edited = structuredClone(document) as Project;
    if (capSlot.target.type === "captionBlock") {
      const ct = edited.captionTracks.find((c) => c.id === (capSlot.target.type === "captionBlock" ? capSlot.target.captionTrackId : ""));
      const b = ct?.blocks.find((x) => x.id === (capSlot.target.type === "captionBlock" ? capSlot.target.blockId : ""));
      if (b) b.text = "A real memory caption";
    }
    const pruned = pruneUnfilledSlots(edited, manifest);
    // The edited block survives; the other 5 default blocks are pruned.
    const remainingBlocks = pruned.captionTracks.flatMap((c) => c.blocks);
    expect(remainingBlocks).toHaveLength(1);
    expect(remainingBlocks[0]!.text).toBe("A real memory caption");
    expect(validateProject(pruned).ok).toBe(true);
  });

  it("leaves the original document untouched (prune operates on a clone)", () => {
    const { document, manifest } = cloneTemplateToProject(happyBirthday, { ownerId: OWNER, workspaceId: WS });
    const beforeClipCount = mediaTracks(document).flatMap((t) => t.clips).length;
    pruneUnfilledSlots(document, manifest);
    expect(mediaTracks(document).flatMap((t) => t.clips).length).toBe(beforeClipCount);
  });
});

describe("unfilledMediaSlotCount", () => {
  it("counts every unfilled media slot of a fresh clone", () => {
    const { document, manifest } = cloneTemplateToProject(simplePromo, { ownerId: OWNER, workspaceId: WS });
    expect(unfilledMediaSlotCount(document, manifest)).toBe(3); // all 3 media slots unfilled
  });
});
