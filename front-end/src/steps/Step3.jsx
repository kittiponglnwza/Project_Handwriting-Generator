import { useEffect, useMemo, useRef, useState } from "react"
import { GlobalWorkerOptions, getDocument } from "pdfjs-dist"
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url"
import Btn from "../components/Btn"
import InfoBox from "../components/InfoBox"
import C from "../styles/colors"

GlobalWorkerOptions.workerSrc = pdfWorker

const GRID_COLS = 6
const TEMPLATE_CODE_RE = /^HG(\d{1,4})$/i
const HGMETA_RE = /HGMETA:page=(\d+),totalPages=(\d+),from=(\d+),to=(\d+),count=(\d+),total=(\d+)/
// Optional ,j=… = base64url(JSON array of one string per cell on this page)
const HGQR_RE =
  /^HG:p=(\d+)\/(\d+),c=(\d+)-(\d+),n=(\d+),t=(\d+)(?:,j=([A-Za-z0-9_-]+))?$/

function decodeHgQrCharsPayload(b64url) {
  if (!b64url) return null
  try {
    let b64 = b64url.replace(/-/g, "+").replace(/_/g, "/")
    const pad = b64.length % 4
    if (pad) b64 += "=".repeat(4 - pad)
    const binary = atob(b64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
    const json = new TextDecoder("utf-8").decode(bytes)
    const arr = JSON.parse(json)
    if (!Array.isArray(arr)) return null
    return arr.map(x => (x == null ? "" : String(x)))
  } catch {
    return null
  }
}

// Scan imageData for QR code using jsQR (loaded via CDN)
function decodeQRFromImageData(imageData, width, height) {
  try {
    const jsQR = window.jsQR
    if (!jsQR) return null
    const result = jsQR(imageData, width, height, { inversionAttempts: "dontInvert" })
    if (!result?.data) return null
    const m = result.data.trim().match(HGQR_RE)
    if (!m) return null
    const cellCount = Number(m[5])
    let charsFromQr = m[7] ? decodeHgQrCharsPayload(m[7]) : null
    if (charsFromQr && charsFromQr.length !== cellCount) charsFromQr = null
    return {
      page: Number(m[1]),
      totalPages: Number(m[2]),
      cellFrom: Number(m[3]),
      cellTo: Number(m[4]),
      cellCount,
      totalGlyphs: Number(m[6]),
      charsFromQr: charsFromQr || null,
      qrBounds: result.location,
    }
  } catch {
    return null
  }
}

function extractCharsetIfCompleteInQr(pages) {
  if (!pages?.length) return null
  const sorted = [...pages].sort((a, b) => a.pageNumber - b.pageNumber)
  const acc = []
  let expectedTotal = null
  for (const p of sorted) {
    const m = p.pageMeta
    if (!m || !Number.isFinite(m.cellCount) || m.cellCount < 1) return null
    if (expectedTotal == null && Number.isFinite(m.totalGlyphs)) expectedTotal = m.totalGlyphs
    const c = m.charsFromQr
    if (!Array.isArray(c) || c.length !== m.cellCount) return null
    acc.push(...c)
  }
  if (Number.isFinite(expectedTotal) && acc.length !== expectedTotal) return null
  return acc.length > 0 ? acc : null
}
const TEMPLATE_INDEX_RE = /^(\d{1,4})$/
const MIN_TRUSTED_INDEX_TARGETS = 6
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

// Measured from HG anchor positions in template PDF at scale=3:
//   HG001 x1=352.6px → cell left=116px, baseStartX=133.9 → offsetX=-18
//   HG001 y0=370.3px → cell top=344.3px, desiredStartY=479.9 → offsetY=-136
//   row pitch actual=256.5px ≈ computed=256.1px → cellAdjust=0
const TEMPLATE_CALIBRATION = {
  offsetX: -18,
  offsetY: -136,
  cellAdjust: 0,
  gapAdjust: 0,
}

function mergeCalibration(base, manual = DEFAULT_CALIBRATION) {
  return {
    offsetX: (base?.offsetX || 0) + (manual?.offsetX || 0),
    offsetY: (base?.offsetY || 0) + (manual?.offsetY || 0),
    cellAdjust: (base?.cellAdjust || 0) + (manual?.cellAdjust || 0),
    gapAdjust: (base?.gapAdjust || 0) + (manual?.gapAdjust || 0),
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function median(values) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[mid]
  return (sorted[mid - 1] + sorted[mid]) / 2
}

// Detect blue registration dots (from template corner markers) in imageData.
// Returns array of {x, y} center positions.
function detectRegDots(imageData, pageWidth, pageHeight) {
  const data = imageData
  const dots = []
  const visited = new Uint8Array(pageWidth * pageHeight)
  const STEP = 2

  for (let y = 0; y < pageHeight; y += STEP) {
    for (let x = 0; x < pageWidth; x += STEP) {
      const idx = (y * pageWidth + x) * 4
      const r = data[idx], g = data[idx + 1], b = data[idx + 2], a = data[idx + 3]
      if (a < 100) continue
      // Blue registration dot: b dominant, moderate saturation
      if (b < 140 || b - r < 40 || b - g < 30) continue
      if (visited[y * pageWidth + x]) continue

      // Flood-fill to find dot extent
      let minX = x, maxX = x, minY = y, maxY = y, count = 0
      const stack = [[x, y]]
      while (stack.length > 0) {
        const [cx, cy] = stack.pop()
        if (cx < 0 || cx >= pageWidth || cy < 0 || cy >= pageHeight) continue
        if (visited[cy * pageWidth + cx]) continue
        const i2 = (cy * pageWidth + cx) * 4
        const r2 = data[i2], g2 = data[i2+1], b2 = data[i2+2], a2 = data[i2+3]
        if (a2 < 80 || b2 < 120 || b2 - r2 < 30 || b2 - g2 < 20) continue
        visited[cy * pageWidth + cx] = 1
        count++
        if (cx < minX) minX = cx; if (cx > maxX) maxX = cx
        if (cy < minY) minY = cy; if (cy > maxY) maxY = cy
        stack.push([cx+1,cy],[cx-1,cy],[cx,cy+1],[cx,cy-1])
      }

      const w = maxX - minX + 1
      const h = maxY - minY + 1
      // Registration dots are ~4px rendered at scale=3 → ~12px, allow range 6–30px
      if (count < 20 || w < 5 || h < 5 || w > 40 || h > 40) continue
      dots.push({ x: (minX + maxX) / 2, y: (minY + maxY) / 2, w, h })
    }
  }
  return dots
}

// From detected registration dots, compute per-cell positions.
// Each cell has 4 corner dots: TL, TR, BL, BR.
// Groups nearby dots into cell quads using grid structure.
function buildCellRectsFromDots(dots, pageWidth, pageHeight, expectedCols, expectedCount) {
  if (dots.length < 4) return null

  // Sort by Y then X to find grid structure
  const sorted = [...dots].sort((a, b) => a.y - b.y || a.x - b.x)

  // Estimate cell pitch from dot spacing
  const xs = [...new Set(dots.map(d => Math.round(d.x / 8) * 8))].sort((a,b) => a-b)
  const ys = [...new Set(dots.map(d => Math.round(d.y / 8) * 8))].sort((a,b) => a-b)

  if (xs.length < 2 || ys.length < 2) return null

  // Each cell column boundary is defined by pairs of x positions (left-dot, right-dot)
  // Group x positions into pairs by proximity
  const colXs = [] // center x of each column's left edge dots
  let i = 0
  while (i < xs.length) {
    let j = i + 1
    while (j < xs.length && xs[j] - xs[i] < pageWidth * 0.12) j++
    colXs.push(xs[i])
    i = j
  }

  const rowYs = []
  let ri = 0
  while (ri < ys.length) {
    let rj = ri + 1
    while (rj < ys.length && ys[rj] - ys[ri] < pageHeight * 0.08) rj++
    rowYs.push(ys[ri])
    ri = rj
  }

  if (colXs.length < 2 || rowYs.length < 2) return null

  // Build cell rects from grid intersections
  const cellRects = []
  for (let row = 0; row + 1 < rowYs.length; row++) {
    for (let col = 0; col + 1 < colXs.length; col++) {
      const x1 = colXs[col]
      const y1 = rowYs[row]
      const x2 = colXs[col + 1]
      const y2 = rowYs[row + 1]
      cellRects.push({ x: x1, y: y1, w: x2 - x1, h: y2 - y1, row, col })
    }
  }

  return cellRects.length > 0 ? cellRects : null
}

function sortCellRectsReadingOrder(rects) {
  if (!rects?.length) return []
  const avgH = rects.reduce((s, r) => s + r.h, 0) / rects.length
  const rowTol = Math.max(14, avgH * 0.45)
  return [...rects].sort((a, b) => {
    const cyA = a.y + a.h * 0.5
    const cyB = b.y + b.h * 0.5
    if (Math.abs(cyA - cyB) > rowTol) return cyA - cyB
    return a.x + a.w * 0.5 - (b.x + b.w * 0.5)
  })
}

// PDF.js: y is near baseline in top-left canvas space; nudge up into the cell body.
function anchorPointForCellIndexBox(anchor) {
  const ax = anchor.x + (anchor.width || 0) * 0.5
  const ay = (anchor.y || 0) - (anchor.height || 0) * 0.55
  return { ax, ay }
}

function pointInRectLoose(px, py, r, pad = 8) {
  return (
    px >= r.x - pad &&
    px <= r.x + r.w + pad &&
    py >= r.y - pad &&
    py <= r.y + r.h + pad
  )
}

// Drop spurious grids above/beside the real sheet when dot clustering returns too many cells.
function filterCellRectsNearAnchorHull(cellRects, anchorByIndex, cellFrom, cellCount) {
  if (!anchorByIndex?.size || !cellRects?.length) return cellRects
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  let any = false
  for (let i = 0; i < cellCount; i += 1) {
    const idx = cellFrom + i
    const a = anchorByIndex.get(idx)
    if (!a) continue
    any = true
    const { ax, ay } = anchorPointForCellIndexBox(a)
    minX = Math.min(minX, ax - 24)
    maxX = Math.max(maxX, ax + 24)
    minY = Math.min(minY, ay - 24)
    maxY = Math.max(maxY, ay + 24)
  }
  if (!any) return cellRects
  const pad = 48
  const filtered = cellRects.filter(r => {
    const cx = r.x + r.w * 0.5
    const cy = r.y + r.h * 0.5
    return cx >= minX - pad && cx <= maxX + pad && cy >= minY - pad && cy <= maxY + pad
  })
  return filtered.length >= cellCount ? filtered : cellRects
}

// Map global 1-based cell indices (HGxxx) → one rect per slot, using PDF text anchors for cell numbers.
function orderCellRectsByAnchorIndex(cellRects, anchorByIndex, cellFrom, cellCount) {
  if (!Array.isArray(cellRects) || cellRects.length === 0) return null
  if (!cellCount || cellCount < 1) return null

  const indices = Array.from({ length: cellCount }, (_, i) => cellFrom + i)
  const assigned = new Map()
  const usedRi = new Set()

  if (!anchorByIndex || anchorByIndex.size === 0) {
    const sorted = sortCellRectsReadingOrder(cellRects)
    return sorted.length >= cellCount ? sorted.slice(0, cellCount) : null
  }

  // 1) Prefer rects that contain the anchor point (smallest area wins).
  for (const idx of indices) {
    const a = anchorByIndex.get(idx)
    if (!a) continue
    const { ax, ay } = anchorPointForCellIndexBox(a)
    let bestRi = -1
    let bestArea = Infinity
    for (let ri = 0; ri < cellRects.length; ri += 1) {
      if (usedRi.has(ri)) continue
      const r = cellRects[ri]
      if (pointInRectLoose(ax, ay, r)) {
        const area = r.w * r.h
        if (area < bestArea) {
          bestArea = area
          bestRi = ri
        }
      }
    }
    if (bestRi >= 0) {
      usedRi.add(bestRi)
      assigned.set(idx, cellRects[bestRi])
    }
  }

  // 2) Nearest centroid for remaining anchors.
  for (const idx of indices) {
    if (assigned.has(idx)) continue
    const a = anchorByIndex.get(idx)
    if (!a) continue
    const { ax, ay } = anchorPointForCellIndexBox(a)
    let bestRi = -1
    let bestD = Infinity
    for (let ri = 0; ri < cellRects.length; ri += 1) {
      if (usedRi.has(ri)) continue
      const r = cellRects[ri]
      const rcx = r.x + r.w * 0.5
      const rcy = r.y + r.h * 0.5
      const d = (ax - rcx) ** 2 + (ay - rcy) ** 2
      if (d < bestD) {
        bestD = d
        bestRi = ri
      }
    }
    if (bestRi >= 0) {
      usedRi.add(bestRi)
      assigned.set(idx, cellRects[bestRi])
    }
  }

  // 3) Fill holes with unused rects in reading order (handles missing text anchors).
  const missing = indices.filter(idx => !assigned.has(idx))
  const unusedRis = []
  for (let ri = 0; ri < cellRects.length; ri += 1) {
    if (!usedRi.has(ri)) unusedRis.push(ri)
  }
  unusedRis.sort((riA, riB) => {
    const a = cellRects[riA]
    const b = cellRects[riB]
    const cyA = a.y + a.h * 0.5
    const cyB = b.y + b.h * 0.5
    const avgH = (a.h + b.h) * 0.5
    if (Math.abs(cyA - cyB) > avgH * 0.45) return cyA - cyB
    return a.x + a.w * 0.5 - (b.x + b.w * 0.5)
  })
  missing.forEach((idx, j) => {
    if (j >= unusedRis.length) return
    const ri = unusedRis[j]
    usedRi.add(ri)
    assigned.set(idx, cellRects[ri])
  })

  const ordered = indices.map(idx => assigned.get(idx))
  if (ordered.some(r => !r)) return null
  return ordered
}

function buildOrderedCellRectsForPage(page, pageCellFrom, pageMaxCells) {
  if (!page?.regDots?.length || pageMaxCells <= 0) return null
  const cellRectsRaw = buildCellRectsFromDots(
    page.regDots,
    page.pageWidth,
    page.pageHeight,
    GRID_COLS,
    pageMaxCells
  )
  if (!cellRectsRaw?.length) return null

  let pool = cellRectsRaw
  if (cellRectsRaw.length > pageMaxCells + 2 && page.anchorByIndex?.size) {
    const filtered = filterCellRectsNearAnchorHull(
      cellRectsRaw,
      page.anchorByIndex,
      pageCellFrom,
      pageMaxCells
    )
    if (filtered.length >= pageMaxCells) pool = filtered
  }

  return orderCellRectsByAnchorIndex(pool, page.anchorByIndex, pageCellFrom, pageMaxCells)
}

function buildTargetsFromPages(pages) {
  const codeIndices = new Set()
  const numericIndices = new Set()

  for (const page of pages) {
    for (const anchor of page.anchors || []) {
      if (!Number.isFinite(anchor.index) || anchor.index < 1) continue
      if (anchor.kind === "code") {
        codeIndices.add(anchor.index)
      } else {
        numericIndices.add(anchor.index)
      }
    }
  }

  const source = codeIndices.size > 0 ? codeIndices : numericIndices
  if (source.size === 0) return []

  let contiguousCount = 0
  while (source.has(contiguousCount + 1)) contiguousCount += 1

  // Numeric-only anchors are noisy (page numbers, headers). Trust only when enough contiguous targets exist.
  if (codeIndices.size === 0 && contiguousCount < MIN_TRUSTED_INDEX_TARGETS) return []

  const rawCount = contiguousCount > 0 ? contiguousCount : source.size
  const count = Math.max(1, Math.min(1024, rawCount))
  return Array.from({ length: count }, (_, i) => String(i + 1))
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

function buildInkOnlyImageData(imageData, width, height) {
  const cleaned = new ImageData(new Uint8ClampedArray(imageData.data), width, height)
  const { data } = cleaned
  const rowGuideCount = new Array(height).fill(0)
  const rowDarkCount = new Array(height).fill(0)

  const isGuideTone = (r, g, b, a) => {
    if (a < 16) return false
    const lum = r * 0.2126 + g * 0.7152 + b * 0.0722
    const blueDom = b - Math.max(r, g)
    const rgDiff = Math.abs(r - g)
    return lum > 120 && lum < 245 && blueDom > 8 && blueDom < 86 && rgDiff < 42
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (y * width + x) * 4
      const r = data[idx]
      const g = data[idx + 1]
      const b = data[idx + 2]
      const a = data[idx + 3]
      if (isGuideTone(r, g, b, a)) rowGuideCount[y] += 1
      const lum = r * 0.2126 + g * 0.7152 + b * 0.0722
      if (a > 16 && lum < 115) rowDarkCount[y] += 1
    }
  }

  const guideRows = new Array(height).fill(false)
  for (let y = 0; y < height; y += 1) {
    const guideRatio = rowGuideCount[y] / width
    const darkRatio = rowDarkCount[y] / width
    if (guideRatio > 0.26 && darkRatio < 0.2) {
      guideRows[y] = true
      if (y > 0) guideRows[y - 1] = true
      if (y + 1 < height) guideRows[y + 1] = true
    }
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (y * width + x) * 4
      const r = data[idx]
      const g = data[idx + 1]
      const b = data[idx + 2]
      const a = data[idx + 3]
      if (guideRows[y] && isGuideTone(r, g, b, a)) {
        data[idx] = 255
        data[idx + 1] = 255
        data[idx + 2] = 255
        data[idx + 3] = 255
      }
    }
  }

  for (let y = 0; y < height; y += 1) {
    const rowGuideRatio = rowGuideCount[y] / width
    for (let x = 0; x < width; x += 1) {
      const idx = (y * width + x) * 4
      const r = data[idx]
      const g = data[idx + 1]
      const b = data[idx + 2]
      const a = data[idx + 3]
      const lum = r * 0.2126 + g * 0.7152 + b * 0.0722
      const blueDom = b - Math.max(r, g)

      const shouldDropGuide =
        lum > 168 &&
        blueDom > 6 &&
        rowGuideRatio > 0.12 &&
        rowDarkCount[y] / width < 0.28

      if (a > 12 && shouldDropGuide) {
        data[idx] = 255
        data[idx + 1] = 255
        data[idx + 2] = 255
        data[idx + 3] = 255
      }
    }
  }

  return cleaned
}

function getGridGeometry(pageWidth, pageHeight, charsLength, calibration) {
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

function getPageCapacity(pageHeight, startY, cellSize, gap) {
  const usableBottom = pageHeight * (1 - GRID_CONFIG.bottomRatio)
  const rows = Math.max(1, Math.floor((usableBottom - startY + gap) / (cellSize + gap)))
  return rows * GRID_COLS
}

async function collectTextAnchors(page, viewport, maxIndex) {
  const textContent = await page.getTextContent()
  const items = textContent.items || []
  const rawAnchors = []

  for (let i = 0; i < items.length; i += 1) {
    const item = items[i]
    const raw = String(item?.str || "").trim()
    if (!raw) continue

    const codeMatch = raw.match(TEMPLATE_CODE_RE)
    const indexMatch = raw.match(TEMPLATE_INDEX_RE)
    const prevRaw = String(items[i - 1]?.str || "").trim()
    const hasCodePrefix = /^HG$/i.test(prevRaw)
    let kind = null
    let index = 0

    if (codeMatch) {
      kind = "code"
      index = Number(codeMatch[1])
    } else if (indexMatch && hasCodePrefix) {
      kind = "code"
      index = Number(indexMatch[1])
    } else if (indexMatch) {
      kind = "index"
      index = Number(indexMatch[1])
    } else {
      continue
    }

    if (!Number.isFinite(index) || index < 1 || index > maxIndex) {
      continue
    }

    const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0] = item.transform || []
    const x = Number(e)
    const y = viewport.height - Number(f)
    const width = Number(item.width || Math.hypot(a, b) * raw.length || 0)
    const height = Number(item.height || Math.hypot(c, d) || 0)

    // Ignore header/footer noise and oversized non-cell text.
    if (y < viewport.height * 0.14 || y > viewport.height * 0.97) continue
    if (height > viewport.height * 0.07) continue
    if (width > viewport.width * 0.16) continue

    rawAnchors.push({
      index,
      kind,
      x,
      y,
      width,
      height,
    })
  }

  const byIndex = new Map()
  for (const anchor of rawAnchors) {
    const prev = byIndex.get(anchor.index)
    if (!prev) {
      byIndex.set(anchor.index, anchor)
      continue
    }
    if (prev.kind !== "code" && anchor.kind === "code") {
      byIndex.set(anchor.index, anchor)
      continue
    }
    const prevDistance = Math.abs(prev.y - viewport.height * 0.55)
    const nextDistance = Math.abs(anchor.y - viewport.height * 0.55)
    if (nextDistance < prevDistance) {
      byIndex.set(anchor.index, anchor)
    }
  }

  const anchors = [...byIndex.values()].sort((a, b) => a.index - b.index)
  const codeAnchorCount = anchors.filter(a => a.kind === "code").length
  const allIndices = anchors.map(a => a.index)
  const startIndex = allIndices.length > 0 ? Math.min(...allIndices) : null
  let contiguousCount = 0
  if (startIndex != null) {
    while (byIndex.has(startIndex + contiguousCount)) {
      contiguousCount += 1
    }
  }

  // Parse HGMETA tag — machine-readable cell count embedded by App.jsx
  let pageMeta = null
  for (const item of items) {
    const raw = String(item?.str || "")
    const m = raw.match(HGMETA_RE)
    if (m) {
      pageMeta = {
        page: Number(m[1]),
        totalPages: Number(m[2]),
        cellFrom: Number(m[3]),
        cellTo: Number(m[4]),
        cellCount: Number(m[5]),
        totalGlyphs: Number(m[6]),
      }
      break
    }
  }

  return {
    anchors,
    byIndex,
    startIndex,
    contiguousCount,
    hasCodeAnchors: codeAnchorCount > 0,
    codeAnchorCount,
    pageMeta,
  }
}

function extractGlyphsFromCanvas({ ctx, pageWidth, pageHeight, chars, calibration, cellRects }) {
  // If we have cell rects from registration dots, use them directly — survives GoodNotes rescaling
  const useRegDots = cellRects && cellRects.length >= chars.length

  let gap, cellSize, startX, startY
  if (!useRegDots) {
    const geom = getGridGeometry(pageWidth, pageHeight, chars.length, calibration)
    gap = geom.gap; cellSize = geom.cellSize; startX = geom.startX; startY = geom.startY
  }

  return chars.map((ch, i) => {
    const row = Math.floor(i / GRID_COLS)
    const col = i % GRID_COLS

    let x, y, size
    if (useRegDots && cellRects[i]) {
      const rect = cellRects[i]
      const insetR = Math.round(rect.w * GRID_CONFIG.insetRatio)
      x = rect.x; y = rect.y
      size = Math.max(20, Math.round(Math.min(rect.w, rect.h) - insetR * 2))
    } else {
      const inset = Math.round(cellSize * GRID_CONFIG.insetRatio)
      x = Math.round(startX + col * (cellSize + gap))
      y = Math.round(startY + row * (cellSize + gap))
      size = Math.max(20, Math.round(cellSize - inset * 2))
    }

    const inset = useRegDots && cellRects[i]
      ? Math.round(Math.min(cellRects[i].w, cellRects[i].h) * GRID_CONFIG.insetRatio)
      : Math.round(cellSize * GRID_CONFIG.insetRatio)

    const cropX = clamp(x + inset, 0, Math.max(0, pageWidth - size))
    const cropY = clamp(y + inset, 0, Math.max(0, pageHeight - size))

    const imageData = ctx.getImageData(cropX, cropY, size, size)
    const cropCanvas = document.createElement("canvas")
    cropCanvas.width = size
    cropCanvas.height = size
    const cropCtx = cropCanvas.getContext("2d")
    cropCtx?.putImageData(imageData, 0, 0)
    const inkOnlyData = buildInkOnlyImageData(imageData, size, size)
    const inkCanvas = document.createElement("canvas")
    inkCanvas.width = size
    inkCanvas.height = size
    const inkCtx = inkCanvas.getContext("2d")
    inkCtx?.putImageData(inkOnlyData, 0, 0)

    const { status, inkRatio, edgeRatio } = classifyGlyph(imageData, size, size)

    return {
      id: `${i}-${ch}`,
      index: i + 1,
      ch,
      status,
      inkRatio,
      edgeRatio,
      preview: cropCanvas.toDataURL("image/png"),
      previewInk: inkCanvas.toDataURL("image/png"),
    }
  })
}

function getBlueSignal(data, pageWidth, pageHeight, x, y) {
  if (x < 0 || y < 0 || x >= pageWidth || y >= pageHeight) return 0
  const idx = (Math.round(y) * pageWidth + Math.round(x)) * 4
  const a = data[idx + 3]
  if (a < 10) return 0
  const r = data[idx]
  const g = data[idx + 1]
  const b = data[idx + 2]
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

function scoreCalibration(page, chars, calibration) {
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

function findAutoCalibration(page, chars) {
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

function findAnchorCalibration(page, chars) {
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

function estimatePageCapacityFromAnchors(page) {
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

function buildAutoPageProfiles(pages, chars) {
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

function GridDebugOverlay({ pageRef, pageVersion, chars, calibration }) {
  const containerRef = useRef(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const store = pageRef.current
    if (!store?.pages?.length || chars.length === 0) return

    // Clear previous renders
    while (container.firstChild) container.removeChild(container.firstChild)

    const DISPLAY_W = 320

    let cursor = 0

    for (const page of store.pages) {
      if (cursor >= chars.length) break
      const { ctx: srcCtx, pageWidth, pageHeight } = page
      if (!srcCtx) continue

      const pageStartIndexFromMeta =
        page.pageMeta?.cellFrom > 0 ? page.pageMeta.cellFrom - 1 : null
      const pageStartIndex = pageStartIndexFromMeta ?? cursor
      const remaining = Math.max(0, chars.length - pageStartIndex)
      if (remaining <= 0) continue
      const baseCalibration = TEMPLATE_CALIBRATION
      const pageGeomCalib = mergeCalibration(baseCalibration, calibration)
      // Use HGMETA cellCount if available — exact value written into the PDF
      let pageMaxCells
      if (page.pageMeta?.cellCount > 0) {
        pageMaxCells = Math.min(page.pageMeta.cellCount, remaining)
      } else {
        const geomForCap = getGridGeometry(pageWidth, pageHeight, Math.min(remaining, 24), pageGeomCalib)
        pageMaxCells = getPageCapacity(pageHeight, geomForCap.startY, geomForCap.cellSize, geomForCap.gap)
        if ((page.anchorCapacity || 0) >= MIN_TRUSTED_INDEX_TARGETS) {
          pageMaxCells = Math.min(pageMaxCells, page.anchorCapacity)
        }
        pageMaxCells = Math.min(pageMaxCells, remaining)
      }
      if (pageMaxCells <= 0) continue

      const pageCellFrom = page.pageMeta?.cellFrom > 0 ? page.pageMeta.cellFrom : pageStartIndex + 1

      const pageCellRectsOrdered =
        page.regDots?.length >= 4
          ? buildOrderedCellRectsForPage(page, pageCellFrom, pageMaxCells)
          : null
      if (pageCellRectsOrdered) {
        pageCellRectsOrdered = pageCellRectsOrdered.map(r => ({
          ...r,
          x: r.x + calibration.offsetX,
          y: r.y + calibration.offsetY,
        }))
      }

      // Step 2: geometry for drawing — fallback when dots/anchors are insufficient.
      const gridGeom = pageCellRectsOrdered
        ? null
        : getGridGeometry(pageWidth, pageHeight, pageMaxCells, pageGeomCalib)

      const scaleF = DISPLAY_W / pageWidth
      const canvas = document.createElement("canvas")
      canvas.width = DISPLAY_W
      canvas.height = Math.round(pageHeight * scaleF)

      const ctx = canvas.getContext("2d")
      ctx.save(); ctx.scale(scaleF, scaleF); ctx.drawImage(srcCtx.canvas, 0, 0); ctx.restore()
      ctx.save(); ctx.scale(scaleF, scaleF)
      for (let i = 0; i < pageMaxCells; i++) {
        const targetChar = String(chars[pageStartIndex + i] || "")

        let cx
        let cy
        let outerW
        let outerH
        let innerSide
        let innerInset

        if (pageCellRectsOrdered) {
          const rect = pageCellRectsOrdered[i]
          cx = Math.round(rect.x)
          cy = Math.round(rect.y)
          outerW = Math.round(rect.w)
          outerH = Math.round(rect.h)

          const insetR = Math.round(rect.w * GRID_CONFIG.insetRatio)
          innerSide = Math.max(20, Math.round(Math.min(rect.w, rect.h) - insetR * 2))
          innerInset = Math.round(Math.min(rect.w, rect.h) * GRID_CONFIG.insetRatio)
        } else {
          const { gap, cellSize, startX, startY } = gridGeom
          const row = Math.floor(i / GRID_COLS)
          const col = i % GRID_COLS
          cx = Math.round(startX + col * (cellSize + gap))
          cy = Math.round(startY + row * (cellSize + gap))
          outerW = Math.round(cellSize)
          outerH = Math.round(cellSize)
          innerInset = Math.round(outerW * GRID_CONFIG.insetRatio)
          innerSide = Math.round(cellSize)
        }

        ctx.strokeStyle = "rgba(0,200,80,0.9)"; ctx.lineWidth = 1.5 / scaleF
        ctx.strokeRect(cx, cy, outerW, outerH)
        ctx.strokeStyle = "rgba(30,100,255,0.7)"; ctx.lineWidth = 1 / scaleF
        ctx.strokeRect(cx + innerInset, cy + innerInset, innerSide - innerInset * 2, innerSide - innerInset * 2)
        ctx.fillStyle = "rgba(0,0,0,0.75)"
        ctx.font = `bold ${Math.round(innerSide * 0.16)}px sans-serif`
        ctx.fillText(targetChar, cx + 4, cy + innerSide * 0.21)
      }
      ctx.restore()

      const label = document.createElement("p")
      label.textContent = `หน้า ${page.pageNumber}  (ช่อง ${pageStartIndex + 1}–${pageStartIndex + pageMaxCells})`
      label.style.cssText = "font-size:10px;color:#888;text-align:center;margin:0 0 4px;font-family:sans-serif"

      const wrapper = document.createElement("div")
      wrapper.style.cssText = "display:flex;flex-direction:column;flex-shrink:0"
      canvas.style.cssText = "border-radius:8px;border:1px solid #ddd;display:block;width:100%"
      wrapper.appendChild(label)
      wrapper.appendChild(canvas)
      container.appendChild(wrapper)

      cursor = Math.max(cursor, pageStartIndex + pageMaxCells)
    }
  }, [pageRef, pageVersion, chars, calibration])

  return (
    <div
      ref={containerRef}
      style={{
        display: "flex",
        gap: 12,
        overflowX: "auto",
        paddingBottom: 4,
        alignItems: "flex-start",
      }}
    />
  )
}

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
          // Load jsQR for QR decoding if not already loaded
          if (!window.jsQR) {
            await new Promise((resolve, reject) => {
              const s = document.createElement('script')
              s.src = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js'
              s.onload = resolve; s.onerror = reject
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
            // Decode QR code embedded in template for precise page/cell metadata
            const qrMeta = decodeQRFromImageData(imgData.data, canvas.width, canvas.height)
            const regDots = detectRegDots(imgData.data, canvas.width, canvas.height)
            pages.push({
              ctx,
              pageWidth: canvas.width,
              pageHeight: canvas.height,
              imageData: imgData.data,
              regDots,
              pageNumber,
              anchors: anchorInfo.anchors,
              anchorByIndex: anchorInfo.byIndex,
              anchorStartIndex: anchorInfo.startIndex,
              contiguousCount: anchorInfo.contiguousCount,
              hasCodeAnchors: anchorInfo.hasCodeAnchors,
              codeAnchorCount: anchorInfo.codeAnchorCount || 0,
              // QR + HGMETA: QR wins for ranges; charset only comes from QR when ,j= is present.
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

      // Prefer per-page auto calibration when available, then apply manual slider offsets.
      const baseCalibration = TEMPLATE_CALIBRATION
      const pageCalibration = mergeCalibration(baseCalibration, calibration)

      // Prefer explicit per-page range from QR/HGMETA to avoid index drift.
      const startIndex =
        page.pageMeta?.cellFrom > 0 ? page.pageMeta.cellFrom - 1 : cursor

      // HGMETA tag gives us the exact cell count written into this page — use it directly.
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
      if (pageMaxCells <= 0) continue

      // Build cell rects from registration dots if available
      const pageCellFrom = page.pageMeta?.cellFrom > 0 ? page.pageMeta.cellFrom : startIndex + 1
      const pageCellRects =
        page.regDots?.length >= 4
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

      const pageGlyphs = extractGlyphsFromCanvas({
        ctx: page.ctx,
        pageWidth: page.pageWidth,
        pageHeight: page.pageHeight,
        chars: pageChars,
        calibration: pageCalibration,
        cellRects: pageCellRects,
      }).map((g, i) => ({
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

  const summary = useMemo(() => {
    const ok = glyphs.filter(g => g.status === "ok").length
    const missing = glyphs.filter(g => g.status === "missing").length
    const overflow = glyphs.filter(g => g.status === "overflow").length
    return { ok, missing, overflow, total: glyphs.length }
  }, [glyphs])

  const activeGlyph = glyphs.find(g => g.id === activeId) || null

  useEffect(() => {
    onGlyphsUpdate(glyphs)
  }, [glyphs, onGlyphsUpdate])

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
          ไม่พบ target ช่องจากไฟล์ PDF นี้ (HG/เลขช่อง) คุณสามารถใช้ไฟล์ template ที่มีรหัสช่อง หรือเลือกตัวอักษรใน Step 1 เป็นโหมดสำรองได้
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
            {autoInfo && (
              <span style={{ fontSize: 11, color: C.inkLt }}>
                {autoInfo}
              </span>
            )}
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
        <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 14, padding: 14, marginBottom: 14 }}>
          <p style={{ fontSize: 11, color: C.inkLt, marginBottom: 8 }}>
            🟩 outer cell &nbsp;|&nbsp; 🟦 crop zone — ปรับ slider แล้ว overlay อัปเดตตาม
          </p>
          <GridDebugOverlay pageRef={pageRef} pageVersion={pageVersion} chars={chars} calibration={calibration} />
        </div>
      )}

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
                รหัสช่อง: <b style={{ color: C.ink }}>HG{String(activeGlyph.index).padStart(3, "0")}</b>
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
              Ink coverage {(zoomGlyph.inkRatio * 100).toFixed(2)}% • Border touch {(zoomGlyph.edgeRatio * 100).toFixed(2)}%
            </p>
          </div>
        </div>
      )}
    </div>
  )
}