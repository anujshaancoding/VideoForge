import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { sampleProject, type Project, type Track } from "@videoforge/project-schema";
import { useEditorStore } from "../../../store/editorStore.js";

// MediaPanel pulls in the real API + WS client at module load. We are testing the
// Text-tab wiring to the store (the "Text caption not working" bug), not networking,
// so both modules are stubbed to inert no-ops.
vi.mock("../../../lib/wsClient.js", () => ({
  wsClient: { on: vi.fn(() => () => {}), send: vi.fn() },
}));
vi.mock("../../../lib/api.js", () => ({
  apiPresign: vi.fn(),
  apiUploadToS3: vi.fn(),
  apiConfirmUpload: vi.fn(),
  apiGetAsset: vi.fn(),
  apiPollAssetReady: vi.fn(),
  fileHash: vi.fn(),
}));

import MediaPanel from "../MediaPanel.js";

const get = () => useEditorStore.getState();

/** A project shaped like a freshly-created one: a single video track, NO overlay lane. */
function freshProjectNoOverlay(): Project {
  const clone = structuredClone(sampleProject) as Project;
  clone.tracks = clone.tracks.filter((t) => t.type === "video");
  // Drop seeded clips so the overlay count we assert on is unambiguous.
  for (const t of clone.tracks) if ("clips" in t) t.clips = [];
  return clone;
}

const overlayTextClips = (p: Project) =>
  p.tracks
    .filter((t): t is Extract<Track, { type: "overlay" }> => t.type === "overlay")
    .flatMap((t) => t.clips)
    .filter((c) => c.kind === "text");

beforeEach(() => {
  get().loadProject(freshProjectNoOverlay());
});

describe("MediaPanel · Text tab", () => {
  it("adds a text overlay at the playhead even when the project has no overlay track (regression)", async () => {
    expect(get().project.tracks.some((t) => t.type === "overlay")).toBe(false);
    get().setPlayhead(2500);

    render(<MediaPanel />);
    await userEvent.click(screen.getByRole("tab", { name: /text/i }));
    await userEvent.click(screen.getByRole("button", { name: "Title" }));

    // An overlay lane was created on demand and a text overlay added to it…
    expect(get().project.tracks.some((t) => t.type === "overlay")).toBe(true);
    const overlays = overlayTextClips(get().project);
    expect(overlays).toHaveLength(1);
    const added = overlays[0]!;
    expect((added as Extract<typeof added, { kind: "text" }>).text).toBe("Title");
    expect(added.startOnTimeline).toBe(2500); // dropped at the playhead
    // …and it is selected so it shows its transform box on the canvas.
    expect(get().selection).toEqual({ kind: "overlay", id: added.id });
  });

  it("reuses the existing overlay track on a second add instead of stacking lanes", async () => {
    render(<MediaPanel />);
    await userEvent.click(screen.getByRole("tab", { name: /text/i }));
    await userEvent.click(screen.getByRole("button", { name: "Body" }));
    await userEvent.click(screen.getByRole("button", { name: "Caption style" }));

    const overlayTracks = get().project.tracks.filter((t) => t.type === "overlay");
    expect(overlayTracks).toHaveLength(1); // exactly one lane, created once
    expect(overlayTextClips(get().project)).toHaveLength(2); // both overlays landed on it
  });
});
