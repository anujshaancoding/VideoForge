import {
  selectProjectDurationMs,
  useEditorStore,
  DEFAULT_PX_PER_SECOND,
} from "../../store/editorStore.js";
import { msToTimecode } from "@videoforge/project-schema";
import { useAutosave, type SaveStatus } from "../../lib/useAutosave.js";
import { cx } from "../ui/index.js";

const SAVE_DOT: Record<SaveStatus, string> = {
  saved: "bg-vf-success-fg",
  saving: "bg-vf-accent animate-pulse",
  unsaved: "bg-vf-warning-fg",
  error: "bg-vf-danger-fg",
};
const SAVE_LABEL: Record<SaveStatus, string> = {
  saved: "All changes saved",
  saving: "Saving…",
  unsaved: "Unsaved changes",
  error: "Save failed — retrying",
};

export default function StatusBar() {
  const playheadMs = useEditorStore((s) => s.playheadMs);
  const fps = useEditorStore((s) => s.project.canvas.frameRate);
  const pxPerSecond = useEditorStore((s) => s.pxPerSecond);
  const durationMs = useEditorStore(selectProjectDurationMs);
  const saveStatus = useAutosave();

  const zoomPct = Math.round((pxPerSecond / DEFAULT_PX_PER_SECOND) * 100);

  return (
    <div
      role="status"
      aria-label="Editor status"
      className="flex h-statusbar items-center gap-4 bg-vf-surface-1 px-4 text-2xs text-vf-text-tertiary"
    >
      <span className="vf-tnum text-vf-text-secondary">
        {msToTimecode(playheadMs, fps)} / {msToTimecode(durationMs, fps)}
      </span>

      <span className="vf-tnum">Zoom {zoomPct}%</span>

      <span className="ml-auto flex items-center gap-1 text-vf-text-disabled">
        <span aria-hidden="true">⚡</span> Performance mode
      </span>

      <span className="flex items-center gap-1.5">
        <span aria-hidden="true" className={cx("h-2 w-2 rounded-full", SAVE_DOT[saveStatus])} />
        {SAVE_LABEL[saveStatus]}
      </span>
    </div>
  );
}
