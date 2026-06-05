/* ============================================================
   VideoForge — Left Media Panel + Right Inspector
   ============================================================ */
const MEDIA_ASSETS = [
  { id: 'm1', name: 'intro.mp4',   type: 'video', dur: '0:13', size: '38 MB', src: 'intro',   state: 'ready' },
  { id: 'm2', name: 'b-roll.mp4',  type: 'video', dur: '0:15', size: '52 MB', src: 'broll',   state: 'ready' },
  { id: 'm3', name: 'closing.mp4', type: 'video', dur: '0:14', size: '41 MB', src: 'closing', state: 'ready' },
  { id: 'm4', name: 'music.mp3',   type: 'audio', dur: '1:30', size: '3.2 MB', seed: 7,       state: 'ready' },
  { id: 'm5', name: 'logo.png',    type: 'image', size: '120 KB', src: 'logo',                 state: 'ready' },
  { id: 'm6', name: 'sponsor.mp4', type: 'video', dur: '0:08', size: '24 MB', src: 'intro',   state: 'processing' },
  { id: 'm7', name: 'vo-take2.wav',type: 'audio', dur: '0:22', size: '8.1 MB', seed: 33,      state: 'uploading', pct: 62 },
];

function AssetCard({ a }) {
  const grad = SCENE_GRADS[a.src] || ['#2a3142', '#1d2330', '#333c52'];
  return (
    <div className={'vf-asset vf-asset-' + a.state} role="listitem" tabIndex={0}
      title={a.state === 'ready' ? 'Drag to timeline' : a.state}>
      <div className="vf-asset-thumb">
        {a.type === 'audio' ? (
          <div className="vf-asset-aud">{I.music({ size: 20 })}<Waveform seed={a.seed || 5} w={120} h={28} sel /></div>
        ) : (
          <div className="vf-asset-img" style={{ background: `linear-gradient(120deg, ${grad[0]}, ${grad[2]})` }}>
            {a.type === 'image' ? I.image({ size: 22 }) : I.film({ size: 22 })}
          </div>
        )}
        {a.dur && a.state === 'ready' && <span className="vf-asset-dur mono">{a.dur}</span>}
        {a.state === 'uploading' && (
          <div className="vf-asset-overlay">
            <svg width="34" height="34" viewBox="0 0 34 34" className="vf-ring">
              <circle cx="17" cy="17" r="14" fill="none" stroke="var(--vf-surface-4)" strokeWidth="3" />
              <circle cx="17" cy="17" r="14" fill="none" stroke="var(--vf-accent)" strokeWidth="3"
                strokeDasharray={2 * Math.PI * 14} strokeDashoffset={2 * Math.PI * 14 * (1 - a.pct / 100)}
                strokeLinecap="round" transform="rotate(-90 17 17)" />
            </svg>
            <span className="vf-asset-pct">{a.pct}%</span>
          </div>
        )}
        {a.state === 'processing' && <div className="vf-asset-overlay"><div className="vf-shimmer" /><span className="vf-asset-proc">Processing…</span></div>}
      </div>
      <div className="vf-asset-meta">
        <span className="vf-asset-name">{a.name}</span>
        <span className="vf-asset-sub">{[a.type.toUpperCase(), a.size].filter(Boolean).join(' · ')}</span>
      </div>
    </div>
  );
}

function LeftPanel() {
  const ed = useEditor();
  const { leftTab, leftCollapsed } = ed;
  const tabs = [
    { id: 'media', label: 'Media', icon: I.film },
    { id: 'text', label: 'Text', icon: I.type },
    { id: 'captions', label: 'Captions', icon: I.captions },
  ];
  if (leftCollapsed) {
    return (
      <div className="vf-left vf-left-rail" role="complementary" aria-label="Media library">
        <button className="vf-iconbtn vf-tip" data-tip="Expand (Ctrl+Shift+H)" onClick={ed.toggleLeft} aria-label="Expand panel">{I.layers({ size: 18 })}</button>
        {tabs.map((t) => (
          <button key={t.id} className={'vf-iconbtn' + (leftTab === t.id ? ' is-active' : '')}
            onClick={() => { ed.setLeftTab(t.id); ed.toggleLeft(); }} aria-label={t.label}>{t.icon({ size: 18 })}</button>
        ))}
      </div>
    );
  }
  return (
    <div className="vf-left" role="complementary" aria-label="Media library" style={{ width: ed.leftWidth }}>
      <div className="vf-left-tabs" role="tablist" aria-label="Media library">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={leftTab === t.id}
            className={'vf-left-tab' + (leftTab === t.id ? ' is-active' : '')} onClick={() => ed.setLeftTab(t.id)}>
            {t.icon({ size: 15 })}<span>{t.label}</span>
          </button>
        ))}
        <button className="vf-iconbtn vf-left-collapse vf-tip" data-tip="Collapse (Ctrl+Shift+H)" onClick={ed.toggleLeft} aria-label="Collapse panel">{I.x({ size: 16 })}</button>
      </div>

      <div className="vf-left-body" role="tabpanel">
        {leftTab === 'media' && (
          <>
            <button className="vf-btn vf-btn-ghost vf-upload">{I.upload({ size: 16 })} Upload media</button>
            <div className="vf-asset-grid" role="list" aria-label="Assets">
              {MEDIA_ASSETS.map((a) => <AssetCard key={a.id} a={a} />)}
            </div>
            <p className="vf-left-hint">Drag any clip onto the timeline — it snaps to the playhead.</p>
          </>
        )}
        {leftTab === 'text' && (
          <div className="vf-text-list">
            <button className="vf-btn vf-btn-ghost vf-upload">{I.plus({ size: 16 })} Add text</button>
            {[['Title', 32, 800], ['Subtitle', 22, 600], ['Body', 16, 500], ['Caption style', 14, 600]].map(([n, sz, w]) => (
              <button key={n} className="vf-text-preset">
                <span style={{ fontSize: Math.min(sz, 22), fontWeight: w }}>{n}</span>
                <span className="vf-text-preset-meta">{sz}px</span>
              </button>
            ))}
          </div>
        )}
        {leftTab === 'captions' && (
          <div className="vf-cap-actions">
            <button className="vf-btn vf-btn-ghost vf-upload">{I.upload({ size: 16 })} Import .srt / .vtt</button>
            <button className="vf-btn vf-btn-primary" onClick={() => ed.setCaptionMode(true)}>{I.captions({ size: 16 })} Open caption editor</button>
            <p className="vf-left-hint">Captions render from the caption track. The editor lets you fix timing and text before export.</p>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- Right inspector ---------- */
function PropRow({ label, children }) {
  return <div className="vf-prop"><span className="vf-prop-label">{label}</span><div className="vf-prop-ctl">{children}</div></div>;
}
function NumField({ value, suffix }) {
  return <span className="vf-numfield mono">{value}<i>{suffix}</i></span>;
}
function Slider({ value, min = 0, max = 100 }) {
  return <input type="range" className="vf-pslider" min={min} max={max} defaultValue={value} aria-label="property" />;
}

function Inspector({ clip }) {
  const ed = useEditor();
  const isVideo = clip.type === 'video', isAudio = clip.type === 'audio', isOverlay = clip.type === 'overlay';
  const c = trackColors(clip.type);
  return (
    <div className="vf-insp" role="complementary" aria-label="Inspector" style={{ width: ed.rightWidth }}>
      <div className="vf-insp-head">
        <span className="vf-insp-type" style={{ color: c.accent }}>{TRACK_ICON[clip.type]({ size: 15 })}{clip.type}</span>
        <button className="vf-iconbtn" onClick={() => ed.select(null)} aria-label="Close inspector">{I.x({ size: 16 })}</button>
      </div>
      <div className="vf-insp-title">{clip.name}</div>

      <div className="vf-insp-body">
        <section className="vf-insp-sec">
          <h4>Clip</h4>
          <PropRow label="Start"><NumField value={fmtTC(clip.start, ed.project.fps)} /></PropRow>
          <PropRow label="Duration"><NumField value={clip.dur.toFixed(1)} suffix="s" /></PropRow>
          {(isVideo) && <PropRow label="Speed"><NumField value={(clip.speed || 1).toFixed(2)} suffix="×" /></PropRow>}
        </section>

        {(isVideo || isOverlay) && (
          <section className="vf-insp-sec">
            <h4>Transform</h4>
            <PropRow label="Opacity"><Slider value={100} /><NumField value="100" suffix="%" /></PropRow>
            <PropRow label="Position X"><Slider value={50} /><NumField value="50" suffix="%" /></PropRow>
            <PropRow label="Position Y"><Slider value={50} /><NumField value="50" suffix="%" /></PropRow>
            <PropRow label="Scale"><Slider value={100} max={200} /><NumField value="100" suffix="%" /></PropRow>
            <div className="vf-kf-row"><button className="vf-kf-btn">{I.diamond({ size: 13 })} Add keyframe</button><span className="vf-kf-hint">Linear · Ease</span></div>
          </section>
        )}

        {isVideo && (
          <section className="vf-insp-sec">
            <h4>Color grade</h4>
            <PropRow label="Brightness"><Slider value={50} /></PropRow>
            <PropRow label="Contrast"><Slider value={50} /></PropRow>
            <PropRow label="Saturation"><Slider value={50} /></PropRow>
          </section>
        )}

        {isAudio && (
          <section className="vf-insp-sec">
            <h4>Audio</h4>
            <PropRow label="Volume"><Slider value={80} max={200} /><NumField value="80" suffix="%" /></PropRow>
            <PropRow label="Pan"><Slider value={50} /></PropRow>
            <PropRow label="Fade in"><NumField value="0.5" suffix="s" /></PropRow>
            <PropRow label="Fade out"><NumField value="1.0" suffix="s" /></PropRow>
          </section>
        )}

        {isOverlay && clip.kind === 'text' && (
          <section className="vf-insp-sec">
            <h4>Text</h4>
            <input className="vf-input" defaultValue={clip.text} aria-label="Text content" />
            <PropRow label="Size"><Slider value={60} /><NumField value="72" suffix="px" /></PropRow>
            <div className="vf-swatches">
              {['#F4F6FB', '#FF7A1A', '#FFC24D', '#2BC4B0', '#3B9EFF'].map((s) => <span key={s} className="vf-sw" style={{ background: s }} />)}
            </div>
          </section>
        )}

        {clip.linked && (
          <div className="vf-callout vf-callout-info vf-insp-link">{I.link({ size: 16 })}<span>Audio-linked. Trims and splits apply to both clips so audio never drifts.</span></div>
        )}
      </div>
    </div>
  );
}

function CaptionEditor() {
  const ed = useEditor();
  const caps = ed.clips.filter((c) => c.type === 'caption');
  return (
    <div className="vf-insp" role="complementary" aria-label="Caption editor" style={{ width: ed.rightWidth }}>
      <div className="vf-insp-head">
        <span className="vf-insp-type" style={{ color: 'var(--vf-track-caption)' }}>{I.captions({ size: 15 })}Caption editor</span>
        <button className="vf-iconbtn" onClick={() => ed.setCaptionMode(false)} aria-label="Close caption editor">{I.x({ size: 16 })}</button>
      </div>
      <div className="vf-cap-table">
        <div className="vf-cap-row vf-cap-head"><span>Start</span><span>End</span><span>Text</span></div>
        {caps.map((c) => (
          <button key={c.id} className={'vf-cap-row' + (c.id === ed.selectedId ? ' is-sel' : '')} onClick={() => ed.select(c.id)}>
            <span className="mono">{fmtClock(c.start)}</span>
            <span className="mono">{fmtClock(c.start + c.dur)}</span>
            <span className="vf-cap-text">{c.name}</span>
          </button>
        ))}
      </div>
      <div className="vf-cap-foot"><button className="vf-btn vf-btn-ghost">{I.plus({ size: 15 })} Add caption</button></div>
    </div>
  );
}

function RightPanel() {
  const ed = useEditor();
  const sel = ed.clips.find((c) => c.id === ed.selectedId);
  if (ed.captionMode) return <CaptionEditor />;
  if (sel) return <Inspector clip={sel} />;
  return null;
}

Object.assign(window, { LeftPanel, RightPanel, MEDIA_ASSETS });
