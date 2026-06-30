import { actionLabel } from "../../../ai-edit/parser.js";
import type { EditAction } from "../../../ai-edit/types.js";

export default function AIEditActionList({ actions }: { actions: EditAction[] }) {
  if (!actions.length) return null;
  return (
    <ul className="space-y-1">
      {actions.map((action) => (
        <li
          key={action.id}
          className="rounded border border-vf-border-subtle bg-vf-surface-1 px-2 py-1 text-[11px] text-vf-text-secondary"
        >
          <span className="font-medium text-vf-text-primary">{action.type.replaceAll("_", " ")}</span>
          <span className="ml-2">{actionLabel(action)}</span>
        </li>
      ))}
    </ul>
  );
}
