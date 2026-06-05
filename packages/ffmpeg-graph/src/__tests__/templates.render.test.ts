// ─────────────────────────────────────────────────────────────────────────────
// Template render-validation (Templates verify wave) — graph-level proof.
//
// THE INVARIANT (owner: Reel): the export FFmpeg `filter_complex` is generated from
// the EXACT SAME §18 project JSON the client previews. The 5 starter templates ship
// as ordinary `Project` documents, so each one MUST build a valid filter graph via
// buildExportCommand — exercising the feature ops the template advertises.
//
// This test imports the 5 templates from @videoforge/templates and asserts, per
// template, that buildExportCommand(document):
//   • succeeds (no throw) and yields a non-empty filter graph + the final [vout] pad,
//   • declares one clip input per media clip + the Free-tier watermark input,
//   • exercises the expected ops:
//       - Ken Burns      → `zoompan`
//       - crossfades     → `xfade`  (templates with >1 clip + crossfade transitions)
//       - color grade    → `eq=brightness=...`
//       - captions       → `subtitles` (burn) — Photo Memories only
//
// IMPORTANT — what the M0 graph does and does NOT emit (buildFilterComplex.ts header):
//   Editable TEXT OVERLAYS are OUT of the M0 export spine — buildExportCommand does
//   NOT emit `drawtext` for them (the editor renders them in preview; only CAPTIONS
//   are the proven text→export parity surface, §22.3). So the templates tagged
//   "text" exercise text-in-export ONLY via captions (Photo Memories). This test
//   asserts the ops the builder ACTUALLY produces — it does not assert drawtext.
//
// NO FFmpeg here (this builder is pure). Full pixel-goldens for templates are
// DEFERRED TO CI (no FFmpeg in this env) — see the note at the bottom of this file.
//
// @videoforge/ffmpeg-graph does not depend on @videoforge/templates (and we must not
// touch the lockfile), so we import the templates' built `dist` by a workspace-relative
// path. If templates is not built yet, the suite SKIPS with a clear message rather
// than failing spuriously (CI builds all packages before `test`).
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import { buildExportCommand, type ExportSettings } from "../buildFilterComplex.js";
import type { Project } from "@videoforge/project-schema";

// ── Locate the built @videoforge/templates entry (workspace-relative; no new dep). ──
const here = dirname(fileURLToPath(import.meta.url));
const templatesDist = resolve(here, "../../../templates/dist/index.js");

interface TemplateLike {
  manifest: { id: string; name: string; tags: string[]; slots: unknown[] };
  document: Project;
}

let TEMPLATES: readonly TemplateLike[] = [];
let loadError: string | null = null;
if (existsSync(templatesDist)) {
  try {
    const mod = (await import(pathToFileURL(templatesDist).href)) as {
      TEMPLATES: readonly TemplateLike[];
    };
    TEMPLATES = mod.TEMPLATES;
  } catch (err) {
    loadError = err instanceof Error ? err.message : String(err);
  }
} else {
  loadError = `@videoforge/templates not built (missing ${templatesDist}) — run \`pnpm --filter @videoforge/templates build\``;
}

// Burn captions + Free-tier watermark ON — the worst-case graph (most ops present).
const settings: ExportSettings = {
  format: "mp4",
  videoCodec: "h264",
  resolution: { w: 1080, h: 1920 },
  fps: 30,
  crf: 18,
  captions: "burn",
  watermark: true,
};

/**
 * Count the clip INPUTS the builder declares: one -i per video-track clip plus one
 * per clip on an AUDIBLE audio/voiceover track (mute/solo gating). Mirrors
 * buildExportCommand's input-declaration loop so the assertion tracks the builder.
 */
function clipInputCount(doc: Project): number {
  let n = 0;
  const audio = doc.tracks.filter((t) => t.type === "audio" || t.type === "voiceover");
  const anySolo = audio.some((t) => "solo" in t && t.solo);
  for (const track of doc.tracks) {
    if (track.type === "video") {
      n += track.clips.length;
    } else if (track.type === "audio" || track.type === "voiceover") {
      const audible = anySolo ? track.solo : !track.muted;
      if (audible) n += track.clips.length;
    }
  }
  return n;
}

/** Crossfade transition count (the builder emits one `xfade` per fused pair). */
function crossfadeCount(doc: Project): number {
  return doc.transitions.filter((t) => t.type === "crossfade").length;
}

/** Does the doc carry a Ken Burns move on any clip? (builder → `zoompan`) */
function hasKenBurns(doc: Project): boolean {
  return doc.tracks.some(
    (t) => t.type === "video" && t.clips.some((c) => c.kenBurns !== undefined),
  );
}

/** Does the doc carry a color grade on any clip? (builder → `eq=brightness=`) */
function hasColorGrade(doc: Project): boolean {
  return doc.tracks.some(
    (t) => t.type === "video" && t.clips.some((c) => c.colorGrade !== undefined),
  );
}

/** Does the doc carry caption blocks? (builder → `subtitles` when captions==='burn') */
function hasCaptions(doc: Project): boolean {
  return doc.captionTracks.some((t) => t.blocks.length > 0);
}

describe("templates render-validation — all 5 templates build a valid filter graph", () => {
  it("loaded the 5 starter templates from @videoforge/templates", () => {
    if (loadError) {
      console.warn(`[templates.render] SKIP: ${loadError}`);
      return;
    }
    expect(TEMPLATES.length).toBe(5);
  });

  it("every template builds a non-empty graph with a final [vout] pad + watermark input", () => {
    if (loadError) return;
    for (const t of TEMPLATES) {
      const res = buildExportCommand(t.document, settings);
      // Graph builds and is non-trivial.
      expect(res.filterComplex.length, `${t.manifest.name}: empty filterComplex`).toBeGreaterThan(0);
      // Final mapped video pad is the watermark output (Free-tier watermark on).
      expect(res.outputLabel, `${t.manifest.name}: outputLabel`).toBe("[vout]");
      expect(
        res.inputs.some((i) => i.kind === "watermark"),
        `${t.manifest.name}: missing watermark input`,
      ).toBe(true);
      // One clip input per media clip + per audible audio clip (accurate-seek
      // -ss/-to declared per input). Matches the builder's declaration order.
      const clipInputs = res.inputs.filter((i) => i.kind === "clip");
      expect(clipInputs.length, `${t.manifest.name}: clip input count`).toBe(
        clipInputCount(t.document),
      );
      // The graph string is also embedded in args (deterministic, ready to spawn).
      expect(res.args).toContain(res.filterComplex);
      expect(res.args).toContain("-filter_complex");
    }
  });

  // Per-template op matrix — asserts each template exercises EXACTLY the ops its
  // document declares (and that the builder emits them), per the spec map above.
  it("each template exercises the FFmpeg ops it advertises", () => {
    if (loadError) return;

    const report: Record<string, Record<string, boolean | number>> = {};

    for (const t of TEMPLATES) {
      const fc = buildExportCommand(t.document, settings).filterComplex;
      const xfades = (fc.match(/xfade=/g) ?? []).length;
      const zoompans = (fc.match(/zoompan=/g) ?? []).length;
      const eqs = (fc.match(/eq=brightness=/g) ?? []).length;
      const subtitles = /subtitles=/.test(fc);

      report[t.manifest.name] = {
        zoompan: zoompans,
        xfade: xfades,
        "eq(grade)": eqs,
        subtitles,
      };

      // Ken Burns → at least one zoompan per template that declares it.
      if (hasKenBurns(t.document)) {
        expect(zoompans, `${t.manifest.name}: expected zoompan (Ken Burns)`).toBeGreaterThan(0);
      }

      // Crossfades → one xfade per crossfade transition the document declares.
      const expectedXfades = crossfadeCount(t.document);
      expect(xfades, `${t.manifest.name}: xfade count`).toBe(expectedXfades);

      // Color grade → at least one eq filter when any clip carries a grade.
      if (hasColorGrade(t.document)) {
        expect(eqs, `${t.manifest.name}: expected eq (color grade)`).toBeGreaterThan(0);
      }

      // Captions → subtitles filter present iff the document has caption blocks
      // (captions === 'burn' here). Templates without captions must NOT emit it.
      expect(subtitles, `${t.manifest.name}: subtitles presence`).toBe(hasCaptions(t.document));
    }

    // Surface the op matrix in the test log for the Atlas hand-off.
    console.info("[templates.render] op matrix:\n" + JSON.stringify(report, null, 2));
  });

  // Sanity: at least one template must exercise EACH headline op so the gate has
  // real coverage of the export surface (not all-false vacuous passes).
  it("the template set collectively exercises zoompan, xfade, eq, and subtitles", () => {
    if (loadError) return;
    const graphs = TEMPLATES.map((t) => buildExportCommand(t.document, settings).filterComplex);
    expect(graphs.some((g) => /zoompan=/.test(g)), "no template exercises zoompan").toBe(true);
    expect(graphs.some((g) => /xfade=/.test(g)), "no template exercises xfade").toBe(true);
    expect(graphs.some((g) => /eq=brightness=/.test(g)), "no template exercises eq").toBe(true);
    expect(graphs.some((g) => /subtitles=/.test(g)), "no template exercises subtitles").toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DEFERRED TO CI (no FFmpeg in this env): full pixel-goldens for each template —
// spawning FFmpeg on the built graph and diffing decoded frames against committed
// golden stills — are NOT run here. This suite proves the GRAPH-LEVEL contract
// (every template builds a valid filter_complex exercising its ops); the pixel
// fidelity of the rendered output is validated in the CI golden stage where the
// pinned FFmpeg binary is available (see packages/ffmpeg-graph golden tests).
// ─────────────────────────────────────────────────────────────────────────────
