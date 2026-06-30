/**
 * END-TO-END user-flow harness for the Command Bar.
 *
 * Unlike aiEditStore.test.ts (which feeds hand-built plans straight into the store),
 * this drives the EXACT path the UI uses:
 *
 *   user types a query  -> getSuggestions() -> pick top option -> accumulate slots
 *   -> planFromSlots(context) -> validateEditPlan() -> applyAIEditPlan()
 *   -> buildExportDocument()  (the SAME preflight the Export button runs — proves the
 *      edited project is still a valid §18 snapshot the worker can render).
 *
 * 3 full "make a video" sessions + an edge-case battery, mirroring CommandEditBar.run()
 * (selection/playhead target resolution included).
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { Project } from "@videoforge/project-schema";
import { sampleProject, validateProject } from "@videoforge/project-schema";
import { useEditorStore } from "../../store/editorStore.js";
import { buildExportDocument } from "../../lib/templates.js";
import { buildTimelineContext } from "../context.js";
import { getSlotMachineState, getSuggestions, planFromSlots, type CommandSlots } from "../suggest.js";
import { validateEditPlan } from "../validation.js";

function load() {
  useEditorStore.getState().loadProject(structuredClone(sampleProject));
}
function store() {
  return useEditorStore.getState();
}
function firstVideoClipId(): string {
  const t = store().project.tracks.find((x) => x.type === "video");
  if (!t || t.type !== "video") throw new Error("no video track");
  return t.clips[0]!.id;
}

/** Every asset id the project references — i.e. footage the user "owns" (so preflight keeps it). */
function ownedAssetIds(project: Project): Set<string> {
  const ids = new Set<string>();
  for (const t of project.tracks) {
    if (t.type === "video" || t.type === "audio" || t.type === "voiceover") {
      for (const c of t.clips) if (c.sourceAssetId) ids.add(c.sourceAssetId);
    }
  }
  return ids;
}

/** Simulate the user typing `query` into the current slot and accepting the top suggestion. */
function pick(slots: CommandSlots, query: string): CommandSlots {
  const slot = getSlotMachineState(slots).currentSlot;
  if (!slot) throw new Error(`command already complete; cannot type "${query}"`);
  const sugs = getSuggestions(slots, query);
  if (sugs.length === 0) throw new Error(`AUTOCOMPLETE DEAD-END: no suggestion for "${query}" at slot "${slot}"`);
  const chosen = sugs[0]!;
  return { ...slots, [slot]: chosen.insert ?? chosen.value };
}

interface RunOutcome {
  command: string | null;
  applied: number;
  errors: string[];
  warnings: string[];
}

/** Mirror CommandEditBar.run(): build slots by typing, then plan -> validate -> apply. */
function userTypes(queries: string[]): RunOutcome {
  let slots: CommandSlots = {};
  for (const q of queries) slots = pick(slots, q);

  const s = store();
  const context = buildTimelineContext(s.project, s.selection.kind === "clip" ? s.selection.id : undefined);

  const { command, plan } = planFromSlots(slots, context);
  if (!plan) return { command, applied: 0, errors: [`NOT AVAILABLE: "${command}" produced no plan`], warnings: [] };

  const validation = validateEditPlan(plan, context);
  if (!validation.valid) return { command, applied: 0, errors: validation.errors, warnings: validation.warnings };

  const result = s.applyAIEditPlan(plan);
  return { command, applied: result.applied, errors: result.errors, warnings: result.warnings };
}

/** Run the real Export preflight on the current project; assert it's a valid worker snapshot. */
function exportDoc(label: string): Project {
  const project = store().project;
  const doc = buildExportDocument(project, null, ownedAssetIds(project));
  const v = validateProject(doc);
  expect(v.ok, `${label}: edited project fails export preflight: ${v.ok ? "" : JSON.stringify(v.errors)}`).toBe(true);
  // The user's footage must survive preflight (not get dropped as "unowned").
  const vt = doc.tracks.find((t) => t.type === "video");
  if (vt && vt.type === "video") expect(vt.clips.length, `${label}: lost all video clips`).toBeGreaterThan(0);
  return doc;
}

describe("E2E · Video 1 — trim, color, reframe", () => {
  beforeEach(load);

  it("a creator grades + reframes a clip and it stays export-ready", () => {
    store().select("clip", firstVideoClipId()); // user clicks clip A on the timeline

    const a = userTypes(["trim", "0:01 to 0:03"]);
    expect(a.command).toBe("trim 0:01 to 0:03");
    expect(a.applied, `trim failed: ${a.errors.join("; ")}`).toBe(1);

    const b = userTypes(["increase", "brightness", "20"]);
    expect(b.applied, `brightness failed: ${b.errors.join("; ")}`).toBe(1);

    const c = userTypes(["decrease", "contrast", "15"]);
    expect(c.applied, `contrast failed: ${c.errors.join("; ")}`).toBe(1);

    // Sample is 9:16; switch to 1:1 so the assertion actually proves the edit applied.
    const d = userTypes(["change", "1:1"]);
    expect(d.applied, `aspect failed: ${d.errors.join("; ")}`).toBe(1);
    expect(store().project.canvas.aspectRatio).toBe("1:1");

    const doc = exportDoc("Video 1");
    // The grade the user dialed in must be on the clip in the export snapshot.
    const clip = doc.tracks.find((t) => t.type === "video")!.type === "video"
      ? (doc.tracks.find((t) => t.type === "video") as { clips: Array<{ id: string; colorGrade?: unknown }> }).clips.find((c) => c.id === firstVideoClipId())
      : undefined;
    expect(clip?.colorGrade, "color grade did not survive to export snapshot").toBeTruthy();
  });
});

describe("E2E · Video 2 — split, delete, mute", () => {
  beforeEach(load);

  it("a creator cuts and restructures the timeline and it stays export-ready", () => {
    store().select("clip", firstVideoClipId());

    const split = userTypes(["split", "0:02"]);
    expect(split.command).toBe("split at 0:02");
    expect(split.applied, `split failed: ${split.errors.join("; ")}`).toBe(1);

    const del = userTypes(["delete", "0:05 to 0:06"]);
    expect(del.applied, `delete failed: ${del.errors.join("; ")}`).toBe(1);

    // FIXED (D-3): "mute" now scopes to the TARGETED clip (selection → playhead), matching
    // the grammar's "the clip's audio" — not every audio track. Exactly one clip is muted.
    const m = userTypes(["mute"]);
    expect(m.applied, `mute failed: ${m.errors.join("; ")}`).toBe(1);

    exportDoc("Video 2");
  });

  it("mute scopes to the selected clip only — other audio clips keep their gain (D-3)", () => {
    // Select the music clip and mute; the voiceover clip must stay audible.
    const p0 = store().project;
    const music = p0.tracks.find((t) => t.type === "audio")!;
    const voice = p0.tracks.find((t) => t.type === "voiceover")!;
    const musicClipId = music.type === "audio" ? music.clips[0]!.id : "";
    const voiceClipId = voice.type === "voiceover" ? voice.clips[0]!.id : "";
    store().select("clip", musicClipId);

    const m = userTypes(["mute"]);
    expect(m.applied, `mute failed: ${m.errors.join("; ")}`).toBe(1);

    const p = store().project;
    const findGain = (id: string) => {
      for (const t of p.tracks) {
        if (t.type !== "audio" && t.type !== "voiceover" && t.type !== "video") continue;
        const c = t.clips.find((x) => x.id === id);
        if (c) return c.gain;
      }
      return undefined;
    };
    expect(findGain(musicClipId), "selected music clip should be muted").toBe(0);
    expect(findGain(voiceClipId), "voiceover clip must NOT be muted").not.toBe(0);
  });

  it("deleting an entire clip does not leave a dangling transition (export stays valid)", () => {
    // The sample has a crossfade transition between clip A and clip B. Wipe clip B's
    // whole span and confirm the export snapshot has no orphaned transition.
    store().select("clip", firstVideoClipId());
    const transBefore = store().project.transitions.length;
    expect(transBefore).toBeGreaterThan(0); // guard: the fixture really has a transition
    // clip B spans ~3.5–8s; 0:03–0:08 fully covers it so it is removed wholly (orphaning the A→B transition).
    const del = userTypes(["delete", "0:03 to 0:08"]);
    expect(del.applied, `delete failed: ${del.errors.join("; ")}`).toBe(1);
    expect(store().project.transitions.length, "orphaned transition not cleaned up").toBeLessThan(transBefore);
    const doc = exportDoc("delete-whole-clip");
    for (const tr of doc.transitions) {
      const ids = new Set<string>();
      for (const t of doc.tracks) if (t.type === "video") for (const c of t.clips) ids.add(c.id);
      expect(ids.has(tr.fromClipId) && ids.has(tr.toClipId), "dangling transition survived to export").toBe(true);
    }
  });
});

describe("E2E · Video 3 — text overlay + audio", () => {
  beforeEach(load);

  it("a creator adds a positioned title + sets volume and it stays export-ready", () => {
    store().select("clip", firstVideoClipId());

    const before = store().project.tracks.find((t) => t.type === "overlay")!;
    const beforeCount = before.type === "overlay" ? before.clips.length : 0;

    const text = userTypes(["add", "text", '"Subscribe"', "bottom-center"]);
    expect(text.command).toBe('add text "Subscribe" at bottom-center');
    expect(text.applied, `text overlay failed: ${text.errors.join("; ")}`).toBe(1);

    const vol = userTypes(["set", "80"]);
    expect(vol.applied, `volume failed: ${vol.errors.join("; ")}`).toBe(1);

    const doc = exportDoc("Video 3");
    const ov = doc.tracks.find((t) => t.type === "overlay")!;
    const ovClips = ov.type === "overlay" ? ov.clips : [];
    expect(ovClips.length, "overlay not added").toBe(beforeCount + 1);
    const added = ovClips.at(-1)!;
    expect(added.kind === "text" && added.text).toBe("Subscribe");
  });
});

describe("E2E · captions via the bar", () => {
  beforeEach(load);

  it("adds a caption from a bare quoted string", () => {
    store().select("clip", firstVideoClipId());
    const cap = userTypes(["add", "caption", '"Great tip"']);
    expect(cap.command).toBe('add caption "Great tip"');
    expect(cap.applied, `caption failed: ${cap.errors.join("; ")}`).toBe(1);
    exportDoc("caption");
  });

  it("adds a TIMED caption from the bar (D-5 fixed)", () => {
    store().select("clip", firstVideoClipId());
    // The value slot now accepts `"text" from A to B`; a parsed option appears and applies.
    const slots = pick(pick({}, "add"), "caption");
    const timed = getSuggestions(slots, '"Hello" from 0:02 to 0:05');
    expect(timed.length, "timed-caption value should now produce a suggestion").toBeGreaterThan(0);

    const cap = userTypes(["add", "caption", '"Hello" from 0:02 to 0:05']);
    expect(cap.command).toBe('add caption "Hello" from 0:02 to 0:05');
    expect(cap.applied, `timed caption failed: ${cap.errors.join("; ")}`).toBe(1);
    // The created caption block carries the explicit timing (2s–5s), not the playhead default.
    const blocks = store().project.captionTracks[0]?.blocks ?? [];
    const added = blocks.at(-1)!;
    expect(added.text).toBe("Hello");
    expect(added.startMs).toBe(2000);
    expect(added.endMs).toBe(5000);
  });
});

describe("E2E · Edge cases — what a real user will trip on", () => {
  beforeEach(load);

  it("out-of-range trim is rejected, not silently misapplied", () => {
    store().select("clip", firstVideoClipId());
    const out = userTypes(["trim", "9:00 to 9:30"]); // far beyond the ~8s timeline
    expect(out.applied).toBe(0);
    expect(out.errors.length).toBeGreaterThan(0);
  });

  it("inverted range (end before start) is rejected", () => {
    store().select("clip", firstVideoClipId());
    const inv = userTypes(["trim", "0:05 to 0:02"]);
    expect(inv.applied).toBe(0);
    expect(inv.errors.length).toBeGreaterThan(0);
  });

  it("split outside the targeted clip applies nothing", () => {
    store().select("clip", firstVideoClipId());
    const bad = userTypes(["split", "0:30"]); // 30s, beyond the clip
    expect(bad.applied).toBe(0);
  });

  it("every action advances cleanly after one pick (no broken state)", () => {
    for (const action of ["increase", "decrease", "add", "trim", "delete", "split", "move", "change", "set", "fade", "mute"]) {
      const s = pick({}, action);
      expect(s.action, `action "${action}" not pickable`).toBeTruthy();
      const next = getSlotMachineState(s);
      // After one pick: either complete (mute), or on a coherent slot. property/position
      // slots must offer suggestions; a value slot is legitimately empty-until-typed
      // (free-form input + placeholder) — so we assert it can be filled by typing.
      if (next.isComplete || !next.currentSlot) continue;
      if (next.currentSlot === "value") {
        // descriptor-agnostic: at least one kind-appropriate probe must yield a suggestion.
        const probes = ["0:01 to 0:02", "0:30", "10", "9:16", '"hi"'];
        const canFill = probes.some((p) => getSuggestions(s, p).length > 0);
        expect(canFill, `action "${action}" cannot fill its value slot by typing`).toBe(true);
      } else {
        expect(getSuggestions(s, "").length, `action "${action}" dead-ends at ${next.currentSlot}`).toBeGreaterThan(0);
      }
    }
  });

  it("the project still exports after a full multi-command session", () => {
    store().select("clip", firstVideoClipId());
    userTypes(["increase", "brightness", "10"]);
    userTypes(["add", "text", '"Hi"', "top-left"]);
    userTypes(["change", "1:1"]);
    exportDoc("multi-command session");
  });
});
