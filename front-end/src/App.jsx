import { useState } from "react"
import Btn from "./components/Btn"
import Step1 from "./steps/Step1"
import Step2 from "./steps/Step2"
import Step3 from "./steps/Step3"
import Step4 from "./steps/Step4"
import Step5 from "./steps/Step5"
import C from "./styles/colors"

const STEPS = [
  { id: 1, label: "เลือกตัวอักษร", icon: "01" },
  { id: 2, label: "Upload PDF", icon: "02" },
  { id: 3, label: "ตรวจ Glyphs", icon: "03" },
  { id: 4, label: "DNA Profile", icon: "04" },
  { id: 5, label: "Preview", icon: "05" },
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

export default function App() {
  const [step, setStep] = useState(1)
  const [selected, setSelected] = useState(() => new Set())
  const [uploaded, setUploaded] = useState(false)
  const [uploadedPdf, setUploadedPdf] = useState(null)
  const [templateChars, setTemplateChars] = useState([])
  const [analyzedGlyphs, setAnalyzedGlyphs] = useState([])

  const toggle = ch =>
    setSelected(prev => {
      const next = new Set(prev)
      next.has(ch) ? next.delete(ch) : next.add(ch)
      return next
    })

  const selectAllChars = chars => {
    setSelected(new Set(chars))
  }

  const addChars = chars =>
    setSelected(prev => {
      const next = new Set(prev)
      chars.forEach(ch => next.add(ch))
      return next
    })

  const removeChars = chars =>
    setSelected(prev => {
      const next = new Set(prev)
      chars.forEach(ch => next.delete(ch))
      return next
    })

  const clearAllChars = () => setSelected(new Set())

  const handleUploadPdf = file => {
    setUploadedPdf(file)
    setUploaded(true)
    setAnalyzedGlyphs([])
  }

  const handleClearPdf = () => {
    setUploadedPdf(null)
    setUploaded(false)
    setAnalyzedGlyphs([])
  }

  const escapeHtml = text =>
    text
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;")

  const toCellCode = index => `HG${String(index + 1).padStart(3, "0")}`

  const generateTemplatePdf = () => {
    const chars = [...selected]
    if (chars.length === 0) return
    setTemplateChars(chars)

    const cells = chars
      .map(
        (ch, index) => `
          <div class="cell">
            <span class="cell-label">${escapeHtml(ch)}</span>
            <span class="cell-anchor">${toCellCode(index)}</span>
            <div class="guide guide-top"></div>
            <div class="guide guide-mid"></div>
            <div class="guide guide-base"></div>
          </div>
        `
      )
      .join("")

    const now = new Date().toLocaleString("th-TH")
    const html = `
      <!doctype html>
      <html lang="th">
        <head>
          <meta charset="utf-8" />
          <title>Handwriting Template</title>
          <style>
            @page { size: A4; margin: 14mm; }
            * { box-sizing: border-box; }
            body {
              margin: 0;
              font-family: "TH Sarabun New", "Noto Sans Thai", "Tahoma", sans-serif;
              color: #193656;
              background: #FFFFFF;
            }
            .header {
              margin-bottom: 6mm;
              padding: 4mm 0 5mm;
              border-bottom: 1px solid #C5D5E6;
            }
            .title { font-size: 18px; font-weight: 700; margin: 0 0 3px; }
            .meta { font-size: 11px; color: #4B6480; margin: 0; }
            .grid {
              display: grid;
              grid-template-columns: repeat(6, 1fr);
              gap: 7px;
            }
            .cell {
              position: relative;
              border: 1.1px solid #8EA9C7;
              border-radius: 6px;
              background: #FFFFFF;
              aspect-ratio: 1 / 1;
              overflow: hidden;
            }
            .cell-label {
              position: absolute;
              top: 3px;
              left: 5px;
              font-size: 10px;
              color: #4F6B89;
              z-index: 2;
              font-family: "DM Sans", Arial, sans-serif;
              line-height: 1;
            }
            .cell-anchor {
              position: absolute;
              top: 1px;
              left: 1px;
              font-size: 1px;
              opacity: 0;
              color: transparent;
              z-index: 0;
              user-select: none;
            }
            .guide {
              position: absolute;
              left: 4%;
              width: 92%;
              border-top: 1px solid #A8C1DD;
              pointer-events: none;
            }
            .guide-top { top: 24%; }
            .guide-mid { top: 49%; }
            .guide-base { top: 75%; }
            .footer {
              margin-top: 5mm;
              text-align: right;
              font-size: 10px;
              color: #5C7694;
              font-family: "DM Sans", Arial, sans-serif;
            }
            @media print { .no-print { display: none; } }
          </style>
        </head>
        <body>
          <div class="header">
            <h1 class="title">Handwriting Generator Template</h1>
            <p class="meta">Total glyphs: ${chars.length} • Generated: ${escapeHtml(now)}</p>
            <p class="meta">Cell code format: HGxxx (ใช้ยึดตำแหน่งตอนอัปโหลดกลับใน Step 3)</p>
          </div>
          <div class="grid">${cells}</div>
          <p class="footer">Practice sheet • Trace over the dotted shape</p>
          <script>
            window.addEventListener("load", () => {
              const runPrint = () => setTimeout(() => window.print(), 220);
              if (document.fonts && document.fonts.ready) {
                document.fonts.ready.then(runPrint);
              } else {
                runPrint();
              }
            });
          </script>
        </body>
      </html>
    `

    const blob = new Blob([html], { type: "text/html;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const printWindow = window.open(url, "_blank")
    if (!printWindow) {
      window.alert("ไม่สามารถเปิดหน้าต่างพิมพ์ได้ กรุณาอนุญาต pop-up ก่อน")
      return
    }
    // Keep the blob URL alive long enough for print to complete.
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }

  const handleNext = () => {
    if (step === 1) {
      generateTemplatePdf()
      setStep(2)
      return
    }
    setStep(s => s + 1)
  }

  const selectedCount = templateChars.length > 0 ? templateChars.length : selected.size
  const hasChars = selectedCount > 0
  const canNext = step === 1 ? hasChars : step === 2 ? uploaded && hasChars : true

  const canOpenStep = targetStep => {
    if (targetStep === 1) return true
    if (targetStep === 2) return hasChars
    if (targetStep === 3) return hasChars && uploaded
    if (targetStep === 4) return hasChars && uploaded
    if (targetStep === 5) return hasChars && uploaded
    return false
  }
  const content = {
    1: (
      <Step1
        selected={selected}
        onToggle={toggle}
        onSelectAll={selectAllChars}
        onAddChars={addChars}
        onRemoveChars={removeChars}
        onClearAll={clearAllChars}
      />
    ),
    2: <Step2 uploaded={uploaded} pdfFile={uploadedPdf} onUpload={handleUploadPdf} onClear={handleClearPdf} />,
    3: (
      <Step3
        selected={selected}
        pdfFile={uploadedPdf}
        templateChars={templateChars}
        onGlyphsUpdate={setAnalyzedGlyphs}
      />
    ),
    4: <Step4 selected={selected} templateChars={templateChars} extractedGlyphs={analyzedGlyphs} />,
    5: <Step5 />,
  }
  const nextLabel = {
    1: "Generate Template →",
    2: "ถัดไป →",
    3: "สร้าง DNA →",
    4: "Preview →",
    5: null,
  }

  return (
    <>
      <FontLoader />
      <div className="hw-app" style={{ display: "flex", height: "100vh", overflow: "hidden" }}>
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
            <p
              style={{
                fontFamily: "'DM Serif Display', serif",
                fontSize: 17,
                color: C.ink,
                lineHeight: 1.2,
              }}
            >
              Handwriting
              <br />
              Generator
            </p>
            <p style={{ fontSize: 10, color: C.inkLt, marginTop: 6, letterSpacing: "0.04em" }}>
              PDF • Rendering Engine • v2.7
            </p>
          </div>

          <nav style={{ flex: 1, padding: "12px 0", overflowY: "auto" }}>
            {STEPS.map(s => {
              const done = step > s.id
              const active = step === s.id
              const locked = !canOpenStep(s.id)
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
                    <p
                      style={{
                        fontSize: 12,
                        fontWeight: active ? 500 : 400,
                        color: done ? C.sage : active ? C.ink : C.inkLt,
                        lineHeight: 1,
                      }}
                    >
                      {s.label}
                    </p>
                  </div>
                </button>
              )
            })}
          </nav>

          <div style={{ padding: "16px 20px", borderTop: `1px solid ${C.border}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: "50%",
                  background: C.bgMuted,
                  border: `1px solid ${C.border}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 11,
                  fontWeight: 600,
                  color: C.inkMd,
                }}
              >
                T
              </div>
              <div>
                <p style={{ fontSize: 11, fontWeight: 500, color: C.ink }}>ลายมือ #1</p>
                <p style={{ fontSize: 10, color: C.inkLt, marginTop: 1 }}>
                  {selectedCount} glyphs • 50 MB max
                </p>
              </div>
            </div>
          </div>
        </aside>

        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
          <header
            style={{
              height: 56,
              flexShrink: 0,
              background: C.bgCard,
              borderBottom: `1px solid ${C.border}`,
              display: "flex",
              alignItems: "center",
              padding: "0 28px",
              gap: 12,
            }}
          >
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
                <Btn
                  onClick={handleNext}
                  disabled={!canNext}
                  variant="primary"
                  size="sm"
                >
                  {nextLabel[step]}
                </Btn>
              )}
            </div>
          </header>

          <main style={{ flex: 1, overflowY: "auto", padding: "28px 32px", background: C.bg }}>
            {content[step]}
          </main>

          <div style={{ height: 3, background: C.border }}>
            <div
              style={{
                height: "100%",
                background: C.ink,
                transition: "width 0.4s ease",
                width: `${(step / STEPS.length) * 100}%`,
              }}
            />
          </div>
        </div>
      </div>
    </>
  )
}


