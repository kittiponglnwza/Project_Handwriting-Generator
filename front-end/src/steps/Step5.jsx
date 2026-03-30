import { useMemo, useState, useCallback } from "react"
import { DOCUMENT_SEED } from "../lib/documentSeed.js"

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

function lerp(min, max, t) {
  return min + (max - min) * t
}

function buildWordStyle(wordRng, weight = "normal") {
  return {
    rotate: lerp(-1.0, 1.0, wordRng()),
    skewX: lerp(-1.0, 1.0, wordRng()),
    scaleY: lerp(0.98, 1.02, wordRng()),
    shiftY: lerp(-1.0, 1.0, wordRng()),
    opacity:
      weight === "bold" ? lerp(0.92, 1.0, wordRng())
      : weight === "light" ? lerp(0.6, 0.76, wordRng())
      : lerp(0.88, 1.0, wordRng()),
  }
}

function buildCharVariant(charRng, wordStyle, weight = "normal") {
  const widthScale = weight === "bold" ? 0.6 : weight === "light" ? 0.52 : 0.56
  return {
    rotate: wordStyle.rotate,
    skewX: wordStyle.skewX,
    shiftYWord: wordStyle.shiftY,
    scaleX: 1.0,
    scaleY: wordStyle.scaleY,
    shiftX: lerp(-1.35, 1.35, charRng()),
    shiftYMicro: lerp(-1.1, 1.1, charRng()),
    microRotate: lerp(-0.55, 0.55, charRng()),
    opacity: wordStyle.opacity * lerp(0.93, 1, charRng()),
    strokeWMul: lerp(0.88, 1.06, charRng()),
    widthScale,
    kerning: 0,
  }
}

/** ความหนาเส้นปากกาเทียบ fontSize — พิมพ์/จอใช้สูตรเดียวกัน */
function penStrokeWidth(fontSize, mul = 1) {
  const fs = Number(fontSize) || 32
  return Math.max(1.2, Math.min(3.5, fs * 0.064 * mul))
}

function escapeHtml(s) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;")
}

function normalizePngDataUrl(dataUrl) {
  if (!dataUrl?.startsWith("data:image/png")) return ""
  const parts = String(dataUrl).split(",")
  if (parts.length < 2) return ""
  try {
    return `data:image/png;base64,${btoa(atob(parts[1]))}`
  } catch {
    return ""
  }
}

function GlyphSlot({
  glyph,
  ch,
  slotW,
  slotH,
  opacity,
  textColor,
  hlColor,
  viewBox,
  fontSize,
  strokeWMul = 1,
}) {
  const hasSvg =
    glyph &&
    typeof glyph.svgPath === "string" &&
    glyph.svgPath.trim() !== "" &&
    glyph.svgPath.trim() !== "M 0 0"

  const pngInk = glyph ? normalizePngDataUrl(glyph.previewInk || "") : ""
  const pngFallback = glyph ? normalizePngDataUrl(glyph.preview || "") : ""
  const pngSrc = pngInk || pngFallback
  const usePngFirst = pngSrc.length > 0

  const sw = penStrokeWidth(fontSize, strokeWMul)

  const outerStyle = {
    display: "inline-block",
    width: slotW,
    height: slotH,
    verticalAlign: "bottom",
    flexShrink: 0,
    margin: 0,
    marginRight: "-0.18em",
    padding: 0,
    overflow: "visible",
    background: hlColor || "transparent",
  }

  const innerStyle = {
    display: "inline-flex",
    alignItems: "flex-end",
    justifyContent: "flex-start",
    width: "100%",
    height: "100%",
    opacity,
    color: textColor,
  }

  return (
    <span style={outerStyle}>
      <span style={innerStyle}>
        {usePngFirst ? (
          <img
            src={pngSrc}
            alt={ch}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "contain",
              objectPosition: "left bottom",
              display: "block",
              imageRendering: "auto",
              mixBlendMode: "multiply",
            }}
          />
        ) : hasSvg ? (
          <svg
            viewBox={glyph.viewBox || viewBox || "0 0 100 100"}
            style={{
              width: "100%",
              height: "100%",
              overflow: "visible",
              display: "block",
              shapeRendering: "geometricPrecision",
            }}
            aria-label={ch}
          >
            <path
              d={glyph.svgPath}
              fill="none"
              stroke={textColor || "#2C2416"}
              strokeWidth={sw}
              strokeLinecap="round"
              strokeLinejoin="round"
              paintOrder="stroke fill"
            />
          </svg>
        ) : (
          <span
            style={{
              fontFamily: "'TH Sarabun New','Noto Sans Thai',Tahoma,sans-serif",
              fontSize: Math.round(fontSize * 0.92),
              fontWeight: 500,
              lineHeight: 1,
              color: textColor,
            }}
          >
            {ch}
          </span>
        )}
      </span>
    </span>
  )
}

// ─── Microsoft Word–inspired chrome (ribbon light + dark “paper well”) ───────
const W = {
  ribbonBg: "#f3f2f1",
  ribbonBorder: "#d2d0ce",
  tabBar: "#edebe9",
  tabActive: "#ffffff",
  tabInk: "#323130",
  tabInkMuted: "#605e5c",
  accent: "#0078d4",
  accentHover: "#106ebe",
  canvas: "#e7e6e6",
  pageWell: "#2d2c2c",
  page: "#ffffff",
  statusBg: "#f3f2f1",
  groupLabel: "#605e5c",
  inputCard: "#ffffff",
}

/** ช่องตัวอักษรเทียบ fontSize — ค่าเดิม 0.72/1.3 ทำให้ตัวห่างเกินจริง */
const GLYPH_SLOT_W_RATIO = 0.3
const GLYPH_SLOT_H_RATIO = 0.98
const GLYPH_SPACE_W_RATIO = 0.11

function glyphMetrics(fontSize) {
  const fs = Number(fontSize) || 32
  return {
    slotW: Math.max(12, Math.round(fs * GLYPH_SLOT_W_RATIO)),
    slotH: Math.max(20, Math.round(fs * GLYPH_SLOT_H_RATIO)),
    spaceW: Math.max(3, Math.round(fs * GLYPH_SPACE_W_RATIO)),
  }
}

const LINE_PRESETS = [
  { label: "1.0", value: 1.0 },
  { label: "1.08", value: 1.08 },
  { label: "1.2", value: 1.2 },
  { label: "1.5", value: 1.5 },
  { label: "2.0", value: 2.0 },
]

const ALIGN_OPTS = [
  { id: "left", icon: "⇤", title: "จัดซ้าย" },
  { id: "center", icon: "↔", title: "กึ่งกลาง" },
  { id: "right", icon: "⇥", title: "จัดขวา" },
  { id: "justify", icon: "⇔", title: "เต็มบรรทัด" },
]

const WEIGHT_OPTS = ["light", "normal", "bold"]
const FONT_SIZES = [24, 28, 32, 36, 42, 48, 56, 64]

function RibbonBtn({ onClick, active, title, children, disabled }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: 28,
        height: 26,
        padding: "0 6px",
        border: `1px solid ${active ? W.accent : "transparent"}`,
        borderRadius: 4,
        background: active ? "#deecf9" : "transparent",
        color: active ? W.accent : W.tabInk,
        cursor: disabled ? "not-allowed" : "pointer",
        fontSize: 12,
        opacity: disabled ? 0.45 : 1,
      }}
    >
      {children}
    </button>
  )
}

function RibbonGroup({ label, children }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 4,
        padding: "6px 10px 4px",
        borderLeft: `1px solid ${W.ribbonBorder}`,
        minHeight: 72,
      }}
    >
      <div style={{ display: "flex", flexWrap: "wrap", gap: 2, justifyContent: "center" }}>{children}</div>
      <span
        style={{
          fontSize: 10,
          color: W.groupLabel,
          userSelect: "none",
          marginTop: "auto",
          paddingTop: 2,
        }}
      >
        {label}
      </span>
    </div>
  )
}

function ColorDot({ color, active, onClick, title }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      style={{
        width: 18,
        height: 18,
        borderRadius: "50%",
        background: color,
        border: active ? `2px solid ${W.accent}` : `1px solid #c8c6c4`,
        cursor: "pointer",
        flexShrink: 0,
        transform: active ? "scale(1.1)" : "scale(1)",
      }}
    />
  )
}

export default function Step5({
  selected = [],
  templateChars = [],
  versionedGlyphs = [],
  extractedGlyphs = [],
  documentSeed = DOCUMENT_SEED,
}) {
  const [text, setText] = useState(
    "สวัสดีครับ นี่คือตัวอย่างเอกสารจากลายมือ Step 4 → Step 5"
  )
  const [dnaNonce, setDnaNonce] = useState(0)
  const [fontSize, setFontSize] = useState(38)
  const [lineHeight, setLineHeight] = useState(1.08)
  const [alignment, setAlignment] = useState("left")
  const [fontWeight, setFontWeight] = useState("normal")
  const [paraSpacing, setParaSpacing] = useState(4)
  const [textColor, setTextColor] = useState("#2C2416")
  const [hlColor, setHlColor] = useState("")
  const [marginPx, setMarginPx] = useState(48)
  const [showVersionDebug, setShowVersionDebug] = useState(false)

  // Zoom เฉพาะฝั่ง preview (ไม่กระทบ Export PDF)
  const [previewZoom, setPreviewZoom] = useState(1)
  // ใช้ transform scale กับฝั่ง preview เพื่อลด layout shift

  const TEXT_COLORS = ["#2C2416", "#1a3a5c", "#2e6b3e", "#8b3a2a", "#5c3d7a", "#605e5c"]
  const HL_COLORS = ["", "#fff9c4", "#c8f7c5", "#d4e6ff", "#ffe0cc", "#f5d0f5"]

  const sourceChars = useMemo(
    () => (templateChars.length > 0 ? templateChars : [...selected]),
    [selected, templateChars]
  )

  const activeGlyphs = versionedGlyphs.length > 0 ? versionedGlyphs : extractedGlyphs
  const hasFileGlyphs = activeGlyphs.length > 0
  const usingVersioned = versionedGlyphs.length > 0

  const glyphMap = useMemo(() => {
    const m = new Map()
    for (const g of activeGlyphs) {
      const key = String(g.ch || "")
      if (!key) continue
      if (!m.has(key)) m.set(key, [])
      m.get(key).push(g)
    }
    return m
  }, [activeGlyphs])

  const tokens = useMemo(() => {
    const list = []
    const segments = (text || "").split(/( |\n)/)
    let globalIdx = 0

    for (const seg of segments) {
      if (seg === "\n") {
        list.push({ type: "newline", id: `n-${globalIdx++}` })
        continue
      }
      if (seg === " " || seg === "") {
        if (seg === " ") list.push({ type: "space", id: `s-${globalIdx++}` })
        continue
      }

      const wordSeed = `${documentSeed}-${dnaNonce}-w${globalIdx}-${seg}`
      const wordRng = createRng(wordSeed)
      const wordStyle = buildWordStyle(wordRng, fontWeight)
      const chars = Array.from(seg)
      const charTokens = []

      for (let ci = 0; ci < chars.length; ci++) {
        const ch = chars[ci]
        const charRng = createRng(`${wordSeed}-c${ci}`)
        const variant = buildCharVariant(charRng, wordStyle, fontWeight)

        const candidates = glyphMap.get(ch) || []
        const pickRng = createRng(`${wordSeed}-c${ci}-pick`)
        const pickIdx = candidates.length > 0 ? Math.floor(pickRng() * candidates.length) : -1
        const glyph = pickIdx >= 0 ? candidates[pickIdx] : null

        charTokens.push({
          type: "char",
          id: `c-${globalIdx}-${ci}`,
          ch,
          variant,
          glyph,
          preview: glyph ? normalizePngDataUrl(glyph.previewInk || glyph.preview || "") : "",
          pickedVersion: glyph?.version ?? null,
        })
      }

      list.push({ type: "word", id: `word-${globalIdx}`, chars: charTokens })
      globalIdx += seg.length
    }
    return list
  }, [text, glyphMap, dnaNonce, fontWeight, documentSeed])

  /** Build HTML fragment (preview + print) — words wrap; long strings break inside page width */
  const buildDocumentHtmlFragment = useCallback(() => {
    const pieces = []
    const { slotW, slotH, spaceW } = glyphMetrics(fontSize)

    for (const token of tokens) {
      if (token.type === "newline") {
        pieces.push('<span class="hw-br"></span>')
        continue
      }
      if (token.type === "space") {
        pieces.push(
          `<span style="display:inline-block;width:${spaceW}px;height:${slotH}px;vertical-align:bottom;flex-shrink:0"></span>`
        )
        continue
      }
      if (token.type !== "word") continue

      const t0 = token.chars[0]?.variant
      if (!t0) continue
      const rotate = t0.rotate.toFixed(2)
      const skewX = t0.skewX.toFixed(2)
      const topPx = (t0.shiftYWord ?? t0.shiftY ?? 0).toFixed(2)

      const charPieces = token.chars.map(ct => {
        const v = ct.variant
        const hl = hlColor ? `background:${hlColor};` : ""
        const g = ct.glyph
        const hasSvg =
          g &&
          typeof g.svgPath === "string" &&
          g.svgPath.trim() !== "" &&
          g.svgPath.trim() !== "M 0 0"

        const pngInk = g ? normalizePngDataUrl(g.previewInk || "") : ""
        const pngFb = g ? normalizePngDataUrl(g.preview || "") : ""
        const pngUse = pngInk || pngFb
        const sw = penStrokeWidth(fontSize, v.strokeWMul ?? 1).toFixed(2)
        const op = (v.opacity ?? 1).toFixed(3)
        const tx = (v.shiftX ?? 0).toFixed(2)
        const ty = (v.shiftYMicro ?? 0).toFixed(2)
        const mr = (v.microRotate ?? 0).toFixed(2)

        let inner
        if (pngUse) {
          inner =
            `<img src="${pngUse}" alt="${escapeHtml(ct.ch)}" ` +
            `style="width:100%;height:100%;object-fit:contain;object-position:left bottom;display:block;mix-blend-mode:multiply" />`
        } else if (hasSvg) {
          const vb = g.viewBox || "0 0 100 100"
          inner =
            `<svg viewBox="${vb}" style="width:100%;height:100%;display:block;shape-rendering:geometricPrecision;overflow:visible" aria-label="${escapeHtml(ct.ch)}">` +
            `<path d="${escapeHtml(g.svgPath)}" fill="none" stroke="${textColor}" ` +
            `stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" paint-order="stroke fill"/></svg>`
        } else {
          inner = escapeHtml(ct.ch)
        }

        return (
          `<span style="display:inline-block;transform:translate(${tx}px,${ty}px) rotate(${mr}deg);` +
            `transform-origin:center bottom;vertical-align:bottom">` +
            `<span style="display:inline-block;width:${slotW}px;height:${slotH}px;` +
            `vertical-align:bottom;flex-shrink:0;margin-right:-0.18em;${hl}">` +
            `<span style="display:inline-flex;align-items:flex-end;justify-content:flex-start;` +
            `width:100%;height:100%;opacity:${op};color:${textColor};overflow:visible">` +
            `${inner}</span></span></span>`
        )
      })

      pieces.push(
        `<span class="hw-word" style="display:inline-flex;flex-wrap:wrap;align-items:flex-end;gap:0;row-gap:0;` +
          `column-gap:0;max-width:100%;vertical-align:bottom;position:relative;top:${topPx}px;overflow:visible;` +
          `transform:rotate(${rotate}deg) skewX(${skewX}deg);transform-origin:left bottom;box-sizing:border-box">` +
          charPieces.join("") +
          `</span>`
      )
    }
    return pieces.join("")
  }, [tokens, fontSize, textColor, hlColor])

  /**
   * พิมพ์เป็น PDF — เนื้อหาในหน้า = แค่ข้อความลายมือ (ไม่มีหัวข้อใน HTML)
   * หมายเหตุ: วันที่/ชื่อเรื่องมุมกระดาษมาจากเบราว์เซอร์ — ปิดที่กล่องพิมพ์: More settings → ปิด “Headers and footers”
   */
  const exportPdf = useCallback(() => {
    const inner = buildDocumentHtmlFragment()
    // title ว่าง (ZWSP) เพื่อไม่ให้โชว์ชื่อเรื่องยาวใน header ตอนพิมพ์
    const docHtml = `<!doctype html>
<html lang="th"><head><meta charset="utf-8"/><title>&#8203;</title>
<style>
@page { size: A4; margin: 14mm; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  font-family: "TH Sarabun New", "Noto Sans Thai", Tahoma, sans-serif;
  background: #fff;
  color: ${textColor};
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
  -webkit-font-smoothing: antialiased;
}
.paper img {
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
.paper svg { shape-rendering: geometricPrecision; }
.paper {
  width: 100%;
  max-width: 100%;
  padding: ${marginPx}px;
  line-height: ${lineHeight};
  font-size: ${fontSize}px;
  text-align: ${alignment};
  word-break: break-word;
  overflow-wrap: anywhere;
  overflow-x: hidden;
}
.hw-br { display: block; width: 100%; height: 0; margin: 0 0 ${paraSpacing}px 0; padding: 0; clear: both; }
@media print {
  body { background: #fff; }
  .paper { padding: ${marginPx}px; page-break-inside: auto; }
}
</style></head>
<body>
  <div class="paper">${inner}</div>
</body></html>`

    const iframe = document.createElement("iframe")
    iframe.setAttribute(
      "style",
      "position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none"
    )
    iframe.setAttribute("aria-hidden", "true")
    document.body.appendChild(iframe)

    const win = iframe.contentWindow
    const doc = iframe.contentDocument
    if (!win || !doc) {
      iframe.remove()
      window.alert("ไม่สามารถเตรียมหน้าพิมพ์ได้")
      return
    }

    doc.open()
    doc.write(docHtml)
    doc.close()
    try {
      doc.title = "\u200b"
    } catch {
      /* ignore */
    }

    const cleanup = () => {
      iframe.remove()
    }

    const runPrint = () => {
      try {
        win.focus()
        win.print()
      } finally {
        win.addEventListener("afterprint", cleanup, { once: true })
        window.setTimeout(cleanup, 120_000)
      }
    }

    window.setTimeout(runPrint, 200)
  }, [buildDocumentHtmlFragment, marginPx, lineHeight, fontSize, alignment, textColor, paraSpacing])

  const renderChar = ct => {
    const t = ct.variant
    const { slotW, slotH } = glyphMetrics(fontSize)
    const tx = t.shiftX ?? 0
    const ty = t.shiftYMicro ?? 0
    const mr = t.microRotate ?? 0

    return (
      <span
        key={ct.id}
        style={{
          position: "relative",
          display: "inline-block",
          transform: `translate(${tx}px, ${ty}px) rotate(${mr}deg)`,
          transformOrigin: "center bottom",
          verticalAlign: "bottom",
        }}
      >
        <GlyphSlot
          glyph={ct.glyph}
          ch={ct.ch}
          slotW={slotW}
          slotH={slotH}
          opacity={t.opacity}
          textColor={textColor}
          hlColor={hlColor}
          viewBox="0 0 100 100"
          fontSize={fontSize}
          strokeWMul={t.strokeWMul ?? 1}
        />
        {showVersionDebug && ct.pickedVersion != null && (
          <span
            style={{
              position: "absolute",
              top: 0,
              right: 0,
              fontSize: 7,
              lineHeight: 1,
              background: W.accent,
              color: "#fff",
              borderRadius: 2,
              padding: "1px 2px",
              pointerEvents: "none",
              zIndex: 10,
            }}
          >
            v{ct.pickedVersion}
          </span>
        )}
      </span>
    )
  }

  const renderToken = token => {
    if (token.type === "newline")
      return (
        <span
          key={token.id}
          style={{
            display: "block",
            width: "100%",
            height: 0,
            marginBottom: paraSpacing,
          }}
        />
      )

    if (token.type === "space") {
      const { spaceW, slotH } = glyphMetrics(fontSize)
      return (
        <span
          key={token.id}
          style={{
            display: "inline-block",
            width: spaceW,
            height: slotH,
            verticalAlign: "bottom",
            flexShrink: 0,
          }}
        />
      )
    }

    if (token.type === "word") {
      const t = token.chars[0]?.variant
      if (!t) return null
      return (
        <span
          key={token.id}
          style={{
            display: "inline-flex",
            flexWrap: "wrap",
            alignItems: "flex-end",
            gap: 0,
            rowGap: 0,
            columnGap: 0,
            maxWidth: "100%",
            verticalAlign: "bottom",
            boxSizing: "border-box",
            overflow: "visible",
            transform: `rotate(${t.rotate.toFixed(2)}deg) skewX(${t.skewX.toFixed(2)}deg)`,
            transformOrigin: "left bottom",
            position: "relative",
            top: `${(t.shiftYWord ?? t.shiftY ?? 0).toFixed(2)}px`,
          }}
        >
          {token.chars.map(ct => renderChar(ct))}
        </span>
      )
    }
    return null
  }

  return (
    <div
      style={{
        fontFamily: "'Segoe UI', 'DM Sans', system-ui, sans-serif",
        color: W.tabInk,
        minHeight: "100%",
        display: "flex",
        flexDirection: "column",
        background: W.canvas,
      }}
    >
      {/* ── Title strip (Word-style) ── */}
      <div
        style={{
          background: W.tabActive,
          borderBottom: `1px solid ${W.ribbonBorder}`,
          padding: "6px 12px 0",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 2 }}>
          <span style={{ fontSize: 12, color: W.tabInkMuted, padding: "4px 10px" }}>ไฟล์</span>
          <span
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: W.tabInk,
              padding: "6px 14px",
              borderBottom: `3px solid ${W.accent}`,
              marginBottom: -1,
            }}
          >
            หน้าแรก
          </span>
          <span style={{ fontSize: 12, color: W.tabInkMuted, padding: "4px 10px" }}>แทรก</span>
          <span style={{ fontSize: 12, color: W.tabInkMuted, padding: "4px 10px" }}>การออกแบบ</span>
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 11, color: W.tabInkMuted }}>
            {hasFileGlyphs
              ? `ลายมือ: ${versionedGlyphs.length} สล็อต (×3 เวอร์ชัน) • Step 3 → DNA`
              : "ยังไม่มี glyph — อัปโหลด PDF ใน Step 2"}
          </span>
        </div>

        {/* ── Ribbon toolbar ── */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "stretch",
            background: W.ribbonBg,
            border: `1px solid ${W.ribbonBorder}`,
            borderRadius: "4px 4px 0 0",
            marginTop: 4,
          }}
        >
          <RibbonGroup label="คลิปบอร์ด">
            <RibbonBtn title="สุ่มลายมือใหม่" onClick={() => setDnaNonce(n => n + 1)}>
              🎲 DNA
            </RibbonBtn>
          </RibbonGroup>

          <RibbonGroup label="แบบอักษร">
            <select
              value={fontSize}
              onChange={e => setFontSize(Number(e.target.value))}
              style={{
                height: 26,
                padding: "0 6px",
                fontSize: 12,
                borderRadius: 4,
                border: `1px solid ${W.ribbonBorder}`,
                background: "#fff",
                minWidth: 64,
              }}
            >
              {FONT_SIZES.map(s => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            {WEIGHT_OPTS.map(w => (
              <RibbonBtn key={w} active={fontWeight === w} onClick={() => setFontWeight(w)} title={w}>
                <span style={{ fontWeight: w === "bold" ? 700 : w === "light" ? 300 : 500, fontSize: 11 }}>
                  {w === "bold" ? "B" : w === "light" ? "L" : "Aa"}
                </span>
              </RibbonBtn>
            ))}
            <span style={{ fontSize: 10, color: W.tabInkMuted, marginLeft: 4 }}>สี</span>
            {TEXT_COLORS.map(c => (
              <ColorDot key={c} color={c} active={textColor === c} onClick={() => setTextColor(c)} title={c} />
            ))}
          </RibbonGroup>

          <RibbonGroup label="ย่อหน้า">
            {LINE_PRESETS.map(p => (
              <RibbonBtn
                key={p.value}
                active={lineHeight === p.value}
                onClick={() => setLineHeight(p.value)}
                title={`ระยะบรรทัด ${p.label}`}
              >
                {p.label}×
              </RibbonBtn>
            ))}
            {ALIGN_OPTS.map(a => (
              <RibbonBtn
                key={a.id}
                active={alignment === a.id}
                onClick={() => setAlignment(a.id)}
                title={a.title}
              >
                {a.icon}
              </RibbonBtn>
            ))}
            <span style={{ fontSize: 10, color: W.tabInkMuted }}>HL</span>
            {HL_COLORS.map((c, i) => (
              <ColorDot
                key={i}
                color={c || "#f3f2f1"}
                active={hlColor === c}
                onClick={() => setHlColor(c)}
                title={c || "ไม่เน้น"}
              />
            ))}
          </RibbonGroup>

          <RibbonGroup label="หน้า">
            <label style={{ fontSize: 11, display: "flex", alignItems: "center", gap: 4 }}>
              ขอบ
              <input
                type="range"
                min={16}
                max={96}
                value={marginPx}
                onChange={e => setMarginPx(+e.target.value)}
                style={{ width: 72, accentColor: W.accent }}
              />
              <span style={{ minWidth: 28 }}>{marginPx}</span>
            </label>
            <label style={{ fontSize: 11, display: "flex", alignItems: "center", gap: 4 }}>
              ระยะย่อหน้า
              <input
                type="range"
                min={0}
                max={28}
                value={paraSpacing}
                onChange={e => setParaSpacing(+e.target.value)}
                style={{ width: 64, accentColor: W.accent }}
              />
            </label>
          </RibbonGroup>

          <RibbonGroup label="ส่งออก">
            <button
              type="button"
              onClick={exportPdf}
              disabled={!text.trim()}
              style={{
                height: 28,
                padding: "0 16px",
                borderRadius: 4,
                border: "none",
                background: text.trim() ? W.accent : "#c8c6c4",
                color: "#fff",
                fontWeight: 600,
                fontSize: 12,
                cursor: text.trim() ? "pointer" : "not-allowed",
              }}
            >
              Export PDF
            </button>
            <RibbonBtn active={showVersionDebug} onClick={() => setShowVersionDebug(v => !v)} title="แสดง v1/v2/v3">
              v?
            </RibbonBtn>
          </RibbonGroup>
        </div>
      </div>

      {/* ── Ruler ── */}
      <div
        style={{
          height: 22,
          background: "linear-gradient(to bottom,#faf9f8,#edebe9)",
          borderBottom: `1px solid ${W.ribbonBorder}`,
          display: "flex",
          alignItems: "flex-end",
          paddingLeft: Math.min(marginPx, 80),
          paddingRight: Math.min(marginPx, 80),
          flexShrink: 0,
        }}
      >
        {Array.from({ length: 24 }, (_, i) => (
          <div
            key={i}
            style={{
              flex: 1,
              height: i % 5 === 0 ? 10 : 5,
              borderLeft: `1px solid ${i % 5 === 0 ? "#a19f9d" : "#d2d0ce"}`,
            }}
          />
        ))}
      </div>

      {/* ── Warnings ── */}
      {!hasFileGlyphs && (
        <div
          style={{
            margin: "6px 8px 0",
            background: "#fff4ce",
            border: "1px solid #f1c40f",
            borderRadius: 4,
            padding: "6px 10px",
            fontSize: 12,
            color: "#605e5c",
          }}
        >
          ยังไม่มี glyph จาก Step 3 — จะแสดงเป็นตัวอักษรธรรมดา
        </div>
      )}

      {/* ── Split: ซ้าย = input | ขวา = พรีวิวกระดาษ (ชิดกัน) ── */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "row",
          gap: 8,
          padding: "6px 8px 8px",
          minHeight: 0,
          alignItems: "stretch",
        }}
      >
        {/* LEFT — input */}
        <div
          style={{
            flex: "0 1 42%",
            minWidth: 260,
            maxWidth: 480,
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          <div
            style={{
              background: W.inputCard,
              border: `1px solid ${W.ribbonBorder}`,
              borderRadius: 6,
              boxShadow: "0 1px 3px rgba(0,0,0,.06)",
              flex: 1,
              display: "flex",
              flexDirection: "column",
              minHeight: 0,
            }}
          >
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: W.tabInkMuted,
                padding: "8px 12px",
                borderBottom: `1px solid ${W.ribbonBorder}`,
                background: "#faf9f8",
                letterSpacing: "0.02em",
              }}
            >
              ข้อความต้นฉบับ
            </div>
            <textarea
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder="พิมพ์ที่นี่ — ฝั่งขวาจะแสดงลายมือ และขึ้นบรรทัดใหม่ตามขอบกระดาษ"
              style={{
                flex: 1,
                width: "100%",
                boxSizing: "border-box",
                border: "none",
                padding: "10px 12px",
                fontSize: 14,
                lineHeight: 1.45,
                resize: "none",
                outline: "none",
                fontFamily: "'Segoe UI','DM Sans',system-ui,sans-serif",
                minHeight: 280,
                background: "#fff",
                color: W.tabInk,
              }}
            />
          </div>
          <p style={{ fontSize: 10, color: W.tabInkMuted, margin: 0, lineHeight: 1.45 }}>
            PDF: กด Export PDF → เลือก &quot;Microsoft Print to PDF&quot;
            <br />
            <span style={{ color: W.accent }}>
              ถ้ามีวันที่/หัวข้อมุมกระดาษ: ในกล่องพิมพ์เปิด &quot;More settings&quot; แล้วปิด &quot;Headers and footers&quot;
            </span>{" "}
            — เว็บไม่สามารถปิดให้อัตโนมัติได้
          </p>
        </div>

        {/* RIGHT — paper well */}
        <div
          style={{
            flex: 1,
            minWidth: 0,
            background: W.pageWell,
            borderRadius: 6,
            border: `1px solid #1a1a1a`,
            boxShadow: "inset 0 0 0 1px rgba(255,255,255,.04)",
            overflowY: "scroll",
            overflowX: "hidden",
            position: "relative",
            display: "flex",
            justifyContent: "center",
            alignItems: "flex-start",
            padding: "12px 10px 16px",
          }}
        >
          {/* Zoom controls (preview only) */}
          <div
            style={{
              position: "absolute",
              top: 8,
              right: 10,
              zIndex: 5,
              display: "flex",
              alignItems: "center",
              gap: 8,
              background: "rgba(255,255,255,0.92)",
              border: `1px solid ${W.ribbonBorder}`,
              borderRadius: 10,
              padding: "6px 8px",
            }}
          >
            <button
              type="button"
              onClick={() => setPreviewZoom(z => Math.max(0.7, +(z - 0.1).toFixed(2)))}
              style={{
                width: 26,
                height: 26,
                borderRadius: 8,
                border: `1px solid ${W.ribbonBorder}`,
                background: "#fff",
                cursor: "pointer",
                fontSize: 14,
                color: W.tabInk,
              }}
              aria-label="Zoom out"
              title="Zoom out"
            >
              -
            </button>
            <span style={{ fontSize: 12, color: W.tabInkMuted, minWidth: 52, textAlign: "center" }}>
              {Math.round(previewZoom * 100)}%
            </span>
            <button
              type="button"
              onClick={() => setPreviewZoom(z => Math.min(1.6, +(z + 0.1).toFixed(2)))}
              style={{
                width: 26,
                height: 26,
                borderRadius: 8,
                border: `1px solid ${W.ribbonBorder}`,
                background: "#fff",
                cursor: "pointer",
                fontSize: 14,
                color: W.tabInk,
              }}
              aria-label="Zoom in"
              title="Zoom in"
            >
              +
            </button>
          </div>

          <div
            style={{
              width: "100%",
              maxWidth: 595,
              minHeight: 842 * previewZoom,
              position: "relative",
            }}
          >
            <div
              style={{
                width: "100%",
                maxWidth: 595,
                minHeight: 842,
                background: W.page,
                boxShadow: "0 4px 24px rgba(0,0,0,.45), 0 0 0 1px rgba(0,0,0,.12)",
                padding: `${marginPx}px`,
                boxSizing: "border-box",
                transform: `scale(${previewZoom})`,
                transformOrigin: "top center",
              }}
            >
              <div
                style={{
                  fontSize,
                  lineHeight,
                  color: textColor,
                  textAlign: alignment,
                  width: "100%",
                  maxWidth: "100%",
                  boxSizing: "border-box",
                  minHeight: 640,
                  wordBreak: "break-word",
                  overflowWrap: "anywhere",
                  overflowX: "hidden",
                  WebkitFontSmoothing: "antialiased",
                  textRendering: "optimizeLegibility",
                }}
              >
                {tokens.length === 0 ? (
                  <span style={{ opacity: 0.35, color: W.tabInkMuted }}>
                    พิมพ์ฝั่งซ้ายเพื่อดูลายมือบนกระดาษ…
                  </span>
                ) : (
                  tokens.map(renderToken)
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Status bar ── */}
      <div
        style={{
          height: 26,
          flexShrink: 0,
          background: W.statusBg,
          borderTop: `1px solid ${W.ribbonBorder}`,
          display: "flex",
          alignItems: "center",
          padding: "0 12px",
          fontSize: 11,
          color: W.tabInkMuted,
          gap: 16,
        }}
      >
        <span>หน้า 1 จาก 1</span>
        <span>คำ: {text.trim() ? text.trim().split(/\s+/).filter(Boolean).length : 0}</span>
        <span>
          แหล่งข้อมูล: {usingVersioned ? `versioned (${versionedGlyphs.length})` : `raw (${extractedGlyphs.length})`}
        </span>
        <span>ตัวอักษรเทมเพลต {sourceChars.length}</span>
        <span>seed {documentSeed}</span>
        <span>dna #{dnaNonce}</span>
        <div style={{ flex: 1 }} />
        <span>100%</span>
      </div>
    </div>
  )
}
