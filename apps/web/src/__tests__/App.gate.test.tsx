import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

// ROADMAP Now #9 — confirm the BrowserGate is wired into the ROOT of the app (not just
// that the component renders in isolation). On an unsupported browser, App must render
// the gate INSTEAD of any route/editor; on a supported one, it must render the router.
//
// Wave 2: the supported-browser path now sits behind auth. We mock refreshSession so
// the boot-time session restore resolves to a signed-in user — then the router renders
// the Dashboard (root route) rather than /login.

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
  it("renders the BrowserGate (not the editor/router) on an unsupported browser", () => {
    isSupportedBrowser.mockReturnValue(false);
    render(<App />);
    expect(screen.getByRole("alert")).toHaveTextContent(/works best in Chrome or Edge/i);
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
