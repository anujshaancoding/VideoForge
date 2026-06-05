import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// ─── Accessibility (axe-core) ─────────────────────────────────────────────────
// Automated WCAG 2.0/2.1 A + AA scan on the key screens (the runtime counterpart
// to the static jsx-a11y lint). The dashboard is held to ZERO violations. The
// editor has a KNOWN backlog (the timeline's grid semantics + a handful of
// low-contrast tokens) tracked as an allowlist below — the gate fails on any NEW
// rule violation outside that list, so regressions are caught while the backlog is
// worked down. The allowlist is intentionally explicit (no silent suppression).

async function gotoDashboard(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.evaluate(() => localStorage.removeItem("videoforge.projects.v1"));
  await page.reload();
  await page.waitForLoadState("networkidle");
}

async function openEditor(page: import("@playwright/test").Page) {
  await gotoDashboard(page);
  await page.getByTestId("project-actions-btn").first().click();
  await page.getByRole("menuitem", { name: "Open" }).click();
  await page.waitForURL(/\/editor\//);
  await page.locator('[role="gridcell"]').first().waitFor({ state: "visible" });
}

const axe = (page: import("@playwright/test").Page) =>
  new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]);

test.describe("Accessibility — axe-core", () => {
  test("dashboard has no WCAG A/AA violations", async ({ page }) => {
    await gotoDashboard(page);
    const results = await axe(page).analyze();
    expect(
      results.violations,
      results.violations.map((v) => `${v.impact}: ${v.id}`).join("\n"),
    ).toEqual([]);
  });

  test("editor has no NEW violations beyond the tracked backlog", async ({ page }) => {
    await openEditor(page);
    const results = await axe(page).analyze();

    // KNOWN backlog (tracked, being worked down). New rule IDs outside this set
    // must fail the gate. See the timeline grid-semantics + contrast follow-ups.
    const KNOWN_BACKLOG = new Set([
      "aria-required-parent", // timeline clips (role=gridcell) lack a role=row ancestor
      "aria-required-children", // timeline container grid semantics
      "color-contrast", // a few design tokens below 4.5:1 on muted text
    ]);

    const unexpected = results.violations.filter((v) => !KNOWN_BACKLOG.has(v.id));
    expect(
      unexpected,
      unexpected.map((v) => `${v.impact}: ${v.id} (${v.nodes.length})`).join("\n"),
    ).toEqual([]);

    // Surface the known backlog so it stays visible in CI output.
    const backlog = results.violations.filter((v) => KNOWN_BACKLOG.has(v.id));
    if (backlog.length) {
      // eslint-disable-next-line no-console
      console.log(
        "[a11y backlog — editor]\n" +
          backlog.map((v) => `  ${v.impact}: ${v.id} ×${v.nodes.length}`).join("\n"),
      );
    }
  });
});
