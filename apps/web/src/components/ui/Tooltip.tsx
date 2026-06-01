import { useId, useState, type ReactNode } from "react";
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
  const id = useId();
  return (
    <span
      className={cx("relative inline-flex", className)}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      <span aria-describedby={open ? id : undefined}>{children}</span>
      {open && (
        <span
          id={id}
          role="tooltip"
          className={cx(
            "pointer-events-none absolute left-1/2 z-tooltip -translate-x-1/2 whitespace-nowrap",
            "rounded-sm bg-vf-surface-4 px-2 py-1 text-2xs text-vf-text-primary shadow-vf-2",
            side === "top" ? "bottom-full mb-1.5" : "top-full mt-1.5",
          )}
        >
          {label}
        </span>
      )}
    </span>
  );
}

export default Tooltip;
