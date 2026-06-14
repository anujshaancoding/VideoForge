import { expect, test } from "@playwright/test";

// ─── Dashboard ────────────────────────────────────────────────────────────────
// Tests cover: load, project card menu open/close, click-outside dismiss,
// new-project navigation, delete flow.

test.describe("Dashboard", () => {
  test.beforeEach(async ({ page }) => {
    // Clear localStorage so the seeded sample project is always present.
    await page.goto("/");
    await page.evaluate(() => localStorage.removeItem("videoforge.projects.v1"));
    await page.reload();
    await page.waitForLoadState("networkidle");
  });

  test("loads and shows the sample project card", async ({ page }) => {
    await expect(page.getByText("Summer Sale Promo")).toBeVisible();
  });

  test("project card ⋯ menu opens on click", async ({ page }) => {
    await page.getByTestId("project-actions-btn").first().waitFor({ state: "visible", timeout: 15000 });
  await page.getByTestId("project-actions-btn").first().click();
    await expect(page.getByTestId("project-card-menu")).toBeVisible();
  });

  test("project card menu closes when clicking outside", async ({ page }) => {
    await page.getByTestId("project-actions-btn").first().waitFor({ state: "visible", timeout: 15000 });
  await page.getByTestId("project-actions-btn").first().click();
    await expect(page.getByTestId("project-card-menu")).toBeVisible();
    // Click the page background (outside the menu).
    await page.mouse.click(10, 10);
    await expect(page.getByTestId("project-card-menu")).not.toBeVisible();
  });

  test("menu has Open / Duplicate / Delete items", async ({ page }) => {
    await page.getByTestId("project-actions-btn").first().waitFor({ state: "visible", timeout: 15000 });
  await page.getByTestId("project-actions-btn").first().click();
    const menu = page.getByTestId("project-card-menu");
    await expect(menu.getByRole("menuitem", { name: "Open" })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Duplicate" })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Delete" })).toBeVisible();
  });

  test("Duplicate creates a copy card", async ({ page }) => {
    await page.getByTestId("project-actions-btn").first().waitFor({ state: "visible", timeout: 15000 });
  await page.getByTestId("project-actions-btn").first().click();
    await page.getByRole("menuitem", { name: "Duplicate" }).click();
    await expect(page.getByText("Summer Sale Promo (copy)")).toBeVisible();
  });

  test("Delete shows confirm modal then removes the project", async ({ page }) => {
    // Create a fresh project we can safely delete.
    await page.getByTestId("project-actions-btn").first().waitFor({ state: "visible", timeout: 15000 });
  await page.getByTestId("project-actions-btn").first().click();
    await page.getByRole("menuitem", { name: "Duplicate" }).click();
    await expect(page.getByText("Summer Sale Promo (copy)")).toBeVisible();

    // Find the copy card's actions button.
    const cards = page.locator("li").filter({ hasText: "Summer Sale Promo (copy)" });
    await cards.getByTestId("project-actions-btn").click();
    await page.getByRole("menuitem", { name: "Delete" }).click();

    // Confirm modal should appear.
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("button", { name: "Delete" }).last().click();

    // Card is gone.
    await expect(page.getByText("Summer Sale Promo (copy)")).not.toBeVisible();
  });

  test("New project button navigates to /new", async ({ page }) => {
    await page.getByRole("button", { name: "+ New" }).click();
    await expect(page).toHaveURL(/\/new/);
  });

  test("Open project navigates to editor", async ({ page }) => {
    await page.getByTestId("project-actions-btn").first().waitFor({ state: "visible", timeout: 15000 });
  await page.getByTestId("project-actions-btn").first().click();
    await page.getByRole("menuitem", { name: "Open" }).click();
    await expect(page).toHaveURL(/\/editor\//);
  });
});
