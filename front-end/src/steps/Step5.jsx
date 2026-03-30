import { useMemo, useState, useCallback } from "react"

// ─── Constants ────────────────────────────────────────────────────────────────
const SEED = "0x3b9e12f4"

// ─── Hash / RNG ───────────────────────────────────────────────────────────────
function hashString(input) {
  let hash = 2166136261
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24)
  }
  return hash >>> 0
}

function createRng(seedStr) {
  let t = (hashString(seedStr) || 1) >>> 0
  return () => {
    t = (t + 0x6d2b79f5) >>> 0
    let x = Math.imul(t ^ (t >>> 15), 1 | t)
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x)
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
}

// ─── Math helpers ─────────────────────────────────────────────────────────────
function lerp(min, max, t) { return min + (max - min) * t }
function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)) }

// ─── Variant builder ──────────────────────────────────────────────────────────
// Strategy: one "word seed" drives the whole word's slant/pressure; per-char
// adds only tiny micro-jitter so consecutive chars stay visually grouped and
// the inline flow width is STABLE (no layout-breaking shiftX/shiftY).
//
// KEY layout rule: shiftX / shiftY are purely visual (applied with
// position:relative so they do NOT affect the inline box size).
// kerning is a small, consistent letter-spacing — never negative enough to
// cause overlap or positive enough to break words apart.

function buildWordStyle(wordRng, weight = "normal") {
  // Word-level transform only — all chars in the word inherit these values.
  // Ranges are intentionally tiny so the result reads as a paragraph, not art.
  return {
    rotate:  lerp(-1.0, 1.0, wordRng()),   // ±1 deg max
    skewX:   lerp(-1.0, 1.0, wordRng()),   // ±1 deg max
    scaleY:  lerp(0.98, 1.02, wordRng()),  // ±2 % height only
    shiftY:  lerp(-1.0, 1.0, wordRng()),   // ±1 px vertical drift
    opacity: weight === "bold"  ? lerp(0.92, 1.00, wordRng())
           : weight === "light" ? lerp(0.60, 0.76, wordRng())
           :                     lerp(0.88, 1.00, wordRng()),
  }
}

function buildCharVariant(_charRng, wordStyle, weight = "normal") {
  // Characters share the word transform exactly — no per-char randomness.
  // This is the single most important change for Word-like consistency.
  const widthScale = weight === "bold"  ? 0.60
                   : weight === "light" ? 0.52
                   : 0.56   // tighter than before → less inter-char gap

  return {
    rotate:     wordStyle.rotate,
    skewX:      wordStyle.skewX,
    scaleX:     1.0,           // never stretch chars horizontally
    scaleY:     wordStyle.scaleY,
    shiftY:     wordStyle.shiftY,
    widthScale,
    kerning:    0,             // zero random kerning — spacing comes from widthScale only
    opacity:    wordStyle.opacity,
  }
}

// ─── HTML escape ──────────────────────────────────────────────────────────────
function escapeHtml(s) {
  return s.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
           .replaceAll('"',"&quot;").replaceAll("'","&#039;")
}

// ─── PNG normalizer ───────────────────────────────────────────────────────────
function normalizePngDataUrl(dataUrl) {
  if (!dataUrl?.startsWith("data:image/png")) return ""
  const parts = String(dataUrl).split(",")
  if (parts.length < 2) return ""
  try { return `data:image/png;base64,${btoa(atob(parts[1]))}` } catch { return "" }
}

// ─── Styles / tokens ──────────────────────────────────────────────────────────
const C = {
  bg:       "#F7F5F0",
  bgCard:   "#FFFFFF",
  border:   "#E2DBCB",
  ink:      "#2C2416",
  inkMd:    "#6B5E48",
  inkLt:    "#9C8E78",
  accent:   "#3D6B9E",
  accentHover: "#2F5382",
  btnBg:    "#F0EBE1",
  btnBorder:"#D9D0BE",
  toolbar:  "#FAFAF8",
  toolbarBorder: "#E5E0D5",
  page:     "#FFFFFF",
  rule:     "#E4DCC8",
}

const LINE_PRESETS = [
  { label: "1.0", value: 1.0 },
  { label: "1.5", value: 1.5 },
  { label: "2.0", value: 2.0 },
]

const ALIGN_OPTS = [
  { id: "left",    icon: "≡", title: "Align Left" },
  { id: "center",  icon: "≡", title: "Center" },
  { id: "right",   icon: "≡", title: "Align Right" },
  { id: "justify", icon: "≡", title: "Justify" },
]

const WEIGHT_OPTS = ["light", "normal", "bold"]
const FONT_SIZES  = [24, 28, 32, 36, 42, 48, 56, 64]

// ─── Sub-components ──────────────────────────────────────────────────────────

function ToolBtn({ onClick, active, title, children, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        minWidth: 30, height: 28, padding: "0 7px",
        border: `1px solid ${active ? C.accent : "transparent"}`,
        borderRadius: 6,
        background: active ? "#EBF1F9" : "transparent",
        color: active ? C.accent : C.inkMd,
        cursor: disabled ? "not-allowed" : "pointer",
        fontSize: 12, fontWeight: 500,
        opacity: disabled ? 0.4 : 1,
        transition: "all 0.12s",
      }}
      onMouseEnter={e => !active && !disabled && (e.currentTarget.style.background = C.btnBg)}
      onMouseLeave={e => !active && !disabled && (e.currentTarget.style.background = "transparent")}
    >
      {children}
    </button>
  )
}

function Divider() {
  return <div style={{ width: 1, height: 20, background: C.toolbarBorder, margin: "0 4px" }} />
}

function ColorDot({ color, active, onClick, title }) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        width: 20, height: 20, borderRadius: "50%",
        background: color,
        border: active ? `2px solid ${C.accent}` : `1px solid ${C.btnBorder}`,
        cursor: "pointer", flexShrink: 0, transition: "transform 0.1s",
        transform: active ? "scale(1.2)" : "scale(1)",
      }}
    />
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function Step5({ selected = [], templateChars = [], extractedGlyphs = [] }) {
  // Text content
  const [text, setText] = useState("สวัสดีครับ นี่คือเอกสาร Word จากลายมือเรา 123")
  const [dnaNonce, setDnaNonce] = useState(0)

  // Typography controls
  const [fontSize,     setFontSize]     = useState(38)
  const [lineHeight,   setLineHeight]   = useState(1.5)
  const [alignment,    setAlignment]    = useState("left")
  const [fontWeight,   setFontWeight]   = useState("normal")
  const [paraSpacing,  setParaSpacing]  = useState(8)  // px before/after paragraph

  // Color
  const [textColor,    setTextColor]    = useState("#2C2416")
  const [hlColor,      setHlColor]      = useState("")  // highlight (empty = none)
  const TEXT_COLORS = ["#2C2416","#1A3A5C","#2E6B3E","#8B3A2A","#5C3D7A","#888888"]
  const HL_COLORS   = ["","#FFF9C4","#C8F7C5","#D4E6FF","#FFE0CC","#F5D0F5"]

  // Page layout
  const [marginPx,  setMarginPx]  = useState(40)  // left/right
  const [pageWidth, setPageWidth] = useState(680)  // inner page width

  // Glyphs
  const sourceChars = useMemo(
    () => (templateChars.length > 0 ? templateChars : [...selected]),
    [selected, templateChars]
  )
  const hasFileGlyphs = extractedGlyphs.length > 0

  const glyphMap = useMemo(() => {
    const m = new Map()
    for (const g of extractedGlyphs) {
      const key = String(g.ch || "")
      if (!key) continue
      if (!m.has(key)) m.set(key, [])
      m.get(key).push(g)
    }
    return m
  }, [extractedGlyphs])

  // ── Token builder ─────────────────────────────────────────────────────────
  // Produces WORD tokens so the browser wraps whole words like a word
  // processor. Word-level RNG seeds ensure consistent style per word.
  const tokens = useMemo(() => {
    const list = []
    const segments = (text || "").split(/( |\n)/)
    let globalIdx = 0

    for (const seg of segments) {
      if (seg === "\n") {
        list.push({ type: "newline", id: `n-${globalIdx++}` }); continue
      }
      if (seg === " " || seg === "") {
        if (seg === " ") list.push({ type: "space", id: `s-${globalIdx++}` })
        continue
      }

      const wordSeed  = `${SEED}-${dnaNonce}-w${globalIdx}-${seg}`
      const wordRng   = createRng(wordSeed)
      const wordStyle = buildWordStyle(wordRng, fontWeight)
      const chars     = Array.from(seg)
      const charTokens = []

      for (let ci = 0; ci < chars.length; ci++) {
        const ch         = chars[ci]
        const charRng    = createRng(`${wordSeed}-c${ci}`)
        const variant    = buildCharVariant(charRng, wordStyle, fontWeight)

        // Pick a random glyph image for this character (PNG from Step 3)
        const candidates = glyphMap.get(ch) || []
        const pickRng    = createRng(`${wordSeed}-c${ci}-pick`)
        const pickIdx    = candidates.length > 0 ? Math.floor(pickRng() * candidates.length) : -1
        const glyph      = pickIdx >= 0 ? candidates[pickIdx] : null
        const preview    = glyph ? normalizePngDataUrl(glyph.previewInk || glyph.preview || "") : ""

        charTokens.push({ type: "char", id: `c-${globalIdx}-${ci}`, ch, variant, preview })
      }

      list.push({ type: "word", id: `word-${globalIdx}`, chars: charTokens })
      globalIdx += seg.length
    }
    return list
  }, [text, glyphMap, dnaNonce, fontWeight])

  // ── Export ────────────────────────────────────────────────────────────────
  const exportWord = useCallback(() => {
    const pieces = []

    for (const token of tokens) {
      if (token.type === "newline") { pieces.push("<br />"); continue }
      if (token.type === "space") {
        const spW = Math.round(fontSize * 0.32)
        const spH = Math.round(fontSize * 1.3)
        pieces.push(`<span style="display:inline-block;width:${spW}px;height:${spH}px;vertical-align:bottom;"></span>`)
        continue
      }
      if (token.type !== "word") continue

      const t       = token.chars[0]?.variant
      if (!t) continue
      const rotate  = t.rotate.toFixed(2)
      const skewX   = t.skewX.toFixed(2)
      const topPx   = t.shiftY.toFixed(2)
      const slotW   = Math.round(fontSize * 0.72)
      const slotH   = Math.round(fontSize * 1.3)

      const charPieces = token.chars.map(ct => {
        const hl = hlColor ? `background:${hlColor};` : ""
        const inner = ct.preview
          ? `<img src="${ct.preview}" alt="${escapeHtml(ct.ch)}" style="width:100%;height:100%;object-fit:contain;display:block;" />`
          : escapeHtml(ct.ch)
        return (
          `<span style="display:inline-block;width:${slotW}px;height:${slotH}px;` +
          `vertical-align:bottom;flex-shrink:0;${hl}">` +
          `<span style="display:inline-flex;align-items:flex-end;justify-content:center;` +
          `width:100%;height:100%;opacity:${t.opacity.toFixed(2)};color:${textColor};">` +
          `${inner}</span></span>`
        )
      })

      pieces.push(
        `<span style="display:inline-flex;align-items:flex-end;white-space:nowrap;` +
        `vertical-align:bottom;position:relative;top:${topPx}px;` +
        `transform:rotate(${rotate}deg) skewX(${skewX}deg);transform-origin:left bottom;">` +
        charPieces.join("") + `</span>`
      )
    }

    const docHtml = `<!doctype html>
<html><head><meta charset="utf-8"/><title>Handwriting Export</title>
<style>
@page{size:A4;margin:${marginPx}px}
body{font-family:"TH Sarabun New","Noto Sans Thai",Tahoma,sans-serif;background:#fff;color:${textColor};margin:0;padding:${marginPx}px}
.paper{min-height:960px;padding:${marginPx}px;line-height:${lineHeight};font-size:${fontSize}px;text-align:${alignment};word-break:keep-all;white-space:normal}
</style></head>
<body><div class="paper">${pieces.join("")}</div></body></html>`

    const blob = new Blob(["\ufeff", docHtml], { type: "application/msword;charset=utf-8" })
    const url  = URL.createObjectURL(blob)
    const a    = Object.assign(document.createElement("a"), {
      href: url,
      download: `handwriting-${new Date().toISOString().slice(0,19).replace(/:/g,"-")}.doc`
    })
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 4000)
  }, [tokens, fontSize, lineHeight, alignment, textColor, hlColor, marginPx, paraSpacing])

  // ── Render helpers ────────────────────────────────────────────────────────
  const linePx = fontSize * lineHeight

  // renderChar: each character is its own inline-block slot.
  // - Outer span: fixed width + height — defines the layout box; never changes
  // - Inner span: carries all CSS transforms — invisible to layout engine
  // - <img>: the actual PNG glyph from Step 3; falls back to text if none
  // Word-level transform (rotate/skewX/shiftY) is applied on the WORD wrapper,
  // so every char in the word tilts together as one unit — like real handwriting.
  const renderChar = (ct) => {
    const t   = ct.variant
    const slotW = Math.round(fontSize * 0.72)  // consistent slot width per char
    const slotH = Math.round(fontSize * 1.3)   // consistent slot height

    const outerStyle = {
      display:        "inline-block",
      width:          slotW,
      height:         slotH,
      verticalAlign:  "bottom",        // all chars share the same bottom anchor
      flexShrink:     0,
      margin:         0,
      padding:        0,
      overflow:       "visible",
      background:     hlColor || "transparent",
    }
    // Inner span: visual-only transforms — no layout impact
    const innerStyle = {
      display:         "inline-flex",
      alignItems:      "flex-end",
      justifyContent:  "center",
      width:           "100%",
      height:          "100%",
      opacity:         t.opacity,
      color:           textColor,
    }
    const imgStyle = {
      width:           "100%",
      height:          "100%",
      objectFit:       "contain",
      imageRendering:  "auto",
      display:         "block",
    }

    return (
      <span key={ct.id} style={outerStyle}>
        <span style={innerStyle}>
          {ct.preview
            ? <img src={ct.preview} alt={ct.ch} style={imgStyle} />
            : ct.ch   // plain text fallback when no glyph image exists
          }
        </span>
      </span>
    )
  }

  const renderToken = (token) => {
    if (token.type === "newline") return <br key={token.id} />

    if (token.type === "space") {
      // Space width = one character slot — consistent with glyph slots above
      return (
        <span key={token.id} style={{
          display:       "inline-block",
          width:         Math.round(fontSize * 0.32),
          height:        Math.round(fontSize * 1.3),
          verticalAlign: "bottom",
          flexShrink:    0,
        }} />
      )
    }

    if (token.type === "word") {
      const t = token.chars[0]?.variant
      if (!t) return null

      // Word-level transform: the whole word tilts/shifts together.
      // Using inline-flex + whiteSpace:nowrap ensures the browser wraps
      // BETWEEN words only — never splits a word across lines.
      return (
        <span
          key={token.id}
          style={{
            display:         "inline-flex",
            alignItems:      "flex-end",
            whiteSpace:      "nowrap",
            verticalAlign:   "bottom",
            transform:       `rotate(${t.rotate.toFixed(2)}deg) skewX(${t.skewX.toFixed(2)}deg)`,
            transformOrigin: "left bottom",
            position:        "relative",
            top:             `${t.shiftY.toFixed(2)}px`,
          }}
        >
          {token.chars.map(ct => renderChar(ct))}
        </span>
      )
    }
    return null
  }

  // ── UI ────────────────────────────────────────────────────────────────────
  return (
    <div style={{ fontFamily: "'DM Sans', system-ui, sans-serif", color: C.ink }}>

      {/* Warning banner */}
      {!hasFileGlyphs && (
        <div style={{
          background: "#FFFBEB", border: "1px solid #F59E0B", borderRadius: 10,
          padding: "10px 14px", marginBottom: 12, fontSize: 13, color: "#92400E",
        }}>
          ⚠️ ยังไม่พบ glyph จาก Step 3 — ระบบจะแสดงเป็นข้อความธรรมดาก่อน
        </div>
      )}

      {/* ── Toolbar ── */}
      <div style={{
        background: C.toolbar,
        border: `1px solid ${C.toolbarBorder}`,
        borderRadius: "12px 12px 0 0",
        padding: "6px 12px",
        display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center",
      }}>
        {/* Font size selector */}
        <select
          value={fontSize}
          onChange={e => setFontSize(Number(e.target.value))}
          style={{
            height: 28, padding: "0 6px", fontSize: 12, borderRadius: 6,
            border: `1px solid ${C.btnBorder}`, background: C.bgCard,
            color: C.ink, cursor: "pointer",
          }}
        >
          {FONT_SIZES.map(s => <option key={s} value={s}>{s}px</option>)}
        </select>

        <Divider />

        {/* Weight */}
        {WEIGHT_OPTS.map(w => (
          <ToolBtn key={w} active={fontWeight === w} onClick={() => setFontWeight(w)} title={`Weight: ${w}`}>
            <span style={{ fontWeight: w === "bold" ? 700 : w === "light" ? 300 : 500, fontSize: 11 }}>
              {w === "bold" ? "B" : w === "light" ? "L" : "N"}
            </span>
          </ToolBtn>
        ))}

        <Divider />

        {/* Line height presets */}
        {LINE_PRESETS.map(p => (
          <ToolBtn key={p.value} active={lineHeight === p.value} onClick={() => setLineHeight(p.value)} title={`Line height ${p.label}`}>
            {p.label}×
          </ToolBtn>
        ))}

        <Divider />

        {/* Alignment */}
        {ALIGN_OPTS.map(a => (
          <ToolBtn key={a.id} active={alignment === a.id} onClick={() => setAlignment(a.id)} title={a.title}>
            {a.id === "left"    ? "⇤" :
             a.id === "center"  ? "↔" :
             a.id === "right"   ? "⇥" : "⇔"}
          </ToolBtn>
        ))}

        <Divider />

        {/* Text colors */}
        <span style={{ fontSize: 11, color: C.inkLt, marginRight: 3 }}>A</span>
        {TEXT_COLORS.map(c => (
          <ColorDot key={c} color={c} active={textColor === c} onClick={() => setTextColor(c)} title={`Text: ${c}`} />
        ))}

        <Divider />

        {/* Highlight */}
        <span style={{ fontSize: 11, color: C.inkLt, marginRight: 3 }}>HL</span>
        {HL_COLORS.map((c, i) => (
          <ColorDot
            key={i}
            color={c || "#F7F5F0"}
            active={hlColor === c}
            onClick={() => setHlColor(c)}
            title={c ? `Highlight ${c}` : "No highlight"}
          />
        ))}

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* DNA + Export */}
        <button
          onClick={() => setDnaNonce(n => n + 1)}
          style={{
            height: 28, padding: "0 12px", borderRadius: 6, fontSize: 12,
            border: `1px solid ${C.btnBorder}`, background: C.btnBg,
            color: C.inkMd, cursor: "pointer", fontWeight: 500,
          }}
        >
          🎲 สุ่ม DNA
        </button>
        <button
          onClick={exportWord}
          disabled={!text.trim()}
          style={{
            height: 28, padding: "0 14px", borderRadius: 6, fontSize: 12,
            border: "none", background: C.accent,
            color: "#fff", cursor: text.trim() ? "pointer" : "not-allowed",
            fontWeight: 600, opacity: text.trim() ? 1 : 0.5,
          }}
        >
          ⬇ Export .doc
        </button>
      </div>

      {/* ── Second toolbar row: margins / para spacing ── */}
      <div style={{
        background: C.toolbar,
        borderLeft: `1px solid ${C.toolbarBorder}`,
        borderRight: `1px solid ${C.toolbarBorder}`,
        borderBottom: `1px solid ${C.toolbarBorder}`,
        padding: "5px 12px",
        display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap",
        fontSize: 11, color: C.inkLt,
      }}>
        <label style={{ display:"flex", alignItems:"center", gap:5 }}>
          Margin
          <input type="range" min={16} max={80} value={marginPx} onChange={e => setMarginPx(+e.target.value)}
            style={{ width: 80, accentColor: C.accent }} />
          <span style={{ color: C.ink, minWidth: 28 }}>{marginPx}px</span>
        </label>
        <label style={{ display:"flex", alignItems:"center", gap:5 }}>
          Para gap
          <input type="range" min={0} max={24} value={paraSpacing} onChange={e => setParaSpacing(+e.target.value)}
            style={{ width: 70, accentColor: C.accent }} />
          <span style={{ color: C.ink, minWidth: 24 }}>{paraSpacing}px</span>
        </label>
        <span style={{ marginLeft: "auto", color: C.inkLt }}>
          Glyphs: <b style={{ color: C.ink }}>{extractedGlyphs.length}</b>
          {sourceChars.length > 0 ? ` • chars: ${sourceChars.length}` : ""}
          {" "}• seed {SEED} • nonce {dnaNonce}
        </span>
      </div>

      {/* ── Textarea ── */}
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        rows={3}
        placeholder="พิมพ์ข้อความที่ต้องการ…"
        style={{
          width: "100%", boxSizing: "border-box",
          border: `1px solid ${C.toolbarBorder}`,
          borderTop: "none",
          padding: "10px 14px", fontSize: 14,
          resize: "vertical", background: C.bgCard,
          color: C.ink, outline: "none",
          fontFamily: "'DM Sans', system-ui, sans-serif",
        }}
      />

      {/* ── Ruler ── */}
      <div style={{
        height: 18,
        background: "linear-gradient(to bottom, #F0EBE1, #E8E2D8)",
        border: `1px solid ${C.toolbarBorder}`,
        borderTop: "none",
        display: "flex", alignItems: "center",
        paddingLeft: marginPx, paddingRight: marginPx,
        position: "relative",
      }}>
        {Array.from({ length: 16 }, (_, i) => (
          <div key={i} style={{
            flex: 1, height: i % 4 === 0 ? 8 : 4,
            borderLeft: `1px solid ${i % 4 === 0 ? "#B8AFA0" : "#D4CCC0"}`,
            alignSelf: "flex-end",
          }} />
        ))}
        {/* Margin indicators */}
        <div style={{
          position: "absolute", left: marginPx - 1, top: 2, bottom: 2,
          width: 2, background: C.accent, opacity: 0.6, borderRadius: 1,
        }} />
        <div style={{
          position: "absolute", right: marginPx - 1, top: 2, bottom: 2,
          width: 2, background: C.accent, opacity: 0.6, borderRadius: 1,
        }} />
      </div>

      {/* ── Page preview ── */}
      <div style={{
        background: "#E8E3D8",
        padding: "20px 0 28px",
        border: `1px solid ${C.toolbarBorder}`,
        borderTop: "none",
        borderRadius: "0 0 12px 12px",
      }}>
        <div style={{
          maxWidth: pageWidth + marginPx * 2,
          margin: "0 auto",
          background: C.page,
          boxShadow: "0 2px 24px rgba(0,0,0,0.12), 0 1px 4px rgba(0,0,0,0.08)",
          borderRadius: 3,
          minHeight: 520,
          padding: `${marginPx}px ${marginPx}px`,
        }}>
          {/* Page content — clean white, Word-like paragraph rendering */}
          <div style={{
            fontSize,
            // lineHeight as a unitless multiplier gives each line-box correct
            // proportional height regardless of font size changes
            lineHeight,
            color: textColor,
            textAlign: alignment,
            minHeight: 420,
            paddingBottom: paraSpacing,
            // pre-wrap respects explicit \n; keep-all prevents mid-word breaks
            whiteSpace: "pre-wrap",
            wordBreak: "keep-all",
            // Let the browser's normal inline algorithm handle everything else
            overflowWrap: "normal",
            // No background lines — clean white page only
            background: "transparent",
          }}>
            {tokens.length === 0 ? (
              <span style={{ opacity: 0.35, color: C.inkLt }}>พิมพ์ข้อความเพื่อเริ่มพรีวิว…</span>
            ) : (
              tokens.map(renderToken)
            )}
          </div>
        </div>
      </div>
    </div>
  )
}