/* ============================================================
   VideoForge — Editor shell + central state/interactions
   ============================================================ */
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function EditorProvider({ project, empty, children }) {
  const [playhead, setPlayhead] = React.useState(empty ? 0 : 4.4);
  const [playing, setPlaying] = React.useState(false);
  const [selectedId, setSelectedId] = React.useState(empty ? null : 'c-title');
  const [zoom, setZoomRaw] = React.useState(100);
  const [canvasZoom, setCanvasZoom] = React.useState(100);
  const [timelineHeight, setTimelineHeight] = React.useState(260);
  const [leftWidth, setLeftWidth] = React.useState(280);
  const [rightWidth, setRightWidth] = React.useState(300);
  const [leftTab, setLeftTab] = React.useState('media');
  const [leftCollapsed, setLeftCollapsed] = React.useState(false);
  const [safe, setSafe] = React.useState(false);
  const [monitorVol, setMonitorVol] = React.useState(100);
  const [monMuted, setMonMuted] = React.useState(false);
  const [quality, setQuality] = React.useState('Auto');
  const [loop, setLoop] = React.useState(false);
  const [captionMode, setCaptionMode] = React.useState(false);
  const [perfMode, setPerfMode] = React.useState(false);
  const [snap, setSnap] = React.useState(null);
  const [tracks, setTracks] = React.useState(() => TRACKS.map((t) => ({ ...t })));
  const [clips, setClips] = React.useState(() => empty ? [] : CLIPS.map((c) => ({ ...c })));
  const [saveState, setSaveState] = React.useState('saved');

  const phRef = React.useRef(playhead); phRef.current = playhead;
  const playingRef = React.useRef(playing); playingRef.current = playing;
  const loopRef = React.useRef(loop); loopRef.current = loop;

  // playback loop
  React.useEffect(() => {
    if (!playing) return;
    let raf, last = performance.now();
    const tick = (now) => {
      const dt = (now - last) / 1000; last = now;
      let p = phRef.current + dt;
      if (p >= project.duration) { if (loopRef.current) p = 0; else { p = project.duration; setPlaying(false); } }
      phRef.current = p; setPlayhead(p);
      // simulate auto-degrade flicker between 18–26s
      setPerfMode(quality === 'Auto' && p > 17.5 && p < 25.5);
      if (playingRef.current) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, quality]);

  const pps = () => BASE_PPS * (zoom / 100);
  const select = (id) => { setSelectedId(id); if (id) setCaptionMode((m) => m); };
  const togglePlay = () => setPlaying((p) => !p);
  const step = (n) => setPlayhead((p) => clamp(p + n / project.fps, 0, project.duration));
  const toStart = () => setPlayhead(0);
  const toEnd = () => setPlayhead(project.duration);
  const setZoom = (z) => setZoomRaw(clamp(Math.round(z), 25, 600));
  const fitTimeline = () => setZoomRaw(clamp(Math.round((window.innerWidth - 260) / project.duration / BASE_PPS * 100), 25, 600));
  const fitCanvas = () => setCanvasZoom(100);
  const toggleSafe = () => setSafe((s) => !s);
  const toggleMon = () => setMonMuted((m) => !m);
  const cycleQuality = () => setQuality((q) => (q === 'Auto' ? 'High' : q === 'High' ? 'Low' : 'Auto'));
  const toggleLoop = () => setLoop((l) => !l);
  const toggleLeft = () => setLeftCollapsed((c) => !c);
  const toggleTrack = (id, key) => setTracks((ts) => ts.map((t) => t.id === id ? { ...t, [key]: !t[key] } : t));
  const touchSave = () => { setSaveState('saving'); clearTimeout(touchSave._t); touchSave._t = setTimeout(() => setSaveState('saved'), 900); };

  // scrub on ruler
  const beginScrub = (e, ppsv) => {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const move = (ev) => setPlayhead(clamp((ev.clientX - rect.left) / ppsv, 0, project.duration));
    move(e);
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
  };

  // clip move / trim
  const beginClipDrag = (e, clip, mode) => {
    const track = tracks.find((t) => t.id === clip.track);
    if (track && track.locked) return;
    e.preventDefault();
    const ppsv = pps();
    const startX = e.clientX;
    const orig = { ...clip };
    const linkedOrig = clip.linked ? { ...clips.find((c) => c.id === clip.linked) } : null;
    const others = clips.filter((c) => c.id !== clip.id && c.id !== clip.linked);
    const snapTargets = [0, phRef.current, ...others.flatMap((c) => [c.start, c.start + c.dur])];
    const trySnap = (val) => {
      let best = null, bd = 8 / ppsv;
      for (const s of snapTargets) if (Math.abs(s - val) < bd) { bd = Math.abs(s - val); best = s; }
      return best;
    };
    const move = (ev) => {
      const d = (ev.clientX - startX) / ppsv;
      setClips((cs) => cs.map((c) => {
        if (mode === 'move') {
          if (c.id === clip.id) {
            let ns = clamp(orig.start + d, 0, project.duration - orig.dur);
            const sn = trySnap(ns); const snEnd = trySnap(ns + orig.dur);
            if (sn != null) { ns = sn; setSnap(sn); } else if (snEnd != null) { ns = snEnd - orig.dur; setSnap(snEnd); } else setSnap(null);
            return { ...c, start: ns };
          }
          if (linkedOrig && c.id === clip.linked) {
            let ns = clamp(linkedOrig.start + d, 0, project.duration - linkedOrig.dur);
            return { ...c, start: ns };
          }
        } else if (mode === 'trim-l' && c.id === clip.id) {
          let ns = clamp(orig.start + d, 0, orig.start + orig.dur - 1 / project.fps);
          const sn = trySnap(ns); if (sn != null) { ns = sn; setSnap(sn); } else setSnap(null);
          return { ...c, start: ns, dur: orig.dur + (orig.start - ns) };
        } else if (mode === 'trim-r' && c.id === clip.id) {
          let ne = clamp(orig.start + orig.dur + d, orig.start + 1 / project.fps, project.duration);
          const sn = trySnap(ne); if (sn != null) { ne = sn; setSnap(sn); } else setSnap(null);
          return { ...c, dur: ne - orig.start };
        }
        return c;
      }));
    };
    const up = () => { setSnap(null); touchSave(); window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
  };

  const beginTimelineResize = (e) => {
    e.preventDefault();
    const startY = e.clientY, h0 = timelineHeight;
    const move = (ev) => setTimelineHeight(clamp(h0 - (ev.clientY - startY), 180, 600));
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
  };
  const beginPanelResize = (side, e) => {
    e.preventDefault();
    const startX = e.clientX;
    const w0 = side === 'left' ? leftWidth : rightWidth;
    const move = (ev) => {
      const d = ev.clientX - startX;
      if (side === 'left') setLeftWidth(clamp(w0 + d, 180, 420));
      else setRightWidth(clamp(w0 - d, 240, 480));
    };
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
  };

  const splitAtPlayhead = () => {
    const c = clips.find((x) => x.id === selectedId);
    if (!c || c.type === 'caption') return;
    const p = phRef.current;
    if (p <= c.start + 0.05 || p >= c.start + c.dur - 0.05) return;
    const left = { ...c, dur: p - c.start };
    const right = { ...c, id: c.id + '-b' + Math.floor(Math.random() * 999), start: p, dur: c.start + c.dur - p, linked: null };
    setClips((cs) => cs.flatMap((x) => x.id === c.id ? [left, right] : x));
    touchSave();
  };
  const deleteSelected = () => {
    if (!selectedId) return;
    setClips((cs) => cs.filter((x) => x.id !== selectedId && x.linked !== selectedId));
    setSelectedId(null); touchSave();
  };
  const duplicateSelected = () => {
    const c = clips.find((x) => x.id === selectedId); if (!c) return;
    const copy = { ...c, id: c.id + '-d' + Math.floor(Math.random() * 999), start: c.start + c.dur, linked: null };
    setClips((cs) => [...cs, copy]); setSelectedId(copy.id); touchSave();
  };

  // keyboard
  React.useEffect(() => {
    const onKey = (e) => {
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      if (e.key === ' ') { e.preventDefault(); togglePlay(); }
      else if (e.key === 's' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); splitAtPlayhead(); }
      else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelected(); }
      else if ((e.ctrlKey || e.metaKey) && e.key === 'd') { e.preventDefault(); duplicateSelected(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); step(e.shiftKey ? -10 : -1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); step(e.shiftKey ? 10 : 1); }
      else if (e.key === 'Home') { toStart(); }
      else if (e.key === 'End') { toEnd(); }
      else if (e.key === '`') { toggleSafe(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId, clips, zoom]);

  const value = {
    project, playhead, playing, selectedId, zoom, canvasZoom, timelineHeight, leftWidth, rightWidth,
    leftTab, leftCollapsed, safe, monitorVol, monMuted, quality, loop, captionMode, perfMode, snap,
    tracks, clips, saveState,
    select, togglePlay, step, toStart, toEnd, setZoom, fitTimeline, fitCanvas, toggleSafe,
    setMonitorVol, toggleMon, cycleQuality, toggleLoop, toggleLeft, setLeftTab, toggleTrack,
    setCaptionMode, beginScrub, beginClipDrag, beginTimelineResize, beginPanelResize,
  };
  return <EditorCtx.Provider value={value}>{children(value)}</EditorCtx.Provider>;
}

function TopBar({ project, onHome, onExport, bell, onBell }) {
  const ed = useEditor();
  const [name, setName] = React.useState(project.name);
  return (
    <header className="vf-topbar" role="banner">
      <div className="vf-topbar-l">
        <button className="vf-header-brand" onClick={onHome} aria-label="Back to projects"><Logo markSize={24} wordSize={16} /></button>
        <span className="vf-vrule" />
        <input className="vf-projname" value={name} onChange={(e) => setName(e.target.value)} aria-label="Project name" />
        {I.edit({ size: 13 })}
      </div>
      <div className="vf-topbar-c">
        <button className="vf-iconbtn vf-tip" data-tip="Undo (Ctrl+Z)" aria-label="Undo">{I.undo({ size: 18 })}</button>
        <button className="vf-iconbtn vf-tip" data-tip="Redo (Ctrl+Y)" aria-label="Redo">{I.redo({ size: 18 })}</button>
        <span className="vf-vrule" />
        <span className={'vf-savechip vf-save-' + ed.saveState}>
          {ed.saveState === 'saving' ? <><span className="vf-spin" />Saving…</> : <>{I.check({ size: 14 })}All changes saved</>}
        </span>
      </div>
      <div className="vf-topbar-r">
        <div className="vf-bell-wrap">
          <button className={'vf-iconbtn vf-bell vf-bell-' + bell} onClick={onBell} aria-label="Notifications">
            {I.bell({ size: 18 })}{bell === 'done' && <span className="vf-bell-badge">1</span>}{bell === 'progress' && <span className="vf-bell-dot" />}
          </button>
        </div>
        <button className="vf-iconbtn vf-tip" data-tip="Help & shortcuts" aria-label="Help">{I.info({ size: 18 })}</button>
        <AccountMenu />
        <button className="vf-btn vf-btn-primary vf-export-cta" onClick={onExport}>{I.upload({ size: 16 })} Export</button>
      </div>
    </header>
  );
}

function StatusBar() {
  const ed = useEditor();
  const { project, playhead, zoom, perfMode, quality, saveState } = ed;
  return (
    <footer className="vf-statusbar" role="status">
      <span className="mono">{fmtTC(playhead, project.fps)} / {fmtTC(project.duration, project.fps)}</span>
      <span className="vf-sb-dot">·</span>
      <span>{Math.round(project.duration)} sec total</span>
      <span className="vf-sb-dot">·</span>
      <span>Zoom {zoom}%</span>
      <span className="vf-sb-spacer" />
      {perfMode && quality === 'Auto' && <span className="vf-sb-perf">{I.zap({ size: 13 })} Performance mode</span>}
      <span className={'vf-sb-save vf-save-' + saveState}>
        {saveState === 'saving' ? 'Saving…' : <>{I.check({ size: 13 })} All changes saved</>}
      </span>
    </footer>
  );
}

function Editor({ project, empty, onHome }) {
  const [exportOpen, setExportOpen] = React.useState(false);
  const [bell, setBell] = React.useState('idle');
  const [toast, setToast] = React.useState(false);

  return (
    <EditorProvider project={project} empty={empty}>
      {(ed) => {
        const showRight = !!(ed.selectedId && ed.clips.find((c) => c.id === ed.selectedId)) || ed.captionMode;
        return (
          <div className="vf-editor">
            <TopBar project={project} onHome={onHome} onExport={() => setExportOpen(true)} bell={bell} onBell={() => { if (bell === 'done') { setBell('idle'); } }} />

            <div className="vf-middle">
              <LeftPanel />
              {!ed.leftCollapsed && <div className="vf-presize" onMouseDown={(e) => ed.beginPanelResize('left', e)} role="separator" aria-orientation="vertical" aria-label="Resize media panel" />}
              <CanvasArea />
              {showRight && <div className="vf-presize" onMouseDown={(e) => ed.beginPanelResize('right', e)} role="separator" aria-orientation="vertical" aria-label="Resize inspector" />}
              {showRight && <RightPanel />}
            </div>

            <Transport />
            <div style={{ height: ed.timelineHeight, flexShrink: 0 }}><Timeline /></div>
            <StatusBar />

            {exportOpen && (
              <ExportModal project={project}
                onClose={() => { setExportOpen(false); if (bell === 'progress') setBell('idle'); }}
                onComplete={() => { setBell('done'); setToast(true); setTimeout(() => setToast(false), 9000); }} />
            )}

            {toast && (
              <div className="vf-toast" role="status">
                <span className="vf-toast-ic">{I.checkCircle({ size: 20 })}</span>
                <div className="vf-toast-body"><b>Your video is ready</b><span>{project.name} · 1080p MP4 · 24 MB</span></div>
                <button className="vf-btn vf-btn-primary vf-toast-dl">{I.download({ size: 15 })} Download</button>
                <button className="vf-iconbtn" onClick={() => setToast(false)} aria-label="Dismiss">{I.x({ size: 16 })}</button>
              </div>
            )}
          </div>
        );
      }}
    </EditorProvider>
  );
}

Object.assign(window, { Editor, EditorProvider, TopBar, StatusBar });
