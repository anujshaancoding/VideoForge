import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { newProject, type Project } from "@videoforge/project-schema";
import { selectProjectDurationMs, useEditorStore } from "../../../store/editorStore.js";
import TopBar from "../TopBar.js";

const get = () => useEditorStore.getState();

/** A fresh, empty project (one video track, zero clips → durationMs === 0). */
function emptyProject(): Project {
  return newProject({ title: "Test", canvasWidth: 1080, canvasHeight: 1920, frameRate: 30 });
}

beforeEach(() => {
  get().loadProject(emptyProject());
});

describe("TopBar export gate (ROADMAP Now #6)", () => {
  it("renders Export aria-disabled (NOT bare disabled) when the timeline is empty", () => {
    render(<TopBar />);
    const exportBtn = screen.getByRole("button", { name: /export/i });
    // aria-disabled keeps it in the focus order for axe (Sentinel's check) — it must
    // NOT carry the native `disabled` attribute, which would remove it from focus.
    expect(exportBtn).toHaveAttribute("aria-disabled", "true");
    expect(exportBtn).not.toBeDisabled();
  });

  it("does not open the Export modal while gated (durationMs === 0)", async () => {
    render(<TopBar />);
    await userEvent.click(screen.getByRole("button", { name: /export/i }));
    // The modal title is only present once the dialog opens.
    expect(screen.queryByRole("dialog", { name: /export video/i })).not.toBeInTheDocument();
  });

  it("transitions to enabled (grey → amber) once a clip gives the project a duration", async () => {
    render(<TopBar />);
    const exportBtn = screen.getByRole("button", { name: /export/i });
    expect(exportBtn).toHaveAttribute("aria-disabled", "true");

    // Add a clip to the seeded video track — the first "aha": Export comes alive.
    const trackId = get().project.tracks[0]!.id;
    act(() => {
      get().addClipFromAsset("asset-1", trackId, 0, 4000);
    });

    expect(selectProjectDurationMs(get())).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /export/i })).toHaveAttribute(
      "aria-disabled",
      "false",
    );
  });

  it("opens the Export modal once a duration exists", async () => {
    const trackId = get().project.tracks[0]!.id;
    act(() => {
      get().addClipFromAsset("asset-1", trackId, 0, 4000);
    });
    render(<TopBar />);
    await userEvent.click(screen.getByRole("button", { name: /export/i }));
    expect(screen.getByRole("dialog", { name: /export video/i })).toBeInTheDocument();
  });
});
