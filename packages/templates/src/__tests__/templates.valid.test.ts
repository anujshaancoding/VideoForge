// ─────────────────────────────────────────────────────────────────────────────
// CI gate (Templates_Architecture §3.2): every template document must be a valid
// §18 Project, within Free-tier track caps, using MVP-only features. A malformed or
// over-cap template fails the build here — the safety net that replaces DB constraints.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import { validateProject, type Project, type Track } from "@videoforge/project-schema";
import { TEMPLATES } from "../index.js";

const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// Free-tier track caps (Templates_Architecture C8 / Templates_Spec §3).
const FREE_CAPS = { video: 3, audio: 2, voiceover: 1, overlay: 2, caption: 1 };
const FREE_MAX_DURATION_MS = 10 * 60 * 1000;

function durationMs(p: Project): number {
  let end = 0;
  for (const t of p.tracks) {
    if (t.type === "caption") continue;
    for (const c of t.clips) end = Math.max(end, c.endOnTimeline);
  }
  for (const ct of p.captionTracks) for (const b of ct.blocks) end = Math.max(end, b.endMs);
  return end;
}

describe.each(TEMPLATES.map((t) => [t.manifest.name, t] as const))("%s", (_name, template) => {
  it("document passes validateProject()", () => {
    const result = validateProject(template.document);
    if (!result.ok) {
      // Surface the first few issues for a readable failure.
      throw new Error(
        `validateProject failed:\n${JSON.stringify(result.errors?.slice(0, 5), null, 2)}`,
      );
    }
    expect(result.ok).toBe(true);
  });

  it("is within Free-tier track caps", () => {
    const count = (type: Track["type"]) =>
      template.document.tracks.filter((t) => t.type === type).length;
    expect(count("video")).toBeLessThanOrEqual(FREE_CAPS.video);
    expect(count("audio")).toBeLessThanOrEqual(FREE_CAPS.audio);
    expect(count("voiceover")).toBeLessThanOrEqual(FREE_CAPS.voiceover);
    expect(count("overlay")).toBeLessThanOrEqual(FREE_CAPS.overlay);
    expect(template.document.captionTracks.length).toBeLessThanOrEqual(FREE_CAPS.caption);
  });

  it("is within the Free-tier 10-minute duration cap", () => {
    expect(durationMs(template.document)).toBeLessThanOrEqual(FREE_MAX_DURATION_MS);
  });

  it("uses only MVP creative features (no exotic effects/overlay kinds)", () => {
    for (const t of template.document.tracks) {
      if (t.type === "overlay") {
        for (const ov of t.clips) {
          // MVP overlays authored in templates are text only.
          expect(ov.kind).toBe("text");
        }
      }
      if (t.type === "video" || t.type === "audio" || t.type === "voiceover") {
        for (const c of t.clips) {
          // Per-clip effects[] must be empty — color grade is the first-class field.
          expect(c.effects).toEqual([]);
          expect(c.speed).toBe(1);
        }
      }
    }
    // Transitions are crossfade only.
    for (const tr of template.document.transitions) expect(tr.type).toBe("crossfade");
  });

  it("templateId on the template document itself is null", () => {
    expect(template.document.templateId ?? null).toBeNull();
  });

  it("manifest durationMs matches the document timeline", () => {
    expect(template.manifest.durationMs).toBe(durationMs(template.document));
  });

  it("all element ids are lowercase UUID v4", () => {
    const p = template.document;
    const ids: string[] = [p.id, p.ownerId, p.workspaceId];
    for (const t of p.tracks) {
      ids.push(t.id);
      if (t.type !== "overlay" && t.type !== "caption") for (const c of t.clips) ids.push(c.id, c.sourceAssetId);
      if (t.type === "overlay") for (const ov of t.clips) ids.push(ov.id);
    }
    for (const ct of p.captionTracks) {
      ids.push(ct.id);
      for (const b of ct.blocks) ids.push(b.id);
    }
    for (const tr of p.transitions) ids.push(tr.id, tr.fromClipId, tr.toClipId);
    for (const idVal of ids) expect(idVal, idVal).toMatch(UUID_V4_RE);
  });
});

describe("the template set", () => {
  it("ships exactly 5 templates", () => {
    expect(TEMPLATES).toHaveLength(5);
  });

  it("each template has a unique manifest id and document id", () => {
    const manifestIds = new Set(TEMPLATES.map((t) => t.manifest.id));
    const docIds = new Set(TEMPLATES.map((t) => t.document.id));
    expect(manifestIds.size).toBe(5);
    expect(docIds.size).toBe(5);
  });

  it("matches the Templates_Spec §3 media-slot counts", () => {
    const mediaCount = (name: string) => {
      const t = TEMPLATES.find((x) => x.manifest.name === name)!;
      return t.manifest.slots.filter((s) => s.kind !== "text").length;
    };
    expect(mediaCount("Happy Birthday")).toBe(4);
    expect(mediaCount("Travel Recap")).toBe(5);
    expect(mediaCount("Photo Memories")).toBe(6);
    expect(mediaCount("Motivational Quote")).toBe(1);
    expect(mediaCount("Simple Promo")).toBe(3);
  });
});
