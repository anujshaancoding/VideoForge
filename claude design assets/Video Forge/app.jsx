/* ============================================================
   VideoForge — app router + Tweaks
   ============================================================ */
const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "accent": ["#FF7A1A", "#FF8C3D", "#E66610", "#FFB066"],
  "gridlines": true,
  "playAccent": true,
  "startScreen": "dashboard"
}/*EDITMODE-END*/;

const ACCENT_OPTIONS = [
  ["#FF7A1A", "#FF8C3D", "#E66610", "#FFB066"], // ember (default)
  ["#FFB020", "#FFC24D", "#E0930A", "#FFD27A"], // molten gold
  ["#FF5A3C", "#FF7758", "#E0381C", "#FF9C85"], // crimson forge
  ["#FF4D8D", "#FF6FA3", "#E02C6D", "#FF92B8"], // spark magenta
];

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [route, setRoute] = React.useState(t.startScreen || 'dashboard');
  const [project, setProject] = React.useState(null);
  const [npOpen, setNpOpen] = React.useState(false);
  const [emptyEditor, setEmptyEditor] = React.useState(false);

  // apply brand accent tweak to the token layer
  React.useEffect(() => {
    const r = document.documentElement.style;
    const [a, h, ac, tx] = t.accent || ACCENT_OPTIONS[0];
    r.setProperty('--vf-accent', a);
    r.setProperty('--vf-accent-hover', h);
    r.setProperty('--vf-accent-active', ac);
    r.setProperty('--vf-accent-text', tx);
    r.setProperty('--vf-brand-gradient', `linear-gradient(135deg, ${a} 0%, ${tx} 100%)`);
    document.body.classList.toggle('vf-no-grid', !t.gridlines);
    document.body.classList.toggle('vf-no-playaccent', !t.playAccent);
  }, [t.accent, t.gridlines, t.playAccent]);

  const openProject = (card) => {
    setProject({ ...DEMO_PROJECT, name: card.name, ratio: card.ratio,
      w: card.w || DEMO_PROJECT.w, h: card.h || DEMO_PROJECT.h });
    setEmptyEditor(false); setRoute('editor');
  };
  const createProject = (cfg) => {
    setProject({ ...DEMO_PROJECT, id: 'p-new', name: cfg.name, ratio: cfg.ratio, w: cfg.w, h: cfg.h });
    setEmptyEditor(true); setNpOpen(false); setRoute('editor');
  };

  return (
    <>
      {route === 'gate' && <BrowserGate onContinue={() => setRoute('auth')} />}
      {route === 'auth' && <Auth onAuthed={() => setRoute('dashboard')} />}
      {route === 'dashboard' && (
        <Dashboard projects={DASH_PROJECTS} empty={false} onNew={() => setNpOpen(true)} onOpen={openProject} />
      )}
      {route === 'editor' && project && (
        <Editor project={project} empty={emptyEditor} onHome={() => setRoute('dashboard')} />
      )}

      {npOpen && <NewProjectModal onClose={() => setNpOpen(false)} onCreate={createProject} />}

      {route !== 'editor' && (
        <div className="vf-flowbar">
          <span>Flow:</span>
          {['gate', 'auth', 'dashboard'].map((r) => (
            <button key={r} className={route === r ? 'is-active' : ''} onClick={() => setRoute(r)}>{r}</button>
          ))}
        </div>
      )}

      <TweaksPanel title="Tweaks">
        <TweakSection label="Brand" />
        <TweakColor label="Accent (forge)" value={t.accent} options={ACCENT_OPTIONS} onChange={(v) => setTweak('accent', v)} />
        <TweakToggle label="Accent fill while playing" value={t.playAccent} onChange={(v) => setTweak('playAccent', v)} />
        <TweakSection label="Timeline" />
        <TweakToggle label="Per-second gridlines" value={t.gridlines} onChange={(v) => setTweak('gridlines', v)} />
        <TweakSection label="Demo flow" />
        <TweakRadio label="Start screen" value={route === 'editor' ? 'dashboard' : route}
          options={['gate', 'auth', 'dashboard']} onChange={(v) => { setTweak('startScreen', v); setRoute(v); }} />
      </TweaksPanel>
    </>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
