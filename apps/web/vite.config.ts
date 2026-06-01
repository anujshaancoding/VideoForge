import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// VideoForge web app — Vite 5 + React 18.
// The dev server is the single entry point for `pnpm dev` at the repo root
// (`pnpm --filter @videoforge/web dev`).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: false,
  },
  build: {
    target: "es2022",
    sourcemap: true,
    outDir: "dist",
  },
});
