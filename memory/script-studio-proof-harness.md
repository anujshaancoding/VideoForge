---
name: script-studio-proof-harness
description: Where the local $0 sketch-image proof + Python OpenCV reference filter live
metadata:
  type: reference
---

Scratch harness used to prove the $0 sketch pipeline (not committed): `/tmp/sketch-proof/`.
- `venv/` — Python 3.9 + opencv-python-headless 4.13 (reference filter only; production uses sharp, not this).
- `sketch.py` — original OpenCV pencil/pen/color reference (graphite dodge, adaptiveThreshold pen, cv2.pencilSketch color).
- `sharp_proto.cjs` — the sharp port that became apps/api/src/script/sketch.ts.
- `local0_*.png`, `prod_scene*_pen.png` — sample base + sketch outputs from live Draw Things.

Production filter is pure-Node **sharp** (no Python/opencv dependency) in apps/api. /tmp is ephemeral — regenerate if gone. See [[script-studio-sketch-images]].
