# Makefile — human-friendly aliases over the pnpm scripts (Pipeline.md §2.5).
# Every target is a thin wrapper; the pnpm scripts in package.json are the source
# of truth. pnpm is invoked via corepack (it is not assumed to be on PATH).
#
#   make            # prints this help
#   make env install services seed check-ffmpeg golden dev
PNPM := corepack pnpm@9.12.0

.DEFAULT_GOAL := help
.PHONY: help env install services seed dev check-ffmpeg golden down reset

help:           ## list the available targets
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
	  | awk 'BEGIN {FS = ":.*?## "} {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

env:            ## create .env from the example on first run (no-op if it exists)
	@test -f .env || cp .env.example .env
	@echo ".env ready"

install: env    ## install workspace deps + build shared packages
	$(PNPM) install
	$(PNPM) -r --filter "./packages/*" build

services:       ## start postgres/redis/minio + worker, wait for health, create buckets
	$(PNPM) services:up

seed: services  ## run migrations, load CC0 fixtures into MinIO + rows into Postgres
	$(PNPM) db:migrate
	$(PNPM) seed

dev:            ## run web + api + render-worker together (prefixed combined logs)
	$(PNPM) dev:all

check-ffmpeg:   ## verify the local FFmpeg matches FFMPEG_PINNED_VERSION (§2.6)
	$(PNPM) check:ffmpeg

golden:         ## run the golden-frame fidelity gate locally (MVP_Scope §1 north-star)
	$(PNPM) test:golden

down:           ## stop services (keep volumes/data)
	$(PNPM) services:down

reset:          ## stop + DELETE all local data (postgres/redis/minio volumes)
	$(PNPM) services:reset
