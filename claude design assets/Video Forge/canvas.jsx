/* ============================================================
   VideoForge — Canvas Area + Transport Bar
   ============================================================ */
function activeClips(clips, t) {
  return clips.filter((c) => t >= c.start && t < c.start + c.dur);
}

function CanvasArea() {
  const ed = useEditor();
  const { playhead, clips, project, selectedId, select, safe, canvasZoom, perfMode, quality } = ed;
  const boxRef = React.useRef(null);
  const [box, setBox] = React.useState({ w: 0, h: 0 });

  React.useEffect(() => {
    if (!boxRef.current) return;
    const ro = new ResizeObserver(() => {
      const r = boxRef.current.getBoundingClientRect();
      setBox({ w: r.width, h: r.height });
    });
    ro.observe(boxRef.current);
    return () => ro.disconnect();
  }, []);

  // fit project ratio into available box with padding
  const pad = 28;
  const availW = Math.max(80, box.w - pad * 2);
  const availH = Math.max(60, box.h - pad * 2);
  const ar = project.w / project.h;
  let vw = availW, vh = vw / ar;
  if (vh > availH) { vh = availH; vw = vh * ar; }
  const z = canvasZoom / 100;
  vw *= z; vh *= z;

  const t = playhead;
  const act = activeClips(clips, t);
  const vid = act.find((c) => c.type === 'video');
  const overlays = act.filter((c) => c.type === 'overlay');
  const cap = act.find((c) => c.type === 'caption');
  const grad = vid ? SCENE_GRADS[vid.src] : null;

  return (
    <div className="vf-canvas-area" role="main" aria-label="Preview canvas" ref={boxRef}>
      {/* HUD top-right */}
      <div className="vf-hud">
        <button className="vf-iconbtn vf-tip" data-tip="Safe zones (`)" aria-pressed={safe}
          onClick={ed.toggleSafe} aria-label="Toggle safe zones">{I.safe({ size: 18 })}</button>
        <div className="vf-hud-zoom">
          <span className="mono">{canvasZoom}%</span>
          {I.chevronDown({ size: 14 })}
        </div>
        <button className="vf-iconbtn vf-tip" data-tip="Fit (Ctrl+Shift+0)" onClick={ed.fitCanvas} aria-label="Fit to window">{I.fit({ size: 18 })}</button>
      </div>

      {/* viewport */}
      <div className="vf-viewport" style={{ width: vw, height: vh, background: project.bg }}>
        {grad ? (
          <div className="vf-frame" style={{ background: `linear-gradient(135deg, ${grad[0]}, ${grad[1]} 55%, ${grad[2]})` }}>
            <div className="vf-frame-ghost">{I.film({ size: Math.min(vw, vh) * 0.16 })}<span>{vid.name}</span></div>
          </div>
        ) : (
          <div className="vf-frame vf-frame-empty"><span>Background · {project.bg}</span></div>
        )}

        {/* overlays */}
        {overlays.map((o) => {
          const sel = o.id === selectedId;
          return (
            <div key={o.id}
              className={'vf-ovl ' + (o.kind === 'logo' ? 'vf-ovl-logo' : 'vf-ovl-text') + (sel ? ' is-sel' : '')}
              style={{ fontSize: o.kind === 'logo' ? vh * 0.12 : vh * 0.085 }}
              onMouseDown={(e) => { e.stopPropagation(); select(o.id); }}>
              {o.kind === 'logo' ? <ForgeMark size={vh * 0.14} /> : o.text}
              {sel && <SelectionBox />}
            </div>
          );
        })}

        {/* burned-in caption preview */}
        {cap && <div className="vf-cap-burn" style={{ fontSize: vh * 0.045 }}>{cap.name}</div>}

        {/* empty project state */}
        {clips.length === 0 && (
          <div className="vf-canvas-empty">
            <div className="vf-canvas-empty-ic">{I.upload({ size: 30 })}</div>
            <b>Drop a video to start</b>
            <span>Import → arrange → export — usually under 10 minutes.</span>
          </div>
        )}

        {/* safe zones */}
        {safe && (<><div className="vf-safe vf-safe-action" /><div className="vf-safe vf-safe-title" /></>)}

        {/* viewport edge hairline handled by border */}
      </div>

      {/* performance pill */}
      {perfMode && quality === 'Auto' && (
        <div className="vf-perf-pill vf-tip" data-tip="Preview switched to lower resolution to stay responsive. Your export is unaffected.">
          {I.zap({ size: 15 })}<span>Performance mode</span>
        </div>
      )}
      {quality === 'Low' && (
        <div className="vf-perf-pill vf-perf-quiet">{I.zap({ size: 15 })}<span>Low quality (your choice)</span></div>
      )}
    </div>
  );
}

function SelectionBox() {
  const pts = ['nw','n','ne','w','e','sw','s','se'];
  return (
    <div className="vf-selbox" aria-hidden="true">
      <div className="vf-rotate" />
      {pts.map((p) => <span key={p} className={'vf-handle h-' + p} />)}
    </div>
  );
}

function Transport() {
  const ed = useEditor();
  const { playhead, playing, project, monitorVol, monMuted, quality, loop } = ed;
  return (
    <div className="vf-transport" role="toolbar" aria-label="Playback controls">
      <button className="vf-tc vf-tc-cur mono" onClick={() => {}} title="Click to type a timecode and jump">
        {fmtTC(playhead, project.fps)}
      </button>

      <div className="vf-transport-core">
        <button className="vf-iconbtn vf-tip" data-tip="Skip to start (Home)" onClick={ed.toStart} aria-label="Skip to start">{I.skipStart({ size: 20 })}</button>
        <button className="vf-iconbtn vf-tip" data-tip="Step back 1 frame (←)" onClick={() => ed.step(-1)} aria-label="Step back one frame">{I.stepBack({ size: 20 })}</button>
        <button className={'vf-play vf-tip' + (playing ? ' is-playing' : '')} data-tip="Play / Pause (Space)"
          onClick={ed.togglePlay} aria-pressed={playing} aria-label={playing ? 'Pause' : 'Play'}>
          {playing ? I.pause({ size: 22 }) : I.play({ size: 22 })}
        </button>
        <button className="vf-iconbtn vf-tip" data-tip="Step forward 1 frame (→)" onClick={() => ed.step(1)} aria-label="Step forward one frame">{I.stepFwd({ size: 20 })}</button>
        <button className="vf-iconbtn vf-tip" data-tip="Skip to end (End)" onClick={ed.toEnd} aria-label="Skip to end">{I.skipEnd({ size: 20 })}</button>
      </div>

      <span className="vf-tc vf-tc-total mono">{fmtTC(project.duration, project.fps)}</span>

      <div className="vf-transport-right">
        <div className="vf-vol vf-tip" data-tip="Monitor volume (preview only — does not affect export)">
          <button className="vf-iconbtn" onClick={ed.toggleMon} aria-label="Mute monitor">
            {monMuted ? I.volumeX({ size: 18 }) : I.volume({ size: 18 })}
          </button>
          <input type="range" min="0" max="200" value={monMuted ? 0 : monitorVol}
            onChange={(e) => ed.setMonitorVol(+e.target.value)} aria-label="Monitor volume" />
        </div>
        <button className="vf-quality" onClick={ed.cycleQuality} aria-label={'Playback quality: ' + quality}>
          {quality}{I.chevronDown({ size: 13 })}
        </button>
        <button className={'vf-iconbtn vf-tip' + (loop ? ' is-active' : '')} data-tip="Loop" onClick={ed.toggleLoop} aria-pressed={loop} aria-label="Loop playback">{I.loop({ size: 18 })}</button>
        <button className="vf-iconbtn vf-tip" data-tip="Fullscreen preview (Ctrl+Shift+F)" aria-label="Fullscreen preview">{I.fullscreen({ size: 18 })}</button>
      </div>
    </div>
  );
}

Object.assign(window, { CanvasArea, Transport, activeClips });
