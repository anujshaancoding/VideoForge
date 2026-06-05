// ─────────────────────────────────────────────────────────────────────────────
// Editor *view* preferences — lightweight, UI-only workspace state that should
// survive a browser reload so the editor feels stable (timeline zoom, which
// left-panel tab is open, whether the left panel is collapsed).
//
// IMPORTANT: this is intentionally SEPARATE from project-document persistence.
//   • It lives under its OWN localStorage key (never the project store key) so it
//     can never interfere with — or be mistaken for — the saved project document.
//   • It carries NO editable project data (no clips/tracks/overlays); only
//     ephemeral view chrome. Losing it is cosmetic, so localStorage is the right
//     (and only) home — it never round-trips to the API.
// ─────────────────────────────────────────────────────────────────────────────

const LS_KEY = 'videoforge.viewPrefs.v1';

export type LeftPanelTab = 'media' | 'text' | 'captions';

export interface ViewPrefs {
  /** Timeline scale in pixels-per-second (mirrors editorStore.zoom). */
  timelineZoom: number;
  /** Active section in the left media rail. */
  leftPanelTab: LeftPanelTab;
  /** Whether the left media rail is collapsed. */
  leftPanelCollapsed: boolean;
}

/** Read the persisted view prefs, tolerating absent / corrupt / partial data. */
export function readViewPrefs(): Partial<ViewPrefs> {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    const p = parsed as Record<string, unknown>;
    const out: Partial<ViewPrefs> = {};
    if (typeof p.timelineZoom === 'number' && Number.isFinite(p.timelineZoom)) {
      out.timelineZoom = p.timelineZoom;
    }
    if (p.leftPanelTab === 'media' || p.leftPanelTab === 'text' || p.leftPanelTab === 'captions') {
      out.leftPanelTab = p.leftPanelTab;
    }
    if (typeof p.leftPanelCollapsed === 'boolean') {
      out.leftPanelCollapsed = p.leftPanelCollapsed;
    }
    return out;
  } catch {
    return {};
  }
}

/** Merge + persist a partial view-prefs patch (last-write-wins per key). */
export function writeViewPrefs(patch: Partial<ViewPrefs>): void {
  try {
    const next = { ...readViewPrefs(), ...patch };
    localStorage.setItem(LS_KEY, JSON.stringify(next));
  } catch {
    // quota / disabled storage — non-fatal; view prefs are cosmetic.
  }
}
