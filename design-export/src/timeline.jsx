/* ============================================================
   VideoForge — Multi-Track Timeline (the hero surface)
   ============================================================ */
const BASE_PPS = 24; // px per second @100% zoom

function trackColors(type) {
  return {
    video:   { accent: 'var(--vf-track-video)',   fill: 'var(--vf-track-video-fill)',   sel: 'var(--vf-track-video-fill-sel)' },
    audio:   { accent: 'var(--vf-track-audio)',   fill: 'var(--vf-track-audio-fill)',   sel: 'var(--vf-track-audio-fill-sel)' },
    caption: { accent: 'var(--vf-track-caption)', fill: 'var(--vf-track-caption-fill)', sel: 'var(--vf-track-caption-fill-sel)' },
    overlay: { accent: 'var(--vf-track-overlay)', fill: 'var(--vf-track-overlay-fill)', sel: 'var(--vf-track-overlay-fill-sel)' },
  }[type];
}
const TRACK_ICON = { video: I.film, audio: I.music, caption: I.captions, overlay: I.type };

function Waveform({ seed, w, h, sel }) {
  const d = React.useMemo(() => wavePath(seed, Math.max(24, Math.floor(w / 3)), w, h), [seed, w, h]);
  return (
    <svg className="vf-wave" width={w} height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <path d={d} fill="var(--vf-track-audio-wave)" opacity={sel ? 0.95 : 0.7} />
    </svg>
  );
}

function Clip({ clip, track, pps, selected, snapEdge }) {
  const ed = useEditor();
  const c = trackColors(clip.type);
  const left = clip.start * pps;
  const width = Math.max(8, clip.dur * pps);
  const tall = track.h;
  const showLabel = width > 44 && clip.type !== 'overlay';

  const onDown = (e, mode) => {
    e.stopPropagation();
    ed.select(clip.id);
    ed.beginClipDrag(e, clip, mode);
  };

  const body = () => {
    if (clip.type === 'video') {
      const g = SCENE_GRADS[clip.src] || ['#333','#222','#444'];
      return (
        <div className="vf-clip-strip" style={{
          background: `linear-gradient(105deg, ${g[0]}, ${g[1]} 50%, ${g[2]})`,
          backgroundSize: 'cover',
          '--frameW': Math.max(14, pps) + 'px',
        }} />
      );
    }
    if (clip.type === 'audio') return <Waveform seed={clip.seed || 3} w={width} h={tall - 18} sel={selected} />;
    if (clip.type === 'caption') return null;
    return null;
  };

  return (
    <div
      className={'vf-clip vf-clip-' + clip.type + (selected ? ' is-sel' : '') + (track.locked ? ' is-locked' : '')}
      role="gridcell" aria-selected={selected}
      aria-label={`${clip.type} clip ${clip.name}${clip.linked ? ', audio-linked' : ''}`}
      tabIndex={-1}
      style={{
        left, width, height: tall - 6,
        '--clip-accent': c.accent,
        background: clip.type === 'caption' ? 'transparent' : (selected ? c.sel : c.fill),
        borderColor: selected ? 'var(--vf-selection)' : c.accent,
        borderWidth: selected ? '2px' : '1px',
      }}
      onMouseDown={(e) => onDown(e, 'move')}
    >
      {clip.type === 'caption' ? (
        <div className="vf-cap-pill" title={clip.name}>{clip.name}</div>
      ) : (
        <>
          {body()}
          <div className="vf-clip-top">
            {showLabel && <span className="vf-clip-name">{clip.name}</span>}
            <span className="vf-clip-badges">
              {clip.speed && clip.speed !== 1 && (
                <span className={'vf-badge vf-badge-speed ' + (clip.speed < 1 ? 'slow' : 'fast')}>{clip.speed}×</span>
              )}
              {clip.linked && <span className="vf-badge vf-badge-link" title="Audio-linked">{I.link({ size: 12 })}</span>}
              {(clip.type === 'video' || clip.type === 'overlay') && (
                <span className="vf-badge vf-badge-kf" title="Keyframes">{I.diamond({ size: 11 })}</span>
              )}
            </span>
          </div>
          {clip.type === 'overlay' && <span className="vf-ovl-clip-label">{clip.name}</span>}
          {/* trim handles */}
          {!track.locked && (
            <>
              <span className="vf-trim vf-trim-l" onMouseDown={(e) => onDown(e, 'trim-l')} />
              <span className="vf-trim vf-trim-r" onMouseDown={(e) => onDown(e, 'trim-r')} />
            </>
          )}
        </>
      )}
    </div>
  );
}

function TrackHeader({ track }) {
  const ed = useEditor();
  const Icon = TRACK_ICON[track.type];
  const c = trackColors(track.type);
  const isAudio = track.type === 'audio';
  return (
    <div className="vf-thead" style={{ height: track.h, '--track-accent': c.accent }} role="row">
      <span className="vf-thead-accent" />
      <div className="vf-thead-r1">
        <span className="vf-thead-icon" style={{ color: c.accent }} aria-label={track.type}>{Icon({ size: 15 })}</span>
        <span className="vf-thead-name">{track.short} · {track.name}</span>
        <button className="vf-thead-kebab" aria-label="Track options">{I.kebab({ size: 14 })}</button>
      </div>
      {track.h >= 44 && (
        <div className="vf-thead-r2">
          {isAudio && (
            <>
              <button className={'vf-tg' + (track.mute ? ' on-danger' : '')} role="switch" aria-checked={!!track.mute}
                onClick={() => ed.toggleTrack(track.id, 'mute')} aria-label="Mute" title="Mute">{(track.mute ? I.volumeX : I.volume)({ size: 13 })}</button>
              <button className={'vf-tg' + (track.solo ? ' on-accent' : '')} role="switch" aria-checked={!!track.solo}
                onClick={() => ed.toggleTrack(track.id, 'solo')} aria-label="Solo" title="Solo">{I.solo({ size: 13 })}</button>
            </>
          )}
          <button className={'vf-tg' + (track.locked ? ' on' : '')} role="switch" aria-checked={!!track.locked}
            onClick={() => ed.toggleTrack(track.id, 'locked')} aria-label="Lock" title="Lock">{(track.locked ? I.lock : I.unlock)({ size: 13 })}</button>
          {isAudio && <span className="vf-pan"><span className="vf-pan-track"><span className="vf-pan-dot" /></span></span>}
          {isAudio && <button className="vf-tg vf-tg-e" title="Volume envelope">E</button>}
        </div>
      )}
    </div>
  );
}

function Ruler({ pps, width }) {
  const ed = useEditor();
  const { project, playhead } = ed;
  const ticks = [];
  const majorEvery = pps < 30 ? 2 : 1; // seconds between labels
  const minorPerMajor = 4;
  for (let s = 0; s <= project.duration; s += majorEvery) {
    ticks.push(<div key={'mj' + s} className="vf-tick vf-tick-major" style={{ left: s * pps }}>
      <span className="vf-tick-label mono">{fmtClock(s)}</span></div>);
    for (let i = 1; i < minorPerMajor; i++) {
      const ms = s + (i * majorEvery) / minorPerMajor;
      if (ms < project.duration) ticks.push(<div key={'mn' + ms} className="vf-tick vf-tick-minor" style={{ left: ms * pps }} />);
    }
  }
  return (
    <div className="vf-ruler" style={{ width }} onMouseDown={(e) => ed.beginScrub(e, pps)}>
      <div className="vf-workarea" style={{ left: 0, width: project.duration * pps }} title="Loop / preview range" />
      {ticks}
      <div className="vf-playhead-tri" style={{ left: playhead * pps }} role="slider"
        aria-label="Playhead" aria-valuetext={fmtTC(playhead, project.fps)} tabIndex={0} />
    </div>
  );
}

function Timeline() {
  const ed = useEditor();
  const { project, clips, tracks, zoom, playhead, snap } = ed;
  const pps = BASE_PPS * (zoom / 100);
  const contentW = project.duration * pps + 80;
  const bodyRef = React.useRef(null);
  const headRef = React.useRef(null);

  const onBodyScroll = () => {
    if (headRef.current && bodyRef.current) headRef.current.scrollTop = bodyRef.current.scrollTop;
  };

  return (
    <div className="vf-timeline" role="grid" aria-label="Timeline">
      <div className="vf-tl-resize" role="separator" aria-orientation="horizontal"
        aria-label="Resize timeline" onMouseDown={ed.beginTimelineResize} />

      <div className="vf-tl-main">
        {/* header column */}
        <div className="vf-tl-headcol">
          <div className="vf-tl-headgutter">
            <button className="vf-iconbtn" aria-label="Add track" title="Add track">{I.plus({ size: 15 })}</button>
            <span className="vf-tl-headgutter-label">Tracks</span>
          </div>
          <div className="vf-tl-heads" ref={headRef}>
            {tracks.map((t) => <TrackHeader key={t.id} track={t} />)}
          </div>
        </div>

        {/* body */}
        <div className="vf-tl-body" ref={bodyRef} onScroll={onBodyScroll}>
          <div className="vf-tl-content" style={{ width: contentW }}>
            <div className="vf-tl-ruler-wrap"><Ruler pps={pps} width={contentW} /></div>
            <div className="vf-tl-lanes" onMouseDown={() => ed.select(null)}>
              {tracks.map((t) => {
                const c = trackColors(t.type);
                return (
                  <div key={t.id} className={'vf-lane' + (t.locked ? ' is-locked' : '')}
                    style={{ height: t.h, '--grid-pps': pps + 'px', '--lane-accent': c.accent }} role="row">
                    {clips.filter((cl) => cl.track === t.id).map((cl) => (
                      <Clip key={cl.id} clip={cl} track={t} pps={pps} selected={cl.id === ed.selectedId} />
                    ))}
                  </div>
                );
              })}
              {/* full-height playhead line */}
              <div className="vf-playhead-line" style={{ left: playhead * pps }} />
              {snap != null && <div className="vf-snap-line" style={{ left: snap * pps }} />}
            </div>
          </div>
        </div>
      </div>

      {/* utility row */}
      <div className="vf-tl-util">
        <button className="vf-btn-quiet" onClick={ed.fitTimeline}>{I.fit({ size: 16 })} Fit</button>
        <div className="vf-zoomctl">
          <button className="vf-iconbtn" onClick={() => ed.setZoom(zoom - 25)} aria-label="Zoom out">{I.minus({ size: 16 })}</button>
          <input type="range" min="25" max="600" step="5" value={zoom} onChange={(e) => ed.setZoom(+e.target.value)} aria-label="Timeline zoom" />
          <button className="vf-iconbtn" onClick={() => ed.setZoom(zoom + 25)} aria-label="Zoom in">{I.plus({ size: 16 })}</button>
          <span className="vf-zoom-read mono">{zoom}%</span>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { Timeline, BASE_PPS, trackColors, Waveform, TRACK_ICON });
