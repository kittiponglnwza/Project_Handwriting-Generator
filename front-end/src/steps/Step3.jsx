/**
 * Step3 – Preview / Adjust / Validate
 *
 * ARCHITECTURE ROLE: Pure consumer + glyph extractor.
 *
 * Props:
 *   parsedFile  – from appState.parsedFile (set by Step 2)
 *                 Shape: { file, characters, charSource, metadata, pages, status }
 *   onGlyphsUpdate(glyphs[]) – called whenever extracted glyphs change
 *
 * REMOVED:
 *   - selected (was Step 1 fallback – gone)
 *   - pdfFile  (PDF is NEVER re-read here)
 *   - templateChars (was Step 1 fallback – gone)
 *   - fallbackChars useMemo chain
 *   - getDocument() / loadingTask – all PDF I/O moved to Step 2
 *
 * Step 3 uses parsedFile.pages (pre-rendered canvases from Step 2)
 * to extract glyphs via glyphPipeline. No network/file I/O needed.
 */
import { useEffect, useMemo, useRef, useState, useCallback } from "react"
import Btn from "../components/Btn"
import InfoBox from "../components/InfoBox"
import C from "../styles/colors"
import { buildAutoPageProfiles } from "../domains/glyph-extraction/pipeline/calibration.js"
import { getGridGeometry, traceAllGlyphs } from "../domains/glyph-extraction/pipeline/glyphPipeline.js"
import {
  ZERO_CALIBRATION,
} from "../domains/glyph-extraction/constants.js"
import { Adjuster, GridDebugOverlay, PageDebugOverlay } from "./step3/Step3Panels.jsx"
import DebugOverlay from "../components/DebugOverlay.jsx"

// NEW: Engine imports
import { PipelineStateMachine, PipelineStates } from "../engine/PipelineStateMachine.js"
import { Telemetry } from "../engine/Telemetry.js"
import { PerformanceGovernor } from "../engine/PerformanceGovernor.js"

// NEW: Vision Engine imports
import { VisionEngine } from "../domains/glyph-extraction/vision/VisionEngine.js"
import QADashboard from "../components/QADashboard.jsx"


// ── Inject skeleton shimmer keyframe once ──────────────────────────────────────
if (typeof document !== "undefined" && !document.getElementById("step3-skeleton-kf")) {
  const s = document.createElement("style")
  s.id = "step3-skeleton-kf"
  s.textContent = `
    @keyframes skeletonShimmer {
      0%   { background-position: -400px 0 }
      100% { background-position:  400px 0 }
    }
  `
  document.head.appendChild(s)
}

// ── SkeletonCard — single shimmer placeholder ──────────────────────────────────
function SkeletonCard() {
  const shimmer = {
    background: "linear-gradient(90deg, #f0ede8 25%, #e8e4de 50%, #f0ede8 75%)",
    backgroundSize: "800px 100%",
    animation: "skeletonShimmer 1.4s ease-in-out infinite",
    borderRadius: 8,
  }
  return (
    <div style={{
      background: "#f7f5f0",
      border: "1.5px solid #e8e4de",
      borderRadius: 12,
      padding: "8px 6px",
      display: "flex",
      flexDirection: "column",
      gap: 6,
      alignItems: "center",
    }}>
      {/* image placeholder */}
      <div style={{ width: "100%", aspectRatio: "1", borderRadius: 8, ...shimmer }} />
      {/* character label */}
      <div style={{ width: "40%", height: 10, borderRadius: 4, ...shimmer }} />
      {/* index label */}
      <div style={{ width: "60%", height: 8, borderRadius: 4, ...shimmer }} />
      {/* status label */}
      <div style={{ width: "50%", height: 8, borderRadius: 4, ...shimmer }} />
    </div>
  )
}

// ── SkeletonGrid — shows N skeleton cards while loading ────────────────────────
function SkeletonGrid({ count = 20, label = "Extracting glyphs…" }) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <div style={{
          width: 16, height: 16, borderRadius: "50%",
          border: "2px solid #c8c0b0",
          borderTopColor: "#6b5e45",
          animation: "skeletonShimmer 0.8s linear infinite",
          flexShrink: 0,
        }} />
        <span style={{ fontSize: 12, color: "#9e9278" }}>{label}</span>
      </div>
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(88px, 1fr))",
        gap: 8,
        marginBottom: 20,
      }}>
        {Array.from({ length: count }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    </div>
  )
}

export default function Step3({ parsedFile, onGlyphsUpdate = () => {}, pipelineMachine = null }) {
  const chars = parsedFile?.characters ?? []

  // NEW: State machine integration
  const [pipelineState, setPipelineState] = useState(PipelineStates.IDLE)
  const [pipelineContext, setPipelineContext] = useState({})
  const [error, setError] = useState("")
  const [activeId, setActiveId] = useState(null)
  const [zoomGlyph, setZoomGlyph] = useState(null)
  const [removedIds, setRemovedIds] = useState(() => new Set())
  const [calibration, setCalibration] = useState(ZERO_CALIBRATION)
  const [autoAligning, setAutoAligning] = useState(false)
  const [autoInfo, setAutoInfo] = useState("")
  const [showDebug, setShowDebug] = useState(false)
  const [showOverlay, setShowOverlay] = useState(false)
  const [tracedGlyphs, setTracedGlyphs] = useState([])
  const [telemetryData, setTelemetryData] = useState({})
  const [pageVersion, setPageVersion] = useState(0)
  const [tracing, setTracing] = useState(false)
  const [visionEngineResults, setVisionEngineResults] = useState(null)
  const [showQADashboard, setShowQADashboard] = useState(false)
  const [glyphOffsets, setGlyphOffsets] = useState({}) // { [glyphId]: {x, y} }

  const pageRef = useRef(null)
  const stateMachineRef = useRef(null)
  const visionEngineRef = useRef(null)

  // ── Initialize state machine (singleton – mount once) ───
  useEffect(() => {
    // Guard: ถ้า refs ถูก set แล้ว (HMR / StrictMode double-invoke) ไม่ต้อง re-create
    if (stateMachineRef.current) return

    const stateMachine  = pipelineMachine ?? new PipelineStateMachine()
    const current = stateMachine.getCurrentState()
    setPipelineState(current.state)
    setPipelineContext(current.context)
    // Subscribe to state changes
    const unsubscribe = stateMachine.subscribe({
      onStateChange: (newState, oldState, context) => {
        setPipelineState(newState)
        setPipelineContext(context)
        setError('') // Clear errors on state change
      }
    })
    
    // Subscribe to telemetry
    const telemetryUnsubscribe = Telemetry.subscribe((metricName, data, aggregates) => {
      setTelemetryData(prev => ({
        ...prev,
        [metricName]: aggregates
      }))
    })
    
    stateMachineRef.current  = stateMachine
    
    // Initialize Vision Engine with error handling
    try {
      visionEngineRef.current = new VisionEngine()
    } catch (error) {
      console.error('Failed to initialize Vision Engine:', error)
      setError(`Vision Engine initialization failed: ${error.message}`)
    }
    
    return () => {
      unsubscribe()
      telemetryUnsubscribe()
      visionEngineRef.current?.reset()
      // Reset refs on true unmount so they can be re-initialized if component remounts
      stateMachineRef.current  = null
      visionEngineRef.current  = null
    }
  }, [pipelineMachine])

  // ── Load page data from parsedFile (no PDF I/O) ────────────────────────────
  useEffect(() => {
    if (!parsedFile?.pages?.length) {
      pageRef.current = null
      setPageVersion(0)
      setError("")
      setActiveId(null)
      setZoomGlyph(null)
      setRemovedIds(new Set())
      setCalibration(ZERO_CALIBRATION)
      setAutoInfo("")
      return
    }

    // Pages were already rendered and profiled by Step 2.
    // Re-run autoPageProfiles with the known characters to set grid geometry.
    try {
      const profiledPages = buildAutoPageProfiles(parsedFile.pages, chars)
      const avgScore = profiledPages.length > 0
        ? profiledPages.reduce((sum, p) => sum + (Number.isFinite(p.autoScore) ? p.autoScore : 0), 0) / profiledPages.length
        : NaN
      const anchorPages     = profiledPages.filter(p => p.autoSource === "anchor").length
      const codeAnchorPages = profiledPages.filter(p => p.hasCodeAnchors).length

      pageRef.current = { pages: profiledPages, totalPages: profiledPages.length }
      setAutoInfo(
        Number.isFinite(avgScore)
          ? `Auto aligned ${profiledPages.length} page(s) — targets ${chars.length}, anchored ${anchorPages}, code ${codeAnchorPages}, avg score ${avgScore.toFixed(1)}`
          : `Auto aligned ${profiledPages.length} page(s) — anchored ${anchorPages}, code ${codeAnchorPages}`
      )
      setPageVersion(v => v + 1)
      setError("")
    } catch (err) {
      setError(err?.message ?? "Failed to load glyphs")
      stateMachineRef.current?.transition(PipelineStates.ERROR, { error: err.message })
    }
  }, [parsedFile, chars.length])

  // NEW: Vision Engine handler (production quality extraction)
  const handleVisionEngineExtraction = useCallback(async () => {
    
    if (!pageRef.current?.pages || !visionEngineRef.current) {
      console.error('Vision Engine extraction aborted: missing pages or engine')
      return
    }
    
    setAutoAligning(true)
    setError("")
    
    try {
      const results = await visionEngineRef.current.processPages(
        pageRef.current.pages,
        chars,
        calibration
      )
      
      
      setVisionEngineResults(results)
      
      // Update auto info with Vision Engine results
      const avgConfidence = (results.qaReport.averageConfidence * 100).toFixed(1)
      const infoMessage = `Vision Engine: ${results.glyphs.length} glyphs extracted — avg confidence ${avgConfidence}%, ${results.processingTime.toFixed(0)}ms`
      setAutoInfo(infoMessage)
      
      // Check memory usage
      PerformanceGovernor.memoryMonitor.checkMemory()
    } catch (error) {
      console.error('Vision Engine extraction failed:', error)
      console.error('Error details:', error.stack)
      setError(`Vision Engine error: ${error.message}`)
    } finally {
      setAutoAligning(false)
    }
  }, [chars, calibration])

  // ── Re-run Vision Engine เมื่อ calibration (slider) เปลี่ยน ──────────────
  const prevCalibrationRef = useRef(null)
  const calibrationDebounceRef = useRef(null)
  useEffect(() => {
    const prev = prevCalibrationRef.current
    prevCalibrationRef.current = calibration
    if (!prev) return // ครั้งแรก skip
    const changed =
      prev.offsetX !== calibration.offsetX ||
      prev.offsetY !== calibration.offsetY ||
      prev.cellAdjust !== calibration.cellAdjust ||
      prev.gapAdjust !== calibration.gapAdjust
    if (changed && visionEngineResults && !autoAligning && pageRef.current?.pages?.length > 0 && chars.length > 0) {
      // debounce 600ms – รอให้ user หยุดลาก slider ก่อนค่อย re-extract
      clearTimeout(calibrationDebounceRef.current)
      calibrationDebounceRef.current = setTimeout(() => {
        setVisionEngineResults(null) // ล้างผลเดิม → auto-run effect จะ kick in
      }, 600)
    }
    return () => clearTimeout(calibrationDebounceRef.current)
  }, [calibration]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auto-run Vision Engine when pages are loaded ───────────────────────────
  // ใช้ pageVersion (increments ใน pageRef effect) แทน pageRef.current?.pages?.length
  // เพราะ React ไม่ track mutation บน ref → ใช้ pageVersion เป็น stable trigger แทน
  useEffect(() => {
    if (pageVersion > 0 && chars.length > 0 && !visionEngineResults && !autoAligning) {
      handleVisionEngineExtraction()
    }
  }, [pageVersion, chars.length, visionEngineResults, autoAligning, handleVisionEngineExtraction])

  // Single source of truth for preview/export flow:
  // traced glyphs (with svgPath) have priority, otherwise show raw vision results.
  const activeGlyphs = useMemo(() => {
    if (tracedGlyphs.length > 0) return tracedGlyphs
    if (visionEngineResults) return visionEngineResults.glyphs
    return []
  }, [visionEngineResults, tracedGlyphs])

  const displayGlyphs = useMemo(() => {
    return removedIds.size === 0 ? activeGlyphs : activeGlyphs.filter(g => !removedIds.has(g.id))
  }, [activeGlyphs, removedIds])

  const isPartialRead = useMemo(() => {
    return chars.length > activeGlyphs.length
  }, [chars.length, activeGlyphs.length])

  const partialReadInfo = useMemo(() => {
    const totalPages = pageRef.current?.pages?.length ?? 0
    const pagesUsed = new Set(
      activeGlyphs
        .map(g => g.pageNumber)
        .filter(n => Number.isFinite(n))
    ).size
    return {
      pageCharsCount: activeGlyphs.length,
      pagesUsed,
      totalPages,
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGlyphs, pageVersion])

  // ── Sync Vision Engine results to parent – trace SVG paths first ──────
  useEffect(() => {
    if (!visionEngineResults) return

    // glyphs จาก VisionEngine ยังไม่มี svgPath – ต้อง trace ก่อนส่งให้ Step4
    // ไม่งั้น buildGlyphMap ใน Step4 จะ filter ออกหมด (svgPath === null)
    let canceled = false
    setTracing(true)

    const glyphsToTrace = visionEngineResults.glyphs.map(g => {
      // ใช้ _smartCroppedCanvas (crop ตาม ink bbox) ถ้ามี
      // ถ้าไม่มีใช้ _inkCanvas raw ตรงๆ
      // ห้ามใช้ _normalizedCanvas เพราะ rescale ลง 100×100 แล้ว pixel ขาด → เส้นแตก
      const canvas = g._smartCroppedCanvas || g._inkCanvas
      return {
        ...g,
        _inkCanvas: canvas,
        _inkW: canvas?.width  ?? g._inkW,
        _inkH: canvas?.height ?? g._inkH,
      }
    })

    traceAllGlyphs(glyphsToTrace).then(traced => {
      if (canceled) return

      // Map vision status → step4 status
      // Vision engine: excellent/good/acceptable/poor/critical/error/missing
      // Step4 expects: "ok" (valid) | "overflow" | "missing"
      const normalized = traced.map(g => {
        const vs = g.status
        const s4 = ["excellent", "good", "acceptable"].includes(vs) ? "ok"
                 : vs === "missing" ? "missing"
                 : "overflow"
        return { ...g, status: s4, _visionStatus: vs }
      })

      setTracedGlyphs(normalized)
      onGlyphsUpdate(normalized)
      setTracing(false)
    }).catch(err => {
      if (canceled) return
      console.error("Tracing Vision Engine glyphs failed:", err)
      onGlyphsUpdate(visionEngineResults.glyphs)
      setTracing(false)
    })

    return () => { canceled = true }
  }, [visionEngineResults, onGlyphsUpdate])

  const summary = useMemo(() => {
    // Use Vision Engine QA report if available, fallback to legacy counting
    if (visionEngineResults?.qaReport) {
      const qa = visionEngineResults.qaReport
      return {
        ok: qa.excellent + qa.good,
        missing: qa.missing,
        overflow: qa.overflow,
        total: qa.total,
        excellent: qa.excellent,
        good: qa.good,
        acceptable: qa.acceptable,
        poor: qa.poor,
        critical: qa.critical,
        error: qa.error
      }
    }
    
    // Legacy counting
    const ok = displayGlyphs.filter(g => g.status === "ok").length
    const missing = displayGlyphs.filter(g => g.status === "missing").length
    const overflow = displayGlyphs.filter(g => g.status === "overflow").length
    return { ok, missing, overflow, total: displayGlyphs.length }
  }, [displayGlyphs, visionEngineResults])

  const activeGlyph = useMemo(() => 
    displayGlyphs.find(g => g.id === activeId) ?? null, 
    [displayGlyphs, activeId]
  )

  // ── Per-glyph re-crop with individual offset ────────────────────────────────
  // cache key: `${glyphId}:${offsetX}:${offsetY}` → data URL
  // ใช้ useRef แทน useMemo เพราะ cache ต้องคงอยู่ข้าม render โดยไม่ขึ้นกับ deps
  const previewCacheRef = useRef(new Map())

  // ล้าง cache เมื่อ displayGlyphs เปลี่ยน (extraction ใหม่)
  useEffect(() => {
    previewCacheRef.current.clear()
  }, [displayGlyphs])

  const getAdjustedPreview = useCallback((glyph, offsetX = 0, offsetY = 0) => {
    const cacheKey = `${glyph.id}:${offsetX}:${offsetY}`
    if (previewCacheRef.current.has(cacheKey)) {
      return previewCacheRef.current.get(cacheKey)
    }

    let result = null
    const src = glyph._sourceRect
    const ctx = glyph._pageCtx
    if (src && ctx && ctx.canvas) {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = src.w; canvas.height = src.h
        const gc = canvas.getContext('2d')
        gc.fillStyle = '#fff'
        gc.fillRect(0, 0, src.w, src.h)
        const sx = Math.max(0, Math.min(src.x + offsetX, ctx.canvas.width - 1))
        const sy = Math.max(0, Math.min(src.y + offsetY, ctx.canvas.height - 1))
        gc.drawImage(ctx.canvas, sx, sy, src.w, src.h, 0, 0, src.w, src.h)
        result = canvas.toDataURL('image/png')
      } catch { /* fall through */ }
    }
    // fallback: ใช้ smartCropped preview ที่ VisionEngine generate ไว้แล้ว
    // (ดีกว่า raw preview เพราะ crop ตาม ink bbox แล้ว)
    if (!result) result = glyph._smartCroppedPreview ?? glyph.preview ?? null

    // Cache ขนาดไม่เกิน 500 entries เพื่อป้องกัน memory leak
    if (previewCacheRef.current.size >= 500) previewCacheRef.current.clear()
    previewCacheRef.current.set(cacheKey, result)
    return result
  }, [])

  // ── Pre-compute base previews สำหรับ grid (offset = 0,0) ──────────────────
  // ทำให้ render ครั้งแรกไม่ต้อง re-draw canvas ทุก glyph card
  const basePreviewMap = useMemo(() => {
    const map = new Map()
    for (const g of displayGlyphs) {
      map.set(g.id, getAdjustedPreview(g, 0, 0))
    }
    return map
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayGlyphs])

  const stStyle = {
    ok:        { border: C.sageMd,  bg: C.bgCard,  textColor: C.sage,  label: "OK" },
    missing:   { border: C.blushMd, bg: C.blushLt, textColor: C.blush, label: "Missing" },
    overflow:  { border: C.amberMd, bg: C.amberLt, textColor: C.amber, label: "Overflow" },
    excellent: { border: C.sageMd,  bg: C.sageLt,  textColor: C.sage,  label: "Excellent" },
    good:      { border: C.sageMd,  bg: C.sageLt,  textColor: C.sage,  label: "Good" },
    acceptable:{ border: C.amberMd, bg: C.amberLt, textColor: C.amber, label: "Acceptable" },
    poor:      { border: C.amberMd, bg: C.amberLt, textColor: C.amber, label: "Poor" },
    critical:  { border: C.blushMd, bg: C.blushLt, textColor: C.blush, label: "Critical" },
    error:     { border: C.blushMd, bg: C.blushLt, textColor: C.blush, label: "Error" },
  }

  // ── Guards ──────────────────────────────────────────────────────────────────
  
  if (!parsedFile) {
    return (
      <div className="fade-up">
        <InfoBox color="amber">Please upload a PDF file in Step 2 first</InfoBox>
      </div>
    )
  }
  
  if (chars.length === 0) {
    return (
      <div className="fade-up">
        <InfoBox color="amber">
          No characters found in this file — go back to Step 2 to enter them manually
        </InfoBox>
      </div>
    )
  }

  // ── Main render ─────────────────────────────────────────────────────────────
  return (
    <div className="fade-up">
      {/* NEW: Pipeline status display */}
      <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 12, padding: "12px 16px", marginBottom: 14 }}>
        <p style={{ fontSize: 11, fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", color: C.inkLt, marginBottom: 8 }}>
          Pipeline Status
        </p>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ fontSize: 14, color: C.ink }}>
            <strong>{pipelineState}</strong>
          </div>
          <div style={{ fontSize: 11, color: C.inkLt }}>
            {Object.entries(pipelineContext).map(([key, value]) => (
              <span key={key} style={{ marginLeft: 8 }}>
                {key}: {JSON.stringify(value)}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Summary stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(80px, 1fr))", gap: 10, marginBottom: 20 }}>
        {[
          { label: "Excellent",  val: summary.excellent, color: C.sage },
          { label: "Good",        val: summary.good,      color: C.sage },
          { label: "Acceptable",    val: summary.acceptable, color: C.amber },
          { label: "Poor",       val: summary.poor,      color: C.amber },
          { label: "Critical",    val: summary.critical,  color: C.blush },
          { label: "Overflow",  val: summary.overflow,  color: C.amber },
          { label: "Missing",   val: summary.missing,   color: C.blush },
          { label: "Total",     val: summary.total,     color: C.ink },
        ].map(s => {
          const style = stStyle[s.label] || stStyle.ok
          return (
            <div key={s.label} style={{ background: style.bg, border: `1px solid ${style.border}`, borderRadius: 12, padding: "12px 8px", textAlign: "center" }}>
              <p style={{ fontSize: 18, fontWeight: 300, color: style.textColor, fontFamily: "'DM Serif Display',serif" }}>{s.val}</p>
              <p style={{ fontSize: 10, color: C.inkLt, marginTop: 4, letterSpacing: "0.05em" }}>{s.label}</p>
            </div>
          )
        })}
      </div>

      {/* Source info */}
      {parsedFile.charSource === "qr" && (
        <InfoBox color="sage">
          Character order read from QR on the template ({chars.length} characters)
        </InfoBox>
      )}
      {parsedFile.charSource === "manual" && (
        <InfoBox color="sage">
          Using manually entered characters ({chars.length} characters)
        </InfoBox>
      )}

      <InfoBox color="amber">
        If glyphs are misaligned, adjust Grid Alignment below first, then click any image to zoom in
      </InfoBox>
      {isPartialRead && (
        <InfoBox color="amber">
          Read {partialReadInfo.pageCharsCount}/{chars.length} characters from {partialReadInfo.pagesUsed}/{partialReadInfo.totalPages} page(s)
        </InfoBox>
      )}
      {error && <InfoBox color="amber">{error}</InfoBox>}
      
      {/* NEW: Telemetry display */}
      {Object.keys(telemetryData).length > 0 && (
        <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 12, padding: "12px 16px", marginBottom: 14 }}>
          <p style={{ fontSize: 11, fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", color: C.inkLt, marginBottom: 8 }}>
            Performance Metrics
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 8 }}>
            {Object.entries(telemetryData).map(([name, data]) => (
              <div key={name} style={{ fontSize: 10, color: C.ink }}>
                <strong>{name}:</strong><br />
                Avg: {data.avgDuration?.toFixed(1)}ms<br />
                Success: {(data.successRate * 100).toFixed(1)}%<br />
                Count: {data.count}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Controls - now using engine handlers */}
      <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 14, padding: "14px 16px", marginBottom: 14 }}>
        <p style={{ fontSize: 11, fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", color: C.inkLt, marginBottom: 10 }}>
          Grid Alignment
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Adjuster 
            label="Shift Left/Right (X)" 
            value={calibration.offsetX}    
            min={-160} max={160} step={1} 
            onChange={v => setCalibration(p => ({ ...p, offsetX: v }))} 
          />
          <Adjuster 
            label="Shift Up/Down (Y)"  
            value={calibration.offsetY}    
            min={-160} max={160} step={1} 
            onChange={v => setCalibration(p => ({ ...p, offsetY: v }))} 
          />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Adjuster 
            label="Cell Size"    
            value={calibration.cellAdjust} 
            min={-48}  max={48}  step={1} 
            onChange={v => setCalibration(p => ({ ...p, cellAdjust: v }))} 
          />
          <Adjuster 
            label="Cell Gap" 
            value={calibration.gapAdjust}  
            min={-30}  max={30}  step={1} 
            onChange={v => setCalibration(p => ({ ...p, gapAdjust: v }))} 
          />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 12 }}>
          <div style={{ display: "flex", alignItems: "center", minHeight: 30 }}>
            {autoAligning
              ? <span style={{ fontSize: 11, color: C.amber }}>⏳ Re-extracting with new calibration…</span>
              : tracing
              ? <span style={{ fontSize: 11, color: C.sage }}>✦ Tracing SVG paths… (please wait before proceeding to Step 4)</span>
              : autoInfo && <span style={{ fontSize: 11, color: C.inkLt }}>{autoInfo}</span>
            }
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Btn onClick={handleVisionEngineExtraction} variant="primary" size="sm" disabled={autoAligning || pipelineState === PipelineStates.EXTRACTING}>
              {autoAligning ? "Processing…" : "Extract via Vision Engine"}
            </Btn>
            <Btn onClick={() => setRemovedIds(new Set())}            variant="ghost" size="sm" disabled={removedIds.size === 0}>Restore removed</Btn>
            <Btn onClick={() => setCalibration(ZERO_CALIBRATION)}   variant="ghost" size="sm">Reset grid</Btn>
            <Btn onClick={() => setShowDebug(v => !v)}               variant="ghost" size="sm">{showDebug   ? "Hide Grid Overlay" : "Show Grid Overlay"}</Btn>
            <Btn onClick={() => setShowOverlay(v => !v)}             variant="ghost" size="sm">{showOverlay ? "Hide Debug"        : "Debug Overlay"}</Btn>
            <Btn onClick={() => setShowQADashboard(v => !v)}         variant="ghost" size="sm">{showQADashboard ? "Hide QA"   : "QA Dashboard"}</Btn>
          </div>
        </div>
      </div>

      {/* Debug overlays */}
      {showDebug && (
        <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 14, padding: 14, marginBottom: 14 }}>
          <p style={{ fontSize: 11, color: C.inkLt, marginBottom: 10 }}>
            Cropped image per cell —{" "}
            <span style={{ color: "#00a046" }}>●</span> OK{" "}
            <span style={{ color: "#c83c3c" }}>●</span> Missing{" "}
            <span style={{ color: "#c88c00" }}>●</span> Overflow
          </p>
          <GridDebugOverlay glyphs={displayGlyphs} />
        </div>
      )}

      {showOverlay && pageRef.current?.pages?.length > 0 && (
        <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 14, padding: 14, marginBottom: 14 }}>
          <PageDebugOverlay
            pages={pageRef.current.pages}
            calibration={calibration}
            chars={chars}
            getGridGeometry={getGridGeometry}
          />
        </div>
      )}

      {/* Skeleton loading — shown while extracting (autoAligning) or tracing */}
      {(autoAligning || tracing) && (
        <SkeletonGrid
          count={Math.max(chars.length || 20, 4)}
          label={autoAligning ? "Extracting glyphs via Vision Engine…" : "Tracing SVG paths…"}
        />
      )}

      {/* Glyph grid — shown once loading is done */}
      {!autoAligning && !tracing && displayGlyphs.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <p style={{ fontSize: 11, color: C.inkLt, marginBottom: 8 }}>
            Click a card to open the per-character position adjuster
          </p>
        </div>
      )}
      <div style={{ display: autoAligning || tracing ? "none" : "grid", gridTemplateColumns: "repeat(auto-fill,minmax(88px,1fr))", gap: 8, marginBottom: 20 }}>
        {displayGlyphs.map(g => {
          const glyphStatus = g.confidence?.status || g.status
          const s = stStyle[glyphStatus] || stStyle.ok
          const isActive = activeId === g.id
          const hasOff = !!glyphOffsets[g.id]
          // ใช้ basePreviewMap (offset=0) สำหรับ grid เพื่อไม่ต้อง draw canvas ทุก render
          // เฉพาะตอนมี offset ค่อย getAdjustedPreview จริงๆ (cached แล้ว)
          const off = glyphOffsets[g.id]
          const gridSrc = off
            ? getAdjustedPreview(g, off.x, off.y)
            : (basePreviewMap.get(g.id) ?? null)
          return (
            <div key={g.id} className="glyph-card" onClick={() => setActiveId(isActive ? null : g.id)}
              style={{ position: "relative", background: isActive ? C.bgMuted : s.bg, border: `1.5px solid ${isActive ? C.ink : s.border}`, borderRadius: 12, padding: "8px 6px", textAlign: "center", cursor: "pointer", outline: isActive ? `2px solid ${C.ink}` : "none", outlineOffset: 1 }}>
              {/* ปุ่มลบ */}
              <button type="button" onClick={e => { e.stopPropagation(); setRemovedIds(prev => { const n = new Set(prev); n.add(g.id); return n }) }}
                style={{ position: "absolute", top: 4, right: 4, width: 20, height: 20, borderRadius: 999, border: `1px solid ${C.border}`, background: "#fff", color: C.inkMd, fontSize: 10, cursor: "pointer", zIndex: 1 }}
                title="Remove this glyph">✕</button>
              {/* ภาพ glyph */}
              <button type="button" onClick={e => { e.stopPropagation(); const o = glyphOffsets[g.id] ?? {x:0,y:0}; setZoomGlyph({ ...g, preview: getAdjustedPreview(g, o.x, o.y) }) }}
                style={{ width: "100%", aspectRatio: "1", borderRadius: 8, background: C.bgCard, border: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", marginBottom: 6, padding: 4, cursor: "zoom-in" }}
                title="Zoom in">
                <img src={gridSrc} alt={`Glyph ${g.ch}`} style={{ width: "100%", height: "100%", objectFit: "contain", imageRendering: "auto" }} />
              </button>
              <p style={{ fontSize: 12, fontWeight: 500, color: C.ink }}>{g.ch}</p>
              <p style={{ fontSize: 9, color: C.inkLt, marginTop: 1 }}>
                HG{String(g.index).padStart(3,"0")}
                {hasOff && <span style={{ color: C.amber, marginLeft: 2 }}>✎</span>}
              </p>
              <p style={{ fontSize: 10, color: s.textColor, marginTop: 2 }}>
                {s.label}
                {g.confidence && (
                  <span style={{ fontSize: 8, color: C.inkLt, marginLeft: 2 }}>
                    ({(g.confidence.overall * 100).toFixed(0)}%)
                  </span>
                )}
              </p>
              {/* hint เมื่อ active */}
              {isActive && (
                <div style={{ position: "absolute", bottom: -1, left: 0, right: 0, background: C.ink, color: "#fff", fontSize: 8, borderRadius: "0 0 10px 10px", padding: "2px 0" }}>
                  ▼ Adjuster below
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Active glyph detail – with per-glyph offset controls */}
      {activeGlyph && (() => {
        const off = glyphOffsets[activeGlyph.id] ?? { x: 0, y: 0 }
        const setOff = (axis, val) =>
          setGlyphOffsets(prev => ({
            ...prev,
            [activeGlyph.id]: { ...off, [axis]: val }
          }))
        const adjPreview = getAdjustedPreview(activeGlyph, off.x, off.y)
        const hasOffset = off.x !== 0 || off.y !== 0
        return (
          <div style={{ marginTop: 16, background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden" }}>
            {/* Header */}
            <div style={{ padding: "10px 16px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <p style={{ fontSize: 11, fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", color: C.inkLt, margin: 0 }}>
                Per-character position adjuster: <b style={{ color: C.ink, textTransform: "none" }}>{activeGlyph.ch}</b>
                {" "}• HG{String(activeGlyph.index).padStart(3, "0")}
              </p>
              <div style={{ display: "flex", gap: 8 }}>
                {hasOffset && (
                  <Btn
                    size="sm" variant="ghost"
                    onClick={() => setGlyphOffsets(prev => { const n = { ...prev }; delete n[activeGlyph.id]; return n })}
                  >
                    Reset position
                  </Btn>
                )}
                <Btn size="sm" variant="ghost" onClick={() => setActiveId(null)}>Close</Btn>
              </div>
            </div>

            <div style={{ display: "flex", gap: 0 }}>
              {/* Preview column */}
              <div style={{ padding: 16, display: "flex", flexDirection: "column", alignItems: "center", gap: 8, borderRight: `1px solid ${C.border}`, minWidth: 140 }}>
                <div
                  style={{ width: 110, height: 110, borderRadius: 10, border: `2px solid ${C.border}`, background: C.bgMuted, padding: 8, cursor: "zoom-in", display: "flex", alignItems: "center", justifyContent: "center" }}
                  onClick={() => setZoomGlyph({ ...activeGlyph, preview: adjPreview })}
                >
                  <img src={adjPreview} alt={`Preview ${activeGlyph.ch}`} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                </div>
                {hasOffset && (
                  <p style={{ fontSize: 10, color: C.amber, textAlign: "center" }}>
                    Adjusted ({off.x > 0 ? "+" : ""}{off.x}, {off.y > 0 ? "+" : ""}{off.y})
                  </p>
                )}
                <div style={{ fontSize: 11, color: C.inkMd, lineHeight: 1.7, textAlign: "center" }}>
                  <div>Status: <b style={{ color: C.sage }}>{activeGlyph.confidence?.status || activeGlyph.status}</b></div>
                  {activeGlyph.confidence ? (
                    <div>Confidence: <b style={{ color: C.ink }}>{(activeGlyph.confidence.overall * 100).toFixed(1)}%</b></div>
                  ) : null}
                </div>
              </div>

              {/* Adjusters column */}
              <div style={{ flex: 1, padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
                <p style={{ fontSize: 11, color: C.inkLt, margin: 0 }}>
                  Adjust this glyph only — does not affect others
                </p>
                <Adjuster
                  label="Shift Left / Right (X)"
                  value={off.x}
                  min={-80} max={80} step={1}
                  onChange={v => setOff("x", v)}
                />
                <Adjuster
                  label="Shift Up / Down (Y)"
                  value={off.y}
                  min={-80} max={80} step={1}
                  onChange={v => setOff("y", v)}
                />
                {/* Arrow nudge buttons */}
                <div>
                  <p style={{ fontSize: 11, color: C.inkLt, marginBottom: 8 }}>Nudge by 1px:</p>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 40px)", gridTemplateRows: "repeat(3, 40px)", gap: 4 }}>
                    {[
                      { label: "↖", dx: -1, dy: -1 }, { label: "↑", dx: 0, dy: -1 }, { label: "↗", dx: 1, dy: -1 },
                      { label: "←", dx: -1, dy: 0  }, { label: "·", dx: 0, dy: 0   }, { label: "→", dx: 1, dy: 0  },
                      { label: "↙", dx: -1, dy: 1  }, { label: "↓", dx: 0, dy: 1   }, { label: "↘", dx: 1, dy: 1  },
                    ].map(({ label, dx, dy }) => (
                      <button
                        key={label}
                        type="button"
                        disabled={label === "·"}
                        onClick={() => { setOff("x", off.x + dx); setOff("y", off.y + dy) }}
                        style={{
                          width: 40, height: 40,
                          border: `1px solid ${C.border}`,
                          borderRadius: 8,
                          background: label === "·" ? C.bgMuted : C.bgCard,
                          color: label === "·" ? C.inkLt : C.ink,
                          fontSize: 14, cursor: label === "·" ? "default" : "pointer",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          transition: "background 0.1s"
                        }}
                        onMouseEnter={e => { if (label !== "·") e.currentTarget.style.background = C.bgMuted }}
                        onMouseLeave={e => { e.currentTarget.style.background = label === "·" ? C.bgMuted : C.bgCard }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )
      })()}

      {/* QA Dashboard (collapse by default) */}
      {showQADashboard && visionEngineResults && (
        <div style={{ marginBottom: 16 }}>
          <QADashboard
            glyphs={displayGlyphs}
            qaReport={visionEngineResults.qaReport}
            onGlyphSelect={setActiveId}
            onRetryExtraction={handleVisionEngineExtraction}
          />
        </div>
      )}

      {/* Zoom modal – with inline per-glyph adjustment */}
      {zoomGlyph && (() => {
        const off = glyphOffsets[zoomGlyph.id] ?? { x: 0, y: 0 }
        const setOff = (axis, val) => {
          const newOff = { ...off, [axis]: val }
          setGlyphOffsets(prev => ({ ...prev, [zoomGlyph.id]: newOff }))
          // update preview in modal live
          setZoomGlyph(prev => ({ ...prev, preview: getAdjustedPreview(prev, newOff.x, newOff.y) }))
        }
        const hasOffset = off.x !== 0 || off.y !== 0
        return (
          <div role="dialog" aria-modal="true" onClick={() => setZoomGlyph(null)}
            style={{ position: "fixed", inset: 0, background: "rgba(21,19,14,.72)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
            <div onClick={e => e.stopPropagation()} style={{ width: "min(780px,96vw)", borderRadius: 16, background: "#fff", border: `1px solid ${C.border}`, overflow: "hidden" }}>

              {/* Header */}
              <div style={{ display: "flex", alignItems: "center", padding: "14px 18px", borderBottom: `1px solid ${C.border}` }}>
                <div>
                  <p style={{ fontSize: 15, fontWeight: 600, color: C.ink, margin: 0 }}>
                    {zoomGlyph.ch}
                    <span style={{ fontSize: 12, fontWeight: 400, color: C.inkLt, marginLeft: 10 }}>
                      HG{String(zoomGlyph.index).padStart(3, "0")} • Cell #{zoomGlyph.index}
                    </span>
                  </p>
                  {hasOffset && (
                    <p style={{ fontSize: 11, color: C.amber, margin: "2px 0 0" }}>
                      ✎ Adjusted X: {off.x > 0 ? "+" : ""}{off.x}, Y: {off.y > 0 ? "+" : ""}{off.y}
                    </p>
                  )}
                </div>
                <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                  {hasOffset && (
                    <button type="button"
                      onClick={() => {
                        setGlyphOffsets(prev => { const n = { ...prev }; delete n[zoomGlyph.id]; return n })
                        setZoomGlyph(prev => ({ ...prev, preview: getAdjustedPreview(prev, 0, 0) }))
                      }}
                      style={{ border: `1px solid ${C.border}`, borderRadius: 8, background: C.bgMuted, padding: "5px 12px", fontSize: 12, cursor: "pointer", color: C.ink }}>
                      Reset
                    </button>
                  )}
                  <button type="button" onClick={() => setZoomGlyph(null)}
                    style={{ border: `1px solid ${C.border}`, borderRadius: 8, background: C.bgCard, padding: "5px 12px", fontSize: 12, cursor: "pointer", color: C.ink }}>
                    ปิด
                  </button>
                </div>
              </div>

              {/* Body: preview + controls side by side */}
              <div style={{ display: "flex", gap: 0 }}>

                {/* Left: large preview */}
                <div style={{ flex: 1, padding: 18, background: C.bgMuted, display: "flex", alignItems: "center", justifyContent: "center", minHeight: 320 }}>
                  <img
                    src={zoomGlyph.preview}
                    alt={`Zoom ${zoomGlyph.ch}`}
                    style={{ maxWidth: "100%", maxHeight: 400, objectFit: "contain", imageRendering: "auto", borderRadius: 8 }}
                  />
                </div>

                {/* Right: adjustment controls */}
                <div style={{ width: 260, padding: 18, borderLeft: `1px solid ${C.border}`, display: "flex", flexDirection: "column", gap: 16 }}>
                  <div>
                    <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.07em", textTransform: "uppercase", color: C.inkLt, margin: "0 0 12px" }}>
                      Adjust position
                    </p>
                    <p style={{ fontSize: 11, color: C.inkLt, margin: "0 0 14px" }}>Adjust this glyph only — does not affect others</p>

                    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                      <Adjuster
                        label="← Left / Right →"
                        value={off.x} min={-100} max={100} step={1}
                        onChange={v => setOff("x", v)}
                      />
                      <Adjuster
                        label="↑ Up / Down ↓"
                        value={off.y} min={-100} max={100} step={1}
                        onChange={v => setOff("y", v)}
                      />
                    </div>
                  </div>

                  {/* D-pad nudge */}
                  <div>
                    <p style={{ fontSize: 11, color: C.inkLt, margin: "0 0 10px" }}>Nudge 1px:</p>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 44px)", gap: 5 }}>
                      {[
                        { label: "↖", dx: -1, dy: -1 }, { label: "↑", dx: 0, dy: -1 }, { label: "↗", dx: 1, dy: -1 },
                        { label: "←", dx: -1, dy: 0  }, { label: "·", dx: 0, dy: 0  }, { label: "→", dx: 1, dy: 0  },
                        { label: "↙", dx: -1, dy: 1  }, { label: "↓", dx: 0, dy: 1  }, { label: "↘", dx: 1, dy: 1  },
                      ].map(({ label, dx, dy }) => (
                        <button key={label} type="button"
                          disabled={label === "·"}
                          onClick={() => { setOff("x", off.x + dx); setOff("y", off.y + dy) }}
                          style={{
                            width: 44, height: 44, border: `1px solid ${C.border}`, borderRadius: 8,
                            background: label === "·" ? C.bgMuted : C.bgCard,
                            color: label === "·" ? C.borderMd : C.ink,
                            fontSize: 16, cursor: label === "·" ? "default" : "pointer",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            fontWeight: 500,
                          }}>
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Status info */}
                  <div style={{ marginTop: "auto", paddingTop: 12, borderTop: `1px solid ${C.border}`, fontSize: 11, color: C.inkMd, lineHeight: 1.8 }}>
                    <div>Status: <b style={{ color: C.ink }}>{zoomGlyph.confidence?.status || zoomGlyph.status}</b></div>
                    {zoomGlyph.confidence && (
                      <div>Confidence: <b style={{ color: C.ink }}>{(zoomGlyph.confidence.overall * 100).toFixed(1)}%</b></div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
