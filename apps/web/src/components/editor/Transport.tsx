import { useEffect, useState } from "react";
import {
  selectProjectDurationMs,
  useEditorStore,
} from "../../store/editorStore.js";
import { msToTimecode } from "@videoforge/project-schema";
import { IconButton, Slider, Tooltip } from "../ui/index.js";
import { audioEngine, previewEngine } from "../../engine/index.js";

// Transport — 48px playback band below the canvas (§5.5). role="toolbar".
//
// M2: play/pause now drives the PreviewEngine + AudioEngine rather than a
// wall-clock interval. The engine's onPlayheadUpdate callback writes back to
// the store, so the timecode display stays in sync automatically.
// Master monitor volume is wired to the AudioEngine's masterGain node.

export default function Transport() {
  const isPlaying = useEditorStore((s) => s.isPlaying);
  const playheadMs = useEditorStore((s) => s.playheadMs);
  const togglePlay = useEditorStore((s) => s.togglePlay);
  const setPlayhead = useEditorStore((s) => s.setPlayhead);
  const pause = useEditorStore((s) => s.pause);
  const fps = useEditorStore((s) => s.project.canvas.frameRate);
  const durationMs = useEditorStore(selectProjectDurationMs);

  const [monitorVol, setMonitorVol] = useState(100);
  const [quality, setQuality] = useState<"auto" | "high" | "low">("auto");

  const frameMs = 1000 / (fps || 30);

  // Sync monitor volume to AudioEngine master gain (preview-only; not exported).
  useEffect(() => {
    audioEngine.setMasterVolume(monitorVol);
  }, [monitorVol]);

  const skipStart = (): void => {
    if (isPlaying) pause();
    setPlayhead(0);
    previewEngine.seekTo(0);
  };

  const skipEnd = (): void => {
    if (isPlaying) pause();
    setPlayhead(durationMs);
    previewEngine.seekTo(durationMs);
  };

  const stepBack = (): void => {
    const next = Math.max(0, playheadMs - frameMs);
    setPlayhead(next);
    previewEngine.seekTo(next);
  };

  const stepFwd = (): void => {
    const next = Math.min(durationMs, playheadMs + frameMs);
    setPlayhead(next);
    previewEngine.seekTo(next);
  };

  return (
    <div
      role="toolbar"
      aria-label="Playback controls"
      className="flex h-transport items-center gap-3 bg-vf-surface-2 px-4"
    >
      {/* Current timecode (left). */}
      <span
        className="vf-tnum w-24 shrink-0 text-sm text-vf-text-primary"
        aria-label="Current time"
      >
        {msToTimecode(playheadMs, fps)}
      </span>

      {/* Transport core group, centered. */}
      <div className="flex flex-1 items-center justify-center gap-1">
        <Tooltip label="Skip to start (Home)">
          <IconButton aria-label="Skip to start" onClick={skipStart}>
            <span aria-hidden="true">⏮</span>
          </IconButton>
        </Tooltip>
        <Tooltip label="Step back 1 frame (←)">
          <IconButton aria-label="Step back one frame" onClick={stepBack}>
            <span aria-hidden="true">◀|</span>
          </IconButton>
        </Tooltip>
        <Tooltip label={isPlaying ? "Pause (Space)" : "Play (Space)"}>
          <IconButton
            aria-label={isPlaying ? "Pause" : "Play"}
            active={isPlaying}
            size="lg"
            onClick={togglePlay}
            className={
              isPlaying ? "bg-vf-accent text-vf-text-inverse hover:bg-vf-accent-hover" : ""
            }
          >
            <span aria-hidden="true">{isPlaying ? "⏸" : "▶"}</span>
          </IconButton>
        </Tooltip>
        <Tooltip label="Step forward 1 frame (→)">
          <IconButton aria-label="Step forward one frame" onClick={stepFwd}>
            <span aria-hidden="true">|▶</span>
          </IconButton>
        </Tooltip>
        <Tooltip label="Skip to end (End)">
          <IconButton aria-label="Skip to end" onClick={skipEnd}>
            <span aria-hidden="true">⏭</span>
          </IconButton>
        </Tooltip>
      </div>

      {/* Total duration. */}
      <span
        className="vf-tnum w-24 shrink-0 text-right text-sm text-vf-text-tertiary"
        aria-label="Total duration"
      >
        {msToTimecode(durationMs, fps)}
      </span>

      {/* Right cluster: monitor volume + playback quality. */}
      <div className="flex shrink-0 items-center gap-2 pl-3">
        <Tooltip label="Monitor volume (preview only — does not affect export)">
          <div className="flex items-center gap-1">
            <span aria-hidden="true" className="text-vf-icon-muted">
              🔊
            </span>
            <Slider
              aria-label="Master monitor volume"
              value={monitorVol}
              min={0}
              max={200}
              onChange={setMonitorVol}
              className="w-20"
            />
          </div>
        </Tooltip>
        <select
          aria-label="Playback quality"
          value={quality}
          onChange={(e) => setQuality(e.target.value as "auto" | "high" | "low")}
          className="h-7 rounded-sm border border-vf-border-default bg-vf-surface-3 px-1 text-2xs text-vf-text-primary"
          title="Playback quality (Auto degrades under load — preview only)"
        >
          <option value="auto">Auto</option>
          <option value="high">High</option>
          <option value="low">Low</option>
        </select>
      </div>
    </div>
  );
}
