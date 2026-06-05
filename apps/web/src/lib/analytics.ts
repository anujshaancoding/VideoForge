// ─────────────────────────────────────────────────────────────────────────────
// analytics — a tiny, dependency-free event shim (ROADMAP Now #6).
//
// CONTRACT (so Anchor can wire real Sentry in Wave 2):
//   trackEvent(name, data?)  Fire a named analytics event with an optional flat
//                            data payload. NEVER throws and NEVER blocks the UI —
//                            a failing/absent transport must not break the funnel.
//
// Transport resolution (first present wins; all optional):
//   1. window.__vfAnalytics(name, data)         — a host-injected hook (tests/QA)
//   2. window.Sentry.captureMessage(name, {...}) — real Sentry once Anchor wires it
//   3. no-op                                     — default when nothing is present
//
// Event names are colon-namespaced strings (e.g. "ttfe:export_complete"). `data`
// is a flat record of JSON-serialisable values (numbers/strings/booleans). When a
// Sentry transport is used, `data` is forwarded as the `extra` context, matching
// the brief's hook point:
//   Sentry.captureEvent({ message:'ttfe:export_complete', extra:{...} })
// ─────────────────────────────────────────────────────────────────────────────

export type AnalyticsValue = string | number | boolean | null | undefined;
export type AnalyticsData = Record<string, AnalyticsValue>;

/** A host-injected analytics hook (used by QA/tests; Anchor may also point this at Sentry). */
type VfAnalyticsHook = (name: string, data?: AnalyticsData) => void;

/** Minimal shape of the Sentry surface we use — declared locally so we add no dependency. */
interface SentryLike {
  captureMessage?: (
    message: string,
    context?: { level?: string; extra?: AnalyticsData | undefined },
  ) => void;
  captureEvent?: (event: {
    message: string;
    level?: string;
    extra?: AnalyticsData | undefined;
  }) => void;
}

interface AnalyticsWindow {
  __vfAnalytics?: VfAnalyticsHook;
  Sentry?: SentryLike;
}

/**
 * Fire a named analytics event. Dependency-free and resilient: if no transport is
 * present (the MVP default), it is a silent no-op. Any transport error is swallowed
 * so analytics can never break a user-facing flow (e.g. the first export).
 */
export function trackEvent(name: string, data?: AnalyticsData): void {
  if (typeof window === "undefined") return;
  const w = window as unknown as AnalyticsWindow;
  try {
    // 1. Explicit host hook (deterministic for tests / QA harnesses).
    if (typeof w.__vfAnalytics === "function") {
      w.__vfAnalytics(name, data);
      return;
    }
    // 2. Real Sentry, once Anchor wires it (Wave 2). Prefer captureEvent (the brief's
    //    hook shape); fall back to captureMessage if only that is available.
    const sentry = w.Sentry;
    if (sentry?.captureEvent) {
      sentry.captureEvent({ message: name, level: "info", extra: data });
      return;
    }
    if (sentry?.captureMessage) {
      sentry.captureMessage(name, { level: "info", extra: data });
      return;
    }
    // 3. No transport present — no-op (the MVP default).
  } catch {
    // Analytics must never surface an error into the UI.
  }
}
