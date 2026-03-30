import { useEffect, useMemo, useRef, useState } from "react"
import { GlobalWorkerOptions, getDocument } from "pdfjs-dist"
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url"
import Btn from "../components/Btn"
import InfoBox from "../components/InfoBox"
import C from "../styles/colors"
import { buildAutoPageProfiles } from "../lib/step3/calibration.js"
import {
  DEFAULT_CALIBRATION,
  GRID_COLS,
  MIN_TRUSTED_INDEX_TARGETS,
  TEMPLATE_CALIBRATION,
} from "../lib/step3/constants.js"
import {
  extractGlyphsFromCanvas,
  getGridGeometry,
  getPageCapacity,
  traceAllGlyphs,
} from "../lib/step3/glyphPipeline.js"
import { collectTextAnchors } from "../lib/step3/pdfAnchors.js"
import { decodeQRFromImageData, extractCharsetIfCompleteInQr } from "../lib/step3/qr.js"
import { buildOrderedCellRectsForPage, detectRegDots } from "../lib/step3/regDots.js"
import { mergeCalibration } from "../lib/step3/utils.js"
import { Adjuster, GridDebugOverlay } from "./step3/Step3Panels.jsx"

GlobalWorkerOptions.workerSrc = pdfWorker

export default function Step3({ selected, pdfFile, templateChars = [], onGlyphsUpdate = () => {} }) {
  const fallbackChars = useMemo(
    () => (templateChars.length > 0 ? templateChars : [...selected]),
    [selected, templateChars]
  )
  const [charsFromPdfQr, setCharsFromPdfQr] = useState(null)
  const chars = useMemo(() => {
    if (charsFromPdfQr?.length) return charsFromPdfQr
    return fallbackChars
  }, [charsFromPdfQr, fallbackChars])

  const pageRef = useRef(null)
  const [pageVersion, setPageVersion] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [activeId, setActiveId] = useState(null)
  const [zoomGlyph, setZoomGlyph] = useState(null)
  const [removedIds, setRemovedIds] = useState(() => new Set())
  const [calibration, setCalibration] = useState(DEFAULT_CALIBRATION)
  const [autoAligning, setAutoAligning] = useState(false)
  const [autoInfo, setAutoInfo] = useState("")
  const [showDebug, setShowDebug] = useState(false)
  const [tracedGlyphs, setTracedGlyphs] = useState([])
  const [tracing, setTracing] = useState(false)

  const runAutoAlign = () => {
    const store = pageRef.current
    if (!store?.pages?.length || chars.length === 0) return

    setAutoAligning(true)
    window.setTimeout(() => {
      const pages = buildAutoPageProfiles(store.pages, chars)
      pageRef.current = { ...store, pages }

      const avgScore =
        pages.length > 0
          ? pages.reduce((sum, p) => sum + (Number.isFinite(p.autoScore) ? p.autoScore : 0), 0) /
            pages.length
          : Number.NaN
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

  useEffect(() => {
    let canceled = false

    if (!pdfFile) {
      pageRef.current = null
      setCharsFromPdfQr(null)
      return () => {
        canceled = true
      }
    }

    queueMicrotask(() => {
      if (canceled) return
      setLoading(true)
      setError("")
      setActiveId(null)
      setZoomGlyph(null)
      setRemovedIds(new Set())
      setCalibration(DEFAULT_CALIBRATION)
      setAutoInfo("")
      setCharsFromPdfQr(null)

      ;(async () => {
        let loadingTask = null
        let pdf = null

        try {
          if (!window.jsQR) {
            await new Promise((resolve, reject) => {
              const s = document.createElement("script")
              s.src = "https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js"
              s.onload = resolve
              s.onerror = reject
              document.head.appendChild(s)
            }).catch(() => {})
          }

          const bytes = new Uint8Array(await pdfFile.arrayBuffer())
          loadingTask = getDocument({ data: bytes })
          pdf = await loadingTask.promise

          const pages = []
          for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
            const page = await pdf.getPage(pageNumber)
            const viewport = page.getViewport({ scale: 3 })
            const canvas = document.createElement("canvas")
            canvas.width = Math.floor(viewport.width)
            canvas.height = Math.floor(viewport.height)

            const ctx = canvas.getContext("2d", { willReadFrequently: true })
            if (!ctx) throw new Error("ไม่สามารถสร้าง canvas context ได้")

            ctx.fillStyle = "#ffffff"
            ctx.fillRect(0, 0, canvas.width, canvas.height)

            await page.render({ canvasContext: ctx, viewport }).promise
            const anchorInfo = await collectTextAnchors(page, viewport, 9999)
            const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height)
            const qrMeta = decodeQRFromImageData(imgData.data, canvas.width, canvas.height)
            const regDots = detectRegDots(imgData.data, canvas.width, canvas.height)
            pages.push({
              ctx,
              pageWidth: canvas.width,
              pageHeight: canvas.height,
              imageData: imgData.data,
              regDots,
              gridLines: { vLines: [], hLines: [] },
              pageNumber,
              anchors: anchorInfo.anchors,
              anchorByIndex: anchorInfo.byIndex,
              anchorStartIndex: anchorInfo.startIndex,
              contiguousCount: anchorInfo.contiguousCount,
              hasCodeAnchors: anchorInfo.hasCodeAnchors,
              codeAnchorCount: anchorInfo.codeAnchorCount || 0,
              pageMeta: qrMeta
                ? { ...anchorInfo.pageMeta, ...qrMeta }
                : anchorInfo.pageMeta || null,
            })
          }

          if (canceled) return

          const qrCharset = extractCharsetIfCompleteInQr(pages)
          setCharsFromPdfQr(qrCharset)
          const profileChars = qrCharset?.length ? qrCharset : fallbackChars
          const profiledPages = buildAutoPageProfiles(pages, profileChars)
          pageRef.current = {
            pages: profiledPages,
            totalPages: profiledPages.length,
          }

          const avgScore =
            profiledPages.length > 0
              ? profiledPages.reduce(
                  (sum, p) => sum + (Number.isFinite(p.autoScore) ? p.autoScore : 0),
                  0
                ) / profiledPages.length
              : Number.NaN
          const anchorPages = profiledPages.filter(p => p.autoSource === "anchor").length
          const codeAnchorPages = profiledPages.filter(p => p.hasCodeAnchors).length
          setAutoInfo(
            Number.isFinite(avgScore)
              ? `Auto aligned ${profiledPages.length} pages (targets ${fallbackChars.length}, anchored ${anchorPages}, code ${codeAnchorPages}, avg score ${avgScore.toFixed(1)})`
              : `Auto aligned ${profiledPages.length} pages (targets ${fallbackChars.length}, anchored ${anchorPages}, code ${codeAnchorPages})`
          )
          setPageVersion(v => v + 1)
        } catch (err) {
          if (canceled) return
          setError(err?.message || "ไม่สามารถอ่านไฟล์ PDF ได้")
          pageRef.current = null
        } finally {
          if (pdf) {
            pdf.cleanup()
            await pdf.destroy()
          }
          loadingTask?.destroy()
          if (!canceled) setLoading(false)
        }
      })()
    })

    return () => {
      canceled = true
    }
  }, [pdfFile, fallbackChars])

  const analysisResult = useMemo(() => {
    const sourceVersion = pageVersion
    if (sourceVersion < 0) {
      return { glyphs: [], pageCharsCount: 0, maxCells: 0, pagesUsed: 0, totalPages: 0 }
    }

    const source = pageRef.current
    if (!source?.pages?.length || chars.length === 0) {
      return {
        glyphs: [],
        pageCharsCount: 0,
        maxCells: 0,
        pagesUsed: 0,
        totalPages: source?.pages?.length || 0,
      }
    }

    let cursor = 0
    let pagesUsed = 0
    let maxCells = 0
    const allGlyphs = []
    const usedIndices = new Set()

    for (const page of source.pages) {
      if (cursor >= chars.length) break

      const baseCalibration = TEMPLATE_CALIBRATION
      const pageCalibration = mergeCalibration(baseCalibration, calibration)

      const startIndex = page.pageMeta?.cellFrom > 0 ? page.pageMeta.cellFrom - 1 : cursor

      let pageMaxCells
      if (page.pageMeta?.cellCount > 0) {
        pageMaxCells = Math.min(page.pageMeta.cellCount, chars.length - startIndex)
      } else {
        const geometry = getGridGeometry(
          page.pageWidth,
          page.pageHeight,
          Math.min(chars.length - startIndex, 24),
          pageCalibration
        )
        pageMaxCells = getPageCapacity(
          page.pageHeight,
          geometry.startY,
          geometry.cellSize,
          geometry.gap
        )
        if (page.anchorCapacity >= MIN_TRUSTED_INDEX_TARGETS) {
          pageMaxCells = Math.min(pageMaxCells, page.anchorCapacity)
        }
        pageMaxCells = Math.min(pageMaxCells, chars.length - startIndex)
      }
      pageMaxCells = Math.min(pageMaxCells, GRID_COLS * 6)
      if (pageMaxCells <= 0) continue

      const pageCellFrom = page.pageMeta?.cellFrom > 0 ? page.pageMeta.cellFrom : startIndex + 1
      const hasGridLines = (page.regDots?.length ?? 0) >= 4
      let pageCellRects = hasGridLines
        ? buildOrderedCellRectsForPage(page, pageCellFrom, pageMaxCells)
        : null
      if (pageCellRects) {
        pageCellRects = pageCellRects.map(r => ({
          ...r,
          x: r.x + calibration.offsetX,
          y: r.y + calibration.offsetY,
        }))
      }

      const pageChars = chars.slice(startIndex, startIndex + pageMaxCells)
      if (pageChars.length === 0) continue

      const rawPageGlyphs = extractGlyphsFromCanvas({
        ctx: page.ctx,
        pageWidth: page.pageWidth,
        pageHeight: page.pageHeight,
        chars: pageChars,
        calibration: pageCalibration,
        cellRects: pageCellRects,
      })

      const pageGlyphs = rawPageGlyphs.map((g, i) => ({
        ...g,
        id: `p${page.pageNumber}-${startIndex + i}-${g.ch}`,
        index: startIndex + i + 1,
        pageNumber: page.pageNumber,
      }))

      for (const glyph of pageGlyphs) {
        if (usedIndices.has(glyph.index)) continue
        usedIndices.add(glyph.index)
        allGlyphs.push(glyph)
      }
      cursor = Math.max(cursor, startIndex + pageChars.length)
      pagesUsed += 1
      maxCells += pageMaxCells
    }

    allGlyphs.sort((a, b) => a.index - b.index)

    const glyphs =
      removedIds.size === 0 ? allGlyphs : allGlyphs.filter(g => !removedIds.has(g.id))
    return {
      glyphs,
      pageCharsCount: allGlyphs.length,
      maxCells,
      pagesUsed,
      totalPages: source.pages.length,
    }
  }, [chars, pageVersion, calibration, removedIds])

  const glyphs = analysisResult.glyphs
  const isPartialRead = chars.length > analysisResult.pageCharsCount

  const regDotsFailedPages = useMemo(() => {
    const store = pageRef.current
    if (!store?.pages) return []
    return store.pages
      .map(p => ({ pageNumber: p.pageNumber, dotsCount: p.regDots?.length ?? 0 }))
      .filter(p => p.dotsCount < 4)
  // eslint-disable-next-line react-hooks/exhaustive-deps -- pageVersion invalidates when pageRef store updates
  }, [pageVersion])

  useEffect(() => {
    if (glyphs.length === 0) {
      setTracedGlyphs([])
      return
    }
    let canceled = false
    setTracing(true)
    traceAllGlyphs(glyphs).then(traced => {
      if (canceled) return
      setTracedGlyphs(traced)
      setTracing(false)
    })
    return () => {
      canceled = true
    }
  }, [glyphs])

  const displayGlyphs = tracedGlyphs.length > 0 ? tracedGlyphs : glyphs

  const summary = useMemo(() => {
    const ok = displayGlyphs.filter(g => g.status === "ok").length
    const missing = displayGlyphs.filter(g => g.status === "missing").length
    const overflow = displayGlyphs.filter(g => g.status === "overflow").length
    return { ok, missing, overflow, total: displayGlyphs.length }
  }, [displayGlyphs])

  const activeGlyph = displayGlyphs.find(g => g.id === activeId) || null

  useEffect(() => {
    onGlyphsUpdate(displayGlyphs)
  }, [displayGlyphs, onGlyphsUpdate])

  const stStyle = {
    ok: { border: C.sageMd, bg: C.bgCard, textColor: C.sage, label: "OK" },
    missing: { border: C.blushMd, bg: C.blushLt, textColor: C.blush, label: "Missing" },
    overflow: { border: C.amberMd, bg: C.amberLt, textColor: C.amber, label: "Overflow" },
  }

  const removeGlyph = glyph => {
    setRemovedIds(prev => {
      const next = new Set(prev)
      next.add(glyph.id)
      return next
    })
    if (activeId === glyph.id) setActiveId(null)
    if (zoomGlyph?.id === glyph.id) setZoomGlyph(null)
  }

  if (!pdfFile) {
    return (
      <div className="fade-up">
        <InfoBox color="amber">กรุณาอัปโหลดไฟล์ PDF ใน Step 2 ก่อน เพื่อให้ระบบอ่านลายมือในแต่ละช่อง</InfoBox>
      </div>
    )
  }

  if (chars.length === 0) {
    return (
      <div className="fade-up">
        <InfoBox color="amber">
          ไม่พบ target ช่องจากไฟล์ PDF นี้ (HG/เลขช่อง) คุณสามารถใช้ไฟล์ template ที่มีรหัสช่อง
          หรือเลือกตัวอักษรใน Step 1 เป็นโหมดสำรองได้
        </InfoBox>
      </div>
    )
  }

  if (loading) {
    return (
      <div
        className="fade-up"
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "60px 0",
          gap: 16,
        }}
      >
        <div className="spinner" />
        <p style={{ fontSize: 13, color: C.inkMd }}>กำลังแยกภาพตัวเขียนจากไฟล์ PDF...</p>
        <p style={{ fontSize: 11, color: C.inkLt }}>กำลังอ่านทุกหน้าและแบ่งตามกริดตัวอักษร</p>
      </div>
    )
  }

  return (
    <div className="fade-up">
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4,1fr)",
          gap: 10,
          marginBottom: 20,
        }}
      >
        {[
          { label: "OK", val: summary.ok, color: C.sage },
          { label: "Missing", val: summary.missing, color: C.blush },
          { label: "Overflow", val: summary.overflow, color: C.amber },
          { label: "ทั้งหมด", val: summary.total, color: C.ink },
        ].map(s => (
          <div
            key={s.label}
            style={{
              background: C.bgCard,
              border: `1px solid ${C.border}`,
              borderRadius: 12,
              padding: "12px 8px",
              textAlign: "center",
            }}
          >
            <p
              style={{
                fontSize: 22,
                fontWeight: 300,
                color: s.color,
                fontFamily: "'DM Serif Display', serif",
              }}
            >
              {s.val}
            </p>
            <p style={{ fontSize: 10, color: C.inkLt, marginTop: 4, letterSpacing: "0.05em" }}>
              {s.label}
            </p>
          </div>
        ))}
      </div>

      {charsFromPdfQr?.length > 0 && (
        <InfoBox color="sage">
          อ่านลำดับตัวอักษรจาก QR บนเทมเพลตแล้ว (ตรงกับ PDF ตอนสร้าง) — เทมเพลตเก่าที่ยังไม่มีข้อมูลนี้ใน QR
          ระบบยังใช้ตัวที่เลือกใน Step 1 ตามเดิม
        </InfoBox>
      )}

      {regDotsFailedPages.length > 0 && (
        <InfoBox color="amber">
          ⚠️ reg dots ไม่พอในหน้า{" "}
          {regDotsFailedPages.map(p => `${p.pageNumber} (${p.dotsCount} จุด)`).join(", ")} —
          ตรวจสอบว่า PDF print จาก template ที่สร้างโดย app นี้
        </InfoBox>
      )}

      <InfoBox color="amber">
        ถ้ากริดกับตัวเขียวไม่ตรง ให้ปรับ Grid Alignment ด้านล่างก่อน จากนั้นคลิกภาพเพื่อดูแบบขยาย
      </InfoBox>
      {isPartialRead && (
        <InfoBox color="amber">
          ตอนนี้ระบบอ่านได้ {analysisResult.pageCharsCount}/{chars.length} ตัว จาก{" "}
          {analysisResult.pagesUsed}/{analysisResult.totalPages} หน้า
        </InfoBox>
      )}

      {error && <InfoBox color="amber">{error}</InfoBox>}

      {tracing && <InfoBox color="sage">⏳ กำลัง trace SVG จากลายมือ… รอแป๊บนึงนะ</InfoBox>}
      {!tracing && displayGlyphs.length > 0 && displayGlyphs.some(g => g.svgPath) && (
        <InfoBox color="sage">
          ✅ Trace SVG สำเร็จ {displayGlyphs.filter(g => g.svgPath).length}/{displayGlyphs.length}{" "}
          ตัว — Step 4 พร้อมดัด vector แล้ว
        </InfoBox>
      )}

      <div
        style={{
          background: C.bgCard,
          border: `1px solid ${C.border}`,
          borderRadius: 14,
          padding: "14px 16px",
          marginBottom: 14,
        }}
      >
        <p
          style={{
            fontSize: 11,
            fontWeight: 500,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: C.inkLt,
            marginBottom: 10,
          }}
        >
          Grid Alignment
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Adjuster
            label="เลื่อนซ้าย/ขวา (X)"
            value={calibration.offsetX}
            min={-160}
            max={160}
            step={1}
            onChange={v => setCalibration(prev => ({ ...prev, offsetX: v }))}
          />
          <Adjuster
            label="เลื่อนขึ้น/ลง (Y)"
            value={calibration.offsetY}
            min={-160}
            max={160}
            step={1}
            onChange={v => setCalibration(prev => ({ ...prev, offsetY: v }))}
          />
          <Adjuster
            label="ขนาดช่อง (Cell)"
            value={calibration.cellAdjust}
            min={-48}
            max={48}
            step={1}
            onChange={v => setCalibration(prev => ({ ...prev, cellAdjust: v }))}
          />
          <Adjuster
            label="ระยะห่างช่อง (Gap)"
            value={calibration.gapAdjust}
            min={-30}
            max={30}
            step={1}
            onChange={v => setCalibration(prev => ({ ...prev, gapAdjust: v }))}
          />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 12 }}>
          <div style={{ display: "flex", alignItems: "center", minHeight: 30 }}>
            {autoInfo && <span style={{ fontSize: 11, color: C.inkLt }}>{autoInfo}</span>}
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <Btn onClick={runAutoAlign} variant="primary" size="sm" disabled={autoAligning}>
              {autoAligning ? "กำลังจัดอัตโนมัติ..." : "จัดอัตโนมัติ"}
            </Btn>
            <Btn
              onClick={() => setRemovedIds(new Set())}
              variant="ghost"
              size="sm"
              disabled={removedIds.size === 0}
            >
              คืนค่าตัวที่ลบ
            </Btn>
            <Btn onClick={() => setCalibration(DEFAULT_CALIBRATION)} variant="ghost" size="sm">
              รีเซ็ตกริด
            </Btn>
            <Btn onClick={() => setShowDebug(v => !v)} variant="ghost" size="sm">
              {showDebug ? "ซ่อน Overlay" : "ดู Grid Overlay"}
            </Btn>
          </div>
        </div>
      </div>

      {showDebug && (
        <div
          style={{
            background: C.bgCard,
            border: `1px solid ${C.border}`,
            borderRadius: 14,
            padding: 14,
            marginBottom: 14,
          }}
        >
          <p style={{ fontSize: 11, color: C.inkLt, marginBottom: 10 }}>
            ภาพที่ crop จากแต่ละช่อง — ขอบสีแสดงสถานะ:{" "}
            <span style={{ color: "#00a046" }}>●</span> OK &nbsp;{" "}
            <span style={{ color: "#c83c3c" }}>●</span> Missing &nbsp;{" "}
            <span style={{ color: "#c88c00" }}>●</span> Overflow
          </p>
          <GridDebugOverlay glyphs={displayGlyphs} />
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill,minmax(88px,1fr))",
          gap: 8,
        }}
      >
        {displayGlyphs.map(g => {
          const s = stStyle[g.status]
          const isActive = activeId === g.id

          return (
            <div
              key={g.id}
              className="glyph-card"
              onClick={() => setActiveId(isActive ? null : g.id)}
              style={{
                position: "relative",
                background: s.bg,
                border: `1.5px solid ${isActive ? C.ink : s.border}`,
                borderRadius: 12,
                padding: "8px 6px",
                textAlign: "center",
                cursor: "pointer",
                outline: "none",
              }}
            >
              <button
                type="button"
                onClick={e => {
                  e.stopPropagation()
                  removeGlyph(g)
                }}
                style={{
                  position: "absolute",
                  top: 4,
                  right: 4,
                  width: 20,
                  height: 20,
                  borderRadius: 999,
                  border: `1px solid ${C.border}`,
                  background: "#fff",
                  color: C.inkMd,
                  fontSize: 10,
                  cursor: "pointer",
                }}
                title="ลบช่องนี้"
              >
                ลบ
              </button>

              <button
                type="button"
                onClick={e => {
                  e.stopPropagation()
                  setZoomGlyph(g)
                }}
                style={{
                  width: "100%",
                  aspectRatio: "1",
                  borderRadius: 8,
                  background: C.bgCard,
                  border: `1px solid ${C.border}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  overflow: "hidden",
                  marginBottom: 6,
                  padding: 4,
                  cursor: "zoom-in",
                }}
                title="ดูภาพขยาย"
              >
                <img
                  src={g.preview}
                  alt={`Glyph ${g.ch}`}
                  style={{ width: "100%", height: "100%", objectFit: "contain", imageRendering: "auto" }}
                />
              </button>

              <p style={{ fontSize: 12, fontWeight: 500, color: C.ink }}>{g.ch}</p>
              <p style={{ fontSize: 9, color: C.inkLt, marginTop: 1 }}>
                HG{String(g.index).padStart(3, "0")}
              </p>
              <p style={{ fontSize: 10, color: s.textColor, marginTop: 2 }}>{s.label}</p>
            </div>
          )
        })}
      </div>

      {activeGlyph && (
        <div
          style={{
            marginTop: 16,
            padding: "14px 16px",
            background: C.bgCard,
            border: `1px solid ${C.border}`,
            borderRadius: 12,
            fontSize: 12,
            color: C.inkMd,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div
              style={{
                width: 88,
                height: 88,
                borderRadius: 10,
                border: `1px solid ${C.border}`,
                background: C.bgMuted,
                padding: 6,
                cursor: "zoom-in",
              }}
              onClick={() => setZoomGlyph(activeGlyph)}
              title="ดูภาพขยาย"
            >
              <img
                src={activeGlyph.preview}
                alt={`Preview ${activeGlyph.ch}`}
                style={{ width: "100%", height: "100%", objectFit: "contain" }}
              />
            </div>
            <div style={{ lineHeight: 1.8 }}>
              <div>
                เป้าหมาย: <b style={{ color: C.ink }}>{activeGlyph.ch}</b> • ลำดับช่อง {activeGlyph.index}
              </div>
              <div>
                รหัสช่อง:{" "}
                <b style={{ color: C.ink }}>HG{String(activeGlyph.index).padStart(3, "0")}</b>
              </div>
              <div>
                สถานะ:{" "}
                <b style={{ color: stStyle[activeGlyph.status].textColor }}>
                  {stStyle[activeGlyph.status].label}
                </b>
              </div>
              <div>
                Ink coverage: {(activeGlyph.inkRatio * 100).toFixed(2)}% • Border touch:{" "}
                {(activeGlyph.edgeRatio * 100).toFixed(2)}%
              </div>
            </div>
          </div>
        </div>
      )}

      {zoomGlyph && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setZoomGlyph(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(21, 19, 14, 0.72)",
            zIndex: 1000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              width: "min(680px, 94vw)",
              borderRadius: 16,
              background: "#fff",
              border: `1px solid ${C.border}`,
              padding: 18,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}>
              <p style={{ fontSize: 14, fontWeight: 600, color: C.ink }}>
                ตัวอักษรเป้าหมาย: {zoomGlyph.ch} • ลำดับช่อง {zoomGlyph.index}
              </p>
              <button
                type="button"
                onClick={() => setZoomGlyph(null)}
                style={{
                  marginLeft: "auto",
                  border: `1px solid ${C.border}`,
                  borderRadius: 8,
                  background: C.bgCard,
                  padding: "4px 10px",
                  fontSize: 12,
                  cursor: "pointer",
                  color: C.ink,
                }}
              >
                ปิด
              </button>
            </div>
            <div
              style={{
                borderRadius: 12,
                border: `1px solid ${C.border}`,
                background: C.bgMuted,
                padding: 12,
                display: "flex",
                justifyContent: "center",
              }}
            >
              <img
                src={zoomGlyph.preview}
                alt={`Zoom ${zoomGlyph.ch}`}
                style={{
                  width: "min(520px, 82vw)",
                  height: "auto",
                  objectFit: "contain",
                  imageRendering: "auto",
                }}
              />
            </div>
            <p style={{ marginTop: 10, fontSize: 12, color: C.inkMd }}>
              Ink coverage {(zoomGlyph.inkRatio * 100).toFixed(2)}% • Border touch{" "}
              {(zoomGlyph.edgeRatio * 100).toFixed(2)}%
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
