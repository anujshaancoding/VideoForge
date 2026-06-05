// ─────────────────────────────────────────────────────────────────────────────
// firstSession — the onboarding "first-session" mechanic (ROADMAP Now #6).
//
// A single localStorage flag (`vf_first_session`) marks a brand-new creator who has
// not yet completed their first export. It is:
//   • SET   the first time the Dashboard loads with zero projects (markFirstSession)
//   • READ  inline by first-session-only hints (isFirstSession) — no provider/context
//   • CLEARED on the first successful export (clearFirstSession)
//
// MVP-STUB: this is a per-browser localStorage flag. Core/Vera replace it with a real
// per-user "has-exported" flag once auth lands (Wave 2). All access is wrapped so a
// disabled/throwing localStorage (private mode, quota) can never break the funnel.
// ─────────────────────────────────────────────────────────────────────────────

export const FIRST_SESSION_KEY = "vf_first_session";

/** True when this browser is in its first session (set, never cleared by an export). */
export function isFirstSession(): boolean {
  try {
    return localStorage.getItem(FIRST_SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Mark the first session, but ONLY if the flag has never been set/cleared before —
 * so a creator who already exported (flag cleared) is never re-flagged on an empty
 * dashboard. Returns true if it set the flag on this call.
 */
export function markFirstSession(): boolean {
  try {
    // `null` = never seen this browser; "1" = first session; "0" = already exported.
    if (localStorage.getItem(FIRST_SESSION_KEY) === null) {
      localStorage.setItem(FIRST_SESSION_KEY, "1");
      return true;
    }
  } catch {
    // localStorage unavailable — first-session hints simply won't show. Non-fatal.
  }
  return false;
}

/** Clear the first-session flag (called once, on the first successful export). */
export function clearFirstSession(): void {
  try {
    // "0" (not removeItem) so markFirstSession never re-flags a returning creator.
    localStorage.setItem(FIRST_SESSION_KEY, "0");
  } catch {
    // Non-fatal.
  }
}
