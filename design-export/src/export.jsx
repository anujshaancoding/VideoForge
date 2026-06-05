/* ============================================================
   VideoForge — Export Modal (settings → progress → done)
   ============================================================ */
function ExportModal({ project, onClose, onComplete }) {
  const [tab, setTab] = React.useState('format');
  const [preset, setPreset] = React.useState(project.ratio === '9:16' ? '9:16' : project.ratio === '16:9' ? '16:9' : 'custom');
  const [res, setRes] = React.useState('1080p');
  const [fps, setFps] = React.useState('30');
  const [caption, setCaption] = React.useState('burned');
  const [sidecar, setSidecar] = React.useState('.srt');
  const [phase, setPhase] = React.useState('settings'); // settings | progress | done
  const [pct, setPct] = React.useState(0);
  const [status, setStatus] = React.useState('Queued…');

  const estSize = res === '1080p' ? 24 : 11;
  const estTime = res === '1080p' ? 35 : 18;

  React.useEffect(() => {
    if (phase !== 'progress') return;
    let p = 0;
    const steps = [[8, 'Queued…'], [30, 'Rendering…'], [72, 'Rendering…'], [92, 'Finishing up…'], [100, 'Done']];
    const t = setInterval(() => {
      p = Math.min(100, p + Math.random() * 9 + 3);
      setPct(Math.round(p));
      const st = steps.find((s) => p <= s[0]); if (st) setStatus(st[1]);
      if (p >= 100) { clearInterval(t); setStatus('Done'); setTimeout(() => { setPhase('done'); onComplete && onComplete(); }, 450); }
    }, 360);
    return () => clearInterval(t);
  }, [phase]);

  React.useEffect(() => {
    const k = (e) => { if (e.key === 'Escape' && phase !== 'progress') onClose(); };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [phase]);

  const captionsEmpty = false;

  return (
    <div className="vf-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget && phase !== 'progress') onClose(); }}>
      <div className="vf-modal vf-export" role="dialog" aria-modal="true" aria-labelledby="exp-title" style={{ width: 560 }}>
        <div className="vf-modal-head">
          <h2 className="vf-modal-title" id="exp-title">
            {phase === 'settings' ? 'Export video' : phase === 'progress' ? 'Exporting your video' : 'Your video is ready'}
          </h2>
          <button className="vf-iconbtn" onClick={() => phase !== 'progress' && onClose()} aria-label="Close">{I.x({ size: 18 })}</button>
        </div>

        {phase === 'settings' && (
          <>
            <div className="vf-export-tabs" role="tablist">
              <button role="tab" aria-selected={tab === 'format'} className={'vf-etab' + (tab === 'format' ? ' is-active' : '')} onClick={() => setTab('format')}>Format & Quality</button>
              <button role="tab" aria-selected={tab === 'captions'} className={'vf-etab' + (tab === 'captions' ? ' is-active' : '')} onClick={() => setTab('captions')}>
                Captions{caption !== 'none' && <span className="vf-etab-dot" />}
              </button>
            </div>

            <div className="vf-modal-body vf-export-body">
              {tab === 'format' ? (
                <>
                  <label className="vf-label">Preset</label>
                  <div className="vf-preset-row">
                    {[['9:16', 'TikTok / Reels', '1080×1920'], ['16:9', 'YouTube', '1920×1080'], ['custom', 'Custom', 'match project']].map(([id, t, sub]) => (
                      <button key={id} className={'vf-preset' + (preset === id ? ' is-sel' : '')} onClick={() => setPreset(id)} role="radio" aria-checked={preset === id}>
                        <span className={'vf-preset-shape r-' + id.replace(':', '-')} />
                        <span className="vf-preset-name">{id === 'custom' ? 'Custom' : id}</span>
                        <span className="vf-preset-sub">{t}</span>
                        <span className="vf-preset-sub2 mono">{sub}</span>
                        {preset === id && <span className="vf-preset-check">{I.check({ size: 13 })}</span>}
                      </button>
                    ))}
                  </div>

                  <div className="vf-export-fields">
                    <div className="vf-efield"><span className="vf-prop-label">Format</span><span className="vf-efield-static mono">MP4 · H.264</span></div>
                    <div className="vf-efield"><span className="vf-prop-label">Resolution</span>
                      <select className="vf-select" value={res} onChange={(e) => setRes(e.target.value)}><option>720p</option><option>1080p</option></select></div>
                    <div className="vf-efield"><span className="vf-prop-label">Frame rate</span>
                      <select className="vf-select" value={fps} onChange={(e) => setFps(e.target.value)}><option>24</option><option>25</option><option>30</option><option>Matches project</option></select></div>
                  </div>

                  <div className="vf-callout vf-callout-info">{I.info({ size: 16 })}<span>A small VideoForge watermark is added to exports on the free plan (bottom-right).</span></div>

                  <div className="vf-estimate">
                    <div><span className="vf-est-label">Estimated size</span><span className="vf-est-val mono">~ {estSize} MB</span></div>
                    <div className="vf-vrule" />
                    <div><span className="vf-est-label">Estimated time</span><span className="vf-est-val mono">~ {estTime} sec</span></div>
                  </div>
                </>
              ) : (
                <>
                  <label className="vf-label">How should captions be exported?</label>
                  <div className="vf-radio-list">
                    {[['none', 'None', 'No captions in the output.'], ['burned', 'Burned-in', 'Permanently drawn onto the video.'], ['sidecar', 'Sidecar file', 'A separate .srt or .vtt download.']].map(([id, t, d]) => (
                      <button key={id} className={'vf-radio-row' + (caption === id ? ' is-sel' : '')} onClick={() => setCaption(id)} role="radio" aria-checked={caption === id}>
                        <span className="vf-radio-dot" />
                        <span className="vf-radio-main"><b>{t}</b><i>{d}</i></span>
                        {id === 'sidecar' && caption === 'sidecar' && (
                          <select className="vf-select vf-select-sm" value={sidecar} onClick={(e) => e.stopPropagation()} onChange={(e) => setSidecar(e.target.value)}><option>.srt</option><option>.vtt</option></select>
                        )}
                      </button>
                    ))}
                  </div>
                  <div className="vf-callout vf-callout-info">{I.info({ size: 16 })}<span>Captions come from your caption track. If it's empty, “Burned-in” and “Sidecar” are unavailable.</span></div>
                </>
              )}
            </div>

            <div className="vf-modal-foot">
              <button className="vf-btn vf-btn-ghost" onClick={onClose}>Cancel</button>
              <button className="vf-btn vf-btn-primary" onClick={() => setPhase('progress')}>Export{I.chevronDown({ size: 14, style: { transform: 'rotate(-90deg)' } })}</button>
            </div>
          </>
        )}

        {phase === 'progress' && (
          <div className="vf-modal-body vf-export-prog">
            <div className="vf-prog-bar"><div className="vf-prog-fill" style={{ width: pct + '%' }} /></div>
            <div className="vf-prog-pct mono">{pct}%</div>
            <div className="vf-prog-status">{status} · about {Math.max(1, Math.round((100 - pct) / 100 * estTime))} sec remaining</div>
            <div className="vf-prog-meta mono">{res} · MP4 · {preset === 'custom' ? project.ratio : preset} · {caption === 'burned' ? 'burned-in captions' : caption === 'sidecar' ? 'sidecar ' + sidecar : 'no captions'}</div>
            <div className="vf-callout vf-callout-info">{I.bell({ size: 16 })}<span>You can close this and keep working — we'll notify you in the bell when it's ready.</span></div>
            <div className="vf-modal-foot vf-foot-inline">
              <button className="vf-btn vf-btn-ghost" onClick={onClose}>Run in background</button>
              <button className="vf-btn vf-btn-ghost" onClick={() => setPhase('settings')}>Cancel</button>
            </div>
          </div>
        )}

        {phase === 'done' && (
          <div className="vf-modal-body vf-export-done">
            <div className="vf-done-icon">{I.checkCircle({ size: 44 })}</div>
            <div className="vf-done-title">Export complete</div>
            <div className="vf-done-meta">{project.name} · {res} MP4 · ~{estSize} MB</div>
            <div className="vf-done-note">Available for 7 days.</div>
            <div className="vf-modal-foot vf-foot-inline">
              <button className="vf-btn vf-btn-ghost" onClick={onClose}>Done</button>
              <button className="vf-btn vf-btn-primary">{I.download({ size: 16 })} Download</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

Object.assign(window, { ExportModal });
