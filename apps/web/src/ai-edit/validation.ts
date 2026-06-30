import type { EditAction, EditPlan, TimelineContext, ValidationResult } from "./types.js";

const SUPPORTED_ASPECTS = new Set(["9:16", "16:9", "1:1", "4:5"]);
const SAFE_EFFECT_RANGE = 100;
const DESTRUCTIVE = new Set<EditAction["type"]>(["cut", "delete_range", "remove_silence"]);

export function validateEditPlan(plan: EditPlan, context: TimelineContext): ValidationResult {
  const errors: string[] = [];
  const warnings = [...(plan.warnings ?? [])];
  let requiresConfirmation = plan.requiresConfirmation;

  if (!plan.actions.length) {
    errors.push("Could not understand command.");
  }

  for (const action of plan.actions) {
    if (DESTRUCTIVE.has(action.type)) requiresConfirmation = true;
    validateAction(action, context, errors, warnings);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    requiresConfirmation,
  };
}

function targetOf(action: EditAction) {
  return action.target as { clipId?: string; trackId?: string; startTime?: number; endTime?: number } | undefined;
}

function validateAction(action: EditAction, context: TimelineContext, errors: string[], warnings: string[]): void {
  const clipIds = new Set(context.clips.map((clip) => clip.id));
  const trackIds = new Set(context.tracks.map((track) => track.id));
  const duration = context.duration;

  const checkRange = (start?: number, end?: number): void => {
    if (start === undefined || end === undefined) return;
    if (start < 0) errors.push("Start time cannot be negative.");
    if (end <= start) errors.push("End time must be greater than start time.");
    if (duration > 0 && end > duration) errors.push("Time range is outside the video duration.");
  };

  const target = targetOf(action);
  if (target?.clipId && !clipIds.has(target.clipId)) errors.push(`Clip ${target.clipId} does not exist.`);
  if (target?.trackId && !trackIds.has(target.trackId)) errors.push(`Track ${target.trackId} does not exist.`);
  checkRange(target?.startTime, target?.endTime);

  switch (action.type) {
    case "add_transition":
      if (action.transition.duration <= 0 || action.transition.duration > 5) {
        errors.push("Transition duration must be between 0 and 5 seconds.");
      }
      if (!action.target.clipId && action.target.time === undefined) {
        warnings.push("Transition has no explicit clip or time; VideoForge will choose the nearest clip.");
      }
      break;
    case "add_effect":
    case "adjust_effect":
      if (Math.abs(action.effect.value) > SAFE_EFFECT_RANGE) {
        errors.push(`${action.effect.kind} change must be within -100% to 100%.`);
      }
      if (!["brightness", "contrast", "saturation"].includes(action.effect.kind)) {
        warnings.push(`This command was understood, but ${action.effect.kind} is not supported by the current editor yet.`);
      }
      break;
    case "change_aspect_ratio":
      if (!SUPPORTED_ASPECTS.has(action.aspectRatio)) errors.push("Aspect ratio is not supported.");
      break;
    case "add_caption":
      checkRange(action.caption.startTime, action.caption.endTime);
      if (!action.caption.text && action.caption.source !== "transcript") {
        errors.push("Caption text is required for manual captions.");
      }
      break;
    case "adjust_audio":
      if (action.audio.volume !== undefined && (action.audio.volume < 0 || action.audio.volume > 200)) {
        errors.push("Audio volume must be between 0% and 200%.");
      }
      if (action.target?.trackId) {
        const track = context.tracks.find((item) => item.id === action.target?.trackId);
        if (track && track.type !== "audio" && track.type !== "voiceover") {
          errors.push("Target track is not an audio track.");
        }
      }
      break;
    case "remove_silence":
      warnings.push("This command was understood, but this editor does not support automatic silence detection yet.");
      break;
  }
}
