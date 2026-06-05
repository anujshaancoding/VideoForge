# Templates — Technical Architecture

> **Author:** Forge (Principal Engineer / Architect)
> **Status:** Design — no implementation. One doc, end-to-end-correct and invariant-safe.
> **Audience:** Atlas (orchestration) + Core / Pixel / Reel (build).
> **Scope:** Phase 0 / Free-tier. 5 starter templates. Chrome/Edge.

---

## 0. TL;DR (the answers Atlas asked for)

1. **Slot model — sidecar manifest, NOT inline fields. No breaking schema change.** A template is a real
   `Project` JSON document. The "which clips/overlays are replaceable" metadata lives **outside the
   document**, in a per-template **`TemplateManifest`** that addresses placeholders **by existing `id`**
   (`clipId` / `overlayId` / `captionTrackId`). Because `ProjectSchema` is `.strict()`
   (`schema.ts:436` and every nested `.strict()`), adding any `slot` field onto a `Clip` / `OverlayClip`
   would make `validateProject()` **reject the document** — so inline slot fields are off the table for
   Phase 0. The sidecar manifest keeps `validateProject()` green for the template doc *and* for the
   project the user creates from it, and leaves `buildExportCommand()` byte-for-byte unaffected.
   **One optional, backward-compatible field is set, not added:** `Project.templateId` (already in the
   schema at `types.ts:70` / `schema.ts:432`) is stamped on the derived project for provenance. No
   schema version bump.

2. **Where templates live — new `packages/templates` workspace package.** Typed, **validated-in-CI**
   template `Project` docs + their manifests, exported as data. Consumed by `apps/web` (gallery +
   apply) and optionally surfaced by `apps/api` (a read-only list endpoint that re-exports the package
   constant). **Tradeoff vs DB seeding:** the package wins for Phase 0 — templates are code-reviewed,
   golden-tested, type-checked, and ship atomically with the schema/graph they depend on; DB seeding
   adds a migration, a write path, and drift risk (a seeded template can fall behind a schema bump with
   no compiler to catch it) for zero MVP benefit. Revisit DB/S3-backed templates only when
   user-authored or remotely-updatable templates become a requirement (Phase 1+).

3. **Create-from-template flow — pure client clone → existing `POST /projects`.** Picking a template
   deep-clones the template doc, re-stamps identity (`id`, `ownerId`, `workspaceId`, `revision:1`,
   `createdAt`/`updatedAt`, fresh `collaborators`), sets `templateId`, and **regenerates every `id`**
   (clips, overlays, tracks, transitions, caption blocks, …) while **rewriting all cross-references**
   (`trackId`, `linkedClipId`, transition `fromClipId`/`toClipId`, denormalised `clip.trackId`) and the
   manifest's slot id pointers in lock-step. The result is an ordinary `Project` persisted through the
   **existing** `apiCreateProject()` path (the same one `NewProjectModal` uses), then opened in the
   editor. **Filling a slot is just an existing editor-store mutation** — `replaceClipAsset` (a thin new
   action) for media slots, `updateOverlay({text})` / `updateCaption({text})` for copy slots. **Empty
   slots at export:** a placeholder slot that the user never fills references a **phantom asset id with
   no S3 key**, and the render worker **hard-fails** on that (`worker.ts:193` throws
   `"no S3 key for asset … — cannot render"`). So the contract is: **unfilled media slots are pruned
   from the document before export** (placeholder clips/overlays are dropped, their transitions cleaned
   up). The result is always a valid graph that renders; empty copy (text) slots simply render their
   placeholder string or are pruned if blank.

4. **Invariant — holds by construction; no graph change.** A template *is* a `Project`; a project made
   from a template *is* a `Project`. Preview (`PreviewEngine`) and export (`buildExportCommand`) read
   the same document, so **export == preview frame-for-frame** by the existing M0 bet — there is nothing
   new on the render path. The only schema touch is *using* the already-present optional `templateId`;
   everything else is data + a clone helper + one store action. No `schemaVersion` bump.

5. **Build breakdown — Reel barely touches anything (that's the point).** **Pixel** owns the gallery,
   apply UX, slot-fill UX, the clone helper, the empty-slot prune, and the one new store action.
   **Core** owns the optional `GET /templates` list endpoint (trivial; re-exports the package) and a
   one-line allow for `templateId` provenance (already validated). **Reel** owns *verification only*: a
   golden-frame fixture per template proving Ken Burns / xfade / text / caption render correctly through
   the unchanged graph. **Template authoring** (the 5 `Project` docs + manifests) is **content work
   owned by Pixel with Iris** (design/copy), reviewed by Forge for invariant-safety and by Reel for
   render-parity.

---

## 1. Context & constraints (what the code actually allows)

Findings that constrain every decision below, each verified against source:

| # | Finding | Source | Consequence |
|---|---|---|---|
| C1 | `ProjectSchema` and **every** nested object schema are `.strict()` → unknown keys are rejected, not passed through. | `packages/project-schema/src/schema.ts` (header comment + `.strict()` on `ClipSchema`, `overlayBaseShape` subtypes, `ProjectSchema:436`) | **Inline `slot` fields on Clip/Overlay would fail `validateProject()`.** Slot metadata must be sidecar, OR require a (rejected) schema change. |
| C2 | `Clip.sourceAssetId` and `ImageOverlay.sourceAssetId` are **required `uuid`** (not optional/nullable). | `types.ts:171`, `schema.ts:108`, `schema.ts:235` | A media slot cannot be "empty" by nulling the asset id — the clip must reference *some* uuid, or not exist. Placeholder = a real-but-phantom asset id; "empty at export" = prune the clip. |
| C3 | The render worker **throws and fails the whole render** when a referenced asset has no S3 key. | `apps/render-worker/src/worker.ts:193-196` (`"no S3 key for asset … — cannot render"`) | An unfilled media slot pointing at a phantom asset **crashes export**. Unfilled media slots MUST be pruned pre-export. |
| C4 | `Project.templateId?: UUID \| null` already exists in types + schema + fixtures, currently `null`. | `types.ts:70`, `schema.ts:432`, `sampleProject.ts:314`, `index.ts:94` | Provenance is free — set it on the derived project; **no schema change.** |
| C5 | `buildExportCommand(project, settings)` is **pure** and reads only the `Project`. Captions, xfade, Ken Burns, drawtext-subset text, transform/PiP, color-grade are already supported/MVP-stubbed exactly as the preview renders them. | `packages/ffmpeg-graph/src/buildFilterComplex.ts` | Templates that use only MVP features render **with zero graph changes**. The invariant is inherited, not re-proven. |
| C6 | Project creation on the client is `createProject()` → `apiCreateProject({name, document})` → `POST /api/v1/projects`. `POST` currently **ignores the body's document** and seeds via `newProject()`. | `apps/web/src/lib/projectStore.ts:136`, `apps/web/src/lib/api.ts:230`, `apps/api/src/routes/projects.ts:168-194` | The create-from-template path needs the server to **persist a supplied document** (see §4, Core's one change) — OR the client persists the cloned doc via the existing **duplicate-then-PATCH** shape. We choose the smallest safe option below. |
| C7 | `editorStore` already exposes `updateOverlay`, `updateCaption`, and rich per-clip mutations, all funnelled through `commit()` (undoable, Immer-patched). There is **no** "replace a clip's asset" action yet. | `apps/web/src/store/editorStore.ts` (`updateOverlay:996`, `updateCaption:1056`; no `replaceClipAsset`) | Copy-slot fill reuses existing actions; media-slot fill needs **one** new tiny action. |
| C8 | Server enforces Free-tier caps on **every** create/save (`checkPlanLimits`). | `apps/api/src/routes/projects.ts:47,178,278` | Authored templates **must** be within Free caps (≤3 video / 2 audio / 1 voiceover / 2 overlay tracks, ≤10 min). Forge/Core gate this; it's also caught at create time. |

**Design rule that falls out of C1–C5:** *Do not touch `packages/project-schema/src/schema.ts` invariants
and do not touch `packages/ffmpeg-graph`.* Templates are a **data + client-orchestration** feature that
rides the existing spine. This is the cheapest possible way to honour the WYCIWYG invariant: by not
creating a second code path at all.

---

## 2. Template representation

### 2.1 A template *is* a `Project` (the invariant anchor)

A template is a fully-valid `Project` document — the same shape `sampleProject` has. It previews through
`PreviewEngine` and exports through `buildExportCommand` like any other project. **This is non-negotiable
and is the entire reason the invariant survives:** there is no "template renderer." A template is just a
nicely-arranged project with provenance metadata describing which parts are meant to be swapped.

A template doc is a normal project with these conventions:

- **`title`** = the template's default project name (e.g. `"Product Drop — 9:16"`); the user can rename.
- **Placeholder media** (`Clip.sourceAssetId`, `ImageOverlay.sourceAssetId`) points at **bundled
  placeholder assets** (CC0 stand-in footage/stills shipped with the template package and seeded into
  the dev/CI S3 double, mirroring `fixtures/manifest.json`). These are *real, renderable* assets so the
  template itself previews and exports — a slot that the user fills replaces this asset id; a slot the
  user ignores is pruned before export (§5.3).
- **Placeholder copy** (`TextOverlay.text`, `CaptionBlock.text`) holds default/sample strings
  (`"Your headline here"`).
- **`templateId`** on the *template document itself* is `null` (it is the template, not derived from one).

### 2.2 Slot model — the `TemplateManifest` sidecar

Slot metadata lives in a sidecar manifest, addressed by the placeholder element's **existing `id`**.
Shipped types (new, in `packages/templates`; **not** in `project-schema`):

```ts
// packages/templates/src/types.ts  (NEW PACKAGE — does not touch project-schema)

export type SlotKind = "image" | "video" | "text";

/** One user-replaceable region of a template, addressed by an existing element id. */
export interface TemplateSlot {
  /** Stable slot id, unique within the template (e.g. "hero-clip", "headline"). */
  id: string;
  kind: SlotKind;
  /** Human label shown in the slot-fill UI ("Hero clip", "Headline", "CTA line"). */
  label: string;

  /**
   * The element this slot maps to, by the Project document's OWN ids:
   *  - media slots (image|video) → a Clip.id (or ImageOverlay.id)
   *  - text slots               → a TextOverlay.id OR a CaptionBlock.id
   * Exactly one target is set. These ids are rewritten in lock-step when the
   * template is cloned into a new project (§4.2) so the manifest stays valid
   * against the derived document.
   */
  target:
    | { type: "clip"; clipId: string; trackId: string }
    | { type: "overlay"; overlayId: string }
    | { type: "captionBlock"; captionTrackId: string; blockId: string };

  /** Placeholder shown until filled. For media: the bundled placeholder assetId
   *  (mirrors the value already in the document) so the UI can preview it; for text:
   *  the default copy string (mirrors TextOverlay.text / CaptionBlock.text). */
  placeholder: { kind: "asset"; assetId: string } | { kind: "text"; text: string };

  /** When true, an unfilled slot is PRUNED before export (§5.3). When false, the
   *  placeholder asset/text is kept (e.g. a branded outro the user may keep as-is). */
  optional: boolean;
}

/** Card metadata for the gallery + the slot list. The document is co-located. */
export interface TemplateManifest {
  /** Stable template id (UUID v4) — also stamped onto Project.templateId on apply. */
  id: string;
  name: string;
  description: string;
  /** Derived from the document's canvas — duplicated for cheap gallery rendering. */
  durationMs: number;
  aspectRatio: string;          // "9:16" | "16:9" | "1:1" | ...
  /** Bundled thumbnail/poster asset (package-relative path or seeded asset url). */
  thumbnail: string;
  /** Feature tags for the gallery filter ("ken-burns", "captions", "text", "xfade"). */
  tags: string[];
  slots: TemplateSlot[];
}

/** A template = its manifest + its valid Project document, co-located + co-versioned. */
export interface Template {
  manifest: TemplateManifest;
  document: Project;   // MUST pass validateProject() — asserted in CI (§3.2)
}
```

### 2.3 Why sidecar, not inline (the load-bearing decision)

| Option | Breaks `validateProject()`? | Touches export graph? | Schema bump? | Verdict |
|---|---|---|---|---|
| **A. Inline `slot` field on Clip/Overlay** | **YES** — `.strict()` rejects unknown keys (C1); every normal project would also need the field tolerated, forcing a schema edit + `additionalProperties` relaxation across all nested shapes. | No (graph ignores it) | **Yes** (relax strictness or add fields) | **Rejected.** Violates "don't break validate for normal projects"; mutates the locked invariant surface. |
| **B. Sidecar `TemplateManifest`, addresses by id** | **No** — manifest is separate data; the document is a clean `Project`. | **No** — `buildExportCommand` never sees the manifest. | **No** | **Chosen.** Smallest blast radius; invariant untouched. |

Inline metadata also *leaks template-ness into every saved project* (the derived project would carry dead
slot fields), and would require teaching `buildExportCommand`, the autosave PATCH validator, and
`checkPlanLimits` to ignore them. The sidecar keeps the document pristine: **once a project is created
from a template, it is indistinguishable from any other project** except for the provenance `templateId`.

### 2.4 Where the manifest lives at runtime

The manifest travels with the template in the package (design/author time) and is **consumed entirely on
the client during the create-from-template + slot-fill flow**. It is **not persisted into the project
document** and **not stored server-side per project** in Phase 0. Rationale: once slots are filled (or
pruned at export), the document is self-describing; re-opening a derived project to "re-edit slots later"
is a Phase-1 nicety (would persist `templateId` + cache the manifest by id — both already possible since
`templateId` survives on the doc). This keeps the server contract **completely unchanged** for persistence.

---

## 3. Where templates live — `packages/templates`

### 3.1 Package shape

```
packages/templates/
  package.json            # @videoforge/templates; deps: @videoforge/project-schema (workspace:*)
  tsconfig.json           # extends config; project reference to project-schema
  src/
    types.ts              # TemplateSlot / TemplateManifest / Template (§2.2)
    index.ts              # export const TEMPLATES: Template[]; getTemplate(id); listManifests()
    templates/
      product-drop.ts     # one Template per file: { manifest, document }
      quote-card.ts
      ken-burns-story.ts
      captioned-talking-head.ts
      lower-third-promo.ts
    placeholders.ts       # bundled placeholder/thumbnail asset ids + seed manifest entries
    __tests__/
      templates.valid.test.ts   # every document passes validateProject() + checkPlanLimits parity
      slots.integrity.test.ts    # every slot.target id EXISTS in its document; ids unique
```

Public API (data, plus two pure helpers):

```ts
export const TEMPLATES: readonly Template[];
export function listManifests(): TemplateManifest[];      // gallery
export function getTemplate(id: string): Template | undefined;
```

Consumed by:
- **`apps/web`** — imports `@videoforge/templates` directly (it's just data; no network needed for the
  gallery). The gallery renders `listManifests()`; apply uses `getTemplate(id)`.
- **`apps/api`** *(optional, recommended)* — a read-only `GET /api/v1/templates` that returns
  `listManifests()` (so a future native/mobile client or server-rendered surface can enumerate them
  without bundling the package). **No DB, no write path.**

### 3.2 Validation in CI (the safety net that replaces DB constraints)

Because templates are typed data, CI is the enforcement:

- **`templates.valid.test.ts`** runs `validateProject(t.document)` for every template → a malformed
  template **fails the build**, exactly like the §18 schema gate for normal projects. It also runs the
  same plan-limit logic shape as `checkPlanLimits` (or imports it) so an over-cap template can't ship
  (C8).
- **`slots.integrity.test.ts`** asserts every `slot.target` id resolves to a real element in
  `t.document`, slot ids are unique, and each media slot's placeholder `assetId` actually appears on its
  target element. This catches "manifest drifted from document" at compile/test time.
- **Type-level coupling:** `Template.document: Project` means a schema change that alters `Project`
  forces the template files to type-check against the new shape — **the compiler catches drift**, which a
  DB seed never would.

### 3.3 Tradeoff vs seeding templates in the DB

| Dimension | `packages/templates` (chosen) | DB-seeded templates |
|---|---|---|
| Drift safety | **Compiler + CI golden tests**; schema change breaks the build loudly. | Silent drift; a seeded JSONB row can violate a new schema with nothing to catch it until a user opens it. |
| Review | Normal code review / PR diff; golden-frame parity in CI. | Migration review; harder to diff JSONB. |
| Ship atomicity | Ships **with** the exact schema + graph it targets. | Separate migration step; ordering hazards. |
| Infra cost | Zero (it's a bundled constant). | New migration + write path + (eventually) admin tooling. |
| User-authored templates | Not supported (fine for Phase 0 — there are exactly 5, authored by us). | Natural fit — **the reason to migrate later.** |
| API exposure | Re-export via a trivial read-only endpoint if needed. | Already a row; queryable. |

**Recommendation:** ship `packages/templates` for Phase 0. Move to DB/S3-backed templates **only** when
(a) users author their own templates, or (b) we need to update templates without a deploy. Until then the
package is strictly safer and cheaper.

---

## 4. "Create project from template" flow

### 4.1 End-to-end sequence

```
Dashboard "Start from template" / NewProjectModal "Templates" tab
   │  user picks a template card (manifest)
   ▼
getTemplate(id)  ──►  cloneTemplateToProject(template, { title? })   [PURE, client]
   │   • deep-clone document
   │   • new Project.id, ownerId(self), workspaceId(self), revision:1,
   │     createdAt/updatedAt(now), collaborators:[{self, admin}], templateId:id
   │   • regenerate EVERY element id; rewrite ALL cross-refs + manifest slot targets
   ▼
persist the cloned document   (existing create path, see §4.3)
   ▼
navigate(/editor/:newId)  ──►  editorStore.loadProject(clonedDoc)
   ▼
Slot-fill UX (right panel "Template" section, driven by the rewritten manifest)
   │   • media slot  → replaceClipAsset(clipId, newAssetId)        [NEW tiny action]
   │   • text slot   → updateOverlay({text}) / updateCaption({text})  [EXISTING]
   ▼
Autosave (existing useAutosave → PATCH /projects/:id) persists fills as normal edits
   ▼
Export (existing ExportModal) — BUT prune unfilled optional slots first (§5.3)
```

### 4.2 The clone helper (the one genuinely new piece of logic)

`cloneTemplateToProject(template, opts)` lives in `apps/web` (e.g. `src/lib/templates.ts`) — it's
client orchestration, not schema. It must be **deterministic in structure, fresh in identity**:

1. **Deep-clone** `template.document` (structuredClone) so the package constant is never mutated.
2. **Re-stamp project identity:** `id = uuidv4()`, `ownerId = self`, `workspaceId = self`,
   `revision = 1`, `createdAt = updatedAt = now`, `collaborators = [{ userId: self, role:"admin" }]`,
   `isPublic = false`, **`templateId = template.manifest.id`** (provenance; C4).
3. **Regenerate all element ids** and build an **old→new id map**:
   tracks, clips, overlay clips, caption tracks, caption blocks, transitions, markers, effects, keyframes
   (keyframe ids are optional but regenerate when present).
4. **Rewrite every cross-reference** through the id map — this is the part that must not be missed, or the
   document becomes internally inconsistent (dangling transition refs, broken A/V links):
   - `Clip.trackId` (denormalised owning track — `types.ts:173`)
   - `Clip.linkedClipId` (A/V link group)
   - `OverlayClip.trackId`, `CaptionBlock`-owning `CaptionTrack` ids
   - `Transition.trackId / fromClipId / toClipId`
   - `Marker` ids (no cross-ref, but regenerate for uniqueness)
5. **Rewrite the manifest's slot targets** through the same id map (so `slot.target.clipId` etc. point at
   the *new* ids). The rewritten manifest is held in editor UI state for the slot-fill panel.
6. **`validateProject(cloned)`** before persist (belt-and-suspenders; the same validator the server runs).

> **Why regenerate ids?** Two projects created from one template must not share clip/transition ids — id
> collisions would corrupt undo/redo patch replay and any future cross-project operation, and the server
> stores by `Project.id` so the *project* id must be fresh regardless. Regenerating *all* ids is the
> clean, uniform rule.

### 4.3 Persisting the cloned document — the smallest safe server touch (Core)

Today `POST /api/v1/projects` **ignores the request body's document** and always seeds a blank project via
`newProject()` (`projects.ts:176`). Two ways to persist a *supplied* template-derived document; pick **A**:

- **Option A (recommended): teach `POST /projects` to accept an optional `document`.**
  If `request.body.document` is present, `validateProject()` it, run `checkPlanLimits()`, force
  server-owned fields (`workspaceId = user`, `revision = 1`, fresh `createdAt/updatedAt`), and insert it;
  otherwise fall back to the existing `newProject(coerced)` behaviour. This is a **small, additive,
  backward-compatible** change to one route — existing callers (NewProjectModal) are unaffected because
  they send no `document`. It mirrors exactly what PATCH already does (validate inner document, enforce
  caps, stamp revision — `projects.ts:251,278,288`).
  *Client:* `apiCreateProject({ name, document: clonedDoc })` (the function already takes `document` —
  `api.ts:230`).

- **Option B (no server change, but worse):** create a blank project (current `POST`), then immediately
  `PATCH` it with the cloned document. Costs an extra round-trip and briefly persists a throwaway blank;
  also the cloned doc's `id` must be the server-created id, complicating the id-rewrite. **Use only if a
  server change is disallowed this cycle.**

Option A keeps the create-from-template path on the **same `POST /projects` endpoint** the task calls for,
with the cloned document flowing through the **same validator + plan-limit gate** as every other write.

### 4.4 Filling a slot → schema mutations via existing store actions

Slot fill is **ordinary editing** — no special "template mode" in the document:

| Slot kind | User action | Store action | Schema effect |
|---|---|---|---|
| **video / image (media)** | pick/upload an asset → drag onto slot or "Replace" | **`replaceClipAsset(clipId, trackId, newAssetId)`** *(new, ~10 lines)*; for image overlays, `updateOverlay({ sourceAssetId })` *(existing)* | sets `Clip.sourceAssetId` (and updates `trimIn/trimOut` to the new asset's duration if shorter; keep `0..min(span, sourceDur)`). Keeps placement/effects/Ken Burns intact. |
| **text (overlay)** | edit headline copy | **`updateOverlay({ text })`** *(existing — `editorStore.ts:996`)* | sets `TextOverlay.text`. |
| **text (caption)** | edit caption line | **`updateCaption({ text })`** *(existing — `editorStore.ts:1056`)* | sets `CaptionBlock.text`. |

`replaceClipAsset` is the **only** new store action. It funnels through `commit()` like every other
mutation, so it's undoable, Immer-patched, and autosaved by the existing `useAutosave`. The slot-fill UI
calls these actions by the (rewritten) ids in the manifest — **no new persistence, no new validation, no
graph awareness.**

```ts
// editorStore — new action (mirrors existing setClip* shape exactly)
replaceClipAsset: (clipId, trackId, newAssetId, newSourceDurationMs?) =>
  commit((project) => {
    const found = findClipInTrack(project, clipId, trackId);
    if (!found) return;
    found.clip.sourceAssetId = newAssetId;
    // Re-base trims onto the new source so a shorter asset can't over-trim.
    if (newSourceDurationMs && newSourceDurationMs > 0) {
      found.clip.trimIn = 0;
      found.clip.trimOut = Math.min(found.clip.trimOut, newSourceDurationMs);
    }
  });
```

---

## 5. Empty slots & export — keeping the graph valid

### 5.1 The hazard (verified)

A media slot the user never fills still references a **bundled placeholder asset** *unless we prune it*.
At export, the render worker resolves each `asset:<id>` token to an S3 key; if a clip references an id
with **no original and no proxy key**, the worker **throws and the render fails** (`worker.ts:193-196`).
The bundled placeholder assets ARE seeded in dev/CI, so they'd render — but in production a placeholder a
user didn't intend to keep would either (a) render literal stand-in footage into their video, or (b) if
not seeded in prod, crash the export. **Neither is acceptable.** Hence the prune rule.

### 5.2 The rule

- **Filled slots:** the clip/overlay now references a real user asset — renders normally. Nothing to do.
- **Unfilled `optional:true` slots:** **pruned from the document before export** (default for hero media
  and editable copy).
- **Unfilled `optional:false` slots:** **kept** — these are intentional template furniture (e.g. a
  branded outro card / lower-third) whose placeholder asset is shipped + prod-seeded and meant to remain.
  Author responsibility: only mark a slot `optional:false` if its placeholder asset is a permanent,
  prod-available branded asset.

### 5.3 Where the prune happens

A **pure helper** `pruneUnfilledSlots(project, manifest, filledSlotIds): Project` in `apps/web`, applied
to a **clone** of the document at export time (the saved project keeps its slots/placeholders so the user
can come back and fill them):

- For each unfilled `optional` media slot → remove the target `Clip` from its track (and any
  `Transition` referencing it, mirroring `editorStore.deleteSelected`'s transition cleanup at
  `editorStore.ts:648`), or remove the target `ImageOverlay` from its overlay track.
- For each unfilled `optional` text slot → if the copy is still the placeholder string (or empty), remove
  the `TextOverlay` / `CaptionBlock`; a non-empty edited string counts as "filled."
- `validateProject(pruned)` and hand the pruned doc to the existing export path.

**Result:** the document handed to `buildExportCommand` is always valid and references only real,
resolvable assets → the graph is always valid and the invariant holds (it's still just a `Project`).

> Detection of "filled": the slot-fill UI tracks which slot ids the user touched (a derived
> `filledSlotIds: Set<string>`); for media slots, "filled" ⇔ `clip.sourceAssetId !== placeholder.assetId`
> is also a reliable structural check that survives reloads (since the manifest's placeholder asset id is
> known). Prefer the structural check so prune is correct even without UI session state.

---

## 6. Invariant guarantee

**Claim:** A project created from a template exports frame-for-frame identical to its preview.

**Argument (by construction, not by new testing):**

1. A template document and a template-derived project are **both ordinary `Project` documents** that pass
   `validateProject()` (asserted in CI for templates — §3.2; asserted on every server write for derived
   projects — `projects.ts:251`).
2. **Preview** (`apps/web/PreviewEngine` + `CanvasStage` + `AudioEngine`) and **export**
   (`buildExportCommand`) already consume the same `Project` and are the two renderers of one source of
   truth (the M0 bet, `MVP_Scope §1`). Templates introduce **no new field the graph must interpret** and
   **no new render path** — `buildFilterComplex.ts` is untouched.
3. Slot fill mutates only `sourceAssetId` / `text` via existing (or one mirror-pattern) store actions —
   the same fields normal editing already changes; covered by existing parity behaviour.
4. Empty-slot prune produces a **strict subset** of the document (fewer clips/overlays/transitions),
   re-validated before export — still a valid `Project`, still rendered by the same graph.

Therefore the WYCIWYG invariant is **inherited**, and no golden output changes for existing fixtures.

**Schema change needed?** **No breaking change.** The only schema field used is the **already-present,
already-optional** `Project.templateId` (C4). `schemaVersion` is **not** bumped; no migration; existing
documents and goldens are byte-identical. The slot model is **entirely additive sidecar data** in a new
package, invisible to `project-schema` and `ffmpeg-graph`.

**New verification added (not a change, an addition):** golden-frame fixtures for the templates (Reel,
§7) so we *prove* — not just argue — that each shipped template's features render correctly. These extend
the existing golden matrix; they do not alter any existing golden.

---

## 7. Build breakdown (per persona)

### Reel — *verification only* (highest-risk surface, smallest change)
- **No changes to `packages/ffmpeg-graph` and no changes to `apps/render-worker`.** State this explicitly
  in the hand-off: templates ride the existing graph.
- Add **one golden-frame fixture per template** (or per distinct feature combo) under `fixtures/projects`
  + committed goldens, asserting the template document exports correctly: **Ken Burns** (`zoompan`),
  **crossfade** (`xfade`), **drawtext-subset text overlay**, and **burned-in captions** (`subtitles`)
  each render to spec (SSIM/PSNR per `MVP_Scope §8`). These reuse `buildExportCommand` unchanged.
- Run `pnpm test:golden` + `pnpm test:perf`; **explicitly confirm export parity holds** (no existing
  golden moved). If a template uses a feature the MVP graph only stubs (none should — authors are
  constrained to MVP features), Reel flags it back to Forge/authoring *before* the template ships.
- Confirm the bundled **placeholder assets are seeded** into the dev/CI S3 double (mirrors
  `fixtures/manifest.json`) so template docs render in CI, and advise Core which placeholder assets must
  be **prod-seeded** (only those behind `optional:false` slots).

### Core — backend (small, additive, backward-compatible)
- **`POST /api/v1/projects` accepts an optional `document`** (§4.3 Option A): when present,
  `validateProject` → `checkPlanLimits` → force server-owned fields → insert; else current
  `newProject()` behaviour. Backward-compatible (NewProjectModal sends no `document`). Add a contract
  test mirroring the existing `projects.contract.test.ts` (valid template doc creates; over-cap doc →
  422; malformed → 422; `templateId` round-trips).
- **Optional `GET /api/v1/templates`** → returns `listManifests()` from `@videoforge/templates`
  (read-only; no DB). Gate behind the same `app.authenticate` preHandler as projects. Skip if the web
  gallery imports the package directly and no other client needs it — recommend implementing it anyway as
  a 6-line route for forward-compat.
- **No migration, no new table, billing stays stubbed.** Confirm `templateId` persists in the JSONB
  document (it already validates and round-trips; PATCH preserves it).

### Pixel — frontend (owns the bulk of the feature)
- **`packages/templates` authoring scaffold** + the 5 template `Project` docs and manifests (content work
  with Iris — see below), including the `__tests__` validity/integrity suites (§3.2).
- **Gallery UI:** a "Templates" surface (a tab in `NewProjectModal` and/or a row on `Dashboard`) that
  renders `listManifests()` as cards (thumbnail, name, description, aspect glyph, duration, feature tags).
  Brand rules: amber reserved for the Export CTA + brand; selection = sky-blue; **no Canva purple**.
- **`cloneTemplateToProject()`** (§4.2) in `apps/web/src/lib/templates.ts`: deep-clone, re-stamp identity,
  regenerate **all** ids, rewrite **all** cross-refs **and** manifest slot targets, set `templateId`,
  `validateProject` before persist.
- **Apply flow:** `getTemplate` → clone → `apiCreateProject({ name, document })` (Option A) →
  `navigate('/editor/:id')` → `editorStore.loadProject`. Reuse the existing create error/fallback handling
  from `NewProjectModal`/`projectStore`.
- **Slot-fill UX:** a "Template" section in the right panel (Inspector) driven by the rewritten manifest —
  media slots offer pick/upload/replace, text slots offer inline copy edit. Wire to the **new
  `replaceClipAsset`** action and the **existing** `updateOverlay`/`updateCaption`. Optional: a
  guided "fill the highlighted slots" checklist to drive TTFE.
- **Empty-slot prune at export:** `pruneUnfilledSlots()` (§5.3), applied to a clone of the document inside
  the export trigger (`ExportModal` path) before handing off; `validateProject` the pruned doc.
- Run `pnpm typecheck`, `pnpm lint`, web tests; add unit tests for `cloneTemplateToProject` (id-rewrite
  completeness: no dangling refs; manifest targets resolve) and `pruneUnfilledSlots`
  (removes optional placeholders + their transitions; keeps `optional:false`; output validates).

### Template authoring (the 5 `Project` documents) — Pixel + Iris, gated by Forge & Reel
- **Owner:** **Pixel authors the documents/manifests; Iris owns the design + default copy + placeholder
  selection.** Forge reviews for invariant-safety (valid `Project`, within Free caps, MVP-only features);
  Reel reviews for render-parity (golden fixtures green).
- **Constraints every template must obey:** valid `Project` (CI), ≤ Free-tier caps (C8: ≤3 video/2
  audio/1 voiceover/2 overlay tracks, ≤10 min), **MVP features only** (Ken Burns, xfade crossfade,
  per-clip color-grade, transform/PiP, per-clip fades, drawtext-subset text, manual/imported captions —
  `MVP_Scope §3`), integer-ms time, percent geometry, UUID v4 ids, track-index z-order.
- **Suggested starter set** (each exercises a parity surface so the goldens are meaningful):
  1. **Product Drop (9:16)** — 2 clips + crossfade + headline text + CTA caption *(xfade + text + caption)*.
  2. **Quote Card (1:1)** — single still + Ken Burns + centered quote text *(zoompan + text)*.
  3. **Ken Burns Story (9:16)** — 3 stills, Ken Burns each, crossfades between *(zoompan + xfade chain)*.
  4. **Captioned Talking-Head (9:16)** — 1 video slot + burned-in captions track *(caption parity)*.
  5. **Lower-Third Promo (16:9)** — 1 video slot + text lower-third overlay + outro card
     (`optional:false`) *(text overlay + kept-placeholder behaviour)*.

---

## 8. Risks & mitigations

| Risk | Mitigation |
|---|---|
| **Inline-slot temptation** reopens the schema and breaks `.strict()` for normal projects. | Hard rule (§2.3): slots are sidecar. Code review rejects any `slot` field on `project-schema` types. |
| **Manifest drifts from document** (slot target ids stop resolving). | `slots.integrity.test.ts` (§3.2) fails CI; `cloneTemplateToProject` rewrites targets in lock-step (§4.2). |
| **Id-rewrite misses a cross-ref** → dangling transition / broken A/V link in derived projects. | Unit test asserting zero dangling refs after clone; enumerate the full cross-ref list (§4.2 step 4); `validateProject` post-clone. |
| **Empty media slot crashes export** (`worker.ts:193`). | `pruneUnfilledSlots` before export (§5.3); structural "filled" check; CI test that an unfilled-template export produces a valid graph. |
| **Over-cap template** rejected at create time → confusing UX. | `checkPlanLimits`-parity test in `packages/templates` CI (§3.2) catches it before ship, not at runtime. |
| **`POST /projects` change regresses blank-create.** | Change is additive (document optional); existing contract test for blank create stays green; new test covers the document path. |
| **Placeholder asset not seeded in prod** behind an `optional:false` slot → export fails. | Authoring rule: `optional:false` only for permanent prod-seeded branded assets; Reel confirms the seed list with Core. |

---

## 9. What explicitly does NOT change

- `packages/project-schema/src/schema.ts` and `types.ts` invariants — **untouched** (only the existing
  optional `templateId` is *used*).
- `packages/ffmpeg-graph` — **untouched.** No new graph path; the invariant is inherited.
- `apps/render-worker` — **untouched.** (Prune happens client-side so the worker never sees a phantom
  asset.)
- `schemaVersion` — **not bumped**; no migration; existing projects + goldens byte-identical.
- Autosave / PATCH / persistence contract — **unchanged** (slot fills are ordinary edits; `POST` gains an
  optional, backward-compatible `document`).
