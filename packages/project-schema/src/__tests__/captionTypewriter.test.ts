// ─────────────────────────────────────────────────────────────────────────────
// captionTypewriter — the SHARED pure helper that both the web PreviewEngine and
// the FFmpeg export consume to compute the character-by-character caption reveal.
// These tests pin the contract both sides depend on:
//   • getRevealedPrefix returns a growing prefix of the overlay text from the
//     timeline-absolute word windows (even-distribution within a word);
//   • absent / malformed timing ⇒ full text + a single whole-text reveal step, so
//     the export stays byte-identical to today (backward-compat guardrail).
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import {
  getRevealedPrefix,
  getCharRevealSteps,
  getTypewriterWords,
  type TextOverlay,
} from "../index.js";

function overlay(text: string, tw?: TextOverlay["animation"]["typewriter"]): TextOverlay {
  return {
    id: "ov",
    trackId: "t",
    kind: "text",
    startOnTimeline: 0,
    endOnTimeline: 1000,
    canvasX: 0,
    canvasY: 80,
    width: 100,
    height: 15,
    rotation: 0,
    opacity: 100,
    animation: tw ? { typewriter: tw } : {},
    keyframes: {},
    text,
    style: {
      fontFamily: "Inter",
      fontSize: 48,
      fontWeight: 600,
      color: "#FFFFFF",
      align: "center",
    },
  };
}

const HI_ALL = {
  words: [
    { text: "Hi", startMs: 0, endMs: 500 },
    { text: "all", startMs: 500, endMs: 1000 },
  ],
};

describe("getTypewriterWords", () => {
  it("returns null when timing is absent", () => {
    expect(getTypewriterWords(overlay("hello"))).toBeNull();
  });
  it("returns null for an empty words[]", () => {
    expect(getTypewriterWords(overlay("hello", { words: [] }))).toBeNull();
  });
  it("returns the words when present", () => {
    expect(getTypewriterWords(overlay("Hi all", HI_ALL))).toHaveLength(2);
  });
});

describe("getRevealedPrefix — backward compatibility (static)", () => {
  it("returns the FULL text when timing is absent (byte-identical to today)", () => {
    const ov = overlay("Static caption");
    for (const t of [0, 500, 5000]) {
      expect(getRevealedPrefix(ov, t)).toBe("Static caption");
    }
  });
  it("returns the full text for empty timing", () => {
    expect(getRevealedPrefix(overlay("x", { words: [] }), 0)).toBe("x");
  });
});

describe("getRevealedPrefix — character reveal", () => {
  const ov = overlay("Hi all", HI_ALL);

  it("reveals a growing prefix synced to the word windows", () => {
    // "Hi" = 2 chars across [0,500): char0@0, char1@250.
    expect(getRevealedPrefix(ov, 0)).toBe("H");
    expect(getRevealedPrefix(ov, 249)).toBe("H");
    expect(getRevealedPrefix(ov, 250)).toBe("Hi");
    // space + "all" reveal from 500; "all" = 3 chars across [500,1000): @500,@667,@833.
    expect(getRevealedPrefix(ov, 500)).toBe("Hi a"); // space (at 500) + 'a' (at 500)
    expect(getRevealedPrefix(ov, 999)).toBe("Hi all");
  });

  it("the prefix is monotonic non-decreasing in length over time", () => {
    let prevLen = -1;
    for (let t = 0; t <= 1000; t += 50) {
      const len = getRevealedPrefix(ov, t).length;
      expect(len).toBeGreaterThanOrEqual(prevLen);
      prevLen = len;
    }
  });

  it("is fully revealed at and beyond the overlay end", () => {
    expect(getRevealedPrefix(ov, 1000)).toBe("Hi all");
    expect(getRevealedPrefix(ov, 99999)).toBe("Hi all");
  });
});

describe("getCharRevealSteps — exporter schedule", () => {
  it("absent timing ⇒ a SINGLE whole-text step at startOnTimeline", () => {
    const ov = overlay("Static");
    const steps = getCharRevealSteps(ov);
    // Single whole-text step spanning the overlay window; charEndMs = overlay end so the
    // exporter emits enable='between(t,start,end)' byte-identical to the historical stage.
    expect(steps).toEqual([{ prefix: "Static", charStartMs: 0, charEndMs: 1000 }]);
  });

  it("with timing ⇒ ordered steps whose final prefix is the full text", () => {
    const steps = getCharRevealSteps(overlay("Hi all", HI_ALL));
    expect(steps.length).toBeGreaterThan(1);
    // Strictly ascending reveal times (collapsed per distinct time).
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i]!.charStartMs).toBeGreaterThan(steps[i - 1]!.charStartMs);
    }
    // Each step is a growing prefix; the last is the full text.
    expect(steps[steps.length - 1]!.prefix).toBe("Hi all");
    for (const s of steps) {
      expect("Hi all".startsWith(s.prefix)).toBe(true);
    }
  });

  it("step count never exceeds the character count (filtergraph budget)", () => {
    const ov = overlay("Hi all", HI_ALL);
    expect(getCharRevealSteps(ov).length).toBeLessThanOrEqual("Hi all".length);
  });
});

describe("getCharRevealSteps / getRevealedPrefix — edge cases", () => {
  function isPrefixOf(whole: string, part: string): boolean {
    return whole.startsWith(part);
  }

  it("empty words[] ⇒ a single static whole-text step (no crash)", () => {
    const ov = overlay("Hi all", { words: [] });
    expect(getCharRevealSteps(ov)).toEqual([{ prefix: "Hi all", charStartMs: 0, charEndMs: 1000 }]);
    expect(getRevealedPrefix(ov, 0)).toBe("Hi all");
  });

  it("empty / whitespace-only text never throws and reveals the (empty) full text", () => {
    for (const text of ["", "   "]) {
      const ov = overlay(text, HI_ALL);
      expect(() => getCharRevealSteps(ov)).not.toThrow();
      const steps = getCharRevealSteps(ov);
      expect(steps[steps.length - 1]!.prefix).toBe(text); // last step == full text
      expect(getRevealedPrefix(ov, 99999)).toBe(text);
    }
  });

  const MULTILINE = {
    words: [
      { text: "Line", startMs: 0, endMs: 250 },
      { text: "one", startMs: 250, endMs: 500 },
      { text: "Line", startMs: 500, endMs: 750 },
      { text: "two", startMs: 750, endMs: 1000 },
    ],
  };

  it("multi-line text (\\n) reveals a growing prefix that crosses the newline", () => {
    const full = "Line one\nLine two";
    const ov = overlay(full, MULTILINE);
    // Every step prefix is a real prefix of the full multi-line string; last == full.
    for (const s of getCharRevealSteps(ov)) expect(isPrefixOf(full, s.prefix)).toBe(true);
    expect(getRevealedPrefix(ov, 1000)).toBe(full);
    // Monotonic non-decreasing length across the window.
    let prev = -1;
    for (let t = 0; t <= 1000; t += 50) {
      const len = getRevealedPrefix(ov, t).length;
      expect(len).toBeGreaterThanOrEqual(prev);
      prev = len;
    }
  });

  it("unicode / emoji text reveals valid prefixes and never throws", () => {
    const full = "café 🎉 ok";
    const ov = overlay(full, {
      words: [
        { text: "café", startMs: 0, endMs: 400 },
        { text: "🎉", startMs: 400, endMs: 700 },
        { text: "ok", startMs: 700, endMs: 1000 },
      ],
    });
    expect(() => getCharRevealSteps(ov)).not.toThrow();
    for (const s of getCharRevealSteps(ov)) expect(isPrefixOf(full, s.prefix)).toBe(true);
    expect(getRevealedPrefix(ov, 1000)).toBe(full);
  });
});
