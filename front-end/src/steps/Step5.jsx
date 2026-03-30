import { useMemo, useState, useCallback } from "react"
import { DOCUMENT_SEED } from "../lib/documentSeed.js"
import { buildTokens } from "../lib/step5/tokens.js"
import { buildDocumentHtmlFragment as buildDocumentHtmlFragmentLib } from "../lib/step5/documentHtml.js"
import Step5Toolbar from "./step5/Step5Toolbar.jsx"
import Step5Preview from "./step5/Step5Preview.jsx"

/** ความหนาเส้นปากกาเทียบ fontSize — พิมพ์/จอใช้สูตรเดียวกัน */
function penStrokeWidth(fontSize, mul = 1) {
  const fs = Number(fontSize) || 32
  return Math.max(1.2, Math.min(3.5, fs * 0.064 * mul))
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
  overlapFactor,
}) {
  const hasSvg =
    glyph &&
    typeof glyph.svgPath === "string" &&
    glyph.svgPath.trim() !== "" &&
    glyph.svgPath.trim() !== "M 0 0"

  const pngInk = glyph ? normalizePngDataUrl(glyph.previewInk || "") : ""
  // ใช้เฉพาะ ink ที่พื้นหลังโปร่งใสเท่านั้น เพื่อตัด "กล่องพื้นหลัง" ออก
  const usePngInk = pngInk.length > 0

  const sw = penStrokeWidth(fontSize, strokeWMul)
  // Overlap เพื่อให้คำ/ตัวทับกันได้แบบงานพิมพ์
  const overlapPx = Math.min(
    Math.max(0, Math.round(slotW * (overlapFactor ?? DEFAULT_OVERLAP_FACTOR))),
    Math.max(0, slotW - 1)
  )

  const outerStyle = {
    display: "inline-block",
    width: slotW,
    height: slotH,
    verticalAlign: "bottom",
    flexShrink: 0,
    margin: 0,
    // ทำให้ตัวติดกันชิดขึ้น และยอมให้ "ทับ" ได้เล็กน้อยเหมือนคนพิมพ์
    marginRight: `-${overlapPx}px`,
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
        {hasSvg ? (
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
        ) : usePngInk ? (
          <img
            src={pngInk}
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
// ลด slot ให้แคบลง + เพิ่ม overlap เพื่อให้ตัวอักษรชิดกันแบบลายมือจริง
const GLYPH_SLOT_W_RATIO = 0.62
const GLYPH_SLOT_H_RATIO = 1.10
// ลดช่องว่างระหว่างตัวให้ชิดขึ้น (คนพิมพ์ไม่เว้นเท่ากัน)
const GLYPH_SPACE_W_RATIO = 0.26

// Overlap (ทับ) ระหว่างตัว เพื่อให้ “เป็นคำ” อ่านง่าย
// ยิ่งค่านี้สูง ยิ่งชิด/ยิ่งทับมาก (แต่ไม่กระทบขนาด glyph โดยตรง)
const OVERLAP_FACTOR = 0.22
const DEFAULT_OVERLAP_FACTOR = OVERLAP_FACTOR
const DEFAULT_SLOT_W_RATIO = GLYPH_SLOT_W_RATIO

function glyphMetrics(fontSize, slotWRatio) {
  const fs = Number(fontSize) || 32
  const swr = Number(slotWRatio) || GLYPH_SLOT_W_RATIO
  return {
    slotW: Math.max(12, Math.round(fs * swr)),
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
  // กันปัญหา: ลบ/พิมพ์ใหม่แล้ว ver ติดเดิม
  // (ทำให้ seed การเลือก version เปลี่ยนทุกครั้งที่แก้ข้อความ)
  const [editNonce, setEditNonce] = useState(0)
  const [dnaNonce, setDnaNonce] = useState(0)
  const [fontSize, setFontSize] = useState(48)
  const [lineHeight, setLineHeight] = useState(1.15)
  const [alignment, setAlignment] = useState("left")
  const [fontWeight, setFontWeight] = useState("normal")
  const [paraSpacing, setParaSpacing] = useState(2)
  const [textColor, setTextColor] = useState("#2C2416")
  const [hlColor, setHlColor] = useState("")
  const [marginPx, setMarginPx] = useState(48)
  const [showVersionDebug, setShowVersionDebug] = useState(false)

  // Zoom เฉพาะฝั่ง preview (ไม่กระทบ Export PDF)
  const [previewZoom, setPreviewZoom] = useState(1)
  // ใช้ transform scale กับฝั่ง preview เพื่อลด layout shift

  // Export shift (แกน X) - ใช้ปรับตำแหน่งตอนส่งออกโดยไม่กระทบ preview layout มาก
  const [outputOffsetX, setOutputOffsetX] = useState(64)
  const [overlapFactor, setOverlapFactor] = useState(DEFAULT_OVERLAP_FACTOR)
  const [slotWRatio, setSlotWRatio] = useState(DEFAULT_SLOT_W_RATIO)

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

  const tokens = useMemo(
    () =>
      buildTokens({
        text,
        glyphMap,
        documentSeed,
        dnaNonce,
        editNonce,
        fontWeight,
      }),
    [text, glyphMap, dnaNonce, fontWeight, documentSeed, editNonce]
  )

  /** Build HTML fragment (preview + print) — words wrap; long strings break inside page width */
  const buildDocumentHtmlFragment = useCallback(
    () =>
      buildDocumentHtmlFragmentLib({
        tokens,
        fontSize,
        textColor,
        hlColor,
        slotWRatio: slotWRatio,
        slotHRatio: GLYPH_SLOT_H_RATIO,
        spaceWRatio: GLYPH_SPACE_W_RATIO,
        overlapFactor: overlapFactor,
      }),
    [tokens, fontSize, textColor, hlColor]
  )

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
.hw-word { page-break-inside: avoid; break-inside: avoid; }
.hw-br { display: block; width: 100%; height: 0; margin: 0 0 ${paraSpacing}px 0; padding: 0; clear: both; }
@media print {
  body { background: #fff; }
  .paper { padding: ${marginPx}px; page-break-inside: auto; }
}
</style></head>
<body>
  <div class="paper"><div style="margin-left:${outputOffsetX}px; transform-origin: top left;">${inner}</div></div>
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

  /** สุ่ม version ระดับคำ — deterministic จาก token id + dnaNonce */
  const wordVersionFor = (tokenId) => {
    let h = (dnaNonce + 1) * 2654435761
    for (let i = 0; i < tokenId.length; i++) {
      h = Math.imul(h ^ tokenId.charCodeAt(i), 2246822519) >>> 0
    }
    return h
  }

  const renderChar = (ct, idx, wordVerIdx) => {
    const t = ct.variant
    // ใช้ version ระดับคำ (wordVerIdx) แทน version ระดับตัวอักษร
    const chKey = String(ct.ch || "")
    const chGlyphs = glyphMap.get(chKey) || []
    const resolvedGlyph = chGlyphs.length > 0 && wordVerIdx != null
      ? chGlyphs[wordVerIdx % chGlyphs.length]
      : ct.glyph
    const { slotW, slotH } = glyphMetrics(fontSize, slotWRatio)
    const tx = t.shiftX ?? 0
    const ty = t.shiftYMicro ?? 0
    const mr = t.microRotate ?? 0
    const overlapPx = Math.min(
      Math.max(0, Math.round(slotW * overlapFactor)),
      Math.max(0, slotW - 1)
    )

    return (
      <span
        key={ct.id}
        style={{
          position: "relative",
          display: "inline-block",
          transform: `translate(${tx}px, ${ty}px) rotate(${mr}deg)`,
          transformOrigin: "center bottom",
          verticalAlign: "bottom",
          marginLeft: idx === 0 ? 0 : `-${overlapPx}px`,
        }}
      >
        <GlyphSlot
          glyph={resolvedGlyph}
          ch={ct.ch}
          slotW={slotW}
          slotH={slotH}
          opacity={t.opacity}
          textColor={textColor}
          hlColor={hlColor}
          viewBox="0 0 100 100"
          fontSize={fontSize}
          strokeWMul={t.strokeWMul ?? 1}
          overlapFactor={overlapFactor}
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
    if (token.type === "newline") {
      // แปลง lineHeight → ระยะห่างจริง โดยใช้ slotH เป็น base
      const { slotH } = glyphMetrics(fontSize, slotWRatio)
      const rowGap = Math.round(slotH * (lineHeight - 1)) + paraSpacing
      return (
        <span
          key={token.id}
          style={{
            display: "block",
            width: "100%",
            height: 0,
            marginBottom: rowGap,
          }}
        />
      )
    }

    if (token.type === "space") {
      const { spaceW, slotH } = glyphMetrics(fontSize, slotWRatio)
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
      // สุ่ม version เดียวสำหรับทั้งคำ
      const wordVerIdx = wordVersionFor(token.id)
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
          {token.chars.map((ct, idx) => renderChar(ct, idx, wordVerIdx))}
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
      <Step5Toolbar
        hasFileGlyphs={hasFileGlyphs}
        versionedGlyphs={versionedGlyphs}
        fontSize={fontSize}
        setFontSize={setFontSize}
        fontWeight={fontWeight}
        setFontWeight={setFontWeight}
        textColor={textColor}
        setTextColor={setTextColor}
        lineHeight={lineHeight}
        setLineHeight={setLineHeight}
        alignment={alignment}
        setAlignment={setAlignment}
        hlColor={hlColor}
        setHlColor={setHlColor}
        marginPx={marginPx}
        setMarginPx={setMarginPx}
        paraSpacing={paraSpacing}
        setParaSpacing={setParaSpacing}
        exportPdf={exportPdf}
        text={text}
        outputOffsetX={outputOffsetX}
        setOutputOffsetX={setOutputOffsetX}
        showVersionDebug={showVersionDebug}
        setShowVersionDebug={setShowVersionDebug}
        setDnaNonce={setDnaNonce}
        overlapFactor={overlapFactor}
        setOverlapFactor={setOverlapFactor}
        slotWRatio={slotWRatio}
        setSlotWRatio={setSlotWRatio}
        LINE_PRESETS={LINE_PRESETS}
        ALIGN_OPTS={ALIGN_OPTS}
        WEIGHT_OPTS={WEIGHT_OPTS}
        FONT_SIZES={FONT_SIZES}
        TEXT_COLORS={TEXT_COLORS}
        HL_COLORS={HL_COLORS}
      />
      <Step5Preview
        hasFileGlyphs={hasFileGlyphs}
        marginPx={marginPx}
        text={text}
        setText={setText}
        setEditNonce={setEditNonce}
        tokens={tokens}
        renderToken={renderToken}
        outputOffsetX={outputOffsetX}
        fontSize={fontSize}
        lineHeight={lineHeight}
        textColor={textColor}
        alignment={alignment}
        previewZoom={previewZoom}
        setPreviewZoom={setPreviewZoom}
        usingVersioned={usingVersioned}
        versionedGlyphs={versionedGlyphs}
        extractedGlyphs={extractedGlyphs}
        sourceChars={sourceChars}
        documentSeed={documentSeed}
        dnaNonce={dnaNonce}
      />
    </div>
  )
}