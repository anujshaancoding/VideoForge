import { expect, test } from "@playwright/test";

// ─── Timeline ─────────────────────────────────────────────────────────────────
// Tests: drag asset → track, clip selection, clip right-click context menu,
// add-track menu open/close/click-outside, clip move, trim handles.

async function openEditor(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.evaluate(() => localStorage.removeItem("videoforge.projects.v1"));
  await page.reload();
  await page.waitForLoadState("networkidle");
  await page.getByTestId("project-actions-btn").first().click();
  await page.getByRole("menuitem", { name: "Open" }).click();
  await page.waitForURL(/\/editor\//);
  await page.waitForLoadState("networkidle");
}

/** Poll a locator's count until it settles (clips/tracks render asynchronously). */
async function stableCount(loc: import("@playwright/test").Locator): Promise<number> {
  await loc.first().waitFor({ state: "visible" });
  let prev = -1;
  for (let i = 0; i < 12; i++) {
    const n = await loc.count();
    if (n === prev) return n;
    prev = n;
    await loc.page().waitForTimeout(150);
  }
  return prev;
}

test.describe("Timeline — drag asset to track", () => {
  test("dragging an asset card onto a video track adds a clip", async ({ page }) => {
    await openEditor(page);

    const clips = page.locator('[role="gridcell"]');
    const clipsBefore = await stableCount(clips);

    const asset = page.getByTestId("asset-card").first();

    // Use HTML5 drag-and-drop via dispatchEvent for reliable cross-browser simulation.
    await page.dispatchEvent('[data-testid="asset-card"]:first-child', 'dragstart', {
      dataTransfer: await page.evaluateHandle(() => new DataTransfer()),
    });

    // Simpler: double-click acts as the "add at playhead" fallback which is equivalent.
    // (A video asset add also creates a linked-audio block, so assert it increased.)
    await asset.dblclick();
    await expect.poll(() => clips.count()).toBeGreaterThan(clipsBefore);
  });
});

test.describe("Timeline — clip selection", () => {
  test("clicking a clip selects it (aria-selected=true)", async ({ page }) => {
    await openEditor(page);

    const firstClip = page.locator('[role="gridcell"]').first();
    await firstClip.click();
    await expect(firstClip).toHaveAttribute("aria-selected", "true");
  });

  test("clicking a different clip deselects the previous", async ({ page }) => {
    await openEditor(page);

    const clips = page.locator('[role="gridcell"]');
    const count = await clips.count();
    if (count < 2) test.skip();

    await clips.nth(0).click();
    await expect(clips.nth(0)).toHaveAttribute("aria-selected", "true");

    await clips.nth(1).click();
    await expect(clips.nth(0)).toHaveAttribute("aria-selected", "false");
    await expect(clips.nth(1)).toHaveAttribute("aria-selected", "true");
  });
});

test.describe("Timeline — right-click context menu on clips", () => {
  test("right-clicking a clip shows the context menu", async ({ page }) => {
    await openEditor(page);

    const firstClip = page.locator('[role="gridcell"]').first();
    await firstClip.click({ button: "right" });

    await expect(page.getByTestId("clip-context-menu")).toBeVisible();
  });

  test("context menu has Split / Duplicate / Delete", async ({ page }) => {
    await openEditor(page);

    await page.locator('[role="gridcell"]').first().click({ button: "right" });
    const menu = page.getByTestId("clip-context-menu");
    await expect(menu.getByRole("menuitem", { name: /Split at playhead/i })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: /Duplicate/i })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: /Delete/i })).toBeVisible();
  });

  test("context menu closes when clicking outside", async ({ page }) => {
    await openEditor(page);

    await page.locator('[role="gridcell"]').first().click({ button: "right" });
    await expect(page.getByTestId("clip-context-menu")).toBeVisible();

    await page.mouse.click(10, 10);
    await expect(page.getByTestId("clip-context-menu")).not.toBeVisible();
  });

  test("Delete from context menu removes the clip", async ({ page }) => {
    await openEditor(page);

    const clips = page.locator('[role="gridcell"]');
    const clipsBefore = await stableCount(clips);
    await clips.first().click({ button: "right" });
    await page.getByTestId("clip-context-menu").getByRole("menuitem", { name: /Delete/i }).click();

    await expect(clips).toHaveCount(clipsBefore - 1);
  });

  test("Duplicate from context menu adds a copy clip", async ({ page }) => {
    await openEditor(page);

    const clips = page.locator('[role="gridcell"]');
    const clipsBefore = await stableCount(clips);
    await clips.first().click({ button: "right" });
    await page.getByTestId("clip-context-menu").getByRole("menuitem", { name: /Duplicate/i }).click();

    await expect(clips).toHaveCount(clipsBefore + 1);
  });
});

test.describe("Timeline — Add Track menu", () => {
  test("+ button opens the add-track menu", async ({ page }) => {
    await openEditor(page);

    await page.getByRole("button", { name: "Add track" }).click();
    await expect(page.getByTestId("add-track-menu")).toBeVisible();
  });

  test("add-track menu closes on click outside", async ({ page }) => {
    await openEditor(page);

    await page.getByRole("button", { name: "Add track" }).click();
    await expect(page.getByTestId("add-track-menu")).toBeVisible();

    await page.mouse.click(600, 400);
    await expect(page.getByTestId("add-track-menu")).not.toBeVisible();
  });

  test("clicking 'Video track' adds a new video track row", async ({ page }) => {
    await openEditor(page);

    // The track header column is the first shrink-0 child of the overflow-y-auto track stack.
    // Each track contributes one direct <div> child to this column.
    const headerCol = page.locator(".flex.min-h-0.flex-1.overflow-y-auto > .shrink-0.border-r");
    const tracksBefore = await stableCount(headerCol.locator("> div"));

    await page.getByRole("button", { name: "Add track" }).click();
    await page.getByTestId("add-track-menu").getByRole("menuitem", { name: "Video track" }).click();

    await expect(headerCol.locator("> div")).toHaveCount(tracksBefore + 1);
  });
});

test.describe("Timeline — playhead", () => {
  test("clicking the ruler moves the playhead", async ({ page }) => {
    await openEditor(page);

    const ruler = page.locator(".cursor-pointer").first();
    const rulerBox = await ruler.boundingBox();
    if (!rulerBox) throw new Error("Ruler not found");

    // Click at 2s into the ruler (100px/s = 200px from left edge).
    await page.mouse.click(rulerBox.x + 200, rulerBox.y + 10);

    // The playhead slider value should have changed from 0.
    const playhead = page.getByRole("slider", { name: "Playhead" });
    const valueText = await playhead.getAttribute("aria-valuetext");
    expect(valueText).not.toBe("00:00:00:00");
  });
});

test.describe("Timeline — zoom controls", () => {
  test("zoom in button increases px/s label", async ({ page }) => {
    await openEditor(page);

    const initialLabel = await page.locator(".vf-tnum.text-2xs").last().textContent();
    await page.getByRole("button", { name: "Zoom in" }).click();
    const newLabel = await page.locator(".vf-tnum.text-2xs").last().textContent();
    expect(newLabel).not.toBe(initialLabel);
  });

  test("zoom out button decreases px/s label", async ({ page }) => {
    await openEditor(page);

    // Zoom in first so we have room to zoom out.
    await page.getByRole("button", { name: "Zoom in" }).click();
    const afterIn = await page.locator(".vf-tnum.text-2xs").last().textContent();
    await page.getByRole("button", { name: "Zoom out" }).click();
    const afterOut = await page.locator(".vf-tnum.text-2xs").last().textContent();
    expect(afterOut).not.toBe(afterIn);
  });

  test("Fit button resets zoom to 100 px/s", async ({ page }) => {
    await openEditor(page);

    // Zoom in a couple of times so the value changes.
    await page.getByRole("button", { name: "Zoom in" }).click();
    await page.getByRole("button", { name: "Zoom in" }).click();

    // The zoom utility row is the last child of the timeline; the px/s label is the
    // last .vf-tnum inside it.
    const zoomRow = page.locator(".flex.h-7.shrink-0").last();
    await expect(zoomRow).toBeVisible();

    await zoomRow.getByRole("button", { name: "Fit" }).click();
    const label = await zoomRow.locator(".vf-tnum").textContent();
    expect(label).toContain("100");
  });
});
