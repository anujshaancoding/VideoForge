import { expect, test } from "@playwright/test";

// ─── Visual regression (opt-in) ──────────────────────────────────────────────
// The spec's "visual review gate": baseline the stable app chrome so unintended
// visual changes are caught. Runs ONLY under the `visual` Playwright project
// (excluded from the CI merge gate, which must not depend on platform-specific
// screenshots). Manage baselines with:
//   pnpm exec playwright test --project=visual --update-snapshots
//
// Dynamic regions (relative timestamps) are masked so the snapshot is stable.

async function gotoDashboard(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.evaluate(() => localStorage.removeItem("videoforge.projects.v1"));
  await page.reload();
  await page.waitForLoadState("networkidle");
  await page.getByTestId("project-actions-btn").first().waitFor({ state: "visible" });
}

test("dashboard", async ({ page }) => {
  await gotoDashboard(page);
  await expect(page).toHaveScreenshot("dashboard.png", {
    fullPage: true,
    mask: [page.locator(".text-vf-text-tertiary")], // relative timestamps change daily
  });
});

test("new project aspect chooser", async ({ page }) => {
  await gotoDashboard(page);
  await page.getByRole("button", { name: "+ New" }).click();
  await page.waitForURL(/\/new/);
  await page.waitForLoadState("networkidle");
  await expect(page).toHaveScreenshot("new-project-chooser.png", { fullPage: true });
});
