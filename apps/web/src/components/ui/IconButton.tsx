import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cx } from "./cx.js";

// IconButton — icon-only square control. ALWAYS requires an aria-label (§19.2 SC
// 1.1.1). Renders ≥ 24×24 hit target even when the glyph is smaller (§19.2 SC
// 2.5.8). `active` reflects a toggled state (mute/solo/lock, play/pause) and tints
// to the accent-text hue so the state is doubled with color + the glyph itself.

export type IconButtonSize = "sm" | "md" | "lg";

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Required for screen readers — icon-only buttons have no text. */
  "aria-label": string;
  size?: IconButtonSize;
  /** Toggled/selected state (e.g. mute on). */
  active?: boolean;
  children: ReactNode;
}

const sizeClasses: Record<IconButtonSize, string> = {
  sm: "h-9 w-9", // 36px good touch target
  md: "h-10 w-10", // 40px
  lg: "h-12 w-12", // 48px (transport play etc)
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { size = "md", active = false, className, children, type, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type ?? "button"}
      aria-pressed={active}
      className={cx(
        "inline-flex items-center justify-center rounded-sm transition-colors",
        "duration-[var(--vf-motion-duration)] ease-[var(--vf-ease-standard)]",
        "disabled:cursor-not-allowed disabled:opacity-40",
        active
          ? "bg-vf-surface-3 text-vf-accent-text"
          : "text-vf-text-tertiary hover:bg-vf-surface-3 hover:text-vf-text-primary",
        sizeClasses[size],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});

export default IconButton;
