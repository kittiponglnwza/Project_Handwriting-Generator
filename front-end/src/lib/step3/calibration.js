import { DEFAULT_CALIBRATION, GRID_COLS, MIN_TRUSTED_INDEX_TARGETS } from "./constants.js"
import { getGridGeometry } from "./glyphPipeline.js"
import { median } from "./utils.js"

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

export function scoreCalibration(page, chars, calibration) {
  const { imageData, pageWidth, pageHeight } = page
  if (!imageData) return Number.NEGATIVE_INFINITY

  const sampleCount = Math.min(chars.length, 24)
  const { gap, cellSize, startX, startY } = getGridGeometry(
    pageWidth,
    pageHeight,
    sampleCount,
    calibration
  )

  let score = 0
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

    const yMid = Math.round(cellY + cellSize * 0.42)
    const yBase = Math.round(cellY + cellSize * 0.72)
    const xFrom = Math.round(cellX + cellSize * 0.08)
    const xTo = Math.round(cellX + cellSize * 0.92)

    const midSignal = sampleHorizontalGuide(imageData, pageWidth, pageHeight, yMid, xFrom, xTo)
    const baseSignal = sampleHorizontalGuide(imageData, pageWidth, pageHeight, yBase, xFrom, xTo)
    score += midSignal + baseSignal
    validCells += 1
  }

  if (validCells === 0) return Number.NEGATIVE_INFINITY
  return score / validCells - outOfBounds * 12
}

export function findAutoCalibration(page, chars) {
  let best = { ...DEFAULT_CALIBRATION }
  let bestScore = Number.NEGATIVE_INFINITY

  const testCandidate = candidate => {
    const score = scoreCalibration(page, chars, candidate)
    if (score > bestScore) {
      bestScore = score
      best = candidate
    }
  }

  for (let oy = -260; oy <= 260; oy += 8) {
    testCandidate({ ...DEFAULT_CALIBRATION, offsetY: oy })
  }

  for (let ox = -180; ox <= 180; ox += 6) {
    testCandidate({ ...best, offsetX: ox })
  }

  for (let cell = -36; cell <= 36; cell += 4) {
    testCandidate({ ...best, cellAdjust: cell })
  }

  for (let gap = -24; gap <= 24; gap += 2) {
    testCandidate({ ...best, gapAdjust: gap })
  }

  for (let oy = best.offsetY - 24; oy <= best.offsetY + 24; oy += 2) {
    for (let ox = best.offsetX - 24; ox <= best.offsetX + 24; ox += 2) {
      testCandidate({ ...best, offsetX: ox, offsetY: oy })
    }
  }

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
  const sampleCount = Math.min(chars.length, 24)
  const baseGeometry = getGridGeometry(
    page.pageWidth,
    page.pageHeight,
    sampleCount,
    DEFAULT_CALIBRATION
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
  if (page.contiguousCount > 0) return page.contiguousCount

  const xs = page.anchors.map(a => a.x).sort((a, b) => a - b)
  const ys = page.anchors.map(a => a.y).sort((a, b) => a - b)

  const dx = []
  for (let i = 1; i < xs.length; i += 1) {
    const d = xs[i] - xs[i - 1]
    if (d > 4) dx.push(d)
  }
  const dy = []
  for (let i = 1; i < ys.length; i += 1) {
    const d = ys[i] - ys[i - 1]
    if (d > 4) dy.push(d)
  }

  const pitchX = median(dx)
  const pitchY = median(dy)

  if (!Number.isFinite(pitchX) || pitchX <= 0 || !Number.isFinite(pitchY) || pitchY <= 0) {
    return page.anchors.length
  }
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
