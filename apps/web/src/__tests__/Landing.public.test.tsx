import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

// The public landing page must render on ANY browser — including an unsupported
// one (Safari/Firefox/mobile) — for a LOGGED-OUT visitor, so people can learn about
// VideoForge before they're gated into the Chrome/Edge-only editor. This is the
// counterpart to App.gate.test.tsx, which covers the gated (logged-in) app path.
//
// Kept in its own file so the auth-store module singletons (`restorePromise` /
// global state) start clean: here the boot refresh resolves to NO session.

const { isSupportedBrowser } = vi.hoisted(() => ({ isSupportedBrowser: vi.fn(() => false) }));
vi.mock("../lib/browser.js", async () => {
  const actual = await vi.importActual<typeof import("../lib/browser.js")>("../lib/browser.js");
  return { ...actual, isSupportedBrowser };
});

// No session — refresh resolves to null, so the store settles to a logged-out state.
const { refreshSession } = vi.hoisted(() => ({ refreshSession: vi.fn(async () => null) }));
vi.mock("../lib/api.js", async () => {
  const actual = await vi.importActual<typeof import("../lib/api.js")>("../lib/api.js");
  return { ...actual, refreshSession };
});

import App from "../App.js";

describe("public landing page", () => {
  it("renders the marketing landing for a logged-out visitor on an unsupported browser", async () => {
    render(<App />);

    // The hero headline and primary CTA render — no browser gate, no login redirect.
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /the export matches your edit/i })).toBeInTheDocument(),
    );
    expect(screen.getByRole("link", { name: /start editing free/i })).toBeInTheDocument();

    // The browser gate must NOT replace the marketing page.
    expect(screen.queryByText(/works best in Chrome or Edge/i)).not.toBeInTheDocument();
  });
});
