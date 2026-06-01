FROM node:20-bookworm-slim AS base

ARG FFMPEG_VERSION=6.1.1
ENV FFMPEG_PATH=/usr/local/bin/ffmpeg
ENV FFPROBE_PATH=/usr/local/bin/ffprobe
ENV FFMPEG_PINNED_VERSION=6.1.1

# Install ffmpeg static build (pinned version)
RUN apt-get update && apt-get install -y curl xz-utils && rm -rf /var/lib/apt/lists/* \
  && curl -fsSL "https://johnvansickle.com/ffmpeg/releases/ffmpeg-${FFMPEG_VERSION}-amd64-static.tar.xz" \
     -o /tmp/ff.tar.xz \
  && tar -xJf /tmp/ff.tar.xz -C /tmp \
  && mv /tmp/ffmpeg-${FFMPEG_VERSION}-amd64-static/ffmpeg /usr/local/bin/ffmpeg \
  && mv /tmp/ffmpeg-${FFMPEG_VERSION}-amd64-static/ffprobe /usr/local/bin/ffprobe \
  && rm -rf /tmp/ff* \
  && ffmpeg -version | grep -q "${FFMPEG_VERSION}"

WORKDIR /app

# Copy pnpm workspace files
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
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
