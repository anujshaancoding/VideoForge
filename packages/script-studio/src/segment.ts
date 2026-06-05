// ─────────────────────────────────────────────────────────────────────────────
// Script Studio — segmentation (P0, pure heuristic).
//
// Turns a raw script string into an ordered list of `ScriptSegment`s on
// paragraph/sentence boundaries. NO LLM, NO network, NO randomness, NO clock —
// the same input always yields the same segments (this is asserted by the golden
// assembly test). Timing/durations are NOT decided here; they are caller-supplied
// inputs to the assembler (P1 will probe real TTS durations).
//
// The split rule (deterministic):
//   1. Normalise newlines and trim outer whitespace.
//   2. Split into paragraphs on one-or-more blank lines.
//   3. Within each paragraph, split into sentences on terminal punctuation
//      (. ! ?) followed by whitespace, keeping the punctuation with the sentence.
//   4. Collapse internal runs of whitespace in each sentence to single spaces.
//   5. Drop empty fragments. Each surviving fragment is one segment.
//
// Abbreviations / decimals are intentionally NOT special-cased in P0 (no locale
// model, no randomness). The heuristic is documented and stable; refinement is a
// later, separately-tested change.
// ─────────────────────────────────────────────────────────────────────────────

/** One spoken unit of the script. Index is its 0-based order in the script. */
export interface ScriptSegment {
  /** 0-based position in the ordered segment list. */
  index: number;
  /** 0-based index of the source paragraph this segment came from. */
  paragraphIndex: number;
  /** The segment's spoken text, whitespace-normalised. */
  text: string;
}

/** Split a script string into ordered, whitespace-normalised segments. */
export function segmentScript(script: string): ScriptSegment[] {
  if (typeof script !== "string") return [];

  // 1. Normalise newlines, drop a leading BOM, trim outer whitespace.
  const normalised = script.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim();
  if (normalised.length === 0) return [];

  // 2. Paragraphs: split on one-or-more blank lines (a line that is empty or only
  //    whitespace separates paragraphs).
  const paragraphs = normalised.split(/\n[ \t]*\n+/);

  const segments: ScriptSegment[] = [];
  let index = 0;
  let paragraphIndex = 0;

  for (const rawParagraph of paragraphs) {
    const paragraph = rawParagraph.trim();
    if (paragraph.length === 0) continue;

    // 3. Sentence split: terminal . ! ? (one or more) followed by whitespace.
    //    The lookbehind keeps the punctuation attached to the preceding sentence.
    const sentences = paragraph.split(/(?<=[.!?])\s+/);

    let emittedFromParagraph = false;
    for (const rawSentence of sentences) {
      // 4. Collapse internal whitespace (incl. the single-newline soft wraps inside
      //    a paragraph) to single spaces; trim.
      const text = rawSentence.replace(/\s+/g, " ").trim();
      // 5. Drop empties.
      if (text.length === 0) continue;
      segments.push({ index, paragraphIndex, text });
      index += 1;
      emittedFromParagraph = true;
    }

    if (emittedFromParagraph) paragraphIndex += 1;
  }

  return segments;
}
