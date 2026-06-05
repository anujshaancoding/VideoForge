// ─────────────────────────────────────────────────────────────────────────────
// VideoForge ESLint flat config (CI Stage 1 — static analysis).
//
// Goals: catch real correctness bugs (React rules-of-hooks, undeclared globals,
// unsafe patterns) without a wall of stylistic noise that destabilises the gate.
// - typescript-eslint "recommended" (no type-info → fast, no per-file project).
// - react-hooks: rules-of-hooks = ERROR (real bugs), exhaustive-deps = warn.
// - jsx-a11y "recommended" downgraded to WARN so it surfaces issues on the web app
//   without blocking merges while the backlog is worked down.
// Warnings do not fail the build; only errors do.
// ─────────────────────────────────────────────────────────────────────────────

import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import jsxA11y from "eslint-plugin-jsx-a11y";
import globals from "globals";

/** jsx-a11y recommended rules, all downgraded to "warn". */
const a11yWarnings = Object.fromEntries(
  Object.keys(jsxA11y.configs.recommended.rules).map((rule) => [rule, "warn"]),
);

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/coverage/**",
      ".claude/**",
      "**/*.config.{js,ts,cjs,mjs}",
      "**/*.cjs",
      "e2e-report/**",
      "test-results/**",
      "design-export/**",
      "claude design assets/**",
      "scripts/**",
      "infra/**",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  // Baseline for all TS/TSX across the monorepo.
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      "no-empty": ["warn", { allowEmptyCatch: true }],
    },
  },

  // Web app: React hooks correctness + accessibility (a11y as warnings).
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks, "jsx-a11y": jsxA11y },
    rules: {
      ...a11yWarnings,
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      // autoFocus on the editor canvas / modals is intentional and tested.
      "jsx-a11y/no-autofocus": "off",
      // Deprecated, superseded by label-has-associated-control; it false-positives
      // on our labels that correctly associate via htmlFor + id (Slider, Field).
      "jsx-a11y/label-has-for": "off",
    },
  },

  // Tests + Playwright specs: relax type strictness, allow test globals.
  {
    files: ["**/*.{test,spec}.{ts,tsx}", "**/__tests__/**", "**/test/**", "e2e/**"],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
);
