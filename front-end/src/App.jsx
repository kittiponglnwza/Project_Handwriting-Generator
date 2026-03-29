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
  const [selected, setSelected] = useState(() => {
    const s = new Set()
    "กขคงจABC012".split("").forEach(c => s.add(c))
    return s
  })
  const [uploaded, setUploaded] = useState(false)
  const [uploadedPdf, setUploadedPdf] = useState(null)
  const [templateChars, setTemplateChars] = useState([])

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
  }

  const handleClearPdf = () => {
    setUploadedPdf(null)
    setUploaded(false)
  }

  const escapeHtml = text =>
    text
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;")

  const generateTemplatePdf = () => {
    const chars = [...selected]
    if (chars.length === 0) return
    setTemplateChars(chars)

    const cells = chars
      .map(
        (ch, index) => `
          <div class="cell">
            <span class="cell-index">${index + 1}</span>
            <svg class="trace-svg" viewBox="0 0 100 100" aria-hidden="true">
              <text x="50" y="56" text-anchor="middle" dominant-baseline="middle" class="trace-char">${escapeHtml(ch)}</text>
            </svg>
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
              color: #1E3955;
              background: #F8FBFF;
            }
            .header {
              margin-bottom: 8mm;
              padding: 6mm 7mm;
              border: 1.5px dashed #9CB6D3;
              border-radius: 12px;
              background: #FFFFFF;
            }
            .title { font-size: 20px; font-weight: 700; margin: 0 0 4px; }
            .meta { font-size: 12px; color: #4B6480; margin: 0; }
            .grid {
              display: grid;
              grid-template-columns: repeat(6, 1fr);
              gap: 8px;
            }
            .cell {
              position: relative;
              border: 1.4px dashed #9CB6D3;
              border-radius: 10px;
              background: #FFFFFF;
              aspect-ratio: 1 / 1;
              overflow: hidden;
            }
            .cell-index {
              position: absolute;
              top: 4px;
              left: 6px;
              font-size: 10px;
              color: #6E87A3;
              z-index: 2;
              font-family: "DM Sans", Arial, sans-serif;
            }
            .trace-svg {
              width: 100%;
              height: 100%;
              display: block;
            }
            .trace-char {
              font-family: "TH Sarabun New", "Noto Sans Thai", "Tahoma", sans-serif;
              font-size: 58px;
              fill: rgba(44, 70, 99, 0.03);
              stroke: #325273;
              stroke-width: 1.6;
              stroke-linecap: round;
              stroke-linejoin: round;
              stroke-dasharray: 1.2 5.4;
              paint-order: stroke;
            }
            .guide {
              position: absolute;
              left: 6%;
              width: 88%;
              border-top: 1px dashed #B4C8DF;
              pointer-events: none;
            }
            .guide-mid { top: 42%; }
            .guide-base { top: 72%; }
            .footer {
              margin-top: 6mm;
              text-align: right;
              font-size: 11px;
              color: #6E87A3;
              font-family: "DM Sans", Arial, sans-serif;
            }
            @media print { .no-print { display: none; } }
          </style>
        </head>
        <body>
          <div class="header">
            <h1 class="title">Handwriting Generator Template</h1>
            <p class="meta">Total glyphs: ${chars.length} • Generated: ${escapeHtml(now)}</p>
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

  const canNext = step === 1 ? selected.size > 0 : step === 2 ? uploaded : true
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
    3: <Step3 selected={selected} pdfFile={uploadedPdf} templateChars={templateChars} />,
    4: <Step4 />,
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
              const locked = s.id > step + 1
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
                  {selected.size} glyphs • 50 MB max
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


