import { describe, expect, it } from "vitest";
import {
  scenePlanSchema,
  validateScenePlan,
  planFromHeuristic,
  heuristicDurationMs,
  MAX_SCENES,
} from "../plan.js";

const SCRIPT =
  "Welcome to VideoForge. Paste a script and get a draft video in minutes.\n\n" +
  "It is genuinely that simple.";

describe("planFromHeuristic — Contract A shape & validity", () => {
  it("derives a plan that passes scenePlanSchema", () => {
    const plan = planFromHeuristic(SCRIPT);
    expect(scenePlanSchema.safeParse(plan).success).toBe(true);
    expect(validateScenePlan(plan).ok).toBe(true);
  });

  it("emits one scene per segment, in order", () => {
    const plan = planFromHeuristic(SCRIPT);
    // 3 sentences across 2 paragraphs.
    expect(plan.scenes).toHaveLength(3);
    expect(plan.scenes[0]!.voiceoverText).toBe("Welcome to VideoForge.");
  });

  it("smallCaption is the first ~6 words (≤ 80 chars)", () => {
    const plan = planFromHeuristic(SCRIPT);
    const s = plan.scenes[1]!;
    expect(s.smallCaption).toBe("Paste a script and get a");
    expect(s.smallCaption.length).toBeLessThanOrEqual(80);
  });

  it("bigCaptionWords are the whitespace tokens (≥1, ≤60)", () => {
    const plan = planFromHeuristic(SCRIPT);
    expect(plan.scenes[0]!.bigCaptionWords).toEqual(["Welcome", "to", "VideoForge."]);
    for (const sc of plan.scenes) {
      expect(sc.bigCaptionWords.length).toBeGreaterThanOrEqual(1);
      expect(sc.bigCaptionWords.length).toBeLessThanOrEqual(60);
    }
  });

  it("keywords drop stopwords, dedupe, ≥1 and ≤8", () => {
    const plan = planFromHeuristic(SCRIPT);
    const kw = plan.scenes[1]!.brollSuggestion.keywords;
    expect(kw.length).toBeGreaterThanOrEqual(1);
    expect(kw.length).toBeLessThanOrEqual(8);
    // "a", "and", "get" stopword-ish removed; concrete tokens kept.
    expect(kw).toContain("paste");
    expect(kw).toContain("script");
    expect(kw).not.toContain("a");
    expect(kw).not.toContain("and");
  });

  it("suggestedDurationMs = clamp(wordCount * 380, 800, 20000), integer", () => {
    expect(heuristicDurationMs(0)).toBe(800);
    expect(heuristicDurationMs(1)).toBe(800); // 380 < 800 floor
    expect(heuristicDurationMs(5)).toBe(1900);
    expect(heuristicDurationMs(1000)).toBe(20000); // ceiling
    const plan = planFromHeuristic(SCRIPT);
    for (const sc of plan.scenes) {
      expect(Number.isInteger(sc.suggestedDurationMs)).toBe(true);
      expect(sc.suggestedDurationMs).toBeGreaterThanOrEqual(800);
      expect(sc.suggestedDurationMs).toBeLessThanOrEqual(20000);
    }
  });

  it("mediaType heuristic picks photo on photo cue words", () => {
    expect(planFromHeuristic("A portrait photo of the founder.").scenes[0]!.brollSuggestion.mediaType)
      .toBe("photo");
    expect(planFromHeuristic("Some action footage of the launch.").scenes[0]!.brollSuggestion.mediaType)
      .toBe("video");
    expect(planFromHeuristic("Nothing special here.").scenes[0]!.brollSuggestion.mediaType)
      .toBe("video");
  });
});

describe("planFromHeuristic — determinism & bounds", () => {
  it("same script ⇒ byte-identical plan", () => {
    expect(JSON.stringify(planFromHeuristic(SCRIPT))).toBe(JSON.stringify(planFromHeuristic(SCRIPT)));
  });

  it("empty / whitespace script yields a single valid placeholder scene", () => {
    for (const s of ["", "   ", "\n\n\t"]) {
      const plan = planFromHeuristic(s);
      expect(plan.scenes).toHaveLength(1);
      expect(validateScenePlan(plan).ok).toBe(true);
    }
  });

  it("caps at MAX_SCENES (CPU bound)", () => {
    const many = Array.from({ length: 100 }, (_, i) => `Sentence number ${i}.`).join(" ");
    const plan = planFromHeuristic(many);
    expect(plan.scenes.length).toBe(MAX_SCENES);
    expect(validateScenePlan(plan).ok).toBe(true);
  });
});

describe("scenePlanSchema — mirrors Research_Tech §1 (strict)", () => {
  const goodScene = {
    voiceoverText: "Hello world.",
    smallCaption: "Hello",
    bigCaptionWords: ["Hello", "world"],
    brollSuggestion: { mediaType: "video", keywords: ["hello"], description: "x" },
    suggestedDurationMs: 1000,
  };

  it("accepts a minimal valid plan", () => {
    expect(scenePlanSchema.safeParse({ scenes: [goodScene] }).success).toBe(true);
  });

  it("rejects extra/unknown keys (.strict)", () => {
    const bad = { scenes: [{ ...goodScene, extra: 1 }] };
    expect(scenePlanSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects 0 scenes and > 40 scenes", () => {
    expect(scenePlanSchema.safeParse({ scenes: [] }).success).toBe(false);
    const tooMany = { scenes: Array.from({ length: 41 }, () => goodScene) };
    expect(scenePlanSchema.safeParse(tooMany).success).toBe(false);
  });

  it("enforces field bounds (duration range, voiceover length, keyword count)", () => {
    expect(scenePlanSchema.safeParse({ scenes: [{ ...goodScene, suggestedDurationMs: 500 }] }).success).toBe(false);
    expect(scenePlanSchema.safeParse({ scenes: [{ ...goodScene, suggestedDurationMs: 99999 }] }).success).toBe(false);
    expect(scenePlanSchema.safeParse({ scenes: [{ ...goodScene, voiceoverText: "" }] }).success).toBe(false);
    expect(scenePlanSchema.safeParse({
      scenes: [{ ...goodScene, brollSuggestion: { ...goodScene.brollSuggestion, keywords: [] } }],
    }).success).toBe(false);
    expect(scenePlanSchema.safeParse({ scenes: [{ ...goodScene, bigCaptionWords: [] }] }).success).toBe(false);
  });
});
