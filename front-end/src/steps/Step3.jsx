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

export default function Step3({ parsedFile, onGlyphsUpdate = () => {} }) {
  // ── Guard: should never render without parsedFile, but be safe ────────────
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

  const pageRef = useRef(null)
  const stateMachineRef = useRef(null)
  const workerAdapterRef = useRef(null)

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
    
    // Store for global access
    window.__stateMachine = stateMachine
    window.__workerAdapter = workerAdapter
    
    return () => {
      unsubscribe()
      telemetryUnsubscribe()
      workerAdapter.cleanup()
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

  // NEW: Engine event handlers (no business logic)
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
      
      const result = await Step3Controller.executeFullPipeline(pageData, calibration)
      setTracedGlyphs(result)
      onGlyphsUpdate(result)
      
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
  }, [chars, calibration, onGlyphsUpdate])

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
  }, [chars, pageVersion, calibration, removedIds])

  // ── Feed analysisResult into tracedGlyphs automatically ─────────────────
  useEffect(() => {
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
  }, [analysisResult.glyphs])

  const displayGlyphs = useMemo(() => {
    return removedIds.size === 0 ? tracedGlyphs : tracedGlyphs.filter(g => !removedIds.has(g.id))
  }, [tracedGlyphs, removedIds])

  const isPartialRead = useMemo(() => {
    return chars.length > tracedGlyphs.length
  }, [chars.length, tracedGlyphs.length])

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
    const ok = displayGlyphs.filter(g => g.status === "ok").length
    const missing = displayGlyphs.filter(g => g.status === "missing").length
    const overflow = displayGlyphs.filter(g => g.status === "overflow").length
    return { ok, missing, overflow, total: displayGlyphs.length }
  }, [displayGlyphs])

  const activeGlyph = useMemo(() => 
    displayGlyphs.find(g => g.id === activeId) ?? null, 
    [displayGlyphs, activeId]
  )

  const removeGlyph = glyph => {
    setRemovedIds(prev => { const n = new Set(prev); n.add(glyph.id); return n })
    if (activeId === glyph.id) setActiveId(null)
    if (zoomGlyph?.id === glyph.id) setZoomGlyph(null)
  }

  const stStyle = {
    ok:       { border: C.sageMd,  bg: C.bgCard,  textColor: C.sage,  label: "OK" },
    missing:  { border: C.blushMd, bg: C.blushLt, textColor: C.blush, label: "Missing" },
    overflow: { border: C.amberMd, bg: C.amberLt, textColor: C.amber, label: "Overflow" },
  }

  // ── Guards ────────────────────────────────────────────────────────────────
  if (!parsedFile) {
    return (
      <div className="fade-up">
        <InfoBox color="amber">กรุณาอัปโหลดไฟล์ PDF ใน Step 2 ก่อน</InfoBox>
      </div>
    )
  }

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
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, marginBottom: 20 }}>
        {[
          { label: "OK", val: summary.ok, color: C.sage },
          { label: "Missing", val: summary.missing, color: C.blush },
          { label: "Overflow", val: summary.overflow, color: C.amber },
          { label: "ทั้งหมด", val: summary.total, color: C.ink },
        ].map(s => (
          <div key={s.label} style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 12, padding: "12px 8px", textAlign: "center" }}>
            <p style={{ fontSize: 22, fontWeight: 300, color: s.color, fontFamily: "'DM Serif Display',serif" }}>{s.val}</p>
            <p style={{ fontSize: 10, color: C.inkLt, marginTop: 4, letterSpacing: "0.05em" }}>{s.label}</p>
          </div>
        ))}
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
            {autoInfo && <span style={{ fontSize: 11, color: C.inkLt }}>{autoInfo}</span>}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Btn onClick={handleAutoAlign}                                     variant="primary" size="sm" disabled={autoAligning || pipelineState === PipelineStates.EXTRACTING}>{autoAligning ? "กำลังจัดอัตโนมัติ..." : "จัดอัตโนมัติ"}</Btn>
            <Btn onClick={() => setRemovedIds(new Set())}                   variant="ghost"   size="sm" disabled={removedIds.size === 0}>คืนค่าตัวที่ลบ</Btn>
            <Btn onClick={() => setCalibration(ZERO_CALIBRATION)}        variant="ghost"   size="sm">รีเซ็ตกริด</Btn>
            <Btn onClick={() => setShowDebug(v => !v)}                      variant="ghost"   size="sm">{showDebug ? "ซ่อน Overlay" : "ดู Grid Overlay"}</Btn>
            <Btn onClick={() => setShowOverlay(v => !v)}                    variant="ghost"   size="sm">{showOverlay ? "ซ่อน Debug" : "Debug Overlay"}</Btn>
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

      {/* Glyph grid - now state-driven */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(88px,1fr))", gap: 8 }}>
        {displayGlyphs.map(g => {
          const s = stStyle[g.status]
          const isActive = activeId === g.id
          return (
            <div key={g.id} className="glyph-card" onClick={() => setActiveId(isActive ? null : g.id)}
              style={{ position: "relative", background: s.bg, border: `1.5px solid ${isActive ? C.ink : s.border}`, borderRadius: 12, padding: "8px 6px", textAlign: "center", cursor: "pointer" }}>
              <button type="button" onClick={e => { e.stopPropagation(); setRemovedIds(prev => { const n = new Set(prev); n.add(g.id); return n }) }}
                style={{ position: "absolute", top: 4, right: 4, width: 20, height: 20, borderRadius: 999, border: `1px solid ${C.border}`, background: "#fff", color: C.inkMd, fontSize: 10, cursor: "pointer" }}
                title="ลบช่องนี้">ลบ</button>
              <button type="button" onClick={e => { e.stopPropagation(); setZoomGlyph(g) }}
                style={{ width: "100%", aspectRatio: "1", borderRadius: 8, background: C.bgCard, border: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", marginBottom: 6, padding: 4, cursor: "zoom-in" }}
                title="ดูภาพขยาย">
                <img src={g.preview} alt={`Glyph ${g.ch}`} style={{ width: "100%", height: "100%", objectFit: "contain", imageRendering: "auto" }} />
              </button>
              <p style={{ fontSize: 12, fontWeight: 500, color: C.ink }}>{g.ch}</p>
              <p style={{ fontSize: 9, color: C.inkLt, marginTop: 1 }}>HG{String(g.index).padStart(3,"0")}</p>
              <p style={{ fontSize: 10, color: s.textColor, marginTop: 2 }}>{s.label}</p>
            </div>
          )
        })}
      </div>

      {/* Active glyph detail */}
      {activeGlyph && (
        <div style={{ marginTop: 16, padding: "14px 16px", background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 12, fontSize: 12, color: C.inkMd }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 88, height: 88, borderRadius: 10, border: `1px solid ${C.border}`, background: C.bgMuted, padding: 6, cursor: "zoom-in" }} onClick={() => setZoomGlyph(activeGlyph)}>
              <img src={activeGlyph.preview} alt={`Preview ${activeGlyph.ch}`} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
            </div>
            <div style={{ lineHeight: 1.8 }}>
              <div>เป้าหมาย: <b style={{ color: C.ink }}>{activeGlyph.ch}</b> • ลำดับช่อง {activeGlyph.index}</div>
              <div>รหัสช่อง: <b style={{ color: C.ink }}>HG{String(activeGlyph.index).padStart(3,"0")}</b></div>
              <div>สถานะ: <b style={{ color: C.sage }}>OK</b></div>
              <div>Ink coverage: {(activeGlyph.inkRatio * 100).toFixed(2)}% • Border touch: {(activeGlyph.edgeRatio * 100).toFixed(2)}%</div>
            </div>
          </div>
        </div>
      )}

      {/* Zoom modal */}
      {zoomGlyph && (
        <div role="dialog" aria-modal="true" onClick={() => setZoomGlyph(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(21,19,14,.72)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div onClick={e => e.stopPropagation()} style={{ width: "min(680px,94vw)", borderRadius: 16, background: "#fff", border: `1px solid ${C.border}`, padding: 18 }}>
            <div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}>
              <p style={{ fontSize: 14, fontWeight: 600, color: C.ink }}>ตัวอักษรเป้าหมาย: {zoomGlyph.ch} • ลำดับช่อง {zoomGlyph.index}</p>
              <button type="button" onClick={() => setZoomGlyph(null)}
                style={{ marginLeft: "auto", border: `1px solid ${C.border}`, borderRadius: 8, background: C.bgCard, padding: "4px 10px", fontSize: 12, cursor: "pointer", color: C.ink }}>ปิด</button>
            </div>
            <div style={{ borderRadius: 12, border: `1px solid ${C.border}`, background: C.bgMuted, padding: 12, display: "flex", justifyContent: "center" }}>
              <img src={zoomGlyph.preview} alt={`Zoom ${zoomGlyph.ch}`} style={{ width: "min(520px,82vw)", height: "auto", objectFit: "contain" }} />
            </div>
            <p style={{ marginTop: 10, fontSize: 12, color: C.inkMd }}>
              Ink coverage {(zoomGlyph.inkRatio * 100).toFixed(2)}% • Border touch {(zoomGlyph.edgeRatio * 100).toFixed(2)}%
            </p>
          </div>
        </div>
      )}
    </div>
  )
}