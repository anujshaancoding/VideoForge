// ─────────────────────────────────────────────────────────────────────────────
// Browser support gate (Design_Instructions_MVP.md §4.4, Spec §15.1).
//
// MVP is Chrome/Edge desktop only — the real-time preview needs WebCodecs, which
// Safari/Firefox don't fully support yet. We detect a Chromium-family engine AND
// the presence of the WebCodecs `VideoDecoder` global, and we exclude mobile/touch
// viewports (no mobile/touch UI is in scope). Non-supported clients get the
// BrowserGate screen instead of a broken editor.
// ─────────────────────────────────────────────────────────────────────────────

export interface BrowserSupport {
  supported: boolean;
  isChromium: boolean;
  hasWebCodecs: boolean;
  isDesktop: boolean;
  /** Coarse engine label for diagnostics / copy. */
  engine: "chromium" | "webkit" | "gecko" | "unknown";
}

/** Detect a Chromium-family engine (Chrome, Edge) while excluding WebKit/Gecko. */
function detectChromium(ua: string): boolean {
  const isChrome = /\bChrome\//.test(ua) || /\bChromium\//.test(ua);
  const isEdge = /\bEdg\//.test(ua); // Edge (Chromium) reports "Edg/"
  // WebKit (Safari) and Gecko (Firefox) must be ruled out — Safari includes
  // "Safari" but not "Chrome"; Firefox includes "Gecko"/"Firefox".
  const isSafari = /\bSafari\//.test(ua) && !isChrome && !isEdge;
  const isFirefox = /\bFirefox\//.test(ua) || /\bGecko\/\d/.test(ua);
  return (isChrome || isEdge) && !isSafari && !isFirefox;
}

function detectEngine(ua: string): BrowserSupport["engine"] {
  if (detectChromium(ua)) return "chromium";
  if (/\bFirefox\//.test(ua)) return "gecko";
  if (/\bSafari\//.test(ua) && !/\bChrome\//.test(ua)) return "webkit";
  return "unknown";
}

/** WebCodecs presence — the load-bearing capability for the single decode path. */
function hasWebCodecs(): boolean {
  return typeof globalThis !== "undefined" && "VideoDecoder" in globalThis;
}

/** Heuristic desktop check — excludes mobile/touch viewports (out of scope). */
function isDesktopViewport(ua: string): boolean {
  const mobileUa = /Android|iPhone|iPad|iPod|Mobile|Tablet/i.test(ua);
  // Coarse pointer / no-touch is the most reliable signal where available.
  const coarsePointer =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches;
  return !mobileUa && !coarsePointer;
}

/** Full support breakdown (useful for the gate's diagnostic copy). */
export function getBrowserSupport(): BrowserSupport {
  const ua =
    typeof navigator !== "undefined" && typeof navigator.userAgent === "string"
      ? navigator.userAgent
      : "";
  const isChromium = detectChromium(ua);
  const webCodecs = hasWebCodecs();
  const desktop = isDesktopViewport(ua);
  return {
    supported: isChromium && webCodecs && desktop,
    isChromium,
    hasWebCodecs: webCodecs,
    isDesktop: desktop,
    engine: detectEngine(ua),
  };
}

/** True only on a WebCodecs-capable desktop Chromium (Chrome/Edge). */
export function isSupportedBrowser(): boolean {
  return getBrowserSupport().supported;
}
