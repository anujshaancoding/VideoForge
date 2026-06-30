import { AlertTriangle, Check, X } from "lucide-react";
import type { EditPlan, ValidationResult } from "../../../ai-edit/types.js";
import AIEditActionList from "./AIEditActionList.js";
import AIEditErrorMessage from "./AIEditErrorMessage.js";

interface Props {
  command: string;
  plan: EditPlan;
  validation: ValidationResult;
  onApply: () => void;
  onCancel: () => void;
}

export default function AIEditPreviewPanel({ command, plan, validation, onApply, onCancel }: Props) {
  // AC-7: a plan is destructive when it deletes/cuts media (or the planner flags it for
  // confirmation, e.g. a trim that drops a clip below 1s). When destructive we surface a
  // warning callout above Apply and relabel the CTA so the action is intentional.
  const isDestructive =
    plan.requiresConfirmation ||
    plan.actions.some((a) => a.type === "delete_range" || a.type === "cut");

  return (
    <div className="mt-2 rounded-lg border border-vf-border-strong bg-vf-surface-2 p-3 shadow-vf-3">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-xs text-vf-text-tertiary">{command}</div>
          <div className="text-sm font-semibold text-vf-text-primary">{plan.summary}</div>
        </div>
        <button
          type="button"
          aria-label="Cancel command"
          onClick={onCancel}
          className="rounded p-1 text-vf-text-tertiary hover:bg-vf-surface-3 hover:text-vf-text-primary"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <div className="space-y-2">
        <AIEditActionList actions={plan.actions} />
        <AIEditErrorMessage messages={validation.errors} />
        {validation.warnings.length > 0 && (
          <div className="rounded border border-amber-400/30 bg-amber-950/20 px-3 py-2 text-xs text-amber-100">
            {validation.warnings.map((warning) => (
              <div key={warning}>{warning}</div>
            ))}
          </div>
        )}
        {isDestructive && (
          <div className="vf-callout vf-callout-warn" role="alert">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            <span>This action removes media and cannot be easily reversed.</span>
          </div>
        )}
      </div>

      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded border border-vf-border-subtle px-3 py-1.5 text-xs text-vf-text-secondary hover:bg-vf-surface-3 hover:text-vf-text-primary"
        >
          Cancel
        </button>
        {/* Brand invariant (CLAUDE.md): amber is reserved for the single Export CTA.
            This secondary editor CTA uses the sky-blue selection token, matching the
            Command Bar Run button. Ratified by Pixel over Iris's original amber. */}
        <button
          type="button"
          onClick={onApply}
          disabled={!validation.valid}
          className="inline-flex items-center gap-1 rounded bg-vf-selection px-3 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Check className="h-3.5 w-3.5" aria-hidden="true" />
          {isDestructive ? "Confirm delete" : "Apply edits"}
        </button>
      </div>
    </div>
  );
}
