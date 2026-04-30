import Btn from "../shared/components/Btn"
import C from "../styles/colors"
import { canOpenStep } from "./AppState"

export default function AppLayout({
  activeStep,
  steps,
  appState,
  canNext,
  sidebarGlyphCount,
  onStepSelect,
  onNext,
  onBack,
  onLogout,
  onOpenLogin,
  isAuthenticated,
  children,
}) {
  const nextLabel = { 1: "Next →", 2: "Next →", 3: "Build DNA →", 4: "Preview →", 5: null }

  // กรอง Login step ออกจาก sidebar nav
  const navSteps = steps.filter(s => s.label !== "Login")

  return (
    <>
      <FontLoader />
      <div className="hw-app" style={{ display: "flex", height: "100vh", overflow: "hidden" }}>

        {/* ── Sidebar ── */}
        <aside style={{
          width: 220, minWidth: 220,
          background: C.bgCard, borderRight: `1px solid ${C.border}`,
          display: "flex", flexDirection: "column",
        }}>
          {/* Brand */}
          <div style={{ padding: "24px 20px 20px", borderBottom: `1px solid ${C.border}` }}>
            <p style={{ fontFamily: "'DM Serif Display', serif", fontSize: 17, color: C.ink, lineHeight: 1.2 }}>
              Handwriting<br />Generator
            </p>
            <p style={{ fontSize: 10, color: C.inkLt, marginTop: 6, letterSpacing: "0.04em" }}>
              PDF • Rendering Engine • v3.1
            </p>
          </div>

          {/* Nav steps */}
          <nav style={{ flex: 1, padding: "12px 0", overflowY: "auto" }}>
            {navSteps.map(s => {
              const done   = activeStep > s.id
              const active = activeStep === s.id
              const locked = !canOpenStep(s.id, appState)
              return (
                <button
                  key={s.id}
                  onClick={() => !locked && onStepSelect(s.id)}
                  disabled={locked}
                  style={{
                    width: "100%", display: "flex", alignItems: "center", gap: 12,
                    padding: "10px 20px", border: "none", outline: "none",
                    background: active ? C.bgMuted : "transparent",
                    cursor: locked ? "not-allowed" : "pointer",
                    transition: "background 0.15s",
                    borderLeft: active ? `2px solid ${C.ink}` : "2px solid transparent",
                  }}
                >
                  <div style={{
                    width: 22, height: 22, borderRadius: "50%", flexShrink: 0,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 9, fontWeight: 600, letterSpacing: "0.02em",
                    background: done ? C.sage : active ? C.ink : "transparent",
                    border: done ? "none" : active ? "none" : `1.5px solid ${C.borderMd}`,
                    color: done || active ? "#fff" : C.inkLt,
                    transition: "all 0.2s ease",
                  }}>
                    {done ? "✓" : s.icon}
                  </div>
                  <p style={{
                    fontSize: 12,
                    fontWeight: active ? 500 : 400,
                    color: done ? C.sage : active ? C.ink : C.inkLt,
                    lineHeight: 1,
                  }}>
                    {s.label}
                  </p>
                </button>
              )
            })}
          </nav>

          {/* ── Sidebar footer ── */}
          <div style={{ padding: "16px 20px", borderTop: `1px solid ${C.border}` }}>

            {isAuthenticated ? (
              /* ── Logged in state ── */
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                  <div style={{
                    width: 32, height: 32, borderRadius: "50%",
                    background: C.ink,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 12, fontWeight: 600, color: "#fff",
                    flexShrink: 0,
                  }}>T</div>
                  <div style={{ minWidth: 0 }}>
                    <p style={{ fontSize: 11, fontWeight: 500, color: C.ink, lineHeight: 1.3 }}>Handwriting #1</p>
                    <p style={{ fontSize: 10, color: C.inkLt, marginTop: 1 }}>
                      {sidebarGlyphCount} • 10 MB max
                    </p>
                  </div>
                </div>

                <button
                  onClick={onLogout}
                  style={{
                    width: "100%", padding: "7px 0",
                    border: `1px solid ${C.border}`, borderRadius: 6,
                    background: "transparent", cursor: "pointer",
                    fontSize: 11, color: C.inkLt, fontFamily: "inherit",
                    transition: "all 0.15s",
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.background = C.bgMuted
                    e.currentTarget.style.color = C.ink
                    e.currentTarget.style.borderColor = C.borderMd
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.background = "transparent"
                    e.currentTarget.style.color = C.inkLt
                    e.currentTarget.style.borderColor = C.border
                  }}
                >
                  Sign out
                </button>
              </>
            ) : (
              /* ── Guest state — Login button ── */
              <>
                <div style={{ marginBottom: 10 }}>
                  <p style={{ fontSize: 10, color: C.inkLt, lineHeight: 1.5 }}>
                    Sign in to save your work and access all features.
                  </p>
                </div>

                <button
                  onClick={onOpenLogin}
                  style={{
                    width: "100%",
                    padding: "9px 0",
                    border: "none",
                    borderRadius: 8,
                    background: C.ink,
                    color: "#fff",
                    cursor: "pointer",
                    fontSize: 12,
                    fontWeight: 500,
                    fontFamily: "inherit",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 7,
                    transition: "opacity 0.15s, transform 0.1s",
                    letterSpacing: "0.01em",
                  }}
                  onMouseEnter={e => e.currentTarget.style.opacity = "0.85"}
                  onMouseLeave={e => e.currentTarget.style.opacity = "1"}
                  onMouseDown={e => e.currentTarget.style.transform = "scale(0.98)"}
                  onMouseUp={e => e.currentTarget.style.transform = "scale(1)"}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/>
                    <polyline points="10 17 15 12 10 7"/>
                    <line x1="15" y1="12" x2="3" y2="12"/>
                  </svg>
                  Sign in
                </button>


              </>
            )}
          </div>
        </aside>

        {/* ── Main content ── */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>

          <header style={{
            height: 56, flexShrink: 0,
            background: C.bgCard, borderBottom: `1px solid ${C.border}`,
            display: "flex", alignItems: "center", padding: "0 28px", gap: 12,
          }}>
            <div>
              <span style={{ fontSize: 15, fontWeight: 500, color: C.ink }}>
                {navSteps.find(s => s.id === activeStep)?.label ?? ""}
              </span>
              <span style={{ fontSize: 12, color: C.inkLt, marginLeft: 8 }}>
                • Step {activeStep} of {navSteps.length}
              </span>
            </div>
            <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
              {activeStep > 1 && (
                <Btn onClick={onBack} variant="ghost" size="sm">← Back</Btn>
              )}
              {nextLabel[activeStep] && (
                <Btn onClick={onNext} disabled={!canNext} variant="primary" size="sm">
                  {nextLabel[activeStep]}
                </Btn>
              )}
            </div>
          </header>

          <main style={{
            flex: 1, overflowY: "auto",
            padding: activeStep === 5 ? 0 : "28px 32px",
            background: activeStep === 5 ? "#E7E6E6" : C.bg,
          }}>
            {children}
          </main>

          <div style={{ height: 3, background: C.border }}>
            <div style={{
              height: "100%", background: C.ink,
              transition: "width 0.4s ease",
              width: `${(activeStep / navSteps.length) * 100}%`,
            }} />
          </div>
        </div>
      </div>
    </>
  )
}

function FontLoader() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500&display=swap');
      *{box-sizing:border-box;margin:0;padding:0}
      body{font-family:'DM Sans',sans-serif;background:#F7F5F0}
      .hw-app{background:#F7F5F0;min-height:100vh}
      @keyframes fadeUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
      .fade-up{animation:fadeUp .35s ease forwards}
      .char-cell{transition:all .12s cubic-bezier(.4,0,.2,1)}
      .char-cell:active{transform:scale(.88)}
      @keyframes blink{0%,100%{opacity:1}50%{opacity:0}}
      .cursor{display:inline-block;width:1.5px;height:1.1em;background:#2C2416;vertical-align:middle;margin-left:1px;animation:blink 1.1s step-start infinite}
      @keyframes spin{to{transform:rotate(360deg)}}
      .spinner{width:28px;height:28px;border:2px solid #E5E0D5;border-top-color:#2C2416;border-radius:50%;animation:spin .7s linear infinite}
      @keyframes fillBar{from{width:0%}}
      .bar-fill{animation:fillBar .6s ease forwards}
      .glyph-card{transition:transform .15s ease,box-shadow .15s ease}
      .glyph-card:hover{transform:translateY(-2px);box-shadow:0 4px 16px rgba(44,36,22,.08)}
      .step-dot{transition:all .2s ease}
    `}</style>
  )
}