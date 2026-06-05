/* ============================================================
   VideoForge — icon set (Lucide-style, stroke 1.5 @24)
   + the "forge" brand mark.
   ============================================================ */
const Ic = ({ d, size = 20, fill, children, stroke = 1.5, ...rest }) => (
  React.createElement('svg', {
    width: size, height: size, viewBox: '0 0 24 24', fill: fill || 'none',
    stroke: fill ? 'none' : 'currentColor', strokeWidth: stroke,
    strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, ...rest
  }, children || (d ? React.createElement('path', { d }) : null))
);

// each icon: ({size}) => svg
const I = {
  play: (p) => <Ic {...p} fill="currentColor"><path d="M7 5.5v13l11-6.5z" /></Ic>,
  pause: (p) => <Ic {...p} fill="currentColor"><rect x="6.5" y="5.5" width="3.6" height="13" rx="0.8" /><rect x="13.9" y="5.5" width="3.6" height="13" rx="0.8" /></Ic>,
  skipStart: (p) => <Ic {...p}><path d="M7 6v12" /><path d="M18 6L9 12l9 6z" fill="currentColor" stroke="none" /></Ic>,
  skipEnd: (p) => <Ic {...p}><path d="M17 6v12" /><path d="M6 6l9 6-9 6z" fill="currentColor" stroke="none" /></Ic>,
  stepBack: (p) => <Ic {...p}><path d="M9 6v12" /><path d="M18 7l-7 5 7 5z" /></Ic>,
  stepFwd: (p) => <Ic {...p}><path d="M15 6v12" /><path d="M6 7l7 5-7 5z" /></Ic>,
  scissors: (p) => <Ic {...p}><circle cx="6" cy="6" r="2.4" /><circle cx="6" cy="18" r="2.4" /><path d="M7.9 7.5L20 18M20 6L7.9 16.5" /></Ic>,
  link: (p) => <Ic {...p}><path d="M9 12h6" /><path d="M10.5 8.5H8a3.5 3.5 0 100 7h2.5M13.5 8.5H16a3.5 3.5 0 110 7h-2.5" /></Ic>,
  volume: (p) => <Ic {...p}><path d="M4 9v6h3l4 3.5V5.5L7 9z" /><path d="M15.5 9.5a3 3 0 010 5M18 7a6.5 6.5 0 010 10" /></Ic>,
  volumeX: (p) => <Ic {...p}><path d="M4 9v6h3l4 3.5V5.5L7 9z" /><path d="M16 9.5l4 5M20 9.5l-4 5" /></Ic>,
  captions: (p) => <Ic {...p}><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="M7.5 11.2a1.8 1.8 0 100 1.6M14.5 11.2a1.8 1.8 0 100 1.6" /></Ic>,
  type: (p) => <Ic {...p}><path d="M5 7V5.5h14V7M12 5.5V18M9.5 18h5" /></Ic>,
  film: (p) => <Ic {...p}><rect x="3" y="4.5" width="18" height="15" rx="2" /><path d="M3 9h18M3 15h18M8 4.5v15M16 4.5v15" /></Ic>,
  image: (p) => <Ic {...p}><rect x="3.5" y="4.5" width="17" height="15" rx="2" /><circle cx="8.5" cy="9.5" r="1.6" /><path d="M20 15l-5-4.5L5 19" /></Ic>,
  music: (p) => <Ic {...p}><path d="M9 17V5l10-2v12" /><circle cx="6.5" cy="17" r="2.5" /><circle cx="16.5" cy="15" r="2.5" /></Ic>,
  layers: (p) => <Ic {...p}><path d="M12 3l9 5-9 5-9-5z" /><path d="M3 13l9 5 9-5" /></Ic>,
  upload: (p) => <Ic {...p}><path d="M12 16V5M8 9l4-4 4 4" /><path d="M5 16v2.5A1.5 1.5 0 006.5 20h11a1.5 1.5 0 001.5-1.5V16" /></Ic>,
  undo: (p) => <Ic {...p}><path d="M9 7L5 11l4 4" /><path d="M5 11h9a5 5 0 010 10h-3" /></Ic>,
  redo: (p) => <Ic {...p}><path d="M15 7l4 4-4 4" /><path d="M19 11h-9a5 5 0 000 10h3" /></Ic>,
  bell: (p) => <Ic {...p}><path d="M6 9a6 6 0 0112 0c0 5 2 6 2 6H4s2-1 2-6Z" /><path d="M10 19a2 2 0 004 0" /></Ic>,
  check: (p) => <Ic {...p}><path d="M5 12.5l4.5 4.5L19 7" /></Ic>,
  checkCircle: (p) => <Ic {...p}><circle cx="12" cy="12" r="9" /><path d="M8 12.2l2.6 2.6L16 9" /></Ic>,
  x: (p) => <Ic {...p}><path d="M6 6l12 12M18 6L6 18" /></Ic>,
  plus: (p) => <Ic {...p}><path d="M12 5v14M5 12h14" /></Ic>,
  minus: (p) => <Ic {...p}><path d="M5 12h14" /></Ic>,
  chevronDown: (p) => <Ic {...p}><path d="M6 9l6 6 6-6" /></Ic>,
  kebab: (p) => <Ic {...p}><circle cx="12" cy="5.5" r="1.4" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" /><circle cx="12" cy="18.5" r="1.4" fill="currentColor" stroke="none" /></Ic>,
  grip: (p) => <Ic {...p}><circle cx="9" cy="6" r="1.2" fill="currentColor" stroke="none" /><circle cx="15" cy="6" r="1.2" fill="currentColor" stroke="none" /><circle cx="9" cy="12" r="1.2" fill="currentColor" stroke="none" /><circle cx="15" cy="12" r="1.2" fill="currentColor" stroke="none" /><circle cx="9" cy="18" r="1.2" fill="currentColor" stroke="none" /><circle cx="15" cy="18" r="1.2" fill="currentColor" stroke="none" /></Ic>,
  mute: (p) => <Ic {...p}><path d="M4 9v6h3l4 3.5V5.5L7 9z" /><path d="M16 9.5l4 5M20 9.5l-4 5" /></Ic>,
  solo: (p) => <Ic {...p}><path d="M16 3a4 4 0 00-4 4v6" /><circle cx="8.5" cy="16.5" r="2.5" /><path d="M16 3h2.5" /></Ic>,
  lock: (p) => <Ic {...p}><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 018 0v3" /></Ic>,
  unlock: (p) => <Ic {...p}><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 017.5-2" /></Ic>,
  edit: (p) => <Ic {...p}><path d="M14 5l5 5M4 20l1-4L16 5l3 3L8 19z" /></Ic>,
  copy: (p) => <Ic {...p}><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2" /></Ic>,
  trash: (p) => <Ic {...p}><path d="M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2M6 7l1 13a1 1 0 001 1h8a1 1 0 001-1l1-13" /></Ic>,
  fit: (p) => <Ic {...p}><path d="M4 9V5h4M16 5h4v4M20 15v4h-4M8 19H4v-4" /></Ic>,
  fullscreen: (p) => <Ic {...p}><path d="M4 9V5a1 1 0 011-1h4M15 4h4a1 1 0 011 1v4M20 15v4a1 1 0 01-1 1h-4M9 20H5a1 1 0 01-1-1v-4" /></Ic>,
  loop: (p) => <Ic {...p}><path d="M4 11V9a3 3 0 013-3h10l-2.5-2.5M20 13v2a3 3 0 01-3 3H7l2.5 2.5" /></Ic>,
  safe: (p) => <Ic {...p}><rect x="3.5" y="5" width="17" height="14" rx="1.5" strokeDasharray="3 2.5" /><rect x="7" y="8" width="10" height="8" rx="1" strokeDasharray="3 2.5" opacity="0.6" /></Ic>,
  zap: (p) => <Ic {...p}><path d="M13 3L5 13h6l-1 8 8-10h-6z" /></Ic>,
  info: (p) => <Ic {...p}><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></Ic>,
  alert: (p) => <Ic {...p}><path d="M12 4l9 16H3z" /><path d="M12 10v4M12 17h.01" /></Ic>,
  save: (p) => <Ic {...p}><path d="M5 5h11l3 3v11a1 1 0 01-1 1H5a1 1 0 01-1-1V6a1 1 0 011-1Z" /><path d="M8 5v4h6V5M8 19v-5h8v5" /></Ic>,
  download: (p) => <Ic {...p}><path d="M12 4v11M8 11l4 4 4-4" /><path d="M5 19h14" /></Ic>,
  search: (p) => <Ic {...p}><circle cx="11" cy="11" r="6" /><path d="M16 16l4 4" /></Ic>,
  google: (p) => (
    <svg width={p?.size || 18} height={p?.size || 18} viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M21.6 12.2c0-.64-.06-1.25-.16-1.84H12v3.48h5.4a4.62 4.62 0 01-2 3.03v2.52h3.23c1.89-1.74 2.97-4.3 2.97-7.19Z" />
      <path fill="#34A853" d="M12 22c2.7 0 4.96-.9 6.62-2.43l-3.23-2.5c-.9.6-2.05.95-3.39.95-2.6 0-4.8-1.76-5.59-4.12H3.07v2.6A10 10 0 0012 22Z" />
      <path fill="#FBBC05" d="M6.41 13.9a6 6 0 010-3.8V7.5H3.07a10 10 0 000 9l3.34-2.6Z" />
      <path fill="#EA4335" d="M12 5.98c1.47 0 2.78.5 3.82 1.5l2.85-2.85C16.95 2.99 14.7 2 12 2A10 10 0 003.07 7.5l3.34 2.6C7.2 7.74 9.4 5.98 12 5.98Z" />
    </svg>
  ),
  eye: (p) => <Ic {...p}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></Ic>,
  diamond: (p) => <Ic {...p} fill="currentColor"><path d="M12 4l5 8-5 8-5-8z" /></Ic>,
  retry: (p) => <Ic {...p}><path d="M4 11a8 8 0 0114-5l2 2M20 6V4M4 13a8 8 0 0014 5l-2 2M4 18v2" /></Ic>,
};

/* Forge mark — angular anvil base + forward play chevron, molten gradient. */
const ForgeMark = ({ size = 28, gradient = true }) => {
  const gid = React.useMemo(() => 'fg' + Math.random().toString(36).slice(2, 7), []);
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FF7A1A" />
          <stop offset="1" stopColor="#FFC24D" />
        </linearGradient>
      </defs>
      {/* anvil base */}
      <path d="M5 23h22l-2.5 4.5h-17z" fill={gradient ? `url(#${gid})` : 'currentColor'} opacity="0.55" />
      {/* forge body: angular wedge holding a play-cut chevron */}
      <path d="M6 5h13l7 7-7 7H6z" fill={gradient ? `url(#${gid})` : 'currentColor'} />
      {/* the cut / play */}
      <path d="M12.5 9.5L19 13.5l-6.5 4z" fill="#0B0E14" opacity="0.92" />
    </svg>
  );
};

const Wordmark = ({ size = 17 }) => (
  <span style={{
    fontFamily: 'var(--vf-font-display)', fontWeight: 800, fontSize: size,
    letterSpacing: '-0.02em', color: 'var(--vf-text-primary)', whiteSpace: 'nowrap'
  }}>
    Video<span style={{ color: 'var(--vf-accent)' }}>Forge</span>
  </span>
);

const Logo = ({ markSize = 26, wordSize = 17, gap = 9 }) => (
  <span style={{ display: 'inline-flex', alignItems: 'center', gap }}>
    <ForgeMark size={markSize} /><Wordmark size={wordSize} />
  </span>
);

Object.assign(window, { I, Ic, ForgeMark, Wordmark, Logo });
