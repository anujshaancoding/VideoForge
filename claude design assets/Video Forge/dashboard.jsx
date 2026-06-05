/* ============================================================
   VideoForge — Auth, Dashboard, Browser Gate
   ============================================================ */
const AspectGlyph = ({ ratio, size = 16 }) => {
  const map = { '16:9': [16, 9], '9:16': [9, 16], '1:1': [12, 12], '4:5': [10, 12.5] };
  const [w, h] = map[ratio] || [16, 9];
  const s = size / Math.max(w, h);
  return <span className="vf-aspect-glyph" style={{ width: w * s, height: h * s }} aria-hidden="true" />;
};

function Auth({ onAuthed }) {
  const [mode, setMode] = React.useState('login');
  const [show, setShow] = React.useState(false);
  return (
    <div className="vf-auth-screen">
      <div className="vf-auth-brand"><Logo markSize={34} wordSize={22} /></div>
      <div className="vf-auth-card">
        <div className="vf-seg vf-auth-seg" role="tablist">
          <button role="tab" aria-selected={mode === 'login'} className={mode === 'login' ? 'is-active' : ''} onClick={() => setMode('login')}>Log in</button>
          <button role="tab" aria-selected={mode === 'signup'} className={mode === 'signup' ? 'is-active' : ''} onClick={() => setMode('signup')}>Sign up</button>
        </div>

        <button className="vf-btn vf-btn-ghost vf-google" onClick={onAuthed}>{I.google({ size: 18 })} Continue with Google</button>
        <div className="vf-or"><span /><i>or</i><span /></div>

        <label className="vf-label">Email</label>
        <input className="vf-input" type="email" placeholder="you@example.com" />

        <div className="vf-pw-label">
          <label className="vf-label" style={{ margin: 0 }}>Password</label>
          {mode === 'login' && <button className="vf-link">Forgot?</button>}
        </div>
        <div className="vf-pw-wrap">
          <input className="vf-input" type={show ? 'text' : 'password'} placeholder="••••••••••••" />
          <button className="vf-iconbtn vf-pw-eye" onClick={() => setShow(!show)} aria-pressed={show} aria-label="Show password">{I.eye({ size: 16 })}</button>
        </div>
        {mode === 'signup' && <p className="vf-pw-hint">Use at least 8 characters.</p>}

        <button className="vf-btn vf-btn-primary vf-auth-submit" onClick={onAuthed}>{mode === 'login' ? 'Log in' : 'Create account'}</button>
      </div>
      <p className="vf-auth-terms">By continuing you agree to the Terms & Privacy.</p>
    </div>
  );
}

function AccountMenu() {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="vf-acct">
      <button className="vf-acct-btn" onClick={() => setOpen(!open)} aria-haspopup="true" aria-expanded={open}>
        <span className="vf-acct-av">AS</span>{I.chevronDown({ size: 14 })}
      </button>
      {open && (
        <div className="vf-acct-menu" role="menu">
          <button role="menuitem">Account settings</button>
          <button role="menuitem">Help / keyboard shortcuts</button>
          <div className="vf-divider" />
          <button role="menuitem">Log out</button>
        </div>
      )}
    </div>
  );
}

function Dashboard({ projects, empty, onNew, onOpen }) {
  return (
    <div className="vf-dash">
      <header className="vf-app-header">
        <button className="vf-header-brand" onClick={() => {}}><Logo markSize={24} wordSize={16} /></button>
        <AccountMenu />
      </header>

      {empty ? (
        <div className="vf-dash-empty">
          <div className="vf-empty-art"><ForgeMark size={64} /></div>
          <h1>Create your first video</h1>
          <p>Import footage, cut it on a real multi-track timeline, and export an MP4 that matches your edit exactly — what you cut is what you get.</p>
          <button className="vf-btn vf-btn-primary vf-empty-cta" onClick={onNew}>{I.plus({ size: 16 })} New project</button>
        </div>
      ) : (
        <main className="vf-dash-main">
          <div className="vf-dash-bar">
            <h1>Your projects</h1>
            <button className="vf-btn vf-btn-primary" onClick={onNew}>{I.plus({ size: 16 })} New</button>
          </div>
          <div className="vf-dash-grid" role="list">
            <button className="vf-newtile" role="listitem" onClick={onNew}>
              <span className="vf-newtile-plus">{I.plus({ size: 22 })}</span>
              <span>New project</span>
            </button>
            {projects.map((p) => (
              <button key={p.id} className="vf-pcard" role="listitem" onClick={() => onOpen(p)}>
                <div className="vf-pcard-thumb" style={{ background: `linear-gradient(135deg, ${p.grad[0]}, ${p.grad[2]})` }}>
                  <div className={'vf-pcard-frame ar-' + p.ratio.replace(':', '-')} />
                  <span className="vf-pcard-badge"><AspectGlyph ratio={p.ratio} size={12} />{p.ratio}</span>
                </div>
                <div className="vf-pcard-meta">
                  <div className="vf-pcard-titlerow">
                    <span className="vf-pcard-title">{p.name}</span>
                    <span className="vf-pcard-kebab" aria-label="Project options">{I.kebab({ size: 15 })}</span>
                  </div>
                  <span className="vf-pcard-sub" title={p.exact}>{p.ratio} · {p.updated}</span>
                </div>
              </button>
            ))}
          </div>
        </main>
      )}
    </div>
  );
}

function BrowserGate({ onContinue }) {
  return (
    <div className="vf-gate">
      <div className="vf-gate-brand"><Logo markSize={30} wordSize={20} /></div>
      <div className="vf-gate-icon">{I.film({ size: 40 })}{I.checkCircle({ size: 22 })}</div>
      <h1>VideoForge works best in Chrome or Edge</h1>
      <p>VideoForge's real-time preview uses browser video tech (WebCodecs) that Safari and Firefox don't fully support yet. Open VideoForge in Chrome or Microsoft Edge on desktop for the full editor.</p>
      <div className="vf-gate-actions">
        <button className="vf-btn vf-btn-ghost">Copy link</button>
        <button className="vf-btn vf-btn-ghost">Get Chrome ↗</button>
        <button className="vf-btn vf-btn-ghost">Get Edge ↗</button>
      </div>
      <p className="vf-gate-mobile">On mobile? The MVP is desktop-only — use a laptop or desktop.</p>
      <button className="vf-link vf-gate-skip" onClick={onContinue}>Continue to the demo anyway →</button>
    </div>
  );
}

Object.assign(window, { Auth, Dashboard, BrowserGate, AccountMenu, AspectGlyph });
