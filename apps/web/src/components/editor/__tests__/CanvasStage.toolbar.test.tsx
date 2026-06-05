import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { sampleProject, type Project, type Track } from "@videoforge/project-schema";
import { useEditorStore } from "../../../store/editorStore.js";

// Isolate the canvas from the real media engines (no WebGL/WebCodecs in jsdom).
const engine = vi.hoisted(() => ({
  init: vi.fn(),
  setProject: vi.fn(),
  play: vi.fn(),
  pause: vi.fn(),
  seekTo: vi.fn(),
  destroy: vi.fn(),
  updateProject: vi.fn(),
}));
vi.mock("../../../engine/index.js", () => ({
  audioEngine: { updateProject: engine.updateProject },
  previewEngine: {
    init: engine.init,
    setProject: engine.setProject,
    play: engine.play,
    pause: engine.pause,
    seekTo: engine.seekTo,
    destroy: engine.destroy,
  },
}));

import CanvasStage from "../CanvasStage.js";

const get = () => useEditorStore.getState();

/** Select the first media clip so the floating selection toolbar renders. */
function selectFirstClip(): void {
  const video = get().project.tracks.find(
    (t): t is Extract<Track, { type: "video" }> => t.type === "video",
  );
  const clip = video?.clips[0];
  if (!clip) throw new Error("sample project has no video clip to select");
  get().select("clip", clip.id);
}

beforeEach(() => {
  get().loadProject(structuredClone(sampleProject) as Project);
  selectFirstClip();
});

// The labels are tied to the ACTUAL onClick of each button, not guessed.
const EXPECTED: Array<{ ariaLabel: string; tip: string }> = [
  { ariaLabel: "Flip horizontal", tip: "Flip H" },
  { ariaLabel: "Flip vertical", tip: "Flip V" },
  { ariaLabel: "Bring forward", tip: "Forward" },
  { ariaLabel: "Send backward", tip: "Backward" },
  { ariaLabel: "Duplicate", tip: "Duplicate" },
  { ariaLabel: "Reset size/position", tip: "Reset size" },
  { ariaLabel: "Delete", tip: "Delete" },
];

describe("CanvasStage · floating selection toolbar", () => {
  it("renders all seven action buttons with accessible names", () => {
    render(<CanvasStage />);
    const toolbar = screen.getByTestId("canvas-toolbar");
    for (const { ariaLabel } of EXPECTED) {
      expect(within(toolbar).getByRole("button", { name: ariaLabel })).toBeInTheDocument();
    }
  });

  it("shows a concise tooltip on hover for each icon", async () => {
    render(<CanvasStage />);
    const toolbar = screen.getByTestId("canvas-toolbar");
    for (const { ariaLabel, tip } of EXPECTED) {
      const btn = within(toolbar).getByRole("button", { name: ariaLabel });
      await userEvent.hover(btn);
      expect(within(toolbar).getByRole("tooltip")).toHaveTextContent(tip);
      await userEvent.unhover(btn);
    }
  });

  it("surfaces the tooltip on keyboard focus too (accessibility)", () => {
    render(<CanvasStage />);
    const toolbar = screen.getByTestId("canvas-toolbar");
    const first = within(toolbar).getByRole("button", { name: EXPECTED[0]!.ariaLabel });
    // React's onFocus binds to the delegated `focusin` event; fire that so the
    // Tooltip opens exactly as it would for a keyboard user tabbing in.
    fireEvent.focusIn(first);
    expect(within(toolbar).getByRole("tooltip")).toHaveTextContent(EXPECTED[0]!.tip);
  });
});
