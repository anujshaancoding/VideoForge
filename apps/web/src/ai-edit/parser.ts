import { parseTimeToSeconds } from "./time.js";
import type { EditAction, EditPlan, LLMEditParserProvider, TimelineContext } from "./types.js";

const id = (prefix: string): string => `${prefix}_${Math.random().toString(36).slice(2, 10)}`;

const RANGE =
  /(?:from|between)?\s*([0-9:.]+\s*(?:m(?:in(?:ute)?s?)?\s*[0-9.]*\s*s(?:ec(?:ond)?s?)?|seconds?|secs?|s)?)\s+(?:to|and|-|–|—)\s+([0-9:.]+\s*(?:m(?:in(?:ute)?s?)?\s*[0-9.]*\s*s(?:ec(?:ond)?s?)?|seconds?|secs?|s)?)/i;
const AT_TIME = /\bat\s+([0-9:.]+\s*(?:m(?:in(?:ute)?s?)?\s*[0-9.]*\s*s(?:ec(?:ond)?s?)?|seconds?|secs?|s)?)/i;

function parseRange(command: string): { startTime: number; endTime: number } | null {
  const match = command.match(RANGE);
  if (!match) return null;
  const startTime = parseTimeToSeconds(match[1] ?? "");
  const endTime = parseTimeToSeconds(match[2] ?? "");
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) return null;
  return { startTime, endTime };
}

function parseAt(command: string): number | null {
  const match = command.match(AT_TIME);
  if (!match) return null;
  const time = parseTimeToSeconds(match[1] ?? "");
  return Number.isFinite(time) ? time : null;
}

function effectValue(command: string): number | null {
  const match = command.match(/\bby\s+(-?\d+(?:\.\d+)?)\s*%?/i) ?? command.match(/\b(-?\d+(?:\.\d+)?)\s*%/i);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return null;
  return /\bdecrease|reduce|lower\b/i.test(command) ? -Math.abs(amount) : Math.abs(amount);
}

function makePlan(actions: EditAction[], warnings: string[] = []): EditPlan {
  const destructive = actions.some((action) => action.type === "delete_range" || action.type === "cut" || action.type === "remove_silence");
  const plan: EditPlan = {
    summary: actions.length > 0 ? summarize(actions) : "Could not understand command",
    requiresConfirmation: destructive || actions.length > 1 || warnings.length > 0,
    actions,
  };
  if (warnings.length) plan.warnings = warnings;
  return plan;
}

function summarize(actions: EditAction[]): string {
  if (actions.length === 1 && actions[0]) return actionLabel(actions[0]);
  return `Apply ${actions.length} timeline edits`;
}

export function actionLabel(action: EditAction): string {
  switch (action.type) {
    case "trim":
      return `Trim clip to ${action.target.startTime}s-${action.target.endTime}s`;
    case "cut":
      return `Cut range ${action.target.startTime}s-${action.target.endTime}s`;
    case "delete_range":
      return `Delete range ${action.target.startTime}s-${action.target.endTime}s`;
    case "add_transition":
      return `Add ${action.transition.kind} transition`;
    case "add_effect":
    case "adjust_effect":
      return `${action.effect.value >= 0 ? "Increase" : "Decrease"} ${action.effect.kind} by ${Math.abs(action.effect.value)}%`;
    case "change_aspect_ratio":
      return `Change aspect ratio to ${action.aspectRatio}`;
    case "add_zoom":
      return `Add zoom from ${action.target.startTime}s-${action.target.endTime}s`;
    case "adjust_audio":
      if (action.audio.mute) return "Mute audio";
      if (action.audio.fadeIn !== undefined || action.audio.fadeOut !== undefined) return "Add audio fade";
      return `Set volume to ${action.audio.volume}%`;
    case "add_caption":
      return `Add caption${action.caption.text ? ` "${action.caption.text}"` : ""}`;
    case "remove_silence":
      return `Remove silence longer than ${action.minSilenceDuration ?? 1}s`;
    case "split_clip":
      return `Split clip at ${action.target.time}s`;
    case "move_clip":
      return `Move clip to ${action.target.startTime}s`;
    case "add_text_overlay":
      return `Add text overlay "${action.text}"`;
    case "update_caption_style":
      return "Update caption style";
  }
}

export async function parseEditCommand(command: string, context: TimelineContext): Promise<EditPlan> {
  const local = parseEditCommandLocal(command, context);
  if (local.actions.length > 0) return local;
  return parseWithLLM(command, context, "local");
}

export function parseEditCommandLocal(command: string, context: TimelineContext): EditPlan {
  const text = command.trim();
  const lower = text.toLowerCase();
  const actions: EditAction[] = [];
  const warnings: string[] = [];

  const range = parseRange(text);
  if (/\btrim\b/.test(lower) && range) {
    actions.push({
      id: id("trim"),
      type: "trim",
      target: { ...range, ...(context.activeClipId ? { clipId: context.activeClipId } : {}) },
      confidence: 0.9,
      explanation: "Trim the active or first matching clip to the requested range.",
    });
  } else if (/\b(cut|delete|remove)\b/.test(lower) && range && !/\bsilence\b/.test(lower)) {
    actions.push({
      id: id("delete"),
      type: /\bcut\b/.test(lower) ? "cut" : "delete_range",
      target: range,
      rippleDelete: /\bripple\b/.test(lower),
      confidence: 0.88,
      explanation: "Remove media that overlaps this timeline range.",
    } as EditAction);
  }

  if (/\btransition\b|\bfade transition\b|\bcrossfade\b/.test(lower)) {
    const at = parseAt(text);
    const kind = lower.includes("zoom") ? "zoom" : lower.includes("fade") ? "crossfade" : "crossfade";
    actions.push({
      id: id("transition"),
      type: "add_transition",
      transition: { kind, duration: 0.5 },
      target: { ...(context.activeClipId ? { clipId: context.activeClipId } : {}), ...(at !== null ? { time: at } : {}) },
      confidence: at === null && !context.activeClipId ? 0.65 : 0.86,
      explanation: "Add a transition near the requested cut point.",
    });
    if (at === null && !context.activeClipId) warnings.push("No transition time or active clip was provided; the nearest clip will be used.");
  }

  for (const kind of ["brightness", "contrast", "saturation"] as const) {
    if (lower.includes(kind)) {
      actions.push({
        id: id(kind),
        type: "adjust_effect",
        effect: { kind, value: effectValue(text) ?? 10, unit: "percent" },
        target: context.activeClipId ? { clipId: context.activeClipId } : undefined,
        confidence: 0.9,
      });
    }
  }

  const aspect = lower.match(/\b(9:16|16:9|1:1|4:5)\b/);
  if (aspect || /\breel\b/.test(lower)) {
    actions.push({
      id: id("aspect"),
      type: "change_aspect_ratio",
      aspectRatio: (aspect?.[1] ?? "9:16") as "9:16" | "16:9" | "1:1" | "4:5",
      fitMode: lower.includes("contain") ? "contain" : "crop",
      confidence: 0.92,
    });
  }

  if (/\bzoom\b/.test(lower) && range && !/\btransition\b/.test(lower)) {
    actions.push({
      id: id("zoom"),
      type: "add_zoom",
      target: { ...range, ...(context.activeClipId ? { clipId: context.activeClipId } : {}) },
      zoom: { fromScale: 1, toScale: /\bout\b/.test(lower) ? 1 : 1.35, easing: "ease_in_out" },
      confidence: 0.86,
    });
  }

  const volume = lower.match(/\b(?:set|lower|reduce|increase).*volume\s+(?:to\s+)?(\d+(?:\.\d+)?)\s*%?/);
  if (volume) {
    const trackId = context.tracks.find((track) => track.type === "audio" || track.type === "voiceover")?.id;
    actions.push({
      id: id("audio"),
      type: "adjust_audio",
      audio: { volume: Number(volume[1] ?? 0) },
      ...(trackId ? { target: { trackId } } : {}),
      confidence: 0.88,
    });
  }

  if (/\bmute\b/.test(lower)) {
    actions.push({
      id: id("mute"),
      type: "adjust_audio",
      audio: { mute: true },
      ...(range ? { target: { ...range } } : {}),
      confidence: range ? 0.85 : 0.75,
    });
  }

  if (/\bfade in\b|\bfade out\b/.test(lower)) {
    const audio: Extract<EditAction, { type: "adjust_audio" }>["audio"] = {};
    if (/\bfade in\b/.test(lower)) audio.fadeIn = 1;
    if (/\bfade out\b/.test(lower)) audio.fadeOut = 1;
    actions.push({
      id: id("fade"),
      type: "adjust_audio",
      audio,
      ...(context.activeClipId ? { target: { clipId: context.activeClipId } } : {}),
      confidence: 0.8,
    });
  }

  const caption = text.match(/\badd caption\s+["“](.+?)["”](?:\s+from\s+(.+?)\s+(?:to|-|–|—)\s+(.+))?$/i);
  if (caption) {
    const start = caption[2] ? parseTimeToSeconds(caption[2]) : 0;
    const end = caption[3] ? parseTimeToSeconds(caption[3]) : Math.min(context.duration || 3, start + 3);
    const captionAction: Extract<EditAction, { type: "add_caption" }> = {
      id: id("caption"),
      type: "add_caption",
      caption: {
        source: "manual",
        startTime: Number.isFinite(start) ? start : 0,
        endTime: Number.isFinite(end) ? end : Math.min(context.duration || 3, 3),
      },
      confidence: 0.9,
    };
    if (caption[1]) captionAction.caption.text = caption[1];
    if (lower.includes("yellow")) captionAction.caption.style = { color: "#FFD84D" };
    actions.push(captionAction);
  }

  // ── split clip at a time (Command Editing v1, PRD §3 item 6) ────────────────
  // "split at 0:30" / "split clip at 0:30". Target = active/selected clip, else the
  // clip the apply-code finds under the split time (clip-at-playhead resolution).
  if (/\bsplit\b/.test(lower)) {
    const at = parseAt(text);
    if (at !== null) {
      actions.push({
        id: id("split"),
        type: "split_clip",
        target: { time: at, ...(context.activeClipId ? { clipId: context.activeClipId } : {}) },
        confidence: 0.9,
        explanation: "Split the selected clip (or the clip under the playhead) at the requested time.",
      });
    }
  }

  // ── move clip to a time (Command Editing v1, PRD §3 item 11) ────────────────
  // "move clip to 0:10" / "move to 0:10". Target = active/selected clip; the new
  // timeline start is the requested time, duration preserved by the apply-code.
  if (/\bmove\b/.test(lower)) {
    const at = parseAt(text);
    if (at !== null) {
      actions.push({
        id: id("move"),
        type: "move_clip",
        target: { startTime: at, ...(context.activeClipId ? { clipId: context.activeClipId } : {}) },
        confidence: 0.9,
        explanation: "Move the selected clip so it starts at the requested time, preserving its duration.",
      });
    }
  }

  // ── add text overlay (Command Editing v1, AC-9) ─────────────────────────────
  // 'add text "Hello" at bottom-center'. Position is a named 9-grid anchor token;
  // the apply-code maps it to percent geometry. Default anchor handled downstream.
  const textOverlay = text.match(/\badd text\s+["“](.+?)["”](?:\s+at\s+([a-z-]+))?/i);
  if (textOverlay) {
    const content = textOverlay[1] ?? "";
    const anchor = textOverlay[2]?.trim().toLowerCase();
    actions.push({
      id: id("text_overlay"),
      type: "add_text_overlay",
      text: content,
      ...(anchor ? { position: anchor } : {}),
      confidence: 0.9,
      explanation: "Create a text overlay clip at the named canvas anchor.",
    });
  }

  const silence = lower.match(/\bremove silence(?:\s+longer than\s+(\d+(?:\.\d+)?)\s*(?:s|seconds?)?)?/);
  if (silence) {
    actions.push({
      id: id("silence"),
      type: "remove_silence",
      minSilenceDuration: silence[1] ? Number(silence[1]) : 1,
      thresholdDb: -40,
      padding: 0.1,
      confidence: 0.7,
      explanation: "The command is understood, but waveform-based silence detection is not implemented in this editor yet.",
    });
  }

  return makePlan(actions, warnings);
}

export async function parseWithLLM(
  _command: string,
  context: TimelineContext,
  provider: LLMEditParserProvider = "local",
): Promise<EditPlan> {
  if (provider === "local") {
    return {
      summary: "Could not understand command",
      requiresConfirmation: false,
      actions: [],
      warnings: [`Try a command like "trim 0:30 to 0:43", "increase brightness by 10%", or "make it 9:16".`],
    };
  }

  const compactContext = JSON.stringify(context);
  const systemPrompt =
    "You are a video editing command parser. Convert user instructions into a structured JSON EditPlan. Do not perform edits. Do not explain. Only return valid JSON. Use seconds for all times. If the instruction is ambiguous, return warnings and requiresConfirmation true. Never invent clip IDs unless provided in context. Prefer targeting the active clip if context.activeClipId exists. For destructive actions, set requiresConfirmation true.";

  void compactContext;
  void systemPrompt;

  return {
    summary: "LLM parser not configured",
    requiresConfirmation: true,
    actions: [],
    warnings: [`${provider} parsing is available as an adapter seam, but no API key/client is wired in this build.`],
  };
}
