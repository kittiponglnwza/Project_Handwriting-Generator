import { useMemo, useRef, useState } from "react"

const ZOOM_MIN = 0.25
const ZOOM_MAX = 2.8

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v))
}

function PreviewGlyph({ segment, letterSpacing, italicMock, boldMock }) {
  if (segment.isSpace) {
    return (
      <span style={{ whiteSpace: "pre" }}>
        {segment.text}
      </span>
    )
  }

  const spacing = letterSpacing + segment.spacingJitter
  const transform = `translateY(${segment.translateY}px) rotate(${segment.rotate}deg)${italicMock ? " skewX(-7deg)" : ""}`

  return (
    <span
      className="inline-block origin-bottom align-baseline"
      style={{
        transform,
        marginRight: `${spacing}px`,
        textShadow: boldMock ? "0.45px 0 0 currentColor, 0.9px 0 0 currentColor" : "none",
      }}
    >
      {segment.text}
    </span>
  )
}

function PreviewPaper({ design, previewLines, pageSize }) {
  const textStyle = useMemo(() => {
    const textAlign = design.alignment === "justify" ? "justify" : design.alignment
    return {
      fontFamily: `"MyHandwriting","TH Sarabun New","Noto Sans Thai",Tahoma,sans-serif`,
      fontSize: `${design.fontSize}px`,
      lineHeight: design.lineHeight,
      color: design.textColor,
      opacity: design.opacity,
      textAlign,
      fontFeatureSettings: `"salt" 1, "calt" 1, "liga" 1`,
      fontKerning: "normal",
      WebkitFontSmoothing: "antialiased",
      textRendering: "optimizeLegibility",
      wordBreak: "break-word",
      overflowWrap: "anywhere",
    }
  }, [design])

  return (
    <div
      className="relative overflow-hidden rounded-[26px] border border-slate-200 bg-white shadow-[0_18px_55px_rgba(15,23,42,0.22)]"
      style={{ width: pageSize.width, height: pageSize.height }}
    >
      <div style={{ padding: `${design.padding}px`, height: "100%", boxSizing: "border-box" }}>
        <div style={textStyle}>
          {previewLines.map((line, lineIndex) => (
            <div key={`line-${lineIndex}`} className="min-h-[1em]">
              {line.length === 0 ? (
                <span>&nbsp;</span>
              ) : (
                line.map((segment) => (
                  <PreviewGlyph
                    key={segment.id}
                    segment={segment}
                    letterSpacing={design.letterSpacing}
                    italicMock={design.italicMock}
                    boldMock={design.boldMock}
                  />
                ))
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function Step5Preview({
  design,
  setDesign,
  pageSize,
  previewLines,
  zoom,
  setZoom,
  pan,
  setPan,
  fontState,
  onToggleFullscreen,
}) {
  const viewportRef = useRef(null)
  const dragStateRef = useRef(null)
  const [isDragging, setIsDragging] = useState(false)

  const updateZoom = (nextZoom) => {
    setZoom(clamp(nextZoom, ZOOM_MIN, ZOOM_MAX))
  }

  const resetView = () => {
    setPan({ x: 0, y: 0 })
    setZoom(1)
  }

  const fitToViewport = () => {
    const viewport = viewportRef.current
    if (!viewport) return
    const safeWidth = Math.max(1, viewport.clientWidth - 120)
    const safeHeight = Math.max(1, viewport.clientHeight - 120)
    const scale = Math.min(safeWidth / pageSize.width, safeHeight / pageSize.height)
    updateZoom(scale)
    setPan({ x: 0, y: 0 })
  }

  const onPointerDown = (event) => {
    if (event.button !== 0) return
    const target = event.currentTarget
    target.setPointerCapture(event.pointerId)
    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      panX: pan.x,
      panY: pan.y,
    }
    setIsDragging(true)
  }

  const onPointerMove = (event) => {
    const state = dragStateRef.current
    if (!state || event.pointerId !== state.pointerId) return
    const dx = event.clientX - state.startX
    const dy = event.clientY - state.startY
    setPan({ x: state.panX + dx, y: state.panY + dy })
  }

  const onPointerUp = (event) => {
    const state = dragStateRef.current
    if (!state || event.pointerId !== state.pointerId) return
    event.currentTarget.releasePointerCapture(event.pointerId)
    dragStateRef.current = null
    setIsDragging(false)
  }

  const onWheel = (event) => {
    if (!event.ctrlKey && !event.metaKey) return
    event.preventDefault()
    const delta = event.deltaY > 0 ? -0.07 : 0.07
    updateZoom(zoom + delta)
  }

  const isCustomSize = design.pagePreset === "custom"

  return (
    <section className="step5-card relative flex min-h-0 flex-col overflow-hidden rounded-2xl border border-white/70 bg-white/80 shadow-sm backdrop-blur">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200/80 px-3 py-3 md:px-4">
        <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
          Canvas
        </span>

        <select
          value={design.pagePreset}
          onChange={(event) => setDesign({ pagePreset: event.target.value })}
          className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 outline-none transition focus:border-slate-400"
        >
          <option value="a4">A4 (794×1123)</option>
          <option value="square">Square (1080×1080)</option>
          <option value="story">Story (1080×1920)</option>
          <option value="custom">Custom</option>
        </select>

        {isCustomSize && (
          <>
            <input
              type="number"
              min={480}
              max={3000}
              value={design.customWidth}
              onChange={(event) => setDesign({ customWidth: Number(event.target.value) || 480 })}
              className="h-9 w-24 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 outline-none transition focus:border-slate-400"
            />
            <input
              type="number"
              min={640}
              max={4000}
              value={design.customHeight}
              onChange={(event) => setDesign({ customHeight: Number(event.target.value) || 640 })}
              className="h-9 w-24 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 outline-none transition focus:border-slate-400"
            />
          </>
        )}

        <div className="mx-1 h-6 w-px bg-slate-200" />

        <button
          type="button"
          onClick={() => updateZoom(zoom - 0.1)}
          className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
        >
          -
        </button>
        <span className="min-w-[64px] text-center text-xs font-semibold text-slate-600">
          {Math.round(zoom * 100)}%
        </span>
        <button
          type="button"
          onClick={() => updateZoom(zoom + 0.1)}
          className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
        >
          +
        </button>
        <button
          type="button"
          onClick={fitToViewport}
          className="inline-flex h-9 items-center justify-center rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
        >
          Fit
        </button>
        <button
          type="button"
          onClick={resetView}
          className="inline-flex h-9 items-center justify-center rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
        >
          Center
        </button>

        <div className="ml-auto flex items-center gap-2">
          <span className="hidden rounded-full bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-500 sm:inline-flex">
            {pageSize.label}
          </span>
          <button
            type="button"
            onClick={onToggleFullscreen}
            className="inline-flex h-9 items-center justify-center rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
          >
            Fullscreen
          </button>
        </div>
      </div>

      <div
        ref={viewportRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
        className="relative flex-1 overflow-hidden bg-[radial-gradient(circle_at_20%_20%,rgba(148,163,184,0.18),rgba(241,245,249,0.65)_34%,rgba(226,232,240,0.9)_100%)]"
        style={{ cursor: isDragging ? "grabbing" : "grab" }}
      >
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-slate-300/50" />
          <div className="absolute top-1/2 left-0 h-px w-full -translate-y-1/2 bg-slate-300/50" />
        </div>

        <div
          className="absolute left-1/2 top-1/2"
          style={{
            transform: `translate(calc(-50% + ${pan.x}px), calc(-50% + ${pan.y}px)) scale(${zoom})`,
            transformOrigin: "center center",
          }}
        >
          <div className="relative">
            <PreviewPaper design={design} previewLines={previewLines} pageSize={pageSize} />
          </div>
        </div>

        {fontState.status !== "ready" && (
          <div className="pointer-events-none absolute left-4 bottom-4 rounded-xl border border-amber-200 bg-amber-50/95 px-3 py-2 text-xs font-medium text-amber-700 shadow-sm">
            Preview is using fallback fonts until MyHandwriting loads.
          </div>
        )}
      </div>
    </section>
  )
}
