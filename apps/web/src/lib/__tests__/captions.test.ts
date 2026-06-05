import { describe, it, expect } from "vitest";
import { parseCaptions } from "../captions.js";

// parseCaptions is the single shared SRT/VTT importer used by both the MediaPanel
// Captions tab and the Inspector caption-editor "Import" button. These pin the
// timestamp parsing (comma vs dot), metadata skipping, ordering, and resilience.

describe("parseCaptions — SRT", () => {
  it("parses standard SRT cues into ms-timed blocks", () => {
    const srt = [
      "1",
      "00:00:01,000 --> 00:00:03,500",
      "Hello world",
      "",
      "2",
      "00:00:04,000 --> 00:00:06,250",
      "Second line",
    ].join("\n");
    const blocks = parseCaptions(srt);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ startMs: 1000, endMs: 3500, text: "Hello world" });
    expect(blocks[1]).toMatchObject({ startMs: 4000, endMs: 6250, text: "Second line" });
    expect(typeof blocks[0]!.id).toBe("string");
  });

  it("keeps multi-line cue text", () => {
    const srt = "1\n00:00:00,000 --> 00:00:02,000\nline one\nline two";
    expect(parseCaptions(srt)[0]!.text).toBe("line one\nline two");
  });

  it("tolerates CRLF line endings", () => {
    const srt = "1\r\n00:00:01,000 --> 00:00:02,000\r\nHi\r\n";
    expect(parseCaptions(srt)[0]).toMatchObject({ startMs: 1000, endMs: 2000, text: "Hi" });
  });
});

describe("parseCaptions — WebVTT", () => {
  it("parses VTT (dot separator) and drops the WEBVTT header", () => {
    const vtt = [
      "WEBVTT",
      "",
      "00:00:01.000 --> 00:00:03.500",
      "Hello vtt",
      "",
      "cue-id",
      "00:00:04.000 --> 00:00:06.000",
      "With identifier",
    ].join("\n");
    const blocks = parseCaptions(vtt);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ startMs: 1000, endMs: 3500, text: "Hello vtt" });
    expect(blocks[1]).toMatchObject({ startMs: 4000, endMs: 6000, text: "With identifier" });
  });

  it("skips NOTE / STYLE / REGION metadata blocks", () => {
    const vtt = [
      "WEBVTT",
      "",
      "NOTE this is a comment",
      "",
      "STYLE",
      "::cue { color: white }",
      "",
      "00:00:00.500 --> 00:00:01.500",
      "Only cue",
    ].join("\n");
    const blocks = parseCaptions(vtt);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ startMs: 500, endMs: 1500, text: "Only cue" });
  });

  it("accepts the VTT short MM:SS.mmm timestamp form", () => {
    const vtt = "WEBVTT\n\n01:02.500 --> 01:04.000\nshort form";
    expect(parseCaptions(vtt)[0]).toMatchObject({ startMs: 62500, endMs: 64000 });
  });
});

describe("parseCaptions — resilience + ordering", () => {
  it("returns [] for empty input", () => {
    expect(parseCaptions("")).toEqual([]);
    expect(parseCaptions("   \n\n ")).toEqual([]);
  });

  it("skips malformed cues but keeps valid ones", () => {
    const srt = [
      "garbage with no timing",
      "",
      "1",
      "00:00:01,000 --> 00:00:02,000",
      "good",
    ].join("\n");
    const blocks = parseCaptions(srt);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.text).toBe("good");
  });

  it("sorts cues by start time", () => {
    const srt = [
      "1",
      "00:00:05,000 --> 00:00:06,000",
      "later",
      "",
      "2",
      "00:00:01,000 --> 00:00:02,000",
      "earlier",
    ].join("\n");
    const blocks = parseCaptions(srt);
    expect(blocks.map((b) => b.text)).toEqual(["earlier", "later"]);
  });
});
