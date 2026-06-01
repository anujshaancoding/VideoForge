import { type HTMLAttributes, type ReactNode } from "react";
import { cx } from "./cx.js";

// Panel + PanelHeader — the surface-1 container chrome used by the left media panel,
// the right inspector, and dashboard sections. PanelHeader is a sticky title strip.

export interface PanelProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function Panel({ className, children, ...rest }: PanelProps) {
  return (
    <div
      className={cx(
        "flex min-h-0 flex-col overflow-hidden bg-vf-surface-1 text-vf-text-primary",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export interface PanelHeaderProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  title: ReactNode;
  /** Right-aligned controls (toggles, overflow). */
  actions?: ReactNode;
}

export function PanelHeader({ title, actions, className, ...rest }: PanelHeaderProps) {
  return (
    <div
      className={cx(
        "flex h-9 shrink-0 items-center justify-between gap-2 border-b border-vf-border-subtle px-3",
        "bg-vf-surface-1",
        className,
      )}
      {...rest}
    >
      <div className="truncate text-xs font-semibold uppercase tracking-wide text-vf-text-secondary">
        {title}
      </div>
      {actions && <div className="flex items-center gap-1">{actions}</div>}
    </div>
  );
}

export default Panel;
