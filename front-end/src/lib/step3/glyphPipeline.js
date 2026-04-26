import { GRID_COLS, GRID_GEOMETRY } from "./constants.js"
import { clamp } from "./utils.js"

export function classifyGlyph(imageData, width, height) {
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

/** พื้นหลังต้องโปร่งใส — ถ้าใช้ขาวทึบ จะเห็นกล่องรอบตัวอักษรเมื่อพิมพ์/PDF ไม่ตรงโทนขาวกับกระดาษ */
export function buildInkOnlyImageData(imageData, width, height) {
  const cleaned = new ImageData(new Uint8ClampedArray(imageData.data), width, height)
  const { data } = cleaned

  const clear = i => {
    data[i] = data[i + 1] = data[i + 2] = 0
    data[i + 3] = 0
  }

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i],
      g = data[i + 1],
      b = data[i + 2],
      a = data[i + 3]

    if (a < 30) {
      clear(i)
      continue
    }

    const lum = r * 0.2126 + g * 0.7152 + b * 0.0722

    const blueDom = b - Math.max(r, g)
    const isBlueFamily = blueDom > 5 && b > 100
    if (isBlueFamily) {
      clear(i)
      continue
    }

    if (lum > 180) {
      clear(i)
      continue
    }

    data[i] = data[i + 1] = data[i + 2] = 0
    data[i + 3] = 255
  }

  return cleaned
}

export function getGridGeometry(pageWidth, pageHeight, charsLength, calibration) {
  // STEP 2 — REMOVE DYNAMIC CELL CALCULATION
  // Use exact values from GRID_GEOMETRY, no estimation
  
  const cellWidth = GRID_GEOMETRY.cellWidthPx + (calibration.cellAdjust || 0)
  const cellHeight = GRID_GEOMETRY.cellHeightPx + (calibration.cellAdjust || 0)
  const gap = GRID_GEOMETRY.gapPx + (calibration.gapAdjust || 0)
  
  // Calculate exact start positions
  const startX = GRID_GEOMETRY.startX + (calibration.offsetX || 0)
  const startY = GRID_GEOMETRY.startY + (calibration.offsetY || 0)

  return { gap, cellWidth, cellHeight, startX, startY }
}

export function getPageCapacity(pageHeight, startY, cellSize, gap) {
  // Use exact bottom calculation from GRID_GEOMETRY
  const usableBottom = pageHeight - GRID_GEOMETRY.marginPx - 50  // ~footer space
  const rows = Math.max(1, Math.floor((usableBottom - startY + gap) / (cellSize + gap)))
  return rows * GRID_COLS
}

// ───────────────────────────────────────────────────────────────
// SVG Tracing: แปลง inkCanvas → SVG path
// ใช้ column-based filled outline ที่ reliable และ font-valid
// ───────────────────────────────────────────────────────────────
function traceToSVGPath(inkCanvas, width, height) {
  try {
    const ctx2 = inkCanvas.getContext("2d")
    if (!ctx2) return null

    const imageData = ctx2.getImageData(0, 0, width, height)
    const { data } = imageData

    // ── Build ink mask ────────────────────────────────────────────────────────
    const mask = new Uint8Array(width * height)
    for (let i = 0; i < width * height; i++) {
      const idx = i * 4
      if (data[idx + 3] < 50) continue
      const lum = data[idx] * 0.2126 + data[idx + 1] * 0.7152 + data[idx + 2] * 0.0722
      if (lum < 180) mask[i] = 1
    }

    let inkCount = 0
    for (let i = 0; i < mask.length; i++) if (mask[i]) inkCount++
    if (inkCount < 5) return null

    // ── Dilate 1px: ป้องกัน stroke บางๆ แตก ─────────────────────────────────
    const dilated = new Uint8Array(width * height)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (mask[y * width + x]) {
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const ny2 = y + dy, nx2 = x + dx
              if (ny2 >= 0 && ny2 < height && nx2 >= 0 && nx2 < width)
                dilated[ny2 * width + nx2] = 1
            }
          }
        }
      }
    }

    // ── Tight bounding box ────────────────────────────────────────────────────
    let bxMin = width, bxMax = 0, byMin = height, byMax = 0
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (dilated[y * width + x]) {
          if (x < bxMin) bxMin = x
          if (x > bxMax) bxMax = x
          if (y < byMin) byMin = y
          if (y > byMax) byMax = y
        }
      }
    }
    if (bxMin > bxMax || byMin > byMax) return null

    const bw = Math.max(bxMax - bxMin, 1)
    const bh = Math.max(byMax - byMin, 1)
    const PAD = 5
    const toSvgX = x => PAD + ((x - bxMin) / bw) * (100 - PAD * 2)
    const toSvgY = y => PAD + ((y - byMin) / bh) * (100 - PAD * 2)

    // ── Row-span connected blob extraction ────────────────────────────────────
    const rowSpans = []
    for (let y = byMin; y <= byMax; y++) {
      const spans = []
      let inRun = false, x0 = 0
      for (let x = bxMin; x <= bxMax + 1; x++) {
        const ink = x <= bxMax && dilated[y * width + x] === 1
        if (ink && !inRun) { inRun = true; x0 = x }
        else if (!ink && inRun) { inRun = false; spans.push({ x0, x1: x - 1 }) }
      }
      rowSpans.push(spans)
    }

    // BFS blob grouping on row-spans
    const spanId = rowSpans.map(spans => new Int32Array(spans.length).fill(-1))
    let blobId = 0
    const blobRows = []

    for (let ri = 0; ri < rowSpans.length; ri++) {
      for (let si = 0; si < rowSpans[ri].length; si++) {
        if (spanId[ri][si] >= 0) continue
        const id = blobId++
        blobRows.push([])
        const queue = [[ri, si]]
        spanId[ri][si] = id
        while (queue.length) {
          const [r, s] = queue.shift()
          const { x0, x1 } = rowSpans[r][s]
          blobRows[id].push({ y: byMin + r, x0, x1 })
          for (const nr of [r - 1, r + 1]) {
            if (nr < 0 || nr >= rowSpans.length) continue
            for (let ns = 0; ns < rowSpans[nr].length; ns++) {
              if (spanId[nr][ns] >= 0) continue
              const { x0: ax0, x1: ax1 } = rowSpans[nr][ns]
              if (ax1 >= x0 - 1 && ax0 <= x1 + 1) {
                spanId[nr][ns] = id
                queue.push([nr, ns])
              }
            }
          }
        }
      }
    }

    const pathCmds = []

    for (const rows of blobRows) {
      if (rows.length === 0) continue
      rows.sort((a, b) => a.y - b.y)

      const xMin2 = Math.min(...rows.map(r => r.x0))
      const xMax2 = Math.max(...rows.map(r => r.x1))
      const len2 = xMax2 - xMin2 + 1
      const topY = new Float32Array(len2).fill(Infinity)
      const botY = new Float32Array(len2).fill(-Infinity)

      for (const r of rows) {
        for (let x = r.x0; x <= r.x1; x++) {
          const xi = x - xMin2
          if (r.y < topY[xi]) topY[xi] = r.y
          if (r.y > botY[xi]) botY[xi] = r.y
        }
      }

      const upper = [], lower = []
      for (let xi = 0; xi < len2; xi++) {
        if (topY[xi] === Infinity) continue
        upper.push({ x: toSvgX(xMin2 + xi), y: toSvgY(topY[xi]) })
        lower.push({ x: toSvgX(xMin2 + xi), y: toSvgY(botY[xi] + 1) })
      }

      if (upper.length === 0) continue
      if (upper.length === 1) {
        const px = upper[0].x.toFixed(1)
        pathCmds.push(`M ${px} ${upper[0].y.toFixed(1)} L ${px} ${lower[0].y.toFixed(1)}`)
        continue
      }

      const su = dpSimplify(upper.map(p => ({ x: parseFloat(p.x.toFixed(1)), y: parseFloat(p.y.toFixed(1)) })), 0.5)
      const sl = dpSimplify(lower.map(p => ({ x: parseFloat(p.x.toFixed(1)), y: parseFloat(p.y.toFixed(1)) })), 0.5)

      let d = `M ${su[0].x} ${su[0].y}`
      for (let k = 1; k < su.length; k++) d += ` L ${su[k].x} ${su[k].y}`
      d += ` L ${sl[sl.length - 1].x} ${sl[sl.length - 1].y}`
      for (let k = sl.length - 2; k >= 0; k--) d += ` L ${sl[k].x} ${sl[k].y}`
      d += ' Z'
      pathCmds.push(d)
    }

    if (pathCmds.length === 0) return null
    return { path: pathCmds.join(" "), viewBox: "0 0 100 100" }
  } catch {
    return null
  }
}

/** Douglas-Peucker polyline simplification */
function dpSimplify(pts, epsilon) {
  if (pts.length <= 2) return pts
  let maxDist = 0, maxIdx = 0
  const first = pts[0], last = pts[pts.length - 1]
  const dx = last.x - first.x, dy = last.y - first.y
  const len = Math.sqrt(dx * dx + dy * dy) || 1
  for (let i = 1; i < pts.length - 1; i++) {
    const dist = Math.abs((pts[i].x - first.x) * dy - (pts[i].y - first.y) * dx) / len
    if (dist > maxDist) { maxDist = dist; maxIdx = i }
  }
  if (maxDist > epsilon) {
    const left  = dpSimplify(pts.slice(0, maxIdx + 1), epsilon)
    const right = dpSimplify(pts.slice(maxIdx), epsilon)
    return [...left.slice(0, -1), ...right]
  }
  return [first, last]
}

async function traceGlyphAsync(inkCanvas, width, height) {
  return new Promise(resolve => {
    setTimeout(() => {
      resolve(traceToSVGPath(inkCanvas, width, height))
    }, 0)
  })
}

export function extractGlyphsFromCanvas({ ctx, pageWidth, pageHeight, chars, calibration, cellRects }) {
  const useRegDots = cellRects && cellRects.length >= chars.length

  let gap, cellWidth, cellHeight, startX, startY
  if (!useRegDots) {
    const geom = getGridGeometry(pageWidth, pageHeight, chars.length, calibration)
    gap = geom.gap
    cellWidth = geom.cellWidth
    cellHeight = geom.cellHeight
    startX = geom.startX
    startY = geom.startY
  }

  return chars.map((ch, i) => {
    const row = Math.floor(i / GRID_COLS)
    const col = i % GRID_COLS
    let cellX, cellY, cellW, cellH
    
    if (useRegDots && cellRects[i]) {
      const rect = cellRects[i]
      // STEP 3 — FIX CROP BOX - Use reduced inset
      const insetR = Math.round(Math.min(rect.w, rect.h) * GRID_GEOMETRY.insetRatio)
      cellX = clamp(Math.round(rect.x) + insetR, 0, pageWidth - 1)
      cellY = clamp(Math.round(rect.y) + insetR, 0, pageHeight - 1)
      cellW = Math.max(20, Math.round(rect.w) - insetR * 2)
      cellH = Math.max(20, Math.round(rect.h) - insetR * 2)
    } else {
      // STEP 3 — FIX CROP BOX - Exact grid positioning
      const inset = Math.round(Math.min(cellWidth, cellHeight) * GRID_GEOMETRY.insetRatio)
      cellX = clamp(Math.round(startX + col * (cellWidth + gap)) + inset, 0, pageWidth - 1)
      cellY = clamp(Math.round(startY + row * (cellHeight + gap)) + inset, 0, pageHeight - 1)
      cellW = Math.max(20, Math.round(cellWidth - inset * 2))
      cellH = Math.max(20, Math.round(cellHeight - inset * 2))
    }
    
    const cropW = Math.min(cellW, pageWidth - cellX)
    const cropH = Math.min(cellH, pageHeight - cellY)

    const imageData = ctx.getImageData(cellX, cellY, cropW, cropH)
    const cropCanvas = document.createElement("canvas")
    cropCanvas.width = cropW
    cropCanvas.height = cropH
    const cropCtx = cropCanvas.getContext("2d")
    cropCtx?.putImageData(imageData, 0, 0)

    const inkOnlyData = buildInkOnlyImageData(imageData, cropW, cropH)
    const inkCanvas = document.createElement("canvas")
    inkCanvas.width = cropW
    inkCanvas.height = cropH
    const inkCtx = inkCanvas.getContext("2d")
    inkCtx?.putImageData(inkOnlyData, 0, 0)

    const { status, inkRatio, edgeRatio } = classifyGlyph(imageData, cropW, cropH)

    return {
      _inkCanvas: inkCanvas,
      _inkW: cropW,
      _inkH: cropH,
      _sourceRect: { x: cellX, y: cellY, w: cropW, h: cropH },
      _pageCtx: ctx,
      id: `${i}-${ch}`,
      index: i + 1,
      ch,
      status,
      inkRatio,
      edgeRatio,
      preview: cropCanvas.toDataURL("image/png"),
      previewInk: inkCanvas.toDataURL("image/png"),
      svgPath: null,
      viewBox: "0 0 100 100",
    }
  })
}

export async function traceAllGlyphs(rawGlyphs) {
  const results = await Promise.all(
    rawGlyphs.map(async g => {
      if (!g._inkCanvas || g.status === "missing") {
        const { _inkCanvas, _inkW, _inkH, ...rest } = g
        return { ...rest, svgPath: null, viewBox: "0 0 100 100" }
      }
      const traced = await traceGlyphAsync(g._inkCanvas, g._inkW, g._inkH)
      const { _inkCanvas, _inkW, _inkH, ...rest } = g
      return {
        ...rest,
        svgPath: traced?.path || null,
        viewBox: traced?.viewBox || "0 0 100 100",
      }
    })
  )
  return results
}