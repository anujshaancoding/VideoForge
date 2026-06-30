/**
 * Focused accessibility test for CommandEditBar — Sentinel AC coverage.
 *
 * Uses axe-core directly (available in the monorepo root node_modules) to run
 * automated WCAG 2.0/2.1 A + AA rules against the rendered component in jsdom.
 * This is the unit-level companion to the Playwright axe scan in
 * `e2e/05-accessibility.spec.ts`; it covers the Command Bar specifically since
 * the e2e scan runs against the full editor page (not focused on this widget).
 *
 * Note: `axe-core` requires a real DOM. jsdom satisfies that for automated-rule
 * checks; pixel-contrast rules are skipped because jsdom does not compute
 * computed styles from CSS custom properties (color-contrast would false-negative).
 * That gap is covered by the Playwright scan which runs in a real browser.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { sampleProject } from "@videoforge/project-schema";
import { useEditorStore } from "../../../../store/editorStore.js";
import CommandEditBar from "../CommandEditBar.js";

const get = () => useEditorStore.getState();

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

async function runAxe(container: HTMLElement) {
  const results = await axe.run(container, {
    // Skip color-contrast: jsdom does not resolve CSS custom properties, so all
    // --vf-* token colours would fail spuriously. Covered by Playwright e2e.
    rules: { "color-contrast": { enabled: false } },
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
  });
  return results;
}

beforeEach(() => {
  loadWithSelectedClip();
});

describe("CommandEditBar — axe WCAG A/AA (unit-level, no e2e runner needed)", () => {
  it("has no WCAG A/AA violations in the idle state (dropdown closed)", async () => {
    const { container } = render(<CommandEditBar />);
    const results = await runAxe(container);
    expect(
      results.violations,
      results.violations.map((v) => `${v.impact}: ${v.id} — ${v.help}\n  ${v.nodes.map((n) => n.html).join("\n  ")}`).join("\n\n"),
    ).toEqual([]);
  });

  it("has no WCAG A/AA violations with the dropdown open (action slot)", async () => {
    const user = userEvent.setup();
    const { container } = render(<CommandEditBar />);
    const input = screen.getByRole("combobox");
    await user.click(input);
    // Dropdown is now open; re-run axe on the live DOM.
    const results = await runAxe(container);
    expect(
      results.violations,
      results.violations.map((v) => `${v.impact}: ${v.id} — ${v.help}`).join("\n"),
    ).toEqual([]);
  });

  it("has no WCAG A/AA violations after slots are filled (preview panel visible)", async () => {
    const user = userEvent.setup();
    const { container } = render(<CommandEditBar />);
    const input = screen.getByRole("combobox");
    await user.click(input);
    await user.type(input, "incr");
    await user.keyboard("{Tab}");
    await user.type(input, "bright");
    await user.keyboard("{Tab}");
    await user.type(input, "10");
    await user.keyboard("{Enter}");
    await user.click(screen.getByRole("button", { name: /run command/i }));
    // Preview panel is now rendered.
    await screen.findByRole("button", { name: /apply edits/i });
    const results = await runAxe(container);
    expect(
      results.violations,
      results.violations.map((v) => `${v.impact}: ${v.id} — ${v.help}`).join("\n"),
    ).toEqual([]);
  });
});

describe("CommandEditBar — ARIA combobox pattern correctness (AC-6)", () => {
  it("input has role=combobox with correct aria-haspopup, aria-expanded, aria-controls", async () => {
    const user = userEvent.setup();
    render(<CommandEditBar />);
    const input = screen.getByRole("combobox");

    // Before focus: may be collapsed.
    expect(input).toHaveAttribute("aria-haspopup", "listbox");
    expect(input).toHaveAttribute("aria-controls", "vf-cmd-slot-list");
    expect(input).toHaveAttribute("aria-autocomplete", "list");

    // After click: expanded.
    await user.click(input);
    expect(input).toHaveAttribute("aria-expanded", "true");
  });

  it("aria-activedescendant updates as the highlighted option changes (arrow navigation)", async () => {
    const user = userEvent.setup();
    render(<CommandEditBar />);
    const input = screen.getByRole("combobox");
    await user.click(input);

    // ArrowDown moves highlight to index 1.
    await user.keyboard("{ArrowDown}");
    const descendant = input.getAttribute("aria-activedescendant");
    // aria-activedescendant should point to one of the option divs.
    expect(descendant).toMatch(/^vf-cmd-opt-\d+$/);
    if (descendant) {
      const referenced = document.getElementById(descendant);
      expect(referenced).not.toBeNull();
      expect(referenced?.getAttribute("role")).toBe("option");
    }
  });

  it("options have role=option and aria-selected reflecting keyboard highlight", async () => {
    const user = userEvent.setup();
    render(<CommandEditBar />);
    const input = screen.getByRole("combobox");
    await user.click(input);

    const listbox = document.getElementById("vf-cmd-slot-list");
    expect(listbox).not.toBeNull();
    expect(listbox?.getAttribute("role")).toBe("listbox");

    const options = document.querySelectorAll("[role='option']");
    expect(options.length).toBeGreaterThan(0);

    // After ArrowDown once: option[1] gets aria-selected=true.
    await user.keyboard("{ArrowDown}");
    const selected = document.querySelectorAll("[role='option'][aria-selected='true']");
    expect(selected.length).toBe(1);
  });

  it("live region (role=status, aria-live=polite) exists for announcements", () => {
    render(<CommandEditBar />);
    // There are TWO role=status elements: the target pill AND the live region.
    const statusEls = document.querySelectorAll("[role='status']");
    const liveRegions = [...statusEls].filter(
      (el) => el.getAttribute("aria-live") === "polite",
    );
    expect(liveRegions.length).toBeGreaterThanOrEqual(1);
    const liveRegion = liveRegions[0]!;
    expect(liveRegion.getAttribute("aria-atomic")).toBe("true");
    expect(liveRegion.className).toContain("sr-only");
  });

  it("target pill renders as role=status so screen readers announce resolution changes", () => {
    render(<CommandEditBar />);
    const targetPill = screen.getByRole("status", { name: /target:/i });
    expect(targetPill).toBeInTheDocument();
  });

  it("Escape closes the dropdown without clearing slots (first press)", async () => {
    const user = userEvent.setup();
    render(<CommandEditBar />);
    const input = screen.getByRole("combobox");
    await user.click(input);
    expect(input).toHaveAttribute("aria-expanded", "true");
    await user.keyboard("{Escape}");
    expect(input).toHaveAttribute("aria-expanded", "false");
  });

  it("Backspace on empty input removes the last accepted pill (keyboard pill removal)", async () => {
    const user = userEvent.setup();
    render(<CommandEditBar />);
    const input = screen.getByRole("combobox");
    await user.click(input);
    await user.type(input, "incr");
    await user.keyboard("{Tab}");
    expect(screen.getByLabelText(/action: increase/i)).toBeInTheDocument();
    await user.keyboard("{Backspace}");
    expect(screen.queryByLabelText(/action: increase/i)).not.toBeInTheDocument();
  });

  it("pill X buttons have accessible names (Remove '<label>')", async () => {
    const user = userEvent.setup();
    render(<CommandEditBar />);
    const input = screen.getByRole("combobox");
    await user.click(input);
    await user.type(input, "incr");
    await user.keyboard("{Tab}");
    const removeBtn = screen.getByRole("button", { name: /remove 'increase'/i });
    expect(removeBtn).toBeInTheDocument();
  });

  it("Run button uses sky-blue (bg-vf-selection), not amber (bg-vf-accent) — brand invariant", async () => {
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

  it("9-grid position buttons have aria-label and aria-pressed attributes", async () => {
    const user = userEvent.setup();
    render(<CommandEditBar />);
    const input = screen.getByRole("combobox");
    await user.click(input);

    await user.type(input, "add");
    await user.keyboard("{Tab}");
    await user.type(input, "text");
    await user.keyboard("{Tab}");
    await user.type(input, '"Hello"');
    await user.keyboard("{Enter}");

    // Position grid is rendered.
    const grid = await screen.findByRole("group", { name: /position anchor grid/i });
    const gridButtons = grid.querySelectorAll("button");
    expect(gridButtons.length).toBe(9);
    for (const btn of gridButtons) {
      expect(btn).toHaveAttribute("aria-label");
      expect(btn).toHaveAttribute("aria-pressed");
    }
  });
});
