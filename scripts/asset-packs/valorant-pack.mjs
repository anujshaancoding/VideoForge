#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Valorant asset-pack downloader — the curated, legally-clean source for the
// script→video pipeline's Valorant niche (comparison / choice / review formats).
//
// Pulls OFFICIAL Riot art + structured stats from valorant-api.com (a free,
// community-run mirror of Riot's own game assets — https://dash.valorant-api.com)
// into a tagged local library with a provenance/license manifest. We RETRIEVE
// these instead of scraping Google/Pinterest (copyrighted, TOS-violating) or
// AI-generating (hallucinates real, branded subjects). See
// apps/api/src/script/imageSearch.ts for the retrieval-vs-generation rationale.
//
//   node scripts/asset-packs/valorant-pack.mjs            # full pack
//   node scripts/asset-packs/valorant-pack.mjs --no-images  # metadata only (fast)
//
// Output: assets/valorant/{agents,weapons,maps}/*.png + manifest.json
//   manifest.json holds the structured data (stats, abilities, roles, theme
//   colors) the templates render from, plus per-asset source URL + license note.
//
// LICENSE NOTE (audience-first, provenance-stamped — CEO decision 2026-06-28):
//   Riot game assets are Riot Games IP. Usage is governed by Riot's "Legal Jibber
//   Jabber" / Fan Content Policy, which PERMITS non-commercial & ad-supported fan
//   content provided videos are not presented as official and carry the
//   "not endorsed by Riot Games" disclaimer. No merch / paid products. This pack
//   is for that fan-content use only; the manifest records source + policy URL so
//   sourcing is auditable before any monetization (a CEO legal/brand gate).
// ─────────────────────────────────────────────────────────────────────────────

import { mkdir, writeFile, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const OUT_DIR = join(REPO_ROOT, 'assets', 'valorant');
const API = 'https://valorant-api.com/v1';
const FAN_POLICY = 'https://www.riotgames.com/en/legal/legal-jibber-jabber';

const SKIP_IMAGES = process.argv.includes('--no-images');
const DL_CONCURRENCY = 6;
const TIMEOUT_MS = 15000;

// ── tiny fetch helpers (timeout + graceful) ──────────────────────────────────
async function getJson(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    return (await res.json()).data;
  } finally {
    clearTimeout(t);
  }
}

async function exists(p) {
  try { await access(p); return true; } catch { return false; }
}

async function downloadImage(url, destRel) {
  if (!url) return null;
  const dest = join(OUT_DIR, destRel);
  if (await exists(dest)) return destRel; // re-runnable: skip what we already have
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength < 256) return null;
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, buf);
    return destRel;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

// run async jobs with a bounded number in flight
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// ── agents ───────────────────────────────────────────────────────────────────
async function buildAgents(jobs) {
  const raw = await getJson(`${API}/agents?isPlayableCharacter=true`);
  return Promise.all(raw.map(async (a) => {
    const id = slug(a.displayName);
    const imgs = {
      portrait: `agents/${id}-portrait.png`,
      icon: `agents/${id}-icon.png`,
    };
    if (!SKIP_IMAGES) {
      jobs.push(() => downloadImage(a.fullPortrait, imgs.portrait));
      jobs.push(() => downloadImage(a.displayIcon, imgs.icon));
      a.abilities.filter((ab) => ab.displayIcon).forEach((ab, k) => {
        const rel = `agents/${id}-ability-${k}-${slug(ab.slot || String(k))}.png`;
        imgs[`ability_${k}`] = rel;
        jobs.push(() => downloadImage(ab.displayIcon, rel));
      });
    }
    return {
      id,
      name: a.displayName,
      role: a.role?.displayName ?? null,
      roleIconUrl: a.role?.displayIcon ?? null,
      description: a.description,
      themeColors: a.backgroundGradientColors ?? [],
      abilities: a.abilities.map((ab) => ({ slot: ab.slot, name: ab.displayName, description: ab.description })),
      images: imgs,
      source: { provider: 'valorant-api.com', uuid: a.uuid, portraitUrl: a.fullPortrait, iconUrl: a.displayIcon },
    };
  }));
}

// ── weapons (with the stats that make comparisons accurate) ───────────────────
async function buildWeapons(jobs) {
  const raw = await getJson(`${API}/weapons`);
  return raw.map((w) => {
    const id = slug(w.displayName);
    const imgs = { icon: `weapons/${id}.png` };
    if (!SKIP_IMAGES) jobs.push(() => downloadImage(w.displayIcon, imgs.icon));
    const s = w.weaponStats;
    return {
      id,
      name: w.displayName,
      category: (w.shopData?.categoryText ?? w.category ?? '').replace('EEquippableCategory::', ''),
      cost: w.shopData?.cost ?? null,
      stats: s ? {
        fireRate: s.fireRate,
        magazineSize: s.magazineSize,
        reloadTimeSeconds: s.reloadTimeSeconds,
        equipTimeSeconds: s.equipTimeSeconds,
        firstBulletAccuracy: s.firstBulletAccuracy,
        wallPenetration: (s.wallPenetration ?? '').replace('EWallPenetrationDisplayType::', ''),
        fireMode: (s.fireMode ?? '').replace('EWeaponFireModeDisplayType::', '') || 'FullyAutomatic',
        damageRanges: (s.damageRanges ?? []).map((d) => ({
          from: d.rangeStartMeters, to: d.rangeEndMeters,
          head: d.headDamage, body: d.bodyDamage, leg: d.legDamage,
        })),
      } : null,
      images: imgs,
      source: { provider: 'valorant-api.com', uuid: w.uuid, iconUrl: w.displayIcon },
    };
  });
}

// ── maps (real maps only — drop training/skirmish range entries) ──────────────
async function buildMaps(jobs) {
  const raw = await getJson(`${API}/maps`);
  return raw
    .filter((m) => m.tacticalDescription && m.coordinates) // real competitive maps have these
    .map((m) => {
      const id = slug(m.displayName);
      const imgs = { splash: `maps/${id}-splash.png`, layout: `maps/${id}-layout.png` };
      if (!SKIP_IMAGES) {
        jobs.push(() => downloadImage(m.splash, imgs.splash));
        jobs.push(() => downloadImage(m.displayIcon, imgs.layout));
      }
      return {
        id,
        name: m.displayName,
        coordinates: m.coordinates,
        images: imgs,
        source: { provider: 'valorant-api.com', uuid: m.uuid, splashUrl: m.splash },
      };
    });
}

// ── main ──────────────────────────────────────────────────────────────────────
async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  console.log(`Valorant asset pack → ${OUT_DIR}${SKIP_IMAGES ? '  (metadata only)' : ''}`);

  const jobs = [];
  const [agents, weapons, maps] = await Promise.all([
    buildAgents(jobs), buildWeapons(jobs), buildMaps(jobs),
  ]);

  let downloaded = 0;
  if (!SKIP_IMAGES) {
    console.log(`Downloading ${jobs.length} images (concurrency ${DL_CONCURRENCY})…`);
    const results = await mapLimit(jobs, DL_CONCURRENCY, (j) => j());
    downloaded = results.filter(Boolean).length;
  }

  const manifest = {
    generatedBy: 'scripts/asset-packs/valorant-pack.mjs',
    source: { provider: 'valorant-api.com', baseUrl: API, media: 'media.valorant-api.com' },
    license: {
      owner: 'Riot Games, Inc.',
      usage: 'Fan content only — non-commercial / ad-supported per Riot Fan Content Policy.',
      requirement: 'Videos must not be presented as official; include "not endorsed by Riot Games" disclaimer. No merch / paid products.',
      policyUrl: FAN_POLICY,
      reviewBeforeMonetizing: true,
    },
    counts: { agents: agents.length, weapons: weapons.length, maps: maps.length, imagesDownloaded: downloaded },
    agents, weapons, maps,
  };
  await writeFile(join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));

  console.log(`\n✓ Pack ready: ${agents.length} agents, ${weapons.length} weapons, ${maps.length} maps`);
  console.log(`  Images: ${downloaded}${SKIP_IMAGES ? ' (skipped)' : ''}  ·  manifest.json written`);
  console.log(`  License: Riot Fan Content Policy — audience/ad-supported OK, review before paid use.`);
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
