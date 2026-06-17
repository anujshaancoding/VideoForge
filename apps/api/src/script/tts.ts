// ─────────────────────────────────────────────────────────────────────────────
// Script Studio v2 — TTS seam (Contract C #2).
//
//   synthVoice(text, voiceId) -> { wavPath, durationMs, words? }
//
// ENGINE CHOICE (today, least setup on THIS machine): kokoro-js in Node, CPU-only,
// dtype "q8". It is a PURE npm package (no apt/binary install, no Python) that runs
// the Kokoro-82M ONNX model via transformers.js/onnxruntime on the CPU. The model
// weights are fetched from HuggingFace on first synth and cached on disk, so a warm
// machine is offline-deterministic. This is swappable: the Piper binary (CEO-approved
// 2026-06-05) drops in behind this same seam by setting TTS_ENGINE=piper.
//
// CPU-BOUNDED BY DESIGN: exactly ONE synth runs at a time (a module-level mutex /
// promise chain) — no new uncapped pool, no busy-loop. The caller (script worker /
// inline path) is itself serialized under the existing concurrency cap, and this
// mutex guarantees a single kokoro session even if two scenes race.
//
// DURATION = ffprobe (the source of truth, Contract B). We ALWAYS probe the produced
// WAV with the pinned ffprobe (FFPROBE_PATH). If ffprobe is unavailable (e.g. a dev
// box without the pinned build — this machine), we fall back to reading the WAV
// header, then to a words*characters estimate, so the seam degrades instead of
// throwing. In the worker image ffprobe is always present, so the probed value wins.
//
// WORD TIMINGS: optional today (even-distribution across the text). aeneas forced
// alignment is the fast-follow — left as the `// ALIGNER SEAM` below.
// ─────────────────────────────────────────────────────────────────────────────

import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const FFPROBE_PATH = process.env['FFPROBE_PATH'] ?? 'ffprobe';
const TTS_ENGINE = (process.env['TTS_ENGINE'] ?? 'kokoro').toLowerCase();
/** Default Kokoro voice; overridable per call via voiceId. 28+ EN voices exist. */
const KOKORO_DEFAULT_VOICE = process.env['KOKORO_VOICE'] ?? 'af_heart';
const KOKORO_MODEL =
  process.env['KOKORO_MODEL'] ?? 'onnx-community/Kokoro-82M-v1.0-ONNX';

export interface WordTiming {
  text: string;
  startMs: number;
  endMs: number;
}

export interface SynthResult {
  /** Absolute path to a real WAV on disk. */
  wavPath: string;
  /** Probed (ffprobe) duration in ms — the timing source of truth. */
  durationMs: number;
  /** Optional per-word timings (even-distributed today; aeneas fast-follow). */
  words?: WordTiming[];
}

// ── Single-flight mutex: only ONE synth at a time (CPU cap) ──────────────────
let synthChain: Promise<unknown> = Promise.resolve();
function runExclusive<T>(fn: () => Promise<T>): Promise<T> {
  const next = synthChain.then(fn, fn);
  // Keep the chain alive but swallow rejection so one failure doesn't poison the queue.
  synthChain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

// ── kokoro-js lazy singleton ─────────────────────────────────────────────────
// Loaded on first synth so importing this module never pulls onnxruntime / fetches
// the model. One TTS instance is reused across calls (the mutex serializes use).
let kokoroPromise: Promise<KokoroLike | null> | null = null;

interface KokoroAudioLike {
  // kokoro-js RawAudio exposes toWav(): ArrayBuffer (and save(path)).
  toWav(): ArrayBuffer;
}
interface KokoroLike {
  generate(text: string, opts: { voice: string }): Promise<KokoroAudioLike>;
}

async function getKokoro(): Promise<KokoroLike | null> {
  if (!kokoroPromise) {
    kokoroPromise = (async () => {
      try {
        // Dynamic import so importing this module never pulls onnxruntime / fetches
        // the model, and a machine WITHOUT kokoro-js installed (optionalDependency)
        // still runs the rest of the seam (probe/estimate) in degraded mode. The
        // specifier is computed so TS doesn't hard-require the optional module at
        // typecheck time.
        const spec = 'kokoro-js';
        const mod = (await import(spec)) as {
          KokoroTTS: { from_pretrained: (m: string, o: object) => Promise<KokoroLike> };
        };
        const KokoroTTS = mod.KokoroTTS;
        return await KokoroTTS.from_pretrained(KOKORO_MODEL, {
          dtype: 'q8',
          device: 'cpu',
        });
      } catch (err) {
        console.warn(
          `[tts] kokoro-js unavailable (${err instanceof Error ? err.message : String(err)}); using silent-WAV fallback`,
        );
        return null;
      }
    })();
  }
  return kokoroPromise;
}

// ── ffprobe duration (source of truth) ───────────────────────────────────────

interface FfprobeJson {
  format?: { duration?: string | number };
}

async function probeDurationMs(wavPath: string): Promise<number | null> {
  return new Promise<number | null>((resolve) => {
    const child = spawn(
      FFPROBE_PATH,
      ['-v', 'quiet', '-print_format', 'json', '-show_format', wavPath],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const chunks: Buffer[] = [];
    child.stdout.on('data', (c: Buffer) => chunks.push(c));
    child.stderr.on('data', () => undefined);
    child.on('error', () => resolve(null));
    child.on('close', (code) => {
      if (code !== 0) return resolve(null);
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString()) as FfprobeJson;
        const raw = parsed.format?.duration;
        const sec = typeof raw === 'number' ? raw : Number.parseFloat(raw ?? '');
        if (Number.isFinite(sec) && sec >= 0) return resolve(Math.round(sec * 1000));
      } catch {
        /* fall through */
      }
      resolve(null);
    });
  });
}

/** Read duration straight from a canonical PCM WAV header (RIFF fmt/data). */
async function wavHeaderDurationMs(wavPath: string): Promise<number | null> {
  try {
    const buf = await readFile(wavPath);
    if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF') return null;
    const byteRate = buf.readUInt32LE(28); // bytes/sec
    // Find the 'data' chunk size (it isn't always at offset 40).
    let offset = 12;
    while (offset + 8 <= buf.length) {
      const id = buf.toString('ascii', offset, offset + 4);
      const size = buf.readUInt32LE(offset + 4);
      if (id === 'data') {
        if (byteRate > 0) return Math.round((size / byteRate) * 1000);
        return null;
      }
      offset += 8 + size + (size % 2);
    }
    return null;
  } catch {
    return null;
  }
}

/** Last-resort estimate from text length (≈ 380ms/word, clamped 800..20000). */
function estimateDurationMs(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length || 1;
  return Math.min(20000, Math.max(800, words * 380));
}

// ── Word timings (even-distribution; aeneas seam) ────────────────────────────

function evenWordTimings(text: string, durationMs: number): WordTiming[] {
  const tokens = text.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];
  // Weight each word by character length so longer words get more time.
  const weights = tokens.map((t) => Math.max(1, t.length));
  const total = weights.reduce((a, b) => a + b, 0);
  let acc = 0;
  return tokens.map((t, i) => {
    const startMs = Math.round((acc / total) * durationMs);
    acc += weights[i]!;
    const endMs = Math.round((acc / total) * durationMs);
    return { text: t, startMs, endMs };
  });
  // ALIGNER SEAM: swap this even-distribution for aeneas forced alignment
  // (known text + the produced WAV → precise per-word start/end) as a fast-follow.
  // The return shape is identical, so only this function body changes.
}

// ── A valid silent WAV (fallback when no TTS engine is installed) ────────────
// Produces a REAL, ffprobe-readable mono 16-bit PCM WAV of the estimated length so
// the downstream asset/probe/assemble path is exercised end-to-end on a dev box
// without kokoro. In the worker image kokoro produces real speech instead.
function buildSilentWav(durationMs: number): Buffer {
  const sampleRate = 24000; // kokoro's native rate
  const numSamples = Math.max(1, Math.round((durationMs / 1000) * sampleRate));
  const dataBytes = numSamples * 2; // 16-bit mono
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16); // fmt chunk size
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buf.writeUInt16LE(2, 32); // block align
  buf.writeUInt16LE(16, 34); // bits/sample
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataBytes, 40);
  // samples already zero (silence)
  return buf;
}

/**
 * Synthesize speech for `text` with `voiceId` → a real WAV + its PROBED duration.
 *
 * - Runs exclusively (one synth at a time → CPU-bounded).
 * - Engine: kokoro-js (CPU, q8) by default; Piper drops in behind this seam.
 * - Duration = ffprobe(wav) → WAV header → estimate (in that precedence). The
 *   probed value is authoritative and is what the assembler uses for scene windows.
 */
export async function synthVoice(
  text: string,
  voiceId: string,
): Promise<SynthResult> {
  return runExclusive(async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vf-tts-'));
    const wavPath = join(dir, 'voiceover.wav');
    const voice = voiceId && voiceId.trim() ? voiceId.trim() : KOKORO_DEFAULT_VOICE;

    let synthesized = false;
    if (TTS_ENGINE === 'kokoro') {
      const tts = await getKokoro();
      if (tts) {
        try {
          const audio = await tts.generate(text, { voice });
          await writeFile(wavPath, Buffer.from(audio.toWav()));
          synthesized = true;
        } catch (err) {
          console.warn(
            `[tts] kokoro synth failed (${err instanceof Error ? err.message : String(err)}); using silent-WAV fallback`,
          );
        }
      }
    }
    // PIPER SEAM: when TTS_ENGINE==='piper', spawn the pinned piper binary here
    // (echo text | piper --model <voice.onnx> --output_file wavPath) and set
    // synthesized=true. Output is the same WAV contract — nothing downstream changes.

    if (!synthesized) {
      // No engine on this machine — emit a valid silent WAV of the estimated length
      // so the asset/probe/assemble path still runs (degraded, but real-file).
      await writeFile(wavPath, buildSilentWav(estimateDurationMs(text)));
    }

    // Duration: ffprobe is the source of truth; degrade to header, then estimate.
    const probed =
      (await probeDurationMs(wavPath)) ??
      (await wavHeaderDurationMs(wavPath)) ??
      estimateDurationMs(text);
    const durationMs = Math.max(1, probed);

    return {
      wavPath,
      durationMs,
      words: evenWordTimings(text, durationMs),
    };
  });
}
