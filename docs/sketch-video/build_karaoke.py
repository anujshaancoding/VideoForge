#!/usr/bin/env python
# Forced-ish alignment via faster-whisper word timestamps → ASS karaoke (per-word
# highlight, synced to the actual audio). Outputs karaoke.ass + durations.json.
import json, os, sys
from faster_whisper import WhisperModel

ASSETS = "/tmp/vf-run/v2assets"
plan = json.load(open("/tmp/vf-run/v2plan.json"))
scenes = sorted(plan["scenes"], key=lambda s: s["i"])

model = WhisperModel("base.en", device="cpu", compute_type="int8")

def cc(t):  # seconds -> H:MM:SS.cc
    h = int(t // 3600); m = int((t % 3600) // 60); s = t % 60
    return f"{h}:{m:02d}:{s:05.2f}"

lines = []        # (start, end, ass_text)
durations = []    # per-scene seconds (for ffmpeg -t)
offset = 0.0
WORDS_PER_LINE = 6

for sc in scenes:
    wav = f"{ASSETS}/scene{sc['i']}.wav"
    segs, info = model.transcribe(wav, word_timestamps=True, language="en")
    words = []
    for seg in segs:
        for w in (seg.words or []):
            txt = w.word.strip()
            if txt:
                words.append((w.start, w.end, txt))
    dur = info.duration
    durations.append(round(dur, 3))
    # group into lines of ~6 words
    for i in range(0, len(words), WORDS_PER_LINE):
        grp = words[i:i + WORDS_PER_LINE]
        if not grp:
            continue
        line_start = offset + grp[0][0]
        line_end = offset + grp[-1][1]
        parts = []
        for j, (ws, we, wt) in enumerate(grp):
            nxt = grp[j + 1][0] if j + 1 < len(grp) else we
            d_cs = max(1, round((nxt - ws) * 100))
            # escape ASS special chars minimally
            wt = wt.replace("{", "(").replace("}", ")")
            parts.append(f"{{\\kf{d_cs}}}{wt} ")
        lines.append((line_start, line_end, "".join(parts).strip()))
    offset += dur

# ASS file: bottom-centred, white text, YELLOW karaoke fill, black outline.
header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Karaoke, Arial, 54, &H0000FFFF, &H00FFFFFF, &H00000000, &H64000000, -1, 0, 0, 0, 100, 100, 0, 0, 1, 4, 1, 2, 60, 60, 150, 1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
with open("/tmp/vf-run/karaoke.ass", "w") as f:
    f.write(header)
    for (s, e, t) in lines:
        f.write(f"Dialogue: 0,{cc(s)},{cc(e)},Karaoke,,0,0,0,,{t}\n")

json.dump(durations, open("/tmp/vf-run/durations.json", "w"))
print(f"scenes={len(scenes)} lines={len(lines)} total={round(offset,1)}s")
print("sample:", lines[1][2][:80] if len(lines) > 1 else "")
