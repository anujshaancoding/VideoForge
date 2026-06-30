// ─────────────────────────────────────────────────────────────────────────────
// Public marketing landing page (the logged-out root, "/").
//
// Renders on ANY browser — this is the one surface that must work on Safari,
// Firefox, and mobile so people can learn about VideoForge before they're gated
// into the Chrome/Edge-only editor. Copy is sourced verbatim from Echo's
// `docs/marketing/landing-copy.md` and is grounded in shipped features only.
//
// Brand rules: amber (--vf-accent) is used ONLY for the brand mark and the single
// primary CTA ("Start editing free" / "Open VideoForge free"). Links and secondary
// emphasis use sky-blue (--vf-selection). Never Canva purple.
// ─────────────────────────────────────────────────────────────────────────────

import { Link } from "react-router-dom";
import {
  Film,
  Scissors,
  Layers,
  Wand2,
  Download,
  ShieldCheck,
  ArrowRight,
} from "lucide-react";

const FEATURES = [
  {
    icon: Scissors,
    title: "Frame-accurate export",
    body: "Trims, splits, and gaps are written to a non-destructive project graph. The FFmpeg export command is built from that same graph — no trimmed footage reappearing, no audio scrambling on a simple cut.",
  },
  {
    icon: Layers,
    title: "Multi-track timeline",
    body: "Three video tracks, two audio tracks, two overlay tracks, and one caption track. Clips carry their audio; linked audio moves and splits with the video clip so the mix never falls out of sync.",
  },
  {
    icon: Wand2,
    title: "Script to video",
    body: "Paste a script, review the auto-planned scenes, then generate a real editable timeline with voiceover and sketch-style visuals. Open the result in the editor and replace any shot with your own footage.",
  },
  {
    icon: Download,
    title: "Export for any platform",
    body: "One-click presets for 9:16, 16:9, 1:1, 4:5, and 4:3. Exports H.264 MP4 up to 1080p. Pre-flight shows estimated file size and render time before you queue the job.",
  },
] as const;

const PATH_A = [
  {
    title: "Paste your script",
    body: "Script Studio reads your text, estimates scene durations, and plans voiceover, captions, and a shot brief for each scene.",
  },
  {
    title: "Review and adjust",
    body: "Edit the voiceover, captions, and sketch style per scene before generating anything.",
  },
  {
    title: "Generate and refine",
    body: "VideoForge builds a full timeline with TTS voiceover and sketch visuals. Open it in the editor, swap in your own footage with the Auto-arrange tray, and export.",
  },
] as const;

const PATH_B = [
  {
    title: "Create a project",
    body: "Pick an aspect ratio (9:16, 16:9, 1:1, 4:5, 4:3, or custom) or start from a template.",
  },
  {
    title: "Import and arrange",
    body: "Drop your media into the timeline. Trim, split, move, and stack clips across multiple tracks. Add text overlays, captions, color grade, and Ken Burns motion.",
  },
  {
    title: "Export",
    body: "Click Export, choose a preset and resolution, and download the MP4 when the render is done. The file matches what you saw in the preview.",
  },
] as const;

/** The single amber primary CTA, reused for hero + closing. */
function PrimaryCta({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link
      to={to}
      className="inline-flex items-center gap-2 rounded-lg bg-vf-accent px-6 py-3 text-base font-semibold text-vf-text-inverse shadow-sm transition-colors hover:bg-vf-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vf-accent"
    >
      {children}
      <ArrowRight className="h-4 w-4" aria-hidden />
    </Link>
  );
}

function GhostLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link
      to={to}
      className="inline-flex items-center gap-2 rounded-lg border border-vf-border-strong px-6 py-3 text-base font-semibold text-vf-text-primary transition-colors hover:bg-vf-surface-2"
    >
      {children}
    </Link>
  );
}

export default function Landing() {
  return (
    <div className="min-h-screen bg-vf-bg-app text-vf-text-primary">
      {/* ── Top nav ───────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-20 border-b border-vf-border-subtle bg-vf-bg-app/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <Film className="h-5 w-5 text-vf-accent" aria-hidden />
            <span>VideoForge</span>
          </Link>
          <nav className="flex items-center gap-1 sm:gap-2">
            <Link
              to="/docs"
              className="rounded-md px-3 py-2 text-sm font-medium text-vf-text-secondary transition-colors hover:text-vf-text-primary"
            >
              Docs
            </Link>
            <Link
              to="/login"
              className="rounded-md px-3 py-2 text-sm font-medium text-vf-text-secondary transition-colors hover:text-vf-text-primary"
            >
              Sign in
            </Link>
            <Link
              to="/signup"
              className="rounded-md border border-vf-border-strong px-3.5 py-2 text-sm font-semibold text-vf-text-primary transition-colors hover:bg-vf-surface-2"
            >
              Get started
            </Link>
          </nav>
        </div>
      </header>

      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      <section className="vf-hero-glow relative">
        <div className="mx-auto max-w-6xl px-6 pb-16 pt-20 sm:pt-28">
          <div className="mx-auto max-w-3xl text-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-vf-border-default bg-vf-surface-1 px-3 py-1 text-xs font-medium text-vf-text-secondary">
              <span className="h-1.5 w-1.5 rounded-full bg-vf-success-fg" aria-hidden />
              Free · Browser-based · No install
            </span>
            <h1 className="mt-6 text-4xl font-extrabold leading-tight tracking-tight sm:text-6xl">
              The export matches your edit.{" "}
              <span className="vf-gradient-text">Always.</span>
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-vf-text-secondary">
              VideoForge is a multi-track video editor that runs in your browser. The MP4 you
              download is generated from the same project graph your timeline previews — what you
              cut is what you get.
            </p>
            <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <PrimaryCta to="/signup">Start editing free</PrimaryCta>
              <GhostLink to="/docs">Read the docs</GhostLink>
            </div>
            <p className="mt-5 text-sm text-vf-text-tertiary">
              Works in Chrome and Edge on desktop. Safari and Firefox are not supported.
            </p>
          </div>

          {/* CSS-only editor mock — decorative, no assets. */}
          <div className="mx-auto mt-16 max-w-4xl">
            <div className="overflow-hidden rounded-xl border border-vf-border-default bg-vf-surface-1 shadow-2xl">
              <div className="flex items-center gap-2 border-b border-vf-border-subtle bg-vf-surface-2 px-4 py-2.5">
                <span className="h-3 w-3 rounded-full bg-vf-danger-bg" />
                <span className="h-3 w-3 rounded-full bg-vf-warning-bg" />
                <span className="h-3 w-3 rounded-full bg-vf-success-bg" />
                <span className="ml-3 text-xs text-vf-text-tertiary">VideoForge — Untitled project</span>
                <span className="ml-auto rounded bg-vf-accent px-2 py-0.5 text-[11px] font-semibold text-vf-text-inverse">
                  Export
                </span>
              </div>
              <div className="vf-dot-grid flex aspect-[16/9] items-center justify-center bg-vf-surface-sunken">
                <div className="aspect-[9/16] h-[70%] rounded-md border border-vf-border-default bg-vf-bg-app shadow-lg" />
              </div>
              <div className="space-y-2 border-t border-vf-border-subtle bg-vf-surface-1 p-3">
                {[
                  { c: "bg-vf-track-video", w: "w-3/4" },
                  { c: "bg-vf-track-audio", w: "w-1/2" },
                  { c: "bg-vf-track-caption", w: "w-2/3" },
                ].map((t, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="h-3 w-10 rounded-sm bg-vf-surface-3" />
                    <span className={`h-5 rounded-sm ${t.c} ${t.w} opacity-80`} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Features ──────────────────────────────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-6 py-16">
        <div className="grid gap-5 sm:grid-cols-2">
          {FEATURES.map(({ icon: Icon, title, body }) => (
            <div
              key={title}
              className="vf-card-hover rounded-xl border border-vf-border-subtle bg-vf-surface-1 p-6"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-vf-accent-subtle text-vf-accent-text">
                <Icon className="h-5 w-5" aria-hidden />
              </div>
              <h3 className="mt-4 text-lg font-semibold text-vf-text-primary">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-vf-text-secondary">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── How it works ─────────────────────────────────────────────────── */}
      <section className="border-y border-vf-border-subtle bg-vf-surface-1/40">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <h2 className="text-center text-3xl font-bold tracking-tight">Two ways to start</h2>
          <p className="mx-auto mt-3 max-w-2xl text-center text-vf-text-secondary">
            Generate a first cut from a script, or build it by hand on the timeline.
          </p>
          <div className="mt-12 grid gap-10 lg:grid-cols-2">
            <div>
              <h3 className="mb-5 inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-vf-accent-text">
                <Wand2 className="h-4 w-4" aria-hidden /> Path A — Start from a script
              </h3>
              <ol className="space-y-5">
                {PATH_A.map((s, i) => (
                  <Step key={s.title} n={i + 1} title={s.title} body={s.body} />
                ))}
              </ol>
            </div>
            <div>
              <h3 className="mb-5 inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-vf-selection">
                <Scissors className="h-4 w-4" aria-hidden /> Path B — Start from the editor
              </h3>
              <ol className="space-y-5">
                {PATH_B.map((s, i) => (
                  <Step key={s.title} n={i + 1} title={s.title} body={s.body} />
                ))}
              </ol>
            </div>
          </div>
        </div>
      </section>

      {/* ── Trust line ───────────────────────────────────────────────────── */}
      <section className="mx-auto max-w-3xl px-6 py-16">
        <div className="flex flex-col items-center gap-4 rounded-xl border border-vf-border-subtle bg-vf-surface-1 p-8 text-center">
          <ShieldCheck className="h-7 w-7 text-vf-success-fg" aria-hidden />
          <p className="text-base leading-relaxed text-vf-text-secondary">
            The export FFmpeg graph is generated directly from the same project JSON your timeline
            previews — the same code path, not a copy. Verified by an automated golden-frame
            fidelity gate on every build.
          </p>
        </div>
      </section>

      {/* ── Closing CTA ──────────────────────────────────────────────────── */}
      <section className="border-t border-vf-border-subtle">
        <div className="mx-auto max-w-3xl px-6 py-20 text-center">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Start your first project</h2>
          <p className="mx-auto mt-4 max-w-xl text-vf-text-secondary">
            No credit card, no watermark, no paywall on export. Bring a script or your own footage.
          </p>
          <div className="mt-8 flex justify-center">
            <PrimaryCta to="/signup">Open VideoForge free</PrimaryCta>
          </div>
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <footer className="border-t border-vf-border-subtle">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-8 text-sm text-vf-text-tertiary sm:flex-row">
          <div className="flex items-center gap-2">
            <Film className="h-4 w-4 text-vf-accent" aria-hidden />
            <span>VideoForge — what you cut is what you get.</span>
          </div>
          <div className="flex items-center gap-5">
            <Link to="/docs" className="hover:text-vf-text-primary">
              Docs
            </Link>
            <Link to="/login" className="hover:text-vf-text-primary">
              Sign in
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

function Step({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <li className="flex gap-4">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-vf-border-default bg-vf-surface-2 text-sm font-semibold text-vf-text-primary">
        {n}
      </span>
      <div>
        <h4 className="font-semibold text-vf-text-primary">{title}</h4>
        <p className="mt-1 text-sm leading-relaxed text-vf-text-secondary">{body}</p>
      </div>
    </li>
  );
}
