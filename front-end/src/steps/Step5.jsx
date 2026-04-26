/**
 * STEP 5 — HANDWRITING PREVIEW & EXPORT
 * Redesigned UI — ink-on-paper aesthetic
 *
 * Fix: SVG-based per-character rendering with per-position randomization
 * แต่ละ position ในข้อความสุ่ม variant ต่างกัน → ไม่เหมือนกันทุกตัวอีกต่อไป
 */

import { useState, useRef, useCallback, useEffect, useMemo } from "react"

if (typeof document !== 'undefined' && !document.getElementById('step5-keyframes')) {
  const s = document.createElement('style')
  s.id = 'step5-keyframes'
  s.textContent = `
    @keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(6px) } to { opacity: 1; transform: none } }
    @keyframes inkDrop { from { opacity: 0; transform: scale(.92) } to { opacity: 1; transform: scale(1) } }
  `
  document.head.appendChild(s)
}

// ─── Design tokens ────────────────────────────────────────────────────────────
const T = {
  // Ink-on-paper palette
  paper:    "#F5F0E8",
  paperDk:  "#EDE5D0",
  ink:      "#1C1714",
  inkMd:    "#6B5E52",
  inkLt:    "#B8A898",
  cream:    "#FAF7F2",
  rust:     "#B84C2E",
  sage:     "#4A7C59",
  indigo:   "#3D5A8A",
  gold:     "#C4922A",
  border:   "#DDD5C4",
  borderMd: "#C8BBAA",
  shadow:   "0 2px 8px rgba(28,23,20,.08), 0 8px 32px rgba(28,23,20,.06)",
  shadowSm: "0 1px 4px rgba(28,23,20,.1)",
}

// ─── Paper configs ────────────────────────────────────────────────────────────
const PAPERS = [
  { id: "blank",   label: "Blank",       bg: "#FDFAF5", texture: false },
  { id: "ruled",   label: "Ruled",       bg: "#FDFAF5", texture: "ruled" },
  { id: "grid",    label: "Grid",        bg: "#FDFAF5", texture: "grid" },
  { id: "aged",    label: "Aged",        bg: "#F2EBD9", texture: false },
  { id: "dark",    label: "Blackboard",  bg: "#1A1F2E", texture: false },
  { id: "kraft",   label: "Kraft",       bg: "#D4B896", texture: false },
]

const SIZES = [10,12,14,16,18,20,24,28,32,36,42,48,56,64,72,96]

const PRESETS = [
  { id: "body",    label: "Body",      size: 20, lh: 1.9, ls: 0.01  },
  { id: "heading", label: "Heading",   size: 40, lh: 1.3, ls: -0.02 },
  { id: "note",    label: "Note",      size: 15, lh: 2.1, ls: 0.01  },
  { id: "display", label: "Display",   size: 68, lh: 1.1, ls: -0.03 },
  { id: "sign",    label: "Signature", size: 52, lh: 1.2, ls: 0.03  },
]

const A4W = 794, A4H = 1123, MARGIN = 72
const FONT_FAMILY = 'MyHandwriting'
const STYLE_TAG_ID = 'my-handwriting-font-face'
const THAI_RE = /[\u0E00-\u0E7F]/

// ─── Per-position seeded RNG ──────────────────────────────────────────────────
// xorshift32 — ทุก character position ได้ variant ต่างกัน
function xorshift(seed) {
  let s = (seed * 1664525 + 1013904223) >>> 0
  s ^= s << 13; s ^= s >>> 17; s ^= s << 5
  return (s >>> 0) / 4294967296
}

// ─── SVG-based text renderer ─────────────────────────────────────────────────
// วาด glyph SVG path ตรงๆ ต่อ position โดยสุ่ม variant ด้วย position seed
// ทำให้ทุกตัวอักษรในข้อความได้ path ต่างกัน แม้เป็น character เดียวกัน
function renderHandwrittenSVG({ text, glyphMap, fontSize, lineHeight, letterSp, width, margin, isDark, seed = 1 }) {
  if (!glyphMap || glyphMap.size === 0) return null

  const lhPx   = fontSize * lineHeight
  const inkCol = isDark ? "rgba(220,210,195,.92)" : T.ink

  const lines = text.split("\n")
  const svgLines = []
  let posCounter = 0

  lines.forEach((line, li) => {
    const y = margin + li * lhPx + fontSize * 0.8
    let x = margin

    for (const ch of line) {
      if (ch === ' ') { x += fontSize * 0.35; posCounter++; continue }

      const variants = glyphMap.get(ch)
      if (!variants || variants.length === 0) {
        svgLines.push(
          `<text x="${x}" y="${y}" font-size="${fontSize}" fill="${inkCol}" opacity=".7">${ch}</text>`
        )
        x += fontSize * 0.6
        posCounter++
        continue
      }

      // สุ่ม variant ด้วย position seed + randomSeed — กด 🎲 ได้ pattern ใหม่
      const rng     = xorshift(posCounter * 7919 + li * 31337 + seed * 999983)
      const picked  = variants[Math.floor(rng * variants.length)]
      // แก้ bug: ตรวจสอบ svgPath อย่างเข้มงวด ไม่ fallback ไป .default ที่ไม่มี
      const rawPath = picked?.svgPath
      const svgPath = (rawPath && typeof rawPath === 'string' && rawPath.trim() && rawPath.trim() !== 'M 0 0')
        ? rawPath.trim()
        : null

      if (svgPath) {
        // คำนวณ bottom จริงจาก path (robust ต่อ deformation ทุกแบบ)
        const yVals = []
        svgPath.replace(/[ML]\s*([-\d.]+)\s+([-\d.]+)/g, (_, _x, y) => yVals.push(+y))
        svgPath.replace(/C(?:\s*[-\d.]+\s+[-\d.]+\s+[-\d.]+\s+[-\d.]+\s+([-\d.]+)\s+([-\d.]+))+/g,
          (match) => { [...match.matchAll(/C|(?:([-\d.]+)\s+([-\d.]+))(?=\s|$)/g)].forEach(m => m[2] && yVals.push(+m[2])) })
        const actualBottom = yVals.length > 0 ? Math.max(...yVals) : (picked.svgBaseline ?? 80)
        const baselineRatio = Math.min(actualBottom, 95) / 100  // cap ที่ 95 ป้องกัน outlier
        const scale = fontSize / 100
        const rot = (xorshift(posCounter * 13337 + seed * 31337) - 0.5) * 1.5
        svgLines.push(
          `<g transform="translate(${x}, ${y - fontSize * baselineRatio}) rotate(${rot.toFixed(2)}, ${fontSize/2}, ${fontSize * baselineRatio}) scale(${scale})">
            <path d="${svgPath}" fill="${inkCol}" />
          </g>`
        )
        x += fontSize * (0.6 + letterSp)
      } else {
        svgLines.push(
          `<text x="${x}" y="${y}" font-size="${fontSize}" fill="${inkCol}" opacity=".6">${ch}</text>`
        )
        x += fontSize * 0.6
      }
      posCounter++
    }
  })

  const svgH = margin + lines.length * lhPx + margin
  return { svgLines, svgH }
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function Step5({ versionedGlyphs = [], extractedGlyphs = [], ttfBuffer = null, puaMap = null }) {

  // Build per-character glyph map: ch → array of variants
  const glyphMap = useMemo(() => {
    const map = new Map()
    const src = versionedGlyphs.length > 0 ? versionedGlyphs : extractedGlyphs
    for (const g of src) {
      if (!g.ch) continue
      if (!map.has(g.ch)) map.set(g.ch, [])
      map.get(g.ch).push(g)
    }
    return map
  }, [versionedGlyphs, extractedGlyphs])

  const glyphMapObj = useMemo(() => {
    const obj = {}
    for (const [ch, arr] of glyphMap) obj[ch] = arr[0]
    return obj
  }, [glyphMap])

  // Font injection with cache flush
  const [fontStatus, setFontStatus] = useState('idle')
  const fontUrlRef  = useRef(null)
  const fontFaceRef = useRef(null)

  useEffect(() => {
    if (!ttfBuffer) { setFontStatus('idle'); return }
    setFontStatus('loading')

    if (fontFaceRef.current) {
      try { document.fonts.delete(fontFaceRef.current) } catch (_) {}
      fontFaceRef.current = null
    }
    if (fontUrlRef.current) { URL.revokeObjectURL(fontUrlRef.current); fontUrlRef.current = null }

    const blob = new Blob([ttfBuffer], { type: 'font/ttf' })
    const url  = URL.createObjectURL(blob)
    fontUrlRef.current = url

    let styleEl = document.getElementById(STYLE_TAG_ID)
    if (!styleEl) { styleEl = document.createElement('style'); styleEl.id = STYLE_TAG_ID; document.head.appendChild(styleEl) }
    styleEl.textContent = `@font-face{font-family:'${FONT_FAMILY}';src:url('${url}') format('truetype');font-weight:normal;font-style:normal;font-display:block;}`

    const ff = new FontFace(FONT_FAMILY, `url('${url}')`)
    fontFaceRef.current = ff
    ff.load()
      .then(loaded => {
        for (const f of document.fonts) {
          if (f.family === FONT_FAMILY && f !== loaded) try { document.fonts.delete(f) } catch (_) {}
        }
        document.fonts.add(loaded)
        setFontStatus('ready')
      })
      .catch(err => { console.error('[Step5]', err); setFontStatus('error') })

    return () => { if (fontUrlRef.current) { URL.revokeObjectURL(fontUrlRef.current); fontUrlRef.current = null } }
  }, [ttfBuffer])

  // Editor state
  const [text,      setText]    = useState("Hello World\nThis is my handwriting")
  const [fontSize,  setFS]      = useState(32)
  const [lineHeight,setLH]      = useState(1.8)
  const [letterSp,  setLS]      = useState(0.02)
  const [textAlign, setAlign]   = useState("left")
  const [paper,     setPaper]   = useState("blank")
  const [zoom,      setZoom]    = useState(0.85)
  const [signMode,  setSign]    = useState(false)
  const [panel,     setPanel]   = useState("style") // style | paper | export
  const [showPanel, setShowP]   = useState(true)
  const [renderMode,setRMode]   = useState("font")  // font | svg
  const [exporting, setExp]     = useState(null)
  const [copied,    setCopied]  = useState(false)
  const [randomSeed,setRandSeed]= useState(42)        // ← PUA randomization seed

  const paperRef = useRef(null)
  const paperCfg = PAPERS.find(p => p.id === paper) ?? PAPERS[0]
  const isDark   = paperCfg.bg === "#1A1F2E"
  const inkColor = isDark ? "rgba(220,210,195,.92)" : T.ink

  const hasThaiText = useMemo(() => THAI_RE.test(text), [text])
  const requiredChars = useMemo(() => {
    const s = new Set()
    for (const c of text) if (!/\s/.test(c)) s.add(c)
    return [...s]
  }, [text])

  const missingChars = useMemo(() =>
    fontStatus !== 'ready' ? [] : requiredChars.filter(c => !glyphMapObj[c])
  , [requiredChars, glyphMapObj, fontStatus])

  const canUseFont = fontStatus === 'ready' && missingChars.length === 0

  const activeFontFamily = canUseFont
    ? `'${FONT_FAMILY}', 'Noto Sans Thai', sans-serif`
    : `'Noto Sans Thai', 'TH Sarabun New', Tahoma, sans-serif`

  const coveragePct = useMemo(() => {
    if (!requiredChars.length) return "—"
    const have = requiredChars.filter(c => glyphMapObj[c]).length
    return `${Math.round(have / requiredChars.length * 100)}%`
  }, [requiredChars, glyphMapObj])

  // ── PUA Randomization ────────────────────────────────────────────────────────
  // แปลงข้อความให้สุ่ม codepoint (Unicode / PUA-v1 / PUA-v2) ต่อตำแหน่ง
  // ผล: ตัวอักษรเดียวกันในข้อความได้ glyph variant ต่างกันทุก position จริงๆ
  const hasPua = puaMap && puaMap.size > 0

  const puaText = useMemo(() => {
    if (!hasPua || renderMode !== 'font') return text
    let pos = 0
    return [...text].map(ch => {
      if (/\s/.test(ch)) { pos++; return ch }
      const info = puaMap.get(ch)
      if (!info) { pos++; return ch }
      const r    = xorshift(pos * 7919 + randomSeed * 999983)
      const pick = Math.floor(r * 3)   // 0 = default, 1 = PUA v1, 2 = PUA v2
      pos++
      const cp = pick === 0 ? info.v0 : pick === 1 ? info.v1 : info.v2
      return String.fromCodePoint(cp)
    }).join('')
  }, [text, puaMap, hasPua, randomSeed, renderMode])

  // SVG render data — recomputes when text or settings change → new random positions
  const svgData = useMemo(() => {
    if (renderMode !== 'svg' || glyphMap.size === 0) return null
    return renderHandwrittenSVG({
      text, glyphMap, fontSize, lineHeight, letterSp: letterSp * fontSize,
      width: A4W, margin: MARGIN, isDark, seed: randomSeed,
    })
  }, [text, glyphMap, fontSize, lineHeight, letterSp, renderMode, isDark, randomSeed])

  const textStyle = useMemo(() => ({
    fontFamily:          activeFontFamily,
    fontSize:            `${fontSize * zoom}px`,
    lineHeight:          lineHeight,
    letterSpacing:       hasThaiText ? 'normal' : `${letterSp}em`,
    color:               inkColor,
    textAlign:           textAlign,
    whiteSpace:          'pre-wrap',
    wordBreak:           'normal',
    overflowWrap:        'normal',
    fontKerning:         'normal',
    fontFeatureSettings: canUseFont ? '"salt" 1, "calt" 1' : 'normal',
    textRendering:       'optimizeLegibility',
    WebkitFontSmoothing: 'antialiased',
    ...(signMode ? { fontStyle: 'italic', transform: 'rotate(-1deg)', display: 'inline-block' } : {}),
  }), [activeFontFamily, fontSize, zoom, lineHeight, letterSp, inkColor, textAlign, signMode, hasThaiText, canUseFont])

  // Export PNG
  const exportPNG = useCallback(async () => {
    if (!paperRef.current) return
    setExp("png")
    await new Promise(r => setTimeout(r, 200))
    try {
      const node = paperRef.current
      const SC   = 2
      const canvas = document.createElement("canvas")
      canvas.width  = node.offsetWidth * SC
      canvas.height = node.offsetHeight * SC
      const ctx = canvas.getContext("2d")
      ctx.fillStyle = paperCfg.bg
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.scale(SC, SC)
      ctx.font = `${signMode ? "italic " : ""}${fontSize}px ${activeFontFamily}`
      ctx.fillStyle = inkColor
      ctx.textBaseline = "top"
      ctx.textAlign = textAlign
      const lhPx  = fontSize * lineHeight
      const drawX = textAlign === "center" ? node.offsetWidth / 2
                  : textAlign === "right"  ? node.offsetWidth - MARGIN * zoom
                  : MARGIN * zoom
      text.split("\n").forEach((line, i) => {
        ctx.fillText(line, drawX, MARGIN * zoom + i * lhPx * zoom)
      })
      canvas.toBlob(b => {
        const a = document.createElement("a")
        a.href = URL.createObjectURL(b)
        a.download = `handwriting-${Date.now()}.png`
        a.click()
        setTimeout(() => URL.revokeObjectURL(a.href), 5000)
      }, "image/png")
    } catch (e) { console.error(e) }
    setExp(null)
  }, [text, fontSize, lineHeight, zoom, fontStatus, glyphMapObj, signMode, textAlign, paperCfg, activeFontFamily, inkColor])

  const copyText = async () => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  // Paper background CSS
  const paperBgStyle = useMemo(() => {
    const base = { background: paperCfg.bg }
    if (paperCfg.texture === 'ruled') return {
      ...base,
      backgroundImage: `repeating-linear-gradient(
        to bottom, transparent,
        transparent ${(fontSize * lineHeight * zoom) - 1}px,
        rgba(${isDark ? '180,160,120' : '0,60,180'},.1) ${(fontSize * lineHeight * zoom) - 1}px,
        rgba(${isDark ? '180,160,120' : '0,60,180'},.1) ${fontSize * lineHeight * zoom}px
      )`,
      backgroundPosition: `0 ${MARGIN * zoom + fontSize * zoom * 0.9}px`,
    }
    if (paperCfg.texture === 'grid') return {
      ...base,
      backgroundImage: `linear-gradient(rgba(0,60,180,.06) 1px, transparent 1px),
                        linear-gradient(90deg, rgba(0,60,180,.06) 1px, transparent 1px)`,
      backgroundSize: `${24 * zoom}px ${24 * zoom}px`,
    }
    return base
  }, [paperCfg, fontSize, lineHeight, zoom, isDark])

  // ── Status indicator
  const statusDot = { idle: '○', loading: '◌', ready: '●', error: '✕' }[fontStatus]
  const statusColor = { idle: T.inkLt, loading: T.gold, ready: T.sage, error: T.rust }[fontStatus]

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: T.paper, fontFamily: "'DM Mono', 'Courier New', monospace", overflow: "hidden" }}>

      {/* ── TOP TOOLBAR ──────────────────────────────────────────────────── */}
      <div style={{
        height: 48,
        background: T.ink,
        display: "flex", alignItems: "center",
        padding: "0 16px", gap: 6, flexShrink: 0,
        borderBottom: `2px solid ${T.rust}`,
      }}>
        {/* Brand */}
        <span style={{ fontSize: 11, fontWeight: 700, color: T.paper, letterSpacing: "0.12em", textTransform: "uppercase", marginRight: 8, opacity: .9, whiteSpace: "nowrap" }}>
          ✦ Preview
        </span>

        <Vr dark />

        {/* Render mode toggle */}
        <ModeToggle
          value={renderMode}
          onChange={setRMode}
          options={[
            { id: "font", label: hasPua ? "Font ✦PUA" : "Font" },
            { id: "svg",  label: "SVG" },
          ]}
        />

        <Vr dark />

        {/* Shuffle button — PUA randomization */}
        <TBtnDark
          onClick={() => setRandSeed(s => s + 1)}
          title={hasPua ? `Reshuffle variants (PUA seed: ${randomSeed})` : "Build font first to enable PUA shuffle"}
          disabled={!hasPua}
        >🎲</TBtnDark>

        <Vr dark />

        {/* Align */}
        {["left","center","right"].map(a => (
          <TBtnDark key={a} active={textAlign === a} onClick={() => setAlign(a)} title={`Align ${a}`}>
            {a === "left" ? "⫶" : a === "center" ? "⫷" : "⫸"}
          </TBtnDark>
        ))}

        <Vr dark />

        {/* Font size */}
        <TBtnDark onClick={() => setFS(s => Math.max(8, s - 2))}>−</TBtnDark>
        <select value={fontSize} onChange={e => setFS(+e.target.value)} style={darkSelectStyle}>
          {SIZES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <TBtnDark onClick={() => setFS(s => Math.min(120, s + 2))}>+</TBtnDark>

        <Vr dark />

        {/* Line height */}
        <span style={{ fontSize: 10, color: T.inkLt, whiteSpace: "nowrap" }}>↕</span>
        <input type="range" min={1} max={3} step={0.1} value={lineHeight}
          onChange={e => setLH(+e.target.value)}
          style={{ width: 52, accentColor: T.rust }} />
        <span style={{ fontSize: 9, color: T.inkLt, minWidth: 22 }}>{lineHeight.toFixed(1)}</span>

        <Vr dark />

        {/* Letter spacing */}
        <span style={{ fontSize: 10, color: T.inkLt, whiteSpace: "nowrap" }}>↔</span>
        <input type="range" min={-0.05} max={0.25} step={0.005} value={letterSp}
          onChange={e => setLS(+e.target.value)}
          style={{ width: 52, accentColor: T.rust }} />

        <Vr dark />
        <TBtnDark active={signMode} onClick={() => setSign(s => !s)} title="Signature mode">𝑓</TBtnDark>

        <div style={{ flex: 1 }} />

        {/* Zoom */}
        <span style={{ fontSize: 9, color: T.inkLt }}>{Math.round(zoom*100)}%</span>
        <input type="range" min={0.3} max={1.5} step={0.05} value={zoom}
          onChange={e => setZoom(+e.target.value)}
          style={{ width: 60, accentColor: T.rust }} />

        <Vr dark />
        <TBtnDark active={showPanel} onClick={() => setShowP(s => !s)}>⊞</TBtnDark>

        {/* Export */}
        <button onClick={exportPNG} style={{
          marginLeft: 4, padding: "5px 14px",
          background: T.rust, color: "#fff",
          border: "none", borderRadius: 5,
          fontSize: 11, fontWeight: 700,
          cursor: "pointer", fontFamily: "inherit",
          display: "flex", alignItems: "center", gap: 6,
          letterSpacing: "0.06em", textTransform: "uppercase",
          opacity: exporting ? 0.6 : 1,
          flexShrink: 0,
        }}>
          {exporting ? <Spin /> : "↓"}
          {" "}Export
        </button>
      </div>

      {/* ── FONT STATUS STRIP ─────────────────────────────────────────────── */}
      <div style={{
        height: 26, background: T.paperDk,
        borderBottom: `1px solid ${T.border}`,
        display: "flex", alignItems: "center",
        padding: "0 16px", gap: 8, flexShrink: 0,
      }}>
        <span style={{ fontSize: 11, color: statusColor, fontFamily: "monospace" }}>{statusDot}</span>
        <span style={{ fontSize: 10, color: T.inkMd, letterSpacing: "0.04em" }}>
          {fontStatus === 'idle'    && "Waiting for font build from Step 4"}
          {fontStatus === 'loading' && "Loading font…"}
          {fontStatus === 'ready'   && (canUseFont
            ? `MyHandwriting — ${glyphMap.size} glyphs ✓`
            : `fallback font (missing ${missingChars.length} glyphs)`)}
          {fontStatus === 'error'   && "Failed to load font"}
        </span>
        {fontStatus === 'ready' && hasPua && renderMode === 'font' && (
          <span style={{ marginLeft: 8, fontSize: 9, color: T.gold, letterSpacing: "0.06em" }}>
            ✦ PUA MODE — random variant per position (press 🎲 to reshuffle)
          </span>
        )}
        {renderMode === 'svg' && glyphMap.size > 0 && (
          <span style={{ marginLeft: 8, fontSize: 9, color: T.indigo, letterSpacing: "0.06em" }}>
            ✦ SVG MODE — สุ่ม variant ต่อ position
          </span>
        )}
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 9, color: T.inkLt }}>{text.replace(/\n/g,"").length} characters</span>
      </div>

      {/* ── BODY ──────────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>

        {/* Canvas area */}
        <div style={{
          flex: 1, overflowY: "auto", overflowX: "auto",
          display: "flex", justifyContent: "center", alignItems: "flex-start",
          padding: "36px 36px 80px",
          background: `repeating-linear-gradient(45deg, #E8E0D0 0px, #E8E0D0 1px, #EDE5D5 1px, #EDE5D5 12px)`,
        }}>
          {/* Paper */}
          <div
            ref={paperRef}
            style={{
              width: A4W * zoom, minHeight: A4H * zoom,
              borderRadius: 2,
              boxShadow: "0 4px 24px rgba(0,0,0,.18), 0 1px 4px rgba(0,0,0,.12), inset 0 0 0 1px rgba(0,0,0,.04)",
              position: "relative", flexShrink: 0,
              overflow: "hidden",
              padding: MARGIN * zoom,
              animation: "inkDrop .35s ease",
              ...paperBgStyle,
            }}
          >
            {/* Left margin rule (ถ้าไม่ dark) */}
            {!isDark && (
              <div style={{
                position: "absolute", left: 56 * zoom, top: 0, bottom: 0,
                width: 1, background: "rgba(200,80,60,.15)",
                pointerEvents: "none",
              }} />
            )}

            {/* Content */}
            {renderMode === 'font' ? (
              /* Font render mode — ใช้ puaText (PUA randomized) แทน text ดิบ */
              <div style={textStyle}>{hasPua ? puaText : text}</div>
            ) : svgData ? (
              /* SVG render mode — per-position randomized */
              <svg
                width={(A4W - MARGIN * 2) * zoom}
                height={Math.max(svgData.svgH * zoom, (A4H - MARGIN * 2) * zoom)}
                viewBox={`0 0 ${A4W - MARGIN * 2} ${Math.max(svgData.svgH, A4H - MARGIN * 2)}`}
                style={{ display: "block", overflow: "visible" }}
                dangerouslySetInnerHTML={{ __html: svgData.svgLines.join('\n') }}
              />
            ) : (
              /* SVG mode แต่ยังไม่มี glyph */
              <div style={{ color: T.inkLt, fontSize: 13, fontStyle: "italic" }}>
                No glyph data yet — upload a PDF first
              </div>
            )}

            {/* Page number */}
            <div style={{
              position: "absolute", bottom: 18 * zoom, right: 24 * zoom,
              fontSize: 8 * zoom, color: isDark ? "rgba(255,255,255,.12)" : "rgba(0,0,0,.12)",
              letterSpacing: "0.15em", fontFamily: "Georgia, serif", userSelect: "none",
            }}>— 1 —</div>

            {/* Empty placeholder */}
            {text.trim() === "" && (
              <div style={{
                position: "absolute", inset: 0,
                display: "flex", alignItems: "center", justifyContent: "center",
                pointerEvents: "none",
              }}>
                <p style={{
                  fontSize: 14 * zoom, color: isDark ? "rgba(255,255,255,.15)" : "rgba(0,0,0,.15)",
                  fontFamily: "Georgia, serif", fontStyle: "italic",
                }}>Type a message below…</p>
              </div>
            )}
          </div>
        </div>

        {/* ── RIGHT PANEL ─────────────────────────────────────────────── */}
        {showPanel && (
          <aside style={{
            width: 256, minWidth: 256, background: T.cream,
            borderLeft: `1px solid ${T.border}`,
            display: "flex", flexDirection: "column", overflow: "hidden",
          }}>
            {/* Panel tabs */}
            <div style={{ display: "flex", borderBottom: `1px solid ${T.border}`, background: T.paperDk }}>
              {[
                { id: "style",  label: "Style"  },
                { id: "paper",  label: "Paper"  },
                { id: "export", label: "Export" },
              ].map(t => (
                <button key={t.id} onClick={() => setPanel(t.id)} style={{
                  flex: 1, padding: "10px 4px",
                  border: "none", borderBottom: panel === t.id ? `2px solid ${T.rust}` : "2px solid transparent",
                  background: "transparent", fontSize: 10,
                  fontWeight: panel === t.id ? 700 : 400,
                  color: panel === t.id ? T.ink : T.inkMd,
                  cursor: "pointer", fontFamily: "inherit",
                  letterSpacing: "0.06em", textTransform: "uppercase",
                  transition: "all .15s",
                }}>{t.label}</button>
              ))}
            </div>

            <div style={{ flex: 1, overflowY: "auto", padding: 18 }}>

              {/* ── STYLE PANEL ── */}
              {panel === "style" && <>
                {/* Stats */}
                <div style={{
                  display: "grid", gridTemplateColumns: "1fr 1fr 1fr",
                  background: T.ink, borderRadius: 8, overflow: "hidden",
                  marginBottom: 18,
                }}>
                  <StatBox label="Glyphs"   value={extractedGlyphs.length} color={T.gold}   />
                  <StatBox label="Unique"   value={glyphMap.size}           color={T.sage}   />
                  <StatBox label="Coverage" value={coveragePct}             color={T.indigo} />
                </div>

                <PLabel>Presets</PLabel>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 16 }}>
                  {PRESETS.map(p => (
                    <PresetPill key={p.id} onClick={() => { setFS(p.size); setLH(p.lh); setLS(p.ls) }}>
                      {p.label}
                    </PresetPill>
                  ))}
                </div>

                <PLabel>Size <Dim>{fontSize}px</Dim></PLabel>
                <input type="range" min={8} max={120} value={fontSize}
                  onChange={e => setFS(+e.target.value)}
                  style={sliderStyle} />

                <PLabel>Line height <Dim>{lineHeight.toFixed(1)}</Dim></PLabel>
                <input type="range" min={1} max={3} step={0.1} value={lineHeight}
                  onChange={e => setLH(+e.target.value)}
                  style={sliderStyle} />

                <PLabel>Letter spacing <Dim>{(letterSp * 100).toFixed(0)}%</Dim></PLabel>
                <input type="range" min={-0.05} max={0.25} step={0.005} value={letterSp}
                  onChange={e => setLS(+e.target.value)}
                  style={sliderStyle} />

                <Hr />

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                  <div>
                    <p style={{ fontSize: 11, fontWeight: 600, color: T.ink }}>Signature Mode</p>
                    <p style={{ fontSize: 9, color: T.inkLt, marginTop: 2 }}>Add italic slant</p>
                  </div>
                  <Toggle value={signMode} onChange={setSign} />
                </div>

                {/* Render mode info + DEBUG */}
                <Hr />
                <PLabel>Render Mode</PLabel>
                <div style={{ background: "#F0EBE0", borderRadius: 8, padding: "10px 12px", marginBottom: 12 }}>
                  <p style={{ fontSize: 10, color: T.inkMd, lineHeight: 1.6 }}>
                    <b style={{ color: T.ink }}>Font ✦PUA</b> — real TTF, random variant per position<br/>
                    <b style={{ color: T.rust }}>SVG</b> — renders paths directly, random variant per character
                  </p>
                  {hasPua && renderMode === 'font' && (
                    <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${T.border}` }}>
                      <p style={{ fontSize: 9, color: T.inkLt, marginBottom: 4 }}>PUA Seed: {randomSeed}</p>
                      <button
                        onClick={() => setRandSeed(s => s + 1)}
                        style={{
                          width: "100%", padding: "6px 0",
                          background: T.rust, color: "#fff",
                          border: "none", borderRadius: 6,
                          fontSize: 10, fontWeight: 700,
                          cursor: "pointer", fontFamily: "inherit",
                          letterSpacing: "0.06em",
                        }}
                      >🎲 Reshuffle Variants</button>
                    </div>
                  )}
                  {!hasPua && (
                    <p style={{ fontSize: 9, color: T.rust, marginTop: 6 }}>
                      ⚠ Build font from Step 4 first to enable PUA mode
                    </p>
                  )}
                </div>

                {/* ── DEBUG PANEL ── แสดง codepoint จริงที่ถูก inject ต่อ position */}
                <Hr />
                <PLabel>🔬 PUA Debug</PLabel>
                <div style={{ background: "#1C1714", borderRadius: 8, padding: "10px 12px", marginBottom: 8 }}>
                  {/* สถานะ puaMap */}
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                    <span style={{ fontSize: 9, color: hasPua ? T.sage : T.rust, fontFamily: "monospace" }}>
                      puaMap: {hasPua ? `✓ ${puaMap.size} chars` : "✗ null / empty"}
                    </span>
                    <span style={{ fontSize: 9, color: T.inkLt, fontFamily: "monospace" }}>
                      seed: {randomSeed}
                    </span>
                  </div>

                  {/* ตรวจว่า font มี PUA glyphs จริงไหม — ดูจาก codepoint ใน puaText */}
                  {hasPua && renderMode === 'font' && (() => {
                    // วิเคราะห์ puaText — แสดง 12 ตัวแรก
                    const chars = [...text].filter(c => !/\s/.test(c)).slice(0, 12)
                    const puaChars = [...puaText].filter(c => !/\s/.test(c)).slice(0, 12)
                    return (
                      <div>
                        <p style={{ fontSize: 8, color: T.inkLt, marginBottom: 4, letterSpacing: "0.06em" }}>
                          CHAR → CODEPOINT (v0=original, v1=PUA+E000, v2=PUA+E400)
                        </p>
                        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                          {chars.map((ch, i) => {
                            const pch = puaChars[i] ?? ch
                            const cp = pch.codePointAt(0)
                            const info = puaMap.get(ch)
                            const isV0 = cp === info?.v0
                            const isV1 = cp === info?.v1
                            const isV2 = cp === info?.v2
                            const varLabel = isV0 ? "v0" : isV1 ? "v1" : isV2 ? "v2" : "??"
                            const varColor = isV0 ? T.inkLt : isV1 ? T.gold : isV2 ? T.sage : T.rust
                            return (
                              <div key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                <span style={{ fontSize: 11, color: "#fff", width: 14, textAlign: "center", fontFamily: `'${FONT_FAMILY}', serif` }}>{ch}</span>
                                <span style={{ fontSize: 8, color: T.inkLt, fontFamily: "monospace" }}>→</span>
                                <span style={{ fontSize: 8, color: varColor, fontFamily: "monospace", fontWeight: 700 }}>{varLabel}</span>
                                <span style={{ fontSize: 8, color: T.inkLt, fontFamily: "monospace" }}>
                                  U+{cp?.toString(16).toUpperCase().padStart(4, "0")}
                                </span>
                                {!info && (
                                  <span style={{ fontSize: 8, color: T.rust }}>NO MAP</span>
                                )}
                              </div>
                            )
                          })}
                        </div>
                        <p style={{ fontSize: 8, color: T.inkLt, marginTop: 6 }}>
                          v0 (original) = U+0xxx · v1 = U+E0xx · v2 = U+E4xx
                        </p>
                      </div>
                    )
                  })()}

                  {/* กรณีไม่มี puaMap */}
                  {!hasPua && (
                    <p style={{ fontSize: 9, color: T.rust, fontFamily: "monospace" }}>
                      puaMap not received — rebuild font from Step 4
                    </p>
                  )}
                </div>

                {missingChars.length > 0 && (
                  <div style={{ padding: "10px 12px", background: "#FEF6E8", border: `1px solid ${T.gold}`, borderRadius: 8 }}>
                    <p style={{ fontSize: 10, color: T.gold, fontWeight: 700, marginBottom: 4 }}>⚠ Missing {missingChars.length} glyphs</p>
                    <p style={{ fontSize: 10, color: T.inkMd, letterSpacing: "0.1em" }}>{missingChars.join("  ")}</p>
                  </div>
                )}
              </>}

              {/* ── PAPER PANEL ── */}
              {panel === "paper" && <>
                <PLabel>Background</PLabel>
                <div style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: 18 }}>
                  {PAPERS.map(p => (
                    <button key={p.id} onClick={() => setPaper(p.id)} style={{
                      display: "flex", alignItems: "center", gap: 10,
                      padding: "9px 12px",
                      border: `1.5px solid ${paper === p.id ? T.rust : T.border}`,
                      borderRadius: 8,
                      background: paper === p.id ? "#F5EDE0" : "white",
                      cursor: "pointer", fontFamily: "inherit",
                      transition: "all .12s",
                    }}>
                      <div style={{
                        width: 30, height: 22, borderRadius: 4,
                        background: p.bg, border: `1px solid ${T.border}`,
                        flexShrink: 0,
                        ...(p.texture === 'ruled' ? {
                          backgroundImage: `repeating-linear-gradient(transparent,transparent 4px,rgba(0,60,200,.15) 4px,rgba(0,60,200,.15) 5px)`,
                        } : p.texture === 'grid' ? {
                          backgroundImage: `linear-gradient(rgba(0,60,200,.12) 1px,transparent 1px),linear-gradient(90deg,rgba(0,60,200,.12) 1px,transparent 1px)`,
                          backgroundSize: "5px 5px",
                        } : {}),
                      }} />
                      <span style={{ fontSize: 11, color: paper === p.id ? T.ink : T.inkMd, fontWeight: paper === p.id ? 700 : 400 }}>
                        {p.label}
                      </span>
                      {paper === p.id && <span style={{ marginLeft: "auto", color: T.rust, fontSize: 12 }}>✓</span>}
                    </button>
                  ))}
                </div>

                <Hr />
                <PLabel>Zoom <Dim>{Math.round(zoom*100)}%</Dim></PLabel>
                <input type="range" min={0.3} max={1.5} step={0.05} value={zoom}
                  onChange={e => setZoom(+e.target.value)}
                  style={sliderStyle} />
              </>}

              {/* ── EXPORT PANEL ── */}
              {panel === "export" && <>
                <PLabel>Text</PLabel>
                <textarea
                  value={text} onChange={e => setText(e.target.value)}
                  rows={7} placeholder="Type here…"
                  style={{
                    width: "100%", border: `1px solid ${T.border}`, borderRadius: 8,
                    padding: "10px 12px", fontSize: 12, fontFamily: "inherit",
                    color: T.ink, background: "white", resize: "vertical",
                    outline: "none", lineHeight: 1.6, marginBottom: 14,
                    boxSizing: "border-box",
                  }}
                />

                <PLabel>Export</PLabel>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <ExportRow icon="↓" label="Export PNG" sub="2× Retina" color={T.indigo} onClick={exportPNG} loading={exporting === "png"} />
                  <ExportRow icon={copied ? "✓" : "⎘"} label="Copy Text" sub={copied ? "Copied!" : "Copy"} color={copied ? T.sage : T.inkMd} onClick={copyText} />
                  <ExportRow icon="⬡" label="Font .ttf" sub="Coming soon" color={T.inkLt} disabled />
                  <ExportRow icon="⬢" label="PDF" sub="Coming soon" color={T.inkLt} disabled />
                </div>

                <Hr />
                <PLabel>Glyph Library ({glyphMap.size})</PLabel>
                <div style={{
                  display: "flex", flexWrap: "wrap", gap: 4,
                  maxHeight: 160, overflowY: "auto",
                  background: T.paperDk, borderRadius: 8, padding: 8,
                  border: `1px solid ${T.border}`,
                }}>
                  {Object.entries(glyphMapObj).map(([ch, g]) => (
                    <div key={ch} title={ch} style={{
                      width: 28, height: 28, border: `1px solid ${T.border}`,
                      borderRadius: 5, background: "white", overflow: "hidden",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      {g?.preview
                        ? <img src={g.preview} alt={ch} style={{ width: "80%", height: "80%", objectFit: "contain" }} />
                        : <span style={{ fontSize: 12, color: T.inkMd, fontFamily: "Georgia, serif" }}>{ch}</span>
                      }
                    </div>
                  ))}
                  {glyphMap.size === 0 && <p style={{ fontSize: 10, color: T.inkLt, padding: "2px 0" }}>No glyphs yet</p>}
                </div>
              </>}
            </div>
          </aside>
        )}
      </div>

      {/* ── BOTTOM TEXT INPUT ─────────────────────────────────────────────── */}
      <div style={{
        background: T.ink, borderTop: `2px solid ${T.rust}`,
        display: "flex", alignItems: "center",
        padding: "10px 18px", gap: 12, flexShrink: 0,
      }}>
        <span style={{ fontSize: 10, color: T.inkLt, letterSpacing: "0.1em", textTransform: "uppercase", whiteSpace: "nowrap", userSelect: "none" }}>
          ✍ Type
        </span>
        <textarea
          value={text} onChange={e => setText(e.target.value)}
          rows={2}
          placeholder="Type here… press Enter for a new line"
          style={{
            flex: 1, border: `1px solid rgba(255,255,255,.12)`, borderRadius: 6,
            padding: "8px 14px", fontSize: 13, fontFamily: "inherit",
            color: T.paper, background: "rgba(255,255,255,.06)",
            resize: "none", outline: "none", lineHeight: 1.5,
          }}
          onFocus={e => e.target.style.borderColor = "rgba(255,255,255,.3)"}
          onBlur={e  => e.target.style.borderColor = "rgba(255,255,255,.12)"}
        />
        <span style={{ fontSize: 9, color: T.inkLt, whiteSpace: "nowrap" }}>
          {text.replace(/\n/g,"").length} chars
        </span>
      </div>
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function TBtnDark({ children, onClick, active, title, disabled }) {
  return (
    <button onClick={onClick} title={title} disabled={disabled} style={{
      width: 28, height: 28,
      border: `1px solid ${active ? "rgba(255,255,255,.4)" : "transparent"}`,
      borderRadius: 5, background: active ? "rgba(255,255,255,.12)" : "transparent",
      color: disabled ? "rgba(255,255,255,.2)" : active ? "#fff" : "rgba(255,255,255,.55)",
      fontSize: 13, cursor: disabled ? "default" : "pointer",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "inherit", transition: "all .1s", flexShrink: 0,
    }}
      onMouseEnter={e => { if (!disabled && !active) e.currentTarget.style.background = "rgba(255,255,255,.08)" }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = "transparent" }}
    >{children}</button>
  )
}

function ModeToggle({ value, onChange, options }) {
  return (
    <div style={{ display: "flex", background: "rgba(255,255,255,.08)", borderRadius: 6, padding: 2, gap: 2 }}>
      {options.map(o => (
        <button key={o.id} onClick={() => onChange(o.id)} style={{
          padding: "3px 9px", border: "none", borderRadius: 4,
          background: value === o.id ? "rgba(255,255,255,.18)" : "transparent",
          color: value === o.id ? "#fff" : "rgba(255,255,255,.45)",
          fontSize: 10, cursor: "pointer", fontFamily: "inherit",
          fontWeight: value === o.id ? 700 : 400,
          letterSpacing: "0.04em", transition: "all .15s",
        }}>{o.label}</button>
      ))}
    </div>
  )
}

function Vr({ dark }) {
  return <div style={{ width: 1, height: 18, background: dark ? "rgba(255,255,255,.12)" : "#DDD5C4", margin: "0 2px", flexShrink: 0 }} />
}

function Hr() {
  return <div style={{ height: 1, background: "#E8E0D0", margin: "14px 0" }} />
}

function PLabel({ children }) {
  return <p style={{ fontSize: 9, fontWeight: 700, color: "#B8A898", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 7 }}>{children}</p>
}

function Dim({ children }) {
  return <span style={{ fontWeight: 400, color: "#B8A898", marginLeft: 4 }}>{children}</span>
}

function StatBox({ label, value, color }) {
  return (
    <div style={{ padding: "10px 6px", textAlign: "center", borderRight: "1px solid rgba(255,255,255,.06)" }}>
      <p style={{ fontSize: 18, fontWeight: 700, color, lineHeight: 1 }}>{value}</p>
      <p style={{ fontSize: 8, color: "rgba(255,255,255,.35)", marginTop: 4, letterSpacing: "0.08em" }}>{label}</p>
    </div>
  )
}

function PresetPill({ children, onClick }) {
  return (
    <button onClick={onClick} style={{
      padding: "4px 11px", border: `1px solid #DDD5C4`, borderRadius: 99,
      background: "white", fontSize: 10, color: "#6B5E52",
      cursor: "pointer", fontFamily: "inherit", transition: "all .12s",
    }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = "#1C1714"; e.currentTarget.style.color = "#1C1714" }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = "#DDD5C4"; e.currentTarget.style.color = "#6B5E52" }}
    >{children}</button>
  )
}

function Toggle({ value, onChange }) {
  return (
    <div onClick={() => onChange(!value)} style={{
      width: 36, height: 20, borderRadius: 99,
      background: value ? T.rust : T.border,
      position: "relative", cursor: "pointer",
      transition: "background .2s", flexShrink: 0,
    }}>
      <div style={{
        position: "absolute", top: 2, left: value ? 16 : 2,
        width: 16, height: 16, borderRadius: "50%", background: "white",
        boxShadow: "0 1px 4px rgba(0,0,0,.2)", transition: "left .2s",
      }} />
    </div>
  )
}

function ExportRow({ icon, label, sub, color, onClick, disabled, loading }) {
  return (
    <button onClick={!disabled ? onClick : undefined} disabled={disabled} style={{
      display: "flex", alignItems: "center", gap: 10,
      padding: "9px 13px", border: `1px solid ${T.border}`,
      borderRadius: 8, background: disabled ? T.paperDk : "white",
      cursor: disabled ? "not-allowed" : "pointer",
      fontFamily: "inherit", textAlign: "left",
      opacity: disabled ? 0.45 : 1, transition: "all .12s",
    }}
      onMouseEnter={e => { if (!disabled) e.currentTarget.style.borderColor = T.inkMd }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = T.border }}
    >
      <span style={{ fontSize: 16, flexShrink: 0, color: T.ink }}>
        {loading ? <Spin dark /> : icon}
      </span>
      <div>
        <p style={{ fontSize: 11, fontWeight: 600, color: disabled ? T.inkLt : T.ink }}>{label}</p>
        <p style={{ fontSize: 9, color, marginTop: 1, letterSpacing: "0.02em" }}>{sub}</p>
      </div>
    </button>
  )
}

function Spin({ dark }) {
  return (
    <span style={{
      display: "inline-block", width: 12, height: 12,
      border: `2px solid ${dark ? "rgba(0,0,0,.15)" : "rgba(255,255,255,.3)"}`,
      borderTopColor: dark ? T.ink : "#fff",
      borderRadius: "50%", animation: "spin .7s linear infinite",
      verticalAlign: "middle",
    }} />
  )
}

const sliderStyle = { width: "100%", accentColor: T.rust, marginBottom: 14, display: "block" }

const darkSelectStyle = {
  border: "1px solid rgba(255,255,255,.15)", borderRadius: 5,
  padding: "3px 4px", fontSize: 11, color: "#fff",
  background: "rgba(255,255,255,.08)", fontFamily: "inherit",
  outline: "none", width: 48, textAlign: "center",
}