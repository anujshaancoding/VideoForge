import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.js";
import "./styles/index.css";
import "./styles/design.css";
import "./styles/editor.css";

// VideoForge web entry point. Mounts the app into #root. The dark theme is the only
// theme for MVP — the `dark` class + color-scheme are set on <html> in index.html.

const container = document.getElementById("root");
if (!container) {
  throw new Error("VideoForge: #root element not found in index.html");
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
