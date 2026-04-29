import { ZERO_CALIBRATION, GRID_COLS, MIN_TRUSTED_INDEX_TARGETS } from "../constants.js"
import { getGridGeometry } from "./glyphPipeline.js"

function getBlueSignal(data, pageWidth, pageHeight, x, y) {
  if (x < 0 || y < 0 || x >= pageWidth || y >= pageHeight) return 0
  const idx = (Math.round(y) * pageWidth + Math.round(x)) * 4
  const a = data[idx + 3]
  if (a < 10) return 0
  const r = data[idx]
  const g = data[idx + 1]
  const b = data[idx + 2]
  if (r > 160 && r - b > 60 && r - g > 40) return 0
  return Math.max(0, b - (r + g) * 0.5)
}

function sampleHorizontalGuide(data, pageWidth, pageHeight, y, xFrom, xTo) {
  let sum = 0
  let count = 0
  for (let yy = y - 1; yy <= y + 1; yy += 1) {
    for (let x = xFrom; x <= xTo; x += 2) {
      sum += getBlueSignal(data, pageWidth, pageHeight, x, yy)
      count += 1
    }
  }
  return count > 0 ? sum / count : 0
}

// Sample darkness along a horizontal strip — used to detect cell border lines
// which are dark (any color) and survive print/scan better than colored guide lines.
function sampleDarkHorizontalStrip(data, pageWidth, pageHeight, y, xFrom, xTo) {
  let sum = 0
  let count = 0
  for (let yy = y - 1; yy <= y + 1; yy += 1) {
    for (let x = xFrom; x <= xTo; x += 2) {
      if (x < 0 || yy < 0 || x >= pageWidth || yy >= pageHeight) continue
      const idx = (yy * pageWidth + x) * 4
      if (data[idx + 3] < 10) continue
      const lum = data[idx] * 0.2126 + data[idx + 1] * 0.7152 + data[idx + 2] * 0.0722
      // Dark pixels contribute — invert lum so darker = higher signal
      if (lum < 200) sum += (200 - lum)
      count += 1
    }
  }
  return count > 0 ? sum / count : 0
}

// Sample darkness along a vertical strip — detects vertical cell borders
function sampleDarkVerticalStrip(data, pageWidth, pageHeight, x, yFrom, yTo) {
  let sum = 0
  let count = 0
  for (let xx = x - 1; xx <= x + 1; xx += 1) {
    for (let y = yFrom; y <= yTo; y += 2) {
      if (xx < 0 || y < 0 || xx >= pageWidth || y >= pageHeight) continue
      const idx = (y * pageWidth + xx) * 4
      if (data[idx + 3] < 10) continue
      const lum = data[idx] * 0.2126 + data[idx + 1] * 0.7152 + data[idx + 2] * 0.0722
      if (lum < 200) sum += (200 - lum)
      count += 1
    }
  }
  return count > 0 ? sum / count : 0
}

export function scoreCalibration(page, chars, calibration) {
  const { imageData, pageWidth, pageHeight } = page
  if (!imageData) return Number.NEGATIVE_INFINITY

  // Sample more cells for better accuracy — cap at 36 (GRID_COLS * 6 rows)
  const sampleCount = Math.min(chars.length, GRID_COLS * 6)
  const { gap, cellSize, startX, startY } = getGridGeometry(
    pageWidth,
    pageHeight,
    sampleCount,
    calibration
  )

  let blueScore = 0
  let edgeScore = 0
  let validCells = 0
  let outOfBounds = 0

  for (let i = 0; i < sampleCount; i += 1) {
    const row = Math.floor(i / GRID_COLS)
    const col = i % GRID_COLS
    const cellX = Math.round(startX + col * (cellSize + gap))
    const cellY = Math.round(startY + row * (cellSize + gap))

    if (
      cellX < 0 ||
      cellY < 0 ||
      cellX + cellSize >= pageWidth ||
      cellY + cellSize >= pageHeight
    ) {
      outOfBounds += 1
      continue
    }

    const yMid  = Math.round(cellY + cellSize * 0.42)
    const yBase = Math.round(cellY + cellSize * 0.72)
    const xFrom = Math.round(cellX + cellSize * 0.08)
    const xTo   = Math.round(cellX + cellSize * 0.92)

    // Blue guide-line signal (works on digital PDF)
    const midSignal  = sampleHorizontalGuide(imageData, pageWidth, pageHeight, yMid, xFrom, xTo)
    const baseSignal = sampleHorizontalGuide(imageData, pageWidth, pageHeight, yBase, xFrom, xTo)
    blueScore += midSignal + baseSignal

    // Cell border signal — sample the 4 edges of this cell.
    // Borders survive print/scan and are a reliable alignment signal when blue lines fade.
    const yTop    = Math.round(cellY + cellSize * 0.02)
    const yBottom = Math.round(cellY + cellSize * 0.98)
    const xLeft   = Math.round(cellX + cellSize * 0.02)
    const xRight  = Math.round(cellX + cellSize * 0.98)
    const topEdge    = sampleDarkHorizontalStrip(imageData, pageWidth, pageHeight, yTop, xFrom, xTo)
    const bottomEdge = sampleDarkHorizontalStrip(imageData, pageWidth, pageHeight, yBottom, xFrom, xTo)
    const leftEdge   = sampleDarkVerticalStrip(imageData, pageWidth, pageHeight, xLeft, yTop, yBottom)
    const rightEdge  = sampleDarkVerticalStrip(imageData, pageWidth, pageHeight, xRight, yTop, yBottom)
    edgeScore += topEdge + bottomEdge + leftEdge + rightEdge

    validCells += 1
  }

  if (validCells === 0) return Number.NEGATIVE_INFINITY

  const blueAvg = blueScore / validCells
  const edgeAvg = edgeScore / validCells
  const penalty = outOfBounds * 12

  // Use blue signal when strong (digital PDF), fall back to edge signal for print/scan.
  // Blend both: blue dominates when present, edge fills in when blue is weak.
  const combined = blueAvg >= 2
    ? blueAvg * 0.7 + edgeAvg * 0.3
    : edgeAvg
  return combined - penalty
}

export function findAutoCalibration(page, chars) {
  // Search from ZERO_CALIBRATION seed — autoCalibration is the full base,
  // so the search space must be centered around zero offset, not DEFAULT_CALIBRATION.
  // DEFAULT_CALIBRATION was the old "manual tweak on top of TEMPLATE_CALIBRATION"
  // pattern which no longer applies here.
  const SEED = ZERO_CALIBRATION
  let best = { ...SEED }
  let bestScore = Number.NEGATIVE_INFINITY

  const testCandidate = candidate => {
    const score = scoreCalibration(page, chars, candidate)
    if (score > bestScore) {
      bestScore = score
      best = candidate
    }
  }

  // Phase 1: coarse Y sweep over full page range
  for (let oy = -320; oy <= 320; oy += 8) {
    testCandidate({ ...SEED, offsetY: oy })
  }

  // Phase 2: coarse X sweep locked to best Y
  for (let ox = -220; ox <= 220; ox += 6) {
    testCandidate({ ...best, offsetX: ox })
  }

  // Phase 3: cell/gap coarse
  for (let cell = -36; cell <= 36; cell += 4) {
    testCandidate({ ...best, cellAdjust: cell })
  }
  for (let gap = -24; gap <= 24; gap += 2) {
    testCandidate({ ...best, gapAdjust: gap })
  }

  // Phase 4: fine XY refinement
  for (let oy = best.offsetY - 24; oy <= best.offsetY + 24; oy += 2) {
    for (let ox = best.offsetX - 24; ox <= best.offsetX + 24; ox += 2) {
      testCandidate({ ...best, offsetX: ox, offsetY: oy })
    }
  }

  // Phase 5: fine cell/gap refinement
  for (let cell = best.cellAdjust - 8; cell <= best.cellAdjust + 8; cell += 1) {
    for (let gap = best.gapAdjust - 6; gap <= best.gapAdjust + 6; gap += 1) {
      testCandidate({ ...best, cellAdjust: cell, gapAdjust: gap })
    }
  }

  return { calibration: best, score: bestScore }
}

export function findAnchorCalibration(page, chars) {
  if (!page?.anchors?.length) return null

  const firstAnchor = page.anchors.find(anchor => anchor.kind === "code") || page.anchors[0]
  const sampleCount = Math.min(chars.length, GRID_COLS * 6)
  // Use ZERO_CALIBRATION as the neutral base — autoCalibration is the full base now,
  // so expected positions must be computed from zero offset, not DEFAULT_CALIBRATION.
  const baseGeometry = getGridGeometry(
    page.pageWidth,
    page.pageHeight,
    sampleCount,
    ZERO_CALIBRATION
  )

  const expectedAnchorX =
    firstAnchor.kind === "code"
      ? baseGeometry.startX + baseGeometry.cellSize * 0.95
      : baseGeometry.startX + baseGeometry.cellSize * 0.055
  const measuredAnchorX =
    firstAnchor.kind === "code" ? firstAnchor.x + firstAnchor.width : firstAnchor.x

  const expectedAnchorY = baseGeometry.startY + baseGeometry.cellSize * 0.11
  const seed = {
    offsetX: Math.round(measuredAnchorX - expectedAnchorX),
    offsetY: Math.round(firstAnchor.y - expectedAnchorY),
    cellAdjust: 0,
    gapAdjust: 0,
  }

  let best = seed
  let bestScore = scoreCalibration(page, chars, seed)

  const testCandidate = candidate => {
    const score = scoreCalibration(page, chars, candidate)
    if (score > bestScore) {
      bestScore = score
      best = candidate
    }
  }

  for (let oy = seed.offsetY - 96; oy <= seed.offsetY + 96; oy += 8) {
    for (let ox = seed.offsetX - 96; ox <= seed.offsetX + 96; ox += 8) {
      testCandidate({ ...seed, offsetX: ox, offsetY: oy })
    }
  }

  for (let oy = best.offsetY - 24; oy <= best.offsetY + 24; oy += 2) {
    for (let ox = best.offsetX - 24; ox <= best.offsetX + 24; ox += 2) {
      testCandidate({ ...best, offsetX: ox, offsetY: oy })
    }
  }

  for (let cell = best.cellAdjust - 12; cell <= best.cellAdjust + 12; cell += 1) {
    for (let gap = best.gapAdjust - 8; gap <= best.gapAdjust + 8; gap += 1) {
      testCandidate({ ...best, cellAdjust: cell, gapAdjust: gap })
    }
  }

  return { calibration: best, score: bestScore }
}

export function estimatePageCapacityFromAnchors(page) {
  if (!page?.anchors?.length) return 0

  // contiguousCount is the most reliable: confirmed consecutive indices from anchor scan.
  if (page.contiguousCount > 0) return page.contiguousCount

  // Fallback: use the maximum index value seen in the anchor list.
  // This is far more reliable than raw anchor count — pdfjs may miss some anchor
  // text items (font-size filtering, glyph cluster merging) but the ones it DOES
  // find give a lower-bound on how many cells exist on this page.
  const maxIndex = Math.max(...page.anchors.map(a => a.index ?? 0))
  if (maxIndex > 0) return maxIndex

  return page.anchors.length
}

export function buildAutoPageProfiles(pages, chars) {
  return pages.map(page => {
    const anchorAuto = findAnchorCalibration(page, chars)
    const gridAuto = findAutoCalibration(page, chars)
    const strongCodeAnchors = (page.codeAnchorCount || 0) >= MIN_TRUSTED_INDEX_TARGETS
    const picked = strongCodeAnchors
      ? anchorAuto || gridAuto
      : anchorAuto && anchorAuto.score >= gridAuto.score - 10
        ? anchorAuto
        : gridAuto

    return {
      ...page,
      autoCalibration: picked.calibration,
      autoScore: picked.score,
      autoSource: picked === anchorAuto ? "anchor" : "scan",
      anchorCapacity: estimatePageCapacityFromAnchors(page),
    }
  })
}
