---
name: web-test-suite-rot
description: apps/web vitest suite has pre-existing failures from test rot (not product bugs); CI is red
metadata:
  type: project
---

As of 2026-06-18, the `apps/web` vitest suite has pre-existing failing tests that are **stale tests, not product bugs** — the live app works (verified in-browser). All other packages (project-schema, templates, ffmpeg-graph, script-studio, render-worker) pass green. `pnpm -r test` therefore exits non-zero (`ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL` on @videoforge/web).

Fixed this session (12 → 7): TopBar.test (4) lacked a Router wrapper though TopBar uses `useNavigate()` → wrapped renders in MemoryRouter; textOverlayPreview.test (1) asserted the old `Inter, sans-serif` font string but the engine emits `Inter, system-ui, sans-serif`.

**Remaining 7 (need product/QA owner to reconcile intent, not blind test edits):**
- ExportModal.test (5): expects a `watermark-disclosure` element that was deliberately removed (CEO 2026-06-14 watermark-free decision) and a submit button named exactly `/^export$/` (semantics changed).
- CanvasStage.toolbar.test (2): expects `role="tooltip"`; the toolbar now uses native `title=` attributes.

**Why:** product evolved; tests weren't updated. **How to apply:** don't trust a green-looking `pnpm test` exit code from background runners (one misreported exit 0 here); run `pnpm --filter @videoforge/web test` directly. See [[videoforge-dev-startup]] for running the app to verify a test reflects reality.
