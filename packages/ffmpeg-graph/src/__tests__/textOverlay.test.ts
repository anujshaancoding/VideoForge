// ─────────────────────────────────────────────────────────────────────────────
// Structural tests for the text-overlay `drawtext` stage (Text_Overlay_Export_Spec.md
// §10). FFmpeg is NOT available in this environment, so these assert the GRAPH the
// builder emits (the expected `drawtext` per overlay) — the pixel-level SSIM/PSNR
// goldens are generated in CI on the pinned-FFmpeg image (which now bundles Inter via
// the Dockerfile). The fixtures here mirror the six golden fixtures in
// fixtures/projects/index.ts so a graph regression is caught BEFORE the (slow) pixel
// gate. They lock the spec's parity risks R1–R6:
//   default(R1) / each align(§5.3) / multi-line(R6) / escaping(R3) / sub-floor(R5) /
//   weight+opacity(R2).
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import type { Project, TextOverlay, OverlayTrack } from "@videoforge/project-schema";
import { buildExportCommand, type ExportSettings } from "../buildFilterComplex.js";

// 1080×1920 export, NO watermark/captions so the drawtext stage is isolated.
const settings: ExportSettings = {
  format: "mp4",
  videoCodec: "h264",
  resolution: { w: 1080, h: 1920 },
  fps: 30,
  crf: 18,
  captions: "none",
  watermark: false,
};

const TRACK_ID = "00000000-0000-4000-8000-0000000000a0";

function textOverlay(overrides: Partial<TextOverlay> & { id: string }): TextOverlay {
  return {
    trackId: TRACK_ID,
    kind: "text",
    startOnTimeline: 0,
    endOnTimeline: 3000,
    canvasX: 5,
    canvasY: 80,
    width: 90,
    height: 15,
    rotation: 0,
    opacity: 100,
    animation: {},
    keyframes: {},
    text: "Hello",
    ...overrides,
    style: {
      fontFamily: "sans-serif",
      fontSize: 48,
      fontWeight: 600,
      color: "#FFFFFF",
      align: "center",
      outline: { color: "#000000", width: 2, position: "outside" },
      ...(overrides.style ?? {}),
    },
  };
}

function projectWith(overlays: TextOverlay[], canvasH = 1920): Project {
  const track: OverlayTrack = {
    id: TRACK_ID,
    type: "overlay",
    name: "Overlay 1",
    colour: "#FF7A1A",
    height: 72,
    muted: false,
    solo: false,
    locked: false,
    clips: overlays,
  };
  return {
    schemaVersion: 1,
    revision: 1,
    id: "00000000-0000-4000-8000-0000000000ff",
    title: "text-overlay fixture",
    canvas: {
      width: 1080,
      height: canvasH,
      frameRate: 30,
      aspectRatio: "9:16",
      backgroundColor: "#111111",
    },
    tracks: [track],
    captionTracks: [],
    transitions: [],
    markers: [],
    exportPresets: [],
    ownerId: "00000000-0000-4000-8000-0000000000aa",
    workspaceId: "00000000-0000-4000-8000-0000000000bb",
    collaborators: [{ userId: "00000000-0000-4000-8000-0000000000aa", role: "admin" }],
    isPublic: false,
    templateId: null,
    createdAt: "2026-06-01T12:00:00.000Z",
    updatedAt: "2026-06-01T12:00:00.000Z",
  };
}

/** The single drawtext filter part for a one-overlay project. */
function drawtextOf(project: Project, s: ExportSettings = settings): string {
  const { filterComplex } = buildExportCommand(project, s);
  const part = filterComplex.split(";").find((p) => p.includes("drawtext"));
  if (!part) throw new Error("no drawtext filter emitted");
  return part;
}

// ── overlay_text_default — locks R1 (fontFamily ignored → Inter) + Appendix A math ──
describe("drawtext default overlay (Appendix A, R1)", () => {
  const dt = drawtextOf(projectWith([textOverlay({ id: "00000000-0000-4000-8000-000000000001" })]));

  it("ignores style.fontFamily and renders the weight-mapped Inter face (R1)", () => {
    // fontFamily is "sans-serif" in the data, but the export MUST use Inter.
    expect(dt).toContain("fontfile=__VF_FONT_Inter-SemiBold.ttf__");
    expect(dt).not.toMatch(/sans-serif/);
  });

  it("emits the Appendix A geometry/size/colour/border/timing", () => {
    expect(dt).toContain("fontsize=48");
    expect(dt).toContain("fontcolor=0xFFFFFF@1");
    expect(dt).toContain("x='54+972/2-text_w/2'"); // center anchor
    expect(dt).toContain("y='1536+288/2-text_h/2'"); // vertical block centre
    expect(dt).toContain("borderw=2:bordercolor=0x000000@1");
    expect(dt).toContain("line_spacing=10:text_align=C");
    expect(dt).toContain("expansion=none");
    expect(dt).toContain("enable='between(t,0,3)'");
  });

  it("uses textfile= (not inline text=) so content bypasses the tokeniser (R3)", () => {
    expect(dt).toContain("textfile=__VF_OVERLAYTEXT_00000000-0000-4000-8000-000000000001__");
    expect(dt).not.toMatch(/:text=/);
  });

  it("exposes the text + font as worker-substitution specs", () => {
    const r = buildExportCommand(
      projectWith([textOverlay({ id: "00000000-0000-4000-8000-000000000001" })]),
      settings,
    );
    expect(r.textFiles).toEqual([
      {
        token: "__VF_OVERLAYTEXT_00000000-0000-4000-8000-000000000001__",
        overlayId: "00000000-0000-4000-8000-000000000001",
        text: "Hello",
      },
    ]);
    expect(r.fonts).toEqual([{ token: "__VF_FONT_Inter-SemiBold.ttf__", file: "Inter-SemiBold.ttf" }]);
  });
});

// ── overlay_text_aligns — locks the §5.3 horizontal anchor expressions ──────────────
describe("drawtext alignment x-expressions (§5.3)", () => {
  it("left → x=boxX", () => {
    const dt = drawtextOf(
      projectWith([
        textOverlay({ id: "00000000-0000-4000-8000-000000000001", style: { align: "left" } as never }),
      ]),
    );
    expect(dt).toContain("x='54'");
  });

  it("center → x=boxX+boxW/2-text_w/2", () => {
    const dt = drawtextOf(
      projectWith([
        textOverlay({ id: "00000000-0000-4000-8000-000000000001", style: { align: "center" } as never }),
      ]),
    );
    expect(dt).toContain("x='54+972/2-text_w/2'");
    expect(dt).toContain("text_align=C");
  });

  it("right → x=boxX+boxW-text_w", () => {
    const dt = drawtextOf(
      projectWith([
        textOverlay({ id: "00000000-0000-4000-8000-000000000001", style: { align: "right" } as never }),
      ]),
    );
    expect(dt).toContain("x='54+972-text_w'");
    expect(dt).toContain("text_align=R");
  });
});

// ── overlay_text_multiline — locks R6 (block-centred multi-line via textfile + spacing) ─
describe("drawtext multi-line (R6 / §6)", () => {
  const ov = textOverlay({
    id: "00000000-0000-4000-8000-000000000001",
    text: "Line one\nLine two\nLine three",
  });
  const r = buildExportCommand(projectWith([ov]), settings);

  it("writes the newline-split text verbatim to the textfile spec (no trimming)", () => {
    expect(r.textFiles[0]!.text).toBe("Line one\nLine two\nLine three");
  });

  it("centres the whole block via text_h and sets line_spacing/text_align", () => {
    const dt = r.filterComplex.split(";").find((p) => p.includes("drawtext"))!;
    expect(dt).toContain("y='1536+288/2-text_h/2'"); // full-block height
    expect(dt).toContain("line_spacing=10"); // round(48 * (1.2-1))
    expect(dt).toContain("text_align=C");
  });

  it("honours an explicit lineHeight in line_spacing", () => {
    const ov2 = textOverlay({
      id: "00000000-0000-4000-8000-000000000001",
      text: "a\nb",
      style: { lineHeight: 1.5 } as never,
    });
    const dt = drawtextOf(projectWith([ov2]));
    expect(dt).toContain("line_spacing=24"); // round(48 * 0.5)
  });
});

// ── overlay_text_escape — locks R3 (`:` `'` `%` `\` / quotes carried via textfile) ──
describe("drawtext escaping via textfile (R3)", () => {
  const ov = textOverlay({
    id: "00000000-0000-4000-8000-000000000001",
    text: 'He said: "50% off"',
  });
  const r = buildExportCommand(projectWith([ov]), settings);

  it("passes the raw text (colon/quote/percent intact) into the textfile spec, unescaped", () => {
    // The worker writes this verbatim; FFmpeg reads it from the file, so NO escaping
    // is applied to the content — the entire R3 class is neutralised by textfile=.
    expect(r.textFiles[0]!.text).toBe('He said: "50% off"');
  });

  it("the filtergraph contains only the safe sentinel token, never the raw text", () => {
    const dt = r.filterComplex.split(";").find((p) => p.includes("drawtext"))!;
    expect(dt).toContain("textfile=__VF_OVERLAYTEXT_00000000-0000-4000-8000-000000000001__");
    expect(dt).not.toContain("50%");
    expect(dt).not.toContain('"');
    expect(dt).toContain("expansion=none"); // %{...} renders literally
  });
});

// ── overlay_text_subfloor — locks R5 (the 12px floor at render resolution) ──────────
describe("drawtext sub-floor font size (R5)", () => {
  it("keeps fontsize above the scaled 12px floor at full render height", () => {
    // fontSize 8 on a 1920 canvas at full res → max(round(12), round(8)) = 12.
    const dt = drawtextOf(
      projectWith([
        textOverlay({
          id: "00000000-0000-4000-8000-000000000001",
          style: { fontSize: 8 } as never,
        }),
      ]),
    );
    expect(dt).toContain("fontsize=12");
  });
});

// ── overlay_text_weight_opacity — locks R2 (weight bucket) + alpha product (§7.2) ───
describe("drawtext weight bucketing + opacity (R2 / §7.2)", () => {
  it("weight 700 → Inter-Bold; opacity 60 multiplies fill AND border alpha", () => {
    const ov = textOverlay({
      id: "00000000-0000-4000-8000-000000000001",
      opacity: 60,
      style: { fontWeight: 700, color: "#FF7A1A", outline: { color: "#0A0A0A", width: 4, position: "outside" } } as never,
    });
    const dt = drawtextOf(projectWith([ov]));
    expect(dt).toContain("fontfile=__VF_FONT_Inter-Bold.ttf__");
    expect(dt).toContain("fontcolor=0xFF7A1A@0.6");
    expect(dt).toContain("bordercolor=0x0A0A0A@0.6");
    expect(dt).toContain("borderw=4"); // round(4 * 1920/1920)
  });

  it("an 8-digit hex colour folds its own alpha into the opacity product", () => {
    // color #FFFFFF80 → colorAlpha 128/255 ≈ 0.502; opacity 100 → @0.502.
    const ov = textOverlay({
      id: "00000000-0000-4000-8000-000000000001",
      style: { color: "#FFFFFF80" } as never,
    });
    const dt = drawtextOf(projectWith([ov]));
    expect(dt).toMatch(/fontcolor=0xFFFFFF@0\.50/);
  });

  it("maps italic weights to the Italic faces", () => {
    const ov = textOverlay({
      id: "00000000-0000-4000-8000-000000000001",
      style: { fontWeight: 700, italic: true } as never,
    });
    const r = buildExportCommand(projectWith([ov]), settings);
    expect(r.fonts[0]!.file).toBe("Inter-BoldItalic.ttf");
  });
});

// ── Stage placement + z-order + multi-overlay threading ─────────────────────────────
describe("drawtext stage placement & ordering (§10.1)", () => {
  it("slots BETWEEN captions and the watermark (watermark draws on top → [vout])", () => {
    const ov = textOverlay({ id: "00000000-0000-4000-8000-000000000001" });
    const { filterComplex, outputLabel } = buildExportCommand(projectWith([ov]), {
      ...settings,
      watermark: true,
    });
    const parts = filterComplex.split(";");
    const dtIdx = parts.findIndex((p) => p.includes("drawtext"));
    const wmIdx = parts.findIndex((p) => p.includes("overlay=W-w-16:H-h-16"));
    expect(dtIdx).toBeGreaterThanOrEqual(0);
    expect(wmIdx).toBeGreaterThan(dtIdx); // watermark AFTER (on top of) the text
    // The watermark overlay consumes the drawtext output label.
    expect(parts[wmIdx]).toContain("[vtext0][wm]");
    expect(outputLabel).toBe("[vout]");
  });

  it("threads multiple overlays vtext0 → vtext1 in track-then-clip order (z-order)", () => {
    const a = textOverlay({ id: "00000000-0000-4000-8000-000000000001", text: "A" });
    const b = textOverlay({ id: "00000000-0000-4000-8000-000000000002", text: "B" });
    const { filterComplex } = buildExportCommand(projectWith([a, b]), settings);
    expect(filterComplex).toContain("[vtext0]drawtext"); // 2nd overlay draws on the 1st's output
    expect(filterComplex).toMatch(/drawtext=[^;]*\[vtext1\]/);
  });

  it("dedupes a shared Inter face across overlays into ONE font spec", () => {
    const a = textOverlay({ id: "00000000-0000-4000-8000-000000000001", text: "A" });
    const b = textOverlay({ id: "00000000-0000-4000-8000-000000000002", text: "B" });
    const { fonts } = buildExportCommand(projectWith([a, b]), settings);
    expect(fonts).toHaveLength(1); // both weight 600 → one Inter-SemiBold ref
  });

  it("is a NO-OP for a project with no text overlays (existing graphs unchanged)", () => {
    const empty = projectWith([]);
    const { filterComplex, textFiles, fonts } = buildExportCommand(empty, settings);
    expect(filterComplex).not.toContain("drawtext");
    expect(textFiles).toEqual([]);
    expect(fonts).toEqual([]);
  });
});

// ── Deferred sub-features are honestly omitted, matching the canvas (§9) ─────────────
describe("drawtext deferred-feature omission (§9)", () => {
  it("renders solid colour and omits gradient (canvas ignores gradient too)", () => {
    const ov = textOverlay({
      id: "00000000-0000-4000-8000-000000000001",
      style: {
        gradient: { type: "linear", stops: [{ offset: 0, color: "#FF0000" }] },
      } as never,
    });
    const dt = drawtextOf(projectWith([ov]));
    expect(dt).toContain("fontcolor=0xFFFFFF@1"); // solid style.color, no gradient
    expect(dt).not.toContain("gradient");
  });

  it("does not emit box/shadow for backgroundColor/shadow (deferred §9)", () => {
    const ov = textOverlay({
      id: "00000000-0000-4000-8000-000000000001",
      style: {
        backgroundColor: "#000000",
        shadow: { color: "#000000", offsetX: 2, offsetY: 2, blur: 4 },
      } as never,
    });
    const dt = drawtextOf(projectWith([ov]));
    expect(dt).not.toContain("box=1");
    expect(dt).not.toContain("shadowx");
  });
});

// ── Underline rule via drawbox (the underline milestone) ─────────────────────────────
// drawtext can't underline, so an underlined overlay emits a filled `drawbox` rule under
// each line, with geometry from the SHARED `underlineRule` helper (same width/position
// the preview draws), in the text colour + alpha, chained after the drawtext.
describe("underline → drawbox rule", () => {
  function drawboxOf(project: Project): string | undefined {
    const { filterComplex } = buildExportCommand(project, settings);
    return filterComplex.split(";").find((p) => p.includes("drawbox"));
  }

  it("emits NO drawbox when underline is unset (existing graphs unchanged)", () => {
    const ov = textOverlay({ id: "00000000-0000-4000-8000-000000000001" });
    expect(drawboxOf(projectWith([ov]))).toBeUndefined();
  });

  it("emits a filled drawbox in the text colour after the drawtext when underline is set", () => {
    const ov = textOverlay({
      id: "00000000-0000-4000-8000-000000000001",
      style: { underline: true, color: "#FF7A1A" } as never,
    });
    const { filterComplex } = buildExportCommand(projectWith([ov]), settings);
    const parts = filterComplex.split(";");
    const dtIdx = parts.findIndex((p) => p.includes("drawtext"));
    const boxIdx = parts.findIndex((p) => p.includes("drawbox"));
    expect(boxIdx).toBeGreaterThan(dtIdx); // rule chains AFTER the glyphs
    const box = parts[boxIdx]!;
    expect(box).toContain("[vtext0]drawbox="); // consumes the drawtext output
    expect(box).toContain("color=0xFF7A1A@1"); // text colour + alpha
    expect(box).toContain("t=fill");
    expect(box).toContain("enable='between(t,0,3)'"); // same timing window
    expect(box).toMatch(/w=\d+:h=\d+/); // concrete pixel width/height (not text_w)
  });

  it("multiplies the underline alpha by overlay opacity (matches the fill)", () => {
    const ov = textOverlay({
      id: "00000000-0000-4000-8000-000000000001",
      opacity: 60,
      style: { underline: true, color: "#FFFFFF" } as never,
    });
    expect(drawboxOf(projectWith([ov]))).toContain("color=0xFFFFFF@0.6");
  });

  it("emits ONE rule per non-empty line for multi-line text", () => {
    const ov = textOverlay({
      id: "00000000-0000-4000-8000-000000000001",
      text: "Line one\nLine two\nLine three",
      style: { underline: true } as never,
    });
    const { filterComplex } = buildExportCommand(projectWith([ov]), settings);
    const boxes = filterComplex.split(";").filter((p) => p.includes("drawbox"));
    expect(boxes).toHaveLength(3);
  });
});
