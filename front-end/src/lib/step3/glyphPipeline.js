import { GRID_COLS, GRID_CONFIG } from "./constants.js"
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

export function buildInkOnlyImageData(imageData, width, height) {
  const cleaned = new ImageData(new Uint8ClampedArray(imageData.data), width, height)
  const { data } = cleaned

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i],
      g = data[i + 1],
      b = data[i + 2],
      a = data[i + 3]

    if (a < 30) {
      data[i] = data[i + 1] = data[i + 2] = 255
      data[i + 3] = 255
      continue
    }

    const lum = r * 0.2126 + g * 0.7152 + b * 0.0722

    const blueDom = b - Math.max(r, g)
    const isBlueFamily = blueDom > 5 && b > 100
    if (isBlueFamily) {
      data[i] = data[i + 1] = data[i + 2] = 255
      data[i + 3] = 255
      continue
    }

    if (lum > 180) {
      data[i] = data[i + 1] = data[i + 2] = 255
      data[i + 3] = 255
      continue
    }

    data[i] = data[i + 1] = data[i + 2] = 0
    data[i + 3] = 255
  }

  return cleaned
}

export function getGridGeometry(pageWidth, pageHeight, charsLength, calibration) {
  const baseGap = Math.max(6, pageWidth * GRID_CONFIG.gapRatio)
  const gap = Math.max(2, baseGap + calibration.gapAdjust)

  const workWidth = pageWidth * (1 - GRID_CONFIG.padXRatio * 2)
  const rows = Math.max(1, Math.ceil(charsLength / GRID_COLS))
  const baseCellSize = (workWidth - baseGap * (GRID_COLS - 1)) / GRID_COLS
  const cellSize = Math.max(24, baseCellSize + calibration.cellAdjust)
  const gridHeight = rows * cellSize + (rows - 1) * gap

  const baseStartX = pageWidth * GRID_CONFIG.padXRatio
  const desiredStartY = pageHeight * GRID_CONFIG.topRatio
  const maxStartY = pageHeight - pageHeight * GRID_CONFIG.bottomRatio - gridHeight
  const baseStartY = Math.max(0, Math.min(desiredStartY, maxStartY))

  const startX = baseStartX + calibration.offsetX
  const startY = baseStartY + calibration.offsetY

  return { gap, cellSize, startX, startY }
}

export function getPageCapacity(pageHeight, startY, cellSize, gap) {
  const usableBottom = pageHeight * (1 - GRID_CONFIG.bottomRatio)
  const rows = Math.max(1, Math.floor((usableBottom - startY + gap) / (cellSize + gap)))
  return rows * GRID_COLS
}

// ───────────────────────────────────────────────────────────────
// SVG Tracing: แปลง inkCanvas → SVG path โดยไม่ต้องใช้ library
// ───────────────────────────────────────────────────────────────
function traceToSVGPath(inkCanvas, width, height) {
  try {
    const ctx2 = inkCanvas.getContext("2d")
    if (!ctx2) return null

    const imageData = ctx2.getImageData(0, 0, width, height)
    const { data } = imageData

    const threshold = 180
    const mask = new Uint8Array(width * height)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4
        const r = data[idx],
          g = data[idx + 1],
          b = data[idx + 2],
          a = data[idx + 3]
        if (a < 50) {
          mask[y * width + x] = 0
          continue
        }
        const lum = r * 0.2126 + g * 0.7152 + b * 0.0722
        mask[y * width + x] = lum < threshold ? 1 : 0
      }
    }

    const inkCount = mask.reduce((s, v) => s + v, 0)
    if (inkCount < 10) return null

    const scaleX = 100 / width
    const scaleY = 100 / height

    const pathCmds = []
    const STEP = Math.max(1, Math.floor(Math.min(width, height) / 80))

    let prevRuns = []
    for (let y = 0; y < height; y += STEP) {
      const runs = []
      let inRun = false
      let runStart = 0

      for (let x = 0; x < width; x++) {
        const isInk = mask[y * width + x] === 1
        if (isInk && !inRun) {
          inRun = true
          runStart = x
        } else if (!isInk && inRun) {
          inRun = false
          runs.push({ start: runStart, end: x - 1 })
        }
      }
      if (inRun) runs.push({ start: runStart, end: width - 1 })

      for (const run of runs) {
        const midX = (((run.start + run.end) / 2) * scaleX).toFixed(1)
        const midY = (y * scaleY).toFixed(1)

        const matched = prevRuns.find(
          pr => pr.start <= run.end + STEP * 2 && pr.end >= run.start - STEP * 2
        )

        if (matched) {
          const prevMidX = (((matched.start + matched.end) / 2) * scaleX).toFixed(1)
          const prevMidY = ((y - STEP) * scaleY).toFixed(1)
          pathCmds.push(`M ${prevMidX} ${prevMidY} L ${midX} ${midY}`)
        } else {
          const x1 = (run.start * scaleX).toFixed(1)
          const x2 = (run.end * scaleX).toFixed(1)
          pathCmds.push(`M ${x1} ${midY} L ${x2} ${midY}`)
        }
      }

      prevRuns = runs
    }

    if (pathCmds.length === 0) return null

    return {
      path: pathCmds.join(" "),
      viewBox: "0 0 100 100",
    }
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

  let gap, cellSize, startX, startY
  if (!useRegDots) {
    const geom = getGridGeometry(pageWidth, pageHeight, chars.length, calibration)
    gap = geom.gap
    cellSize = geom.cellSize
    startX = geom.startX
    startY = geom.startY
  }

  return chars.map((ch, i) => {
    const row = Math.floor(i / GRID_COLS)
    const col = i % GRID_COLS
    let cellX, cellY, cellW, cellH
    if (useRegDots && cellRects[i]) {
      const rect = cellRects[i]
      const insetR = Math.round(Math.min(rect.w, rect.h) * GRID_CONFIG.insetRatio)
      cellX = clamp(Math.round(rect.x) + insetR, 0, pageWidth - 1)
      cellY = clamp(Math.round(rect.y) + insetR, 0, pageHeight - 1)
      cellW = Math.max(20, Math.round(rect.w) - insetR * 2)
      cellH = Math.max(20, Math.round(rect.h) - insetR * 2)
    } else {
      const inset = Math.round(cellSize * GRID_CONFIG.insetRatio)
      cellX = clamp(Math.round(startX + col * (cellSize + gap)) + inset, 0, pageWidth - 1)
      cellY = clamp(Math.round(startY + row * (cellSize + gap)) + inset, 0, pageHeight - 1)
      cellW = Math.max(20, Math.round(cellSize - inset * 2))
      cellH = cellW
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
