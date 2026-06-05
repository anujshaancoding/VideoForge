/* ============================================================
   VideoForge — New Project modal (aspect-ratio chooser, no default)
   ============================================================ */
function RatioTile({ r, selected, onSelect }) {
  // proportional inner rectangle inside a common bounding area
  const [rw, rh] = r.id.split(':').map(Number);
  const ar = rw / rh;
  const maxW = 64, maxH = 64;
  let w = maxW, h = w / ar;
  if (h > maxH) { h = maxH; w = h * ar; }
  return (
    <button className={'vf-rtile' + (selected ? ' is-sel' : '')} role="radio" aria-checked={selected}
      onClick={onSelect} aria-label={`${r.id} ${r.label}`}>
      <span className="vf-rtile-frame">
        <span className="vf-rtile-shape" style={{ width: w, height: h }} />
      </span>
      <span className="vf-rtile-id">{r.id}</span>
      <span className="vf-rtile-label">{r.label}</span>
      <span className="vf-rtile-hint">{r.hint}</span>
      {selected && <span className="vf-rtile-check">{I.check({ size: 13 })}</span>}
    </button>
  );
}

function NewProjectModal({ onClose, onCreate }) {
  const [sel, setSel] = React.useState(null);
  const [name, setName] = React.useState('');
  const [cw, setCw] = React.useState(1080);
  const [ch, setCh] = React.useState(1080);
  const isCustom = sel === 'custom';
  const customValid = cw >= 360 && cw <= 4096 && ch >= 360 && ch <= 4096;
  const canCreate = sel && (!isCustom || customValid);
  const customAr = (cw / ch);

  React.useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, []);

  const create = () => {
    if (!canCreate) return;
    let proj;
    if (isCustom) proj = { ratio: `${cw}×${ch}`, w: cw, h: ch };
    else { const r = RATIOS.find((x) => x.id === sel); proj = { ratio: r.id, w: r.w, h: r.h }; }
    onCreate({ ...proj, name: name.trim() || 'Untitled project' });
  };

  return (
    <div className="vf-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="vf-modal vf-newproj" role="dialog" aria-modal="true" aria-labelledby="np-title" style={{ width: 600 }}>
        <div className="vf-modal-head">
          <h2 className="vf-modal-title" id="np-title">New project</h2>
          <button className="vf-iconbtn" onClick={onClose} aria-label="Close">{I.x({ size: 18 })}</button>
        </div>
        <div className="vf-modal-body">
          <label className="vf-label">Choose an aspect ratio</label>
          <div className="vf-rtiles" role="radiogroup" aria-label="Aspect ratio">
            {RATIOS.map((r) => <RatioTile key={r.id} r={r} selected={sel === r.id} onSelect={() => setSel(r.id)} />)}
            <button className={'vf-rtile vf-rtile-custom' + (isCustom ? ' is-sel' : '')} role="radio" aria-checked={isCustom} onClick={() => setSel('custom')}>
              <span className="vf-rtile-frame"><span className="vf-rtile-shape" style={{ width: 48, height: 48 * (ch / cw <= 1 ? 1 : ch / cw), ...(cw >= ch ? { width: 48, height: 48 * ch / cw } : { width: 48 * cw / ch, height: 48 }) }} /></span>
              <span className="vf-rtile-id">Custom</span>
              <span className="vf-rtile-label">Your size</span>
              {isCustom && <span className="vf-rtile-check">{I.check({ size: 13 })}</span>}
            </button>
          </div>

          {isCustom && (
            <div className="vf-custom-fields">
              <div className="vf-custom-in">
                <label className="vf-label">Width</label>
                <input className="vf-input" type="number" value={cw} min={360} max={4096} onChange={(e) => setCw(+e.target.value || 0)} />
              </div>
              <span className="vf-custom-x">×</span>
              <div className="vf-custom-in">
                <label className="vf-label">Height</label>
                <input className="vf-input" type="number" value={ch} min={360} max={4096} onChange={(e) => setCh(+e.target.value || 0)} />
              </div>
              <div className="vf-custom-ratio">
                {customValid
                  ? <span className="mono">≈ {customAr.toFixed(2)}:1</span>
                  : <span className="vf-custom-err">{I.alert({ size: 13 })} 360–4096 px each side</span>}
              </div>
            </div>
          )}

          <div className="vf-np-name">
            <label className="vf-label">Project name (optional)</label>
            <input className="vf-input" placeholder="Untitled project" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
        </div>
        <div className="vf-modal-foot">
          <button className="vf-btn vf-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="vf-btn vf-btn-primary" aria-disabled={!canCreate} disabled={!canCreate} onClick={create}>Create project</button>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { NewProjectModal });
