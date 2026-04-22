import { useEffect, useMemo, useState } from "react"
import Btn from "./components/Btn"
import Step1 from "./steps/Step1"
import Step2 from "./steps/Step2"
import Step3 from "./steps/Step3"
import Step4 from "./steps/Step4.jsx"
import { buildVersionedGlyphs } from "./lib/glyphVersions.js"
import Step5 from "./steps/Step5"
import C from "./styles/colors"

// ─── Step definitions ────────────────────────────────────────────────────────
const STEPS = [
  { id: 1, label: "Generate Template", icon: "01" },
  { id: 2, label: "Upload PDF",        icon: "02" },
  { id: 3, label: "ตรวจ Glyphs",       icon: "03" },
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
// parsedFile is the SINGLE SOURCE OF TRUTH — written by Step 2, read by all later steps.
// Nothing from Step 1 flows downstream. Step 1 is a print-only utility.
const INITIAL_STATE = {
  parsedFile: null,    // { file, characters, charSource, metadata, pages, status }
  glyphResult: null,   // { glyphs, tracedGlyphs, validationStatus }
  versionedGlyphs: [],
  ttfBuffer: null,     // ArrayBuffer จาก compileFontBuffer ใน Step 4 → ใช้ใน Step 5
}

export default function App() {
  const [step, setStep] = useState(1)

  // ── Single source of truth ────────────────────────────────────────────────
  const [appState, setAppState] = useState(INITIAL_STATE)

  // Derive versioned glyphs whenever glyphResult changes
  useEffect(() => {
    const glyphs = appState.glyphResult?.glyphs ?? []
    if (glyphs.length === 0) {
      setAppState(prev => ({ ...prev, versionedGlyphs: [] }))
      return
    }
    setAppState(prev => ({
      ...prev,
      versionedGlyphs: buildVersionedGlyphs(glyphs),
    }))
  }, [appState.glyphResult])

  // ── Navigation guard: redirect if required data is missing ───────────────
  useEffect(() => {
    if (!canOpenStep(step, appState)) {
      const fallback = [4, 3, 2, 1].find(s => canOpenStep(s, appState)) ?? 2
      setStep(fallback)
    }
  }, [step, appState.parsedFile, appState.glyphResult])

  // ─── Step 2 handler: receives fully-parsed data ───────────────────────────
  const handleParsed = (parsedFile) => {
    setAppState({
      parsedFile,
      glyphResult: null,          // reset downstream on new file
      versionedGlyphs: [],
    })
  }

  const handleClearPdf = () => {
    setAppState(INITIAL_STATE)
  }

  // ─── Step 4 handler: รับ TTF buffer หลัง compile เสร็จ ──────────────────
  const handleFontReady = (ttfBuffer) => {
    setAppState(prev => ({ ...prev, ttfBuffer }))
  }

  // ─── Step 3 handler ───────────────────────────────────────────────────────
  const handleGlyphsUpdate = (glyphs) => {
    setAppState(prev => ({
      ...prev,
      glyphResult: {
        glyphs,
        validationStatus: glyphs.length > 0 ? "ok" : "empty",
      },
    }))
  }

  // ─── Navigation ───────────────────────────────────────────────────────────
  const handleNext = () => {
    setStep(s => Math.min(STEPS.length, s + 1))
  }

  // ─── Sidebar glyph count (data-driven, not Step 1 count) ─────────────────
  const sidebarGlyphCount = useMemo(() => {
    if (appState.glyphResult?.glyphs?.length > 0)
      return `${appState.glyphResult.glyphs.length} glyphs`
    if (appState.parsedFile?.metadata?.detectedSlots > 0)
      return `${appState.parsedFile.metadata.detectedSlots} slots`
    return "—"
  }, [appState.parsedFile, appState.glyphResult])

  // ─── canNext per step ─────────────────────────────────────────────────────
  const canNext = useMemo(() => {
    switch (step) {
      case 1: return true   // Step 1 is optional, always allow proceeding
      case 2: return appState.parsedFile?.status === "parsed"
      case 3: return (appState.glyphResult?.glyphs?.length ?? 0) > 0
      case 4: return appState.versionedGlyphs.length > 0
      default: return false
    }
  }, [step, appState])

  // ─── Step content ─────────────────────────────────────────────────────────
  const content = {
    1: (
      // Step 1 is a self-contained template generator.
      // It has NO props connecting to appState — it is fully isolated.
      <Step1 />
    ),
    2: (
      <Step2
        parsedFile={appState.parsedFile}
        onParsed={handleParsed}
        onClear={handleClearPdf}
      />
    ),
    3: (
      <Step3
        parsedFile={appState.parsedFile}
        onGlyphsUpdate={handleGlyphsUpdate}
      />
    ),
    4: null,  // Step4 render แยกใน main เพื่อป้องกัน unmount (ดูด้านล่าง)
    5: (
      <Step5
        versionedGlyphs={appState.versionedGlyphs}
        extractedGlyphs={appState.glyphResult?.glyphs ?? []}
        ttfBuffer={appState.ttfBuffer}
      />
    ),
  }

  const nextLabel = {
    1: "ถัดไป →",
    2: "ถัดไป →",
    3: "สร้าง DNA →",
    4: "Preview →",
    5: null,
  }

  return (
    <>
      <FontLoader />
      <div className="hw-app" style={{ display: "flex", height: "100vh", overflow: "hidden" }}>

        {/* ── Sidebar ─────────────────────────────────────────────────────── */}
        <aside
          style={{
            width: 220,
            minWidth: 220,
            background: C.bgCard,
            borderRight: `1px solid ${C.border}`,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div style={{ padding: "24px 20px 20px", borderBottom: `1px solid ${C.border}` }}>
            <p style={{ fontFamily: "'DM Serif Display', serif", fontSize: 17, color: C.ink, lineHeight: 1.2 }}>
              Handwriting<br />Generator
            </p>
            <p style={{ fontSize: 10, color: C.inkLt, marginTop: 6, letterSpacing: "0.04em" }}>
              PDF • Rendering Engine • v3.0
            </p>
          </div>

          <nav style={{ flex: 1, padding: "12px 0", overflowY: "auto" }}>
            {STEPS.map(s => {
              const done   = step > s.id
              const active = step === s.id
              const locked = !canOpenStep(s.id, appState)
              return (
                <button
                  key={s.id}
                  onClick={() => !locked && setStep(s.id)}
                  disabled={locked}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "10px 20px",
                    border: "none",
                    outline: "none",
                    background: active ? C.bgMuted : "transparent",
                    cursor: locked ? "not-allowed" : "pointer",
                    transition: "background 0.15s",
                    borderLeft: active ? `2px solid ${C.ink}` : "2px solid transparent",
                  }}
                >
                  <div
                    className="step-dot"
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: "50%",
                      flexShrink: 0,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 9,
                      fontWeight: 600,
                      letterSpacing: "0.02em",
                      background: done ? C.sage : active ? C.ink : "transparent",
                      border: done ? "none" : active ? "none" : `1.5px solid ${C.borderMd}`,
                      color: done || active ? "#fff" : C.inkLt,
                    }}
                  >
                    {done ? "✓" : s.icon}
                  </div>
                  <div style={{ textAlign: "left" }}>
                    <p style={{
                      fontSize: 12,
                      fontWeight: active ? 500 : 400,
                      color: done ? C.sage : active ? C.ink : C.inkLt,
                      lineHeight: 1,
                    }}>
                      {s.label}
                    </p>
                  </div>
                </button>
              )
            })}
          </nav>

          <div style={{ padding: "16px 20px", borderTop: `1px solid ${C.border}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{
                width: 30, height: 30, borderRadius: "50%",
                background: C.bgMuted, border: `1px solid ${C.border}`,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 11, fontWeight: 600, color: C.inkMd,
              }}>T</div>
              <div>
                <p style={{ fontSize: 11, fontWeight: 500, color: C.ink }}>ลายมือ #1</p>
                {/* Data-driven count — never shows Step 1 selection count */}
                <p style={{ fontSize: 10, color: C.inkLt, marginTop: 1 }}>
                  {sidebarGlyphCount} • 10 MB max
                </p>
              </div>
            </div>
          </div>
        </aside>

        {/* ── Main area ────────────────────────────────────────────────────── */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
          <header style={{
            height: 56, flexShrink: 0,
            background: C.bgCard, borderBottom: `1px solid ${C.border}`,
            display: "flex", alignItems: "center", padding: "0 28px", gap: 12,
          }}>
            <div>
              <span style={{ fontSize: 15, fontWeight: 500, color: C.ink }}>
                {STEPS[step - 1].label}
              </span>
              <span style={{ fontSize: 12, color: C.inkLt, marginLeft: 8 }}>
                • Step {step} of {STEPS.length}
              </span>
            </div>
            <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
              {step > 1 && (
                <Btn onClick={() => setStep(s => s - 1)} variant="ghost" size="sm">
                  ← กลับ
                </Btn>
              )}
              {nextLabel[step] && (
                <Btn onClick={handleNext} disabled={!canNext} variant="primary" size="sm">
                  {nextLabel[step]}
                </Btn>
              )}
            </div>
          </header>

          <main style={{
            flex: 1, overflowY: "auto",
            padding: step === 5 ? 0 : "28px 32px",
            background: step === 5 ? "#E7E6E6" : C.bg,
          }}>
            {/* Step 4 mount เมื่อ glyphs พร้อมแล้วเท่านั้น (มี glyphResult)
                ซ่อนด้วย display:none แทน unmount เพื่อให้ ttfBuffer คงอยู่ถึง Step 5
                ไม่ mount ตั้งแต่ step 1-3 เพื่อป้องกัน auto-build ก่อนเวลา */}
            {(appState.glyphResult?.glyphs?.length ?? 0) > 0 && (
              <div style={{ display: step === 4 ? "contents" : "none" }}>
                <Step4
                  glyphs={appState.glyphResult?.glyphs ?? []}
                  onFontReady={handleFontReady}
                />
              </div>
            )}
            {step !== 4 && content[step]}
          </main>

          <div style={{ height: 3, background: C.border }}>
            <div style={{
              height: "100%",
              background: C.ink,
              transition: "width 0.4s ease",
              width: `${(step / STEPS.length) * 100}%`,
            }} />
          </div>
        </div>
      </div>
    </>
  )
}

// ─── Navigation guard (pure function — no closure over stale state) ───────────
// Exported for testing.
export function canOpenStep(targetStep, appState) {
  const parsed     = appState.parsedFile
  const glyphResult = appState.glyphResult

  switch (targetStep) {
    case 1: return true   // always available — optional tool
    case 2: return true   // always available — entry point

    case 3:
      // Requires: file uploaded AND characters detected from PDF
      return (
        parsed !== null &&
        parsed.status === "parsed" &&
        Array.isArray(parsed.characters) &&
        parsed.characters.length > 0
      )

    case 4:
      // Requires: at least one extracted glyph
      return (glyphResult?.glyphs?.length ?? 0) > 0

    case 5:
      return (glyphResult?.glyphs?.length ?? 0) > 0

    default:
      return false
  }
}