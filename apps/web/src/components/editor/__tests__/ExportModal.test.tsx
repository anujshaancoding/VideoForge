import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { newProject, type Project, type Track } from "@videoforge/project-schema";
import { simplePromo, type TemplateManifest } from "@videoforge/templates";
import { useEditorStore } from "../../../store/editorStore.js";
import { useTemplateStore } from "../../../store/templateStore.js";
import { cloneTemplateToProject } from "../../../lib/templates.js";
import { FIRST_SESSION_KEY } from "../../../lib/firstSession.js";

// Mock the API so the export flow resolves instantly to a downloadable result. The
// HTTP poll returns an outputUrl, so the modal goes straight to the `done` phase.
const { apiCreateExport, apiPollExportComplete, apiGetDownloadUrl } = vi.hoisted(() => ({
  apiCreateExport: vi.fn(async () => ({
    exportId: "exp-1",
    projectId: "p1",
    status: "QUEUED",
    progress: 0,
    outputUrl: null,
    errorMessage: null,
    warnings: [],
  })),
  apiPollExportComplete: vi.fn(async (_id: string, onProgress: (p: number) => void) => {
    onProgress(100);
    return {
      exportId: "exp-1",
      projectId: "p1",
      status: "COMPLETE",
      progress: 100,
      outputUrl: "https://cdn.test/export.mp4",
      errorMessage: null,
    };
  }),
  apiGetDownloadUrl: vi.fn(async () => ({ downloadUrl: "https://cdn.test/export.mp4" })),
}));
vi.mock("../../../lib/api.js", () => ({ apiCreateExport, apiPollExportComplete, apiGetDownloadUrl }));

import ExportModal from "../ExportModal.js";

const get = () => useEditorStore.getState();

interface AnalyticsWindow {
  __vfAnalytics?: (name: string, data?: Record<string, unknown>) => void;
}
const w = window as unknown as AnalyticsWindow;

/** A project with one clip so it has a real duration (export-eligible). */
function projectWithClip(): Project {
  const p = newProject({ title: "Test", canvasWidth: 1080, canvasHeight: 1920, frameRate: 30 });
  // Backdate createdAt so the TTFE "duration since create" is a positive number.
  p.createdAt = new Date(Date.now() - 5000).toISOString();
  return p;
}

beforeEach(() => {
  localStorage.removeItem(FIRST_SESSION_KEY);
  get().loadProject(projectWithClip());
  const trackId = get().project.tracks[0]!.id;
  get().addClipFromAsset("asset-1", trackId, 0, 4000);
});

afterEach(() => {
  delete w.__vfAnalytics;
});

async function runExportToDone() {
  await userEvent.click(screen.getByRole("button", { name: /^export$/i }));
  // The export resolves to a Download MP4 link in the `done` phase.
  await waitFor(() => expect(screen.getByTestId("download-mp4")).toBeInTheDocument());
}

describe("ExportModal onboarding funnel (ROADMAP Now #6)", () => {
  it("shows the first-session watermark disclosure + parity statement, and fires TTFE once", async () => {
    localStorage.setItem(FIRST_SESSION_KEY, "1");
    const events: Array<{ name: string; data: Record<string, unknown> }> = [];
    w.__vfAnalytics = (name, data) => events.push({ name, data: data ?? {} });

    render(<ExportModal open onClose={() => {}} />);

    // First-session watermark disclosure is visible in the config phase.
    expect(screen.getByTestId("watermark-disclosure")).toBeInTheDocument();

    await runExportToDone();

    // The parity reveal copy is present on the done phase.
    expect(screen.getByText(/same edit graph your preview used/i)).toBeInTheDocument();

    // Click Download → TTFE fires once with the expected payload, flag is cleared.
    const dl = screen.getByTestId("download-mp4");
    await userEvent.click(dl);
    await userEvent.click(dl); // second click must NOT re-fire

    expect(events).toHaveLength(1);
    expect(events[0]!.name).toBe("ttfe:export_complete");
    expect(events[0]!.data).toMatchObject({
      projectId: get().project.id,
      aspectRatio: "9:16",
    });
    expect(typeof events[0]!.data.durationMs).toBe("number");
    expect(events[0]!.data.durationMs as number).toBeGreaterThan(0);

    // The first-session flag is cleared after the first export download.
    expect(localStorage.getItem(FIRST_SESSION_KEY)).not.toBe("1");
  });

  it("does NOT show the watermark disclosure or fire TTFE outside the first session", async () => {
    // No first-session flag set.
    const events: Array<{ name: string }> = [];
    w.__vfAnalytics = (name) => events.push({ name });

    render(<ExportModal open onClose={() => {}} />);
    expect(screen.queryByTestId("watermark-disclosure")).not.toBeInTheDocument();

    await runExportToDone();
    await userEvent.click(screen.getByTestId("download-mp4"));

    expect(events).toHaveLength(0);
  });
});

// ── WYCIWYG render-snapshot: the export POST sends `pruneUnfilledSlots(currentDoc)` ──
// as `document` so the worker renders exactly the previewed doc. Templates_Architecture §5.3.

const OWNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WS = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

type ClipTrack = Extract<Track, { clips: Array<{ id: string }> }>;
const mediaTracks = (p: Project): ClipTrack[] =>
  p.tracks.filter(
    (t): t is ClipTrack => t.type === "video" || t.type === "audio" || t.type === "voiceover",
  );
const allClipIds = (p: Project): string[] => mediaTracks(p).flatMap((t) => t.clips.map((c) => c.id));
const allOverlayTexts = (p: Project): string[] =>
  p.tracks
    .filter((t) => t.type === "overlay")
    .flatMap((t) => (t.type === "overlay" ? t.clips : []))
    .map((ov) => (ov.kind === "text" ? ov.text : ""));

/** Load a template-derived project into the editor + register its manifest for prune resolution. */
function loadTemplateProject(document: Project, manifest: TemplateManifest): void {
  useTemplateStore.getState().setManifestForProject(document.id, manifest);
  get().loadProject(document);
}

/** The body of the most recent export POST (mock infers a 0-arg signature). */
function lastExportBody(): { projectId: string; settings: Record<string, unknown>; document: Project } {
  const call = apiCreateExport.mock.calls.at(-1) as unknown[] | undefined;
  return call![0] as { projectId: string; settings: Record<string, unknown>; document: Project };
}

/** The single `document` snapshot sent on the most recent export POST. */
function lastSentDocument(): Project {
  return lastExportBody().document;
}

describe("ExportModal — sends pruned render-snapshot as `document`", () => {
  it("(a) a PARTIALLY-filled template BLOCKS export with a preflight checklist (no silent prune)", async () => {
    // CEO decision (full-roadmap pass): a template with empty media slots must NOT
    // silently prune to a footage-less video — it BLOCKS with a preflight checklist
    // until the slots are filled. (Replaces the old "send a pruned snapshot" contract.)
    const { document, manifest } = cloneTemplateToProject(simplePromo, { ownerId: OWNER, workspaceId: WS });
    // Fill exactly ONE media slot (scene-1); the rest stay unfilled.
    const slot = manifest.slots.find((s) => s.id === "scene-1")!;
    const filledClipId = slot.target.type === "clip" ? slot.target.clipId : "";
    for (const t of document.tracks) {
      if (t.type !== "video") continue;
      const c = t.clips.find((x) => x.id === filledClipId);
      if (c) c.sourceAssetId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    }
    loadTemplateProject(document, manifest);

    render(<ExportModal open onClose={() => {}} />);

    // The blocking preflight checklist is shown and Export is disabled.
    expect(screen.getByTestId("export-preflight")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /export video/i })).toBeDisabled();
    // No export POST is attempted while a slot is empty.
    expect(apiCreateExport).not.toHaveBeenCalled();
  });

  it("(b) a FULLY-filled template sends the complete document (nothing pruned)", async () => {
    const { document, manifest } = cloneTemplateToProject(simplePromo, { ownerId: OWNER, workspaceId: WS });
    // Fill ALL media slots (swap assets) and ALL text slots (edit text) so none are pruned.
    let n = 0;
    for (const slot of manifest.slots) {
      if (slot.target.type === "clip") {
        const clipId = slot.target.clipId;
        for (const t of document.tracks) {
          if (t.type !== "video") continue;
          const c = t.clips.find((x) => x.id === clipId);
          if (c) c.sourceAssetId = `dddddddd-dddd-4ddd-8ddd-${String(++n).padStart(12, "0")}`;
        }
      } else if (slot.target.type === "overlay") {
        const overlayId = slot.target.overlayId;
        for (const t of document.tracks) {
          if (t.type !== "overlay") continue;
          const ov = t.clips.find((x) => x.id === overlayId);
          if (ov && ov.kind === "text") ov.text = `Filled ${++n}`;
        }
      }
    }
    loadTemplateProject(document, manifest);

    const expectedClipIds = allClipIds(document);
    render(<ExportModal open onClose={() => {}} />);
    await runExportToDone();

    const sent = lastSentDocument();
    // Every clip + every (now-edited) overlay survives — the full doc is sent.
    expect(allClipIds(sent).sort()).toEqual([...expectedClipIds].sort());
    expect(allOverlayTexts(sent)).toHaveLength(4);
  });

  it("(c) a NORMAL (non-template) project sends its current document unchanged", async () => {
    // beforeEach already loaded a non-template project with one clip — no manifest exists.
    const current = get().project;
    render(<ExportModal open onClose={() => {}} />);
    await runExportToDone();

    const sent = lastSentDocument();
    // pruneUnfilledSlots is a no-op with no manifest: the document is sent untouched.
    expect(sent).toEqual(current);
    expect(sent.templateId ?? null).toBeNull();
  });

  it("keeps the export request authenticated + 429-safe (settings + projectId still sent)", async () => {
    render(<ExportModal open onClose={() => {}} />);
    await runExportToDone();
    const body = lastExportBody();
    // The auth/429 handling lives in api.ts `request()` and is untouched: the call still
    // goes through apiCreateExport with the same projectId + settings, now plus a document.
    expect(body.projectId).toBe(get().project.id);
    expect(body.settings).toMatchObject({ format: "mp4", videoCodec: "h264", watermark: true });
    expect(body.document).toBeDefined();
  });
});
