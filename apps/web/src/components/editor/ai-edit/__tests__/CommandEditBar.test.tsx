import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, act, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { sampleProject } from "@videoforge/project-schema";
import { useEditorStore } from "../../../../store/editorStore.js";
import CommandEditBar from "../CommandEditBar.js";

const get = () => useEditorStore.getState();

/** Load the sample project and select its first video clip so the target pill resolves. */
function loadWithSelectedClip(): string {
  act(() => {
    get().loadProject(structuredClone(sampleProject));
  });
  const videoTrack = get().project.tracks.find((t) => t.type === "video");
  if (!videoTrack || videoTrack.type !== "video") throw new Error("missing video track");
  const clipId = videoTrack.clips[0]!.id;
  act(() => {
    get().select("clip", clipId);
  });
  return clipId;
}

beforeEach(() => {
  loadWithSelectedClip();
});

describe("CommandEditBar — structured typeahead", () => {
  it("builds 'increase brightness by 10%' slot-by-slot and reaches the preview panel", async () => {
    const user = userEvent.setup();
    render(<CommandEditBar />);

    const input = screen.getByRole("combobox");
    await user.click(input);

    // Slot 1 (ACTION): type "incr" → accept the single "increase" suggestion with Tab.
    await user.type(input, "incr");
    await user.keyboard("{Tab}");
    expect(screen.getByLabelText(/action: increase/i)).toBeInTheDocument();

    // Slot 2 (PROPERTY): type "bright" → accept "brightness".
    await user.type(input, "bright");
    await user.keyboard("{Tab}");
    expect(screen.getByLabelText(/property: brightness/i)).toBeInTheDocument();

    // Slot 3 (VALUE): type "10" → live parsed-value "by 10%" pinned first → Enter.
    await user.type(input, "10");
    await user.keyboard("{Enter}");
    expect(screen.getByLabelText(/value: by 10%/i)).toBeInTheDocument();

    // Command is complete → Run is enabled (aria-disabled false).
    const run = screen.getByRole("button", { name: /run command/i });
    expect(run).toHaveAttribute("aria-disabled", "false");

    // Run → preview panel (AIEditPreviewPanel) renders with the Apply CTA.
    await user.click(run);
    // The preview Apply button is present (preview-before-apply); project unchanged.
    expect(await screen.findByRole("button", { name: /apply edits/i })).toBeInTheDocument();
    expect(screen.getAllByText(/increase brightness by 10%/i).length).toBeGreaterThan(0);
  });

  it("Run uses sky-blue (--vf-selection), NOT amber (--vf-accent)", async () => {
    const user = userEvent.setup();
    render(<CommandEditBar />);
    const input = screen.getByRole("combobox");
    await user.click(input);
    await user.type(input, "incr");
    await user.keyboard("{Tab}");
    await user.type(input, "bright");
    await user.keyboard("{Tab}");
    await user.type(input, "10");
    await user.keyboard("{Enter}");

    const run = screen.getByRole("button", { name: /run command/i });
    expect(run.className).toContain("bg-vf-selection");
    expect(run.className).not.toContain("bg-vf-accent");
  });

  it("Backspace on an empty input removes the last pill", async () => {
    const user = userEvent.setup();
    render(<CommandEditBar />);
    const input = screen.getByRole("combobox");
    await user.click(input);

    await user.type(input, "incr");
    await user.keyboard("{Tab}");
    await user.type(input, "bright");
    await user.keyboard("{Tab}");
    // Two pills now present (action + property).
    expect(screen.getByLabelText(/property: brightness/i)).toBeInTheDocument();

    // Input is empty → Backspace removes the most recent pill (property).
    await user.keyboard("{Backspace}");
    expect(screen.queryByLabelText(/property: brightness/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/action: increase/i)).toBeInTheDocument();
  });

  it("renders the resolved target pill from the clip selection", () => {
    render(<CommandEditBar />);
    // The context pill is a role=status with the resolved clip name (sample clip).
    const targetPill = screen.getByRole("status", { name: /target:/i });
    expect(targetPill).toBeInTheDocument();
    expect(targetPill.textContent).not.toMatch(/no clip selected/i);
  });

  it("produces a runnable plan for a split command (Command Editing v1 — gap closed)", async () => {
    const user = userEvent.setup();
    render(<CommandEditBar />);
    const input = screen.getByRole("combobox");
    await user.click(input);

    // split → at 0:05 — the sole "clip" property is auto-resolved, so the bar jumps
    // straight to the value slot (fluid typing). The parser now has a split rule, so
    // planFromSlots yields a real plan and the bar advances to confirm/apply.
    await user.type(input, "split");
    await user.keyboard("{Tab}");
    await user.type(input, "0:05");
    await user.keyboard("{Enter}");

    const run = screen.getByRole("button", { name: /run command/i });
    expect(run).toHaveAttribute("aria-disabled", "false");
    await user.click(run);
    // The split command is now applyable — the obsolete "available yet" message
    // must NOT appear.
    expect(screen.queryByText(/available yet/i)).not.toBeInTheDocument();
  });

  it("sets commandDryRunRange when a ranged command completes; clears it on Apply", async () => {
    const user = userEvent.setup();
    render(<CommandEditBar />);
    const input = screen.getByRole("combobox");
    await user.click(input);

    // No band before a command runs.
    expect(get().commandDryRunRange).toBeNull();

    // trim → 0:01 to 0:03 (sole "clip" property auto-resolved; within sample clip 0:00–0:04).
    await user.type(input, "trim");
    await user.keyboard("{Tab}");
    await user.type(input, "0:01 to 0:03");
    await user.keyboard("{Enter}");

    const run = screen.getByRole("button", { name: /run command/i });
    await user.click(run);

    // Dry-run band is now set to the trimmed ms range (seconds → ms).
    expect(get().commandDryRunRange).toEqual({ startMs: 1000, endMs: 3000 });

    // Apply clears the transient band.
    const apply = await screen.findByRole("button", { name: /apply edits/i });
    await user.click(apply);
    expect(get().commandDryRunRange).toBeNull();
  });

  it("clears commandDryRunRange when the preview is cancelled", async () => {
    const user = userEvent.setup();
    render(<CommandEditBar />);
    const input = screen.getByRole("combobox");
    await user.click(input);

    await user.type(input, "trim");
    await user.keyboard("{Tab}");
    await user.type(input, "0:01 to 0:03");
    await user.keyboard("{Enter}");
    await user.click(screen.getByRole("button", { name: /run command/i }));
    expect(get().commandDryRunRange).not.toBeNull();

    // Cancel (the footer button) clears the band.
    await user.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(get().commandDryRunRange).toBeNull();
    // D-4: Cancel also clears the built pills, returning the bar to an empty state.
    expect(screen.queryByText("trim")).not.toBeInTheDocument();
    expect(screen.queryByText("0:01 to 0:03")).not.toBeInTheDocument();
  });

  it("AC-7: a destructive delete command shows the warning callout + 'Confirm delete' CTA", async () => {
    const user = userEvent.setup();
    render(<CommandEditBar />);
    const input = screen.getByRole("combobox");
    await user.click(input);

    // delete → 0:01 to 0:03 (sole "range" property auto-resolved; within sample clip
    // 0:00–0:04 so the plan is valid and Apply is enabled). Destructive ⇒ warning + confirm.
    await user.type(input, "delete");
    await user.keyboard("{Tab}");
    await user.type(input, "0:01 to 0:03");
    await user.keyboard("{Enter}");

    await user.click(screen.getByRole("button", { name: /run command/i }));

    // Warning banner is rendered (role=alert) above the Apply button.
    const warning = await screen.findByRole("alert");
    expect(warning.textContent).toMatch(/cannot be easily reversed/i);

    // Apply CTA uses the confirm-variant label, not "Apply edits".
    const confirm = screen.getByRole("button", { name: /confirm delete/i });
    expect(confirm).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /apply edits/i })).not.toBeInTheDocument();

    // Brand invariant: the CTA is sky-blue (--vf-selection), never amber (--vf-accent).
    expect(confirm.className).toContain("bg-vf-selection");
    expect(confirm.className).not.toContain("bg-vf-accent");
  });

  it("renders a 9-grid position picker for spatial properties (text overlay)", async () => {
    const user = userEvent.setup();
    render(<CommandEditBar />);
    const input = screen.getByRole("combobox");
    await user.click(input);

    // add → text overlay → "Hello" → POSITION slot opens with the 9-grid.
    await user.type(input, "add");
    await user.keyboard("{Tab}");
    await user.type(input, "text");
    await user.keyboard("{Tab}");
    await user.type(input, '"Hello"');
    await user.keyboard("{Enter}");

    // The anchor grid is present.
    const grid = await screen.findByRole("group", { name: /position anchor grid/i });
    expect(within(grid).getByRole("button", { name: /top-left/i })).toBeInTheDocument();
  });
});
