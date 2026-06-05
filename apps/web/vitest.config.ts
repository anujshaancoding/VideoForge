import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// VideoForge web — Vitest config (Stage 2a unit + 2b component, per Pipeline §4.2).
// jsdom environment so React Testing Library can mount components headlessly;
// WebCodecs / Web Audio / WebGL are mocked in src/test/setup.ts (spec §22.2).
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    css: false,
    // clearMocks resets call history between tests; we deliberately do NOT use
    // restoreMocks (it would tear down the global jsdom mocks installed once in
    // src/test/setup.ts — e.g. matchMedia, AudioContext — after the first test).
    clearMocks: true,
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "html"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.{test,spec}.{ts,tsx}",
        "src/test/**",
        "src/main.tsx",
        "src/vite-env.d.ts",
        "src/**/index.ts",
      ],
    },
  },
});
