import { Suspense, lazy, useEffect, type ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { isSupportedBrowser } from "./lib/browser.js";
import BrowserGate from "./routes/BrowserGate.js";
import Landing from "./routes/Landing.js";
import Dashboard from "./routes/Dashboard.js";
import NewProjectModal from "./routes/NewProjectModal.js";
import ScriptStudio from "./routes/ScriptStudio.js";
import Editor from "./routes/Editor.js";
import { LoginScreen, SignupScreen } from "./routes/AuthScreen.js";
import { EditorErrorBoundary } from "./components/editor/index.js";
import { useAuthStore } from "./store/authStore.js";

// Docs renders the canonical user guide via a `?raw` markdown import; lazy-load it
// so the guide ships in its own chunk (off the main editor bundle) and only loads
// when someone actually visits /docs.
const Docs = lazy(() => import("./routes/Docs.js"));

// App root + routing (§3.2).
//   "/"            Landing (public marketing) when logged out · Dashboard when logged in
//   "/docs"        User guide (public — any browser, no auth)
//   "/login"       Login screen      (unauthenticated only)
//   "/signup"      Signup screen     (unauthenticated only)
//   "/new"         New Project modal (the aspect-ratio chooser) — rendered over the dashboard
//   "/script"      Script Studio
//   "/editor/:id"  Editor (the six-band shell)
//
// Two independent gates, applied per-route (NOT globally) so the public marketing
// surfaces stay reachable everywhere:
//   • Browser support — the editor/dashboard need a WebCodecs-capable desktop
//     Chromium (§4.4). This is wrapped around the APP routes only; the Landing and
//     Docs pages must render on Safari/Firefox/mobile so visitors can learn about
//     VideoForge before they're gated.
//   • Auth — on boot we POST /refresh to silently restore a session from the
//     `vf_refresh` cookie; while that's in flight, auth-only routes hold rendering
//     so we never flash /login at a user who actually has a valid cookie session.

/** Loading placeholder shown while the boot-time session restore is in flight. */
function AuthLoading() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-screen items-center justify-center bg-vf-bg-app text-sm text-vf-text-secondary"
    >
      Loading VideoForge…
    </div>
  );
}

/** App routes (editor/dashboard/etc.) require a WebCodecs-capable desktop Chromium. */
function RequireSupportedBrowser({ children }: { children: ReactNode }) {
  if (!isSupportedBrowser()) return <BrowserGate />;
  return <>{children}</>;
}

function RequireAuth({ children }: { children: ReactNode }) {
  const initializing = useAuthStore((s) => s.initializing);
  const user = useAuthStore((s) => s.user);
  if (initializing) return <AuthLoading />;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function RedirectIfAuthed({ children }: { children: ReactNode }) {
  const initializing = useAuthStore((s) => s.initializing);
  const user = useAuthStore((s) => s.user);
  if (initializing) return <AuthLoading />;
  if (user) return <Navigate to="/" replace />;
  return <>{children}</>;
}

// Root: logged-in users get the dashboard (behind the browser gate); everyone else
// gets the public landing page. The landing renders immediately — it never waits on
// the auth-restore network call, so it works even before the backend is reachable.
function Home() {
  const user = useAuthStore((s) => s.user);
  if (user) {
    return (
      <RequireSupportedBrowser>
        <Dashboard />
      </RequireSupportedBrowser>
    );
  }
  return <Landing />;
}

function AppRoutes() {
  const restore = useAuthStore((s) => s.restore);

  // Boot: restore a session from the refresh cookie (silent on failure).
  useEffect(() => {
    void restore();
  }, [restore]);

  return (
    <Routes>
      {/* Public — any browser, no auth. */}
      <Route path="/" element={<Home />} />
      <Route
        path="/docs"
        element={
          <Suspense fallback={<AuthLoading />}>
            <Docs />
          </Suspense>
        }
      />

      {/* Auth screens — reachable on any browser; entering the app is gated below. */}
      <Route
        path="/login"
        element={
          <RedirectIfAuthed>
            <LoginScreen />
          </RedirectIfAuthed>
        }
      />
      <Route
        path="/signup"
        element={
          <RedirectIfAuthed>
            <SignupScreen />
          </RedirectIfAuthed>
        }
      />

      {/* The new-project modal renders the dashboard underneath for context (§4.3). */}
      <Route
        path="/new"
        element={
          <RequireAuth>
            <RequireSupportedBrowser>
              <Dashboard />
              <NewProjectModal />
            </RequireSupportedBrowser>
          </RequireAuth>
        }
      />
      {/* Script Studio v2 — paste a script → plan → generate → open editor (§ Contract D). */}
      <Route
        path="/script"
        element={
          <RequireAuth>
            <RequireSupportedBrowser>
              <ScriptStudio />
            </RequireSupportedBrowser>
          </RequireAuth>
        }
      />
      <Route
        path="/editor/:id"
        element={
          <RequireAuth>
            <RequireSupportedBrowser>
              <EditorErrorBoundary>
                <Editor />
              </EditorErrorBoundary>
            </RequireSupportedBrowser>
          </RequireAuth>
        }
      />
      {/* Unknown routes fall back to the landing/dashboard root. */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter
      future={{
        v7_startTransition: true,
        v7_relativeSplatPath: true,
      }}
    >
      <AppRoutes />
    </BrowserRouter>
  );
}
