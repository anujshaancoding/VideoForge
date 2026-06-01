import { useMemo } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { isSupportedBrowser } from "./lib/browser.js";
import BrowserGate from "./routes/BrowserGate.js";
import Dashboard from "./routes/Dashboard.js";
import NewProjectModal from "./routes/NewProjectModal.js";
import Editor from "./routes/Editor.js";
import { EditorErrorBoundary } from "./components/editor/index.js";

// App root + routing (§3.2).
//   "/"            Dashboard (project grid / empty state)
//   "/new"         New Project modal (the aspect-ratio chooser) — rendered over "/"
//   "/editor/:id"  Editor (the six-band shell)
//
// Browser gate: a WebCodecs-capable desktop Chromium (Chrome/Edge) is required.
// Unsupported clients get BrowserGate instead of any route — never a broken editor
// (§4.4). The check runs once at mount (the engine doesn't change mid-session).

export default function App() {
  const supported = useMemo(() => isSupportedBrowser(), []);

  if (!supported) {
    return <BrowserGate />;
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        {/* The new-project modal renders the dashboard underneath for context (§4.3). */}
        <Route
          path="/new"
          element={
            <>
              <Dashboard />
              <NewProjectModal />
            </>
          }
        />
        <Route path="/editor/:id" element={<EditorErrorBoundary><Editor /></EditorErrorBoundary>} />
        {/* Unknown routes fall back to the dashboard. */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
