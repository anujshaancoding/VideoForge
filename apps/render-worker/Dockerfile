FROM node:20-bookworm-slim AS base

ARG FFMPEG_VERSION=6.1.1
ARG TARGETARCH
ENV FFMPEG_PATH=/usr/local/bin/ffmpeg
ENV FFPROBE_PATH=/usr/local/bin/ffprobe
ENV FFMPEG_PINNED_VERSION=6.1.1

# Inter font (OFL) — the text-overlay drawtext stage renders Inter to match the preview
# canvas (Text_Overlay_Export_Spec.md §4). PINNED like FFmpeg (R7: an Inter version bump
# changes glyph outlines and silently shifts the goldens, so it is a reviewed event).
ARG INTER_VERSION=4.0
ENV INTER_PINNED_VERSION=4.0
ENV INTER_FONT_DIR=/usr/share/fonts/inter

# Install ffmpeg. John Van Sickle only publishes amd64/i686 static builds (NO arm64),
# so on amd64 (CI) we use the pinned static build for golden-frame determinism, and on
# arm64 (Apple Silicon) — or if the pinned download is unavailable — we fall back to the
# distro's ffmpeg so the image builds everywhere. (The version pin is a CI-fidelity
# concern; nothing asserts it at worker boot.)
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl xz-utils ca-certificates \
  && ARCH="$(dpkg --print-architecture)" \
  && if [ "$ARCH" = "amd64" ] \
       && curl -fsSL "https://johnvansickle.com/ffmpeg/old-releases/ffmpeg-${FFMPEG_VERSION}-amd64-static.tar.xz" -o /tmp/ff.tar.xz; then \
         tar -xJf /tmp/ff.tar.xz -C /tmp \
         && mv "/tmp/ffmpeg-${FFMPEG_VERSION}-amd64-static/ffmpeg" /usr/local/bin/ffmpeg \
         && mv "/tmp/ffmpeg-${FFMPEG_VERSION}-amd64-static/ffprobe" /usr/local/bin/ffprobe \
         && rm -rf /tmp/ff*; \
     else \
         apt-get install -y --no-install-recommends ffmpeg \
         && ln -sf "$(command -v ffmpeg)" /usr/local/bin/ffmpeg \
         && ln -sf "$(command -v ffprobe)" /usr/local/bin/ffprobe; \
     fi \
  && rm -rf /var/lib/apt/lists/* \
  && /usr/local/bin/ffmpeg -version

# ── Inter static TTFs for drawtext (pinned, OFL) ────────────────────────────────────
# Download the pinned Inter release and place the per-weight static TTFs at
# $INTER_FONT_DIR. `buildFilterComplex` emits `font:Inter-<Face>.ttf` tokens and the
# worker resolves them to "$INTER_FONT_DIR/Inter-<Face>.ttf" (weightToInterFile), so the
# five <link> weights (Regular/Medium/SemiBold/Bold/ExtraBold) + their Italics MUST exist
# under those exact basenames. We download (not vendor) to avoid committing binaries —
# the version is pinned, mirroring the FFmpeg-pin discipline. Build fails loudly if the
# required faces are missing (so a future Inter rename — R7 — is caught at build, not at
# render time).
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl unzip ca-certificates fontconfig \
  && mkdir -p "${INTER_FONT_DIR}" \
  && curl -fsSL "https://github.com/rsms/inter/releases/download/v${INTER_VERSION}/Inter-${INTER_VERSION}.zip" -o /tmp/inter.zip \
  && unzip -q /tmp/inter.zip -d /tmp/inter \
  # Inter ships per-weight static TTFs under extras/ttf/. Flatten every static TTF into
  # the font dir (the archive layout varies across releases — copy them all, then assert
  # the faces we need below).
  && find /tmp/inter -path '*extras*' -name 'Inter*-*.ttf' -exec cp -f {} "${INTER_FONT_DIR}/" \; \
  # Normalise to the plain "Inter-<Face>.ttf" basenames the resolver expects. If an Inter
  # release only ships optical-size-suffixed statics (e.g. Inter_18pt-SemiBold.ttf, the v4
  # text optical size), alias them to the bare names so the export font paths resolve.
  && for FACE in Regular Medium SemiBold Bold ExtraBold Italic MediumItalic SemiBoldItalic BoldItalic ExtraBoldItalic; do \
       if [ ! -f "${INTER_FONT_DIR}/Inter-${FACE}.ttf" ]; then \
         SRC="$(find "${INTER_FONT_DIR}" -maxdepth 1 -name "Inter_*pt-${FACE}.ttf" | sort | head -n1)"; \
         [ -n "$SRC" ] && cp -f "$SRC" "${INTER_FONT_DIR}/Inter-${FACE}.ttf" || true; \
       fi; \
     done \
  # Hard-assert the five upright <link> weights exist — fail the build if Inter's layout
  # drifted (R7), rather than shipping an image that silently can't render text overlays.
  && for FACE in Regular Medium SemiBold Bold ExtraBold; do \
       test -f "${INTER_FONT_DIR}/Inter-${FACE}.ttf" \
         || { echo "FATAL: Inter-${FACE}.ttf missing after extracting Inter ${INTER_VERSION}" >&2; \
              ls -la "${INTER_FONT_DIR}" >&2; exit 1; }; \
     done \
  && fc-cache -f "${INTER_FONT_DIR}" \
  && rm -rf /tmp/inter.zip /tmp/inter /var/lib/apt/lists/*

WORKDIR /app

# Copy pnpm workspace files + the root TS configs every package's tsconfig extends
# (without tsconfig.base.json the in-container `tsc` build fails with TS5083).
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json tsconfig.json ./
COPY packages/project-schema/package.json ./packages/project-schema/
COPY packages/ffmpeg-graph/package.json ./packages/ffmpeg-graph/
COPY packages/config/package.json ./packages/config/
COPY apps/render-worker/package.json ./apps/render-worker/

RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
RUN pnpm install --frozen-lockfile --filter @videoforge/render-worker...

COPY packages/project-schema ./packages/project-schema
COPY packages/ffmpeg-graph ./packages/ffmpeg-graph
COPY packages/config ./packages/config
COPY apps/render-worker ./apps/render-worker

RUN pnpm --filter @videoforge/project-schema build
RUN pnpm --filter @videoforge/ffmpeg-graph build
RUN pnpm --filter @videoforge/render-worker build

CMD ["node", "apps/render-worker/dist/index.js"]
