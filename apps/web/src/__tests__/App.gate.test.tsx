import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

// Confirm the BrowserGate is wired around the APP routes (dashboard/editor) — not
// globally. After the landing-page work, the gate no longer replaces the whole app:
// the public landing + docs must render on any browser, and only entering the app
// (a logged-in user reaching the dashboard at "/") trips the gate on an unsupported
// browser. We mock refreshSession so the boot-time session restore resolves to a
// signed-in user, so "/" resolves to the (gated) dashboard rather than the landing.
//
// The companion "renders on any browser" contract — that a LOGGED-OUT visitor sees
// the marketing landing even on an unsupported browser — is covered in
// Landing.public.test.tsx (a separate file, for clean auth-store module state).

const { isSupportedBrowser } = vi.hoisted(() => ({ isSupportedBrowser: vi.fn() }));
vi.mock("../lib/browser.js", async () => {
  const actual = await vi.importActual<typeof import("../lib/browser.js")>("../lib/browser.js");
  return { ...actual, isSupportedBrowser };
});

const { refreshSession } = vi.hoisted(() => ({
  refreshSession: vi.fn(async () => ({
    accessToken: "tok",
    user: { id: "u1", email: "creator@studio.com", displayName: "Creator" },
  })),
}));
vi.mock("../lib/api.js", async () => {
  const actual = await vi.importActual<typeof import("../lib/api.js")>("../lib/api.js");
  return { ...actual, refreshSession };
});

// Keep the Dashboard's project fetch from hitting the network in jsdom.
vi.mock("../lib/projectStore.js", async () => {
  const actual = await vi.importActual<typeof import("../lib/projectStore.js")>(
    "../lib/projectStore.js",
  );
  return { ...actual, listProjects: vi.fn(async () => []) };
});

import App from "../App.js";

beforeEach(() => {
  isSupportedBrowser.mockReset();
});

describe("App browser gate wiring", () => {
  it("gates a logged-in user out of the app on an unsupported browser", async () => {
    isSupportedBrowser.mockReturnValue(false);
    render(<App />);
    // Once the boot-time session restore resolves, "/" tries to render the dashboard,
    // which is wrapped in the browser gate — so the gate's alert appears.
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/works best in Chrome or Edge/i),
    );
  });

  it("renders the app (not the gate) on a supported browser", async () => {
    isSupportedBrowser.mockReturnValue(true);
    render(<App />);
    // The gate's alert headline must NOT be present when the browser is supported.
    expect(screen.queryByText(/works best in Chrome or Edge/i)).not.toBeInTheDocument();
    // The Dashboard (root route) renders instead; wait for its async load to settle so
    // the post-render state update doesn't trip an act() warning.
    await waitFor(() =>
      expect(screen.getByText(/drop a video to start/i)).toBeInTheDocument(),
    );
  });
});
