---
description: Run the full build loop on a feature — Vera scopes, engineers build, Sentinel verifies, Forge reviews
argument-hint: <feature or task to ship>
---

Act as **Atlas** and drive the build loop for: **$ARGUMENTS**

Orchestrate the right personas via the `Agent` tool (`subagent_type:`), in this order, skipping
stages that don't apply:

1. **Vera** — confirm it's in `docs/MVP_Scope.md` (if not → STOP, raise a 🧭 Scope gate in
   `company/DECISIONS.md`). Otherwise write crisp acceptance criteria.
2. **Iris** — if there's UI, produce/confirm the design brief (brand rules + tokens).
3. **Forge** — quick technical approach; confirm invariant-safety if the change touches
   `project-schema`/`ffmpeg-graph`.
4. **Build** — dispatch the owning engineer(s): `pixel` (web), `core` (api), `reel` (render/graph).
   Use parallel agents when the work is independent.
5. **Sentinel** — run typecheck, lint, tests, `test:golden`, `test:perf`, e2e; return SHIP / BLOCK
   with evidence. If BLOCK → loop back to the owning engineer.
6. **Forge** — final code review (correctness, simplicity, invariant).
7. **Ward** — security pass if the change touches auth/upload/render input.

Report to the CEO: what shipped · how verified · what's left · any decision needed. Do **not**
deploy, publish, or spend — those are CEO gates.
