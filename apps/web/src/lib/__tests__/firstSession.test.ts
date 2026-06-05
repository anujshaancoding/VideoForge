import { describe, it, expect, beforeEach } from "vitest";
import {
  FIRST_SESSION_KEY,
  isFirstSession,
  markFirstSession,
  clearFirstSession,
} from "../firstSession.js";

// The first-session mechanic (ROADMAP Now #6): set on first empty-dashboard load,
// cleared on first export, and — crucially — fires/sets only ONCE per browser.
describe("firstSession", () => {
  beforeEach(() => {
    localStorage.removeItem(FIRST_SESSION_KEY);
  });

  it("is not a first session by default (no flag set)", () => {
    expect(isFirstSession()).toBe(false);
  });

  it("marks the first session exactly once for a brand-new browser", () => {
    expect(markFirstSession()).toBe(true);
    expect(isFirstSession()).toBe(true);
    // A second mark must be a no-op — never re-flag a creator who was already seen.
    expect(markFirstSession()).toBe(false);
    expect(isFirstSession()).toBe(true);
  });

  it("clears the flag and never re-flags after an export", () => {
    markFirstSession();
    expect(isFirstSession()).toBe(true);

    clearFirstSession();
    expect(isFirstSession()).toBe(false);

    // A returning creator landing on an empty dashboard must NOT be re-flagged.
    expect(markFirstSession()).toBe(false);
    expect(isFirstSession()).toBe(false);
  });
});
