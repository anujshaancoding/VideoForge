import { describe, it, expect, vi, afterEach } from "vitest";
import { trackEvent } from "../analytics.js";

// The analytics shim contract (so Anchor can wire Sentry in Wave 2): trackEvent must
// no-op when no transport is present, route to a host hook when one exists, and never
// throw into the UI.
interface AnalyticsWindow {
  __vfAnalytics?: (name: string, data?: Record<string, unknown>) => void;
  Sentry?: {
    captureEvent?: (e: { message: string; level?: string; extra?: unknown }) => void;
  };
}

const w = window as unknown as AnalyticsWindow;

afterEach(() => {
  delete w.__vfAnalytics;
  delete w.Sentry;
});

describe("analytics.trackEvent", () => {
  it("no-ops (does not throw) when no transport is present", () => {
    expect(() => trackEvent("ttfe:export_complete", { projectId: "p1" })).not.toThrow();
  });

  it("routes to a host-injected __vfAnalytics hook with name + data", () => {
    const hook = vi.fn();
    w.__vfAnalytics = hook;
    trackEvent("ttfe:export_complete", { projectId: "p1", aspectRatio: "9:16" });
    expect(hook).toHaveBeenCalledTimes(1);
    expect(hook).toHaveBeenCalledWith("ttfe:export_complete", {
      projectId: "p1",
      aspectRatio: "9:16",
    });
  });

  it("forwards to Sentry.captureEvent with message + extra when present (Wave 2 shape)", () => {
    const captureEvent = vi.fn();
    w.Sentry = { captureEvent };
    trackEvent("ttfe:export_complete", { durationMs: 1234, projectId: "p1" });
    expect(captureEvent).toHaveBeenCalledWith({
      message: "ttfe:export_complete",
      level: "info",
      extra: { durationMs: 1234, projectId: "p1" },
    });
  });

  it("swallows transport errors so analytics never breaks the funnel", () => {
    w.__vfAnalytics = () => {
      throw new Error("transport boom");
    };
    expect(() => trackEvent("ttfe:export_complete")).not.toThrow();
  });
});
