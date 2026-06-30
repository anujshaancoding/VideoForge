import type { Project } from "@videoforge/project-schema";
import type { TimelineContext } from "./types.js";

export function buildTimelineContext(project: Project, activeClipId?: string | null): TimelineContext {
  const clips: TimelineContext["clips"] = [];
  const tracks: TimelineContext["tracks"] = [];

  for (const track of project.tracks) {
    tracks.push({ id: track.id, type: track.type });
    if (track.type !== "video" && track.type !== "audio" && track.type !== "voiceover" && track.type !== "overlay") {
      continue;
    }
    for (const clip of track.clips) {
      clips.push({
        id: clip.id,
        name: "kind" in clip ? `${clip.kind} overlay` : clip.sourceAssetId,
        startTime: clip.startOnTimeline / 1000,
        endTime: clip.endOnTimeline / 1000,
        trackId: track.id,
        trackType: track.type,
      });
    }
  }

  for (const track of project.captionTracks) {
    tracks.push({ id: track.id, type: "caption" });
  }

  const duration = Math.max(
    0,
    ...clips.map((clip) => clip.endTime),
    ...project.captionTracks.flatMap((track) => track.blocks.map((block) => block.endMs / 1000)),
  );
  const active = clips.find((clip) => clip.id === activeClipId);

  return {
    duration,
    aspectRatio: project.canvas.aspectRatio,
    ...(active ? { activeClipId: active.id, activeTrackId: active.trackId } : {}),
    clips,
    tracks,
  };
}
