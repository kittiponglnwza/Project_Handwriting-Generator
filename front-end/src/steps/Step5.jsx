/**
 * STEP 5 — HANDWRITING FONT EDITOR
 * Live typing with your own handwriting glyphs
 * Word + Canva minimal premium UI
 */

import { useState, useRef, useCallback, useEffect, useMemo } from "react"

// Inject @keyframes spin ตรงนี้เพื่อ guarantee ว่า spinner ทำงาน
if (typeof document !== 'undefined' && !document.getElementById('step5-keyframes')) {
  const s = document.createElement('style')
  s.id = 'step5-keyframes'
  s.textContent = '@keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }'
  document.head.appendChild(s)
}

// ─── Tokens ───────────────────────────────────────────────────────────────────
const C = {
  bg:       "#F8F7F4",
  canvas:   "#FFFFFF",
  toolbar:  "#FFFFFF",
  sidebar:  "#FAFAF9",
  ink:      "#1A1A18",
  inkMd:    "#6B6B67",
  inkLt:    "#ADADAA",
  border:   "#E8E6E0",
  borderMd: "#D4D0C8",
  accent:   "#2C2C2A",
  blue:     "#3B6FE8",
  green:    "#2D9E6B",
  amber:    "#D4820A",
  red:      "#D94F3D",
  purple:   "#7C3AED",
  shadow:   "0 1px 3px rgba(0,0,0,.06), 0 4px 16px rgba(0,0,0,.06)",
  shadowLg: "0 4px 24px rgba(0,0,0,.10), 0 1px 4px rgba(0,0,0,.06)",
}

// ─── Paper backgrounds ────────────────────────────────────────────────────────
const PAPERS = [
  { id: "clean",   label: "สะอาด",   bg: "#FFFFFF", lines: false, ruled: false },
  { id: "ruled",   label: "เส้น",    bg: "#FFFFFF", lines: true,  ruled: false },
  { id: "grid",    label: "ตาราง",   bg: "#FFFFFF", lines: false, ruled: true  },
  { id: "ivory",   label: "ไอวอรี",  bg: "#FDFBF4", lines: false, ruled: false },
  { id: "kraft",   label: "กระดาษ",  bg: "#F0E8D5", lines: false, ruled: false },
  { id: "dark",    label: "มืด",     bg: "#1C1C1E", lines: false, ruled: false },
]

// ─── Font size presets ────────────────────────────────────────────────────────
const SIZES = [10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 42, 48, 56, 64, 72, 96]

// ─── Style presets ────────────────────────────────────────────────────────────
const PRESETS = [
  { id: "body",    label: "Body",      size: 18, lh: 1.8, ls: 0.02  },
  { id: "heading", label: "Heading",   size: 36, lh: 1.4, ls: -0.01 },
  { id: "note",    label: "Note",      size: 14, lh: 2.0, ls: 0.01  },
  { id: "large",   label: "Display",   size: 64, lh: 1.2, ls: -0.02 },
  { id: "sign",    label: "Signature", size: 48, lh: 1.3, ls: 0.04  },
]

// ─── A4 dimensions ────────────────────────────────────────────────────────────
const A4W    = 794
const A4H    = 1123
const MARGIN = 64

const FONT_FAMILY  = 'MyHandwriting'
const STYLE_TAG_ID = 'my-handwriting-font-face'

export default function Step5({ versionedGlyphs = [], extractedGlyphs = [], ttfBuffer = null }) {

  // ── Build lookup: char → glyph[] (Map, keyed by codepoint, value = array of all variants)
  // versionedGlyphs has 3 variants per char (ver 1/2/3 from deformPath).
  // tokens.js expects Map<ch, glyph[]> so it can pick randomly across variants.
  const glyphMap = useMemo(() => {
    const map = new Map()
    const source = versionedGlyphs.length > 0 ? versionedGlyphs : extractedGlyphs
    for (const g of source) {
      if (!g.ch) continue
      if (!map.has(g.ch)) map.set(g.ch, [])
      map.get(g.ch).push(g)
    }
    return map
  }, [versionedGlyphs, extractedGlyphs])

  // ── Plain object view of glyphMap for legacy code (missingChars, Coverage, Glyph Library) ──
  const glyphMapObj = useMemo(() => {
    const obj = {}
    for (const [ch, arr] of glyphMap) obj[ch] = arr[0]
    return obj
  }, [glyphMap])

  // ── Font injection: 'idle' | 'loading' | 'ready' | 'error' ──────────────
  const [fontStatus, setFontStatus] = useState('idle')
  const fontUrlRef = useRef(null)

  useEffect(() => {
    if (!ttfBuffer) {
      setFontStatus('idle')
      return
    }

    setFontStatus('loading')

    // Revoke URL เก่าก่อน
    if (fontUrlRef.current) {
      URL.revokeObjectURL(fontUrlRef.current)
      fontUrlRef.current = null
    }

    const blob = new Blob([ttfBuffer], { type: 'font/ttf' })
    const url  = URL.createObjectURL(blob)
    fontUrlRef.current = url

    // Inject @font-face ผ่าน <style> tag
    let styleEl = document.getElementById(STYLE_TAG_ID)
    if (!styleEl) {
      styleEl = document.createElement('style')
      styleEl.id = STYLE_TAG_ID
      document.head.appendChild(styleEl)
    }
    styleEl.textContent = [
      `@font-face {`,
      `  font-family: '${FONT_FAMILY}';`,
      `  src: url('${url}') format('truetype');`,
      `  font-weight: normal;`,
      `  font-style: normal;`,
      `  font-display: block;`,
      `}`,
    ].join('\n')

    // FontFace API: รู้ว่า load เสร็จจริงๆ แล้ว set ready
    const ff = new FontFace(FONT_FAMILY, `url('${url}')`)
    ff.load()
      .then(loaded => { document.fonts.add(loaded); setFontStatus('ready') })
      .catch(err   => { console.error('[Step5] font load failed:', err); setFontStatus('error') })

    return () => {
      if (fontUrlRef.current) {
        URL.revokeObjectURL(fontUrlRef.current)
        fontUrlRef.current = null
      }
    }
  }, [ttfBuffer])

  // ── Editor state ─────────────────────────────────────────────────────────
  const [text, setText]         = useState("สวัสดีชาวโลก\nนี่คือลายมือของฉัน")
  const [fontSize, setFontSize] = useState(32)
  const [lineHeight, setLH]     = useState(1.8)
  const [letterSp, setLS]       = useState(0.02)
  const [textAlign, setAlign]   = useState("left")
  const [paper, setPaper]       = useState("clean")
  const [showSidebar, setSB]    = useState(true)
  const [zoom, setZoom]         = useState(0.8)
  const [signMode, setSign]     = useState(false)
  const [activeTool, setTool]   = useState("style")
  const [exporting, setExp]     = useState(null)
  const [copied, setCopied]     = useState(false)

  const paperRef = useRef(null)

  const paperCfg = PAPERS.find(p => p.id === paper) ?? PAPERS[0]
  const isDark   = paperCfg.bg === "#1C1C1E"

  const applyPreset = p => { setFontSize(p.size); setLH(p.lh); setLS(p.ls) }

  // ── Copy text ─────────────────────────────────────────────────────────────
  const copyText = async () => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  // ── Export PNG ────────────────────────────────────────────────────────────
  const exportPNG = useCallback(async () => {
    if (!paperRef.current) return
    setExp("png")
    // รอให้ font render ก่อน
    await new Promise(r => setTimeout(r, 150))

    try {
      const node  = paperRef.current
      const SCALE = 2  // 2× = Retina resolution
      const w     = node.offsetWidth
      const h     = node.offsetHeight

      // ── ใช้ html2canvas (CDN) เพื่อให้ custom font ถูก capture จริง ──
      // XMLSerializer + SVG foreignObject จะ block custom font บน Chrome
      const h2c = await import('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.esm.min.js')
        .catch(() => null)

      if (h2c) {
        const canvas = await h2c.default(node, {
          scale:           SCALE,
          useCORS:         true,
          allowTaint:      false,
          backgroundColor: null,
          logging:         false,
          width:           w,
          height:          h,
        })
        canvas.toBlob(pngBlob => {
          const a    = document.createElement("a")
          a.href     = URL.createObjectURL(pngBlob)
          a.download = `handwriting-${Date.now()}.png`
          a.click()
          setTimeout(() => URL.revokeObjectURL(a.href), 5000)
        }, "image/png")
      } else {
        // Fallback: ใช้ Canvas drawImage จาก font-face ที่ inject ไว้
        // วาด text โดยตรงบน canvas ด้วย font ที่ถูก load แล้ว
        const canvas   = document.createElement("canvas")
        canvas.width   = w * SCALE
        canvas.height  = h * SCALE
        const ctx      = canvas.getContext("2d")

        // วาด background
        ctx.fillStyle = paperRef.current.style.background || "#FFFFFF"
        ctx.fillRect(0, 0, canvas.width, canvas.height)

        // วาด text ด้วย font ที่ inject ไว้
        ctx.scale(SCALE, SCALE)
        ctx.font      = `${fontSize}px '${FONT_FAMILY}', 'Noto Sans Thai', sans-serif`
        ctx.fillStyle = C.ink
        ctx.textBaseline = "top"

        const lines = text.split("\n")
        const lhPx  = fontSize * lineHeight
        const padX  = A4W * zoom * (MARGIN / A4W)  // ≈ MARGIN * zoom
        const padY  = padX
        lines.forEach((line, i) => {
          ctx.fillText(line, padX, padY + i * lhPx)
        })

        canvas.toBlob(pngBlob => {
          const a    = document.createElement("a")
          a.href     = URL.createObjectURL(pngBlob)
          a.download = `handwriting-${Date.now()}.png`
          a.click()
          setTimeout(() => URL.revokeObjectURL(a.href), 5000)
        }, "image/png")
      }
    } catch (err) {
      console.error("[exportPNG] failed:", err)
      // Last-resort fallback — เปิดแท็บใหม่
      const node = paperRef.current
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
        <style>body{margin:0;background:#E8E4DC;display:flex;justify-content:center;padding:40px}</style>
        </head><body>${node.outerHTML}</body></html>`
      const b    = new Blob([html], { type: "text/html" })
      window.open(URL.createObjectURL(b), "_blank")
    }

    setExp(null)
  }, [text, fontSize, lineHeight, zoom])

  // ── Font family string: ใช้ MyHandwriting ถ้า ready, fallback เป็น system ──
  const activeFontFamily = fontStatus === 'ready'
    ? `'${FONT_FAMILY}', 'Noto Sans Thai', 'TH Sarabun New', sans-serif`
    : `'Noto Sans Thai', 'TH Sarabun New', Tahoma, sans-serif`

  // ── Text style สำหรับ <div> หลัก — browser shaping เอง ──────────────────
  // ไม่ต้องทำ renderLine ทีละ char อีกต่อไป
  // browser + HarfBuzz จัดการ Thai cluster combining ครบ
  const textStyle = useMemo(() => ({
    fontFamily:          activeFontFamily,
    fontSize:            `${fontSize * zoom}px`,
    lineHeight:          lineHeight,
    letterSpacing:       `${letterSp}em`,
    color:               isDark ? 'rgba(255,255,255,.88)' : C.ink,
    textAlign:           textAlign,
    whiteSpace:          'pre-wrap',
    wordBreak:           'break-word',
    overflowWrap:        'anywhere',
    fontKerning:         'normal',
    fontFeatureSettings: '"salt" 1, "calt" 1, "liga" 1',
    textRendering:       'optimizeLegibility',
    WebkitFontSmoothing: 'antialiased',
    MozOsxFontSmoothing: 'grayscale',
    // italic/bold mock ยังทำได้ผ่าน transform/shadow
    ...(signMode ? { fontStyle: 'italic' } : {}),
  }), [activeFontFamily, fontSize, zoom, lineHeight, letterSp, isDark, textAlign, signMode])

  // Thai combining marks — สระ/วรรณยุกต์ที่ไม่มี glyph แยก (render ใน font cluster)
  const isThaiCombining = (c) => /[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]/.test(c)

  // ── Missing chars (ตัวที่ไม่มีใน font) ──────────────────────────────────
  const missingChars = useMemo(() => {
    if (fontStatus !== 'ready') return []
    return [...new Set(
      [...text.replace(/[\n ]/g, '')]
        .filter(c => !isThaiCombining(c) && !glyphMapObj[c])
    )]
  }, [text, glyphMapObj, fontStatus])

  // ── Font status bar label ─────────────────────────────────────────────────
  const fontStatusLabel = {
    idle:    '⏳ รอ compile font จาก Step 4',
    loading: '⏳ กำลังโหลด font…',
    ready:   `✓ MyHandwriting (${glyphMap.size} glyphs)`,
    error:   '⚠ โหลด font ไม่สำเร็จ — ใช้ system font แทน',
  }[fontStatus]

  const fontStatusColor = {
    idle:    C.inkLt,
    loading: C.amber,
    ready:   C.green,
    error:   C.red,
  }[fontStatus]

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      height: "100%",
      background: C.bg,
      fontFamily: "'DM Sans', sans-serif",
      overflow: "hidden",
    }}>

      {/* ── TOOLBAR ──────────────────────────────────────────────────── */}
      <div style={{
        height: 52,
        background: C.toolbar,
        borderBottom: `1px solid ${C.border}`,
        display: "flex",
        alignItems: "center",
        padding: "0 14px",
        gap: 4,
        flexShrink: 0,
        zIndex: 10,
        overflowX: "auto",
      }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: C.ink, marginRight: 8, letterSpacing: "-0.01em", whiteSpace: "nowrap" }}>
          ✍ ลายมือ
        </span>
        <Div />

        {/* Align */}
        {[
          { a: "left",   icon: "⬛" },
          { a: "center", icon: "⬛" },
          { a: "right",  icon: "⬛" },
        ].map(({ a, icon }, i) => (
          <TBtn key={a} active={textAlign === a} onClick={() => setAlign(a)}
            title={`Align ${a}`}
          >
            {a === "left" ? "≡" : a === "center" ? "≣" : "≡"}
          </TBtn>
        ))}
        <Div />

        {/* Size */}
        <TBtn onClick={() => setFontSize(s => Math.max(8, s - 2))}>−</TBtn>
        <select value={fontSize} onChange={e => setFontSize(+e.target.value)} style={selectStyle}>
          {SIZES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <TBtn onClick={() => setFontSize(s => Math.min(120, s + 2))}>+</TBtn>
        <Div />

        {/* Line height */}
        <span style={{ fontSize: 11, color: C.inkLt, whiteSpace: "nowrap" }}>↕</span>
        <input type="range" min={1} max={3} step={0.1} value={lineHeight}
          onChange={e => setLH(+e.target.value)}
          style={{ width: 60, accentColor: C.accent }}
        />
        <span style={{ fontSize: 10, color: C.inkLt, minWidth: 22 }}>{lineHeight.toFixed(1)}</span>
        <Div />

        {/* Letter spacing */}
        <span style={{ fontSize: 11, color: C.inkLt, whiteSpace: "nowrap" }}>↔</span>
        <input type="range" min={-0.05} max={0.2} step={0.005} value={letterSp}
          onChange={e => setLS(+e.target.value)}
          style={{ width: 60, accentColor: C.accent }}
        />
        <Div />

        {/* Signature mode */}
        <TBtn active={signMode} onClick={() => setSign(s => !s)} title="Signature mode">✍</TBtn>
        <Div />

        <div style={{ flex: 1 }} />

        {/* Zoom */}
        <TBtn onClick={() => setZoom(z => Math.max(0.3, +(z - 0.1).toFixed(1)))}>−</TBtn>
        <span style={{ fontSize: 11, color: C.inkMd, minWidth: 36, textAlign: "center" }}>
          {Math.round(zoom * 100)}%
        </span>
        <TBtn onClick={() => setZoom(z => Math.min(2, +(z + 0.1).toFixed(1)))}>+</TBtn>
        <Div />

        <TBtn active={showSidebar} onClick={() => setSB(s => !s)} title="Toggle panel">⊞</TBtn>

        <button onClick={exportPNG} style={exportBtnStyle(exporting === "png")}>
          {exporting === "png"
            ? <span style={spinnerStyle} />
            : "⬇"}
          {" "}Export
        </button>
      </div>

      {/* ── FONT STATUS BAR ──────────────────────────────────────────── */}
      <div style={{
        height: 28,
        background: fontStatus === 'ready' ? '#F0FAF4' : fontStatus === 'error' ? '#FEF2F2' : '#FAFAF9',
        borderBottom: `1px solid ${C.border}`,
        display: "flex",
        alignItems: "center",
        padding: "0 16px",
        gap: 6,
        flexShrink: 0,
        transition: "background .3s",
      }}>
        <span style={{ fontSize: 10, fontWeight: 600, color: fontStatusColor, letterSpacing: "0.03em" }}>
          {fontStatus === 'loading' && <span style={{ ...spinnerStyle, borderTopColor: C.amber, borderColor: 'rgba(0,0,0,.15)' }} />}
          {' '}{fontStatusLabel}
        </span>
        {fontStatus === 'idle' && (
          <span style={{ fontSize: 10, color: C.inkLt }}>
            — ไปที่ Step 4 แล้วกด "Build Font" ก่อน
          </span>
        )}
      </div>

      {/* ── BODY ─────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>

        {/* Canvas area */}
        <div style={{
          flex: 1,
          overflowY: "auto",
          overflowX: "auto",
          display: "flex",
          justifyContent: "center",
          alignItems: "flex-start",
          padding: "40px 40px 80px",
          background: "#E8E4DC",
        }}>
          <div
            ref={paperRef}
            style={{
              width:     A4W * zoom,
              minHeight: A4H * zoom,
              background: paperCfg.bg,
              borderRadius: 3,
              boxShadow: C.shadowLg,
              position: "relative",
              flexShrink: 0,
              overflow: "hidden",
              padding: MARGIN * zoom,
              // Grid/lines overlay via backgroundImage
              ...(paperCfg.ruled ? {
                backgroundImage: `linear-gradient(rgba(0,80,200,.05) 1px, transparent 1px),
                                  linear-gradient(90deg, rgba(0,80,200,.05) 1px, transparent 1px)`,
                backgroundSize: `${20 * zoom}px ${20 * zoom}px`,
                backgroundColor: paperCfg.bg,
              } : {}),
              ...(paperCfg.lines ? {
                backgroundImage: `repeating-linear-gradient(
                  to bottom,
                  transparent,
                  transparent ${(fontSize * lineHeight * zoom) - 1}px,
                  rgba(0,80,200,.08) ${(fontSize * lineHeight * zoom) - 1}px,
                  rgba(0,80,200,.08) ${fontSize * lineHeight * zoom}px
                )`,
                backgroundPosition: `0 ${MARGIN * zoom + fontSize * zoom * 0.9}px`,
                backgroundColor: paperCfg.bg,
              } : {}),
            }}
          >
            {/* ── Handwriting text — browser shaping ครบ, Thai marks ถูกต้อง ── */}
            <div style={{ position: "relative", zIndex: 1 }}>
              <div style={textStyle}>{text}</div>
            </div>

            {/* Page number */}
            <div style={{
              position: "absolute",
              bottom: 20 * zoom, right: 28 * zoom,
              fontSize: 9 * zoom,
              color: isDark ? "rgba(255,255,255,.15)" : "rgba(0,0,0,.15)",
              letterSpacing: "0.12em",
              fontFamily: "serif",
              userSelect: "none",
            }}>1</div>

            {/* Empty state */}
            {text.trim() === "" && (
              <div style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                pointerEvents: "none",
              }}>
                <p style={{
                  fontSize: 13 * zoom,
                  color: isDark ? "rgba(255,255,255,.18)" : "rgba(0,0,0,.18)",
                  fontFamily: "serif",
                  fontStyle: "italic",
                }}>
                  พิมพ์ข้อความในช่องด้านล่าง...
                </p>
              </div>
            )}
          </div>
        </div>

        {/* ── SIDEBAR ────────────────────────────────────────────── */}
        {showSidebar && (
          <aside style={{
            width: 244,
            minWidth: 244,
            background: C.sidebar,
            borderLeft: `1px solid ${C.border}`,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}>
            {/* Tabs */}
            <div style={{ display: "flex", borderBottom: `1px solid ${C.border}` }}>
              {[
                { id: "style",  label: "สไตล์"   },
                { id: "paper",  label: "กระดาษ"  },
                { id: "export", label: "Export"  },
              ].map(t => (
                <button key={t.id} onClick={() => setTool(t.id)} style={{
                  flex: 1,
                  padding: "11px 4px",
                  border: "none",
                  borderBottom: activeTool === t.id ? `2px solid ${C.ink}` : "2px solid transparent",
                  background: "transparent",
                  fontSize: 11,
                  fontWeight: activeTool === t.id ? 700 : 400,
                  color: activeTool === t.id ? C.ink : C.inkMd,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  transition: "all .15s",
                }}>
                  {t.label}
                </button>
              ))}
            </div>

            {/* Panel content */}
            <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>

              {/* STYLE */}
              {activeTool === "style" && <>
                {/* Stats row */}
                <div style={{
                  display: "flex",
                  gap: 0,
                  marginBottom: 16,
                  background: "#F0EDE6",
                  borderRadius: 10,
                  overflow: "hidden",
                }}>
                  <MiniStat label="Glyphs"   value={extractedGlyphs.length}             color={C.blue}   />
                  <MiniStat label="Unique"   value={glyphMap.size}        color={C.green}  />
                  <MiniStat label="Coverage" value={
                    (() => {
                      const chars = [...new Set(
                        [...text.replace(/[\n ]/g,"")].filter(c => !isThaiCombining(c))
                      )]
                      if (!chars.length) return "—"
                      const have = chars.filter(c => glyphMapObj[c]).length
                      return Math.round(have / chars.length * 100) + "%"
                    })()
                  } color={C.purple} />
                </div>

                <SLbl>Style Presets</SLbl>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 16 }}>
                  {PRESETS.map(p => (
                    <PillBtn key={p.id} onClick={() => applyPreset(p)}>{p.label}</PillBtn>
                  ))}
                </div>

                <SLbl>ขนาดตัวอักษร <Dim>{fontSize}px</Dim></SLbl>
                <input type="range" min={8} max={120} value={fontSize}
                  onChange={e => setFontSize(+e.target.value)}
                  style={{ width: "100%", accentColor: C.accent, marginBottom: 14 }}
                />

                <SLbl>ระยะบรรทัด <Dim>{lineHeight.toFixed(1)}</Dim></SLbl>
                <input type="range" min={1} max={3} step={0.1} value={lineHeight}
                  onChange={e => setLH(+e.target.value)}
                  style={{ width: "100%", accentColor: C.accent, marginBottom: 14 }}
                />

                <SLbl>ระยะอักษร <Dim>{(letterSp * 100).toFixed(0)}%</Dim></SLbl>
                <input type="range" min={-0.05} max={0.2} step={0.005} value={letterSp}
                  onChange={e => setLS(+e.target.value)}
                  style={{ width: "100%", accentColor: C.accent, marginBottom: 14 }}
                />

                <Sep />

                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                  <div>
                    <p style={{ fontSize: 12, fontWeight: 500, color: C.ink }}>Signature Mode</p>
                    <p style={{ fontSize: 10, color: C.inkLt, marginTop: 2 }}>เพิ่ม italic slant ให้ข้อความ</p>
                  </div>
                  <Toggle value={signMode} onChange={setSign} />
                </div>

                {missingChars.length > 0 && (
                  <div style={{
                    padding: "10px 12px",
                    background: "#FEF9EC",
                    border: `1px solid #F5D87B`,
                    borderRadius: 8,
                  }}>
                    <p style={{ fontSize: 11, color: C.amber, fontWeight: 700, marginBottom: 4 }}>
                      ⚠ ขาด Glyph {missingChars.length} ตัว
                    </p>
                    <p style={{ fontSize: 11, color: "#9A6B0A", letterSpacing: "0.08em" }}>
                      {missingChars.join("  ")}
                    </p>
                  </div>
                )}
              </>}

              {/* PAPER */}
              {activeTool === "paper" && <>
                <SLbl>พื้นหลังกระดาษ</SLbl>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 18 }}>
                  {PAPERS.map(p => (
                    <button key={p.id} onClick={() => setPaper(p.id)} style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "9px 12px",
                      border: `1.5px solid ${paper === p.id ? C.ink : C.border}`,
                      borderRadius: 9,
                      background: paper === p.id ? "#F0EDE6" : "white",
                      cursor: "pointer",
                      fontFamily: "inherit",
                      transition: "all .12s",
                    }}>
                      <div style={{
                        width: 28, height: 20,
                        borderRadius: 4,
                        background: p.bg,
                        border: `1px solid ${C.border}`,
                        flexShrink: 0,
                        ...(p.lines ? {
                          backgroundImage: `repeating-linear-gradient(transparent, transparent 4px, rgba(0,80,200,.15) 4px, rgba(0,80,200,.15) 5px)`,
                        } : p.ruled ? {
                          backgroundImage: `linear-gradient(rgba(0,80,200,.12) 1px, transparent 1px),
                                            linear-gradient(90deg, rgba(0,80,200,.12) 1px, transparent 1px)`,
                          backgroundSize: "5px 5px",
                        } : {}),
                      }} />
                      <span style={{ fontSize: 12, color: paper === p.id ? C.ink : C.inkMd, fontWeight: paper === p.id ? 700 : 400 }}>
                        {p.label}
                      </span>
                      {paper === p.id && <span style={{ marginLeft: "auto", fontSize: 12 }}>✓</span>}
                    </button>
                  ))}
                </div>

                <Sep />
                <SLbl>Zoom</SLbl>
                <input type="range" min={0.3} max={1.5} step={0.05} value={zoom}
                  onChange={e => setZoom(+e.target.value)}
                  style={{ width: "100%", accentColor: C.accent }}
                />
                <p style={{ fontSize: 10, color: C.inkLt, marginTop: 4 }}>{Math.round(zoom * 100)}%</p>
              </>}

              {/* EXPORT */}
              {activeTool === "export" && <>
                <SLbl>ข้อความ</SLbl>
                <textarea
                  value={text}
                  onChange={e => setText(e.target.value)}
                  rows={7}
                  placeholder="พิมพ์ข้อความที่นี่..."
                  style={{
                    width: "100%",
                    border: `1px solid ${C.border}`,
                    borderRadius: 9,
                    padding: "10px 12px",
                    fontSize: 13,
                    fontFamily: "inherit",
                    color: C.ink,
                    background: "white",
                    resize: "vertical",
                    outline: "none",
                    lineHeight: 1.6,
                    marginBottom: 14,
                  }}
                />

                <SLbl>Export ไฟล์</SLbl>
                <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                  <ExBtn icon="🖼" label="Export PNG" sub="2× resolution"    color={C.blue}   onClick={exportPNG} loading={exporting === "png"} />
                  <ExBtn icon={copied ? "✓" : "📋"} label="Copy Text" sub={copied ? "Copied!" : "คัดลอกข้อความ"} color={copied ? C.green : C.inkMd} onClick={copyText} />
                  <ExBtn icon="📄" label="PDF"            sub="เร็ว ๆ นี้"      color={C.inkLt}  disabled />
                  <ExBtn icon="🔤" label="Font File .ttf" sub="เร็ว ๆ นี้"      color={C.inkLt}  disabled />
                </div>

                <Sep />
                <SLbl>Glyph Library ({glyphMap.size} ตัว)</SLbl>
                <div style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 4,
                  maxHeight: 148,
                  overflowY: "auto",
                  padding: 8,
                  background: "#F0EDE6",
                  borderRadius: 8,
                }}>
                  {Object.entries(glyphMapObj).map(([ch, g]) => (
                    <div key={ch} title={ch} style={{
                      width: 26, height: 26,
                      border: `1px solid ${C.border}`,
                      borderRadius: 5,
                      background: "white",
                      overflow: "hidden",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}>
                      {g.preview
                        ? <img src={g.preview} alt={ch} style={{ width: "82%", height: "82%", objectFit: "contain" }} />
                        : <span style={{ fontSize: 11, color: C.inkMd, fontFamily: "serif" }}>{ch}</span>
                      }
                    </div>
                  ))}
                  {glyphMap.size === 0 && (
                    <p style={{ fontSize: 11, color: C.inkLt, padding: "2px 0" }}>ยังไม่มี Glyphs</p>
                  )}
                </div>
              </>}
            </div>
          </aside>
        )}
      </div>

      {/* ── BOTTOM INPUT BAR ─────────────────────────────────────────── */}
      <div style={{
        height: 56,
        background: C.toolbar,
        borderTop: `1px solid ${C.border}`,
        display: "flex",
        alignItems: "center",
        padding: "0 18px",
        gap: 12,
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 11, color: C.inkMd, whiteSpace: "nowrap", userSelect: "none" }}>
          ✍ พิมพ์
        </span>
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          rows={1}
          placeholder="พิมพ์ข้อความ... กด Enter เพื่อขึ้นบรรทัดใหม่"
          style={{
            flex: 1,
            border: `1px solid ${C.border}`,
            borderRadius: 8,
            padding: "8px 14px",
            fontSize: 13,
            fontFamily: "inherit",
            color: C.ink,
            background: "white",
            resize: "none",
            outline: "none",
            lineHeight: 1.4,
            transition: "border-color .15s",
          }}
          onFocus={e => e.target.style.borderColor = C.inkMd}
          onBlur={e  => e.target.style.borderColor = C.border}
        />
        <span style={{ fontSize: 10, color: C.inkLt, whiteSpace: "nowrap" }}>
          {text.replace(/\n/g, "").length} ตัว
        </span>
      </div>
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function TBtn({ children, onClick, active, title, disabled }) {
  return (
    <button onClick={onClick} title={title} disabled={disabled} style={{
      width: 28, height: 28,
      border: `1px solid ${active ? C.ink : "transparent"}`,
      borderRadius: 6,
      background: active ? "#F0EDE6" : "transparent",
      color: disabled ? C.inkLt : active ? C.ink : C.inkMd,
      fontSize: 12,
      cursor: disabled ? "default" : "pointer",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "inherit",
      transition: "all .1s",
      flexShrink: 0,
    }}
      onMouseEnter={e => { if (!disabled && !active) e.currentTarget.style.background = "#F0EDE6" }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = "transparent" }}
    >{children}</button>
  )
}

function Div() {
  return <div style={{ width: 1, height: 18, background: C.border, margin: "0 2px", flexShrink: 0 }} />
}

function Sep() {
  return <div style={{ height: 1, background: C.border, margin: "12px 0" }} />
}

function SLbl({ children }) {
  return <p style={{ fontSize: 10, fontWeight: 700, color: C.inkLt, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 7 }}>{children}</p>
}

function Dim({ children }) {
  return <span style={{ fontWeight: 400, color: C.inkLt }}>{children}</span>
}

function MiniStat({ label, value, color }) {
  return (
    <div style={{ flex: 1, padding: "10px 8px", textAlign: "center" }}>
      <p style={{ fontSize: 17, fontWeight: 700, color, lineHeight: 1 }}>{value}</p>
      <p style={{ fontSize: 9, color: C.inkLt, marginTop: 3, letterSpacing: "0.04em" }}>{label}</p>
    </div>
  )
}

function PillBtn({ children, onClick }) {
  return (
    <button onClick={onClick} style={{
      padding: "5px 12px",
      border: `1px solid ${C.border}`,
      borderRadius: 20,
      background: "white",
      fontSize: 11,
      color: C.inkMd,
      cursor: "pointer",
      fontFamily: "inherit",
      transition: "all .12s",
    }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = C.ink; e.currentTarget.style.color = C.ink }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.inkMd }}
    >{children}</button>
  )
}

function Toggle({ value, onChange }) {
  return (
    <div onClick={() => onChange(!value)} style={{
      width: 38, height: 22,
      borderRadius: 99,
      background: value ? C.ink : C.border,
      position: "relative",
      cursor: "pointer",
      transition: "background .2s",
      flexShrink: 0,
    }}>
      <div style={{
        position: "absolute",
        top: 3, left: value ? 18 : 3,
        width: 16, height: 16,
        borderRadius: "50%",
        background: "white",
        boxShadow: "0 1px 3px rgba(0,0,0,.2)",
        transition: "left .2s",
      }} />
    </div>
  )
}

function ExBtn({ icon, label, sub, color, onClick, disabled, loading }) {
  return (
    <button onClick={!disabled ? onClick : undefined} disabled={disabled} style={{
      display: "flex",
      alignItems: "center",
      gap: 10,
      padding: "9px 13px",
      border: `1px solid ${C.border}`,
      borderRadius: 9,
      background: disabled ? "#FAF9F6" : "white",
      cursor: disabled ? "not-allowed" : "pointer",
      fontFamily: "inherit",
      textAlign: "left",
      transition: "all .12s",
      opacity: disabled ? 0.5 : 1,
    }}
      onMouseEnter={e => { if (!disabled) e.currentTarget.style.borderColor = C.inkMd }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = C.border }}
    >
      <span style={{ fontSize: 18, flexShrink: 0 }}>
        {loading ? <span style={spinnerStyle} /> : icon}
      </span>
      <div>
        <p style={{ fontSize: 12, fontWeight: 600, color: disabled ? C.inkLt : C.ink }}>{label}</p>
        <p style={{ fontSize: 10, color, marginTop: 1 }}>{sub}</p>
      </div>
    </button>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const selectStyle = {
  border: `1px solid ${C.border}`,
  borderRadius: 6,
  padding: "3px 4px",
  fontSize: 12,
  color: C.ink,
  background: "white",
  fontFamily: "inherit",
  outline: "none",
  width: 50,
  textAlign: "center",
}

const exportBtnStyle = (loading) => ({
  marginLeft: 4,
  padding: "6px 14px",
  background: C.ink,
  color: "#fff",
  border: "none",
  borderRadius: 8,
  fontSize: 12,
  fontWeight: 600,
  cursor: loading ? "wait" : "pointer",
  fontFamily: "inherit",
  display: "flex",
  alignItems: "center",
  gap: 5,
  opacity: loading ? 0.65 : 1,
  transition: "opacity .2s",
  whiteSpace: "nowrap",
  flexShrink: 0,
})

const spinnerStyle = {
  display: "inline-block",
  width: 12,
  height: 12,
  border: "2px solid rgba(255,255,255,.3)",
  borderTopColor: "#fff",
  borderRadius: "50%",
  animation: "spin .7s linear infinite",
  verticalAlign: "middle",
}