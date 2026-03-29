import { useEffect, useMemo, useRef, useState } from "react"
import { GlobalWorkerOptions, getDocument } from "pdfjs-dist"
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url"
import Btn from "../components/Btn"
import InfoBox from "../components/InfoBox"
import C from "../styles/colors"

GlobalWorkerOptions.workerSrc = pdfWorker

const GRID_COLS = 6
const GRID_CONFIG = {
  padXRatio: 0.075,
  topRatio: 0.19,
  bottomRatio: 0.08,
  gapRatio: 0.011,
  insetRatio: 0.06,
}

const DEFAULT_CALIBRATION = {
  offsetX: 0,
  offsetY: 0,
  cellAdjust: 0,
  gapAdjust: 0,
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function classifyGlyph(imageData, width, height) {
  const { data } = imageData
  let darkPixels = 0
  let borderDarkPixels = 0
  const border = Math.max(2, Math.floor(Math.min(width, height) * 0.12))

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (y * width + x) * 4
      const alpha = data[idx + 3]
      if (alpha < 12) continue

      const lum = data[idx] * 0.2126 + data[idx + 1] * 0.7152 + data[idx + 2] * 0.0722
      if (lum < 235) {
        darkPixels += 1
        if (x < border || x >= width - border || y < border || y >= height - border) {
          borderDarkPixels += 1
        }
      }
    }
  }

  const total = width * height
  const inkRatio = total > 0 ? darkPixels / total : 0
  const edgeRatio = darkPixels > 0 ? borderDarkPixels / darkPixels : 0

  if (inkRatio < 0.008) {
    return { status: "missing", inkRatio, edgeRatio }
  }

  if (edgeRatio > 0.32) {
    return { status: "overflow", inkRatio, edgeRatio }
  }

  return { status: "ok", inkRatio, edgeRatio }
}

function extractGlyphsFromCanvas({ ctx, pageWidth, pageHeight, chars, calibration }) {
  const baseGap = Math.max(6, pageWidth * GRID_CONFIG.gapRatio)
  const gap = Math.max(2, baseGap + calibration.gapAdjust)

  const workWidth = pageWidth * (1 - GRID_CONFIG.padXRatio * 2)
  const rows = Math.max(1, Math.ceil(chars.length / GRID_COLS))
  const baseCellSize = (workWidth - baseGap * (GRID_COLS - 1)) / GRID_COLS
  const cellSize = Math.max(24, baseCellSize + calibration.cellAdjust)
  const gridHeight = rows * cellSize + (rows - 1) * gap

  const baseStartX = pageWidth * GRID_CONFIG.padXRatio
  const desiredStartY = pageHeight * GRID_CONFIG.topRatio
  const maxStartY = pageHeight - pageHeight * GRID_CONFIG.bottomRatio - gridHeight
  const baseStartY = Math.max(0, Math.min(desiredStartY, maxStartY))

  const startX = baseStartX + calibration.offsetX
  const startY = baseStartY + calibration.offsetY

  return chars.map((ch, i) => {
    const row = Math.floor(i / GRID_COLS)
    const col = i % GRID_COLS

    const x = Math.round(startX + col * (cellSize + gap))
    const y = Math.round(startY + row * (cellSize + gap))
    const inset = Math.round(cellSize * GRID_CONFIG.insetRatio)
    const size = Math.max(20, Math.round(cellSize - inset * 2))

    const cropX = clamp(x + inset, 0, Math.max(0, pageWidth - size))
    const cropY = clamp(y + inset, 0, Math.max(0, pageHeight - size))

    const imageData = ctx.getImageData(cropX, cropY, size, size)
    const cropCanvas = document.createElement("canvas")
    cropCanvas.width = size
    cropCanvas.height = size
    const cropCtx = cropCanvas.getContext("2d")
    cropCtx?.putImageData(imageData, 0, 0)

    const { status, inkRatio, edgeRatio } = classifyGlyph(imageData, size, size)

    return {
      id: `${i}-${ch}`,
      index: i + 1,
      ch,
      status,
      inkRatio,
      edgeRatio,
      preview: cropCanvas.toDataURL("image/png"),
    }
  })
}

function Adjuster({ label, value, min, max, step, onChange }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ fontSize: 11, color: C.inkMd }}>{label}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={e => onChange(Number(e.target.value))}
          style={{ flex: 1 }}
        />
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={e => onChange(Number(e.target.value))}
          style={{
            width: 64,
            border: `1px solid ${C.border}`,
            borderRadius: 8,
            padding: "4px 6px",
            fontSize: 11,
            color: C.ink,
            background: C.bgCard,
          }}
        />
      </div>
    </label>
  )
}

export default function Step3({ selected, pdfFile, templateChars = [] }) {
  const chars = useMemo(
    () => (templateChars.length > 0 ? templateChars : [...selected]),
    [selected, templateChars]
  )

  const pageRef = useRef(null)
  const [pageVersion, setPageVersion] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [activeId, setActiveId] = useState(null)
  const [zoomGlyph, setZoomGlyph] = useState(null)
  const [removedIds, setRemovedIds] = useState(() => new Set())
  const [calibration, setCalibration] = useState(DEFAULT_CALIBRATION)

  useEffect(() => {
    let canceled = false

    if (!pdfFile) {
      pageRef.current = null
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

      ;(async () => {
        let loadingTask = null
        let pdf = null

        try {
          const bytes = new Uint8Array(await pdfFile.arrayBuffer())
          loadingTask = getDocument({ data: bytes })
          pdf = await loadingTask.promise

          const page = await pdf.getPage(1)
          const viewport = page.getViewport({ scale: 3 })
          const canvas = document.createElement("canvas")
          canvas.width = Math.floor(viewport.width)
          canvas.height = Math.floor(viewport.height)

          const ctx = canvas.getContext("2d", { willReadFrequently: true })
          if (!ctx) throw new Error("ไม่สามารถสร้าง canvas context ได้")

          ctx.fillStyle = "#ffffff"
          ctx.fillRect(0, 0, canvas.width, canvas.height)

          await page.render({ canvasContext: ctx, viewport }).promise

          if (canceled) return

          pageRef.current = {
            ctx,
            pageWidth: canvas.width,
            pageHeight: canvas.height,
          }
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
  }, [pdfFile])

  const glyphs = useMemo(() => {
    const sourceVersion = pageVersion
    if (sourceVersion < 0) return []

    const source = pageRef.current
    if (!source || chars.length === 0) return []

    const allGlyphs = extractGlyphsFromCanvas({
      ctx: source.ctx,
      pageWidth: source.pageWidth,
      pageHeight: source.pageHeight,
      chars,
      calibration,
    })

    if (removedIds.size === 0) return allGlyphs
    return allGlyphs.filter(g => !removedIds.has(g.id))
  }, [chars, pageVersion, calibration, removedIds])

  const summary = useMemo(() => {
    const ok = glyphs.filter(g => g.status === "ok").length
    const missing = glyphs.filter(g => g.status === "missing").length
    const overflow = glyphs.filter(g => g.status === "overflow").length
    return { ok, missing, overflow, total: glyphs.length }
  }, [glyphs])

  const activeGlyph = glyphs.find(g => g.id === activeId) || null

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
        <p style={{ fontSize: 11, color: C.inkLt }}>กำลังอ่านหน้าแรกและแบ่งตามกริดตัวอักษร</p>
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

      <InfoBox color="amber">
        ถ้าลำดับ 0-9 ไม่ตรง ให้ปรับ Grid Alignment ด้านล่างก่อน จากนั้นคลิกภาพเพื่อดูแบบขยาย
      </InfoBox>

      {error && <InfoBox color="amber">{error}</InfoBox>}

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
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
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
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill,minmax(88px,1fr))",
          gap: 8,
        }}
      >
        {glyphs.map(g => {
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
                ช่องที่ {activeGlyph.index} • เป้าหมาย: <b style={{ color: C.ink }}>{activeGlyph.ch}</b>
              </div>
              <div>
                สถานะ: <b style={{ color: stStyle[activeGlyph.status].textColor }}>{stStyle[activeGlyph.status].label}</b>
              </div>
              <div>
                Ink coverage: {(activeGlyph.inkRatio * 100).toFixed(2)}% • Border touch: {(activeGlyph.edgeRatio * 100).toFixed(2)}%
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
                ช่องที่ {zoomGlyph.index} • {zoomGlyph.ch}
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
              Ink coverage {(zoomGlyph.inkRatio * 100).toFixed(2)}% • Border touch {(zoomGlyph.edgeRatio * 100).toFixed(2)}%
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
