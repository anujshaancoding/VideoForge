import { expect, test } from "@playwright/test";

// ─── Export modal + Inspector ─────────────────────────────────────────────────
// Broadens journey coverage onto two major UI surfaces the suite didn't exercise:
// the Free-tier export modal (watermark mandatory, NO upgrade CTA — a locked
// product decision) and the right-hand Inspector (empty-state → clip properties).

async function openEditor(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.evaluate(() => localStorage.removeItem("videoforge.projects.v1"));
  await page.reload();
  await page.waitForLoadState("networkidle");
  await page.getByTestId("project-actions-btn").first().waitFor({ state: "visible", timeout: 15000 });
  await page.getByTestId("project-actions-btn").first().click();
  await page.getByRole("menuitem", { name: "Open" }).click();
  await page.waitForURL(/\/editor\//);
  await page.locator('[role="gridcell"]').first().waitFor({ state: "visible" });
}

test.describe("Export modal — Free-tier", () => {
  test("opens with the mandatory watermark notice and a resolution control", async ({ page }) => {
    await openEditor(page);
    await page.getByRole("button", { name: "Export" }).click();

    const dialog = page.getByRole("dialog", { name: "Export video" });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByText(/watermark is added to exports on the free plan/i),
    ).toBeVisible();
    // 1080p Free-tier cap is the max option.
    await expect(dialog.getByRole("combobox").first()).toBeVisible();
    await expect(dialog.locator("option", { hasText: "1080p" })).toHaveCount(1);
  });

  test("offers NO upgrade CTA (Free-tier only is a locked decision)", async ({ page }) => {
    await openEditor(page);
    await page.getByRole("button", { name: "Export" }).click();
    const dialog = page.getByRole("dialog", { name: "Export video" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/upgrade|go pro|premium plan|unlock/i)).toHaveCount(0);
  });

  test("closes via Cancel", async ({ page }) => {
    await openEditor(page);
    await page.getByRole("button", { name: "Export" }).click();
    const dialog = page.getByRole("dialog", { name: "Export video" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).not.toBeVisible();
  });
});

test.describe("Inspector", () => {
  test("shows the empty state until a clip is selected, then its properties", async ({ page }) => {
    await openEditor(page);
    const inspector = page.getByRole("complementary", { name: "Inspector" });

    await expect(inspector.getByText("Select a clip to edit its properties.")).toBeVisible();

    await page.locator('[role="gridcell"]').first().click();

    await expect(inspector.getByText("Select a clip to edit its properties.")).toHaveCount(0);
    await expect(inspector.getByRole("button", { name: "Delete selected" })).toBeVisible();
  });
});
