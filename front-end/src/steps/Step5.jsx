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

function buildCharVariant(_charRng, wordStyle, weight = "normal") {
  const widthScale = weight === "bold" ? 0.6 : weight === "light" ? 0.52 : 0.56
  return {
    rotate: wordStyle.rotate,
    skewX: wordStyle.skewX,
    scaleX: 1.0,
    scaleY: wordStyle.scaleY,
    shiftY: wordStyle.shiftY,
    widthScale,
    kerning: 0,
    opacity: wordStyle.opacity,
  }
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

function GlyphSlot({ glyph, ch, slotW, slotH, opacity, textColor, hlColor, viewBox }) {
  const hasSvg =
    glyph &&
    typeof glyph.svgPath === "string" &&
    glyph.svgPath.trim() !== "" &&
    glyph.svgPath.trim() !== "M 0 0"

  const pngSrc = glyph ? normalizePngDataUrl(glyph.previewInk || glyph.preview || "") : ""

  const outerStyle = {
    display: "inline-block",
    width: slotW,
    height: slotH,
    verticalAlign: "bottom",
    flexShrink: 0,
    margin: 0,
    padding: 0,
    overflow: "visible",
    background: hlColor || "transparent",
  }

  const innerStyle = {
    display: "inline-flex",
    alignItems: "flex-end",
    justifyContent: "center",
    width: "100%",
    height: "100%",
    opacity,
    color: textColor,
  }

  return (
    <span style={outerStyle}>
      <span style={innerStyle}>
        {hasSvg ? (
          <svg
            viewBox={glyph.viewBox || viewBox || "0 0 100 100"}
            style={{ width: "100%", height: "100%", overflow: "visible", display: "block" }}
            aria-label={ch}
          >
            <path
              d={glyph.svgPath}
              fill="none"
              stroke={textColor || "#2C2416"}
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : pngSrc ? (
          <img
            src={pngSrc}
            alt={ch}
            style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
          />
        ) : (
          ch
        )}
      </span>
    </span>
  )
}

// ─── Microsoft Word–inspired chrome ───────────────────────────────────────────
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
  page: "#ffffff",
  statusBg: "#f3f2f1",
  groupLabel: "#605e5c",
}

const LINE_PRESETS = [
  { label: "1.0", value: 1.0 },
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
  const [lineHeight, setLineHeight] = useState(1.5)
  const [alignment, setAlignment] = useState("left")
  const [fontWeight, setFontWeight] = useState("normal")
  const [paraSpacing, setParaSpacing] = useState(8)
  const [textColor, setTextColor] = useState("#2C2416")
  const [hlColor, setHlColor] = useState("")
  const [marginPx, setMarginPx] = useState(48)
  const [pageWidth] = useState(720)
  const [showVersionDebug, setShowVersionDebug] = useState(false)

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

  const exportWord = useCallback(() => {
    const pieces = []

    for (const token of tokens) {
      if (token.type === "newline") {
        pieces.push("<br />")
        continue
      }
      if (token.type === "space") {
        const spW = Math.round(fontSize * 0.32)
        const spH = Math.round(fontSize * 1.3)
        pieces.push(
          `<span style="display:inline-block;width:${spW}px;height:${spH}px;vertical-align:bottom;"></span>`
        )
        continue
      }
      if (token.type !== "word") continue

      const t = token.chars[0]?.variant
      if (!t) continue
      const rotate = t.rotate.toFixed(2)
      const skewX = t.skewX.toFixed(2)
      const topPx = t.shiftY.toFixed(2)
      const slotW = Math.round(fontSize * 0.72)
      const slotH = Math.round(fontSize * 1.3)

      const charPieces = token.chars.map(ct => {
        const hl = hlColor ? `background:${hlColor};` : ""
        const g = ct.glyph
        const hasSvg =
          g &&
          typeof g.svgPath === "string" &&
          g.svgPath.trim() !== "" &&
          g.svgPath.trim() !== "M 0 0"

        let inner
        if (hasSvg) {
          const vb = g.viewBox || "0 0 100 100"
          inner =
            `<svg viewBox="${vb}" style="width:100%;height:100%;display:block;" aria-label="${escapeHtml(ct.ch)}">` +
            `<path d="${escapeHtml(g.svgPath)}" fill="none" stroke="${textColor}" ` +
            `stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`
        } else if (ct.preview) {
          inner =
            `<img src="${ct.preview}" alt="${escapeHtml(ct.ch)}" ` +
            `style="width:100%;height:100%;object-fit:contain;display:block;" />`
        } else {
          inner = escapeHtml(ct.ch)
        }

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
          charPieces.join("") +
          `</span>`
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
    const url = URL.createObjectURL(blob)
    const a = Object.assign(document.createElement("a"), {
      href: url,
      download: `handwriting-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.doc`,
    })
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 4000)
  }, [tokens, fontSize, lineHeight, alignment, textColor, hlColor, marginPx])

  const renderChar = ct => {
    const t = ct.variant
    const slotW = Math.round(fontSize * 0.72)
    const slotH = Math.round(fontSize * 1.3)

    return (
      <span key={ct.id} style={{ position: "relative", display: "inline-block" }}>
        <GlyphSlot
          glyph={ct.glyph}
          ch={ct.ch}
          slotW={slotW}
          slotH={slotH}
          opacity={t.opacity}
          textColor={textColor}
          hlColor={hlColor}
          viewBox="0 0 100 100"
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
    if (token.type === "newline") return <br key={token.id} />

    if (token.type === "space") {
      return (
        <span
          key={token.id}
          style={{
            display: "inline-block",
            width: Math.round(fontSize * 0.32),
            height: Math.round(fontSize * 1.3),
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
            alignItems: "flex-end",
            whiteSpace: "nowrap",
            verticalAlign: "bottom",
            transform: `rotate(${t.rotate.toFixed(2)}deg) skewX(${t.skewX.toFixed(2)}deg)`,
            transformOrigin: "left bottom",
            position: "relative",
            top: `${t.shiftY.toFixed(2)}px`,
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
              onClick={exportWord}
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
              Export Word
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
            margin: "8px 16px 0",
            background: "#fff4ce",
            border: "1px solid #f1c40f",
            borderRadius: 4,
            padding: "8px 12px",
            fontSize: 12,
            color: "#605e5c",
          }}
        >
          ยังไม่มี glyph จาก Step 3 — จะแสดงเป็นตัวอักษรธรรมดา
        </div>
      )}
      {/* ── Editor + Page (Word canvas) ── */}
      <div style={{ flex: 1, overflow: "auto", padding: "16px 24px 24px" }}>
        <div style={{ maxWidth: pageWidth + 80, margin: "0 auto" }}>
          <div
            style={{
              background: "#fff",
              border: `1px solid ${W.ribbonBorder}`,
              borderRadius: 4,
              marginBottom: 10,
              boxShadow: "0 1px 2px rgba(0,0,0,.06)",
            }}
          >
            <div
              style={{
                fontSize: 11,
                color: W.tabInkMuted,
                padding: "6px 12px",
                borderBottom: `1px solid ${W.ribbonBorder}`,
                background: "#faf9f8",
              }}
            >
              พิมพ์ข้อความที่นี่ — ตัวอักษรจะถูกแมปกับลายมือจาก Step 4 (สุ่ม v1 / v2 / v3 ต่อช่อง)
            </div>
            <textarea
              value={text}
              onChange={e => setText(e.target.value)}
              rows={3}
              placeholder="พิมพ์ข้อความภาษาไทยหรือภาษาอังกฤษ…"
              style={{
                width: "100%",
                boxSizing: "border-box",
                border: "none",
                padding: "12px 14px",
                fontSize: 14,
                resize: "vertical",
                outline: "none",
                fontFamily: "'Segoe UI','DM Sans',system-ui,sans-serif",
                minHeight: 72,
                background: "#fff",
              }}
            />
          </div>

          {/* Single page — Word document body */}
          <div
            style={{
              width: "100%",
              maxWidth: pageWidth,
              margin: "0 auto",
              minHeight: 880,
              background: W.page,
              boxShadow: "0 2px 8px rgba(0,0,0,.12), 0 0 1px rgba(0,0,0,.08)",
              border: `1px solid ${W.ribbonBorder}`,
              padding: `${marginPx}px`,
              boxSizing: "border-box",
            }}
          >
            <div
              style={{
                fontSize,
                lineHeight,
                color: textColor,
                textAlign: alignment,
                minHeight: 720,
                paddingBottom: paraSpacing,
                whiteSpace: "pre-wrap",
                wordBreak: "keep-all",
                overflowWrap: "normal",
              }}
            >
              {tokens.length === 0 ? (
                <span style={{ opacity: 0.35, color: W.tabInkMuted }}>พิมพ์ด้านบนเพื่อดูลายมือบนหน้ากระดาษ…</span>
              ) : (
                tokens.map(renderToken)
              )}
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
