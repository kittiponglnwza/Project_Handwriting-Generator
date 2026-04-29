import { lazy, Suspense, useEffect, useMemo, useState } from "react"
import Btn from "./components/Btn"
import ErrorBoundary from "./components/ErrorBoundary"
import Step1 from "./steps/Step1"
import Step2 from "./steps/Step2"
import Step3 from "./steps/Step3"
import { buildVersionedGlyphs } from "./domains/preview/glyphVersions.js"
import { usePipeline } from "./hooks/usePipeline.js"
import C from "./styles/colors"

// ─── Lazy-loaded heavy steps ──────────────────────────────────────────────────
const Step4 = lazy(() => import("./steps/Step4.jsx"))
const Step5 = lazy(() => import("./steps/Step5"))

// ─── Step definitions ─────────────────────────────────────────────────────────
const STEPS = [
  { id: 1, label: "Generate Template", icon: "01" },
  { id: 2, label: "Upload PDF",        icon: "02" },
  { id: 3, label: "Verify Glyphs",       icon: "03" },
  { id: 4, label: "DNA Profile",       icon: "04" },
  { id: 5, label: "Preview",           icon: "05" },
]

const FontLoader = () => (
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

// ─── INITIAL STATE ────────────────────────────────────────────────────────────
const INITIAL_STATE = {
  parsedFile:      null,
  glyphResult:     null,
  versionedGlyphs: [],
  ttfBuffer:       null,
  puaMap:          null,
  fontStyle: {
    roughness:   30,
    neatness:    70,
    slant:        0,
    boldness:   100,
    randomness:  40,
  },
}

function StepLoader() {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 200 }}>
      <div className="spinner" />
    </div>
  )
}

export default function App() {
  const [step, setStep] = useState(1)
  const [appState, setAppState] = useState(INITIAL_STATE)
  const pipeline = usePipeline()

  useEffect(() => {
    const glyphs = appState.glyphResult?.glyphs ?? []
    if (glyphs.length === 0) {
      setAppState(prev => ({ ...prev, versionedGlyphs: [] }))
      return
    }
    setAppState(prev => ({ ...prev, versionedGlyphs: buildVersionedGlyphs(glyphs) }))
  }, [appState.glyphResult])

  // ── Navigation guard (synchronous — avoid one-frame flash that triggers lazy import) ──
  const effectiveStep = canOpenStep(step, appState)
    ? step
    : ([4, 3, 2, 1].find(s => canOpenStep(s, appState)) ?? 2)

  // Keep `step` state in sync (still needed so sidebar highlights are correct)
  useEffect(() => {
    if (effectiveStep !== step) setStep(effectiveStep)
  }, [effectiveStep, step])

  const handleParsed = (parsedFile) => {
    setAppState({ ...INITIAL_STATE, parsedFile })
  }

  const handleClearPdf = () => { setAppState(INITIAL_STATE) }

  const handleFontReady = ({ ttfBuffer, puaMap }) => {
    setAppState(prev => ({ ...prev, ttfBuffer, puaMap: puaMap ?? null }))
  }

  const handleGlyphsUpdate = (glyphs) => {
    setAppState(prev => ({
      ...prev,
      glyphResult: { glyphs, validationStatus: glyphs.length > 0 ? "ok" : "empty" },
    }))
  }

  const handleFontStyleChange = (key, value) => {
    setAppState(prev => ({ ...prev, fontStyle: { ...prev.fontStyle, [key]: value } }))
  }

  const handleNext = () => { setStep(s => Math.min(STEPS.length, s + 1)) }

  const sidebarGlyphCount = useMemo(() => {
    if (appState.glyphResult?.glyphs?.length > 0)
      return `${appState.glyphResult.glyphs.length} glyphs`
    if (appState.parsedFile?.metadata?.detectedSlots > 0)
      return `${appState.parsedFile.metadata.detectedSlots} slots`
    return "—"
  }, [appState.parsedFile, appState.glyphResult])

  const nextLabel = { 1: "Next →", 2: "Next →", 3: "Build DNA →", 4: "Preview →", 5: null }
  // Alias for rendering — uses the synchronously-computed safe step
  const activeStep = effectiveStep

  const canNext = useMemo(() => {
    switch (activeStep) {
      case 1: return true
      case 2: return appState.parsedFile?.status === "parsed"
      case 3: return (appState.glyphResult?.glyphs?.length ?? 0) > 0
      case 4: return appState.versionedGlyphs.length > 0
      default: return false
    }
  }, [activeStep, appState])

  return (
    <>
      <FontLoader />
      <div className="hw-app" style={{ display: "flex", height: "100vh", overflow: "hidden" }}>

        <aside style={{ width: 220, minWidth: 220, background: C.bgCard, borderRight: `1px solid ${C.border}`, display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "24px 20px 20px", borderBottom: `1px solid ${C.border}` }}>
            <p style={{ fontFamily: "'DM Serif Display', serif", fontSize: 17, color: C.ink, lineHeight: 1.2 }}>
              Handwriting<br />Generator
            </p>
            <p style={{ fontSize: 10, color: C.inkLt, marginTop: 6, letterSpacing: "0.04em" }}>
              PDF • Rendering Engine • v3.1
            </p>
          </div>

          <nav style={{ flex: 1, padding: "12px 0", overflowY: "auto" }}>
            {STEPS.map(s => {
              const done = activeStep > s.id
              const active = activeStep === s.id
              const locked = !canOpenStep(s.id, appState)
              return (
                <button key={s.id} onClick={() => !locked && setStep(s.id)} disabled={locked}
                  style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "10px 20px", border: "none", outline: "none", background: active ? C.bgMuted : "transparent", cursor: locked ? "not-allowed" : "pointer", transition: "background 0.15s", borderLeft: active ? `2px solid ${C.ink}` : "2px solid transparent" }}>
                  <div className="step-dot"
                    style={{ width: 22, height: 22, borderRadius: "50%", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 600, letterSpacing: "0.02em", background: done ? C.sage : active ? C.ink : "transparent", border: done ? "none" : active ? "none" : `1.5px solid ${C.borderMd}`, color: done || active ? "#fff" : C.inkLt }}>
                    {done ? "✓" : s.icon}
                  </div>
                  <p style={{ fontSize: 12, fontWeight: active ? 500 : 400, color: done ? C.sage : active ? C.ink : C.inkLt, lineHeight: 1 }}>
                    {s.label}
                  </p>
                </button>
              )
            })}
          </nav>

          <div style={{ padding: "16px 20px", borderTop: `1px solid ${C.border}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 30, height: 30, borderRadius: "50%", background: C.bgMuted, border: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 600, color: C.inkMd }}>T</div>
              <div>
                <p style={{ fontSize: 11, fontWeight: 500, color: C.ink }}>Handwriting #1</p>
                <p style={{ fontSize: 10, color: C.inkLt, marginTop: 1 }}>{sidebarGlyphCount} • 10 MB max</p>
              </div>
            </div>
          </div>
        </aside>

        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
          <header style={{ height: 56, flexShrink: 0, background: C.bgCard, borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", padding: "0 28px", gap: 12 }}>
            <div>
              <span style={{ fontSize: 15, fontWeight: 500, color: C.ink }}>{STEPS[activeStep - 1].label}</span>
              <span style={{ fontSize: 12, color: C.inkLt, marginLeft: 8 }}>• Step {activeStep} of {STEPS.length}</span>
            </div>
            <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
              {activeStep > 1 && <Btn onClick={() => setStep(s => s - 1)} variant="ghost" size="sm">← Back</Btn>}
              {nextLabel[activeStep] && <Btn onClick={handleNext} disabled={!canNext} variant="primary" size="sm">{nextLabel[activeStep]}</Btn>}
            </div>
          </header>

          <main style={{ flex: 1, overflowY: "auto", padding: activeStep === 5 ? 0 : "28px 32px", background: activeStep === 5 ? "#E7E6E6" : C.bg }}>
            {/* Step 4 — hidden but kept mounted once glyphs exist, to preserve ttfBuffer.
                Uses activeStep (synchronously safe) so lazy-import never fires while
                the navigation guard redirects away. */}
            {(appState.glyphResult?.glyphs?.length ?? 0) > 0 && (
              <div style={{ display: activeStep === 4 ? "contents" : "none" }}>
                <ErrorBoundary key={`step4-${appState.parsedFile?.file?.name}`}>
                  <Suspense fallback={<StepLoader />}>
                    <Step4
                      glyphs={appState.glyphResult?.glyphs ?? []}
                      fontStyle={appState.fontStyle}
                      onFontStyleChange={handleFontStyleChange}
                      onFontReady={handleFontReady}
                    />
                  </Suspense>
                </ErrorBoundary>
              </div>
            )}

            {activeStep === 1 && <ErrorBoundary key="step1"><Step1 /></ErrorBoundary>}

            {activeStep === 2 && (
              <ErrorBoundary key="step2">
                <Step2 parsedFile={appState.parsedFile} onParsed={handleParsed} onClear={handleClearPdf} />
              </ErrorBoundary>
            )}

            {activeStep === 3 && (
              <ErrorBoundary key={`step3-${appState.parsedFile?.file?.name}`}>
                <Step3 parsedFile={appState.parsedFile} onGlyphsUpdate={handleGlyphsUpdate} pipelineMachine={pipeline.machine} />
              </ErrorBoundary>
            )}

            {activeStep === 5 && (
              <ErrorBoundary key="step5">
                <Suspense fallback={<StepLoader />}>
                  <Step5
                    versionedGlyphs={appState.versionedGlyphs}
                    extractedGlyphs={appState.glyphResult?.glyphs ?? []}
                    ttfBuffer={appState.ttfBuffer}
                    puaMap={appState.puaMap}
                    fontStyle={appState.fontStyle}
                  />
                </Suspense>
              </ErrorBoundary>
            )}
          </main>

          <div style={{ height: 3, background: C.border }}>
            <div style={{ height: "100%", background: C.ink, transition: "width 0.4s ease", width: `${(activeStep / STEPS.length) * 100}%` }} />
          </div>
        </div>
      </div>
    </>
  )
}

// ─── Navigation guard ─────────────────────────────────────────────────────────
export function canOpenStep(targetStep, appState) {
  const parsed      = appState.parsedFile
  const glyphResult = appState.glyphResult
  switch (targetStep) {
    case 1: return true
    case 2: return true
    case 3: return parsed !== null && parsed.status === "parsed" && Array.isArray(parsed.characters) && parsed.characters.length > 0
    case 4: return (glyphResult?.glyphs?.length ?? 0) > 0
    case 5: return (glyphResult?.glyphs?.length ?? 0) > 0
    default: return false
  }
}
