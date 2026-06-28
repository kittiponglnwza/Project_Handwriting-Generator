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
    // #A8C1DD = R168 G193 B221 → blueDom=28, b=221
    // PDF rendering อาจ darken/shift สี → threshold ต่ำลง + เพิ่ม hue check
    const isBlueFamily = (blueDom > 3 && b > 90) || (b > r + 10 && b > g + 5 && lum > 140)
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
// ใช้ contour-based outline tracing เพื่อสร้าง filled shapes
// แทน centerline skeleton ที่ดูเป็นเส้นบางๆ
// ───────────────────────────────────────────────────────────────

/**
 * Trace contour outlines from ink mask using Moore neighborhood border walking.
 * Returns an array of closed contour polygons [{x,y}[]] in pixel coordinates.
 */
function traceContours(mask, width, height, bxMin, bxMax, byMin, byMax) {
  const visited = new Uint8Array(width * height)
  const contours = []

  // Moore neighborhood: 8 directions (clockwise from right)
  const dx8 = [1, 1, 0, -1, -1, -1, 0, 1]
  const dy8 = [0, 1, 1, 1, 0, -1, -1, -1]

  const isInk = (x, y) =>
    x >= 0 && x < width && y >= 0 && y < height && mask[y * width + x] === 1

  for (let sy = byMin; sy <= byMax; sy++) {
    for (let sx = bxMin; sx <= bxMax; sx++) {
      if (!isInk(sx, sy) || visited[sy * width + sx]) continue
      // Check this is a border pixel (has at least one non-ink neighbor)
      let isBorder = false
      for (let d = 0; d < 8; d++) {
        if (!isInk(sx + dx8[d], sy + dy8[d])) { isBorder = true; break }
      }
      if (!isBorder) continue

      // Walk the border using Moore neighborhood tracing
      const contour = []
      let cx = sx, cy = sy
      let dir = 7 // start looking from top-left
      let steps = 0
      const MAX_STEPS = (bxMax - bxMin + byMax - byMin + 4) * 8

      do {
        contour.push({ x: cx, y: cy })
        visited[cy * width + cx] = 1

        // Search clockwise from (dir+1) % 8 for next border pixel
        let found = false
        const startDir = (dir + 5) % 8 // backtrack: start from opposite+1
        for (let i = 0; i < 8; i++) {
          const nd = (startDir + i) % 8
          const nx = cx + dx8[nd]
          const ny = cy + dy8[nd]
          if (isInk(nx, ny)) {
            dir = nd
            cx = nx
            cy = ny
            found = true
            break
          }
        }
        if (!found) break
        steps++
      } while ((cx !== sx || cy !== sy) && steps < MAX_STEPS)

      // Only keep contours with enough points to form a shape
      if (contour.length >= 6) {
        contours.push(contour)
      }
    }
  }

  return contours
}

/**
 * Subsample a contour to reduce point count while preserving shape.
 * Takes every Nth point, always keeping first and last.
 */
function subsampleContour(points, targetCount) {
  if (points.length <= targetCount) return points
  const step = (points.length - 1) / (targetCount - 1)
  const result = []
  for (let i = 0; i < targetCount; i++) {
    result.push(points[Math.min(Math.round(i * step), points.length - 1)])
  }
  return result
}

function traceToSVGPath(inkCanvas, width, height, _ch = '') {
  try {
    const ctx2 = inkCanvas.getContext("2d")
    if (!ctx2) return null

    const rawImageData = ctx2.getImageData(0, 0, width, height)
    // ใช้ buildInkOnlyImageData เพื่อกรอง blue guideline (#A8C1DD) และ background ออก
    // ก่อนสร้าง mask — เหมือนกับที่ extractGlyphsFromCanvas ทำ
    const inkImageData = buildInkOnlyImageData(rawImageData, width, height)

    // ── Build ink mask (alpha=0 หมายถึง non-ink จาก buildInkOnlyImageData) ──
    const mask = new Uint8Array(width * height)
    for (let i = 0; i < width * height; i++) {
      if (inkImageData.data[i * 4 + 3] > 0) mask[i] = 1
    }

    let inkCount = 0
    for (let i = 0; i < mask.length; i++) if (mask[i]) inkCount++
    if (inkCount < 5) return null

    // ── Tight bounding box ────────────────────────────────────────────────────
    let bxMin = width, bxMax = 0, byMin = height, byMax = 0
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (mask[y * width + x]) {
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
    const PAD_X = 5

    // ── Clean baseline-anchored mapping ──────────────────────────────────────
    const SVG_BASELINE = 80
    const MAX_HEIGHT   = SVG_BASELINE

    // ── Descender letters: j g p q y ────────────────────────────────────────
    const DESCENDER_CHARS = new Set(["j", "g", "p", "q", "y"])
    const isDescender = DESCENDER_CHARS.has(_ch)

    let anchorPx, scale
    if (isDescender) {
      const cellBaseline_px = height * (SVG_BASELINE / 100)
      anchorPx = cellBaseline_px
      const bodyHeight_px = Math.max(cellBaseline_px - byMin, 1)
      scale = Math.min(SVG_BASELINE / bodyHeight_px, SVG_BASELINE / 20)
    } else {
      anchorPx = byMax
      scale = Math.min(MAX_HEIGHT / Math.max(bh, 1), MAX_HEIGHT / 20)
    }

    const toSvgX = x => PAD_X + ((x - bxMin) / bw) * (100 - PAD_X * 2)
    const toSvgY = y => SVG_BASELINE - (anchorPx - y) * scale

    // ── Contour-based outline tracing ─────────────────────────────────────────
    // Trace the border pixels of ink regions to produce closed outlines
    // (filled shapes) instead of thin centerline skeletons
    const contours = traceContours(mask, width, height, bxMin, bxMax, byMin, byMax)

    let pathCmds = []

    if (contours.length > 0) {
      // Use contour outlines → filled shapes
      for (const contour of contours) {
        // Subsample large contours to keep path size reasonable
        const maxPts = Math.min(200, Math.max(20, Math.round(contour.length / 3)))
        const sampled = subsampleContour(contour, maxPts)

        // Convert to SVG coordinates
        const svgPts = sampled.map(p => ({ x: toSvgX(p.x), y: toSvgY(p.y) }))

        // Simplify with tight epsilon for smooth curves
        const simplified = dpSimplify(svgPts, 0.35)
        if (simplified.length < 3) continue

        // Build closed path with smooth Catmull-Rom curves
        let d = `M ${simplified[0].x.toFixed(1)} ${simplified[0].y.toFixed(1)}`
        for (let k = 0; k < simplified.length; k++) {
          const p0 = simplified[(k - 1 + simplified.length) % simplified.length]
          const p1 = simplified[k]
          const p2 = simplified[(k + 1) % simplified.length]
          const p3 = simplified[(k + 2) % simplified.length]
          const tension = 0.25
          const cp1x = p1.x + (p2.x - p0.x) * tension
          const cp1y = p1.y + (p2.y - p0.y) * tension
          const cp2x = p2.x - (p3.x - p1.x) * tension
          const cp2y = p2.y - (p3.y - p1.y) * tension
          d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`
        }
        d += ' Z'
        pathCmds.push(d)
      }
    }

    // Fallback: if contour tracing produced nothing, use centerline as before
    if (pathCmds.length === 0) {
      pathCmds = traceCenterlineFallback(mask, width, height, bxMin, bxMax, byMin, byMax, toSvgX, toSvgY)
    }

    if (pathCmds.length === 0) return null

    const svgDescBot = isDescender
      ? +(SVG_BASELINE - (anchorPx - byMax) * scale).toFixed(1)
      : SVG_BASELINE

    return {
      path: pathCmds.join(" "),
      viewBox: "0 0 100 100",
      svgBaseline: SVG_BASELINE,
      svgDescBot,
      svgCapTop: 0,
    }
  } catch {
    return null
  }
}

/**
 * Centerline fallback tracer — used when contour tracing fails
 * (e.g., very thin 1-2px strokes where contours are degenerate)
 */
function traceCenterlineFallback(mask, width, height, bxMin, bxMax, byMin, byMax, toSvgX, toSvgY) {
  const bw = Math.max(bxMax - bxMin, 1)
  const bh = Math.max(byMax - byMin, 1)
  const QUANT = Math.max(2, Math.round(Math.min(bw, bh) / 30))

  // Column scan: find midpoints of vertical ink runs
  const colCenters = []
  for (let x = bxMin; x <= bxMax; x++) {
    let runStart = -1
    for (let y = byMin; y <= byMax + 1; y++) {
      const ink = y <= byMax && mask[y * width + x] === 1
      if (ink && runStart < 0) { runStart = y }
      else if (!ink && runStart >= 0) {
        colCenters.push({ x, y: (runStart + y - 1) / 2 })
        runStart = -1
      }
    }
  }

  // Row scan: find midpoints of horizontal ink runs
  const rowCenters = []
  for (let y = byMin; y <= byMax; y++) {
    let runStart = -1
    for (let x = bxMin; x <= bxMax + 1; x++) {
      const ink = x <= bxMax && mask[y * width + x] === 1
      if (ink && runStart < 0) { runStart = x }
      else if (!ink && runStart >= 0) {
        rowCenters.push({ x: (runStart + x - 1) / 2, y })
        runStart = -1
      }
    }
  }

  // Deduplicate via grid quantization
  const seen = new Set()
  const centers = []
  for (const p of [...colCenters, ...rowCenters]) {
    const qx = Math.round(p.x / QUANT) * QUANT
    const qy = Math.round(p.y / QUANT) * QUANT
    const key = `${qx},${qy}`
    if (!seen.has(key)) { seen.add(key); centers.push({ x: qx, y: qy }) }
  }
  if (centers.length < 2) return []

  // BFS cluster
  const CONNECT_R = QUANT * 4
  const CONNECT_R2 = CONNECT_R * CONNECT_R
  const clusterOf = new Int32Array(centers.length).fill(-1)
  let numClusters = 0
  for (let i = 0; i < centers.length; i++) {
    if (clusterOf[i] >= 0) continue
    const cid = numClusters++
    const queue = [i]
    clusterOf[i] = cid
    while (queue.length) {
      const cur = queue.pop()
      for (let j = 0; j < centers.length; j++) {
        if (clusterOf[j] >= 0) continue
        const dx = centers[j].x - centers[cur].x
        const dy = centers[j].y - centers[cur].y
        if (dx * dx + dy * dy <= CONNECT_R2) { clusterOf[j] = cid; queue.push(j) }
      }
    }
  }

  // Nearest-neighbor chain per cluster
  const pathCmds = []
  for (let cid = 0; cid < numClusters; cid++) {
    const cPts = centers.filter((_, i) => clusterOf[i] === cid)
    if (cPts.length < 2) continue
    cPts.sort((a, b) => a.x - b.x || a.y - b.y)
    const usedLocal = new Uint8Array(cPts.length)
    for (let si = 0; si < cPts.length; si++) {
      if (usedLocal[si]) continue
      const chain = [si]; usedLocal[si] = 1; let cur = si
      for (;;) {
        let best = -1, bestD = Infinity
        for (let j = 0; j < cPts.length; j++) {
          if (usedLocal[j]) continue
          const dx = cPts[j].x - cPts[cur].x, dy = cPts[j].y - cPts[cur].y
          const d = dx * dx + dy * dy
          if (d < bestD) { bestD = d; best = j }
        }
        if (best < 0 || bestD > CONNECT_R2 * 2.25) break
        chain.push(best); usedLocal[best] = 1; cur = best
      }
      if (chain.length >= 2) {
        const svgPts = chain.map(ci => ({ x: toSvgX(cPts[ci].x), y: toSvgY(cPts[ci].y) }))
        const simplified = dpSimplify(svgPts, 0.35)
        if (simplified.length < 2) continue
        let d = `M ${simplified[0].x.toFixed(1)} ${simplified[0].y.toFixed(1)}`
        for (let k = 0; k < simplified.length - 1; k++) {
          const p0 = simplified[Math.max(0, k - 1)]
          const p1 = simplified[k]
          const p2 = simplified[k + 1]
          const p3 = simplified[Math.min(simplified.length - 1, k + 2)]
          const tension = 0.25
          d += ` C ${(p1.x + (p2.x - p0.x) * tension).toFixed(1)} ${(p1.y + (p2.y - p0.y) * tension).toFixed(1)}, ${(p2.x - (p3.x - p1.x) * tension).toFixed(1)} ${(p2.y - (p3.y - p1.y) * tension).toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`
        }
        pathCmds.push(d)
      }
    }
  }
  return pathCmds
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
// ── potrace loader (singleton) ──────────────────────────────────────────
// ใช้ package จริง: npm install potrace
import("potrace") // ensure vite sees dependency

let _potraceReady = null // Promise<module|null>

async function getPotraceAPI() {
  if (_potraceReady) return _potraceReady

  _potraceReady = (async () => {
    try {
      const mod = await import("potrace")
      return mod.default ?? mod
    } catch (err) {
      console.warn("potrace load failed:", err)
      return null
    }
  })()

  return _potraceReady
}

// แปลง inkCanvas → SVG path string
async function traceWithPotrace(inkCanvas, width, height) {
  const potrace = await getPotraceAPI()
  if (!potrace) return null

  try {
    // canvas -> blob/url
    const blob = await new Promise(res => inkCanvas.toBlob(res, "image/png"))
    if (!blob) return null

    const url = URL.createObjectURL(blob)

    const svg = await new Promise((resolve, reject) => {
      potrace.trace(
        url,
        {
          turdSize: 2,
          alphaMax: 1,
          optCurve: true,
          optTolerance: 0.2,
          threshold: 180,
          color: "black",
          background: "transparent",
        },
        (err, result) => {
          if (err) reject(err)
          else resolve(result)
        }
      )
    })

    URL.revokeObjectURL(url)

    if (!svg) return null

    // ดึง path d="" ออกจาก svg
    const match = svg.match(/<path[^>]*d="([^"]+)"/i)
    if (!match) return null

    return {
      path: match[1],
      viewBox: "0 0 100 100",
    }
  } catch (err) {
    console.warn("potrace trace failed:", err)
    return null
  }
}

async function traceGlyphAsync(inkCanvas, width, height, ch = '') {
  const potraceResult = await traceWithPotrace(inkCanvas, width, height)
  if (potraceResult) return potraceResult

  return new Promise(resolve => {
    setTimeout(() => {
      resolve(traceToSVGPath(inkCanvas, width, height, ch))
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
      const traced = await traceGlyphAsync(g._inkCanvas, g._inkW, g._inkH, g.ch || '')
      const { _inkCanvas, _inkW, _inkH, ...rest } = g
      return {
        ...rest,
        svgPath:     traced?.path        || null,
        viewBox:     traced?.viewBox     || "0 0 100 100",
        svgBaseline: traced?.svgBaseline ?? 78,
        svgDescBot:  traced?.svgDescBot  ?? 78,
        svgCapTop:   traced?.svgCapTop   ?? 10,
      }
    })
  )
  return results
}
