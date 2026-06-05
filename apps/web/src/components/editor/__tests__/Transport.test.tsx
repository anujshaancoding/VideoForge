import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { sampleProject, type Project } from "@videoforge/project-schema";
import { useEditorStore } from "../../../store/editorStore.js";

// Isolate Transport from the real media engines — we are testing its wiring to the
// store, not playback. The engine singletons are replaced with spies. vi.hoisted is
// required because vi.mock is hoisted above normal const declarations.
const { seekTo, setMasterVolume } = vi.hoisted(() => ({
  seekTo: vi.fn(),
  setMasterVolume: vi.fn(),
}));
vi.mock("../../../engine/index.js", () => ({
  audioEngine: { setMasterVolume },
  previewEngine: { seekTo },
}));

import Transport from "../Transport.js";

const get = () => useEditorStore.getState();

beforeEach(() => {
  get().loadProject(structuredClone(sampleProject) as Project);
  seekTo.mockClear();
  setMasterVolume.mockClear();
});

describe("Transport", () => {
  it("renders the playback toolbar with the current + total timecodes", () => {
    render(<Transport />);
    expect(screen.getByRole("toolbar", { name: "Playback controls" })).toBeInTheDocument();
    expect(screen.getByLabelText("Current time")).toHaveTextContent("00:00:00");
    // Sample project duration is 8000ms.
    expect(screen.getByLabelText("Total duration").textContent).toMatch(/00:08:00/);
  });

  it("toggles play/pause and flips the button label", async () => {
    render(<Transport />);
    expect(get().isPlaying).toBe(false);
    await userEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(get().isPlaying).toBe(true);
    // The same control is now a Pause button.
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
  });

  it("steps the playhead forward one frame and seeks the preview", async () => {
    render(<Transport />);
    await userEvent.click(screen.getByRole("button", { name: "Step forward one frame" }));
    // 30fps → 1000/30 ≈ 33.33ms per frame. The store rounds the playhead (ms()) to
    // 33; the preview is seeked with the exact (unrounded) frame position.
    expect(get().playheadMs).toBe(33);
    expect(seekTo).toHaveBeenCalledWith(1000 / 30);
  });

  it("clamps the playhead at zero when stepping back from the start", async () => {
    render(<Transport />);
    await userEvent.click(screen.getByRole("button", { name: "Step back one frame" }));
    expect(get().playheadMs).toBe(0);
  });

  it("skip-to-end moves the playhead to the project duration", async () => {
    render(<Transport />);
    await userEvent.click(screen.getByRole("button", { name: "Skip to end" }));
    expect(get().playheadMs).toBe(8000);
    expect(seekTo).toHaveBeenCalledWith(8000);
  });
});
