import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import * as Sentry from "@sentry/react";
import App from "./App.js";
import "./styles/index.css";
import "./styles/design.css";
import "./styles/editor.css";
import "./styles/landing.css";

// ── Sentry (ROADMAP #10) ───────────────────────────────────────────────────
// Initialise BEFORE the React render.  When VITE_SENTRY_DSN is blank/absent
// `enabled: false` makes every Sentry call a no-op — no network traffic, no
// overhead, no error.  The `environment` field maps to the Vite build mode
// ("development" in `vite dev`, "production" in `vite build`).
// Cast to string — VITE_SENTRY_DSN is always a string at runtime (empty string
// when unset). `enabled: false` prevents any Sentry traffic when it is blank.
const _sentryDsn = import.meta.env.VITE_SENTRY_DSN as string;
Sentry.init({
  ...((_sentryDsn) ? { dsn: _sentryDsn } : {}),
  enabled: !!_sentryDsn,
  environment: import.meta.env.MODE,
});

// Expose the initialised Sentry instance on window so Pixel's analytics shim
// (apps/web/src/lib/analytics.ts) can reach captureEvent / captureMessage
// without a direct import.  The shim checks window.Sentry at call-time, so
// this assignment races safely even if trackEvent() is called early.
(window as unknown as Record<string, unknown>)["Sentry"] = Sentry;

// VideoForge web entry point. Mounts the app into #root. The dark theme is the only
// theme for MVP — the `dark` class + color-scheme are set on <html> in index.html.

// ── DEV-only QA hook ─────────────────────────────────────────────────────────
// Exposes the auth + editor stores on window so an automated QA session can drive
// the editor without standing up auth/DB (no account, no password). Gated to
// `import.meta.env.DEV` so it never ships in a production build.
if (import.meta.env.DEV) {
  void Promise.all([import("./store/authStore.js"), import("./store/editorStore.js")]).then(
    ([auth, editor]) => {
      (window as unknown as Record<string, unknown>)["__vf"] = {
        useAuthStore: auth.useAuthStore,
        useEditorStore: editor.useEditorStore,
      };
    },
  );
}

const container = document.getElementById("root");
if (!container) {
  throw new Error("VideoForge: #root element not found in index.html");
}

createRoot(container).render(
  <StrictMode>
    <Sentry.ErrorBoundary
      fallback={({ error }) => (
        <div style={{ padding: "2rem", color: "#FF7A1A", fontFamily: "monospace" }}>
          <strong>VideoForge encountered an unexpected error.</strong>
          <pre style={{ marginTop: "1rem", fontSize: "0.8rem", opacity: 0.7 }}>
            {error instanceof Error ? error.message : String(error)}
          </pre>
        </div>
      )}
    >
      <App />
    </Sentry.ErrorBoundary>
  </StrictMode>,
);
