import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";

// Auth storageState path — written by global-setup, consumed by all projects
// that require login. Generated on first run; committed to .gitignore.
const AUTH_FILE = path.join("e2e", ".auth", "session.json");

// When globalSetup is skipped (E2E_SKIP_AUTH=1) or hasn't run yet, the auth
// file may not exist. In that case we don't pass storageState so Playwright
// doesn't hard-error on startup. The app will fall back to /login (the spec's
// openEditor helper uses localStorage.removeItem + reload, which triggers the
// auth store's restore() path via the refresh cookie if one is present).
const authFileExists = fs.existsSync(AUTH_FILE);
const authState = authFileExists ? AUTH_FILE : undefined;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [["list"], ["html", { open: "never", outputFolder: "e2e-report" }]],
  // Visual-regression snapshots are platform-dependent (font rendering differs
  // macOS↔Linux). A small tolerance avoids antialiasing flakes; baselines are
  // regenerated per-platform with `--update-snapshots`.
  expect: {
    toHaveScreenshot: { maxDiffPixelRatio: 0.02, animations: "disabled" },
  },
  // globalSetup runs once before any test worker. It signs up (idempotent) +
  // logs in the e2e test user via the API and saves Playwright storageState to
  // e2e/.auth/session.json. Skip when the API is down (env var E2E_SKIP_AUTH=1).
  globalSetup: process.env["E2E_SKIP_AUTH"] ? undefined : "./e2e/global-setup.ts",
  use: {
    // Prefer the VS Code-managed server on 5173; fallback to 5174 if that's what Vite picked.
    baseURL: process.env.BASE_URL ?? "http://localhost:5173",
    headless: true,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "on-first-retry",
    // All projects share the authenticated session when it exists.
    // `authState` is undefined when globalSetup hasn't run yet (E2E_SKIP_AUTH=1
    // or first checkout). Tests degrade gracefully to the localStorage fallback
    // path in that case (the app seeds sampleProject from localStorage).
    storageState: authState,
  },
  projects: [
    {
      // Functional + accessibility e2e — the CI merge gate runs this project.
      // Visual specs are excluded here so CI never depends on platform-specific
      // screenshot baselines.
      name: "chromium",
      testIgnore: [/\.visual\.spec\.ts$/, /perf\.spec\.ts$/],
      use: {
        ...devices["Desktop Chrome"],
        storageState: authState,
      },
    },
    {
      // Opt-in visual-regression gate (run locally / in a pinned-OS job):
      //   pnpm exec playwright test --project=visual [--update-snapshots]
      name: "visual",
      testMatch: /\.visual\.spec\.ts$/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        storageState: authState,
      },
    },
    {
      // Performance gate — browser-based fps + seek-latency checks.
      // Run with: pnpm test:perf
      // Uses the same auth session as functional tests when available.
      // NOTE on determinism: see e2e/perf.spec.ts header for the
      // absolute-vs-relative-regression decision (flagged for Anchor/CEO).
      name: "perf",
      testMatch: /perf\.spec\.ts$/,
      use: {
        ...devices["Desktop Chrome"],
        storageState: authState,
      },
    },
  ],
  webServer: {
    command: "/usr/local/lib/node_modules/corepack/shims/pnpm --filter @videoforge/web dev",
    url: process.env.BASE_URL ?? "http://localhost:5173",
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
