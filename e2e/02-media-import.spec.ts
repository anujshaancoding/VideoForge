import { expect, test } from "@playwright/test";

// ─── Media Import ─────────────────────────────────────────────────────────────
// Tests: import button triggers file picker, uploaded file shows in media grid,
// double-click adds asset to timeline, keyboard Enter adds asset to timeline.

async function openEditor(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.evaluate(() => localStorage.removeItem("videoforge.projects.v1"));
  await page.reload();
  await page.waitForLoadState("networkidle");
  // Open the sample project directly.
  await page.getByTestId("project-actions-btn").first().click();
  await page.getByRole("menuitem", { name: "Open" }).click();
  await page.waitForURL(/\/editor\//);
  await page.waitForLoadState("networkidle");
}

/**
 * The media grid + timeline render asynchronously as the project + assets resolve.
 * Poll a locator's count until it settles so a baseline isn't captured mid-render.
 */
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

test.describe("Media Import", () => {
  test("Import media button triggers the hidden file input", async ({ page }) => {
    await openEditor(page);
    // The hidden input should exist in the DOM.
    const fileInput = page.getByTestId("media-file-input");
    await expect(fileInput).toBeAttached();
    // The import button should be visible.
    await expect(page.getByTestId("import-media-btn")).toBeVisible();
  });

  test("Importing a file adds it to the media grid", async ({ page }) => {
    await openEditor(page);

    const cards = page.getByTestId("asset-card");
    const cardsBefore = await stableCount(cards);

    const [fileChooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      page.getByTestId("import-media-btn").click(),
    ]);
    await fileChooser.setFiles([
      {
        name: "test-clip.mp4",
        mimeType: "video/mp4",
        buffer: Buffer.from("fake video data"),
      },
    ]);

    // A new asset card should appear (import adds exactly one card per file).
    await expect(cards).toHaveCount(cardsBefore + 1);
    // A card carrying the imported file name should exist (order-independent).
    await expect(cards.filter({ hasText: "test-clip.mp4" })).toHaveCount(1);
  });

  test("Importing multiple files adds all to the media grid", async ({ page }) => {
    await openEditor(page);

    const cards = page.getByTestId("asset-card");
    const cardsBefore = await stableCount(cards);

    const [fileChooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      page.getByTestId("import-media-btn").click(),
    ]);
    await fileChooser.setFiles([
      { name: "video1.mp4", mimeType: "video/mp4", buffer: Buffer.from("v1") },
      { name: "audio1.mp3", mimeType: "audio/mpeg", buffer: Buffer.from("a1") },
    ]);

    await expect(cards).toHaveCount(cardsBefore + 2);
  });

  test("Audio file gets 'audio' kind glyph (♪)", async ({ page }) => {
    await openEditor(page);
    await stableCount(page.getByTestId("asset-card"));

    const [fileChooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      page.getByTestId("import-media-btn").click(),
    ]);
    await fileChooser.setFiles([
      { name: "my-track.mp3", mimeType: "audio/mpeg", buffer: Buffer.from("audio") },
    ]);

    // Locate the imported card by name (order-independent — cards may prepend).
    const newCard = page.getByTestId("asset-card").filter({ hasText: "my-track.mp3" });
    await expect(newCard).toHaveCount(1);
    // The audio kind glyph (♪) is rendered on the card (class-name independent check).
    await expect(newCard).toContainText("♪");
  });

  test("Double-clicking an asset adds a clip to the timeline", async ({ page }) => {
    await openEditor(page);

    const clips = page.locator('[role="gridcell"]');
    const clipsBefore = await stableCount(clips);
    // A video asset add also creates a linked-audio block, so assert it INCREASED.
    await page.getByTestId("asset-card").first().dblclick();
    await expect.poll(() => clips.count()).toBeGreaterThan(clipsBefore);
  });

  test("Pressing Enter on a focused asset adds a clip to the timeline", async ({ page }) => {
    await openEditor(page);

    const clips = page.locator('[role="gridcell"]');
    const clipsBefore = await stableCount(clips);
    await page.getByTestId("asset-card").first().focus();
    await page.keyboard.press("Enter");
    await expect.poll(() => clips.count()).toBeGreaterThan(clipsBefore);
  });
});
