import { describe, expect, it } from "vitest";
import { segmentScript } from "../segment.js";

describe("segmentScript", () => {
  it("returns no segments for empty / whitespace-only / non-string input", () => {
    expect(segmentScript("")).toEqual([]);
    expect(segmentScript("   \n\t  \n ")).toEqual([]);
    // @ts-expect-error — defensive: non-string input is tolerated, not thrown.
    expect(segmentScript(undefined)).toEqual([]);
    // @ts-expect-error — defensive: null input is tolerated, not thrown.
    expect(segmentScript(null)).toEqual([]);
  });

  it("splits a single paragraph into sentences on . ! ?", () => {
    const segs = segmentScript("Hello world. How are you? I am fine!");
    expect(segs.map((s) => s.text)).toEqual([
      "Hello world.",
      "How are you?",
      "I am fine!",
    ]);
    expect(segs.map((s) => s.index)).toEqual([0, 1, 2]);
    expect(segs.every((s) => s.paragraphIndex === 0)).toBe(true);
  });

  it("treats blank lines as paragraph boundaries and tracks paragraphIndex", () => {
    const segs = segmentScript("First para sentence one. Sentence two.\n\nSecond para.");
    expect(segs.map((s) => s.text)).toEqual([
      "First para sentence one.",
      "Sentence two.",
      "Second para.",
    ]);
    expect(segs.map((s) => s.paragraphIndex)).toEqual([0, 0, 1]);
  });

  it("collapses soft-wrap newlines and runs of whitespace within a sentence", () => {
    const segs = segmentScript("This is a\nsoft-wrapped    sentence  with\textra spaces.");
    expect(segs).toHaveLength(1);
    expect(segs[0]!.text).toBe("This is a soft-wrapped sentence with extra spaces.");
  });

  it("handles a trailing sentence with no terminal punctuation", () => {
    const segs = segmentScript("First sentence. A fragment with no period");
    expect(segs.map((s) => s.text)).toEqual([
      "First sentence.",
      "A fragment with no period",
    ]);
  });

  it("normalises CRLF / CR newlines and a leading BOM", () => {
    // CRLF blank line = paragraph break; a bare CR after a sentence terminator is
    // whitespace, so it acts as a sentence boundary within the second paragraph.
    const segs = segmentScript("\uFEFFLine one.\r\n\r\nLine two.\rLine three.");
    expect(segs.map((s) => s.text)).toEqual(["Line one.", "Line two.", "Line three."]);
    expect(segs.map((s) => s.paragraphIndex)).toEqual([0, 1, 1]);
  });

  it("splits on terminal punctuation + whitespace (ellipsis is not special-cased in P0)", () => {
    const segs = segmentScript("Wait... really?! Yes.");
    // Documented P0 heuristic: any . ! ? run followed by whitespace ends a sentence.
    // Ellipses are intentionally NOT special-cased — refinement is a later change.
    expect(segs.map((s) => s.text)).toEqual(["Wait...", "really?!", "Yes."]);
  });

  it("is deterministic — same input yields identical output", () => {
    const input = "A. B! C?\n\nD.";
    expect(segmentScript(input)).toEqual(segmentScript(input));
  });
});
