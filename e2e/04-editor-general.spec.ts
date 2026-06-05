import { expect, test } from "@playwright/test";

// ─── Editor — general shell ───────────────────────────────────────────────────
// Tests: editor loads, panels visible, transport controls, undo/redo,
// inspector updates on clip select, new-project flow.

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

/**
 * The timeline renders its clip blocks (role="gridcell") asynchronously as the
 * project + asset metadata resolve. Poll until the count settles so a baseline
 * isn't captured mid-render (which produced flaky 0-counts).
 */
async function stableClipCount(page: import("@playwright/test").Page): Promise<number> {
  await page.locator('[role="gridcell"]').first().waitFor({ state: "visible" });
  let prev = -1;
  for (let i = 0; i < 12; i++) {
    const n = await page.locator('[role="gridcell"]').count();
    if (n === prev) return n;
    prev = n;
    await page.waitForTimeout(150);
  }
  return prev;
}

test.describe("Editor — shell layout", () => {
  test("all major panels are visible", async ({ page }) => {
    await openEditor(page);
    await expect(page.getByRole("complementary", { name: "Media library" })).toBeVisible();
    await expect(page.getByRole("slider", { name: "Playhead" })).toBeVisible();
  });

  test("Media / Text / Captions tabs switch content", async ({ page }) => {
    await openEditor(page);

    // Default tab is Media.
    await expect(page.getByTestId("import-media-btn")).toBeVisible();

    // Switch to Text.
    await page.getByRole("tab", { name: /T Text/ }).click();
    await expect(page.getByText("Title")).toBeVisible();
    await expect(page.getByTestId("import-media-btn")).not.toBeVisible();

    // Switch to Captions.
    await page.getByRole("tab", { name: /CC Captions/ }).click();
    await expect(page.getByText("Import .srt / .vtt")).toBeVisible();
  });

  test("media panel collapses and expands", async ({ page }) => {
    await openEditor(page);

    await page.getByRole("button", { name: "Collapse media panel" }).click();
    await expect(page.getByTestId("import-media-btn")).not.toBeVisible();

    await page.getByRole("button", { name: "Expand media panel" }).click();
    await expect(page.getByTestId("import-media-btn")).toBeVisible();
  });
});

test.describe("Editor — transport controls", () => {
  test("Space bar toggles play/pause state", async ({ page }) => {
    await openEditor(page);

    // The play/pause button lives in the transport toolbar.
    const toolbar = page.getByRole("toolbar", { name: "Playback controls" });
    const playBtn = toolbar.getByRole("button", { name: /^(Play|Pause)$/ });
    await expect(playBtn).toHaveAttribute("aria-label", "Play");

    // Click the body area (not an input) so the keydown reaches the editor handler.
    await page.locator('[role="banner"]').click({ position: { x: 8, y: 8 } }); // wordmark, not the centered rename button
    await page.keyboard.press("Space");

    await expect(playBtn).toHaveAttribute("aria-label", "Pause");

    // Press again to stop.
    await page.keyboard.press("Space");
    await expect(playBtn).toHaveAttribute("aria-label", "Play");
  });
});

test.describe("Editor — undo / redo", () => {
  test("Ctrl+Z undoes the last action", async ({ page }) => {
    await openEditor(page);

    // Wait for the initial clips to render so the baseline is stable.
    const clipsBefore = await stableClipCount(page);

    // Add a clip via the asset-card double-click (a video add may also create a
    // linked-audio block, so assert the count INCREASED rather than +1 exactly).
    await page.getByTestId("asset-card").first().dblclick();
    await expect.poll(() => page.locator('[role="gridcell"]').count()).toBeGreaterThan(
      clipsBefore,
    );

    // Undo — click the banner first so no input is focused.
    await page.locator('[role="banner"]').click({ position: { x: 8, y: 8 } }); // wordmark, not the centered rename button
    await page.keyboard.press("Control+Z");
    await expect(page.locator('[role="gridcell"]')).toHaveCount(clipsBefore);
  });

  test("Ctrl+Shift+Z redoes after undo", async ({ page }) => {
    await openEditor(page);

    const clipsBefore = await stableClipCount(page);
    await page.getByTestId("asset-card").first().dblclick();
    const clipsAfterAdd = await stableClipCount(page);
    expect(clipsAfterAdd).toBeGreaterThan(clipsBefore);

    await page.locator('[role="banner"]').click({ position: { x: 8, y: 8 } }); // wordmark, not the centered rename button
    await page.keyboard.press("Control+Z");
    await expect(page.locator('[role="gridcell"]')).toHaveCount(clipsBefore);

    await page.keyboard.press("Control+Shift+Z");
    await expect(page.locator('[role="gridcell"]')).toHaveCount(clipsAfterAdd);
  });
});

test.describe("New project flow", () => {
  test("creating a 16:9 project opens the editor", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => localStorage.removeItem("videoforge.projects.v1"));
    await page.reload();
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: "+ New" }).click();
    await page.waitForURL(/\/new/);

    // The aspect-ratio tiles use role="radio"; their accessible name is the ratio label.
    await page.getByRole("radio", { name: "16:9" }).click();

    // Create is enabled only after a ratio is selected.
    await expect(page.getByRole("button", { name: "Create project" })).toBeEnabled();
    await page.getByRole("button", { name: "Create project" }).click();

    await page.waitForURL(/\/editor\//);
    await expect(page.getByRole("complementary", { name: "Media library" })).toBeVisible();
  });
});
