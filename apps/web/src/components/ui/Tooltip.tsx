import { useId, useRef, useState, useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cx } from "./cx.js";

// Tooltip — lightweight hover/focus label. Uses aria-describedby so AT reads the
// hint, and shows on focus (keyboard) as well as hover (§19). Chrome-only motion
// references the master gate. Positioned above the trigger by default.

export interface TooltipProps {
  label: ReactNode;
  children: ReactNode;
  side?: "top" | "bottom";
  className?: string;
}

export function Tooltip({ label, children, side = "top", className }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const id = useId();
  const labelStr = typeof label === 'string' ? label : undefined;
  // Small delay reduces flicker on fast mouse moves and makes it feel more intentional.
  const showTimer = useRef<number | null>(null);
  const hideTimer = useRef<number | null>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);

  const show = () => {
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    if (showTimer.current) window.clearTimeout(showTimer.current);
    showTimer.current = window.setTimeout(() => {
      if (triggerRef.current) {
        const rect = triggerRef.current.getBoundingClientRect();
        const left = rect.left + rect.width / 2;
        const top = side === "top" ? rect.top : rect.bottom;
        setPosition({ left, top });
      }
      setOpen(true);
    }, 120);
  };

  const hide = () => {
    if (showTimer.current) window.clearTimeout(showTimer.current);
    hideTimer.current = window.setTimeout(() => {
      setOpen(false);
      setPosition(null);
    }, 60);
  };

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (showTimer.current) window.clearTimeout(showTimer.current);
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
    };
  }, []);

  return (
    <span
      ref={triggerRef}
      className={cx("relative inline-flex", className)}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      title={labelStr}
    >
      <span aria-describedby={open ? id : undefined}>{children}</span>
      {open && position && createPortal(
        <span
          id={id}
          role="tooltip"
          className={cx(
            "pointer-events-none fixed z-[9999] -translate-x-1/2 whitespace-nowrap",
            "rounded-md border border-vf-border-strong bg-vf-surface-4 px-2.5 py-1 text-2xs font-medium text-vf-text-primary shadow-vf-2",
            side === "top" ? "-translate-y-full -mb-1.5" : "mt-1.5",
          )}
          style={{ left: position.left, top: position.top }}
        >
          {label}
        </span>,
        document.body
      )}
    </span>
  );
}

export default Tooltip;
