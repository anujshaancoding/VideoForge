import { Modal } from "../ui/index.js";

// ShortcutsModal — a read-only cheat-sheet of every editor keyboard shortcut, opened
// with "?" (or the Help affordance). The shortcuts themselves live in Editor.tsx's
// keydown handler; this panel only documents them, so it has no behaviour to keep in
// sync beyond the human-readable labels. Discoverability win: the editor already has a
// rich, pro-grade shortcut set (incl. J/K/L) that users had no way to find.

// ⌘ on macOS, Ctrl elsewhere — match what the keydown handler actually accepts
// (it treats metaKey OR ctrlKey as "mod", so either works; we just show the native one).
const isMac =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const MOD = isMac ? "⌘" : "Ctrl";

interface Shortcut {
  keys: string;
  label: string;
}

const GROUPS: Array<{ title: string; items: Shortcut[] }> = [
  {
    title: "Playback",
    items: [
      { keys: "Space", label: "Play / Pause" },
      { keys: "L", label: "Play forward" },
      { keys: "K", label: "Stop" },
      { keys: "J", label: "Rewind 2s" },
      { keys: "← / →", label: "Step one frame (Shift = 10)" },
      { keys: "M", label: "Mute / unmute audio track" },
    ],
  },
  {
    title: "Editing",
    items: [
      { keys: `${MOD} Z`, label: "Undo" },
      { keys: `${MOD} ⇧ Z  /  ${MOD} Y`, label: "Redo" },
      { keys: `${MOD} C`, label: "Copy selection" },
      { keys: `${MOD} V`, label: "Paste" },
      { keys: `${MOD} D`, label: "Duplicate selection" },
      { keys: "Delete / Backspace", label: "Delete selection" },
      { keys: `${MOD} Delete`, label: "Ripple delete (close the gap)" },
      { keys: `${MOD} S`, label: "Save now" },
    ],
  },
  {
    title: "Timeline & layout",
    items: [
      { keys: "S", label: "Split clip at playhead" },
      { keys: "← / →", label: "Nudge selected clip / overlay" },
      { keys: "↑ / ↓", label: "Move selected overlay up / down" },
      { keys: `${MOD} + / −`, label: "Zoom canvas in / out" },
      { keys: `${MOD} /`, label: "Toggle the left panel" },
    ],
  },
  {
    title: "Text",
    items: [
      { keys: "T", label: "Add a text overlay" },
      { keys: `${MOD} B / I / U`, label: "Bold / Italic / Underline" },
      { keys: `${MOD} ⇧ L / C / R`, label: "Align left / center / right" },
    ],
  },
];

export default function ShortcutsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <Modal open={open} onClose={onClose} title="Keyboard shortcuts" widthClassName="max-w-[640px]">
      <div className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2">
        {GROUPS.map((group) => (
          <section key={group.title} aria-label={group.title}>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-vf-text-tertiary">
              {group.title}
            </h3>
            <ul className="flex flex-col gap-1.5">
              {group.items.map((s) => (
                <li key={s.label} className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-vf-text-secondary">{s.label}</span>
                  <kbd className="shrink-0 rounded border border-vf-border-default bg-vf-surface-2 px-1.5 py-0.5 text-2xs font-medium text-vf-text-primary">
                    {s.keys}
                  </kbd>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <p className="mt-5 text-2xs text-vf-text-tertiary">
        Press <kbd className="rounded border border-vf-border-default bg-vf-surface-2 px-1 py-0.5">?</kbd> any
        time to open this panel.
      </p>
    </Modal>
  );
}
