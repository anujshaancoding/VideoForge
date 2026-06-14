import { forwardRef, useId, type InputHTMLAttributes } from "react";
import { cx } from "./cx.js";

// Slider — accessible range input (native <input type="range"> for full keyboard +
// AT support). Used for zoom, volume, opacity, etc. The visible label is optional;
// when omitted, callers MUST pass aria-label. Token-styled track/thumb via the
// utility classes below.

export interface SliderProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "onChange"> {
  /** Optional visible label rendered above the track. */
  label?: string;
  /** Current numeric value (controlled). */
  value: number;
  min?: number;
  max?: number;
  step?: number;
  /** Optional formatted value shown at the right of the label row. */
  valueLabel?: string;
  onChange?: (value: number) => void;
}

export const Slider = forwardRef<HTMLInputElement, SliderProps>(function Slider(
  { label, value, min = 0, max = 100, step = 1, valueLabel, onChange, className, id, ...rest },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <div className={cx("flex flex-col gap-1", className)}>
      {label !== undefined && (
        <div className="flex items-center justify-between text-xs text-vf-text-secondary">
          <label htmlFor={inputId}>{label}</label>
          {valueLabel !== undefined && (
            <span className="vf-tnum text-vf-text-tertiary">{valueLabel}</span>
          )}
        </div>
      )}
      <input
        ref={ref}
        id={inputId}
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange?.(Number(e.target.value))}
        className={cx(
          "h-3 w-full cursor-pointer appearance-none rounded-pill bg-vf-surface-sunken",
          "shadow-vf-inset-well accent-vf-accent",
        )}
        {...rest}
      />
    </div>
  );
});

export default Slider;
