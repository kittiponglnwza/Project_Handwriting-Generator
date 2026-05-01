/**
 * STEP 5 — HANDWRITING PREVIEW & EXPORT
 * UI redesign: warm ivory minimal — white / cream / warm tone
 * Logic unchanged — only styles replaced.
 */

import { useState, useRef, useCallback, useEffect, useMemo } from "react"

// ─── Design tokens ──────────────────────────────────────────────────────────
const T = {
  bg:        '#F9F6F1',
  paper:     '#FDFBF7',
  surface:   '#F4F0E8',
  surfaceAlt:'#EDE8DF',
  border:    '#E2DDD4',
  borderMd:  '#CCC6BB',
  ink:       '#2C2420',
  inkMd:     '#6B5E52',
  inkLt:     '#A89A8C',
  inkXl:     '#C8BAB0',
  amber:     '#B87333',
  amberLt:   '#F5EBD8',
  sage:      '#5A7A5E',
  sageLt:    '#DDE8DC',
  rose:      '#A0504A',
  roseLt:    '#F5E4E2',
  slate:     '#4A5E6E',
  slateLt:   '#DDE4EA',
}

if (typeof document !== 'undefined' && !document.getElementById('step5-keyframes')) {
  const s = document.createElement('style')
  s.id = 'step5-keyframes'
  s.textContent = `
    @keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(6px) } to { opacity: 1; transform: none } }
    @keyframes inkDrop { from { opacity: 0; transform: scale(.97) } to { opacity: 1; transform: scale(1) } }
    [contenteditable]:empty::before { content: attr(data-placeholder); opacity: 0.25; pointer-events: none; }
    [contenteditable]:focus { outline: none; }
  `
  document.head.appendChild(s)
}

// ─── Paper configs ───────────────────────────────────────────────────────────
const PAPERS = [
  { id: "blank",  label: "Blank",      bg: "#FDFBF7", texture: false },
  { id: "ruled",  label: "Ruled",      bg: "#FDFBF7", texture: "ruled" },
  { id: "grid",   label: "Grid",       bg: "#FDFBF7", texture: "grid" },
  { id: "aged",   label: "Aged",       bg: "#F2EBD9", texture: false },
  { id: "dark",   label: "Blackboard", bg: "#1A1F2E", texture: false },
  { id: "kraft",  label: "Kraft",      bg: "#D4B896", texture: false },
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

// ─── Per-position seeded RNG ─────────────────────────────────────────────────
function xorshift(seed) {
  let s = (seed * 1664525 + 1013904223) >>> 0
  s ^= s << 13; s ^= s >>> 17; s ^= s << 5
  return (s >>> 0) / 4294967296
}

// ─── SVG-based text renderer ─────────────────────────────────────────────────
function renderHandwrittenSVG({ text, glyphMap, fontSize, lineHeight, letterSp, width, margin, isDark, seed = 1 }) {
  if (!glyphMap || glyphMap.size === 0) return null
  const lhPx   = fontSize * lineHeight
  const inkCol = isDark ? "rgba(220,210,195,.92)" : T.ink
  const lines  = text.split("\n")
  const svgLines = []
  let posCounter = 0

  lines.forEach((line, li) => {
    const y = margin + li * lhPx + fontSize * 0.8
    let x = margin
    for (const ch of line) {
      if (ch === ' ') { x += fontSize * 0.35; posCounter++; continue }
      const variants = glyphMap.get(ch)
      if (!variants || variants.length === 0) {
        svgLines.push(`<text x="${x}" y="${y}" font-size="${fontSize}" fill="${inkCol}" opacity=".7">${ch}</text>`)
        x += fontSize * 0.6; posCounter++; continue
      }
      const rng    = xorshift(posCounter * 7919 + li * 31337 + seed * 999983)
      const picked = variants[Math.floor(rng * variants.length)]
      const rawPath = picked?.svgPath
      const svgPath = (rawPath && typeof rawPath === 'string' && rawPath.trim() && rawPath.trim() !== 'M 0 0')
        ? rawPath.trim() : null
      if (svgPath) {
        const yVals = []
        svgPath.replace(/[ML]\s*([-\d.]+)\s+([-\d.]+)/g, (_, _x, y) => yVals.push(+y))
        svgPath.replace(/C(?:\s*[-\d.]+\s+[-\d.]+\s+[-\d.]+\s+[-\d.]+\s+([-\d.]+)\s+([-\d.]+))+/g,
          (match) => { [...match.matchAll(/C|(?:([-\d.]+)\s+([-\d.]+))(?=\s|$)/g)].forEach(m => m[2] && yVals.push(+m[2])) })
        const actualBottom = yVals.length > 0 ? Math.max(...yVals) : (picked.svgBaseline ?? 80)
        const baselineRatio = Math.min(actualBottom, 95) / 100
        const scale = fontSize / 100
        const rot   = (xorshift(posCounter * 13337 + seed * 31337) - 0.5) * 1.5
        svgLines.push(
          `<g transform="translate(${x}, ${y - fontSize * baselineRatio}) rotate(${rot.toFixed(2)}, ${fontSize/2}, ${fontSize * baselineRatio}) scale(${scale})">
            <path d="${svgPath}" fill="${inkCol}" />
          </g>`
        )
        x += fontSize * (0.6 + letterSp)
      } else {
        svgLines.push(`<text x="${x}" y="${y}" font-size="${fontSize}" fill="${inkCol}" opacity=".6">${ch}</text>`)
        x += fontSize * 0.6
      }
      posCounter++
    }
  })

  const svgH = margin + lines.length * lhPx + margin
  return { svgLines, svgH }
}

// ─── Main component ──────────────────────────────────────────────────────────
export default function PreviewCanvas({ versionedGlyphs = [], extractedGlyphs = [], ttfBuffer = null, puaMap = null }) {

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

  const [fontStatus, setFontStatus] = useState('idle')
  const fontUrlRef  = useRef(null)
  const fontFaceRef = useRef(null)

  useEffect(() => {
    if (!ttfBuffer) { setFontStatus('idle'); return }
    setFontStatus('loading')
    if (fontFaceRef.current) { try { document.fonts.delete(fontFaceRef.current) } catch (_) {} fontFaceRef.current = null }
    if (fontUrlRef.current)  { URL.revokeObjectURL(fontUrlRef.current); fontUrlRef.current = null }

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
        for (const f of document.fonts) { if (f.family === FONT_FAMILY && f !== loaded) try { document.fonts.delete(f) } catch (_) {} }
        document.fonts.add(loaded)
        setFontStatus('ready')
      })
      .catch(err => { console.error('[Step5]', err); setFontStatus('error') })
    return () => { if (fontUrlRef.current) { URL.revokeObjectURL(fontUrlRef.current); fontUrlRef.current = null } }
  }, [ttfBuffer])

  const [text,       setText]    = useState("Hello World\nThis is my handwriting")
  const textRef      = useRef("Hello World\nThis is my handwriting") // source of truth สำหรับ DOM
  const [fontSize,   setFS]      = useState(32)
  const [lineHeight, setLH]      = useState(1.8)
  const [letterSp,   setLS]      = useState(0.02)
  const [textAlign,  setAlign]   = useState("left")
  const [paper,      setPaper]   = useState("blank")
  const [zoom,       setZoom]    = useState(0.85)
  const [signMode,   setSign]    = useState(false)
  const [panel,      setPanel]   = useState("style")
  const [showPanel,  setShowP]   = useState(true)
  const [renderMode, setRMode]   = useState("font")
  const [exporting,  setExp]     = useState(null)
  const [copied,     setCopied]  = useState(false)
  const [randomSeed, setRandSeed]= useState(42)
  const [findChar,   setFindChar]= useState("")
  const [bold,       setBold]    = useState(false)
  const [italic,     setItalic]  = useState(false)
  const [underline,  setUnder]   = useState(false)
  const [textColor,  setTColor]  = useState(null) // null = use inkColor default

  const paperRef    = useRef(null)
  const editableRef = useRef(null)
  const debounceRef = useRef(null)

  // Init DOM ครั้งเดียวตอน mount
  useEffect(() => {
    if (editableRef.current) editableRef.current.innerText = textRef.current
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const paperCfg = PAPERS.find(p => p.id === paper) ?? PAPERS[0]
  const isDark   = paperCfg.bg === "#1A1F2E"
  const inkColor = isDark ? "rgba(220,210,195,.92)" : T.ink

  const hasThaiText    = useMemo(() => THAI_RE.test(text), [text])
  const requiredChars  = useMemo(() => { const s = new Set(); for (const c of text) if (!/\s/.test(c)) s.add(c); return [...s] }, [text])
  const missingChars   = useMemo(() => fontStatus !== 'ready' ? [] : requiredChars.filter(c => !glyphMapObj[c]), [requiredChars, glyphMapObj, fontStatus])
  const canUseFont     = fontStatus === 'ready' && missingChars.length === 0
  const activeFontFamily = canUseFont ? `'${FONT_FAMILY}', 'Noto Sans Thai', sans-serif` : `'Noto Sans Thai', 'TH Sarabun New', Tahoma, sans-serif`
  const coveragePct    = useMemo(() => {
    if (!requiredChars.length) return "—"
    const have = requiredChars.filter(c => glyphMapObj[c]).length
    return `${Math.round(have / requiredChars.length * 100)}%`
  }, [requiredChars, glyphMapObj])

  const hasPua = puaMap && puaMap.size > 0

  const puaText = useMemo(() => {
    if (!hasPua || renderMode !== 'font') return text
    let pos = 0
    return [...text].map(ch => {
      if (/\s/.test(ch)) { pos++; return ch }
      const info = puaMap.get(ch)
      if (!info) { pos++; return ch }
      const seq = info.rotationSequence ?? [info.default, info.alt1, info.alt2, info.alt3, info.alt4].filter(Boolean)
      if (!seq || seq.length === 0) { pos++; return ch }
      const r  = xorshift(pos * 7919 + randomSeed * 999983)
      const cp = seq[Math.floor(r * seq.length)]
      pos++
      if (cp == null || !Number.isFinite(cp)) return ch
      return String.fromCodePoint(cp)
    }).join('')
  }, [text, puaMap, hasPua, randomSeed, renderMode])

  const svgData = useMemo(() => {
    if (renderMode !== 'svg' || glyphMap.size === 0) return null
    return renderHandwrittenSVG({ text, glyphMap, fontSize, lineHeight, letterSp: letterSp * fontSize, width: A4W, margin: MARGIN, isDark, seed: randomSeed })
  }, [text, glyphMap, fontSize, lineHeight, letterSp, renderMode, isDark, randomSeed])

  const textStyle = useMemo(() => ({
    fontFamily: activeFontFamily, fontSize: `${fontSize * zoom}px`,
    lineHeight, letterSpacing: hasThaiText ? 'normal' : `${letterSp}em`,
    color: textColor ?? inkColor, textAlign, whiteSpace: 'pre-wrap',
    wordBreak: 'normal', overflowWrap: 'normal',
    fontKerning: 'normal',
    fontWeight: bold ? 700 : 400,
    fontStyle: italic || signMode ? 'italic' : 'normal',
    textDecoration: underline ? 'underline' : 'none',
    fontFeatureSettings: canUseFont ? '"salt" 1, "calt" 1' : 'normal',
    textRendering: 'optimizeLegibility', WebkitFontSmoothing: 'antialiased',
    ...(signMode ? { transform: 'rotate(-1deg)', display: 'inline-block' } : {}),
  }), [activeFontFamily, fontSize, zoom, lineHeight, letterSp, textColor, inkColor, textAlign, signMode, hasThaiText, canUseFont, bold, italic, underline])

  const exportPNG = useCallback(async () => {
    if (!paperRef.current) return
    setExp("png")
    await new Promise(r => setTimeout(r, 200))
    try {
      const node = paperRef.current, SC = 2
      const canvas = document.createElement("canvas")
      canvas.width = node.offsetWidth * SC; canvas.height = node.offsetHeight * SC
      const ctx = canvas.getContext("2d")
      ctx.fillStyle = paperCfg.bg; ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.scale(SC, SC)
      ctx.font = `${signMode ? "italic " : ""}${fontSize}px ${activeFontFamily}`
      ctx.fillStyle = inkColor; ctx.textBaseline = "top"; ctx.textAlign = textAlign
      const lhPx  = fontSize * lineHeight
      const drawX = textAlign === "center" ? node.offsetWidth / 2 : textAlign === "right" ? node.offsetWidth - MARGIN * zoom : MARGIN * zoom
      textRef.current.split("\n").forEach((line, i) => ctx.fillText(line, drawX, MARGIN * zoom + i * lhPx * zoom))
      canvas.toBlob(b => {
        const a = document.createElement("a"); a.href = URL.createObjectURL(b)
        a.download = `handwriting-${Date.now()}.png`; a.click()
        setTimeout(() => URL.revokeObjectURL(a.href), 5000)
      }, "image/png")
    } catch (e) { console.error(e) }
    setExp(null)
  }, [text, fontSize, lineHeight, zoom, fontStatus, glyphMapObj, signMode, textAlign, paperCfg, activeFontFamily, inkColor])

  const copyText = async () => {
    await navigator.clipboard.writeText(text)
    setCopied(true); setTimeout(() => setCopied(false), 1800)
  }

  const paperBgStyle = useMemo(() => {
    const base = { background: paperCfg.bg }
    if (paperCfg.texture === 'ruled') return {
      ...base,
      backgroundImage: `repeating-linear-gradient(to bottom,transparent,transparent ${(fontSize * lineHeight * zoom)-1}px,rgba(${isDark?'180,160,120':'0,60,180'},.1) ${(fontSize * lineHeight * zoom)-1}px,rgba(${isDark?'180,160,120':'0,60,180'},.1) ${fontSize * lineHeight * zoom}px)`,
      backgroundPosition: `0 ${MARGIN * zoom + fontSize * zoom * 0.9}px`,
    }
    if (paperCfg.texture === 'grid') return {
      ...base,
      backgroundImage: `linear-gradient(rgba(0,60,180,.06) 1px,transparent 1px),linear-gradient(90deg,rgba(0,60,180,.06) 1px,transparent 1px)`,
      backgroundSize: `${24*zoom}px ${24*zoom}px`,
    }
    return base
  }, [paperCfg, fontSize, lineHeight, zoom, isDark])

  const statusMeta = {
    idle:    { dot: '○', color: T.inkXl, label: 'Waiting for font build from Step 4' },
    loading: { dot: '◌', color: T.amber, label: 'Loading font…' },
    ready:   { dot: '●', color: T.sage,  label: canUseFont ? `MyHandwriting — ${glyphMap.size} glyphs` : `Fallback font (missing ${missingChars.length} glyphs)` },
    error:   { dot: '✕', color: T.rose,  label: 'Failed to load font' },
  }[fontStatus]

  // ── RENDER ──────────────────────────────────────────────────────────────────
  return (
    <div style={{
      display: "flex", flexDirection: "column", height: "100%",
      background: T.bg,
      fontFamily: "'DM Mono', 'Courier New', monospace",
      overflow: "hidden",
    }}>

      {/* ── TOP TOOLBAR ─────────────────────────────────────────────────────── */}
      <div style={{
        background: T.paper,
        borderBottom: `1px solid ${T.border}`,
        flexShrink: 0,
      }}>
        {/* Row 1: Brand + zoom + toggle + export */}
        <div style={{
          height: 44,
          display: "flex", alignItems: "center",
          padding: "0 18px", gap: 8,
          borderBottom: `1px solid ${T.border}`,
        }}>
          <span style={{
            fontSize: 11, fontWeight: 700, color: T.ink,
            letterSpacing: "0.14em", textTransform: "uppercase", marginRight: 6,
            opacity: 0.85, whiteSpace: "nowrap",
          }}>Preview</span>

          <Vr />

          {/* Presets */}
          <div style={{ display: "flex", gap: 3 }}>
            {PRESETS.map(p => (
              <button key={p.id} onClick={() => { setFS(p.size); setLH(p.lh); setLS(p.ls) }} style={{
                padding: "3px 9px", border: `1.5px solid ${T.border}`, borderRadius: 99,
                background: T.paper, fontSize: 10, color: T.inkMd,
                cursor: "pointer", fontFamily: "inherit", transition: "all .12s",
              }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = T.ink; e.currentTarget.style.color = T.ink }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = T.border; e.currentTarget.style.color = T.inkMd }}
              >{p.label}</button>
            ))}
          </div>

          <div style={{ flex: 1 }} />

          {/* Zoom */}
          <span style={{ fontSize: 10, color: T.inkLt }}>{Math.round(zoom*100)}%</span>
          <input type="range" min={0.3} max={1.5} step={0.05} value={zoom}
            onChange={e => setZoom(+e.target.value)}
            style={{ width: 64, accentColor: T.amber }} />

          <Vr />
          <TBtn active={showPanel} onClick={() => setShowP(s => !s)} title="Toggle panel">⊞</TBtn>

          {/* Export button */}
          <button onClick={exportPNG} style={{
            marginLeft: 4, padding: "6px 16px",
            background: T.ink, color: T.paper,
            border: "none", borderRadius: 7,
            fontSize: 11, fontWeight: 600,
            cursor: "pointer", fontFamily: "inherit",
            display: "flex", alignItems: "center", gap: 6,
            letterSpacing: "0.08em", textTransform: "uppercase",
            opacity: exporting ? 0.6 : 1, flexShrink: 0,
            transition: "opacity 0.15s",
          }}>
            {exporting ? <Spin /> : "↓"}
            {" "}Export
          </button>
        </div>

        {/* Row 2: Formatting controls */}
        <div style={{
          height: 40,
          display: "flex", alignItems: "center",
          padding: "0 18px", gap: 6,
        }}>
          {/* Text align */}
          {[
            { id: "left",   icon: "≡", title: "Align left" },
            { id: "center", icon: "≡", title: "Align center" },
            { id: "right",  icon: "≡", title: "Align right" },
          ].map(a => (
            <TBtn key={a.id} active={textAlign === a.id} onClick={() => setAlign(a.id)} title={a.title}>
              {a.icon}
            </TBtn>
          ))}

          <Vr />

          {/* Bold / Italic / Underline */}
          <TBtn active={bold}      onClick={() => setBold(b => !b)}    title="Bold"><b>B</b></TBtn>
          <TBtn active={italic}    onClick={() => setItalic(i => !i)}  title="Italic"><i>I</i></TBtn>
          <TBtn active={underline} onClick={() => setUnder(u => !u)}   title="Underline"><u>U</u></TBtn>

          <Vr />

          {/* Size select */}
          <select
            value={fontSize}
            onChange={e => setFS(+e.target.value)}
            style={{
              border: `1.5px solid ${T.border}`, borderRadius: 6,
              padding: "3px 6px", fontSize: 11, color: T.ink,
              background: T.paper, outline: "none", fontFamily: "inherit",
              cursor: "pointer",
            }}
          >
            {SIZES.map(s => <option key={s} value={s}>{s}px</option>)}
          </select>

          <Vr />

          {/* Line height */}
          <span style={{ fontSize: 10, color: T.inkLt, whiteSpace: "nowrap" }}>LH</span>
          <input type="range" min={1} max={3} step={0.1} value={lineHeight}
            onChange={e => setLH(+e.target.value)}
            style={{ width: 60, accentColor: T.amber }} />
          <span style={{ fontSize: 10, color: T.inkXl, minWidth: 24 }}>{lineHeight.toFixed(1)}</span>

          <Vr />

          {/* Letter spacing */}
          <span style={{ fontSize: 10, color: T.inkLt, whiteSpace: "nowrap" }}>LS</span>
          <input type="range" min={-0.05} max={0.25} step={0.005} value={letterSp}
            onChange={e => setLS(+e.target.value)}
            style={{ width: 60, accentColor: T.amber }} />
          <span style={{ fontSize: 10, color: T.inkXl, minWidth: 32 }}>{(letterSp*100).toFixed(0)}%</span>

          <Vr />

          {/* Text color */}
          <span style={{ fontSize: 10, color: T.inkLt }}>A</span>
          <input type="color"
            value={textColor ?? (isDark ? "#dcd2c3" : "#2C2420")}
            onChange={e => setTColor(e.target.value)}
            title="Text color"
            style={{ width: 24, height: 24, border: `1.5px solid ${T.border}`, borderRadius: 5, padding: 1, cursor: "pointer", background: "none" }}
          />
          {textColor && (
            <TBtn onClick={() => setTColor(null)} title="Reset color">✕</TBtn>
          )}

          {/* Reshuffle */}
          {hasPua && renderMode === 'font' && (
            <>
              <Vr />
              <TBtn onClick={() => setRandSeed(s => s+1)} title="Reshuffle variants">🎲</TBtn>
            </>
          )}
        </div>
      </div>

      {/* ── PANEL TABS ──────────────────────────────────────────────────────── */}
      {showPanel && (
        <div style={{
          display: "flex",
          borderBottom: `1px solid ${T.border}`,
          background: T.surface,
          paddingLeft: 18,
          flexShrink: 0,
        }}>
          {[
            { id: "style",  label: "Style"  },
            { id: "paper",  label: "Paper"  },
            { id: "glyphs", label: "Glyphs" },
            { id: "export", label: "Text"   },
          ].map(t => (
            <button key={t.id} onClick={() => setPanel(t.id)} style={{
              padding: "9px 16px",
              border: "none",
              borderBottom: panel === t.id ? `2px solid ${T.ink}` : "2px solid transparent",
              background: "transparent",
              fontSize: 10, fontWeight: panel === t.id ? 700 : 400,
              color: panel === t.id ? T.ink : T.inkMd,
              cursor: "pointer", fontFamily: "inherit",
              letterSpacing: "0.07em", textTransform: "uppercase",
              transition: "all .15s",
            }}>{t.label}</button>
          ))}
        </div>
      )}

      {/* ── STATUS STRIP ────────────────────────────────────────────────────── */}
      <div style={{
        height: 28, background: T.surface,
        borderBottom: `1px solid ${T.border}`,
        display: "flex", alignItems: "center",
        padding: "0 18px", gap: 8, flexShrink: 0,
      }}>
        <span style={{ fontSize: 10, color: statusMeta.color, fontFamily: "monospace" }}>{statusMeta.dot}</span>
        <span style={{ fontSize: 10, color: T.inkMd, letterSpacing: "0.03em" }}>
          {statusMeta.label}
          {fontStatus === 'ready' && canUseFont && (
            <span style={{ marginLeft: 6, color: T.sage }}>✓</span>
          )}
        </span>
        {fontStatus === 'ready' && hasPua && renderMode === 'font' && (
          <span style={{ marginLeft: 10, fontSize: 9, color: T.amber, letterSpacing: "0.05em" }}>
            ✦ PUA mode — random variant per position
          </span>
        )}
        {renderMode === 'svg' && glyphMap.size > 0 && (
          <span style={{ marginLeft: 10, fontSize: 9, color: T.slate, letterSpacing: "0.05em" }}>
            ✦ SVG mode — per-position randomized
          </span>
        )}
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 9, color: T.inkXl }}>{text.replace(/\n/g,"").length} chars</span>
      </div>

      {/* ── BODY ────────────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>

        {/* ── CANVAS AREA ── */}
        <div style={{
          flex: 1, overflowY: "auto", overflowX: "auto",
          display: "flex", justifyContent: "center", alignItems: "flex-start",
          padding: "40px 40px 80px",
          background: T.surfaceAlt,
          backgroundImage: `radial-gradient(circle at 1px 1px, ${T.borderMd} 1px, transparent 0)`,
          backgroundSize: "24px 24px",
        }}>
          {/* Paper */}
          <div
            ref={paperRef}
            style={{
              width: A4W * zoom, minHeight: A4H * zoom,
              borderRadius: 3,
              boxShadow: "0 2px 16px rgba(44,36,32,.10), 0 1px 4px rgba(44,36,32,.06), inset 0 0 0 1px rgba(44,36,32,.04)",
              position: "relative", flexShrink: 0, overflow: "hidden",
              padding: MARGIN * zoom, animation: "inkDrop .3s ease",
              ...paperBgStyle,
            }}
          >
            {/* Left margin rule */}
            {!isDark && (
              <div style={{
                position: "absolute", left: 56 * zoom, top: 0, bottom: 0,
                width: 1, background: "rgba(180,90,70,.1)", pointerEvents: "none",
              }} />
            )}

            {renderMode === 'font' ? (
              <div
                ref={editableRef}
                contentEditable
                suppressContentEditableWarning
                data-placeholder="Start writing here…"
                onInput={e => {
                  const raw = e.currentTarget.innerText ?? ""
                  textRef.current = raw
                  // debounce setState 300ms — React จะ re-render หลังหยุดพิม
                  // ไม่แตะ DOM ระหว่างพิม = cursor ไม่กระโดด
                  clearTimeout(debounceRef.current)
                  debounceRef.current = setTimeout(() => setText(raw), 300)
                }}
                style={{
                  ...textStyle,
                  outline: "none",
                  minHeight: `${fontSize * lineHeight * 3}px`,
                  cursor: "text",
                  caretColor: inkColor,
                  whiteSpace: "pre-wrap",
                }}
              />
            ) : svgData ? (
              <svg
                width={(A4W - MARGIN * 2) * zoom}
                height={Math.max(svgData.svgH * zoom, (A4H - MARGIN * 2) * zoom)}
                viewBox={`0 0 ${A4W - MARGIN * 2} ${Math.max(svgData.svgH, A4H - MARGIN * 2)}`}
                style={{ display: "block", overflow: "visible" }}
                dangerouslySetInnerHTML={{ __html: svgData.svgLines.join('\n') }}
              />
            ) : (
              <div style={{ color: T.inkLt, fontSize: 13, fontStyle: "italic" }}>
                No glyph data yet — upload a PDF first
              </div>
            )}

            {/* Page number */}
            <div style={{
              position: "absolute", bottom: 18 * zoom, right: 24 * zoom,
              fontSize: 8 * zoom, color: isDark ? "rgba(255,255,255,.1)" : "rgba(44,36,32,.12)",
              letterSpacing: "0.2em", fontFamily: "Georgia, serif", userSelect: "none",
            }}>— 1 —</div>

            {text.trim() === "" && (
              <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
                <p style={{
                  fontSize: 14 * zoom, color: isDark ? "rgba(255,255,255,.1)" : "rgba(44,36,32,.14)",
                  fontFamily: "Georgia, serif", fontStyle: "italic",
                }}>Click to start writing…</p>
              </div>
            )}
          </div>
        </div>

        {/* ── RIGHT PANEL ── */}
        {showPanel && (
          <aside style={{
            width: 260, minWidth: 260,
            background: T.paper,
            borderLeft: `1px solid ${T.border}`,
            display: "flex", flexDirection: "column", overflow: "hidden",
          }}>
            <div style={{ flex: 1, overflowY: "auto", padding: 18 }}>

              {/* ── STYLE PANEL ── */}
              {panel === "style" && <>
                {/* Stats row */}
                <div style={{
                  display: "grid", gridTemplateColumns: "1fr 1fr 1fr",
                  background: T.surface,
                  border: `1px solid ${T.border}`,
                  borderRadius: 10, overflow: "hidden", marginBottom: 20,
                }}>
                  <StatBox label="Glyphs"   value={extractedGlyphs.length} color={T.amber} />
                  <StatBox label="Unique"   value={glyphMap.size}           color={T.sage}  />
                  <StatBox label="Coverage" value={coveragePct}             color={T.slate} />
                </div>

                <PLabel>Presets</PLabel>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 18 }}>
                  {PRESETS.map(p => (
                    <PresetPill key={p.id} onClick={() => { setFS(p.size); setLH(p.lh); setLS(p.ls) }}>
                      {p.label}
                    </PresetPill>
                  ))}
                </div>

                <PLabel>Size <Dim>{fontSize}px</Dim></PLabel>
                <input type="range" min={8} max={120} value={fontSize}
                  onChange={e => setFS(+e.target.value)} style={sliderStyle} />

                <PLabel>Line height <Dim>{lineHeight.toFixed(1)}</Dim></PLabel>
                <input type="range" min={1} max={3} step={0.1} value={lineHeight}
                  onChange={e => setLH(+e.target.value)} style={sliderStyle} />

                <PLabel>Letter spacing <Dim>{(letterSp * 100).toFixed(0)}%</Dim></PLabel>
                <input type="range" min={-0.05} max={0.25} step={0.005} value={letterSp}
                  onChange={e => setLS(+e.target.value)} style={sliderStyle} />

                <Hr />

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
                  <div>
                    <p style={{ fontSize: 11, fontWeight: 600, color: T.ink }}>Signature Mode</p>
                    <p style={{ fontSize: 9, color: T.inkLt, marginTop: 2 }}>Add italic slant</p>
                  </div>
                  <Toggle value={signMode} onChange={setSign} />
                </div>

                <Hr />
                <PLabel>Render Mode</PLabel>
                <div style={{
                  background: T.surface, border: `1px solid ${T.border}`,
                  borderRadius: 9, padding: "12px 14px", marginBottom: 12,
                }}>
                  <p style={{ fontSize: 10, color: T.inkMd, lineHeight: 1.7 }}>
                    <b style={{ color: T.ink }}>Font ✦ PUA</b> — real TTF, random variant per position<br/>
                    <b style={{ color: T.slate }}>SVG</b> — renders paths directly, random per character
                  </p>
                  {hasPua && renderMode === 'font' && (
                    <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${T.border}` }}>
                      <p style={{ fontSize: 9, color: T.inkLt, marginBottom: 6 }}>PUA Seed: {randomSeed}</p>
                      <button
                        onClick={() => setRandSeed(s => s+1)}
                        style={{
                          width: "100%", padding: "7px 0",
                          background: T.ink, color: T.paper,
                          border: "none", borderRadius: 7,
                          fontSize: 10, fontWeight: 600,
                          cursor: "pointer", fontFamily: "inherit",
                          letterSpacing: "0.07em",
                        }}
                      >🎲 Reshuffle Variants</button>
                    </div>
                  )}
                  {!hasPua && (
                    <p style={{ fontSize: 9, color: T.rose, marginTop: 8 }}>
                      ⚠ Build font from Step 4 first to enable PUA mode
                    </p>
                  )}
                </div>

                <Hr />
                <PLabel>🔬 PUA Debug</PLabel>
                <div style={{
                  background: T.ink, borderRadius: 9,
                  padding: "11px 13px", marginBottom: 8,
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 7 }}>
                    <span style={{ fontSize: 9, color: hasPua ? T.sage : T.rose, fontFamily: "monospace" }}>
                      puaMap: {hasPua ? `✓ ${puaMap.size} chars` : "✗ null / empty"}
                    </span>
                    <span style={{ fontSize: 9, color: T.inkLt, fontFamily: "monospace" }}>seed: {randomSeed}</span>
                  </div>

                  {hasPua && renderMode === 'font' && (() => {
                    const chars    = [...text].filter(c => !/\s/.test(c)).slice(0, 12)
                    const puaChars = [...puaText].filter(c => !/\s/.test(c)).slice(0, 12)
                    return (
                      <div>
                        <p style={{ fontSize: 8, color: T.inkLt, marginBottom: 5, letterSpacing: "0.06em" }}>
                          CHAR → CODEPOINT (default / alt1–alt4)
                        </p>
                        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                          {chars.map((ch, i) => {
                            const pch = puaChars[i] ?? ch
                            const cp  = pch.codePointAt(0)
                            const info = puaMap.get(ch)
                            const seq  = info?.rotationSequence ?? [info?.default, info?.alt1, info?.alt2, info?.alt3, info?.alt4].filter(Boolean)
                            const varIdx   = seq ? seq.indexOf(cp) : -1
                            const varLabel = varIdx === 0 ? "default" : varIdx > 0 ? `alt${varIdx}` : "??"
                            const varColor = varIdx === 0 ? T.inkLt : varIdx === 1 ? T.amber : varIdx > 1 ? T.sage : T.rose
                            return (
                              <div key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                <span style={{ fontSize: 11, color: "#fff", width: 14, textAlign: "center", fontFamily: `'${FONT_FAMILY}', serif` }}>{ch}</span>
                                <span style={{ fontSize: 8, color: T.inkLt, fontFamily: "monospace" }}>→</span>
                                <span style={{ fontSize: 8, color: varColor, fontFamily: "monospace", fontWeight: 700 }}>{varLabel}</span>
                                <span style={{ fontSize: 8, color: T.inkLt, fontFamily: "monospace" }}>
                                  U+{cp?.toString(16).toUpperCase().padStart(4, "0")}
                                </span>
                                {!info && <span style={{ fontSize: 8, color: T.rose }}>NO MAP</span>}
                              </div>
                            )
                          })}
                        </div>
                        <p style={{ fontSize: 8, color: T.inkLt, marginTop: 7 }}>
                          default = original · alt1–alt4 = PUA variants
                        </p>
                      </div>
                    )
                  })()}

                  {!hasPua && (
                    <p style={{ fontSize: 9, color: T.rose, fontFamily: "monospace" }}>
                      puaMap not received — rebuild font from Step 4
                    </p>
                  )}
                </div>

                {missingChars.length > 0 && (
                  <div style={{
                    padding: "10px 13px",
                    background: T.amberLt,
                    border: `1px solid ${T.amber}44`,
                    borderRadius: 9,
                  }}>
                    <p style={{ fontSize: 10, color: T.amber, fontWeight: 700, marginBottom: 4 }}>⚠ Missing {missingChars.length} glyphs</p>
                    <p style={{ fontSize: 10, color: T.inkMd, letterSpacing: "0.1em" }}>{missingChars.join("  ")}</p>
                  </div>
                )}
              </>}

              {/* ── PAPER PANEL ── */}
              {panel === "paper" && <>
                <PLabel>Background</PLabel>
                <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 20 }}>
                  {PAPERS.map(p => (
                    <button key={p.id} onClick={() => setPaper(p.id)} style={{
                      display: "flex", alignItems: "center", gap: 10,
                      padding: "9px 12px",
                      border: `1.5px solid ${paper === p.id ? T.ink : T.border}`,
                      borderRadius: 8,
                      background: paper === p.id ? T.surface : T.paper,
                      cursor: "pointer", fontFamily: "inherit",
                      transition: "all .12s",
                    }}
                      onMouseEnter={e => { if (paper !== p.id) e.currentTarget.style.borderColor = T.borderMd }}
                      onMouseLeave={e => { if (paper !== p.id) e.currentTarget.style.borderColor = T.border }}
                    >
                      <div style={{
                        width: 30, height: 22, borderRadius: 4, flexShrink: 0,
                        background: p.bg, border: `1px solid ${T.border}`,
                        ...(p.texture === 'ruled' ? {
                          backgroundImage: 'repeating-linear-gradient(transparent,transparent 4px,rgba(0,60,180,.12) 4px,rgba(0,60,180,.12) 5px)',
                        } : p.texture === 'grid' ? {
                          backgroundImage: 'linear-gradient(rgba(0,60,180,.1) 1px,transparent 1px),linear-gradient(90deg,rgba(0,60,180,.1) 1px,transparent 1px)',
                          backgroundSize: "5px 5px",
                        } : {}),
                      }} />
                      <span style={{
                        fontSize: 11.5,
                        color: paper === p.id ? T.ink : T.inkMd,
                        fontWeight: paper === p.id ? 600 : 400,
                      }}>{p.label}</span>
                      {paper === p.id && (
                        <span style={{ marginLeft: "auto", color: T.amber, fontSize: 11 }}>✓</span>
                      )}
                    </button>
                  ))}
                </div>

              </>}

              {/* ── EXPORT PANEL ── */}
              {panel === "export" && <>
                <PLabel>Text</PLabel>
                <textarea
                  value={text} onChange={e => {
                    setText(e.target.value)
                    if (editableRef.current) {
                      editableRef.current.innerText = e.target.value
                      const el    = editableRef.current
                      const range = document.createRange()
                      const sel   = window.getSelection()
                      range.selectNodeContents(el)
                      range.collapse(false)
                      sel.removeAllRanges()
                      sel.addRange(range)
                    }
                  }}
                  rows={7} placeholder="Type here…"
                  style={{
                    width: "100%", border: `1.5px solid ${T.border}`, borderRadius: 8,
                    padding: "10px 12px", fontSize: 12, fontFamily: "inherit",
                    color: T.ink, background: T.paper, resize: "vertical",
                    outline: "none", lineHeight: 1.6, marginBottom: 16,
                    boxSizing: "border-box", transition: "border-color 0.15s",
                  }}
                  onFocus={e => e.target.style.borderColor = T.borderMd}
                  onBlur={e  => e.target.style.borderColor = T.border}
                />

              </>}

              {/* ── GLYPHS PANEL ── */}
              {panel === "glyphs" && <>
                <PLabel>Find Character Versions</PLabel>
                <div style={{ marginBottom: 16 }}>
                  <input
                    value={findChar}
                    onChange={e => setFindChar(e.target.value.slice(-1))}
                    placeholder="Type a character…"
                    maxLength={2}
                    style={{
                      width: "100%", boxSizing: "border-box",
                      border: `1.5px solid ${findChar && glyphMap.has(findChar) ? T.ink : T.border}`,
                      borderRadius: 9, padding: "10px 12px",
                      fontSize: 24, textAlign: "center",
                      fontFamily: "Georgia, serif", color: T.ink,
                      background: T.paper, outline: "none",
                      transition: "border-color 0.15s",
                    }}
                  />
                  {findChar && !glyphMap.has(findChar) && (
                    <p style={{ fontSize: 10, color: T.inkMd, marginTop: 6, textAlign: "center" }}>
                      No glyph found for "{findChar}"
                    </p>
                  )}
                </div>

                {findChar && glyphMap.has(findChar) && (() => {
                  const variants = glyphMap.get(findChar) ?? []
                  const cp = findChar.codePointAt(0)
                  return (
                    <div>
                      <div style={{
                        background: T.surface, borderRadius: 8,
                        padding: "9px 12px", border: `1px solid ${T.border}`, marginBottom: 14,
                      }}>
                        <p style={{ fontSize: 10, color: T.inkMd, fontFamily: "monospace" }}>
                          U+{cp.toString(16).toUpperCase().padStart(4,"0")}
                          <span style={{ marginLeft: 8, color: T.inkLt }}>
                            {cp >= 0x0E00 && cp <= 0x0E7F ? "Thai" : cp < 0x7F ? "Latin/ASCII" : "Unicode"}
                          </span>
                        </p>
                        <p style={{ fontSize: 10, color: T.inkLt, marginTop: 2 }}>
                          {variants.length} variant{variants.length !== 1 ? "s" : ""} available
                        </p>
                      </div>

                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {variants.map((g, i) => {
                          const ver   = g.version ?? (i + 1)
                          const label = ver === 1 ? "Original" : ver === 2 ? "Drooping tail" : "Wavy stroke"
                          const hasSvg = g.svgPath && g.svgPath.trim() && g.svgPath.trim() !== "M 0 0"
                          const conf   = g.confidence?.overall ?? g.confidence ?? null
                          const vColors = [T.sage, T.amber, T.rose]
                          const vColor  = vColors[(ver-1) % 3]
                          return (
                            <div key={g.id ?? i} style={{
                              background: T.paper, borderRadius: 10,
                              border: `1.5px solid ${T.border}`,
                              padding: "10px 12px",
                              display: "flex", alignItems: "center", gap: 12,
                            }}>
                              <div style={{
                                width: 52, height: 52, flexShrink: 0,
                                background: T.surface, borderRadius: 8,
                                display: "flex", alignItems: "center", justifyContent: "center",
                                border: `1px solid ${T.border}`,
                              }}>
                                {g.preview ? (
                                  <img src={g.preview} alt={findChar} style={{ width: "82%", height: "82%", objectFit: "contain" }} />
                                ) : hasSvg ? (
                                  <svg viewBox={g.viewBox ?? "0 0 100 100"} style={{ width: "82%", height: "82%" }}>
                                    <path d={g.svgPath} fill="none" stroke={T.ink} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
                                  </svg>
                                ) : (
                                  <span style={{ fontSize: 22, fontFamily: "Georgia, serif", color: T.inkMd }}>{findChar}</span>
                                )}
                              </div>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                                  <span style={{
                                    fontSize: 9, fontWeight: 700, padding: "2px 7px",
                                    borderRadius: 4,
                                    background: vColor + "18",
                                    color: vColor,
                                    border: `1px solid ${vColor}33`,
                                    fontFamily: "monospace", letterSpacing: "0.04em",
                                  }}>V{ver}</span>
                                  <span style={{ fontSize: 10, color: T.ink, fontWeight: 500 }}>{label}</span>
                                </div>
                                <p style={{ fontSize: 9, color: T.inkLt, fontFamily: "monospace" }}>
                                  id: {String(g.id ?? "—").slice(0,18)}
                                </p>
                                {conf !== null && (
                                  <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 5 }}>
                                    <div style={{ flex: 1, height: 3, background: T.border, borderRadius: 2 }}>
                                      <div style={{
                                        width: `${Math.round(conf * 100)}%`, height: "100%",
                                        background: conf > 0.75 ? T.sage : conf > 0.5 ? T.amber : T.rose,
                                        borderRadius: 2, transition: "width 0.3s",
                                      }} />
                                    </div>
                                    <span style={{ fontSize: 9, color: T.inkMd, fontFamily: "monospace", flexShrink: 0 }}>
                                      {Math.round(conf * 100)}%
                                    </span>
                                  </div>
                                )}
                              </div>
                            </div>
                          )
                        })}
                      </div>

                      <div style={{ marginTop: 14 }}>
                        <PLabel>Other Characters</PLabel>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                          {[...glyphMap.keys()].map(ch => (
                            <button key={ch} onClick={() => setFindChar(ch)} style={{
                              width: 28, height: 28,
                              border: `1.5px solid ${ch === findChar ? T.ink : T.border}`,
                              borderRadius: 5,
                              background: ch === findChar ? T.surfaceAlt : T.paper,
                              cursor: "pointer", fontSize: 13,
                              fontFamily: "Georgia, serif", color: T.ink,
                              display: "flex", alignItems: "center", justifyContent: "center",
                              transition: "all 0.1s",
                            }}>{ch}</button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )
                })()}

                {!findChar && glyphMap.size > 0 && (
                  <div style={{ marginTop: 8 }}>
                    <PLabel>All Characters</PLabel>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                      {[...glyphMap.keys()].map(ch => (
                        <button key={ch} onClick={() => setFindChar(ch)} style={{
                          width: 28, height: 28,
                          border: `1px solid ${T.border}`,
                          borderRadius: 5, background: T.paper,
                          cursor: "pointer", fontSize: 13,
                          fontFamily: "Georgia, serif", color: T.ink,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          transition: "border-color 0.1s",
                        }}
                          onMouseEnter={e => e.currentTarget.style.borderColor = T.borderMd}
                          onMouseLeave={e => e.currentTarget.style.borderColor = T.border}
                        >{ch}</button>
                      ))}
                    </div>
                  </div>
                )}
              </>}
            </div>
          </aside>
        )}
      </div>

    </div>
  )
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function TBtn({ children, onClick, active, title, disabled }) {
  return (
    <button onClick={onClick} title={title} disabled={disabled} style={{
      width: 28, height: 28,
      border: `1.5px solid ${active ? T.borderMd : "transparent"}`,
      borderRadius: 6,
      background: active ? T.surface : "transparent",
      color: disabled ? T.inkXl : active ? T.ink : T.inkMd,
      fontSize: 13, cursor: disabled ? "default" : "pointer",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "inherit", transition: "all .12s", flexShrink: 0,
    }}
      onMouseEnter={e => { if (!disabled && !active) { e.currentTarget.style.background = T.surface; e.currentTarget.style.color = T.ink } }}
      onMouseLeave={e => { if (!active) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = T.inkMd } }}
    >{children}</button>
  )
}

function ModeToggle({ value, onChange, options }) {
  return (
    <div style={{
      display: "flex",
      background: T.surface,
      border: `1px solid ${T.border}`,
      borderRadius: 7, padding: 2, gap: 2,
    }}>
      {options.map(o => (
        <button key={o.id} onClick={() => onChange(o.id)} style={{
          padding: "3px 10px", border: "none", borderRadius: 5,
          background: value === o.id ? T.paper : "transparent",
          color: value === o.id ? T.ink : T.inkMd,
          fontSize: 10, cursor: "pointer", fontFamily: "inherit",
          fontWeight: value === o.id ? 700 : 400,
          letterSpacing: "0.05em",
          boxShadow: value === o.id ? `0 1px 3px rgba(44,36,32,.08)` : "none",
          transition: "all .15s",
        }}>{o.label}</button>
      ))}
    </div>
  )
}

function Vr() {
  return <div style={{ width: 1, height: 18, background: T.border, margin: "0 3px", flexShrink: 0 }} />
}

function Hr() {
  return <div style={{ height: 1, background: T.border, margin: "16px 0" }} />
}

function PLabel({ children }) {
  return <p style={{
    fontSize: 9, fontWeight: 700, color: T.inkLt,
    letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8,
  }}>{children}</p>
}

function Dim({ children }) {
  return <span style={{ fontWeight: 400, color: T.inkLt, marginLeft: 4 }}>{children}</span>
}

function StatBox({ label, value, color }) {
  return (
    <div style={{ padding: "12px 6px", textAlign: "center", borderRight: `1px solid ${T.border}` }}>
      <p style={{ fontSize: 19, fontWeight: 700, color, lineHeight: 1 }}>{value}</p>
      <p style={{ fontSize: 8, color: T.inkLt, marginTop: 5, letterSpacing: "0.08em", textTransform: "uppercase" }}>{label}</p>
    </div>
  )
}

function PresetPill({ children, onClick }) {
  return (
    <button onClick={onClick} style={{
      padding: "4px 12px",
      border: `1.5px solid ${T.border}`,
      borderRadius: 99,
      background: T.paper,
      fontSize: 10, color: T.inkMd,
      cursor: "pointer", fontFamily: "inherit",
      transition: "all .12s",
    }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = T.ink; e.currentTarget.style.color = T.ink }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = T.border; e.currentTarget.style.color = T.inkMd }}
    >{children}</button>
  )
}

function Toggle({ value, onChange }) {
  return (
    <div onClick={() => onChange(!value)} style={{
      width: 36, height: 20, borderRadius: 99,
      background: value ? T.ink : T.border,
      position: "relative", cursor: "pointer",
      transition: "background .2s", flexShrink: 0,
    }}>
      <div style={{
        position: "absolute", top: 2, left: value ? 16 : 2,
        width: 16, height: 16, borderRadius: "50%",
        background: "white",
        boxShadow: "0 1px 4px rgba(44,36,32,.2)",
        transition: "left .2s",
      }} />
    </div>
  )
}

function ExportRow({ icon, label, sub, color, onClick, disabled, loading }) {
  return (
    <button onClick={!disabled ? onClick : undefined} disabled={disabled} style={{
      display: "flex", alignItems: "center", gap: 10,
      padding: "10px 13px",
      border: `1.5px solid ${T.border}`,
      borderRadius: 9, background: disabled ? T.surface : T.paper,
      cursor: disabled ? "not-allowed" : "pointer",
      fontFamily: "inherit", textAlign: "left",
      opacity: disabled ? 0.45 : 1, transition: "all .12s",
    }}
      onMouseEnter={e => { if (!disabled) e.currentTarget.style.borderColor = T.borderMd }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = T.border }}
    >
      <span style={{ fontSize: 15, flexShrink: 0, color: T.ink }}>
        {loading ? <Spin /> : icon}
      </span>
      <div>
        <p style={{ fontSize: 11, fontWeight: 600, color: disabled ? T.inkLt : T.ink }}>{label}</p>
        <p style={{ fontSize: 9, color, marginTop: 1, letterSpacing: "0.02em" }}>{sub}</p>
      </div>
    </button>
  )
}

function Spin() {
  return (
    <span style={{
      display: "inline-block", width: 12, height: 12,
      border: `2px solid ${T.border}`,
      borderTopColor: T.ink,
      borderRadius: "50%", animation: "spin .7s linear infinite",
      verticalAlign: "middle",
    }} />
  )
}

const sliderStyle = {
  width: "100%", accentColor: T.amber,
  marginBottom: 16, display: "block", cursor: "pointer",
}