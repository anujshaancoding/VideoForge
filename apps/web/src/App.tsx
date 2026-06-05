import { useEffect, useMemo, type ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { isSupportedBrowser } from "./lib/browser.js";
import BrowserGate from "./routes/BrowserGate.js";
import Dashboard from "./routes/Dashboard.js";
import NewProjectModal from "./routes/NewProjectModal.js";
import Editor from "./routes/Editor.js";
import { LoginScreen, SignupScreen } from "./routes/AuthScreen.js";
import { EditorErrorBoundary } from "./components/editor/index.js";
import { useAuthStore } from "./store/authStore.js";

// App root + routing (§3.2).
//   "/login"       Login screen      (unauthenticated only)
//   "/signup"      Signup screen     (unauthenticated only)
//   "/"            Dashboard (project grid / empty state)   — auth required
//   "/new"         New Project modal (the aspect-ratio chooser) — rendered over "/"
//   "/editor/:id"  Editor (the six-band shell)              — auth required
//
// Gating order (outermost → innermost):
//   1. BrowserGate — a WebCodecs-capable desktop Chromium is required (§4.4). This
//      stays the outermost gate, BEFORE auth: an unsupported browser never sees a
//      login form it can't usefully act on.
//   2. Auth — on boot we POST /refresh to silently restore a session from the
//      `vf_refresh` cookie; while that's in flight we hold rendering. Logged-out
//      users are routed to /login; logged-in users reach the Dashboard, where the
//      existing first-session onboarding funnel still runs on the empty grid.

function RequireAuth({ children }: { children: ReactNode }) {
  const user = useAuthStore((s) => s.user);
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function RedirectIfAuthed({ children }: { children: ReactNode }) {
  const user = useAuthStore((s) => s.user);
  if (user) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function AuthedRoutes() {
  const initializing = useAuthStore((s) => s.initializing);
  const restore = useAuthStore((s) => s.restore);

  // Boot: restore a session from the refresh cookie (silent on failure).
  useEffect(() => {
    void restore();
  }, [restore]);

  // Hold rendering until the boot refresh resolves so we don't flash /login at a
  // user who actually has a valid cookie session.
  if (initializing) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex min-h-full items-center justify-center bg-vf-bg-app text-sm text-vf-text-secondary"
      >
        Loading VideoForge…
      </div>
    );
  }

  return (
    <Routes>
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
      <Route
        path="/"
        element={
          <RequireAuth>
            <Dashboard />
          </RequireAuth>
        }
      />
      {/* The new-project modal renders the dashboard underneath for context (§4.3). */}
      <Route
        path="/new"
        element={
          <RequireAuth>
            <Dashboard />
            <NewProjectModal />
          </RequireAuth>
        }
      />
      <Route
        path="/editor/:id"
        element={
          <RequireAuth>
            <EditorErrorBoundary>
              <Editor />
            </EditorErrorBoundary>
          </RequireAuth>
        }
      />
      {/* Unknown routes fall back to the dashboard (which itself gates on auth). */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  const supported = useMemo(() => isSupportedBrowser(), []);

  if (!supported) {
    return <BrowserGate />;
  }

  return (
    <BrowserRouter>
      <AuthedRoutes />
    </BrowserRouter>
  );
}
