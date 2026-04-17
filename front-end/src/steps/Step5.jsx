/**
 * Step5 — Preview & Export
 *
 * ARCHITECTURE ROLE: Pure consumer. Renders handwriting preview and exports PDF.
 *
 * Props:
 *   versionedGlyphs: Glyph[]  — from appState.versionedGlyphs (built in App.jsx useEffect)
 *   extractedGlyphs: Glyph[]  — from appState.glyphResult.glyphs (raw, unversioned)
 *
 * REMOVED:
 *   - selected      (Step 1 legacy — eliminated)
 *   - templateChars (Step 1 legacy — eliminated)
 *   - sourceChars useMemo (was templateChars ?? selected — eliminated)
 *   - documentSeed prop (always DOCUMENT_SEED constant — no reason to prop-drill)
 *
 * Status bar now shows data-driven glyph counts, not character selection counts.
 */
import { useMemo, useState, useCallback } from "react"
import { DOCUMENT_SEED } from "../lib/documentSeed.js"
import { buildTokens } from "../lib/step5/tokens.js"
import { buildDocumentHtmlFragment as buildDocumentHtmlFragmentLib } from "../lib/step5/documentHtml.js"
import { calculateAnchorPositions, validateAnchorPositions } from "../lib/step5/thaiAnchors.js"
import Step5Toolbar from "./step5/Step5Toolbar.jsx"
import Step5Preview from "./step5/Step5Preview.jsx"

// ─── Helpers ──────────────────────────────────────────────────────────────────
function penStrokeWidth(fontSize, mul = 1) {
  const fs = Number(fontSize) || 32
  return Math.max(1.2, Math.min(3.5, fs * 0.064 * mul))
}

function normalizePngDataUrl(dataUrl) {
  if (!dataUrl?.startsWith("data:image/png")) return ""
  const parts = String(dataUrl).split(",")
  if (parts.length < 2) return ""
  try { return `data:image/png;base64,${btoa(atob(parts[1]))}` } catch { return "" }
}

function AnchorGlyphSlot({ cluster, slotW, slotH, opacity, textColor, hlColor, viewBox, fontSize, strokeWMul = 1, overlapFactor }) {
  const positions = calculateAnchorPositions(cluster, fontSize)
  const overlapPx = Math.min(Math.max(0, Math.round(slotW * (overlapFactor ?? DEFAULT_OVERLAP_FACTOR))), Math.max(0, slotW - 1))

  return (
    <span style={{
      display:       "inline-block",
      position:      "relative",
      width:         slotW,
      height:        slotH,
      verticalAlign: "bottom",
      flexShrink:    0,
      marginRight:   `-${overlapPx}px`,
      overflow:      "visible",
      background:    hlColor || "transparent",
      opacity:       opacity ?? 1,
    }}>
      {positions.map((pos, idx) => {
        const g         = pos.component.glyph
        const ch        = pos.component.ch
        const hasSvg    = g && typeof g.svgPath === "string" && g.svgPath.trim() !== "" && g.svgPath.trim() !== "M 0 0"
        const pngInk    = g ? normalizePngDataUrl(g.previewInk ?? "") : ""
        const usePngInk = pngInk.length > 0
        const sw        = penStrokeWidth(fontSize * pos.scale, strokeWMul)
        // Each component fills the entire slot box, then is nudged by offsetX/Y.
        // This is correct Thai stacking: consonant at baseline, vowel/tone above/below.
        const layerW = Math.round(slotW  * pos.scale)
        const layerH = Math.round(slotH  * pos.scale)

        return (
          <span
            key={idx}
            style={{
              position:  "absolute",
              left:      0,
              bottom:    0,
              width:     layerW,
              height:    layerH,
              transform: `translate(${pos.offsetX}px, ${pos.offsetY}px)`,
              display:   "flex",
              alignItems:     "flex-end",
              justifyContent: "flex-start",
              overflow:  "visible",
            }}
          >
            {hasSvg ? (
              <svg
                viewBox={g.viewBox || viewBox || "0 0 100 100"}
                style={{ width:"100%", height:"100%", overflow:"visible", display:"block", shapeRendering:"geometricPrecision" }}
                aria-label={ch}
              >
                <path d={g.svgPath} fill="none" stroke={textColor || "#2C2416"} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" paintOrder="stroke fill" />
              </svg>
            ) : usePngInk ? (
              <img src={pngInk} alt={ch} style={{ width:"100%", height:"100%", objectFit:"contain", objectPosition:"left bottom", display:"block", mixBlendMode:"multiply" }} />
            ) : (
              <span style={{ fontFamily:"'TH Sarabun New','Noto Sans Thai',Tahoma,sans-serif", fontSize:Math.round(fontSize * pos.scale * 0.92), fontWeight:500, lineHeight:1, color:textColor }}>
                {ch}
              </span>
            )}
          </span>
        )
      })}
    </span>
  )
}

function GlyphSlot({ glyph, ch, slotW, slotH, opacity, textColor, hlColor, viewBox, fontSize, strokeWMul = 1, overlapFactor }) {
  const hasSvg = glyph && typeof glyph.svgPath === "string" && glyph.svgPath.trim() !== "" && glyph.svgPath.trim() !== "M 0 0"
  const pngInk   = glyph ? normalizePngDataUrl(glyph.previewInk ?? "") : ""
  const usePngInk = pngInk.length > 0
  const sw        = penStrokeWidth(fontSize, strokeWMul)
  const overlapPx = Math.min(Math.max(0, Math.round(slotW * (overlapFactor ?? DEFAULT_OVERLAP_FACTOR))), Math.max(0, slotW - 1))

  return (
    <span style={{ display:"inline-block", width:slotW, height:slotH, verticalAlign:"bottom", flexShrink:0, marginRight:`-${overlapPx}px`, overflow:"visible", background:hlColor || "transparent" }}>
      <span style={{ display:"inline-flex", alignItems:"flex-end", justifyContent:"flex-start", width:"100%", height:"100%", opacity, color:textColor }}>
        {hasSvg ? (
          <svg viewBox={glyph.viewBox || viewBox || "0 0 100 100"} style={{ width:"100%", height:"100%", overflow:"visible", display:"block", shapeRendering:"geometricPrecision" }} aria-label={ch}>
            <path d={glyph.svgPath} fill="none" stroke={textColor || "#2C2416"} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" paintOrder="stroke fill" />
          </svg>
        ) : usePngInk ? (
          <img src={pngInk} alt={ch} style={{ width:"100%", height:"100%", objectFit:"contain", objectPosition:"left bottom", display:"block", imageRendering:"auto", mixBlendMode:"multiply" }} />
        ) : (
          <span style={{ fontFamily:"'TH Sarabun New','Noto Sans Thai',Tahoma,sans-serif", fontSize:Math.round(fontSize * 0.92), fontWeight:500, lineHeight:1, color:textColor }}>
            {ch}
          </span>
        )}
      </span>
    </span>
  )
}

// ─── Constants ────────────────────────────────────────────────────────────────
const W = {
  ribbonBg:"#f3f2f1", ribbonBorder:"#d2d0ce", tabBar:"#edebe9", tabActive:"#ffffff",
  tabInk:"#323130", tabInkMuted:"#605e5c", accent:"#0078d4", accentHover:"#106ebe",
  canvas:"#e7e6e6", pageWell:"#2d2c2c", page:"#ffffff", statusBg:"#f3f2f1", groupLabel:"#605e5c",
}

const GLYPH_SLOT_W_RATIO     = 0.62
const GLYPH_SLOT_H_RATIO     = 1.10
const GLYPH_SPACE_W_RATIO    = 0.26
const OVERLAP_FACTOR         = 0.22
const DEFAULT_OVERLAP_FACTOR = OVERLAP_FACTOR
const DEFAULT_SLOT_W_RATIO   = GLYPH_SLOT_W_RATIO

function glyphMetrics(fontSize, slotWRatio) {
  const fs  = Number(fontSize) || 32
  const swr = Number(slotWRatio) || GLYPH_SLOT_W_RATIO
  return {
    slotW:  Math.max(12, Math.round(fs * swr)),
    slotH:  Math.max(20, Math.round(fs * GLYPH_SLOT_H_RATIO)),
    spaceW: Math.max(3,  Math.round(fs * GLYPH_SPACE_W_RATIO)),
  }
}

const LINE_PRESETS = [{ label:"0.5",value:0.5 },{ label:"1.0",value:1.0 },{ label:"1.5",value:1.5 },{ label:"1.8",value:1.8 },{ label:"2.5",value:2.5 }]
const ALIGN_OPTS   = [{ id:"left",icon:"⇤",title:"จัดซ้าย" },{ id:"center",icon:"↔",title:"กึ่งกลาง" },{ id:"right",icon:"⇥",title:"จัดขวา" },{ id:"justify",icon:"⇔",title:"เต็มบรรทัด" }]
const WEIGHT_OPTS  = ["light","normal","bold"]
const FONT_SIZES   = [24,28,32,36,42,48,56,64]

// ─── Component ────────────────────────────────────────────────────────────────
/**
 * Props:
 *   versionedGlyphs  — appState.versionedGlyphs  (Glyph[] with version 1/2/3 per char)
 *   extractedGlyphs  — appState.glyphResult.glyphs (raw extracted, unversioned)
 */
export default function Step5({ versionedGlyphs = [], extractedGlyphs = [] }) {
  const documentSeed = DOCUMENT_SEED  // constant — no longer prop-drilled

  const [text,           setText]           = useState("สวัสดีครับ นี่คือตัวอย่างเอกสารจากลายมือ Step 4 → Step 5")
  const [editNonce,      setEditNonce]      = useState(0)
  const [dnaNonce,       setDnaNonce]       = useState(0)
  const [fontSize,       setFontSize]       = useState(48)
  const [lineHeight,     setLineHeight]     = useState(1.8)
  const [alignment,      setAlignment]      = useState("left")
  const [fontWeight,     setFontWeight]     = useState("normal")
  const [paraSpacing,    setParaSpacing]    = useState(2)
  const [textColor,      setTextColor]      = useState("#2C2416")
  const [hlColor,        setHlColor]        = useState("")
  const [marginPx,       setMarginPx]       = useState(48)
  const [showVersionDebug, setShowVersionDebug] = useState(false)
  const [previewZoom,    setPreviewZoom]    = useState(1)
  const [outputOffsetX,  setOutputOffsetX]  = useState(64)
  const [overlapFactor,  setOverlapFactor]  = useState(DEFAULT_OVERLAP_FACTOR)
  const [slotWRatio,     setSlotWRatio]     = useState(DEFAULT_SLOT_W_RATIO)

  const TEXT_COLORS = ["#2C2416","#1a3a5c","#2e6b3e","#8b3a2a","#5c3d7a","#605e5c"]
  const HL_COLORS   = ["","#fff9c4","#c8f7c5","#d4e6ff","#ffe0cc","#f5d0f5"]

  const activeGlyphs   = versionedGlyphs.length > 0 ? versionedGlyphs : extractedGlyphs
  const hasFileGlyphs  = activeGlyphs.length > 0
  const usingVersioned = versionedGlyphs.length > 0

  const glyphMap = useMemo(() => {
    const m = new Map()
    for (const g of activeGlyphs) {
      const key = String(g.ch ?? "")
      if (!key) continue
      if (!m.has(key)) m.set(key, [])
      m.get(key).push(g)
    }
    return m
  }, [activeGlyphs])

  const tokens = useMemo(
    () => buildTokens({ text, glyphMap, documentSeed, dnaNonce, editNonce, fontWeight }),
    [text, glyphMap, dnaNonce, fontWeight, documentSeed, editNonce]
  )

  const buildDocumentHtmlFragment = useCallback(
    () => buildDocumentHtmlFragmentLib({ tokens, fontSize, textColor, hlColor, slotWRatio, slotHRatio: GLYPH_SLOT_H_RATIO, spaceWRatio: GLYPH_SPACE_W_RATIO, overlapFactor }),
    [tokens, fontSize, textColor, hlColor]
  )

  const exportPdf = useCallback(() => {
    const inner = buildDocumentHtmlFragment()
    const docHtml = `<!doctype html>
<html lang="th"><head><meta charset="utf-8"/><title>&#8203;</title>
<style>
@page{size:A4;margin:14mm}*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{font-family:"TH Sarabun New","Noto Sans Thai",Tahoma,sans-serif;background:#fff;color:${textColor};-webkit-print-color-adjust:exact;print-color-adjust:exact;-webkit-font-smoothing:antialiased}
.paper img{-webkit-print-color-adjust:exact;print-color-adjust:exact}
.paper svg{shape-rendering:geometricPrecision}
.paper{width:100%;max-width:100%;padding:${marginPx}px;line-height:${lineHeight};font-size:${fontSize}px;text-align:${alignment};word-break:break-word;overflow-wrap:anywhere;overflow-x:hidden}
.hw-word{page-break-inside:avoid;break-inside:avoid}
.hw-br{display:block;width:100%;height:0;margin:0 0 ${paraSpacing}px 0;padding:0;clear:both}
@media print{body{background:#fff}.paper{padding:${marginPx}px;page-break-inside:auto}}
</style></head>
<body><div class="paper"><div style="margin-left:${outputOffsetX}px;transform-origin:top left;">${inner}</div></div></body></html>`

    const iframe = document.createElement("iframe")
    iframe.setAttribute("style","position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none")
    iframe.setAttribute("aria-hidden","true")
    document.body.appendChild(iframe)

    const win = iframe.contentWindow
    const doc = iframe.contentDocument
    if (!win || !doc) { iframe.remove(); window.alert("ไม่สามารถเตรียมหน้าพิมพ์ได้"); return }

    doc.open(); doc.write(docHtml); doc.close()
    try { doc.title = "\u200b" } catch { /* ignore */ }

    const cleanup = () => iframe.remove()
    const runPrint = () => {
      try { win.focus(); win.print() }
      finally { win.addEventListener("afterprint", cleanup, { once: true }); window.setTimeout(cleanup, 120_000) }
    }
    window.setTimeout(runPrint, 200)
  }, [buildDocumentHtmlFragment, marginPx, lineHeight, fontSize, alignment, textColor, paraSpacing, outputOffsetX])

  const wordVersionFor = (tokenId) => {
    let h = (dnaNonce + 1) * 2654435761
    for (let i = 0; i < tokenId.length; i++) h = Math.imul(h ^ tokenId.charCodeAt(i), 2246822519) >>> 0
    return h
  }

  const renderChar = (ct, idx, wordVerIdx) => {
    const t = ct.variant
    const { slotW, slotH } = glyphMetrics(fontSize, slotWRatio)
    const tx = t.shiftX ?? 0
    const ty = t.shiftYMicro ?? 0
    const mr = t.microRotate ?? 0
    // overlapPx always based on slotW — preserves original spacing math:
    //   prev GlyphSlot.marginRight = -overlapPx
    //   this container.marginLeft  = -overlapPx
    //   net spacing between chars  = slotW - 2*overlapPx  (same as before fix)
    const overlapPx = Math.min(Math.max(0, Math.round(slotW * overlapFactor)), Math.max(0, slotW - 1))
    // charSlotW: wider for clusters that have trailing vowels (กา, เก้า …)
    const charSlotW        = Math.round(slotW * (ct.clusterWidth ?? 1.0))
    const clusterOverlapPx = Math.min(Math.max(0, Math.round(charSlotW * overlapFactor)), Math.max(0, charSlotW - 1))

    // Use subGlyphs (built by tokens.js) to decide rendering path:
    //   subGlyphs.length > 1  → Thai cluster with anchor-based layered rendering
    //   otherwise             → single glyph slot (Latin, digit, standalone Thai char)
    const hasSubGlyphs = ct.subGlyphs && ct.subGlyphs.length > 1

    return (
      // Outer container: no explicit width — child determines it.
      <span
        key={ct.id}
        style={{
          position:        "relative",
          display:         "inline-block",
          transform:       `translate(${tx}px,${ty}px) rotate(${mr}deg)`,
          transformOrigin: "center bottom",
          verticalAlign:   "bottom",
          marginLeft:      idx === 0 ? 0 : `-${overlapPx}px`,
          overflow:        "visible",
        }}
      >
        {hasSubGlyphs ? (
          // ── Thai grapheme cluster: anchor-based layered rendering ──────────
          // AnchorGlyphSlot renders each component (consonant, vowel, tone mark)
          // at its correct anchor position (TOP / BOTTOM / LEFT / RIGHT / CENTER).
          <AnchorGlyphSlot
            cluster={ct}
            slotW={charSlotW}
            slotH={slotH}
            opacity={t.opacity}
            textColor={textColor}
            hlColor={hlColor}
            viewBox="0 0 100 100"
            fontSize={fontSize}
            strokeWMul={t.strokeWMul ?? 1}
            overlapFactor={overlapFactor}
          />
        ) : (
          // ── Single glyph (Latin, digit, standalone Thai consonant) ─────────
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
            overlapFactor={overlapFactor}
          />
        )}
        {showVersionDebug && ct.pickedVersion != null && (
          <span style={{ position:"absolute", top:0, right:0, fontSize:7, lineHeight:1, background:W.accent, color:"#fff", borderRadius:2, padding:"1px 2px", pointerEvents:"none", zIndex:10 }}>
            v{ct.pickedVersion}
          </span>
        )}
      </span>
    )
  }

  const renderToken = token => {
    if (token.type === "newline") {
      const rowGap = Math.max(0, Math.round(lineHeight * fontSize) + paraSpacing)
      return <span key={token.id} style={{ display:"block", width:"100%", height:rowGap, marginBottom:0 }} />
    }
    if (token.type === "space") {
      const { spaceW, slotH } = glyphMetrics(fontSize, slotWRatio)
      return <span key={token.id} style={{ display:"inline-block", width:spaceW, height:slotH, verticalAlign:"bottom", flexShrink:0 }} />
    }
    if (token.type === "word") {
      const t = token.chars[0]?.variant
      if (!t) return null
      const wordVerIdx = wordVersionFor(token.id)
      return (
        <span key={token.id} style={{ display:"inline-flex", flexWrap:"wrap", alignItems:"flex-end", gap:0, rowGap:0, columnGap:0, maxWidth:"100%", verticalAlign:"bottom", boxSizing:"border-box", overflow:"visible", transform:`rotate(${t.rotate.toFixed(2)}deg) skewX(${t.skewX.toFixed(2)}deg)`, transformOrigin:"left bottom", position:"relative", top:`${(t.shiftYWord ?? t.shiftY ?? 0).toFixed(2)}px` }}>
          {token.chars.map((ct, idx) => renderChar(ct, idx, wordVerIdx))}
        </span>
      )
    }
    return null
  }

  return (
    <div style={{ fontFamily:"'Segoe UI','DM Sans',system-ui,sans-serif", color:W.tabInk, minHeight:"100%", display:"flex", flexDirection:"column", background:W.canvas }}>
      <Step5Toolbar
        hasFileGlyphs={hasFileGlyphs}
        versionedGlyphs={versionedGlyphs}
        fontSize={fontSize}             setFontSize={setFontSize}
        fontWeight={fontWeight}         setFontWeight={setFontWeight}
        textColor={textColor}           setTextColor={setTextColor}
        lineHeight={lineHeight}         setLineHeight={setLineHeight}
        alignment={alignment}           setAlignment={setAlignment}
        hlColor={hlColor}               setHlColor={setHlColor}
        marginPx={marginPx}             setMarginPx={setMarginPx}
        paraSpacing={paraSpacing}       setParaSpacing={setParaSpacing}
        exportPdf={exportPdf}
        text={text}
        outputOffsetX={outputOffsetX}   setOutputOffsetX={setOutputOffsetX}
        showVersionDebug={showVersionDebug} setShowVersionDebug={setShowVersionDebug}
        setDnaNonce={setDnaNonce}
        overlapFactor={overlapFactor}   setOverlapFactor={setOverlapFactor}
        slotWRatio={slotWRatio}         setSlotWRatio={setSlotWRatio}
        LINE_PRESETS={LINE_PRESETS}     ALIGN_OPTS={ALIGN_OPTS}
        WEIGHT_OPTS={WEIGHT_OPTS}       FONT_SIZES={FONT_SIZES}
        TEXT_COLORS={TEXT_COLORS}       HL_COLORS={HL_COLORS}
      />
      <Step5Preview
        hasFileGlyphs={hasFileGlyphs}
        marginPx={marginPx}
        text={text}                setText={setText}
        setEditNonce={setEditNonce}
        tokens={tokens}
        renderToken={renderToken}
        outputOffsetX={outputOffsetX}
        fontSize={fontSize}
        lineHeight={lineHeight}
        textColor={textColor}
        alignment={alignment}
        previewZoom={previewZoom}  setPreviewZoom={setPreviewZoom}
        usingVersioned={usingVersioned}
        versionedGlyphs={versionedGlyphs}
        extractedGlyphs={extractedGlyphs}
        // sourceChars REMOVED — status bar now shows glyph counts, not char selection
        glyphCount={extractedGlyphs.length}
        documentSeed={documentSeed}
        dnaNonce={dnaNonce}
      />
    </div>
  )
}