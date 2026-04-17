
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react"
import Step5Toolbar from "./step5/Step5Toolbar.jsx"
import Step5Preview from "./step5/Step5Preview.jsx"

const FONT_FAMILY = "MyHandwriting"
const FONT_STYLE_ID = "step5-myhandwriting-face"
const STYLE_STORAGE_KEY = "hw-step5-saved-styles-v2"
const DESIGN_FILE_VERSION = 2

const DEFAULT_TEXT = `สวัสดีครับ นี่คือลายมือของฉัน
My handwriting font preview 2026`

const PAGE_PRESETS = {
  a4: { id: "a4", label: "A4 · 794 × 1123", width: 794, height: 1123 },
  square: { id: "square", label: "Square · 1080 × 1080", width: 1080, height: 1080 },
  story: { id: "story", label: "Story · 1080 × 1920", width: 1080, height: 1920 },
}

const DEFAULT_DESIGN = {
  text: DEFAULT_TEXT,
  fontSize: 64,
  lineHeight: 1.28,
  letterSpacing: 0.1,
  textColor: "#2B2117",
  opacity: 1,
  alignment: "left",
  boldMock: false,
  italicMock: false,
  randomness: 68,
  baselineWobble: true,
  padding: 82,
  pagePreset: "a4",
  customWidth: 1080,
  customHeight: 1440,
  seed: 1,
}

const STYLE_FIELDS = [
  "fontSize",
  "lineHeight",
  "letterSpacing",
  "textColor",
  "opacity",
  "alignment",
  "boldMock",
  "italicMock",
  "randomness",
  "baselineWobble",
  "padding",
]

const TEMPLATE_ITEMS = [
  {
    id: "friendly-note",
    name: "Friendly Note",
    text: `สวัสดีครับ วันนี้อากาศดีมาก
ขอบคุณที่ใช้งานระบบสร้างลายมือของเรา`,
  },
  {
    id: "formal-letter",
    name: "Formal Letter",
    text: `เรียน ทีมงานที่เกี่ยวข้อง

ขอเรียนแจ้งความคืบหน้าของโครงการประจำสัปดาห์
ด้วยความเคารพ`,
  },
  {
    id: "social-caption",
    name: "Social Caption",
    text: `My handwriting font is finally ready!
ทดลองภาษาไทย อังกฤษ 123 และสัญลักษณ์ @#&`,
  },
]

const STYLE_PRESETS = [
  {
    id: "soft-journal",
    name: "Soft Journal",
    patch: {
      fontSize: 60,
      lineHeight: 1.33,
      letterSpacing: 0.2,
      textColor: "#3A2F23",
      opacity: 0.95,
      randomness: 58,
      baselineWobble: true,
      padding: 86,
    },
  },
  {
    id: "poster-bold",
    name: "Poster Bold",
    patch: {
      fontSize: 82,
      lineHeight: 1.1,
      letterSpacing: 0.85,
      textColor: "#1B1B1B",
      boldMock: true,
      opacity: 1,
      randomness: 45,
      baselineWobble: false,
      padding: 92,
      alignment: "center",
    },
  },
  {
    id: "casual-story",
    name: "Casual Story",
    patch: {
      pagePreset: "story",
      fontSize: 66,
      lineHeight: 1.3,
      letterSpacing: 0.32,
      textColor: "#2E2A24",
      italicMock: true,
      randomness: 78,
      baselineWobble: true,
      padding: 112,
    },
  },
]

const FONT_CANDIDATE_URLS = [
  { type: "woff", url: "/MyHandwriting.woff" },
  { type: "woff", url: "/fonts/MyHandwriting.woff" },
  { type: "woff", url: "/artifacts/MyHandwriting.woff" },
  { type: "ttf", url: "/MyHandwriting.ttf" },
  { type: "ttf", url: "/fonts/MyHandwriting.ttf" },
  { type: "ttf", url: "/artifacts/MyHandwriting.ttf" },
]

const graphemeSegmenter =
  typeof Intl !== "undefined" && Intl.Segmenter
    ? new Intl.Segmenter("th", { granularity: "grapheme" })
    : null

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function segmentGraphemes(text) {
  if (!text) return []
  if (!graphemeSegmenter) return Array.from(text)
  return Array.from(graphemeSegmenter.segment(text), (part) => part.segment)
}

function hashNoise(input) {
  let h = 2166136261
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) / 4294967295) * 2 - 1
}

function buildPreviewLines(text, design) {
  const lines = String(text ?? "").split("\n")
  const intensity = clamp((Number(design.randomness) || 0) / 100, 0, 1)

  return lines.map((lineText, lineIndex) => {
    const clusters = segmentGraphemes(lineText)
    const segments = []
    let previous = ""
    let cycle = 0

    for (let i = 0; i < clusters.length; i += 1) {
      const cluster = clusters[i]
      const isSpace = /^\s+$/.test(cluster)
      if (isSpace) {
        previous = ""
        cycle = 0
        segments.push({
          id: `${lineIndex}-${i}`,
          text: cluster,
          isSpace: true,
          cycle: 0,
          rotate: 0,
          translateY: 0,
          spacingJitter: 0,
        })
        continue
      }

      if (cluster === previous) {
        cycle = (cycle + 1) % 3
      } else {
        cycle = 0
      }
      previous = cluster

      const noise = hashNoise(`${cluster}|${lineIndex}|${i}|${design.seed}`)
      const rotateBase = [0, -1.45, 1.28][cycle]
      const wobbleBase = [0, -0.88, 0.82][cycle]
      const rotate = Number((rotateBase * intensity + noise * 0.48 * intensity).toFixed(3))
      const translateY = design.baselineWobble
        ? Number((wobbleBase * intensity + noise * 0.72 * intensity).toFixed(3))
        : 0
      const spacingJitter = Number((noise * 0.65 * intensity).toFixed(3))

      segments.push({
        id: `${lineIndex}-${i}`,
        text: cluster,
        isSpace: false,
        cycle,
        rotate,
        translateY,
        spacingJitter,
      })
    }

    return segments
  })
}

function resolvePageSize(design) {
  if (design.pagePreset !== "custom") {
    return PAGE_PRESETS[design.pagePreset] ?? PAGE_PRESETS.a4
  }

  const width = clamp(Number(design.customWidth) || 1080, 480, 3000)
  const height = clamp(Number(design.customHeight) || 1440, 640, 4000)
  return { id: "custom", label: `Custom · ${width} × ${height}`, width, height }
}

function loadSavedStyles() {
  try {
    const raw = localStorage.getItem(STYLE_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item) => item && typeof item === "object" && typeof item.name === "string" && item.style)
  } catch {
    return []
  }
}

function pickStyle(design) {
  const style = {}
  for (const key of STYLE_FIELDS) {
    style[key] = design[key]
  }
  return style
}

function makeStyleId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }
  return `style-${Date.now()}-${Math.floor(Math.random() * 100000)}`
}

function historyReducer(state, action) {
  switch (action.type) {
    case "set": {
      const patch = typeof action.patch === "function" ? action.patch(state.present) : action.patch
      const next = { ...state.present, ...(patch ?? {}) }
      const checkpoint = action.checkpoint ?? true
      if (!checkpoint) {
        return { ...state, present: next }
      }
      return {
        past: [...state.past.slice(-79), state.present],
        present: next,
        future: [],
      }
    }

    case "undo": {
      if (state.past.length === 0) return state
      const previous = state.past[state.past.length - 1]
      return {
        past: state.past.slice(0, -1),
        present: previous,
        future: [state.present, ...state.future].slice(0, 80),
      }
    }

    case "redo": {
      if (state.future.length === 0) return state
      const next = state.future[0]
      return {
        past: [...state.past.slice(-79), state.present],
        present: next,
        future: state.future.slice(1),
      }
    }

    case "reset": {
      return {
        past: [...state.past.slice(-79), state.present],
        present: { ...DEFAULT_DESIGN },
        future: [],
      }
    }

    default:
      return state
  }
}

async function fetchArrayBuffer(url) {
  try {
    const res = await fetch(url, { cache: "no-store" })
    if (!res.ok) return null
    return await res.arrayBuffer()
  } catch {
    return null
  }
}

async function discoverFontAssets() {
  let woffBuffer = null
  let ttfBuffer = null
  const loadedFrom = []

  for (const candidate of FONT_CANDIDATE_URLS) {
    if (candidate.type === "woff" && woffBuffer) continue
    if (candidate.type === "ttf" && ttfBuffer) continue

    const buffer = await fetchArrayBuffer(candidate.url)
    if (!buffer) continue

    if (candidate.type === "woff") woffBuffer = buffer
    if (candidate.type === "ttf") ttfBuffer = buffer
    loadedFrom.push(candidate.url)

    if (woffBuffer && ttfBuffer) break
  }

  return { woffBuffer, ttfBuffer, sourceLabel: loadedFrom.join(", ") }
}

function buildCanvasFont(design) {
  const fontStyle = design.italicMock ? "italic" : "normal"
  const fontWeight = design.boldMock ? "700" : "400"
  return `${fontStyle} ${fontWeight} ${design.fontSize}px "${FONT_FAMILY}","TH Sarabun New","Noto Sans Thai",Tahoma,sans-serif`
}

function measureLineWidth(ctx, line, design, extraSpacePerGap = 0) {
  let width = 0
  for (const segment of line) {
    const base = ctx.measureText(segment.text).width
    if (segment.isSpace) {
      width += base + design.letterSpacing + extraSpacePerGap
      continue
    }
    width += base + design.letterSpacing + segment.spacingJitter
  }
  return width
}

function drawDesignToCanvas({ design, previewLines, pageSize, transparent = false }) {
  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1))
  const width = Math.round(pageSize.width)
  const height = Math.round(pageSize.height)

  const canvas = document.createElement("canvas")
  canvas.width = Math.round(width * dpr)
  canvas.height = Math.round(height * dpr)

  const ctx = canvas.getContext("2d")
  ctx.scale(dpr, dpr)

  if (!transparent) {
    ctx.fillStyle = "#ffffff"
    ctx.fillRect(0, 0, width, height)
  } else {
    ctx.clearRect(0, 0, width, height)
  }

  ctx.font = buildCanvasFont(design)
  ctx.textBaseline = "alphabetic"
  ctx.fillStyle = design.textColor
  ctx.globalAlpha = design.opacity

  const maxTextWidth = Math.max(32, width - design.padding * 2)
  const lineHeightPx = design.fontSize * design.lineHeight
  let y = design.padding + design.fontSize

  for (let lineIndex = 0; lineIndex < previewLines.length; lineIndex += 1) {
    const line = previewLines[lineIndex]
    const isJustify = design.alignment === "justify" && lineIndex < previewLines.length - 1
    const spaceCount = isJustify ? line.filter((item) => item.isSpace).length : 0

    const naturalLineWidth = measureLineWidth(ctx, line, design)
    const extraSpacePerGap =
      isJustify && spaceCount > 0
        ? Math.max(0, (maxTextWidth - naturalLineWidth) / spaceCount)
        : 0
    const finalLineWidth = measureLineWidth(ctx, line, design, extraSpacePerGap)

    let x = design.padding
    if (design.alignment === "center") {
      x = (width - finalLineWidth) / 2
    } else if (design.alignment === "right") {
      x = width - design.padding - finalLineWidth
    }

    for (const segment of line) {
      const base = ctx.measureText(segment.text).width

      if (segment.isSpace) {
        x += base + design.letterSpacing + extraSpacePerGap
        continue
      }

      ctx.save()
      ctx.translate(x, y + segment.translateY)
      ctx.rotate((segment.rotate * Math.PI) / 180)

      if (design.italicMock) {
        ctx.transform(1, 0, -0.18, 1, 0, 0)
      }

      ctx.fillText(segment.text, 0, 0)
      if (design.boldMock) {
        ctx.fillText(segment.text, 0.45, 0)
      }
      ctx.restore()

      x += base + design.letterSpacing + segment.spacingJitter
    }

    y += lineHeightPx
    if (y > height - design.padding + lineHeightPx) {
      break
    }
  }

  return canvas
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = fileName
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

function downloadArrayBuffer(buffer, fileName, mimeType) {
  if (!buffer) return
  downloadBlob(new Blob([buffer], { type: mimeType }), fileName)
}

function exportPdfFromCanvas(canvas, pageSizeLabel) {
  const imageData = canvas.toDataURL("image/png")
  const iframe = document.createElement("iframe")
  iframe.setAttribute(
    "style",
    "position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none"
  )
  iframe.setAttribute("aria-hidden", "true")
  document.body.appendChild(iframe)

  const doc = iframe.contentDocument
  const win = iframe.contentWindow
  if (!doc || !win) {
    iframe.remove()
    return
  }

  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>MyHandwriting Preview</title>
<style>
  @page { size: auto; margin: 8mm; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body { display: flex; align-items: center; justify-content: center; min-height: 100vh; }
  img { width: 100%; max-width: 100%; height: auto; box-shadow: 0 2px 12px rgba(0,0,0,.12); }
  .meta { position: fixed; top: 6mm; left: 8mm; font: 11px sans-serif; color: #666; }
</style>
</head>
<body>
  <div class="meta">${pageSizeLabel}</div>
  <img src="${imageData}" alt="preview" />
</body>
</html>`

  doc.open()
  doc.write(html)
  doc.close()

  const cleanup = () => iframe.remove()
  const runPrint = () => {
    try {
      win.focus()
      win.print()
    } finally {
      win.addEventListener("afterprint", cleanup, { once: true })
      setTimeout(cleanup, 120000)
    }
  }
  setTimeout(runPrint, 220)
}

function SidebarCard({ title, subtitle, children }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
        {subtitle ? <p className="mt-1 text-xs text-slate-500">{subtitle}</p> : null}
      </div>
      {children}
    </section>
  )
}

function FieldLabel({ children, value }) {
  return (
    <div className="mb-1 flex items-center justify-between">
      <span className="text-xs font-semibold text-slate-600">{children}</span>
      {value != null ? <span className="text-xs text-slate-500">{value}</span> : null}
    </div>
  )
}

function AlignmentButton({ active, onClick, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex h-9 flex-1 items-center justify-center rounded-xl border text-xs font-semibold transition ${
        active
          ? "border-slate-900 bg-slate-900 text-white"
          : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
      }`}
    >
      {label}
    </button>
  )
}

export default function Step5({ versionedGlyphs = [], extractedGlyphs = [] }) {
  const [historyState, dispatch] = useReducer(historyReducer, {
    past: [],
    present: { ...DEFAULT_DESIGN },
    future: [],
  })

  const [zoom, setZoom] = useState(0.88)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [savedStyles, setSavedStyles] = useState(() => loadSavedStyles())
  const [styleNameDraft, setStyleNameDraft] = useState("")
  const [fontState, setFontState] = useState({
    status: "loading",
    message: "Loading MyHandwriting.ttf/.woff...",
  })
  const [fontAssets, setFontAssets] = useState({
    woffBuffer: null,
    ttfBuffer: null,
    sourceLabel: "",
  })

  const design = historyState.present
  const stageRef = useRef(null)
  const fontInputRef = useRef(null)
  const fontBlobUrlsRef = useRef({ woffUrl: null, ttfUrl: null })

  const setDesign = useCallback((patch, options = {}) => {
    dispatch({
      type: "set",
      patch,
      checkpoint: options.checkpoint ?? true,
    })
  }, [])

  const canUndo = historyState.past.length > 0
  const canRedo = historyState.future.length > 0

  const pageSize = useMemo(() => resolvePageSize(design), [design])

  const previewLines = useMemo(
    () => buildPreviewLines(design.text, design),
    [design]
  )

  const hasGlyphSource = versionedGlyphs.length > 0 || extractedGlyphs.length > 0
  const glyphSourceLabel =
    versionedGlyphs.length > 0
      ? `Versioned glyphs (${versionedGlyphs.length})`
      : `Extracted glyphs (${extractedGlyphs.length})`

  const wordCount = useMemo(() => {
    const trimmed = design.text.trim()
    if (!trimmed) return 0
    return trimmed.split(/\s+/).filter(Boolean).length
  }, [design.text])

  const applyFontBuffers = useCallback(async ({ woffBuffer, ttfBuffer, sourceLabel }) => {
    if (!woffBuffer && !ttfBuffer) return false

    const oldUrls = fontBlobUrlsRef.current
    if (oldUrls.woffUrl) URL.revokeObjectURL(oldUrls.woffUrl)
    if (oldUrls.ttfUrl) URL.revokeObjectURL(oldUrls.ttfUrl)

    const woffUrl = woffBuffer
      ? URL.createObjectURL(new Blob([woffBuffer], { type: "font/woff" }))
      : null
    const ttfUrl = ttfBuffer
      ? URL.createObjectURL(new Blob([ttfBuffer], { type: "font/ttf" }))
      : null

    const src = []
    if (woffUrl) src.push(`url("${woffUrl}") format("woff")`)
    if (ttfUrl) src.push(`url("${ttfUrl}") format("truetype")`)
    if (src.length === 0) return false

    let styleTag = document.getElementById(FONT_STYLE_ID)
    if (!styleTag) {
      styleTag = document.createElement("style")
      styleTag.id = FONT_STYLE_ID
      document.head.appendChild(styleTag)
    }
    styleTag.textContent = `@font-face{
  font-family:"${FONT_FAMILY}";
  src:${src.join(",")};
  font-display:swap;
  font-style:normal;
  font-weight:100 900;
}`

    try {
      await document.fonts.load(`48px "${FONT_FAMILY}"`)
      await document.fonts.ready
      fontBlobUrlsRef.current = { woffUrl, ttfUrl }
      setFontAssets({ woffBuffer, ttfBuffer, sourceLabel })
      return true
    } catch {
      if (woffUrl) URL.revokeObjectURL(woffUrl)
      if (ttfUrl) URL.revokeObjectURL(ttfUrl)
      return false
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    const bootstrap = async () => {
      setFontState({
        status: "loading",
        message: "Loading MyHandwriting.ttf/.woff...",
      })

      const discovered = await discoverFontAssets()
      if (cancelled) return

      if (!discovered.woffBuffer && !discovered.ttfBuffer) {
        setFontState({
          status: "missing",
          message: "MyHandwriting font not found. Upload .woff/.ttf from Step 4.",
        })
        return
      }

      const ok = await applyFontBuffers(discovered)
      if (cancelled) return

      if (ok) {
        const sourceLabel = discovered.sourceLabel || "auto source"
        setFontState({
          status: "ready",
          message: `MyHandwriting loaded (${sourceLabel})`,
        })
      } else {
        setFontState({
          status: "error",
          message: "Failed to register MyHandwriting font.",
        })
      }
    }

    bootstrap()

    return () => {
      cancelled = true
    }
  }, [applyFontBuffers])

  useEffect(() => {
    return () => {
      const urls = fontBlobUrlsRef.current
      if (urls.woffUrl) URL.revokeObjectURL(urls.woffUrl)
      if (urls.ttfUrl) URL.revokeObjectURL(urls.ttfUrl)
    }
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(STYLE_STORAGE_KEY, JSON.stringify(savedStyles))
    } catch {
      // Ignore storage failures.
    }
  }, [savedStyles])

  const drawCanvas = useCallback(
    (transparent = false) =>
      drawDesignToCanvas({
        design,
        previewLines,
        pageSize,
        transparent,
      }),
    [design, previewLines, pageSize]
  )

  const handleExportPng = useCallback(() => {
    const canvas = drawCanvas(false)
    canvas.toBlob((blob) => {
      if (!blob) return
      downloadBlob(blob, "MyHandwriting-preview.png")
    }, "image/png")
  }, [drawCanvas])

  const handleExportTransparentPng = useCallback(() => {
    const canvas = drawCanvas(true)
    canvas.toBlob((blob) => {
      if (!blob) return
      downloadBlob(blob, "MyHandwriting-preview-transparent.png")
    }, "image/png")
  }, [drawCanvas])

  const handleExportPdf = useCallback(() => {
    const canvas = drawCanvas(false)
    exportPdfFromCanvas(canvas, pageSize.label)
  }, [drawCanvas, pageSize.label])

  const handleDownloadFont = useCallback(() => {
    if (!fontAssets.woffBuffer && !fontAssets.ttfBuffer) {
      setFontState({
        status: "missing",
        message: "No font buffer loaded yet. Import MyHandwriting.ttf/.woff first.",
      })
      return
    }

    if (fontAssets.woffBuffer) {
      downloadArrayBuffer(fontAssets.woffBuffer, "MyHandwriting.woff", "font/woff")
    }
    if (fontAssets.ttfBuffer) {
      setTimeout(() => {
        downloadArrayBuffer(fontAssets.ttfBuffer, "MyHandwriting.ttf", "font/ttf")
      }, fontAssets.woffBuffer ? 180 : 0)
    }
  }, [fontAssets])

  const handleSaveDesignJson = useCallback(() => {
    const payload = {
      version: DESIGN_FILE_VERSION,
      savedAt: new Date().toISOString(),
      pageSize,
      glyphSource: {
        versioned: versionedGlyphs.length,
        extracted: extractedGlyphs.length,
      },
      design,
    }
    downloadBlob(
      new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }),
      "MyHandwriting-design.json"
    )
  }, [design, pageSize, versionedGlyphs.length, extractedGlyphs.length])

  const handleToggleFullscreen = useCallback(async () => {
    const node = stageRef.current
    if (!node) return
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen()
      } else if (node.requestFullscreen) {
        await node.requestFullscreen()
      }
    } catch {
      // Ignore fullscreen errors.
    }
  }, [])

  const handleUploadFonts = useCallback(async (event) => {
    const files = Array.from(event.target.files ?? [])
    if (files.length === 0) return

    setFontState({
      status: "loading",
      message: "Importing selected font files...",
    })

    let woffBuffer = null
    let ttfBuffer = null
    for (const file of files) {
      const lower = file.name.toLowerCase()
      if (!lower.endsWith(".woff") && !lower.endsWith(".ttf")) continue
      const buffer = await file.arrayBuffer()
      if (lower.endsWith(".woff")) woffBuffer = buffer
      if (lower.endsWith(".ttf")) ttfBuffer = buffer
    }

    if (!woffBuffer && !ttfBuffer) {
      setFontState({
        status: "error",
        message: "Only .woff or .ttf files are supported.",
      })
      event.target.value = ""
      return
    }

    const sourceLabel = files.map((file) => file.name).join(", ")
    const ok = await applyFontBuffers({ woffBuffer, ttfBuffer, sourceLabel })
    if (ok) {
      setFontState({
        status: "ready",
        message: `MyHandwriting loaded (${sourceLabel})`,
      })
    } else {
      setFontState({
        status: "error",
        message: "Failed to register the selected font files.",
      })
    }
    event.target.value = ""
  }, [applyFontBuffers])

  const applyTemplate = (template) => {
    setDesign({
      text: template.text,
      seed: design.seed + 1,
    })
  }

  const applyPreset = (preset) => {
    setDesign({
      ...preset.patch,
      seed: design.seed + 1,
    })
  }

  const saveCurrentStyle = () => {
    const name = styleNameDraft.trim() || `Style ${savedStyles.length + 1}`
    const style = pickStyle(design)
    const nextStyle = { id: makeStyleId(), name, style }
    setSavedStyles((prev) => [nextStyle, ...prev].slice(0, 14))
    setStyleNameDraft("")
  }

  const applySavedStyle = (item) => {
    if (!item?.style) return
    setDesign({
      ...item.style,
      seed: design.seed + 1,
    })
  }

  const removeSavedStyle = (id) => {
    setSavedStyles((prev) => prev.filter((item) => item.id !== id))
  }

  return (
    <div ref={stageRef} className="step5-smart flex h-full min-h-[640px] flex-col gap-3 bg-transparent p-3 md:p-4">
      <Step5Toolbar
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={() => dispatch({ type: "undo" })}
        onRedo={() => dispatch({ type: "redo" })}
        onReset={() => dispatch({ type: "reset" })}
        onExportPng={handleExportPng}
        onExportTransparentPng={handleExportTransparentPng}
        onExportPdf={handleExportPdf}
        onDownloadFont={handleDownloadFont}
        onSaveDesignJson={handleSaveDesignJson}
        onToggleFullscreen={handleToggleFullscreen}
        fontState={fontState}
      />

      <input
        ref={fontInputRef}
        type="file"
        accept=".woff,.ttf,font/woff,font/ttf"
        multiple
        className="hidden"
        onChange={handleUploadFonts}
      />

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 xl:grid-cols-[290px_minmax(0,1fr)_330px]">
        <aside className="step5-scroll flex min-h-0 flex-col gap-3 overflow-y-auto pb-1">
          <SidebarCard title="Template Library" subtitle="Quick starter copy for instant previews">
            <div className="grid gap-2">
              {TEMPLATE_ITEMS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => applyTemplate(item)}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                >
                  {item.name}
                </button>
              ))}
            </div>
          </SidebarCard>

          <SidebarCard title="Style Presets" subtitle="Canva-like one-click looks">
            <div className="grid gap-2">
              {STYLE_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => applyPreset(preset)}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                >
                  {preset.name}
                </button>
              ))}
            </div>
          </SidebarCard>

          <SidebarCard title="Export Options" subtitle="Production-ready output set">
            <div className="grid gap-2">
              <button
                type="button"
                onClick={handleExportPng}
                className="h-9 rounded-xl border border-slate-900 bg-slate-900 px-3 text-xs font-semibold text-white transition hover:bg-slate-700"
              >
                Download PNG
              </button>
              <button
                type="button"
                onClick={handleExportTransparentPng}
                className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
              >
                Transparent PNG
              </button>
              <button
                type="button"
                onClick={handleExportPdf}
                className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
              >
                Download PDF
              </button>
              <button
                type="button"
                onClick={handleDownloadFont}
                className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
              >
                Download Font Files
              </button>
              <button
                type="button"
                onClick={handleSaveDesignJson}
                className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
              >
                Save Design JSON
              </button>
            </div>
          </SidebarCard>

          <SidebarCard title="Saved Styles" subtitle="Keep your favorite visual presets">
            <div className="mb-2 flex gap-2">
              <input
                type="text"
                value={styleNameDraft}
                onChange={(event) => setStyleNameDraft(event.target.value)}
                placeholder="Style name"
                className="h-9 flex-1 rounded-xl border border-slate-200 px-3 text-xs font-medium text-slate-700 outline-none transition focus:border-slate-400"
              />
              <button
                type="button"
                onClick={saveCurrentStyle}
                className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
              >
                Save
              </button>
            </div>
            <div className="grid gap-2">
              {savedStyles.length === 0 ? (
                <p className="rounded-xl border border-dashed border-slate-200 px-3 py-3 text-xs text-slate-500">
                  No saved styles yet.
                </p>
              ) : (
                savedStyles.map((item) => (
                  <div key={item.id} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-2">
                    <button
                      type="button"
                      onClick={() => applySavedStyle(item)}
                      className="flex-1 rounded-lg px-2 py-1 text-left text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                    >
                      {item.name}
                    </button>
                    <button
                      type="button"
                      onClick={() => removeSavedStyle(item.id)}
                      className="rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-500 transition hover:border-slate-300 hover:bg-slate-50"
                    >
                      Delete
                    </button>
                  </div>
                ))
              )}
            </div>
          </SidebarCard>
        </aside>

        <Step5Preview
          design={design}
          setDesign={setDesign}
          pageSize={pageSize}
          previewLines={previewLines}
          zoom={zoom}
          setZoom={setZoom}
          pan={pan}
          setPan={setPan}
          fontState={fontState}
          onToggleFullscreen={handleToggleFullscreen}
        />

        <aside className="step5-scroll flex min-h-0 flex-col gap-3 overflow-y-auto pb-1">
          <SidebarCard title="Text Input" subtitle="Thai, English, numbers, symbols and multiline">
            <textarea
              value={design.text}
              onChange={(event) => setDesign({ text: event.target.value })}
              className="min-h-[180px] w-full resize-y rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-slate-400"
              placeholder="Type here..."
            />
            <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-slate-500">
              <span>Words: {wordCount}</span>
              <span className="text-right">Chars: {design.text.length}</span>
            </div>
          </SidebarCard>

          <SidebarCard title="Text Controls" subtitle="Canva style live control panel">
            <div className="space-y-3">
              <div>
                <FieldLabel value={`${design.fontSize}px`}>Font Size</FieldLabel>
                <input
                  type="range"
                  min={24}
                  max={140}
                  step={1}
                  value={design.fontSize}
                  onChange={(event) => setDesign({ fontSize: Number(event.target.value) })}
                  className="w-full accent-slate-700"
                />
              </div>

              <div>
                <FieldLabel value={design.lineHeight.toFixed(2)}>Line Height</FieldLabel>
                <input
                  type="range"
                  min={0.85}
                  max={2.2}
                  step={0.01}
                  value={design.lineHeight}
                  onChange={(event) => setDesign({ lineHeight: Number(event.target.value) })}
                  className="w-full accent-slate-700"
                />
              </div>

              <div>
                <FieldLabel value={design.letterSpacing.toFixed(2)}>Letter Spacing</FieldLabel>
                <input
                  type="range"
                  min={-1}
                  max={4}
                  step={0.01}
                  value={design.letterSpacing}
                  onChange={(event) => setDesign({ letterSpacing: Number(event.target.value) })}
                  className="w-full accent-slate-700"
                />
              </div>

              <div>
                <FieldLabel value={design.textColor}>Text Color</FieldLabel>
                <input
                  type="color"
                  value={design.textColor}
                  onChange={(event) => setDesign({ textColor: event.target.value })}
                  className="h-9 w-full cursor-pointer rounded-xl border border-slate-200 bg-white p-1"
                />
              </div>

              <div>
                <FieldLabel value={`${Math.round(design.opacity * 100)}%`}>Opacity</FieldLabel>
                <input
                  type="range"
                  min={0.15}
                  max={1}
                  step={0.01}
                  value={design.opacity}
                  onChange={(event) => setDesign({ opacity: Number(event.target.value) })}
                  className="w-full accent-slate-700"
                />
              </div>

              <div>
                <FieldLabel>Alignment</FieldLabel>
                <div className="flex gap-2">
                  <AlignmentButton
                    label="Left"
                    active={design.alignment === "left"}
                    onClick={() => setDesign({ alignment: "left" })}
                  />
                  <AlignmentButton
                    label="Center"
                    active={design.alignment === "center"}
                    onClick={() => setDesign({ alignment: "center" })}
                  />
                  <AlignmentButton
                    label="Right"
                    active={design.alignment === "right"}
                    onClick={() => setDesign({ alignment: "right" })}
                  />
                  <AlignmentButton
                    label="Justify"
                    active={design.alignment === "justify"}
                    onClick={() => setDesign({ alignment: "justify" })}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setDesign({ boldMock: !design.boldMock })}
                  className={`h-9 rounded-xl border text-xs font-semibold transition ${
                    design.boldMock
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
                  }`}
                >
                  Bold Mock
                </button>
                <button
                  type="button"
                  onClick={() => setDesign({ italicMock: !design.italicMock })}
                  className={`h-9 rounded-xl border text-xs font-semibold transition ${
                    design.italicMock
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
                  }`}
                >
                  Italic Mock
                </button>
              </div>

              <div>
                <FieldLabel value={`${Math.round(design.randomness)}%`}>Randomness Intensity</FieldLabel>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={design.randomness}
                  onChange={(event) => setDesign({ randomness: Number(event.target.value) })}
                  className="w-full accent-slate-700"
                />
              </div>

              <div>
                <FieldLabel value={`${design.padding}px`}>Page Padding</FieldLabel>
                <input
                  type="range"
                  min={32}
                  max={180}
                  step={1}
                  value={design.padding}
                  onChange={(event) => setDesign({ padding: Number(event.target.value) })}
                  className="w-full accent-slate-700"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setDesign({ baselineWobble: !design.baselineWobble })}
                  className={`h-9 rounded-xl border text-xs font-semibold transition ${
                    design.baselineWobble
                      ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                      : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
                  }`}
                >
                  Baseline Wobble
                </button>
                <button
                  type="button"
                  onClick={() => setDesign({ seed: design.seed + 1 })}
                  className="h-9 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                >
                  Shuffle Variants
                </button>
              </div>
            </div>
          </SidebarCard>

          <SidebarCard title="Font Loader" subtitle="Step 4 output integration">
            <div className="space-y-2 text-xs text-slate-600">
              <p>
                Auto search paths:
                <br />
                <code className="rounded bg-slate-100 px-1 py-0.5 text-[11px]">/MyHandwriting.woff</code>
                {" · "}
                <code className="rounded bg-slate-100 px-1 py-0.5 text-[11px]">/MyHandwriting.ttf</code>
              </p>
              <button
                type="button"
                onClick={() => fontInputRef.current?.click()}
                className="h-9 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
              >
                Upload MyHandwriting Files
              </button>
              <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
                {fontState.message}
              </p>
            </div>
          </SidebarCard>

          <SidebarCard title="Project Data" subtitle="Wizard continuity check">
            <div className="space-y-1 text-xs text-slate-600">
              <p>Glyph source: {hasGlyphSource ? glyphSourceLabel : "No glyphs yet"}</p>
              <p>Preview size: {pageSize.width} × {pageSize.height}</p>
              <p>Zoom: {Math.round(zoom * 100)}%</p>
            </div>
          </SidebarCard>
        </aside>
      </div>
    </div>
  )
}
