/* ============================================================
   VideoForge — demo project data + helpers
   ============================================================ */
const FPS = 30;
const DURATION = 42; // seconds

// timecode HH:MM:SS:FF
function fmtTC(sec, fps = FPS) {
  sec = Math.max(0, sec);
  const f = Math.round((sec % 1) * fps);
  const s = Math.floor(sec) % 60;
  const m = Math.floor(sec / 60) % 60;
  const h = Math.floor(sec / 3600);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(h)}:${p(m)}:${p(s)}:${p(Math.min(f, fps - 1))}`;
}
function fmtClock(sec) {
  sec = Math.max(0, Math.round(sec));
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// deterministic pseudo-random
function rng(seed) {
  let s = seed % 2147483647; if (s <= 0) s += 2147483646;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

// waveform peak path generator -> SVG path string in a 0..1 x 0..1 box
function wavePath(seed, samples, width, height) {
  const r = rng(seed);
  const mid = height / 2;
  const top = [], bot = [];
  for (let i = 0; i < samples; i++) {
    const x = (i / (samples - 1)) * width;
    const env = 0.35 + 0.65 * Math.abs(Math.sin(i * 0.12 + seed));
    const a = (0.15 + r() * 0.85) * env * (height * 0.46);
    top.push([x, mid - a]); bot.push([x, mid + a]);
  }
  let d = `M ${top[0][0]} ${top[0][1]}`;
  top.forEach(([x, y]) => (d += ` L ${x} ${y}`));
  bot.reverse().forEach(([x, y]) => (d += ` L ${x} ${y}`));
  return d + ' Z';
}

// gradient stops for placeholder video "thumbnails" by source
const SCENE_GRADS = {
  intro: ['#2a3a5e', '#1d2a44', '#33507a'],
  broll: ['#3a4a2e', '#26331f', '#4a5c38'],
  closing: ['#4a2e3e', '#331f2a', '#5c3848'],
  logo: ['#2e3a4a', '#1f2733', '#384a5c'],
};

const SRC_COLOR = {
  intro: 'var(--vf-src-0)',
  broll: 'var(--vf-src-2)',
  closing: 'var(--vf-src-3)',
};

// Tracks ordered top->bottom: Overlay -> Video -> Audio -> Caption
const TRACKS = [
  { id: 'OV',  type: 'overlay', name: 'Overlay 1', short: 'OV', h: 48 },
  { id: 'V1',  type: 'video',   name: 'intro.mp4', short: 'V1', h: 64 },
  { id: 'A1',  type: 'audio',   name: 'music.mp3', short: 'A1', h: 48, pan: 0 },
  { id: 'A2',  type: 'audio',   name: 'intro (aud)', short: 'A2', h: 48, pan: 0 },
  { id: 'CC',  type: 'caption', name: 'English',  short: 'CC', h: 36 },
];

// Clips
const CLIPS = [
  // overlay
  { id: 'c-title', track: 'OV', type: 'overlay', name: 'Summer Sale', start: 2,  dur: 6.5, text: 'Summer Sale', kind: 'text' },
  { id: 'c-logo',  track: 'OV', type: 'overlay', name: 'Logo',       start: 30, dur: 8,   text: 'VF', kind: 'logo' },
  // video
  { id: 'c-intro',   track: 'V1', type: 'video', name: 'intro.mp4',   src: 'intro',   start: 0,  dur: 13, speed: 1,   linked: 'c-introA' },
  { id: 'c-broll',   track: 'V1', type: 'video', name: 'b-roll.mp4',  src: 'broll',   start: 13, dur: 15, speed: 1.5 },
  { id: 'c-closing', track: 'V1', type: 'video', name: 'closing.mp4', src: 'closing', start: 28, dur: 14, speed: 1 },
  // audio — music
  { id: 'c-music', track: 'A1', type: 'audio', name: 'music.mp3', start: 0, dur: 42, seed: 7 },
  // audio — linked intro audio
  { id: 'c-introA', track: 'A2', type: 'audio', name: 'intro (aud)', start: 0, dur: 13, seed: 21, linked: 'c-intro' },
  // captions
  { id: 'cap-1', track: 'CC', type: 'caption', name: "This summer, everything changes.", start: 1.5, dur: 3.5 },
  { id: 'cap-2', track: 'CC', type: 'caption', name: "Up to 50% off the whole range.",   start: 5.5, dur: 3.5 },
  { id: 'cap-3', track: 'CC', type: 'caption', name: "Shot, cut and shipped in minutes.", start: 14,  dur: 4 },
  { id: 'cap-4', track: 'CC', type: 'caption', name: "Tap the link to start today.",      start: 31,  dur: 4 },
];

const DEMO_PROJECT = {
  id: 'p-summer', name: 'Summer promo', ratio: '16:9', w: 1920, h: 1080,
  fps: FPS, duration: DURATION, bg: '#111111',
};

// dashboard projects
const DASH_PROJECTS = [
  { id: 'p-summer',  name: 'Summer promo',     ratio: '16:9', updated: '2h ago',     exact: 'Today 14:20', grad: SCENE_GRADS.broll },
  { id: 'p-q3reel',  name: 'Q3 launch reel',   ratio: '9:16', updated: '1d ago',     exact: 'Yesterday',   grad: SCENE_GRADS.closing },
  { id: 'p-logo',    name: 'Logo sting',       ratio: '1:1',  updated: '3d ago',     exact: 'Mon 09:10',   grad: SCENE_GRADS.logo },
  { id: 'p-podcast', name: 'Podcast clip 04',  ratio: '4:5',  updated: '5d ago',     exact: 'Sat 18:44',   grad: SCENE_GRADS.intro },
  { id: 'p-demo',    name: 'Product demo cut', ratio: '16:9', updated: 'last week',  exact: 'Apr 22',      grad: SCENE_GRADS.broll },
];

const RATIOS = [
  { id: '9:16',  w: 1080, h: 1920, label: 'Vertical',   hint: 'TikTok · Reels · Shorts' },
  { id: '16:9',  w: 1920, h: 1080, label: 'Horizontal', hint: 'YouTube · desktop' },
  { id: '1:1',   w: 1080, h: 1080, label: 'Square',     hint: 'Instagram feed' },
  { id: '4:5',   w: 1080, h: 1350, label: 'Portrait',   hint: 'Instagram portrait' },
];

Object.assign(window, {
  FPS, DURATION, fmtTC, fmtClock, rng, wavePath,
  SCENE_GRADS, SRC_COLOR, TRACKS, CLIPS, DEMO_PROJECT, DASH_PROJECTS, RATIOS,
});
