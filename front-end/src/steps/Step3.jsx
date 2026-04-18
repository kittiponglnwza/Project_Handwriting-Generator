/**
 * Step3 — Preview / Adjust / Validate
 *
 * ARCHITECTURE ROLE: Pure consumer + glyph extractor.
 *
 * Props:
 *   parsedFile  — from appState.parsedFile (set by Step 2)
 *                 Shape: { file, characters, charSource, metadata, pages, status }
 *   onGlyphsUpdate(glyphs[]) — called whenever extracted glyphs change
 *
 * REMOVED:
 *   - selected (was Step 1 fallback — gone)
 *   - pdfFile  (PDF is NEVER re-read here)
 *   - templateChars (was Step 1 fallback — gone)
 *   - fallbackChars useMemo chain
 *   - getDocument() / loadingTask — all PDF I/O moved to Step 2
 *
 * Step 3 uses parsedFile.pages (pre-rendered canvases from Step 2)
 * to extract glyphs via glyphPipeline. No network/file I/O needed.
 */
import { useEffect, useMemo, useRef, useState, useCallback } from "react"
import Btn from "../components/Btn"
import InfoBox from "../components/InfoBox"
import C from "../styles/colors"
import { buildAutoPageProfiles } from "../lib/step3/calibration.js"
import { getGridGeometry, getPageCapacity, extractGlyphsFromCanvas, traceAllGlyphs } from "../lib/step3/glyphPipeline.js"
import {
  GRID_COLS,
  MIN_TRUSTED_INDEX_TARGETS,
  TEMPLATE_CALIBRATION,
  ZERO_CALIBRATION,
} from "../lib/step3/constants.js"
import { buildOrderedCellRectsForPage } from "../lib/step3/regDots.js"
import { mergeCalibration } from "../lib/step3/utils.js"
import { Adjuster, GridDebugOverlay, PageDebugOverlay } from "./step3/Step3Panels.jsx"
import DebugOverlay from "../components/DebugOverlay.jsx"

// NEW: Engine imports
import { PipelineStateMachine, PipelineStates } from "../engine/PipelineStateMachine.js"
import { Step3Controller } from "../features/step3/Step3Controller.js"
import { Telemetry } from "../engine/Telemetry.js"
import { PerformanceGovernor } from "../engine/PerformanceGovernor.js"
import { GlyphWorkerAdapter } from "../workers/GlyphWorkerAdapter.js"
import { GeometryError, PipelineError } from "../engine/errors/BaseError.js"

// NEW: Vision Engine imports
import { VisionEngine } from "../core/vision/VisionEngine.js"
import QADashboard from "../components/QADashboard.jsx"

export default function Step3({ parsedFile, onGlyphsUpdate = () => {} }) {
  // ── Guard: should never render without parsedFile, but be safe ────────────
  console.log('=== STEP3 COMPONENT LOADING ===')
  console.log('ParsedFile:', parsedFile)
  
  // Test object rendering - this should cause the error
  const testObject = { label: "Test", val: 123, color: "red" }
  console.log('Test object:', testObject)
  
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
  const engineMode = "vision" // locked to Vision Engine — git overlay only
  const [visionEngineResults, setVisionEngineResults] = useState(null)
  const [showQADashboard, setShowQADashboard] = useState(false)
  const [glyphOffsets, setGlyphOffsets] = useState({}) // { [glyphId]: {x, y} }

  const pageRef = useRef(null)
  const stateMachineRef = useRef(null)
  const workerAdapterRef = useRef(null)
  const visionEngineRef = useRef(null)

  // ── Initialize state machine and worker adapter ─────────────────────────────
  useEffect(() => {
    const stateMachine = new PipelineStateMachine()
    const workerAdapter = new GlyphWorkerAdapter(2)
    
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
    
    stateMachineRef.current = stateMachine
    workerAdapterRef.current = workerAdapter
    
    // Initialize Vision Engine with error handling
    try {
      console.log('Initializing Vision Engine...')
      visionEngineRef.current = new VisionEngine()
      console.log('Vision Engine initialized successfully')
      console.log('Vision Engine methods available:', Object.getOwnPropertyNames(visionEngineRef.current))
    } catch (error) {
      console.error('Failed to initialize Vision Engine:', error)
      console.error('Error stack:', error.stack)
      setError(`Vision Engine initialization failed: ${error.message}`)
    }
    
    
    return () => {
      unsubscribe()
      telemetryUnsubscribe()
      workerAdapter.cleanup()
      visionEngineRef.current?.reset()
    }
  }, [])

  // ── Load page data from parsedFile (no PDF I/O) ───────────────────────────
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
          ? `Auto aligned ${profiledPages.length} pages (targets ${chars.length}, anchored ${anchorPages}, code ${codeAnchorPages}, avg score ${avgScore.toFixed(1)})`
          : `Auto aligned ${profiledPages.length} pages (anchored ${anchorPages}, code ${codeAnchorPages})`
      )
      setPageVersion(v => v + 1)
      setError("")
    } catch (err) {
      setError(err?.message ?? "เกิดข้อผิดพลาดในการโหลด glyphs")
      stateMachineRef.current?.transition(PipelineStates.ERROR, { error: err.message })
    }
  }, [parsedFile, chars.length])

  // NEW: Vision Engine handler (production quality extraction)
  const handleVisionEngineExtraction = useCallback(async () => {
    console.log('=== VISION ENGINE EXTRACTION STARTED ===')
    console.log('PageRef current:', pageRef.current)
    console.log('Vision Engine ref:', visionEngineRef.current)
    console.log('Chars length:', chars.length)
    console.log('Engine mode:', engineMode)
    
    if (!pageRef.current?.pages || !visionEngineRef.current) {
      console.error('Vision Engine extraction aborted: missing pages or engine')
      return
    }
    
    console.log('Setting autoAligning to true...')
    setAutoAligning(true)
    setError("")
    
    try {
      console.log('About to call processPages...')
      const results = await visionEngineRef.current.processPages(
        pageRef.current.pages,
        chars,
        calibration
      )
      
      console.log('Vision Engine results received:', results)
      
      console.log('Setting visionEngineResults...')
      setVisionEngineResults(results)
      console.log('Vision Engine results set!')
      
      // Update auto info with Vision Engine results
      const avgConfidence = (results.qaReport.averageConfidence * 100).toFixed(1)
      const infoMessage = `Vision Engine: ${results.glyphs.length} glyphs extracted (avg confidence ${avgConfidence}%, processing time ${results.processingTime.toFixed(0)}ms)`
      console.log('Setting auto info:', infoMessage)
      setAutoInfo(infoMessage)
      
      // Check memory usage
      PerformanceGovernor.memoryMonitor.checkMemory()
    } catch (error) {
      console.error('Vision Engine extraction failed:', error)
      console.error('Error details:', error.stack)
      setError(`Vision Engine error: ${error.message}`)
    } finally {
      console.log('Setting autoAligning to false...')
      setAutoAligning(false)
    }
  }, [chars, calibration])

  // NEW: Legacy Engine event handlers (fallback)
  const handleStartExtraction = useCallback(async () => {
    if (!pageRef.current || !stateMachineRef.current) return
    
    try {
      const pageData = {
        pageWidth: pageRef.current.pages[0].pageWidth,
        pageHeight: pageRef.current.pages[0].pageHeight,
        chars: chars,
        ctx: pageRef.current.pages[0].ctx,
        pages: pageRef.current.pages
      }
      
      const result = await Step3Controller.executeFullPipeline(pageData, calibration, stateMachineRef.current)
      // Don't setTracedGlyphs here - let activeGlyphs handle it
      
      // Check memory usage
      PerformanceGovernor.memoryMonitor.checkMemory()
    } catch (error) {
      if (error instanceof GeometryError) {
        setError(`Geometry mismatch: ${error.message}`)
      } else if (error instanceof PipelineError) {
        setError(`Pipeline error: ${error.message}`)
      } else {
        setError(`Unexpected error: ${error.message}`)
      }
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
      // debounce 600ms — รอให้ user หยุดลาก slider ก่อนค่อย re-extract
      clearTimeout(calibrationDebounceRef.current)
      calibrationDebounceRef.current = setTimeout(() => {
        setVisionEngineResults(null) // ล้างผลเดิม → auto-run effect จะ kick in
      }, 600)
    }
    return () => clearTimeout(calibrationDebounceRef.current)
  }, [calibration]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auto-run Vision Engine when pages are loaded ───────────────────────
  useEffect(() => {
    console.log('=== AUTO-RUN VISION ENGINE CHECK ===')
    console.log('Engine mode:', engineMode)
    console.log('Has pages:', pageRef.current?.pages?.length > 0)
    console.log('Chars length:', chars.length)
    console.log('Has results:', !!visionEngineResults)
    console.log('Is aligning:', autoAligning)
    console.log('Should run:', engineMode === "vision" && pageRef.current?.pages?.length > 0 && chars.length > 0 && !visionEngineResults && !autoAligning)
    
    if (engineMode === "vision" && pageRef.current?.pages?.length > 0 && chars.length > 0 && !visionEngineResults && !autoAligning) {
      console.log('*** AUTO-RUNNING VISION ENGINE ***')
      handleVisionEngineExtraction()
    } else {
      console.log('*** NOT RUNNING VISION ENGINE ***')
      console.log('Reason:', {
        mode: engineMode,
        hasPages: pageRef.current?.pages?.length > 0,
        hasChars: chars.length > 0,
        hasResults: !!visionEngineResults,
        isAligning: autoAligning
      })
    }
  }, [engineMode, pageRef.current?.pages?.length, chars.length, visionEngineResults, autoAligning, handleVisionEngineExtraction])

  const handleAutoAlign = useCallback(async () => {
    if (!pageRef.current) return
    
    setAutoAligning(true)
    stateMachineRef.current?.transition(PipelineStates.CALIBRATING)
    
    try {
      const profiledPages = buildAutoPageProfiles(pageRef.current.pages, chars)
      pageRef.current = { ...pageRef.current, pages: profiledPages }
      
      const avgScore = profiledPages.length > 0
        ? profiledPages.reduce((sum, p) => sum + (Number.isFinite(p.autoScore) ? p.autoScore : 0), 0) / profiledPages.length
        : NaN
      const anchorPages = profiledPages.filter(p => p.autoSource === "anchor").length
      
      setAutoInfo(
        Number.isFinite(avgScore)
          ? `Auto aligned ${profiledPages.length} pages (anchored ${anchorPages}, avg score ${avgScore.toFixed(1)})`
          : `Auto aligned ${profiledPages.length} pages (anchored ${anchorPages})`
      )
      
      stateMachineRef.current?.transition(PipelineStates.IDLE, {
        pageCount: profiledPages.length,
        avgScore
      })
    } catch (error) {
      setError(error.message)
      stateMachineRef.current?.transition(PipelineStates.ERROR, { error: error.message })
    } finally {
      setAutoAligning(false)
    }
  }, [chars])

  // ── Auto-align (manual re-trigger) ───────────────────────────────────────
  const runAutoAlign = () => {
    const store = pageRef.current
    if (!store?.pages?.length || chars.length === 0) return
    setAutoAligning(true)
    window.setTimeout(() => {
      const pages = buildAutoPageProfiles(store.pages, chars)
      pageRef.current = { ...store, pages }
      const avgScore = pages.length > 0
        ? pages.reduce((sum, p) => sum + (Number.isFinite(p.autoScore) ? p.autoScore : 0), 0) / pages.length
        : NaN
      const anchorPages = pages.filter(p => p.autoSource === "anchor").length
      setAutoInfo(
        Number.isFinite(avgScore)
          ? `Auto aligned ${pages.length} pages (anchored ${anchorPages}, avg score ${avgScore.toFixed(1)})`
          : `Auto aligned ${pages.length} pages (anchored ${anchorPages})`
      )
      setPageVersion(v => v + 1)
      setAutoAligning(false)
    }, 0)
  }

  // ── Glyph extraction (runs on calibration / page changes) ────────────────
  const analysisResult = useMemo(() => {
    // DISABLE legacy pipeline when Vision Engine is active
    if (engineMode === "vision") {
      return { glyphs: [], pageCharsCount: 0, maxCells: 0, pagesUsed: 0, totalPages: 0 }
    }
    
    void pageVersion  // reactive on version bump
    const source = pageRef.current
    if (!source?.pages?.length || chars.length === 0) {
      return { glyphs: [], pageCharsCount: 0, maxCells: 0, pagesUsed: 0, totalPages: source?.pages?.length ?? 0 }
    }

    let cursor = 0, pagesUsed = 0, maxCells = 0
    const allGlyphs = []

    for (const page of source.pages) {
      if (cursor >= chars.length) break

      const baseCalibration = page.autoCalibration ?? TEMPLATE_CALIBRATION
      const pageCalibration = mergeCalibration(baseCalibration, calibration)

      // ใช้ cursor เป็น startIndex เสมอ — cellFrom จาก QR ใช้แค่ตรวจสอบว่าตรงกันไหม
      const startIndex = cursor
      const remainingChars = chars.length - startIndex

      let pageMaxCells
      // DEBUG: log pageMeta per page
      console.log(`[PAGE_DEBUG] page=${page.pageNumber} pageMeta=`, JSON.stringify(page.pageMeta), `cursor=${cursor} remainingChars=${remainingChars}`)
      if (page.pageMeta?.cellCount > 0) {
        pageMaxCells = Math.min(page.pageMeta.cellCount, remainingChars)
      } else {
        const geometry = getGridGeometry(
          page.pageWidth, page.pageHeight,
          Math.min(remainingChars, GRID_COLS * 6), pageCalibration
        )
        pageMaxCells = getPageCapacity(page.pageHeight, geometry.startY, geometry.cellHeight, geometry.gap)
        if (page.contiguousCount >= MIN_TRUSTED_INDEX_TARGETS)
          pageMaxCells = Math.min(pageMaxCells, page.contiguousCount)
        pageMaxCells = Math.min(pageMaxCells, remainingChars)
      }
      pageMaxCells = Math.min(pageMaxCells, GRID_COLS * 6)
      if (pageMaxCells <= 0) continue

      const pageCellFrom = startIndex + 1
      const hasGridLines = (page.regDots?.length ?? 0) >= 4
      let pageCellRects = hasGridLines
        ? buildOrderedCellRectsForPage(page, pageCellFrom, pageMaxCells)
        : null
      if (pageCellRects) {
        pageCellRects = pageCellRects.map(r => ({
          ...r, x: r.x + calibration.offsetX, y: r.y + calibration.offsetY,
        }))
      }

      const pageChars = chars.slice(startIndex, startIndex + pageMaxCells)
      if (pageChars.length === 0) continue

      const rawPageGlyphs = extractGlyphsFromCanvas({
        ctx:        page.ctx,
        pageWidth:  page.pageWidth,
        pageHeight: page.pageHeight,
        chars:      pageChars,
        calibration: pageCalibration,
        cellRects:  pageCellRects,
      })

      const pageGlyphs = rawPageGlyphs.map((g, i) => ({
        ...g,
        id:         `p${page.pageNumber}-${startIndex + i}-${g.ch}`,
        index:      startIndex + i + 1,
        pageNumber: page.pageNumber,
      }))

      for (const glyph of pageGlyphs) {
        allGlyphs.push(glyph)
      }
      cursor = startIndex + pageChars.length
      pagesUsed += 1
      maxCells  += pageMaxCells
    }

    allGlyphs.sort((a, b) => a.index - b.index)
    const glyphs = removedIds.size === 0 ? allGlyphs : allGlyphs.filter(g => !removedIds.has(g.id))
    return { glyphs, pageCharsCount: allGlyphs.length, maxCells, pagesUsed, totalPages: source.pages.length }
  }, [chars, pageVersion, calibration, removedIds, engineMode])

  // ── Feed analysisResult into tracedGlyphs automatically ─────────────────
  useEffect(() => {
    // DISABLE legacy processing when Vision Engine is active
    if (engineMode === "vision") return
    
    if (analysisResult.glyphs.length === 0) {
      setTracedGlyphs([])
      return
    }
    let canceled = false
    setTracing(true)
    traceAllGlyphs(analysisResult.glyphs).then(traced => {
      if (canceled) return
      setTracedGlyphs(traced)
      onGlyphsUpdate(traced)
      setTracing(false)
    })
    return () => { canceled = true }
  }, [analysisResult.glyphs, engineMode, onGlyphsUpdate])

  // ── Single source of truth: activeGlyphs ──────────────────────────────
  const activeGlyphs = useMemo(() => {
    if (engineMode === "vision" && visionEngineResults) {
      return visionEngineResults.glyphs
    }
    return tracedGlyphs
  }, [engineMode, visionEngineResults, tracedGlyphs])

  const displayGlyphs = useMemo(() => {
    return removedIds.size === 0 ? activeGlyphs : activeGlyphs.filter(g => !removedIds.has(g.id))
  }, [activeGlyphs, removedIds])

  const isPartialRead = useMemo(() => {
    return chars.length > activeGlyphs.length
  }, [chars.length, activeGlyphs.length])

  // ── Sync Vision Engine results to parent component ─────────────────────
  useEffect(() => {
    if (engineMode === "vision" && visionEngineResults) {
      onGlyphsUpdate(visionEngineResults.glyphs)
    }
  }, [engineMode, visionEngineResults, onGlyphsUpdate])

  // ── Reg-dot failure pages ─────────────────────────────────────────────────
  const regDotsFailedPages = useMemo(() => {
    const store = pageRef.current
    if (!store?.pages) return []
    return store.pages
      .map(p => ({ pageNumber: p.pageNumber, dotsCount: p.regDots?.length ?? 0 }))
      .filter(p => p.dotsCount < 4)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageVersion])



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

  const removeGlyph = glyph => {
    setRemovedIds(prev => { const n = new Set(prev); n.add(glyph.id); return n })
    if (activeId === glyph.id) setActiveId(null)
    if (zoomGlyph?.id === glyph.id) setZoomGlyph(null)
  }


  // ── Per-glyph re-crop with individual offset ──────────────────────────────
  // ข้าม Vision Engine preview (มักเป็น null/white) — crop ตรงจาก page canvas แทน
  const getAdjustedPreview = (glyph, offsetX = 0, offsetY = 0) => {
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
        return canvas.toDataURL('image/png')
      } catch (e) { /* fall through */ }
    }
    // fallback: ถ้าไม่มี _pageCtx ใช้ preview เดิม หรือ null
    return glyph.preview ?? null
  }

  const stStyle = {
    ok:       { border: C.sageMd,  bg: C.bgCard,  textColor: C.sage,  label: "OK" },
    missing:  { border: C.blushMd, bg: C.blushLt, textColor: C.blush, label: "Missing" },
    overflow: { border: C.amberMd, bg: C.amberLt, textColor: C.amber, label: "Overflow" },
    excellent: { border: C.sageMd,  bg: C.sageLt, textColor: C.sage, label: "ดีเยี่ยม" },
    good:     { border: C.sageMd, bg: C.sageLt, textColor: C.sage, label: "ดี" },
    acceptable: { border: C.amberMd, bg: C.amberLt, textColor: C.amber, label: "พอใช้" },
    poor:     { border: C.amberMd, bg: C.amberLt, textColor: C.amber, label: "แย่" },
    critical:  { border: C.blushMd, bg: C.blushLt, textColor: C.blush, label: "วิกฤต" },
    error:    { border: C.blushMd, bg: C.blushLt, textColor: C.blush, label: "ผิดพลาด" },
  }

  // ── Guards ────────────────────────────────────────────────────────
  console.log('=== STEP3 RENDER CHECK ===')
  console.log('ParsedFile exists:', !!parsedFile)
  console.log('About to check guard...')
  
  if (!parsedFile) {
    console.log('No parsedFile - showing guard message')
    return (
      <div className="fade-up">
        <InfoBox color="amber">กรุณาอัปโหลดไฟล์ PDF ใน Step 2 ก่อน</InfoBox>
      </div>
    )
  }
  
  console.log('ParsedFile exists - continuing to render...')

  if (chars.length === 0) {
    return (
      <div className="fade-up">
        <InfoBox color="amber">
          ไม่พบตัวอักษรจากไฟล์นี้ กลับ Step 2 เพื่อระบุตัวอักษรด้วยตนเอง
        </InfoBox>
      </div>
    )
  }

  // ── Main render ───────────────────────────────────────────────────────────
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
      <div style={{ display: "grid", gridTemplateColumns: engineMode === "vision" && visionEngineResults ? "repeat(auto-fit, minmax(80px, 1fr))" : "repeat(4,1fr)", gap: 10, marginBottom: 20 }}>
        {(engineMode === "vision" && visionEngineResults ? [
          { label: "ดีเยี่ยม", val: summary.excellent, color: C.sage },
          { label: "ดี", val: summary.good, color: C.sage },
          { label: "พอใช้", val: summary.acceptable, color: C.amber },
          { label: "แย่", val: summary.poor, color: C.amber },
          { label: "วิกฤต", val: summary.critical, color: C.blush },
          { label: "Overflow", val: summary.overflow, color: C.amber },
          { label: "หาย", val: summary.missing, color: C.blush },
          { label: "ทั้งหมด", val: summary.total, color: C.ink },
        ] : [
          { label: "OK", val: summary.ok, color: C.sage },
          { label: "Missing", val: summary.missing, color: C.blush },
          { label: "Overflow", val: summary.overflow, color: C.amber },
          { label: "ทั้งหมด", val: summary.total, color: C.ink },
        ]).map(s => {
          const style = stStyle[s.label] || stStyle.ok
          return (
            <div key={s.label} style={{ background: style.bg, border: `1px solid ${style.border}`, borderRadius: 12, padding: "12px 8px", textAlign: "center" }}>
              <p style={{ fontSize: (engineMode === "vision" && visionEngineResults) ? 18 : 22, fontWeight: 300, color: style.textColor, fontFamily: "'DM Serif Display',serif" }}>{s.val}</p>
              <p style={{ fontSize: 10, color: C.inkLt, marginTop: 4, letterSpacing: "0.05em" }}>{s.label}</p>
            </div>
          )
        })}
      </div>

      {/* Source info */}
      {parsedFile.charSource === "qr" && (
        <InfoBox color="sage">
          อ่านลำดับตัวอักษรจาก QR บนเทมเพลตแล้ว ({chars.length} ตัว)
        </InfoBox>
      )}
      {parsedFile.charSource === "manual" && (
        <InfoBox color="sage">
          ใช้ตัวอักษรที่ระบุเอง ({chars.length} ตัว)
        </InfoBox>
      )}

      <InfoBox color="amber">
        ถ้ากริดกับตัวเขียนไม่ตรง ให้ปรับ Grid Alignment ด้านล่างก่อน จากนั้นคลิกภาพเพื่อดูแบบขยาย
      </InfoBox>
      {isPartialRead && (
        <InfoBox color="amber">
          ตอนนี้ระบบอ่านได้ {analysisResult.pageCharsCount}/{chars.length} ตัว
          จาก {analysisResult.pagesUsed}/{analysisResult.totalPages} หน้า
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
            label="เลื่อนซ้าย/ขวา (X)" 
            value={calibration.offsetX}    
            min={-160} max={160} step={1} 
            onChange={v => setCalibration(p => ({ ...p, offsetX: v }))} 
          />
          <Adjuster 
            label="เลื่อนขึ้น/ลง (Y)"  
            value={calibration.offsetY}    
            min={-160} max={160} step={1} 
            onChange={v => setCalibration(p => ({ ...p, offsetY: v }))} 
          />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Adjuster 
            label="ขนาดช่อง (Cell)"    
            value={calibration.cellAdjust} 
            min={-48}  max={48}  step={1} 
            onChange={v => setCalibration(p => ({ ...p, cellAdjust: v }))} 
          />
          <Adjuster 
            label="ระยะห่างช่อง (Gap)" 
            value={calibration.gapAdjust}  
            min={-30}  max={30}  step={1} 
            onChange={v => setCalibration(p => ({ ...p, gapAdjust: v }))} 
          />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 12 }}>
          <div style={{ display: "flex", alignItems: "center", minHeight: 30 }}>
            {autoAligning
              ? <span style={{ fontSize: 11, color: C.amber }}>⟳ กำลัง re-extract ด้วย calibration ใหม่...</span>
              : autoInfo && <span style={{ fontSize: 11, color: C.inkLt }}>{autoInfo}</span>
            }
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Btn onClick={handleVisionEngineExtraction} variant="primary" size="sm" disabled={autoAligning || pipelineState === PipelineStates.EXTRACTING}>
              {autoAligning ? "กำลังประมวลผล..." : "ดึงด้วย Vision Engine"}
            </Btn>
            <Btn onClick={() => setRemovedIds(new Set())}                   variant="ghost"   size="sm" disabled={removedIds.size === 0}>คืนค่าตัวที่ลบ</Btn>
            <Btn onClick={() => setCalibration(ZERO_CALIBRATION)}        variant="ghost"   size="sm">รีเซ็ตกริด</Btn>
            <Btn onClick={() => setShowDebug(v => !v)}                      variant="ghost"   size="sm">{showDebug ? "ซ่อน Overlay" : "ดู Grid Overlay"}</Btn>
            <Btn onClick={() => setShowOverlay(v => !v)}                    variant="ghost"   size="sm">{showOverlay ? "ซ่อน Debug" : "Debug Overlay"}</Btn>
            <Btn onClick={() => setShowQADashboard(v => !v)}          variant="ghost"   size="sm">{showQADashboard ? "ซ่อน QA" : "QA Dashboard"}</Btn>
          </div>
        </div>
      </div>

      {/* Debug overlays */}
      {showDebug && (
        <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 14, padding: 14, marginBottom: 14 }}>
          <p style={{ fontSize: 11, color: C.inkLt, marginBottom: 10 }}>
            ภาพที่ crop จากแต่ละช่อง —{" "}
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

      {/* Glyph grid — คลิกการ์ดเพื่อปรับตำแหน่งเฉพาะตัว */}
      {displayGlyphs.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <p style={{ fontSize: 11, color: C.inkLt, marginBottom: 8 }}>
            คลิกที่การ์ดเพื่อเปิดตัวปรับตำแหน่งเฉพาะตัวอักษรนั้น
          </p>
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(88px,1fr))", gap: 8, marginBottom: 20 }}>
        {displayGlyphs.map(g => {
          const glyphStatus = g.confidence?.status || g.status
          const s = stStyle[glyphStatus] || stStyle.ok
          const isActive = activeId === g.id
          const hasOff = !!glyphOffsets[g.id]
          return (
            <div key={g.id} className="glyph-card" onClick={() => setActiveId(isActive ? null : g.id)}
              style={{ position: "relative", background: isActive ? C.bgMuted : s.bg, border: `1.5px solid ${isActive ? C.ink : s.border}`, borderRadius: 12, padding: "8px 6px", textAlign: "center", cursor: "pointer", outline: isActive ? `2px solid ${C.ink}` : "none", outlineOffset: 1 }}>
              {/* ปุ่มลบ */}
              <button type="button" onClick={e => { e.stopPropagation(); setRemovedIds(prev => { const n = new Set(prev); n.add(g.id); return n }) }}
                style={{ position: "absolute", top: 4, right: 4, width: 20, height: 20, borderRadius: 999, border: `1px solid ${C.border}`, background: "#fff", color: C.inkMd, fontSize: 10, cursor: "pointer", zIndex: 1 }}
                title="ลบช่องนี้">✕</button>
              {/* ภาพ glyph */}
              <button type="button" onClick={e => { e.stopPropagation(); const off = glyphOffsets[g.id] ?? {x:0,y:0}; setZoomGlyph({ ...g, preview: getAdjustedPreview(g, off.x, off.y) }) }}
                style={{ width: "100%", aspectRatio: "1", borderRadius: 8, background: C.bgCard, border: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", marginBottom: 6, padding: 4, cursor: "zoom-in" }}
                title="ดูภาพขยาย">
                <img src={getAdjustedPreview(g, glyphOffsets[g.id]?.x ?? 0, glyphOffsets[g.id]?.y ?? 0)} alt={`Glyph ${g.ch}`} style={{ width: "100%", height: "100%", objectFit: "contain", imageRendering: "auto" }} />
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
              {/* hint เฉพาะเมื่อ active */}
              {isActive && (
                <div style={{ position: "absolute", bottom: -1, left: 0, right: 0, background: C.ink, color: "#fff", fontSize: 8, borderRadius: "0 0 10px 10px", padding: "2px 0" }}>
                  ▼ ดูตัวปรับด้านล่าง
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Active glyph detail — with per-glyph offset controls */}
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
                ปรับตำแหน่งเฉพาะตัวอักษร: <b style={{ color: C.ink, textTransform: "none" }}>{activeGlyph.ch}</b>
                {" "}• HG{String(activeGlyph.index).padStart(3, "0")}
              </p>
              <div style={{ display: "flex", gap: 8 }}>
                {hasOffset && (
                  <Btn
                    size="sm" variant="ghost"
                    onClick={() => setGlyphOffsets(prev => { const n = { ...prev }; delete n[activeGlyph.id]; return n })}
                  >
                    รีเซ็ตตำแหน่ง
                  </Btn>
                )}
                <Btn size="sm" variant="ghost" onClick={() => setActiveId(null)}>ปิด</Btn>
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
                    ปรับแล้ว ({off.x > 0 ? "+" : ""}{off.x}, {off.y > 0 ? "+" : ""}{off.y})
                  </p>
                )}
                <div style={{ fontSize: 11, color: C.inkMd, lineHeight: 1.7, textAlign: "center" }}>
                  <div>สถานะ: <b style={{ color: C.sage }}>{activeGlyph.confidence?.status || activeGlyph.status}</b></div>
                  {activeGlyph.confidence ? (
                    <div>ความมั่นใจ: <b style={{ color: C.ink }}>{(activeGlyph.confidence.overall * 100).toFixed(1)}%</b></div>
                  ) : null}
                </div>
              </div>

              {/* Adjusters column */}
              <div style={{ flex: 1, padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
                <p style={{ fontSize: 11, color: C.inkLt, margin: 0 }}>
                  ปรับได้เฉพาะตัวนี้ ไม่กระทบกับตัวอื่น
                </p>
                <Adjuster
                  label="เลื่อนซ้าย / ขวา (X)"
                  value={off.x}
                  min={-80} max={80} step={1}
                  onChange={v => setOff("x", v)}
                />
                <Adjuster
                  label="เลื่อนขึ้น / ลง (Y)"
                  value={off.y}
                  min={-80} max={80} step={1}
                  onChange={v => setOff("y", v)}
                />
                {/* Arrow nudge buttons */}
                <div>
                  <p style={{ fontSize: 11, color: C.inkLt, marginBottom: 8 }}>กดเพื่อขยับทีละ 1px:</p>
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

      {/* Zoom modal — with inline per-glyph adjustment */}
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
                      HG{String(zoomGlyph.index).padStart(3, "0")} • ลำดับช่อง {zoomGlyph.index}
                    </span>
                  </p>
                  {hasOffset && (
                    <p style={{ fontSize: 11, color: C.amber, margin: "2px 0 0" }}>
                      ✎ ปรับแล้ว X: {off.x > 0 ? "+" : ""}{off.x}, Y: {off.y > 0 ? "+" : ""}{off.y}
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
                      รีเซ็ต
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
                      ปรับตำแหน่ง
                    </p>
                    <p style={{ fontSize: 11, color: C.inkLt, margin: "0 0 14px" }}>ปรับเฉพาะตัวนี้ ไม่กระทบตัวอื่น</p>

                    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                      <Adjuster
                        label="← ซ้าย / ขวา →"
                        value={off.x} min={-100} max={100} step={1}
                        onChange={v => setOff("x", v)}
                      />
                      <Adjuster
                        label="↑ ขึ้น / ลง ↓"
                        value={off.y} min={-100} max={100} step={1}
                        onChange={v => setOff("y", v)}
                      />
                    </div>
                  </div>

                  {/* D-pad nudge */}
                  <div>
                    <p style={{ fontSize: 11, color: C.inkLt, margin: "0 0 10px" }}>ขยับทีละ 1px:</p>
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
                    <div>สถานะ: <b style={{ color: C.ink }}>{zoomGlyph.confidence?.status || zoomGlyph.status}</b></div>
                    {zoomGlyph.confidence && (
                      <div>ความมั่นใจ: <b style={{ color: C.ink }}>{(zoomGlyph.confidence.overall * 100).toFixed(1)}%</b></div>
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