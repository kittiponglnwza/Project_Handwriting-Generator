import { useEffect, useRef } from "react"
import C from "../../styles/colors"
import { GRID_GEOMETRY, GRID_COLS } from "../../lib/step3/constants.js"
import { clamp } from "../../lib/step3/utils.js"
import { buildOrderedCellRectsForPage, buildCellRectsFromDots, sortCellRectsReadingOrder } from "../../lib/step3/regDots.js"

export function Adjuster({ label, value, min, max, step, onChange }) {
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

export function GridDebugOverlay({ glyphs }) {
  const stStyle = {
    ok:       { border: "rgba(0,160,70,0.5)",   bg: "rgba(0,200,80,0.06)",   dot: "#00a046" },
    missing:  { border: "rgba(200,60,60,0.5)",  bg: "rgba(255,80,80,0.06)",  dot: "#c83c3c" },
    overflow: { border: "rgba(200,140,0,0.5)",  bg: "rgba(255,180,0,0.06)",  dot: "#c88c00" },
  }

  if (!glyphs?.length)
    return <p style={{ fontSize: 11, color: C.inkLt, padding: "8px 0" }}>ยังไม่มีข้อมูล glyph</p>

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(72px, 1fr))", gap: 6 }}>
      {glyphs.map(g => {
        const s = stStyle[g.status] || stStyle.ok
        return (
          <div key={g.id} style={{ background: s.bg, border: `1.5px solid ${s.border}`, borderRadius: 8, padding: "6px 4px 5px", display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
            <div style={{ width: "100%", aspectRatio: "1", background: "#fff", borderRadius: 5, display: "flex", alignItems: "center", justifyContent: "center" }}>
              {g.svgPath ? (
                <svg viewBox={g.viewBox || "0 0 100 100"} style={{ width: "88%", height: "88%", overflow: "visible" }}>
                  <path d={g.svgPath} fill="none" stroke={C.ink} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : (
                <span style={{ fontSize: 9, color: C.inkLt }}>—</span>
              )}
            </div>
            <p style={{ fontSize: 13, fontWeight: 600, color: C.ink, lineHeight: 1 }}>{g.ch}</p>
            <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: s.dot, flexShrink: 0 }} />
              <p style={{ fontSize: 9, color: C.inkLt }}>#{g.index}</p>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── PageDebugOverlay ────────────────────────────────────────────────────────
// แสดง canvas ของแต่ละหน้าพร้อม overlay:
//   🟢 green = outer cell rect (จาก regDots จริง หรือ fallback geometry)
//   🔵 blue  = crop zone (หลัง inset)

export function PageDebugOverlay({ pages, calibration, chars, getGridGeometry }) {
  if (!pages?.length)
    return <p style={{ fontSize: 11, color: C.inkLt }}>ยังไม่มีข้อมูลหน้า</p>

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 10, fontSize: 11, color: C.inkMd }}>
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 14, height: 14, border: "2px solid #22c55e", borderRadius: 2, display: "inline-block" }} />
          outer cell
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 14, height: 14, border: "2px solid #3b82f6", borderRadius: 2, display: "inline-block" }} />
          crop zone — ปรับ slider แล้ว overlay อัปเดตตาม
        </div>
      </div>
      <div style={{ display: "flex", gap: 12, overflowX: "auto", paddingBottom: 8 }}>
        {pages.map((page, pi) => {
          // หา cursor จริงจาก pageMeta ถ้ามี ไม่งั้นใช้ sequential
          const pageCharsStart = page.pageMeta?.cellFrom > 0
            ? page.pageMeta.cellFrom - 1
            : pi * GRID_COLS * 6
          const pageCount = page.pageMeta?.cellCount > 0
            ? page.pageMeta.cellCount
            : GRID_COLS * 6
          const pageChars = chars.slice(pageCharsStart, pageCharsStart + pageCount)
          if (pageChars.length === 0) return null
          return (
            <PageCanvas
              key={page.pageNumber}
              page={page}
              pageChars={pageChars}
              pageCharsStart={pageCharsStart}
              calibration={calibration}
              getGridGeometry={getGridGeometry}
            />
          )
        })}
      </div>
    </div>
  )
}

function PageCanvas({ page, pageChars, pageCharsStart, calibration, getGridGeometry }) {
  const canvasRef = useRef(null)
  const DISPLAY_W = 340
  const scale = DISPLAY_W / page.pageWidth
  const DISPLAY_H = Math.round(page.pageHeight * scale)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    ctx.clearRect(0, 0, DISPLAY_W, DISPLAY_H)

    // วาดภาพ PDF หน้านั้น
    const src = page.ctx?.canvas
    if (src) {
      ctx.drawImage(src, 0, 0, DISPLAY_W, DISPLAY_H)
    } else {
      ctx.fillStyle = "#f9f9f7"
      ctx.fillRect(0, 0, DISPLAY_W, DISPLAY_H)
    }

    const n = pageChars.length
    const insetRatio = GRID_GEOMETRY.insetRatio

    // ── ลองใช้ regDots ก่อน (แม่นที่สุด) ──────────────────────────────────
    const hasRegDots = (page.regDots?.length ?? 0) >= 4
    let cellRects = null

    if (hasRegDots) {
      // สร้าง cell rects จาก reg dots จริง
      const raw = buildCellRectsFromDots(page.regDots, page.pageWidth, page.pageHeight, GRID_COLS, n)
      if (raw?.length) {
        const sorted = sortCellRectsReadingOrder(raw)
        cellRects = sorted.slice(0, n)
      }
    }

    if (cellRects?.length === n) {
      // ── วาดจาก regDots ──
      cellRects.forEach(rect => {
        // 🟢 outer cell
        ctx.strokeStyle = "#22c55e"
        ctx.lineWidth = 1.5
        ctx.strokeRect(rect.x * scale, rect.y * scale, rect.w * scale, rect.h * scale)

        // 🔵 crop zone (after inset + calibration offset)
        const cal = calibration ?? { offsetX: 0, offsetY: 0 }
        const inset = Math.round(Math.min(rect.w, rect.h) * insetRatio)
        const cx = clamp(Math.round(rect.x + cal.offsetX) + inset, 0, page.pageWidth - 1) * scale
        const cy = clamp(Math.round(rect.y + cal.offsetY) + inset, 0, page.pageHeight - 1) * scale
        const cw = Math.max(20, Math.round(rect.w) - inset * 2) * scale
        const ch = Math.max(20, Math.round(rect.h) - inset * 2) * scale
        ctx.strokeStyle = "#3b82f6"
        ctx.lineWidth = 1
        ctx.strokeRect(cx, cy, cw, ch)
      })
    } else {
      // ── fallback: คำนวณจาก geometry + calibration ──
      const auto = page.autoCalibration ?? { offsetX: 0, offsetY: 0, cellAdjust: 0, gapAdjust: 0 }
      const cal  = calibration ?? { offsetX: 0, offsetY: 0, cellAdjust: 0, gapAdjust: 0 }
      const merged = {
        offsetX:    auto.offsetX    + cal.offsetX,
        offsetY:    auto.offsetY    + cal.offsetY,
        cellAdjust: auto.cellAdjust + cal.cellAdjust,
        gapAdjust:  auto.gapAdjust  + cal.gapAdjust,
      }
      const geom = getGridGeometry(page.pageWidth, page.pageHeight, n, merged)
      const { cellWidth, cellHeight, gap, startX, startY } = geom

      pageChars.forEach((_, i) => {
        const row = Math.floor(i / GRID_COLS)
        const col = i % GRID_COLS

        // 🟢 outer cell
        const ox = (startX + col * (cellWidth + gap)) * scale
        const oy = (startY + row * (cellHeight + gap)) * scale
        ctx.strokeStyle = "#22c55e"
        ctx.lineWidth = 1.5
        ctx.strokeRect(ox, oy, cellWidth * scale, cellHeight * scale)

        // 🔵 crop zone
        const inset = Math.round(Math.min(cellWidth, cellHeight) * insetRatio)
        const cx = clamp(Math.round(startX + col * (cellWidth + gap)) + inset, 0, page.pageWidth - 1) * scale
        const cy = clamp(Math.round(startY + row * (cellHeight + gap)) + inset, 0, page.pageHeight - 1) * scale
        const cw = Math.max(20, Math.round(cellWidth  - inset * 2)) * scale
        const ch = Math.max(20, Math.round(cellHeight - inset * 2)) * scale
        ctx.strokeStyle = "#3b82f6"
        ctx.lineWidth = 1
        ctx.strokeRect(cx, cy, cw, ch)
      })
    }
  }, [page, pageChars.length, calibration, DISPLAY_W, DISPLAY_H, scale])

  const cellFrom = pageCharsStart + 1
  const cellTo   = pageCharsStart + pageChars.length

  return (
    <div style={{ flexShrink: 0 }}>
      <p style={{ fontSize: 10, color: C.inkMd, marginBottom: 4, textAlign: "center" }}>
        หน้า {page.pageNumber} (ช่อง {cellFrom}–{cellTo})
        {(page.regDots?.length ?? 0) >= 4
          ? <span style={{ color: "#22c55e", marginLeft: 4 }}>● regDots</span>
          : <span style={{ color: "#f59e0b", marginLeft: 4 }}>● fallback</span>
        }
      </p>
      <canvas
        ref={canvasRef}
        width={DISPLAY_W}
        height={DISPLAY_H}
        style={{ borderRadius: 8, border: `1px solid ${C.border}`, display: "block" }}
      />
    </div>
  )
}