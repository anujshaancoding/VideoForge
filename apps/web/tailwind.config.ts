import type { Config } from "tailwindcss";
// The shared preset maps every --vf-* design token (Design_Instructions_MVP.md §2)
// onto the Tailwind theme as CSS-variable references. The actual token *values* are
// emitted on :root in src/styles/tokens.css (see the contract / §2). Extending the
// preset here means a re-skin is "replace the CSS vars", not a Tailwind rewrite.
// The preset ships as CommonJS (.cjs); the package "exports" map resolves it.
import preset from "@videoforge/config/tailwind-preset";

const config: Config = {
  presets: [preset as Partial<Config>],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      boxShadow: {
        "vf-1": "0 1px 2px rgba(0,0,0,0.32)",
        "vf-2": "0 4px 12px rgba(0,0,0,0.40)",
        "vf-3": "0 12px 32px rgba(0,0,0,0.50)",
        "vf-4": "0 20px 48px rgba(0,0,0,0.58)",
        "vf-focus-accent": "0 0 0 3px rgba(255,122,26,0.35)",
        "vf-inset-well": "inset 0 1px 2px rgba(0,0,0,0.45)",
      },
      zIndex: {
        sticky: "50",
        topbar: "100",
        dropdown: "200",
        popover: "300",
        "context-menu": "400",
        tooltip: "500",
        "modal-scrim": "900",
        modal: "1000",
        toast: "1100",
      },
    },
  },
  plugins: [],
};

export default config;
