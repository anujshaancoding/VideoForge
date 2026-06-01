import path from "path";
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

    const cardsBefore = await page.getByTestId("asset-card").count();

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

    // A new asset card should appear.
    await expect(page.getByTestId("asset-card")).toHaveCount(cardsBefore + 1);
    // The card's title attribute should contain the file name.
    await expect(page.getByTestId("asset-card").last()).toContainText("test-clip.mp4");
  });

  test("Importing multiple files adds all to the media grid", async ({ page }) => {
    await openEditor(page);

    const cardsBefore = await page.getByTestId("asset-card").count();

    const [fileChooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      page.getByTestId("import-media-btn").click(),
    ]);
    await fileChooser.setFiles([
      { name: "video1.mp4", mimeType: "video/mp4", buffer: Buffer.from("v1") },
      { name: "audio1.mp3", mimeType: "audio/mpeg", buffer: Buffer.from("a1") },
    ]);

    await expect(page.getByTestId("asset-card")).toHaveCount(cardsBefore + 2);
  });

  test("Audio file gets 'audio' kind glyph (♪)", async ({ page }) => {
    await openEditor(page);

    const [fileChooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      page.getByTestId("import-media-btn").click(),
    ]);
    await fileChooser.setFiles([
      { name: "my-track.mp3", mimeType: "audio/mpeg", buffer: Buffer.from("audio") },
    ]);

    const newCard = page.getByTestId("asset-card").last();
    await expect(newCard).toBeVisible();
    // The text label strip should contain the file name.
    await expect(newCard).toContainText("my-track.mp3");
    // The glyph area spans the card thumbnail — check its text is ♪
    await expect(newCard.locator(".text-lg").first()).toHaveText("♪");
  });

  test("Double-clicking an asset adds a clip to the timeline", async ({ page }) => {
    await openEditor(page);

    const clipsBefore = await page.locator('[role="gridcell"]').count();
    await page.getByTestId("asset-card").first().dblclick();
    await expect(page.locator('[role="gridcell"]')).toHaveCount(clipsBefore + 1);
  });

  test("Pressing Enter on a focused asset adds a clip to the timeline", async ({ page }) => {
    await openEditor(page);

    const clipsBefore = await page.locator('[role="gridcell"]').count();
    await page.getByTestId("asset-card").first().focus();
    await page.keyboard.press("Enter");
    await expect(page.locator('[role="gridcell"]')).toHaveCount(clipsBefore + 1);
  });
});
