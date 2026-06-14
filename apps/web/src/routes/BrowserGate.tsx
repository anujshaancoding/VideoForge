import { useCallback, useState } from "react";
import { getBrowserSupport } from "../lib/browser.js";
import { Button } from "../components/ui/index.js";
import { Play, ExternalLink } from "lucide-react";

// Browser gate (§4.4) — shown instead of the editor on non-Chromium / non-WebCodecs
// / mobile clients. Helpful and honest (not an error): explains WHY (WebCodecs /
// real-time preview) and offers Chrome/Edge + a copy-link affordance. No "continue
// anyway" into a broken editor. Single <main> landmark, fully keyboard operable.

export default function BrowserGate() {
  const support = getBrowserSupport();
  const [copied, setCopied] = useState(false);

  const copyLink = useCallback(() => {
    const url = typeof window !== "undefined" ? window.location.href : "";
    navigator.clipboard?.writeText(url).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      },
      () => setCopied(false),
    );
  }, []);

  const reason = !support.isDesktop
    ? "The MVP is desktop-only — open VideoForge on a laptop or desktop."
    : "VideoForge's real-time preview uses browser video tech (WebCodecs) that Safari and Firefox don't fully support yet.";

  return (
    <main className="flex min-h-full items-center justify-center bg-vf-bg-app p-12">
      <div className="w-full max-w-[560px] rounded-xl border border-vf-border-subtle bg-vf-surface-1 p-10 text-center shadow-vf-4">
        <div
          className="mx-auto mb-6 inline-flex h-12 w-12 items-center justify-center rounded-md bg-vf-accent-subtle text-2xl text-vf-accent-text"
          aria-hidden="true"
        >
          <Play className="h-6 w-6" aria-hidden="true" />
        </div>
        <div className="mb-2 text-sm font-semibold uppercase tracking-wide text-vf-accent-text">
          VideoForge
        </div>
        <h1 className="text-2xl font-bold text-vf-text-primary" role="alert">
          VideoForge works best in Chrome or Edge
        </h1>
        <p className="mx-auto mt-4 max-w-[420px] text-base text-vf-text-secondary">
          {reason} Open VideoForge in Chrome or Microsoft Edge on desktop for the full editor.
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Button variant="secondary" onClick={copyLink} aria-live="polite">
            {copied ? "Link copied" : "Copy link"}
          </Button>
          <a
            href="https://www.google.com/chrome/"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-9 items-center gap-1 rounded-md border border-vf-border-default bg-vf-surface-2 px-3 text-sm text-vf-text-primary hover:bg-vf-surface-3"
          >
            Get Chrome <ExternalLink className="h-3.5 w-3.5 inline" aria-hidden="true" />
          </a>
          <a
            href="https://www.microsoft.com/edge"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-9 items-center gap-1 rounded-md border border-vf-border-default bg-vf-surface-2 px-3 text-sm text-vf-text-primary hover:bg-vf-surface-3"
          >
            Get Edge <ExternalLink className="h-3.5 w-3.5 inline" aria-hidden="true" />
          </a>
        </div>

        <p className="mt-6 text-xs text-vf-text-tertiary">
          On mobile? The MVP is desktop-only — use a laptop or desktop.
        </p>
      </div>
    </main>
  );
}
