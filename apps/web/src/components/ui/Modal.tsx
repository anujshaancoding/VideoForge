import { useCallback, useEffect, useId, useRef, type ReactNode } from "react";
import { cx } from "./cx.js";

// Modal — focus-trapped dialog (§19.4 / SC 2.1.2). role="dialog", aria-modal,
// labelled by its heading; Esc closes; backdrop click closes; focus returns to the
// element that was focused before open. The editor/dashboard behind it should be
// rendered inert by the caller; the scrim darkens it (--vf-overlay-scrim).

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  /** Footer action row (e.g. Cancel / Create). */
  footer?: ReactNode;
  /** Tailwind max-width class for the dialog (defaults to a medium dialog). */
  widthClassName?: string;
  /** Close when the backdrop/scrim is clicked (default true). */
  closeOnBackdrop?: boolean;
}

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])';

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  widthClassName = "max-w-[560px]",
  closeOnBackdrop = true,
}: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const titleId = useId();

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const root = dialogRef.current;
      if (!root) return;
      const focusable = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  // On open: remember the trigger, move focus into the dialog. On close: restore.
  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const root = dialogRef.current;
    const target = root?.querySelector<HTMLElement>(FOCUSABLE) ?? root;
    target?.focus();
    return () => {
      previouslyFocused.current?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-modal flex items-center justify-center p-6"
      // Scrim + centering wrapper.
    >
      <div
        className="absolute inset-0 z-modal-scrim bg-vf-overlay-scrim"
        aria-hidden="true"
        onClick={closeOnBackdrop ? onClose : undefined}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className={cx(
          "relative z-modal w-full rounded-xl border border-vf-border-subtle bg-vf-surface-1",
          "shadow-vf-3 outline-none",
          widthClassName,
        )}
      >
        <header className="flex items-center justify-between gap-4 border-b border-vf-border-subtle px-6 py-4">
          <h2 id={titleId} className="text-lg font-semibold text-vf-text-primary">
            {title}
          </h2>
          <button
            type="button"
            aria-label="Close dialog"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-sm text-vf-icon-muted hover:bg-vf-surface-3 hover:text-vf-text-primary"
          >
            <span aria-hidden="true">✕</span>
          </button>
        </header>
        <div className="px-6 py-5">{children}</div>
        {footer && (
          <footer className="flex items-center justify-end gap-3 border-t border-vf-border-subtle px-6 py-4">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}

export default Modal;
