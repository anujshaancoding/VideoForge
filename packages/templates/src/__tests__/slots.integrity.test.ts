// ─────────────────────────────────────────────────────────────────────────────
// CI gate (Templates_Architecture §3.2): the sidecar manifest must not drift from
// its document. Every slot.target id resolves to a real element; slot ids are unique;
// each media slot's placeholder assetId actually appears on its target element.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import type {
  CaptionBlock,
  Clip,
  OverlayClip,
  Project,
  TextOverlay,
} from "@videoforge/project-schema";
import { TEMPLATES } from "../index.js";
import type { TemplateSlot } from "../types.js";

function findClip(p: Project, trackId: string, clipId: string): Clip | undefined {
  const track = p.tracks.find((t) => t.id === trackId);
  if (!track || (track.type !== "video" && track.type !== "audio" && track.type !== "voiceover")) {
    return undefined;
  }
  return track.clips.find((c) => c.id === clipId);
}

function findOverlay(p: Project, overlayId: string): OverlayClip | undefined {
  for (const t of p.tracks) {
    if (t.type !== "overlay") continue;
    const ov = t.clips.find((c) => c.id === overlayId);
    if (ov) return ov;
  }
  return undefined;
}

function findCaptionBlock(p: Project, trackId: string, blockId: string): CaptionBlock | undefined {
  const ct = p.captionTracks.find((c) => c.id === trackId);
  return ct?.blocks.find((b) => b.id === blockId);
}

describe.each(TEMPLATES.map((t) => [t.manifest.name, t] as const))("%s slots", (_name, template) => {
  const { document, manifest } = template;

  it("has at least one slot", () => {
    expect(manifest.slots.length).toBeGreaterThan(0);
  });

  it("slot ids are unique within the template", () => {
    const ids = manifest.slots.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(template.manifest.slots.map((s) => [s.id, s] as const))(
    "slot '%s' target resolves to a real element of the matching type",
    (_id, slot: TemplateSlot) => {
      switch (slot.target.type) {
        case "clip": {
          const clip = findClip(document, slot.target.trackId, slot.target.clipId);
          expect(clip, `clip ${slot.target.clipId} on track ${slot.target.trackId}`).toBeDefined();
          // Media slot kinds map to clip targets.
          expect(slot.kind === "image" || slot.kind === "video").toBe(true);
          // The placeholder assetId mirrors the value on the target element (structural fill check).
          expect(slot.placeholder.kind).toBe("asset");
          if (slot.placeholder.kind === "asset") {
            expect(clip!.sourceAssetId).toBe(slot.placeholder.assetId);
          }
          break;
        }
        case "overlay": {
          const ov = findOverlay(document, slot.target.overlayId);
          expect(ov, `overlay ${slot.target.overlayId}`).toBeDefined();
          expect(slot.kind).toBe("text");
          expect(ov!.kind).toBe("text");
          expect(slot.placeholder.kind).toBe("text");
          if (slot.placeholder.kind === "text") {
            expect((ov as TextOverlay).text).toBe(slot.placeholder.text);
          }
          break;
        }
        case "captionBlock": {
          const block = findCaptionBlock(document, slot.target.captionTrackId, slot.target.blockId);
          expect(block, `caption block ${slot.target.blockId}`).toBeDefined();
          expect(slot.kind).toBe("text");
          expect(slot.placeholder.kind).toBe("text");
          if (slot.placeholder.kind === "text") {
            expect(block!.text).toBe(slot.placeholder.text);
          }
          break;
        }
      }
    },
  );

  it("every media slot maps to a distinct clip + placeholder asset id", () => {
    const mediaSlots = manifest.slots.filter((s) => s.target.type === "clip");
    const clipIds = mediaSlots.map((s) => (s.target.type === "clip" ? s.target.clipId : ""));
    const assetIds = mediaSlots.map((s) => (s.placeholder.kind === "asset" ? s.placeholder.assetId : ""));
    expect(new Set(clipIds).size).toBe(clipIds.length);
    // Distinct placeholder ids so filling one slot never marks a sibling "filled".
    expect(new Set(assetIds).size).toBe(assetIds.length);
  });
});
