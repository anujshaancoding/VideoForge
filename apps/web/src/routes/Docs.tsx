// ─────────────────────────────────────────────────────────────────────────────
// Public documentation page ("/docs").
//
// Renders the canonical user guide (docs/USER_GUIDE.md) so there is exactly one
// source of truth — edit the markdown, the page updates. Like the landing page,
// this is reachable on ANY browser (no WebCodecs gate, no auth) so people can read
// how VideoForge works before signing in.
// ─────────────────────────────────────────────────────────────────────────────

import { Link } from "react-router-dom";
import { Film, ArrowLeft } from "lucide-react";
// Single source of truth — the same guide referenced across the repo docs.
import guideMarkdown from "../../../../docs/USER_GUIDE.md?raw";
import { renderMarkdown } from "../lib/markdown.js";

export default function Docs() {
  const { toc, content } = renderMarkdown(guideMarkdown);
  const sections = toc.filter((t) => t.level === 2);

  return (
    <div className="min-h-screen bg-vf-bg-app text-vf-text-primary">
      {/* ── Top nav ───────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-20 border-b border-vf-border-subtle bg-vf-bg-app/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <Film className="h-5 w-5 text-vf-accent" aria-hidden />
            <span>VideoForge</span>
          </Link>
          <nav className="flex items-center gap-2">
            <Link
              to="/"
              className="inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium text-vf-text-secondary transition-colors hover:text-vf-text-primary"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden /> Home
            </Link>
            <Link
              to="/signup"
              className="rounded-md bg-vf-accent px-3.5 py-2 text-sm font-semibold text-vf-text-inverse transition-colors hover:bg-vf-accent-hover"
            >
              Start editing free
            </Link>
          </nav>
        </div>
      </header>

      <div className="mx-auto flex max-w-6xl gap-12 px-6 py-10">
        {/* ── Sidebar table of contents ───────────────────────────────────── */}
        <aside className="hidden w-56 shrink-0 lg:block">
          <nav className="sticky top-24" aria-label="On this page">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-vf-text-tertiary">
              On this page
            </p>
            <ul className="space-y-1.5 border-l border-vf-border-subtle">
              {sections.map((s) => (
                <li key={s.id}>
                  <a
                    href={`#${s.id}`}
                    className="-ml-px block border-l border-transparent py-0.5 pl-3 text-sm text-vf-text-secondary transition-colors hover:border-vf-selection hover:text-vf-text-primary"
                  >
                    {s.text}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </aside>

        {/* ── Guide content ───────────────────────────────────────────────── */}
        <article className="min-w-0 max-w-3xl flex-1">{content}</article>
      </div>
    </div>
  );
}
