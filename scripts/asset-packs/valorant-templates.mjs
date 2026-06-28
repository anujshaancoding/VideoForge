#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Valorant 9:16 video templates — the layout library for the script→video pipeline.
//
//   node scripts/asset-packs/valorant-templates.mjs            # render all hero previews + contact sheet
//   node scripts/asset-packs/valorant-templates.mjs <id>       # render one template's hero preview
//   node scripts/asset-packs/valorant-templates.mjs --list     # list template ids
//   node scripts/asset-packs/valorant-templates.mjs --storyboard <id>   # render a multi-scene storyboard
//
// WHY THIS SHAPE (export-parity, CLAUDE.md "the invariant"):
//   VideoForge's exporter renders only kind:"text" overlays + media-track image/video
//   clips (packages/ffmpeg-graph buildFilterComplex.ts:625 — image/shape OVERLAYS are
//   out of scope). So a template layout (split-screen, stat bars, badges, gradients) is
//   composed as an SVG, rasterised to a full-frame PNG (sharp), and placed as a timed
//   IMAGE CLIP — a path the exporter already renders + golden-tests. VO-synced bottom
//   captions ride on top as real text overlays. Result: full visual freedom, automatic
//   preview==export.
//
// Data source: assets/valorant/manifest.json (scripts/asset-packs/valorant-pack.mjs).
// Brand: Valorant red #FF4655 on navy #0F1923 + per-agent theme gradients.
// NOTE: real Valorant wordmark font is "Tungsten" (condensed) — using Arial Black as a
//       stand-in; swap in a licensed/free condensed face for final polish.
// ─────────────────────────────────────────────────────────────────────────────

import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

// sharp lives in the workspace; resolve it from apps/api which depends on it.
const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, '..', '..');
const sharp = require(join(REPO, 'apps', 'api', 'node_modules', 'sharp'));

const PACK_DIR = join(REPO, 'assets', 'valorant');
const OUT_DIR = join(PACK_DIR, 'previews');
const W = 1080, H = 1920;

// ── brand palette ─────────────────────────────────────────────────────────────
const RED = '#FF4655';
const DARK = '#0F1923';
const DARK2 = '#1B2733';
const WHITE = '#ECE8E1';
const MUTED = '#8B978F';
// Display face: Anton (OFL, assets/fonts/, installed to ~/Library/Fonts) — a heavy
// condensed grotesque, the closest free match to Valorant's "Tungsten". Frames are
// pre-rendered to PNG here, so the font bakes in and the render container needs none.
const FONT = 'Anton, sans-serif'; // NB: no quoted family — double-quotes break font-family="${FONT}" in SVG attrs
const FONT2 = 'Arial, Helvetica, sans-serif'; // body/labels stay in a humanist sans
const FONT_DISPLAY_RATIO = 0.56; // Anton caps advance ≈ 0.56·fontSize (condensed)
const TEAL = '#5BC0BE'; // contender-B side color
const GRAY = '#3a4654'; // neutral "not-winner" bar (research: gray everything but the highlight)

// ── small helpers ─────────────────────────────────────────────────────────────
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const hex = (c) => (c ? '#' + String(c).replace(/^#/, '').slice(0, 6) : DARK); // strip AA from RRGGBBAA
const tierColor = (t) => ({ S: '#FF4655', A: '#FF9F1C', B: '#FFD23F', C: '#5BC0BE', D: '#6B7280' }[t] || MUTED);

function byName(list, name, fallbackIdx = 0) {
  return list.find((x) => x.name.toLowerCase() === name.toLowerCase()) ?? list[fallbackIdx];
}
function img(p) { return join(PACK_DIR, p); }

// gradient background SVG built from two hex colors (diagonal, dark vignette)
function bgGradient(a, b) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0.6" y2="1">
      <stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${DARK}"/>
    </linearGradient>
    <radialGradient id="v" cx="0.5" cy="0.38" r="0.75">
      <stop offset="0.55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.55"/>
    </radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#g)"/>
  <rect width="${W}" height="${H}" fill="url(#v)"/>
  ${b ? `<rect x="${W / 2}" width="${W / 2}" height="${H}" fill="${b}" opacity="0.18"/>` : ''}
</svg>`;
}

// shared chrome: a brand header strip + footer disclaimer. Returns SVG fragments.
function header(kicker, title) {
  const lines = String(title).split('\n');
  const longest = Math.max(...lines.map((l) => l.length));
  // Auto-fit the title into the W-116 band (Anton is condensed → it can run bigger).
  const size = Math.max(54, Math.min(108, Math.floor((W - 116) / (longest * FONT_DISPLAY_RATIO))));
  const texts = lines
    .map((l, i) => `<text x="56" y="${220 + i * Math.round(size * 0.96)}" font-family="${FONT}" font-size="${size}" fill="${WHITE}" font-weight="900">${esc(l)}</text>`)
    .join('');
  return `
  <rect x="0" y="78" width="14" height="150" fill="${RED}"/>
  <text x="60" y="150" font-family="${FONT2}" font-size="34" letter-spacing="8" fill="${RED}" font-weight="700">${esc(kicker)}</text>
  ${texts}`;
}
function footer(handle = '@zentrix') {
  return `
  <text x="${W / 2}" y="${H - 86}" text-anchor="middle" font-family="${FONT2}" font-size="30" fill="${WHITE}" font-weight="700">${esc(handle)}</text>
  <text x="${W / 2}" y="${H - 48}" text-anchor="middle" font-family="${FONT2}" font-size="20" fill="${MUTED}">Fan content — not endorsed by Riot Games</text>`;
}

// a single horizontal stat bar (label left, value right, filled track)
function statRow(label, value, frac, x, y, w, color = RED, valTxt) {
  const fill = Math.max(0.02, Math.min(1, frac));
  return `
  <text x="${x}" y="${y - 14}" font-family="${FONT2}" font-size="30" fill="${MUTED}" font-weight="700" letter-spacing="2">${esc(label)}</text>
  <text x="${x + w}" y="${y - 14}" text-anchor="end" font-family="${FONT}" font-size="34" fill="${WHITE}" font-weight="900">${esc(valTxt ?? value)}</text>
  <rect x="${x}" y="${y}" width="${w}" height="22" rx="11" fill="#ffffff" opacity="0.10"/>
  <rect x="${x}" y="${y}" width="${Math.round(w * fill)}" height="22" rx="11" fill="${color}"/>`;
}

function roleBadge(role, x, y) {
  return `<rect x="${x}" y="${y}" width="${30 + role.length * 20}" height="48" rx="24" fill="#000" opacity="0.45"/>
  <text x="${x + 22}" y="${y + 33}" font-family="${FONT2}" font-size="28" fill="${WHITE}" font-weight="800" letter-spacing="2">${esc(role.toUpperCase())}</text>`;
}

// ── render engine: bg svg → composite images → overlay svg ───────────────────
async function fitImage(path, w, h, fit = 'inside', flip = false) {
  let s = sharp(path).resize(w, h, { fit, background: { r: 0, g: 0, b: 0, alpha: 0 } });
  if (flip) s = s.flop(); // mirror horizontally so the two guns face each other
  return s.png().toBuffer();
}
async function renderFrame(spec) {
  const base = sharp(Buffer.from(spec.bg ?? bgGradient(DARK2, null)));
  const layers = [];
  for (const im of spec.images ?? []) {
    try {
      const buf = await fitImage(img(im.path), im.w, im.h, im.fit ?? 'inside', im.flip);
      const meta = await sharp(buf).metadata();
      layers.push({ input: buf, left: Math.max(0, im.x + Math.round(((im.w - meta.width) / 2) * (im.center ? 1 : 0))), top: Math.max(0, im.y) });
    } catch { /* missing image → skip, layout still renders */ }
  }
  const overlaySvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${spec.overlay}</svg>`;
  if (process.env.DUMP_SVG) await writeFile('/tmp/last-overlay.svg', overlaySvg);
  layers.push({ input: Buffer.from(overlaySvg), left: 0, top: 0 });
  return base.composite(layers).png().toBuffer();
}

// ═════════════════════════════════════════════════════════════════════════════
// VERSUS PRIMITIVES — the research-driven comparison layout (back-to-back bars,
// one winner highlighted per row + check, loser neutral gray).
// ═════════════════════════════════════════════════════════════════════════════
function weaponRows(a, b) {
  return [
    { k: 'HEAD DAMAGE', av: a.stats?.damageRanges?.[0]?.head ?? 0, bv: b.stats?.damageRanges?.[0]?.head ?? 0, max: 160 },
    { k: 'FIRE RATE', av: a.stats?.fireRate ?? 0, bv: b.stats?.fireRate ?? 0, max: 13 },
    { k: 'MAGAZINE', av: a.stats?.magazineSize ?? 0, bv: b.stats?.magazineSize ?? 0, max: 30 },
    { k: 'CREDITS', av: a.cost ?? 0, bv: b.cost ?? 0, max: 3000, lowerWins: true, fmt: (v) => `$${v}` },
  ];
}

// -1 = left(A) wins, 1 = right(B) wins, 0 = tie. Respects lowerWins (e.g. cost).
function rowWinner(av, bv, lowerWins) {
  if (av === bv) return 0;
  return (lowerWins ? av < bv : av > bv) ? -1 : 1;
}

// A drawn checkmark (SVG path, not a font glyph → renders everywhere).
function check(x, y, c) {
  return `<polyline points="${x},${y} ${x + 13},${y + 15} ${x + 38},${y - 18}" fill="none" stroke="${c}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>`;
}

// Two contenders facing off, back-to-back bars from a centre axis. The WINNER of
// each row is highlighted (accent + check + bigger value); the loser is neutral
// gray. Shows rows[0..show-1]; `hot` = the row currently being revealed.
function compareFrame(a, b, rows, show, hot) {
  const cx = W / 2, gap = 16, maxLen = 360, barH = 30;
  let svg = header('STAT BATTLE', `${a.name.toUpperCase()} vs ${b.name.toUpperCase()}`);
  // Weapon zone — each gun in its own half, facing the centre VS badge (no overlap).
  svg += `
  <line x1="${cx}" y1="300" x2="${cx}" y2="560" stroke="#ffffff" stroke-opacity="0.08" stroke-width="3"/>
  <text x="280" y="600" text-anchor="middle" font-family="${FONT}" font-size="62" fill="${RED}" font-weight="900">${esc(a.name.toUpperCase())}</text>
  <rect x="180" y="616" width="200" height="8" rx="4" fill="${RED}"/>
  <text x="800" y="600" text-anchor="middle" font-family="${FONT}" font-size="62" fill="${TEAL}" font-weight="900">${esc(b.name.toUpperCase())}</text>
  <rect x="700" y="616" width="200" height="8" rx="4" fill="${TEAL}"/>
  <circle cx="${cx}" cy="412" r="60" fill="${RED}"/><circle cx="${cx}" cy="412" r="60" fill="none" stroke="#fff" stroke-width="4"/>
  <text x="${cx}" y="434" text-anchor="middle" font-family="${FONT}" font-size="50" fill="#fff" font-weight="900">VS</text>`;
  let y = 750;
  for (let i = 0; i < show; i++) {
    const r = rows[i];
    const lenA = Math.round(maxLen * Math.max(0.03, Math.min(1, r.av / r.max)));
    const lenB = Math.round(maxLen * Math.max(0.03, Math.min(1, r.bv / r.max)));
    const win = rowWinner(r.av, r.bv, r.lowerWins);
    const valA = r.fmt ? r.fmt(r.av) : String(r.av), valB = r.fmt ? r.fmt(r.bv) : String(r.bv);
    const colA = win === -1 ? RED : GRAY, colB = win === 1 ? TEAL : GRAY;
    const txtA = win === -1 ? WHITE : MUTED, txtB = win === 1 ? WHITE : MUTED;
    if (i === hot) svg += `<rect x="40" y="${y - 48}" width="${W - 80}" height="160" rx="18" fill="#ffffff" opacity="0.05"/>`;
    svg += `
    <text x="${cx}" y="${y}" text-anchor="middle" font-family="${FONT2}" font-size="30" fill="${MUTED}" font-weight="700" letter-spacing="4">${esc(r.k)}</text>
    <rect x="${cx - gap - lenA}" y="${y + 26}" width="${lenA}" height="${barH}" rx="${barH / 2}" fill="${colA}"/>
    <rect x="${cx + gap}" y="${y + 26}" width="${lenB}" height="${barH}" rx="${barH / 2}" fill="${colB}"/>
    <text x="${cx - gap - lenA - 20}" y="${y + 51}" text-anchor="end" font-family="${FONT}" font-size="${win === -1 ? 46 : 38}" fill="${txtA}" font-weight="900">${esc(valA)}</text>
    <text x="${cx + gap + lenB + 20}" y="${y + 51}" text-anchor="start" font-family="${FONT}" font-size="${win === 1 ? 46 : 38}" fill="${txtB}" font-weight="900">${esc(valB)}</text>
    ${win === -1 ? check(cx - gap - 52, y + 36, RED) : ''}${win === 1 ? check(cx + gap + 14, y + 36, TEAL) : ''}`;
    y += 205;
  }
  return {
    bg: bgGradient('#2a1118', null),
    images: [
      { path: a.images.icon, x: 80, y: 320, w: 400, h: 180, fit: 'inside' },
      { path: b.images.icon, x: 600, y: 320, w: 400, h: 180, fit: 'inside', flip: true },
    ],
    overlay: svg + footer(),
  };
}

// Agent spotlight with progressive ability reveal (abilities[0..show-1], `hot` glows).
function spotlightFrame(a, show, hot) {
  const abils = (a.abilities || []).filter((x) => x.name).slice(0, 4);
  const images = [{ path: a.images.portrait, x: -160, y: 380, w: 760, h: 1200, fit: 'inside' }];
  let svg = header(a.role || 'AGENT', a.name.toUpperCase());
  let y = 760;
  for (let i = 0; i < show; i++) {
    const ab = abils[i]; if (!ab) break;
    if (a.images[`ability_${i}`]) images.push({ path: a.images[`ability_${i}`], x: 600, y: y - 6, w: 90, h: 90, fit: 'inside' });
    const glow = i === hot ? `<rect x="566" y="${y - 30}" width="478" height="140" rx="20" fill="${RED}" opacity="0.18"/>` : '';
    svg += `${glow}<rect x="580" y="${y - 20}" width="450" height="120" rx="16" fill="#000" opacity="0.42"/>
    <text x="710" y="${y + 36}" font-family="${FONT}" font-size="42" fill="${WHITE}" font-weight="900">${esc(ab.name.toUpperCase())}</text>
    <text x="710" y="${y + 80}" font-family="${FONT2}" font-size="24" fill="${MUTED}" letter-spacing="2">${esc((ab.slot || '').toUpperCase())}</text>`;
    y += 150;
  }
  return { bg: bgGradient(hex(a.themeColors?.[0]), null), images, overlay: svg + footer() };
}

// Top-5 countdown reveal: reveals rank #5 first up to #1 (revealCount 0..5); the
// newest rank (6-revealCount) is highlighted, locked rows show "? ? ?".
function countdownFrame(picks, revealCount, kicker = 'RANKED', title = 'TOP 5 DUELISTS') {
  let svg = header(kicker, title); const images = []; let y = 360;
  picks.forEach((ag, i) => {
    const rank = i + 1;
    const revealed = rank >= 6 - revealCount;
    const isHot = rank === 6 - revealCount;
    svg += `<rect x="60" y="${y}" width="${W - 120}" height="230" rx="20" fill="#000" opacity="${revealed ? (isHot ? 0.6 : 0.4) : 0.18}"/>
    ${isHot ? `<rect x="60" y="${y}" width="${W - 120}" height="230" rx="20" fill="none" stroke="${RED}" stroke-width="5"/>` : ''}
    <text x="120" y="${y + 168}" font-family="${FONT}" font-size="160" fill="${isHot ? RED : revealed ? WHITE : MUTED}" font-weight="900">${rank}</text>`;
    if (revealed) {
      svg += `<text x="340" y="${y + 148}" font-family="${FONT}" font-size="66" fill="${WHITE}" font-weight="900">${esc(ag.name.toUpperCase())}</text>
      <text x="342" y="${y + 196}" font-family="${FONT2}" font-size="30" fill="${MUTED}" letter-spacing="2">${esc((ag.role || '').toUpperCase())}</text>`;
      images.push({ path: ag.images.icon, x: W - 280, y: y + 25, w: 180, h: 180, fit: 'cover' });
    } else {
      svg += `<text x="340" y="${y + 162}" font-family="${FONT}" font-size="66" fill="${MUTED}" font-weight="900">? ? ?</text>`;
    }
    y += 250;
  });
  return { bg: bgGradient('#241018', null), images, overlay: svg + footer() };
}

// naive word-wrap into <text> lines
function wrapText(text, x, y, size, lh, color, maxW) {
  const cps = maxW / (size * 0.55); // approx chars per line
  const words = String(text).split(/\s+/); const lines = []; let cur = '';
  for (const w of words) { if ((cur + ' ' + w).trim().length > cps) { lines.push(cur.trim()); cur = w; } else cur += ' ' + w; }
  if (cur.trim()) lines.push(cur.trim());
  return lines.slice(0, 10).map((ln, i) => `<text x="${x}" y="${y + i * (size + lh)}" font-family="${FONT2}" font-size="${size}" fill="${color}">${esc(ln)}</text>`).join('');
}

// ═════════════════════════════════════════════════════════════════════════════
// TEMPLATE LIBRARY — each: { id, name, category, hero(data) -> frameSpec }
// ═════════════════════════════════════════════════════════════════════════════
const TEMPLATES = [
  // 1 ── AGENT vs AGENT ──────────────────────────────────────────────────────
  {
    id: 'agent-vs-agent', name: 'Agent vs Agent', category: 'comparison',
    hero(d) {
      const a = byName(d.agents, 'Jett', 0), b = byName(d.agents, 'Sage', 1);
      const ca = hex(a.themeColors?.[0]), cb = hex(b.themeColors?.[0]);
      return {
        bg: bgGradient(ca, cb),
        images: [
          { path: a.images.portrait, x: -120, y: 560, w: 760, h: 1180, fit: 'inside' },
          { path: b.images.portrait, x: 560, y: 560, w: 760, h: 1180, fit: 'inside' },
        ],
        overlay: `${header('COMPARISON', 'WHO WINS?')}
        ${roleBadge(a.role || 'Agent', 70, 300)} ${roleBadge(b.role || 'Agent', W - 70 - (30 + (b.role || 'Agent').length * 20), 300)}
        <text x="270" y="1640" text-anchor="middle" font-family="${FONT}" font-size="78" fill="${WHITE}" font-weight="900">${esc(a.name.toUpperCase())}</text>
        <text x="810" y="1640" text-anchor="middle" font-family="${FONT}" font-size="78" fill="${WHITE}" font-weight="900">${esc(b.name.toUpperCase())}</text>
        <circle cx="${W / 2}" cy="980" r="86" fill="${RED}"/><circle cx="${W / 2}" cy="980" r="86" fill="none" stroke="#fff" stroke-width="5"/>
        <text x="${W / 2}" y="1012" text-anchor="middle" font-family="${FONT}" font-size="72" fill="#fff" font-weight="900">VS</text>
        ${footer()}`,
      };
    },
  },
  // 2 ── WEAPON vs WEAPON (data-driven, research-designed) ─────────────────────
  {
    id: 'weapon-vs-weapon', name: 'Weapon vs Weapon', category: 'comparison',
    hero(d) {
      const a = byName(d.weapons, 'Vandal', 0), b = byName(d.weapons, 'Phantom', 1);
      const rows = weaponRows(a, b);
      return compareFrame(a, b, rows, rows.length, null);
    },
  },
  // 3 ── AGENT TIER LIST ───────────────────────────────────────────────────────
  {
    id: 'agent-tier-list', name: 'Agent Tier List', category: 'ranking',
    hero(d) {
      const tiers = { S: ['Jett', 'Raze', 'Omen'], A: ['Sage', 'Sova', 'Killjoy'], B: ['Phoenix', 'Breach'], C: ['Yoru'] };
      const images = []; let svg = header('META', 'AGENT TIER LIST'); let y = 320;
      for (const [t, names] of Object.entries(tiers)) {
        svg += `<rect x="60" y="${y}" width="150" height="150" rx="16" fill="${tierColor(t)}"/>
        <text x="135" y="${y + 105}" text-anchor="middle" font-family="${FONT}" font-size="92" fill="#0F1923" font-weight="900">${t}</text>
        <rect x="230" y="${y}" width="${W - 290}" height="150" rx="16" fill="#000" opacity="0.30"/>`;
        names.forEach((nm, i) => {
          const ag = byName(d.agents, nm, i);
          images.push({ path: ag.images.icon, x: 250 + i * 165, y: y + 12, w: 126, h: 126, fit: 'cover' });
        });
        y += 175;
      }
      return { bg: bgGradient(DARK2, null), images, overlay: svg + footer() };
    },
  },
  // 4 ── WEAPON TIER LIST ──────────────────────────────────────────────────────
  {
    id: 'weapon-tier-list', name: 'Weapon Tier List', category: 'ranking',
    hero(d) {
      const tiers = { S: ['Vandal', 'Phantom', 'Operator'], A: ['Spectre', 'Sheriff'], B: ['Bulldog', 'Guardian'], C: ['Stinger'] };
      const images = []; let svg = header('LOADOUT', 'GUN TIER LIST'); let y = 320;
      for (const [t, names] of Object.entries(tiers)) {
        svg += `<rect x="60" y="${y}" width="150" height="150" rx="16" fill="${tierColor(t)}"/>
        <text x="135" y="${y + 105}" text-anchor="middle" font-family="${FONT}" font-size="92" fill="#0F1923" font-weight="900">${t}</text>
        <rect x="230" y="${y}" width="${W - 290}" height="150" rx="16" fill="#000" opacity="0.30"/>`;
        names.forEach((nm, i) => {
          const wp = byName(d.weapons, nm, i);
          images.push({ path: wp.images.icon, x: 245 + i * 200, y: y + 35, w: 185, h: 80, fit: 'inside' });
        });
        y += 175;
      }
      return { bg: bgGradient('#2a2218', null), images, overlay: svg + footer() };
    },
  },
  // 5 ── TOP 5 COUNTDOWN ───────────────────────────────────────────────────────
  {
    id: 'top5-duelists', name: 'Top 5 Countdown', category: 'ranking',
    hero(d) {
      const picks = ['Jett', 'Raze', 'Reyna', 'Phoenix', 'Yoru'].map((n, i) => byName(d.agents, n, i));
      const images = []; let svg = header('RANKED', 'TOP 5 DUELISTS'); let y = 360;
      picks.forEach((ag, i) => {
        const rank = i + 1;
        svg += `<rect x="60" y="${y}" width="${W - 120}" height="230" rx="20" fill="#000" opacity="${0.45 - i * 0.05}"/>
        <text x="120" y="${y + 165}" font-family="${FONT}" font-size="150" fill="${i === 0 ? RED : WHITE}" font-weight="900">${rank}</text>
        <text x="330" y="${y + 145}" font-family="${FONT}" font-size="64" fill="${WHITE}" font-weight="900">${esc(ag.name.toUpperCase())}</text>
        <text x="332" y="${y + 195}" font-family="${FONT2}" font-size="30" fill="${MUTED}" letter-spacing="2">${esc((ag.role || '').toUpperCase())}</text>`;
        images.push({ path: ag.images.icon, x: W - 280, y: y + 25, w: 180, h: 180, fit: 'cover' });
        y += 250;
      });
      return { bg: bgGradient('#241018', null), images, overlay: svg + footer() };
    },
  },
  // 6 ── THIS OR THAT ──────────────────────────────────────────────────────────
  {
    id: 'this-or-that', name: 'This or That', category: 'choice',
    hero(d) {
      const a = byName(d.weapons, 'Vandal', 0), b = byName(d.weapons, 'Phantom', 1);
      return {
        bg: bgGradient('#3a1820', '#16323a'),
        images: [
          { path: a.images.icon, x: 80, y: 700, w: 520, h: 220, fit: 'inside' },
          { path: b.images.icon, x: 500, y: 1180, w: 520, h: 220, fit: 'inside' },
        ],
        overlay: `${header('YOU PICK', 'WHICH DO\nYOU MAIN?')}
        <line x1="0" y1="${H / 2}" x2="${W}" y2="${H / 2}" stroke="${RED}" stroke-width="6"/>
        <text x="120" y="660" font-family="${FONT}" font-size="96" fill="${WHITE}" font-weight="900">${esc(a.name.toUpperCase())}</text>
        <text x="${W - 120}" y="1160" text-anchor="end" font-family="${FONT}" font-size="96" fill="${WHITE}" font-weight="900">${esc(b.name.toUpperCase())}</text>
        <circle cx="${W / 2}" cy="${H / 2}" r="74" fill="${RED}"/><text x="${W / 2}" y="${H / 2 + 24}" text-anchor="middle" font-family="${FONT}" font-size="56" fill="#fff" font-weight="900">OR</text>
        ${footer('comment your pick 👇')}`,
      };
    },
  },
  // 7 ── AGENT SPOTLIGHT (abilities) ───────────────────────────────────────────
  {
    id: 'agent-spotlight', name: 'Agent Spotlight', category: 'review',
    hero(d) {
      const a = byName(d.agents, 'Gekko', 0);
      const abils = (a.abilities || []).filter((x) => x.name).slice(0, 4);
      const images = [{ path: a.images.portrait, x: -160, y: 380, w: 760, h: 1200, fit: 'inside' }];
      let svg = header(a.role || 'AGENT', a.name.toUpperCase());
      let y = 720;
      abils.forEach((ab, i) => {
        if (a.images[`ability_${i}`]) images.push({ path: a.images[`ability_${i}`], x: 600, y: y - 6, w: 90, h: 90, fit: 'inside' });
        svg += `<rect x="580" y="${y - 20}" width="450" height="120" rx="16" fill="#000" opacity="0.4"/>
        <text x="710" y="${y + 36}" font-family="${FONT}" font-size="40" fill="${WHITE}" font-weight="900">${esc(ab.name.toUpperCase())}</text>
        <text x="710" y="${y + 78}" font-family="${FONT2}" font-size="24" fill="${MUTED}">${esc((ab.slot || '').toUpperCase())}</text>`;
        y += 150;
      });
      return { bg: bgGradient(hex(a.themeColors?.[0]), null), images, overlay: svg + footer() };
    },
  },
  // 8 ── WEAPON SPOTLIGHT (stat sheet) ─────────────────────────────────────────
  {
    id: 'weapon-spotlight', name: 'Weapon Spotlight', category: 'review',
    hero(d) {
      const w = byName(d.weapons, 'Operator', 0);
      const s = w.stats || {};
      let svg = header('GUN GUIDE', w.name.toUpperCase());
      svg += `<rect x="${W - 360}" y="120" width="300" height="92" rx="46" fill="${RED}"/>
      <text x="${W - 210}" y="182" text-anchor="middle" font-family="${FONT}" font-size="52" fill="#fff" font-weight="900">$${w.cost ?? '—'}</text>`;
      const rows = [
        ['HEAD DMG', s.damageRanges?.[0]?.head ?? '—', (s.damageRanges?.[0]?.head ?? 0) / 255],
        ['BODY DMG', s.damageRanges?.[0]?.body ?? '—', (s.damageRanges?.[0]?.body ?? 0) / 150],
        ['FIRE RATE', s.fireRate ?? '—', (s.fireRate ?? 0) / 13],
        ['MAGAZINE', s.magazineSize ?? '—', (s.magazineSize ?? 0) / 30],
        ['RELOAD', `${s.reloadTimeSeconds ?? '—'}s`, (s.reloadTimeSeconds ?? 0) / 6],
      ];
      let y = 1080; for (const [k, v, f] of rows) { svg += statRow(k, v, f, 60, y, W - 120, RED, String(v)); y += 150; }
      return {
        bg: bgGradient('#16323a', null),
        images: [{ path: w.images.icon, x: 60, y: 720, w: W - 120, h: 300, fit: 'inside' }],
        overlay: svg + footer(),
      };
    },
  },
  // 9 ── NEW AGENT / FIRST LOOK ────────────────────────────────────────────────
  {
    id: 'new-agent-review', name: 'New Agent — First Look', category: 'review',
    hero(d) {
      const a = d.agents[d.agents.length - 1]; // newest-ish
      const abils = (a.abilities || []).filter((x) => x.name).slice(0, 4).map((x) => x.name).join('  ·  ');
      return {
        bg: bgGradient(hex(a.themeColors?.[0]), null),
        images: [{ path: a.images.portrait, x: 60, y: 520, w: W - 120, h: 1150, fit: 'inside', center: true }],
        overlay: `${header('FIRST LOOK', a.name.toUpperCase())}
        <rect x="56" y="300" width="${W - 112}" height="90" rx="12" fill="#000" opacity="0.4"/>
        <text x="80" y="362" font-family="${FONT2}" font-size="36" fill="${WHITE}" font-weight="700">${esc((a.role || 'Agent').toUpperCase())} · NEW AGENT BREAKDOWN</text>
        <rect x="56" y="1700" width="${W - 112}" height="120" rx="16" fill="#000" opacity="0.5"/>
        <text x="${W / 2}" y="1770" text-anchor="middle" font-family="${FONT2}" font-size="34" fill="${WHITE}" font-weight="700">${esc(abils)}</text>
        ${footer()}`,
      };
    },
  },
  // 10 ── MAP GUIDE ────────────────────────────────────────────────────────────
  {
    id: 'map-guide', name: 'Map Guide', category: 'review',
    hero(d) {
      const m = byName(d.maps, 'Ascent', 0);
      return {
        bg: bgGradient(DARK2, null),
        images: [{ path: m.images.splash, x: 0, y: 0, w: W, h: 980, fit: 'cover' }],
        overlay: `<rect x="0" y="700" width="${W}" height="280" fill="${DARK}" opacity="0.65"/>
        ${header('MAP GUIDE', m.name.toUpperCase())}
        <rect x="60" y="1120" width="${W - 120}" height="640" rx="20" fill="#000" opacity="0.35"/>
        <text x="100" y="1230" font-family="${FONT}" font-size="56" fill="${RED}" font-weight="900">A SITE</text>
        <text x="100" y="1300" font-family="${FONT2}" font-size="32" fill="${WHITE}">Main · Generator · Tree</text>
        <text x="100" y="1430" font-family="${FONT}" font-size="56" fill="${RED}" font-weight="900">B SITE</text>
        <text x="100" y="1500" font-family="${FONT2}" font-size="32" fill="${WHITE}">Market · Lane · CT</text>
        <text x="100" y="1630" font-family="${FONT}" font-size="56" fill="${RED}" font-weight="900">MID</text>
        <text x="100" y="1700" font-family="${FONT2}" font-size="32" fill="${WHITE}">Catwalk · Cubby · Pizza</text>
        ${footer()}`,
      };
    },
  },
  // 11 ── DID YOU KNOW (lore / engagement) ─────────────────────────────────────
  {
    id: 'did-you-know', name: 'Did You Know', category: 'engagement',
    hero(d) {
      const a = byName(d.agents, 'Omen', 0);
      const fact = (a.description || 'A mysterious entity stalks the battlefield.').slice(0, 180);
      return {
        bg: bgGradient(hex(a.themeColors?.[0]), null),
        images: [{ path: a.images.icon, x: W - 300, y: 240, w: 220, h: 220, fit: 'cover' }],
        overlay: `${header('LORE', 'DID YOU\nKNOW?')}
        <rect x="60" y="760" width="${W - 120}" height="760" rx="24" fill="#000" opacity="0.45"/>
        <text x="110" y="880" font-family="${FONT}" font-size="56" fill="${RED}" font-weight="900">${esc(a.name.toUpperCase())}</text>
        ${wrapText(fact, 110, 970, 30, 30, WHITE, W - 220)}
        ${footer('follow for daily lore')}`,
      };
    },
  },
  // 12 ── BEST AGENT PER ROLE (grid) ───────────────────────────────────────────
  {
    id: 'role-best', name: 'Best Per Role', category: 'choice',
    hero(d) {
      const picks = [['DUELIST', 'Jett'], ['CONTROLLER', 'Omen'], ['INITIATOR', 'Sova'], ['SENTINEL', 'Killjoy']];
      const images = []; let svg = header('META', 'BEST PER ROLE');
      const gx = [60, 580], gy = [420, 1080]; const cw = 440, ch = 600;
      picks.forEach(([role, nm], i) => {
        const ag = byName(d.agents, nm, i);
        const x = gx[i % 2], y = gy[Math.floor(i / 2)];
        svg += `<rect x="${x}" y="${y}" width="${cw}" height="${ch}" rx="20" fill="#000" opacity="0.4"/>
        <rect x="${x}" y="${y + ch - 110}" width="${cw}" height="110" rx="0" fill="${RED}" opacity="0.9"/>
        <text x="${x + cw / 2}" y="${y + ch - 60}" text-anchor="middle" font-family="${FONT2}" font-size="30" fill="#fff" font-weight="800" letter-spacing="3">${esc(role)}</text>
        <text x="${x + cw / 2}" y="${y + ch - 22}" text-anchor="middle" font-family="${FONT}" font-size="46" fill="#fff" font-weight="900">${esc(ag.name.toUpperCase())}</text>`;
        images.push({ path: ag.images.portrait, x: x + 20, y: y - 40, w: cw - 40, h: ch - 60, fit: 'inside', center: true });
      });
      return { bg: bgGradient(DARK2, null), images, overlay: svg + footer() };
    },
  },
  // 13 ── GUESS THE AGENT (quiz) ───────────────────────────────────────────────
  {
    id: 'guess-the-agent', name: 'Guess the Agent', category: 'engagement',
    hero(d) {
      const a = byName(d.agents, 'Sova', 0);
      return {
        bg: bgGradient('#16323a', null),
        images: [{ path: a.images.ability_0 ?? a.images.icon, x: W / 2 - 260, y: 760, w: 520, h: 520, fit: 'inside' }],
        overlay: `${header('QUIZ', 'GUESS THE\nAGENT')}
        <text x="${W / 2}" y="700" text-anchor="middle" font-family="${FONT2}" font-size="38" fill="${MUTED}" letter-spacing="3">WHOSE ABILITY IS THIS?</text>
        <circle cx="${W / 2}" cy="1020" r="300" fill="none" stroke="${RED}" stroke-width="6" stroke-dasharray="20 18"/>
        <rect x="${W / 2 - 200}" y="1420" width="400" height="120" rx="60" fill="${RED}"/>
        <text x="${W / 2}" y="1498" text-anchor="middle" font-family="${FONT}" font-size="56" fill="#fff" font-weight="900">?</text>
        ${footer('answer in comments')}`,
      };
    },
  },
  // 14 ── FULL BUY LOADOUT ─────────────────────────────────────────────────────
  {
    id: 'loadout-buy', name: 'Buy Guide', category: 'guide',
    hero(d) {
      const set = [['RIFLE', 'Vandal'], ['SIDEARM', 'Sheriff'], ['SAVE', 'Spectre']];
      const images = []; let svg = header('ECONOMY', 'FULL BUY'); let y = 460; let total = 0;
      set.forEach(([slot, nm], i) => {
        const wp = byName(d.weapons, nm, i); total += wp.cost ?? 0;
        svg += `<rect x="60" y="${y}" width="${W - 120}" height="300" rx="20" fill="#000" opacity="0.4"/>
        <text x="100" y="${y + 70}" font-family="${FONT2}" font-size="32" fill="${MUTED}" letter-spacing="3" font-weight="700">${esc(slot)}</text>
        <text x="100" y="${y + 140}" font-family="${FONT}" font-size="64" fill="${WHITE}" font-weight="900">${esc(wp.name.toUpperCase())}</text>
        <text x="${W - 100}" y="${y + 140}" text-anchor="end" font-family="${FONT}" font-size="60" fill="${RED}" font-weight="900">$${wp.cost ?? '—'}</text>`;
        images.push({ path: wp.images.icon, x: 100, y: y + 170, w: 520, h: 110, fit: 'inside' });
        y += 340;
      });
      svg += `<text x="${W / 2}" y="1660" text-anchor="middle" font-family="${FONT}" font-size="58" fill="${WHITE}" font-weight="900">+ SHIELD = ~$${total + 1000} TOTAL</text>`;
      return { bg: bgGradient('#2a2218', null), images, overlay: svg + footer() };
    },
  },
];

// ═════════════════════════════════════════════════════════════════════════════
// STORYBOARDS — a template expanded into an ordered scene sequence (frames + VO).
// Each scene maps 1:1 onto PlannedScene + one placed photo asset, so the existing
// assemblePlannedProject builds a §18 Project (image clips + VO + captions) → MP4.
// ═════════════════════════════════════════════════════════════════════════════
const STORYBOARDS = {
  'weapon-vs-weapon': (d) => {
    const a = byName(d.weapons, 'Vandal', 0), b = byName(d.weapons, 'Phantom', 1);
    const rows = weaponRows(a, b);
    return {
      title: 'Vandal vs Phantom — Which Should You Buy?',
      voiceId: 'af_heart',
      scenes: [
        { frame: compareFrame(a, b, rows, 0, null), keywords: ['vandal', 'phantom'],
          smallCaption: 'Vandal or Phantom?',
          voiceoverText: 'Vandal or Phantom — the debate that never ends. Let the stats settle it.' },
        { frame: compareFrame(a, b, rows, 1, 0), keywords: ['damage'],
          smallCaption: 'Damage',
          voiceoverText: 'The Vandal one-taps. A hundred and sixty to the head at any range. The Phantom drops to a hundred and fifty-six past fifteen meters.' },
        { frame: compareFrame(a, b, rows, 2, 1), keywords: ['fire rate'],
          smallCaption: 'Fire rate',
          voiceoverText: 'But the Phantom fires faster. Eleven rounds a second against the Vandal nine point seven five. More bullets, more forgiveness.' },
        { frame: compareFrame(a, b, rows, 3, 2), keywords: ['magazine'],
          smallCaption: 'Magazine',
          voiceoverText: 'It also carries thirty in the mag against twenty-five, with a silencer that hides your tracers.' },
        { frame: compareFrame(a, b, rows, 4, 3), keywords: ['cost'],
          smallCaption: 'Same price',
          voiceoverText: 'And the price is identical. Twenty-nine hundred credits each. So it comes down to your style.' },
        { frame: { bg: bgGradient('#3a1820', '#16323a'),
            images: [{ path: a.images.icon, x: 80, y: 760, w: 520, h: 200, fit: 'inside' },
                     { path: b.images.icon, x: 500, y: 1080, w: 520, h: 200, fit: 'inside', flip: true }],
            overlay: `${header('VERDICT', 'WHICH DO\nYOU RUN?')}
            <text x="120" y="720" font-family="${FONT}" font-size="70" fill="${RED}" font-weight="900">${esc(a.name.toUpperCase())}</text>
            <text x="120" y="780" font-family="${FONT2}" font-size="34" fill="${MUTED}">one-tap consistency</text>
            <text x="${W - 120}" y="1060" text-anchor="end" font-family="${FONT}" font-size="70" fill="${TEAL}" font-weight="900">${esc(b.name.toUpperCase())}</text>
            <text x="${W - 120}" y="1120" text-anchor="end" font-family="${FONT2}" font-size="34" fill="${MUTED}">spray control + stealth</text>
            ${footer('comment your pick 👇 · follow @zentrix')}` },
          keywords: ['vandal', 'phantom'],
          smallCaption: 'Your pick?',
          voiceoverText: 'One-tap consistency, or spray control and stealth. Which one do you run? Tell me in the comments, and follow for more.' },
      ],
    };
  },

  'agent-spotlight': (d) => {
    const a = byName(d.agents, 'Gekko', 0);
    return {
      title: `${a.name} Agent Spotlight — Full Kit Breakdown`,
      voiceId: 'af_heart',
      scenes: [
        { frame: spotlightFrame(a, 0, null), keywords: ['gekko'], smallCaption: `Meet ${a.name}`,
          voiceoverText: `Meet ${a.name} — an initiator who flips fights with a squad of creatures. Here's his entire kit.` },
        { frame: spotlightFrame(a, 1, 0), keywords: ['wingman'], smallCaption: 'Wingman',
          voiceoverText: 'Wingman scouts ahead, and he can plant or defuse the spike for you. Then you walk over and pick him right back up.' },
        { frame: spotlightFrame(a, 2, 1), keywords: ['dizzy'], smallCaption: 'Dizzy',
          voiceoverText: 'Dizzy flies out and blinds every enemy in line of sight. That is your cue to swing the angle.' },
        { frame: spotlightFrame(a, 3, 2), keywords: ['mosh pit'], smallCaption: 'Mosh Pit',
          voiceoverText: 'Mosh Pit is a molly that blankets a whole site, perfect for clearing tight corners before you push.' },
        { frame: spotlightFrame(a, 4, 3), keywords: ['thrash'], smallCaption: 'Thrash',
          voiceoverText: 'And his ultimate, Thrash, lets you fly a creature into the enemy and detonate, pinning everyone it catches.' },
        { frame: spotlightFrame(a, 4, null), keywords: ['gekko'], smallCaption: 'Worth maining?',
          voiceoverText: 'Low skill floor, huge utility, and you reclaim your abilities every round. Gekko is one of the best agents for beginners. Would you main him?' },
      ],
    };
  },

  'top5-duelists': (d) => {
    const picks = ['Jett', 'Raze', 'Reyna', 'Phoenix', 'Yoru'].map((n, i) => byName(d.agents, n, i));
    const f = (n) => countdownFrame(picks, n);
    return {
      title: 'Top 5 Duelists in Valorant',
      voiceId: 'af_heart',
      scenes: [
        { frame: f(0), keywords: ['duelists'], smallCaption: 'Top 5 Duelists',
          voiceoverText: 'These are the top five duelists in Valorant right now. Number five might surprise you.' },
        { frame: f(1), keywords: ['yoru'], smallCaption: '#5 Yoru',
          voiceoverText: 'At number five, Yoru. High skill, high reward — his teleports punish anyone who is not watching.' },
        { frame: f(2), keywords: ['phoenix'], smallCaption: '#4 Phoenix',
          voiceoverText: 'Number four, Phoenix. Self-sufficient and flashy — he even heals himself with his own molly.' },
        { frame: f(3), keywords: ['reyna'], smallCaption: '#3 Reyna',
          voiceoverText: 'Number three, Reyna. Pure fragging power — get a kill and she becomes almost untouchable.' },
        { frame: f(4), keywords: ['raze'], smallCaption: '#2 Raze',
          voiceoverText: 'Number two, Raze. The most explosive entry in the game — nobody clears a corner faster.' },
        { frame: f(5), keywords: ['jett'], smallCaption: '#1 Jett',
          voiceoverText: 'And number one, Jett. Dash, updraft, and the deadliest knife ultimate in Valorant. The duelist standard. Do you agree?' },
      ],
    };
  },
};

async function renderStoryboard(id) {
  const data = JSON.parse(await readFile(join(PACK_DIR, 'manifest.json'), 'utf8'));
  const build = STORYBOARDS[id];
  if (!build) { console.error(`No storyboard "${id}". Available: ${Object.keys(STORYBOARDS).join(', ')}`); process.exit(1); }
  const sb = build(data);
  const dir = join(PACK_DIR, 'storyboards', id);
  await mkdir(dir, { recursive: true });

  const scenes = [];
  const thumbs = [];
  for (let i = 0; i < sb.scenes.length; i++) {
    const sc = sb.scenes[i];
    const buf = await renderFrame(sc.frame);
    const framePath = join(dir, `scene-${i}.png`);
    await writeFile(framePath, buf);
    thumbs.push({ name: `scene ${i}`, buf });
    scenes.push({
      sceneIndex: i,
      voiceoverText: sc.voiceoverText,
      smallCaption: sc.smallCaption,
      brollSuggestion: { mediaType: 'photo', keywords: sc.keywords, description: sc.smallCaption },
      framePath,
    });
    console.log(`✓ scene ${i}  "${sc.smallCaption}"  → ${framePath.replace(REPO + '/', '')}`);
  }
  // narration.json IS the ScenePlan + frame map the assembler/renderer consumes.
  const plan = { id, title: sb.title, voiceId: sb.voiceId, canvas: { width: W, height: H, frameRate: 30 }, scenes };
  await writeFile(join(dir, 'narration.json'), JSON.stringify(plan, null, 2));
  const sheet = await contactSheet(thumbs);
  await writeFile(join(dir, 'storyboard.png'), sheet);
  console.log(`\n✓ ${scenes.length} scenes + narration.json + storyboard.png → assets/valorant/storyboards/${id}/`);
}

// ── contact sheet of all hero frames ─────────────────────────────────────────
async function contactSheet(items) {
  const cols = 5, tw = 300, th = Math.round((tw * H) / W), pad = 20, labelH = 46;
  const rows = Math.ceil(items.length / cols);
  const sw = cols * tw + (cols + 1) * pad, sh = rows * (th + labelH) + (rows + 1) * pad;
  const layers = []; let labelSvg = '';
  for (let i = 0; i < items.length; i++) {
    const c = i % cols, r = Math.floor(i / cols);
    const x = pad + c * (tw + pad), yTop = pad + r * (th + labelH + pad);
    const thumb = await sharp(items[i].buf).resize(tw, th).png().toBuffer();
    layers.push({ input: thumb, left: x, top: yTop });
    labelSvg += `<text x="${x + tw / 2}" y="${yTop + th + 32}" text-anchor="middle" font-family="${FONT2}" font-size="22" fill="${WHITE}" font-weight="700">${esc(items[i].name)}</text>`;
  }
  layers.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${sw}" height="${sh}">${labelSvg}</svg>`), left: 0, top: 0 });
  return sharp({ create: { width: sw, height: sh, channels: 3, background: DARK } }).composite(layers).png().toBuffer();
}

// ── CLI ──────────────────────────────────────────────────────────────────────
async function main() {
  const arg = process.argv[2];
  if (arg === '--list') { TEMPLATES.forEach((t) => console.log(`${t.id}  [${t.category}]  ${t.name}`)); return; }
  if (arg === '--storyboard') { await renderStoryboard(process.argv[3] ?? 'weapon-vs-weapon'); return; }
  const data = JSON.parse(await readFile(join(PACK_DIR, 'manifest.json'), 'utf8'));
  await mkdir(OUT_DIR, { recursive: true });

  const chosen = arg && !arg.startsWith('-') ? TEMPLATES.filter((t) => t.id === arg) : TEMPLATES;
  if (chosen.length === 0) { console.error(`Unknown template "${arg}". Try --list.`); process.exit(1); }

  const rendered = [];
  for (const t of chosen) {
    try {
      const buf = await renderFrame(t.hero(data));
      const file = join(OUT_DIR, `${t.id}.png`);
      await writeFile(file, buf);
      rendered.push({ name: t.name, buf });
      console.log(`✓ ${t.id.padEnd(20)} ${t.category.padEnd(11)} → previews/${t.id}.png`);
    } catch (e) { console.error(`✗ ${t.id}: ${e.message}`); }
  }
  if (rendered.length > 1) {
    const sheet = await contactSheet(rendered);
    await writeFile(join(OUT_DIR, 'contact-sheet.png'), sheet);
    console.log(`\n✓ contact sheet → previews/contact-sheet.png (${rendered.length} templates)`);
  }
}
main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
