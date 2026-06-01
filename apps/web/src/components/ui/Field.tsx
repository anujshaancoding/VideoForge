import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from "react";
import { cx } from "./cx.js";

// Field — labelled text/number input with helper + error wiring (§19.2 SC 3.3.x).
// Associates label, helper, and error via id + aria-describedby/aria-invalid so
// validation is announced, never color-only. Used by auth, new-project, inspector.

export interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "id"> {
  label: ReactNode;
  /** Helper/hint text under the input (also used for aria-describedby). */
  helper?: ReactNode;
  /** Error message — when set, the field renders the danger state + role="alert". */
  error?: string | undefined;
  /** Optional trailing affordance (e.g. password show/hide toggle). */
  trailing?: ReactNode;
}

export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field(
  { label, helper, error, trailing, className, ...rest },
  ref,
) {
  const id = useId();
  const helperId = `${id}-helper`;
  const errorId = `${id}-error`;
  const describedBy =
    [error ? errorId : null, helper ? helperId : null].filter(Boolean).join(" ") || undefined;

  return (
    <div className={cx("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-xs font-medium text-vf-text-secondary">
        {label}
      </label>
      <div className="relative">
        <input
          ref={ref}
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cx(
            "h-9 w-full rounded-sm border bg-vf-surface-2 px-3 text-sm text-vf-text-primary",
            "placeholder:text-vf-text-tertiary",
            "transition-colors duration-[var(--vf-motion-duration)]",
            error
              ? "border-vf-danger-fg"
              : "border-vf-border-default hover:border-vf-border-strong",
            trailing ? "pr-10" : null,
          )}
          {...rest}
        />
        {trailing && (
          <div className="absolute inset-y-0 right-1 flex items-center">{trailing}</div>
        )}
      </div>
      {error ? (
        <p id={errorId} role="alert" className="text-xs text-vf-danger-fg">
          {error}
        </p>
      ) : helper ? (
        <p id={helperId} className="text-xs text-vf-text-tertiary">
          {helper}
        </p>
      ) : null}
    </div>
  );
});

export default Field;
