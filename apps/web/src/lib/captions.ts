// ─────────────────────────────────────────────────────────────────────────────
// Caption sidecar parsing — SRT + WebVTT → CaptionBlock[].
//
// Pure + dependency-free so it can be unit-tested in isolation and reused by both
// the MediaPanel Captions tab and the Inspector's caption editor "Import" button.
// The shape returned matches the subset of `CaptionBlock` the store needs
// (id/startMs/endMs/text); the caller casts to CaptionBlock when handing it to
// `importCaptions`. Times are integer ms (the §18 invariant).
// ─────────────────────────────────────────────────────────────────────────────

/** A parsed caption cue — the CaptionBlock subset the editor store consumes. */
export interface ParsedCaption {
  id: string;
  startMs: number;
  endMs: number;
  text: string;
}

/** Stable id source; falls back to a counter when crypto.randomUUID is absent (tests). */
function makeId(seq: number): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    /* ignore — fall through to deterministic id */
  }
  return `cap-${seq}`;
}

/**
 * Parse a timestamp into integer ms. Accepts both the SRT form `HH:MM:SS,mmm` and
 * the WebVTT form `HH:MM:SS.mmm` (and the VTT-permitted short form `MM:SS.mmm`).
 * Returns NaN for anything it can't read so the caller can skip the cue.
 */
function timeToMs(stamp: string): number {
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})$/.exec(stamp.trim());
  if (!m) return Number.NaN;
  const h = m[1] ? Number(m[1]) : 0;
  const min = Number(m[2]);
  const sec = Number(m[3]);
  // Right-pad the fractional part so ".5" → 500ms, ".05" → 50ms, ".050" → 50ms.
  const frac = Number((m[4] ?? '').padEnd(3, '0').slice(0, 3));
  return ((h * 60 + min) * 60 + sec) * 1000 + frac;
}

/**
 * Parse SRT or WebVTT subtitle text into caption cues. Format is auto-detected:
 * a leading `WEBVTT` header (or `.` decimal separators) is treated as VTT;
 * otherwise SRT. Both share the same cue grammar (`start --> end` then one or more
 * text lines), so a single block-splitter handles both. Malformed cues are skipped
 * rather than throwing, so a partially-broken file still imports what it can.
 */
export function parseCaptions(input: string): ParsedCaption[] {
  // Normalise line endings (Windows \r\n, lone \r) before splitting on blank lines.
  const text = input.replace(/\r\n?/g, '\n').trim();
  if (text === '') return [];

  // Drop a leading WEBVTT header line + any VTT region/style/note metadata blocks.
  const cues: ParsedCaption[] = [];
  let seq = 0;
  for (const rawBlock of text.split(/\n{2,}/)) {
    const block = rawBlock.trim();
    if (block === '') continue;
    // Skip VTT metadata blocks (header, NOTE comments, STYLE/REGION definitions).
    if (/^WEBVTT\b/.test(block)) continue;
    if (/^(NOTE|STYLE|REGION)\b/.test(block)) continue;

    const lines = block.split('\n');
    // The first line may be a numeric SRT index (or a VTT cue identifier); find the
    // line that actually holds the `-->` timing.
    const timeIdx = lines.findIndex((l) => l.includes('-->'));
    if (timeIdx === -1) continue;

    const timeLine = lines[timeIdx]!;
    const tm = /([0-9:.,]+)\s*-->\s*([0-9:.,]+)/.exec(timeLine);
    if (!tm) continue;
    const startMs = timeToMs(tm[1]!);
    const endMs = timeToMs(tm[2]!);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) continue;

    const body = lines
      .slice(timeIdx + 1)
      .join('\n')
      .trim();
    if (body === '') continue;

    cues.push({ id: makeId(seq++), startMs, endMs, text: body });
  }

  // Stable ordering by start time so the caption editor table reads top-to-bottom.
  return cues.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
}
