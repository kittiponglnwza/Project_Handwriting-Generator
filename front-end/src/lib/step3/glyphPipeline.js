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

  // DEBUG: Log geometry values
  console.log('[GEOMETRY_DEBUG] Using GRID_GEOMETRY values:')
  console.log('  cellWidthPx:', GRID_GEOMETRY.cellWidthPx)
  console.log('  cellHeightPx:', GRID_GEOMETRY.cellHeightPx)
  console.log('  gapPx:', GRID_GEOMETRY.gapPx)
  console.log('  startX:', GRID_GEOMETRY.startX)
  console.log('  startY:', GRID_GEOMETRY.startY)
  console.log('  Calibration:', calibration)
  console.log('  Final cellWidth:', cellWidth)
  console.log('  Final cellHeight:', cellHeight)
  console.log('  Final gap:', gap)

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

    // Build ink mask
    const mask = new Uint8Array(width * height)
    for (let i = 0; i < width * height; i++) {
      const idx = i * 4
      if (data[idx + 3] < 50) continue
      const lum = data[idx] * 0.2126 + data[idx + 1] * 0.7152 + data[idx + 2] * 0.0722
      if (lum < 180) mask[i] = 1
    }

    const inkCount = mask.reduce((s, v) => s + v, 0)
    if (inkCount < 10) return null

    // Tight bounding box
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
    const bw = Math.max(bxMax - bxMin, 1)
    const bh = Math.max(byMax - byMin, 1)

    const PAD = 5
    const nx = x => PAD + ((x - bxMin) / bw) * (100 - PAD * 2)
    const ny = y => PAD + ((y - byMin) / bh) * (100 - PAD * 2)

    // Downsample factor for performance
    const factor = Math.max(1, Math.floor(Math.min(width, height) / 64))

    // For each column, find min/max ink y — build vertical profile
    // Then emit one tall filled rect per contiguous ink column group
    const pathCmds = []

    // Scan column by column in downsampled space
    const colStep = factor
    const rowStep = factor

    // Collect ink spans per row (downsampled)
    for (let y = byMin; y <= byMax; y += rowStep) {
      // Find ink runs in this row
      let inRun = false, runStart = 0
      let inkTop = y, inkBottom = Math.min(y + rowStep - 1, byMax)

      // Expand vertically: find actual ink extent in this band
      let bandTop = byMax, bandBot = byMin
      for (let dy = y; dy < Math.min(y + rowStep, byMax + 1); dy++) {
        for (let x = bxMin; x <= bxMax; x++) {
          if (mask[dy * width + x]) {
            if (dy < bandTop) bandTop = dy
            if (dy > bandBot) bandBot = dy
          }
        }
      }
      if (bandTop > bandBot) continue

      for (let x = bxMin; x <= bxMax + colStep; x += colStep) {
        // Check if any ink in this column band
        let hasInk = false
        for (let dx = x; dx < Math.min(x + colStep, bxMax + 1); dx++) {
          for (let dy = y; dy < Math.min(y + rowStep, byMax + 1); dy++) {
            if (dx < width && dy < height && mask[dy * width + dx]) {
              hasInk = true
              break
            }
          }
          if (hasInk) break
        }

        if (hasInk && !inRun) {
          inRun = true
          runStart = x
        } else if (!hasInk && inRun) {
          inRun = false
          // Emit filled rect for this run
          const x1 = nx(runStart).toFixed(1)
          const x2 = nx(Math.min(x, bxMax + 1)).toFixed(1)
          const y1 = ny(bandTop).toFixed(1)
          const y2 = ny(bandBot + 1).toFixed(1)
          if (x1 !== x2 && y1 !== y2) {
            pathCmds.push(`M ${x1} ${y1} L ${x2} ${y1} L ${x2} ${y2} L ${x1} ${y2} Z`)
          }
        }
      }
    }

    if (pathCmds.length === 0) return null

    return { path: pathCmds.join(" "), viewBox: "0 0 100 100" }
  } catch {
    return null
  }
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

    // STEP 4 — DEBUG OVERLAY - Log crop rectangle
    if (i < 3) {  // Log first 3 cells only
      console.log(`[CROP_DEBUG] Cell ${i} (${ch}):`)
      console.log(`  Expected Grid: x=${Math.round(startX + col * (cellWidth + gap))}, y=${Math.round(startY + row * (cellHeight + gap))}, w=${cellWidth}, h=${cellHeight}`)
      console.log(`  Actual Crop: x=${cellX}, y=${cellY}, w=${cropW}, h=${cropH}`)
      console.log(`  Inset: ${Math.round(Math.min(cellWidth, cellHeight) * GRID_GEOMETRY.insetRatio)}px (${(GRID_GEOMETRY.insetRatio * 100).toFixed(1)}%)`)
      console.log(`  Gap: ${gap}px, Calibration: offsetX=${calibration.offsetX}, offsetY=${calibration.offsetY}`)
    }

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