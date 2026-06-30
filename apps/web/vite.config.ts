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
    fs: {
      // Allow importing repo-root files (e.g. docs/USER_GUIDE.md?raw, rendered by
      // the /docs page) in dev. `../..` from apps/web resolves to the monorepo root
      // (matches Vite's default workspace-root allow; explicit here for clarity).
      allow: ["../.."],
    },
  },
  build: {
    target: "es2022",
    sourcemap: true,
    outDir: "dist",
  },
});
