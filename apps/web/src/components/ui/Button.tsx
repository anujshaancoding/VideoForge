import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cx } from "./cx.js";

// Button — token-driven, accessible primary/secondary/ghost/icon variants.
// • primary = the single amber CTA per surface (Export, Create) — §2.3/§2.14
// • secondary = surface-2 with a default border
// • ghost = transparent, hover wash
// • icon = square, icon-only (callers must pass aria-label)
// Focus ring is the global :focus-visible token (§2.9) — never removed here.

export type ButtonVariant = "primary" | "secondary" | "ghost" | "icon";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Leading icon node (sized by the caller). */
  leadingIcon?: ReactNode;
  /** Render full-width (e.g. auth/modal primary actions). */
  fullWidth?: boolean;
}

const base =
  "inline-flex items-center justify-center gap-2 rounded-md font-medium select-none " +
  "transition-colors duration-[var(--vf-motion-duration)] ease-[var(--vf-ease-standard)] " +
  "disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50";

const sizes: Record<ButtonSize, string> = {
  sm: "h-7 px-2 text-xs", // 28px
  md: "h-9 px-3 text-sm", // 36px
  lg: "h-10 px-4 text-md", // 40px (primary CTA height, §4.0)
};

const iconSizes: Record<ButtonSize, string> = {
  sm: "h-7 w-7", // ≥ 24×24 target (§19.2)
  md: "h-9 w-9",
  lg: "h-10 w-10",
};

const variants: Record<ButtonVariant, string> = {
  primary:
    "bg-vf-accent text-vf-text-inverse hover:bg-vf-accent-hover active:bg-vf-accent-active " +
    "hover:shadow-vf-focus-accent",
  secondary:
    "bg-vf-surface-2 text-vf-text-primary border border-vf-border-default " +
    "hover:bg-vf-surface-3 hover:border-vf-border-strong",
  ghost: "bg-transparent text-vf-text-secondary hover:bg-vf-surface-2 hover:text-vf-text-primary",
  icon:
    "bg-transparent text-vf-icon-default rounded-sm hover:bg-vf-surface-3 hover:text-vf-text-primary",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", leadingIcon, fullWidth, className, children, type, ...rest },
  ref,
) {
  const isIcon = variant === "icon";
  return (
    <button
      ref={ref}
      type={type ?? "button"}
      className={cx(
        base,
        isIcon ? iconSizes[size] : sizes[size],
        variants[variant],
        fullWidth && "w-full",
        className,
      )}
      {...rest}
    >
      {leadingIcon}
      {children}
    </button>
  );
});

export default Button;
