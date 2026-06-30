import type { CaptionStyle } from "@videoforge/project-schema";

export type EditAction =
  | TrimAction
  | CutAction
  | DeleteRangeAction
  | AddTransitionAction
  | AddEffectAction
  | AdjustEffectAction
  | AddCaptionAction
  | UpdateCaptionStyleAction
  | ChangeAspectRatioAction
  | AddZoomAction
  | AdjustAudioAction
  | RemoveSilenceAction
  | SplitClipAction
  | MoveClipAction
  | AddTextOverlayAction;

export interface EditTarget {
  clipId?: string;
  trackId?: string;
  startTime?: number;
  endTime?: number;
  time?: number;
}

export interface BaseEditAction {
  id: string;
  type: string;
  target?: EditTarget | undefined;
  confidence?: number;
  explanation?: string;
}

export interface TrimAction extends BaseEditAction {
  type: "trim";
  target: {
    clipId?: string;
    startTime: number;
    endTime: number;
  };
}

export interface CutAction extends BaseEditAction {
  type: "cut";
  target: {
    startTime: number;
    endTime: number;
  };
}

export interface DeleteRangeAction extends BaseEditAction {
  type: "delete_range";
  target: {
    startTime: number;
    endTime: number;
  };
  rippleDelete?: boolean;
}

export interface AddTransitionAction extends BaseEditAction {
  type: "add_transition";
  transition: {
    kind: "fade" | "crossfade" | "wipe" | "slide" | "zoom" | "dip_to_black";
    duration: number;
  };
  target: {
    clipId?: string;
    time?: number;
  };
}

export interface AddEffectAction extends BaseEditAction {
  type: "add_effect";
  effect: {
    kind: "brightness" | "contrast" | "saturation" | "blur" | "sharpen" | "vignette";
    value: number;
    unit?: "percent" | "absolute";
  };
  target?: {
    clipId?: string;
    startTime?: number;
    endTime?: number;
  } | undefined;
}

export interface AdjustEffectAction extends BaseEditAction {
  type: "adjust_effect";
  effect: AddEffectAction["effect"];
  target?: AddEffectAction["target"];
}

export interface AddCaptionAction extends BaseEditAction {
  type: "add_caption";
  caption: {
    text?: string;
    source?: "manual" | "transcript";
    startTime?: number;
    endTime?: number;
    style?: Partial<CaptionStyle>;
  };
}

export interface UpdateCaptionStyleAction extends BaseEditAction {
  type: "update_caption_style";
  style: Partial<CaptionStyle>;
}

export interface ChangeAspectRatioAction extends BaseEditAction {
  type: "change_aspect_ratio";
  aspectRatio: "9:16" | "16:9" | "1:1" | "4:5";
  fitMode?: "crop" | "contain" | "blur_background";
}

export interface AddZoomAction extends BaseEditAction {
  type: "add_zoom";
  zoom: {
    fromScale: number;
    toScale: number;
    easing?: "linear" | "ease_in" | "ease_out" | "ease_in_out";
  };
  target: {
    startTime: number;
    endTime: number;
    clipId?: string;
  };
}

export interface AdjustAudioAction extends BaseEditAction {
  type: "adjust_audio";
  audio: {
    volume?: number;
    fadeIn?: number;
    fadeOut?: number;
    mute?: boolean;
  };
  target?: {
    clipId?: string;
    trackId?: string;
    startTime?: number;
    endTime?: number;
  } | undefined;
}

export interface RemoveSilenceAction extends BaseEditAction {
  type: "remove_silence";
  thresholdDb?: number;
  minSilenceDuration?: number;
  padding?: number;
}

export interface SplitClipAction extends BaseEditAction {
  type: "split_clip";
  target: {
    time: number;
    clipId?: string;
  };
}

export interface MoveClipAction extends BaseEditAction {
  type: "move_clip";
  target: {
    clipId?: string;
    trackId?: string;
    startTime: number;
  };
}

/**
 * Create an on-canvas text overlay (Command Editing v1, AC-9). Position is a NAMED
 * 9-grid anchor token (CEO decision: no raw x/y in v1); the apply-code maps it to
 * percent canvas geometry via `resolvePositionGeometry`. `position` omitted => the
 * default anchor (bottom-center) is used downstream.
 */
export interface AddTextOverlayAction extends BaseEditAction {
  type: "add_text_overlay";
  text: string;
  position?: string;
}

export interface EditPlan {
  summary: string;
  requiresConfirmation: boolean;
  actions: EditAction[];
  warnings?: string[];
}

export interface TimelineContext {
  duration: number;
  aspectRatio: string;
  activeClipId?: string;
  activeTrackId?: string;
  clips: Array<{
    id: string;
    name: string;
    startTime: number;
    endTime: number;
    trackId: string;
    trackType: "video" | "audio" | "voiceover" | "overlay";
  }>;
  tracks: Array<{
    id: string;
    type: "video" | "audio" | "voiceover" | "overlay" | "caption";
  }>;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  requiresConfirmation: boolean;
}

export type LLMEditParserProvider = "openai" | "anthropic" | "groq" | "local";

export interface AppliedEditResult {
  applied: number;
  warnings: string[];
  errors: string[];
}
