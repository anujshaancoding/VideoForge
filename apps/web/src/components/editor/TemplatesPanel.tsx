import { useEffect, useMemo, useState } from "react";
import { useEditorStore } from "../../store/editorStore.js";
import { useTemplateStore } from "../../store/templateStore.js";
import { cloneTemplateToProject, generateTemplateThumbnail } from "../../lib/templates.js";
import { getTemplate } from "@videoforge/templates";
import { cx } from "../ui/cx.js";
import { Search, X, Sparkles } from "lucide-react";
import type { Project } from "@videoforge/project-schema";
import { v4 as uuidv4 } from "uuid";

// Client-side enriched template for the Canva-style browser (sidebar left rail).
// System ones delegate to @videoforge/templates for real slot manifests + clone.
// Synthetic ones use lightweight snapshots + client placeholderLabels.
export interface BrowseTemplate {
  id: string;
  name: string;
  description: string;
  thumbnailUrl: string;
  previewGifUrl?: string; // swapped on hover (use <img> for auto-loop)
  category: TemplateCategory;
  tags: string[];
  duration: number; // seconds
  aspectRatio: "9:16" | "16:9" | "1:1" | "4:5";
  isPro: boolean;
  isNew: boolean;
  usageCount: number;
  // For real package templates
  manifestId?: string;
  // For synthetic / blank
  synthetic?: boolean;
  /** Optional demo video to use for this template's main video slot(s) so the template has actual playable video content out of the box. */
  demoVideo?: string; // e.g. "summer-sale-demo.mp4"
}

type TemplateCategory =
  | "all"
  | "promo"
  | "social"
  | "product"
  | "announcement"
  | "tutorial"
  | "event"
  | "blank";

// 10 seed templates per spec (5 real from package + 5 synthetic + Blank as special).
// Thumbnails use stable picsum (fast, 9:16-ish 200x356). Real GIFs would be used in prod.
const SEED_TEMPLATES: BrowseTemplate[] = [
  // Real package ones (will use clone + manifest for perfect slots + labels)
  {
    id: "t-simple-promo",
    manifestId: "template:simple-promo",
    name: "Summer Sale Promo",
    description: "50% OFF text + upbeat music + 3 product slots",
    thumbnailUrl: "https://picsum.photos/id/1015/400/711",
    previewGifUrl: "https://picsum.photos/id/1016/400/711",
    category: "promo",
    tags: ["sale", "promo", "summer", "product"],
    duration: 8,
    aspectRatio: "9:16",
    isPro: false,
    isNew: false,
    usageCount: 1240,
    demoVideo: "summer-sale-demo.mp4",
  },
  {
    id: "t-happy-bday",
    manifestId: "template:happy-birthday", // may not exact but package has it; fallback handled
    name: "Event Announcement",
    description: "Date + venue over background loop with music",
    thumbnailUrl: "https://picsum.photos/id/160/400/711",
    previewGifUrl: "https://picsum.photos/id/201/400/711",
    category: "event",
    tags: ["event", "party", "announce"],
    duration: 6,
    aspectRatio: "9:16",
    isPro: false,
    isNew: true,
    usageCount: 890,
  },
  {
    id: "t-product-launch",
    // synthetic — no package manifestId
    name: "Product Launch",
    description: "Dramatic reveal with logo slot and motion text",
    thumbnailUrl: "https://picsum.photos/id/29/400/711",
    previewGifUrl: "https://picsum.photos/id/30/400/711",
    category: "product",
    tags: ["launch", "product", "reveal"],
    duration: 10,
    aspectRatio: "9:16",
    isPro: false,
    isNew: false,
    usageCount: 675,
    synthetic: true,
    demoVideo: "product-launch-demo.mp4",
  },
  {
    id: "t-tutorial",
    // synthetic (no package manifest)
    name: "Tutorial Intro",
    description: "Title card + progress text + voiceover slot",
    thumbnailUrl: "https://picsum.photos/id/180/200/356",
    previewGifUrl: "https://picsum.photos/id/251/200/356",
    category: "tutorial",
    tags: ["tutorial", "howto", "education"],
    duration: 12,
    aspectRatio: "9:16",
    isPro: false,
    isNew: false,
    usageCount: 512,
    synthetic: true,
  },
  {
    id: "t-testimonial",
    // synthetic (no package manifest)
    name: "Testimonial",
    description: "Quote overlay + avatar image slot + subtle music",
    thumbnailUrl: "https://picsum.photos/id/1005/200/356",
    previewGifUrl: "https://picsum.photos/id/1009/200/356",
    category: "social",
    tags: ["testimonial", "quote", "social"],
    duration: 8,
    aspectRatio: "9:16",
    isPro: false,
    isNew: true,
    usageCount: 430,
    synthetic: true,
  },
  {
    id: "t-brand-story",
    // synthetic (no package manifest)
    name: "Brand Story",
    description: "Logo + tagline + mission text scenes",
    thumbnailUrl: "https://picsum.photos/id/133/200/356",
    previewGifUrl: "https://picsum.photos/id/134/200/356",
    category: "announcement",
    tags: ["brand", "story", "mission"],
    duration: 15,
    aspectRatio: "9:16",
    isPro: true,
    isNew: false,
    usageCount: 980,
    synthetic: true,
  },
  {
    id: "t-flash-sale",
    // synthetic (no package manifest)
    name: "Flash Sale Countdown",
    description: "Animated numbers + strong CTA text + music hit",
    thumbnailUrl: "https://picsum.photos/id/201/200/356",
    previewGifUrl: "https://picsum.photos/id/160/200/356",
    category: "promo",
    tags: ["sale", "countdown", "urgent"],
    duration: 6,
    aspectRatio: "9:16",
    isPro: false,
    isNew: false,
    usageCount: 1560,
    synthetic: true,
  },
  {
    id: "t-ig-reel",
    // synthetic (no package manifest)
    name: "Instagram Reel",
    description: "Trending quick cuts + caption slots + trending audio",
    thumbnailUrl: "https://picsum.photos/id/251/200/356",
    previewGifUrl: "https://picsum.photos/id/29/200/356",
    category: "social",
    tags: ["reel", "instagram", "trending"],
    duration: 7,
    aspectRatio: "9:16",
    isPro: false,
    isNew: true,
    usageCount: 2100,
    synthetic: true,
    demoVideo: "ig-reel-demo.mp4",
  },
  {
    id: "t-new-arrival",
    // synthetic (no package manifest)
    name: "New Arrival",
    description: "Product close-ups + 'New' text reveal + clean grade",
    thumbnailUrl: "https://picsum.photos/id/30/200/356",
    previewGifUrl: "https://picsum.photos/id/1015/200/356",
    category: "product",
    tags: ["new", "arrival", "product"],
    duration: 9,
    aspectRatio: "9:16",
    isPro: false,
    isNew: false,
    usageCount: 740,
    synthetic: true,
  },
  // Blank is always special (first card, no confirm, fresh project)
  {
    id: "blank",
    name: "Blank",
    description: "Start from a clean slate with your current aspect ratio",
    thumbnailUrl: "", // special rendering
    category: "blank",
    tags: [],
    duration: 0,
    aspectRatio: "9:16",
    isPro: false,
    isNew: false,
    usageCount: 99999,
    synthetic: true,
  },
];

const CATEGORIES: { id: TemplateCategory; label: string }[] = [
  { id: "all", label: "All" },
  { id: "promo", label: "Promo" },
  { id: "social", label: "Social" },
  { id: "product", label: "Product" },
  { id: "announcement", label: "Announce" },
  { id: "tutorial", label: "Tutorial" },
  { id: "event", label: "Event" },
  { id: "blank", label: "Blank" },
];

function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export default function TemplatesPanel() {
  const project = useEditorStore((s) => s.project);
  const loadProject = useEditorStore((s) => s.loadProject);
  const clearPlaceholders = useEditorStore((s) => s.clearPlaceholders);
  const setPlaceholderLabel = useEditorStore((s) => s.setPlaceholderLabel);
  const setManifest = useTemplateStore((s) => s.setManifestForProject);

  const [search, setSearch] = useState("");
  const [activeCat, setActiveCat] = useState<TemplateCategory>("all");
  const [showAll, setShowAll] = useState(false);
  const [confirmTemplate, setConfirmTemplate] = useState<BrowseTemplate | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [userTemplates, setUserTemplates] = useState<BrowseTemplate[]>(() => {
    try {
      const raw = localStorage.getItem("vf_user_templates");
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  const debouncedSearch = useDebounced(search, 280);

  // Persist user templates
  useEffect(() => {
    try {
      localStorage.setItem("vf_user_templates", JSON.stringify(userTemplates));
    } catch {}
  }, [userTemplates]);

  // Filter + search
  const filtered = useMemo(() => {
    let list = [...SEED_TEMPLATES, ...userTemplates];

    if (debouncedSearch.trim()) {
      const q = debouncedSearch.toLowerCase();
      list = list.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.description.toLowerCase().includes(q) ||
          t.tags.some((tag) => tag.toLowerCase().includes(q)),
      );
    }

    if (activeCat !== "all") {
      list = list.filter((t) => t.category === activeCat);
    }

    // Blank always first when not searching/filtering strictly
    const blank = list.find((t) => t.id === "blank");
    const rest = list.filter((t) => t.id !== "blank");
    if (blank && !debouncedSearch && activeCat === "all") {
      return [blank, ...rest];
    }
    return list;
  }, [debouncedSearch, activeCat, userTemplates]);

  const hasContent = useMemo(() => {
    return project.tracks.some(
      (t) =>
        (t.type === "video" || t.type === "audio" || t.type === "voiceover") &&
        ((t as any).clips?.length ?? 0) > 0,
    );
  }, [project]);

  const showSections = !debouncedSearch && activeCat === "all" && !showAll;

  const featured = filtered.filter((t) => ["promo", "product", "event"].includes(t.category)).slice(0, 4);
  const popular = [...filtered].sort((a, b) => b.usageCount - a.usageCount).slice(0, 4);
  const news = filtered.filter((t) => t.isNew).slice(0, 4);
  const yours = userTemplates;

  const gridFor = (items: BrowseTemplate[]) => (
    <div className="grid grid-cols-2 gap-2">
      {items.map((tpl) => (
        <TemplateCard
          key={tpl.id}
          tpl={tpl}
          onUse={() => handleUse(tpl)}
          onHoverPrefetch={() => {/* could prefetch real gif here */}}
        />
      ))}
    </div>
  );

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  }

  function handleUse(tpl: BrowseTemplate) {
    if (tpl.id === "blank") {
      applyBlank();
      return;
    }
    if (!hasContent) {
      applyNow(tpl);
    } else {
      setConfirmTemplate(tpl);
    }
  }

  function applyBlank() {
    // Keep current canvas AR + create a minimal clean project (no clips).
    const current = useEditorStore.getState().project;
    const now = new Date().toISOString();
    const blank: Project = {
      ...current,
      id: current.id,
      title: "Untitled",
      tracks: current.tracks.map((t: any) => ({ ...t, clips: t.clips ? [] : t.clips })),
      captionTracks: [],
      markers: [],
      transitions: [],
      templateId: null,
      createdAt: now,
      updatedAt: now,
    } as Project;
    loadProject(blank);
    clearPlaceholders();
    (useEditorStore.getState() as any).suppressSaveErrorsFor?.(5 * 60 * 1000);

    // Ensure we start at time 0 for a blank project
    setTimeout(() => {
      useEditorStore.getState().setPlayhead(0);
    }, 0);

    showToast("Blank project ready — start adding media");
    // Optionally switch to media
    // (Editor effect will handle if we set a flag)
  }

  function applyNow(tpl: BrowseTemplate) {
    try {
      const current = useEditorStore.getState().project;
      let doc: Project;
      let manifestToSet: any = null;

      if (tpl.manifestId) {
        const pkgTemplate = getTemplate(tpl.manifestId);
        if (pkgTemplate) {
          // Use the real clone machinery (fresh ids, rewritten manifest, provenance)
          const ownerId = current.ownerId || "self";
          const wsId = current.workspaceId || "ws-self";
          const cloned = cloneTemplateToProject(pkgTemplate, {
            title: tpl.name,
            ownerId,
            workspaceId: wsId,
          });
          doc = { ...cloned.document, id: current.id }; // keep current project id for continuity + autosave
          manifestToSet = cloned.manifest;
        } else {
          // Fallback to synthetic if id not found
          doc = buildSyntheticProject(tpl, current);
        }
      } else {
        doc = buildSyntheticProject(tpl, current);
      }

      loadProject(doc);
      clearPlaceholders();

      // If we have a real manifest, wire it so timeline shows beautiful labeled dashed slots
      if (manifestToSet) {
        setManifest(doc.id, manifestToSet);
      }

      // Position the playhead at the very start so the template's video placeholder(s)
      // are actually visible in the canvas preview right away (instead of the generic
      // "No clip at the playhead" message).
      setTimeout(() => {
        const st = useEditorStore.getState();
        const firstVideoTrack = doc.tracks.find(
          (t: any) => t.type === "video" || t.type === "audio" || t.type === "voiceover"
        ) as any;
        const firstClipEnd = firstVideoTrack?.clips?.[0]?.endOnTimeline ?? 2000;
        if (st.playheadMs === 0 || st.playheadMs >= firstClipEnd) {
          st.setPlayhead(0);
        }
      }, 0);

      // Increment usage locally (demo)
      // In real: POST /api/templates/:id/use

      showToast(`Template applied — replace placeholder clips with your own media`);

      // Grace period: suppress noisy "Save failed — retrying" in StatusBar for a freshly
      // applied template project (it may not be persisted to the user's server account yet).
      (useEditorStore.getState() as any).suppressSaveErrorsFor?.(10 * 60 * 1000);

      // After load the timeline/canvas will render placeholders.
      // Auto open media is handled via requestOpen... on click of a placeholder (wired in Timeline).
    } catch (e) {
      console.error(e);
      showToast("Could not apply template");
    } finally {
      setConfirmTemplate(null);
      setShowAll(false);
    }
  }

  // Build a minimal but valid-looking project for synthetic templates.
  // Includes 1 video track + 1-2 placeholder clips + a couple text overlays.
  function buildSyntheticProject(tpl: BrowseTemplate, current: Project): Project {
    const now = new Date().toISOString();
    const ph1Id = uuidv4();
    const ph2Id = uuidv4();
    const vidTrackId = uuidv4();
    const ovTrackId = uuidv4();

    const baseDur = Math.round(tpl.duration * 1000) || 8000;

    // Use actual demo video if provided for this template so the template has real playable video content
    const demoAssetId = tpl.demoVideo ? `demo-video:${tpl.demoVideo.replace('-demo.mp4', '')}` : "__placeholder__";

    const clips: any[] = [
      {
        id: ph1Id,
        trackId: vidTrackId,
        sourceAssetId: demoAssetId,
        startOnTimeline: 0,
        endOnTimeline: Math.round(baseDur * 0.6),
        trimIn: 0,
        trimOut: Math.round(baseDur * 0.6),
        speed: 1,
        linkedClipId: null,
        effects: [],
        keyframes: {},
        transform: { x: 0, y: 0, width: 100, height: 100 },
        colorGrade: null,
        kenBurns: null,
        flipH: false,
        flipV: false,
        opacity: 100,
      },
    ];

    if (tpl.duration > 7) {
      clips.push({
        id: ph2Id,
        trackId: vidTrackId,
        sourceAssetId: demoAssetId, // reuse the same demo for the second slot in simple synthetic
        startOnTimeline: Math.round(baseDur * 0.55),
        endOnTimeline: baseDur,
        trimIn: 0,
        trimOut: Math.round(baseDur * 0.45),
        speed: 1,
        linkedClipId: null,
        effects: [],
        keyframes: {},
        transform: { x: 0, y: 0, width: 100, height: 100 },
        colorGrade: null,
        kenBurns: null,
        flipH: false,
        flipV: false,
        opacity: 100,
      });
    }

    const overlays: any[] = [
      {
        id: uuidv4(),
        trackId: ovTrackId,
        kind: "text",
        text: tpl.name,
        startOnTimeline: 300,
        endOnTimeline: Math.min(2500, baseDur),
        canvasX: 8,
        canvasY: 18,
        width: 84,
        height: 22,
        rotation: 0,
        opacity: 100,
        animation: {},
        style: { fontWeight: 700, color: "#ffffff", align: "center" },
        keyframes: {},
      },
    ];

    const doc: Project = {
      ...current,
      id: current.id,
      title: tpl.name,
      templateId: null,
      tracks: [
        {
          id: vidTrackId,
          type: "video",
          name: "Video 1",
          colour: "#3b82f6",
          height: 80,
          clips,
          locked: false,
          muted: false,
          solo: false,
          hidden: false,
        } as any,
        {
          id: ovTrackId,
          type: "overlay",
          name: "Overlays",
          colour: "#8b5cf6",
          height: 64,
          clips: overlays,
          locked: false,
          muted: false,
          solo: false,
          hidden: false,
        } as any,
      ],
      captionTracks: [],
      markers: [],
      transitions: [],
      createdAt: now,
      updatedAt: now,
      canvas: { ...current.canvas, aspectRatio: tpl.aspectRatio },
    };

    // For pure placeholder templates, set client labels so canvas shows nice "replace me" UI.
    // For templates with demoVideo we intentionally skip this so the real demo video plays in the slot.
    if (!tpl.demoVideo) {
      setTimeout(() => {
        setPlaceholderLabel(ph1Id, "Your product video here");
        if (ph2Id) setPlaceholderLabel(ph2Id, "Your second clip");
        (useEditorStore.getState() as any).requestOpenMediaForPlaceholder?.(ph1Id);
      }, 50);
    }

    return doc;
  }

  // Simple "Save current as template" (MVP). Captures a thumb from the preview canvas if possible.
  function saveCurrentAsTemplate() {
    const name = prompt("Template name?")?.trim();
    if (!name) return;

    // Defer canvas capture off the main thread to avoid blocking the renderer
    // (was causing P1 hard hang / CDP timeout on toDataURL of large preview canvas).
    setTimeout(() => {
      let thumb = "https://picsum.photos/id/160/400/711";
      try {
        const canvases = document.querySelectorAll("canvas");
        const main = Array.from(canvases).find((c) => c.width > 200 && c.height > 200);
        if (main) {
          const tmp = document.createElement("canvas");
          tmp.width = 400;
          tmp.height = 711;
          const tctx = tmp.getContext("2d", { willReadFrequently: true })!;
          tctx.drawImage(main, 0, 0, tmp.width, tmp.height);
          thumb = tmp.toDataURL("image/jpeg", 0.82);
        }
      } catch (e) {
        // fall back to picsum portrait
      }

      const newTpl: BrowseTemplate = {
        id: "user-" + Date.now(),
        name,
        description: "Saved from current project",
        thumbnailUrl: thumb,
        previewGifUrl: thumb,
        category: "promo",
        tags: ["custom"],
        duration: Math.round(((project.tracks.find((t: any) => t.clips) as any)?.clips?.[0]?.endOnTimeline || 8000) / 1000),
        aspectRatio: (project.canvas.aspectRatio as any) || "9:16",
        isPro: false,
        isNew: true,
        usageCount: 1,
        synthetic: true,
      };

      setUserTemplates((prev) => [newTpl, ...prev]);
      showToast("Saved to Your templates");
    }, 0);
  }

  return (
    <div className="flex h-full flex-col text-xs text-vf-text-primary">
      {/* Search */}
      <div className="relative mb-2 px-1">
        <Search className="pointer-events-none absolute left-3 top-2 h-3.5 w-3.5 text-vf-text-tertiary" />
        <input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setShowAll(true);
          }}
          placeholder="Search templates..."
          className="w-full rounded-md border border-vf-border-subtle bg-vf-surface-1 py-1.5 pl-8 pr-7 text-sm placeholder:text-vf-text-tertiary focus:border-vf-accent focus:outline-none"
        />
        {search && (
          <button
            onClick={() => setSearch("")}
            className="absolute right-2 top-2 text-vf-text-tertiary hover:text-vf-text-primary"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Category chips (horiz scroll) */}
      <div
        className="mb-2 flex gap-1 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{ maskImage: "linear-gradient(to right, black 85%, transparent)" }}
      >
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            onClick={() => {
              setActiveCat(c.id);
              setShowAll(true);
            }}
            className={cx(
              "shrink-0 rounded-full border px-2.5 py-0.5 text-[10px] transition",
              activeCat === c.id
                ? "border-vf-accent bg-vf-accent text-white"
                : "border-vf-border-subtle bg-vf-surface-1 hover:bg-vf-surface-2",
            )}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* Save current (quick entry point for Part 4) */}
      <button
        onClick={saveCurrentAsTemplate}
        className="mb-2 w-full rounded-md border border-dashed border-vf-border-strong px-2 py-1 text-[10px] text-vf-text-secondary hover:bg-vf-surface-3"
      >
        + Save current project as template
      </button>

      {/* Content */}
      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        {filtered.length === 0 && (
          <div className="py-6 text-center text-vf-text-tertiary">
            No templates found for “{debouncedSearch}”.
            <button className="ml-1 underline" onClick={() => { setSearch(""); setActiveCat("all"); }}>
              Browse all
            </button>
          </div>
        )}

        {showSections ? (
          <>
            {yours.length > 0 && (
              <Section title="Your templates" onSeeAll={() => setShowAll(true)}>
                {gridFor(yours)}
              </Section>
            )}

            <Section title="Featured" onSeeAll={() => setShowAll(true)}>
              {gridFor(featured)}
            </Section>

            <Section title="Popular" onSeeAll={() => setShowAll(true)}>
              {gridFor(popular)}
            </Section>

            <Section title="New" onSeeAll={() => setShowAll(true)}>
              {gridFor(news)}
            </Section>
          </>
        ) : (
          <div className="pt-1">
            <div className="mb-1 flex items-center justify-between px-0.5 text-[10px] font-medium text-vf-text-tertiary">
              <span>Results ({filtered.length})</span>
              <button className="underline" onClick={() => { setShowAll(false); setActiveCat("all"); setSearch(""); }}>
                Back to sections
              </button>
            </div>
            {gridFor(filtered)}
          </div>
        )}
      </div>

      {/* Confirm replace modal (Canva style) */}
      {confirmTemplate && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-[320px] rounded-lg border border-vf-border-subtle bg-vf-surface-3 p-4 text-sm">
            <div className="font-semibold">Replace current project?</div>
            <p className="mt-1 text-vf-text-secondary">
              Applying “{confirmTemplate.name}” will replace your current project. This cannot be undone.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                className="rounded px-3 py-1 text-vf-text-secondary hover:bg-vf-surface-2"
                onClick={() => setConfirmTemplate(null)}
              >
                Cancel
              </button>
              <button
                className="rounded bg-vf-accent px-3 py-1 font-medium text-white"
                onClick={() => applyNow(confirmTemplate)}
              >
                Replace with template
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="pointer-events-none fixed bottom-4 left-1/2 z-[210] -translate-x-1/2 rounded-full bg-vf-surface-3 px-3 py-1 text-xs shadow">
          {toast}
        </div>
      )}
    </div>
  );
}

function Section({
  title,
  onSeeAll,
  children,
}: {
  title: string;
  onSeeAll: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-3">
      <div className="mb-1 flex items-center justify-between px-0.5">
        <span className="text-[11px] font-semibold text-vf-text-primary">{title}</span>
        <button className="text-[10px] text-vf-accent hover:underline" onClick={onSeeAll}>
          See all →
        </button>
      </div>
      {children}
    </div>
  );
}

// Aspect ratio → poster dims (mirrors templates.ts POSTER_DIMS; 1080-class, capped px).
const POSTER_DIMS_BY_AR: Record<string, { width: number; height: number }> = {
  "9:16": { width: 1080, height: 1920 },
  "16:9": { width: 1920, height: 1080 },
  "1:1": { width: 1080, height: 1080 },
  "4:5": { width: 1080, height: 1350 },
};

// Build a minimal poster-only Project for a synthetic browse template (no editor
// context needed): the template's name as a centred title overlay over a dark canvas +
// a single full-frame media placeholder. Lets generateTemplateThumbnail draw a real,
// zero-license first-frame poster for synthetic cards too.
function buildPosterDocForBrowseTemplate(tpl: BrowseTemplate): Project {
  const dims = POSTER_DIMS_BY_AR[tpl.aspectRatio] ?? POSTER_DIMS_BY_AR["9:16"]!;
  return {
    schemaVersion: 1,
    revision: 1,
    id: "poster:" + tpl.id,
    title: tpl.name,
    description: tpl.description,
    canvas: {
      width: dims.width,
      height: dims.height,
      frameRate: 30,
      aspectRatio: tpl.aspectRatio,
      backgroundColor: "#111111",
    },
    tracks: [
      {
        id: "poster-video",
        type: "video",
        name: "Video",
        colour: "#3b82f6",
        height: 80,
        locked: false,
        muted: false,
        solo: false,
        hidden: false,
        clips: [
          {
            id: "poster-clip",
            trackId: "poster-video",
            sourceAssetId: "__placeholder__",
            startOnTimeline: 0,
            endOnTimeline: 4000,
            trimIn: 0,
            trimOut: 4000,
            speed: 1,
            linkedClipId: null,
            effects: [],
            keyframes: {},
            transform: { x: 0, y: 0, width: 100, height: 100 },
            colorGrade: null,
            kenBurns: null,
            flipH: false,
            flipV: false,
            opacity: 100,
          },
        ],
      },
      {
        id: "poster-overlay",
        type: "overlay",
        name: "Text",
        colour: "#8b5cf6",
        height: 64,
        locked: false,
        muted: false,
        solo: false,
        hidden: false,
        clips: [
          {
            id: "poster-title",
            trackId: "poster-overlay",
            kind: "text",
            text: tpl.name,
            startOnTimeline: 0,
            endOnTimeline: 4000,
            canvasX: 8,
            canvasY: 40,
            width: 84,
            height: 20,
            rotation: 0,
            opacity: 100,
            animation: {},
            keyframes: {},
            style: {
              fontFamily: "Inter",
              fontSize: 120,
              fontWeight: 800,
              color: "#FFFFFF",
              align: "center",
              outline: { width: 2, color: "#000000", position: "outside" },
              shadow: { color: "#00000066", offsetX: 0, offsetY: 3, blur: 6 },
              backgroundColor: null,
            },
          } as any,
        ],
      },
    ] as any,
    captionTracks: [],
    transitions: [],
    markers: [],
    exportPresets: [],
    ownerId: "self",
    workspaceId: "ws-self",
    collaborators: [],
    isPublic: false,
    templateId: null,
    createdAt: "2026-06-04T00:00:00.000Z",
    updatedAt: "2026-06-04T00:00:00.000Z",
  } as Project;
}

function TemplateCard({
  tpl,
  onUse,
  onHoverPrefetch,
}: {
  tpl: BrowseTemplate;
  onUse: () => void;
  onHoverPrefetch?: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const isBlank = tpl.id === "blank";

  // Real generated first-frame poster (template background + text overlays), on-device,
  // zero external bytes. Package templates use their real document; synthetic ones use a
  // lightweight poster doc. Falls back to the legacy thumbnailUrl if generation is
  // unavailable (e.g. user-saved templates that already carry a captured data-URL thumb).
  const poster = useMemo(() => {
    if (isBlank) return null;
    if (tpl.id.startsWith("user-")) return null; // keep user-captured thumbnails
    try {
      if (tpl.manifestId) {
        const pkg = getTemplate(tpl.manifestId);
        if (pkg) return generateTemplateThumbnail(pkg.document);
      }
      return generateTemplateThumbnail(buildPosterDocForBrowseTemplate(tpl));
    } catch {
      return null;
    }
  }, [tpl.id, tpl.manifestId, isBlank]);

  const imgSrc = poster ?? (hovered && tpl.previewGifUrl ? tpl.previewGifUrl : tpl.thumbnailUrl);

  return (
    <button
      onClick={onUse}
      onMouseEnter={() => {
        setHovered(true);
        onHoverPrefetch?.();
      }}
      onMouseLeave={() => setHovered(false)}
      className={cx(
        "group relative flex flex-col overflow-hidden rounded-lg border text-left transition-all",
        "border-vf-border-subtle bg-vf-surface-2 hover:border-vf-accent hover:shadow-sm",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-vf-accent",
      )}
    >
      {/* 9:16 thumbnail area */}
      <div className="relative w-full overflow-hidden bg-[#0b0d14]" style={{ aspectRatio: "9 / 16" }}>
        {!isBlank && imgSrc ? (
          <img
            src={imgSrc}
            alt={tpl.name}
            loading="lazy"
            className="absolute inset-0 h-full w-full object-cover transition-opacity duration-150"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-[#111] text-vf-text-tertiary">
            <div className="flex flex-col items-center">
              <Sparkles className="h-6 w-6" />
              <span className="mt-1 text-[10px]">Start fresh</span>
            </div>
          </div>
        )}

        {/* Badges */}
        {tpl.isNew && (
          <span className="absolute left-1 top-1 rounded bg-[#22c55e] px-1 py-px text-[8px] font-bold text-white">
            NEW
          </span>
        )}
        {tpl.isPro && (
          <span className="absolute right-1 top-1 rounded bg-vf-accent px-1 py-px text-[8px] font-bold text-white">
            PRO
          </span>
        )}

        {/* Hover CTA overlay (slides up) */}
        <div
          className={cx(
            "absolute bottom-0 left-0 right-0 flex h-7 items-center justify-center bg-black/60 text-[10px] font-medium text-white opacity-0 transition-all",
            "group-hover:opacity-100 group-hover:translate-y-0 -translate-y-1",
          )}
        >
          Use template
        </div>
      </div>

      <div className="px-1.5 py-1">
        <div className="truncate text-[12px] font-medium text-vf-text-primary">{tpl.name}</div>
        <div className="truncate text-[9px] text-vf-text-tertiary">{tpl.duration ? `${tpl.duration}s` : "—"}</div>
      </div>
    </button>
  );
}
