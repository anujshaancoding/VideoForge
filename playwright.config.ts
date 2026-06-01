import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [["list"], ["html", { open: "never", outputFolder: "e2e-report" }]],
  use: {
    // Prefer the VS Code-managed server on 5173; fallback to 5174 if that's what Vite picked.
    baseURL: process.env.BASE_URL ?? "http://localhost:5173",
    headless: true,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "/usr/local/lib/node_modules/corepack/shims/pnpm --filter @videoforge/web dev",
    url: process.env.BASE_URL ?? "http://localhost:5173",
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
