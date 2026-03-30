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
  insetRatio: 0.08,
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

// ─── Registration dot detection ──────────────────────────────────────────────
// Template CSS: .reg-tl/tr/bl/br { width:4px; height:4px; background:#3A7BD5; border-radius:50% }
// At PDF scale=3: dot renders ~12px diameter
// Color #3A7BD5 = RGB(58, 123, 213) → b dominant, mid luminance ~116
// Guide lines are #A8C1DD = RGB(168, 193, 221) → lighter, lower b-r spread

function detectRegDots(imageData, pageWidth, pageHeight) {
  const data = imageData
  const dots = []
  const visited = new Uint8Array(pageWidth * pageHeight)

  for (let y = 0; y < pageHeight; y++) {
    for (let x = 0; x < pageWidth; x++) {
      if (visited[y * pageWidth + x]) continue
      const idx = (y * pageWidth + x) * 4
      const r = data[idx], g = data[idx+1], b = data[idx+2], a = data[idx+3]
      if (a < 80) continue
      // Must be blue-dominant (#3A7BD5: b=213, r=58, g=123)
      // b-r >= 100, b-g >= 50, b >= 150
      if (b < 150 || b - r < 80 || b - g < 40) continue
      // Skip guide lines (#A8C1DD: b=221, r=168, g=193 → b-r=53, b-g=28) — too low spread
      // Our threshold b-r>=80 already excludes them
      // Skip red ink
      if (r > 150 && r - b > 50) continue

      // Flood-fill the blob
      let minX = x, maxX = x, minY = y, maxY = y, count = 0
      const stack = [y * pageWidth + x]
      while (stack.length > 0) {
        const pos = stack.pop()
        if (visited[pos]) continue
        const px = pos % pageWidth
        const py = Math.floor(pos / pageWidth)
        if (px < 0 || px >= pageWidth || py < 0 || py >= pageHeight) continue
        const i2 = pos * 4
        const r2 = data[i2], g2 = data[i2+1], b2 = data[i2+2], a2 = data[i2+3]
        if (a2 < 60) continue
        // Flood: same blue family — allow some variation for antialiasing
        if (b2 < 120 || b2 - r2 < 40 || b2 - g2 < 15) continue
        if (r2 > 150 && r2 - b2 > 30) continue
        visited[pos] = 1
        count++
        if (px < minX) minX = px; if (px > maxX) maxX = px
        if (py < minY) minY = py; if (py > maxY) maxY = py
        if (px + 1 < pageWidth)  stack.push(pos + 1)
        if (px - 1 >= 0)          stack.push(pos - 1)
        if (py + 1 < pageHeight)  stack.push(pos + pageWidth)
        if (py - 1 >= 0)          stack.push(pos - pageWidth)
      }

      const w = maxX - minX + 1
      const h = maxY - minY + 1
      // 4px CSS dot at scale=3 → ~12px; allow 6–28px for antialiasing/scan variation
      if (w < 5 || h < 5 || w > 30 || h > 30) continue
      // Must be roughly circular (not a line segment)
      if (Math.max(w, h) / Math.min(w, h) > 2.2) continue

      dots.push({ x: (minX + maxX) / 2, y: (minY + maxY) / 2, w, h })
    }
  }

  console.log(`[detectRegDots] ${pageWidth}×${pageHeight}: ${dots.length} dots`)
  return dots
}

// detectCellGridLines — not used (template has explicit reg dots)
function detectCellGridLines(_imageData, _pageWidth, _pageHeight) {
  return { vLines: [], hLines: [] }
}

// Build cell rects from registration dots.
// Each cell has 4 corner dots (TL, TR, BL, BR) at offset (2px, 2px) from cell corners.
// Strategy: cluster dot x-coords → col boundaries, cluster y-coords → row boundaries.
function buildCellRectsFromDots(dots, pageWidth, pageHeight, expectedCols, expectedCount) {
  if (dots.length < 4) return null

  function clusterCoords(vals, pageSize) {
    const sorted = [...vals].sort((a, b) => a - b)
    // min gap between distinct grid lines = 4% of page
    const minGap = pageSize * 0.04
    const clusters = []
    let group = [sorted[0]]
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i] - sorted[i-1] < minGap) {
        group.push(sorted[i])
      } else {
        clusters.push(group.reduce((s,v) => s+v, 0) / group.length)
        group = [sorted[i]]
      }
    }
    clusters.push(group.reduce((s,v) => s+v, 0) / group.length)
    return clusters
  }

  const xs = clusterCoords(dots.map(d => d.x), pageWidth)
  const ys = clusterCoords(dots.map(d => d.y), pageHeight)

  console.log(`[buildCellRectsFromDots] xs=${xs.length} ys=${ys.length} dots=${dots.length}`)
  if (xs.length < 2 || ys.length < 2) return null

  const minCellW = pageWidth * 0.05
  const minCellH = pageHeight * 0.04
  const maxCellW = pageWidth * 0.35
  const maxCellH = pageHeight * 0.30

  const cellRects = []
  for (let row = 0; row + 1 < ys.length; row++) {
    for (let col = 0; col + 1 < xs.length; col++) {
      const x1 = xs[col], y1 = ys[row]
      const x2 = xs[col+1], y2 = ys[row+1]
      const w = x2 - x1, h = y2 - y1
      if (w < minCellW || h < minCellH || w > maxCellW || h > maxCellH) continue
      cellRects.push({ x: x1, y: y1, w, h, row, col })
    }
  }

  console.log(`[buildCellRectsFromDots] cellRects=${cellRects.length} (expected ~${expectedCount})`)
  return cellRects.length > 0 ? cellRects : null
}

// buildCellRectsFromLines — not used
function buildCellRectsFromLines() { return null }

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
  if (!cellRectsRaw?.length) {
    console.warn(`[buildOrderedCellRectsForPage] หน้า ${page.pageNumber}: dots=${page.regDots.length} แต่สร้าง cell rects ไม่ได้`)
    return null
  }

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

  // ── Pass 1: สแกนทุก pixel → เก็บเฉพาะ ink มืด (ลายมือ) ──────────────────
  // ลบทุกอย่างที่ไม่ใช่ ink: เส้นบรรทัด, พื้นหลัง, สีฟ้า/เทา, ขอบกล่อง
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3]

    if (a < 30) {
      // transparent → white
      data[i] = data[i+1] = data[i+2] = 255; data[i+3] = 255; continue
    }

    const lum = r * 0.2126 + g * 0.7152 + b * 0.0722

    // ── ลบ: เส้นบรรทัดสีฟ้า/เทาฟ้า (guide lines) ──────────────────────────
    // ครอบคลุมทั้ง: สีเข้ม (#3A7BD5), สีอ่อน (#A8C1DD), ทุก shade ตรงกลาง
    const blueDom = b - Math.max(r, g)
    const isBlueFamily = blueDom > 5 && b > 100
    if (isBlueFamily) {
      data[i] = data[i+1] = data[i+2] = 255; data[i+3] = 255; continue
    }

    // ── ลบ: pixel สว่าง (พื้นหลัง, เส้นจาง, เงา) ──────────────────────────
    if (lum > 180) {
      data[i] = data[i+1] = data[i+2] = 255; data[i+3] = 255; continue
    }

    // ── เก็บ: ink มืด (ดินสอ, ปากกาดำ, ปากกาแดง) ──────────────────────────
    // ทำให้ดำสนิทเพื่อ SVG trace คมชัด
    data[i] = data[i+1] = data[i+2] = 0; data[i+3] = 255
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

// ───────────────────────────────────────────────────────────────
// SVG Tracing: แปลง inkCanvas → SVG path โดยไม่ต้องใช้ library
// ใช้ marching squares แบบ simplified เพื่อ trace contour จาก bitmap
// ───────────────────────────────────────────────────────────────
function traceToSVGPath(inkCanvas, width, height) {
  try {
    const ctx2 = inkCanvas.getContext("2d")
    if (!ctx2) return null

    const imageData = ctx2.getImageData(0, 0, width, height)
    const { data } = imageData

    // สร้าง binary mask: 1 = ink (pixel มืด), 0 = background
    const threshold = 180
    const mask = new Uint8Array(width * height)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4
        const r = data[idx], g = data[idx + 1], b = data[idx + 2], a = data[idx + 3]
        if (a < 50) { mask[y * width + x] = 0; continue }
        const lum = r * 0.2126 + g * 0.7152 + b * 0.0722
        mask[y * width + x] = lum < threshold ? 1 : 0
      }
    }

    // ตรวจว่ามี ink จริงมั้ย
    const inkCount = mask.reduce((s, v) => s + v, 0)
    if (inkCount < 10) return null

    // Scale factor: normalize path ให้อยู่ใน viewBox 0 0 100 100
    const scaleX = 100 / width
    const scaleY = 100 / height

    // ─── Outline tracing แบบ simple run-length scan ───
    // สร้าง path จาก contour ของ ink regions
    // วิธี: สแกนทุก row หา runs ของ ink แล้วสร้าง polyline
    const pathCmds = []
    const STEP = Math.max(1, Math.floor(Math.min(width, height) / 80))

    // ใช้ connected component tracing แบบ row-scan
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

      // สร้าง path จาก runs ของ row นี้
      for (const run of runs) {
        const midX = ((run.start + run.end) / 2 * scaleX).toFixed(1)
        const midY = (y * scaleY).toFixed(1)

        // หา matching run ใน prev row เพื่อ connect เป็น stroke
        const matched = prevRuns.find(pr =>
          pr.start <= run.end + STEP * 2 && pr.end >= run.start - STEP * 2
        )

        if (matched) {
          const prevMidX = ((matched.start + matched.end) / 2 * scaleX).toFixed(1)
          const prevMidY = ((y - STEP) * scaleY).toFixed(1)
          pathCmds.push(`M ${prevMidX} ${prevMidY} L ${midX} ${midY}`)
        } else {
          // run ใหม่ที่ไม่ต่อจาก row ก่อน → เริ่ม stroke ใหม่
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
    // ทำใน microtask เพื่อไม่บล็อก main thread
    setTimeout(() => {
      resolve(traceToSVGPath(inkCanvas, width, height))
    }, 0)
  })
}

// ─── Smart crop: หา bounding box ของ ink จริงใน cell ───
// รับ full cell imageData → return {x,y,w,h} ของ ink content
// มี padding รอบข้างเพื่อไม่ให้หางตัวอักษรโดนตัด
function findInkBoundingBox(data, width, height) {
  let minX = width, maxX = 0, minY = height, maxY = 0
  let found = false

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4
      const r = data[idx], g = data[idx+1], b = data[idx+2], a = data[idx+3]
      if (a < 30) continue
      const lum = r * 0.2126 + g * 0.7152 + b * 0.0722
      // นับ pixel ที่มืด (ลายมือ) หรือ red-dominant (ปากกาแดง)
      const isInk = lum < 200 || (r > 140 && r - b > 50 && r - g > 30)
      if (!isInk) continue
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
      found = true
    }
  }

  if (!found) return null

  // padding รอบ bounding box เพื่อให้หางและส่วนยื่นไม่โดนตัด
  const pad = Math.round(Math.min(width, height) * 0.08)
  return {
    x: Math.max(0, minX - pad),
    y: Math.max(0, minY - pad),
    w: Math.min(width, maxX - minX + 1 + pad * 2),
    h: Math.min(height, maxY - minY + 1 + pad * 2),
  }
}

function extractGlyphsFromCanvas({ ctx, pageWidth, pageHeight, chars, calibration, cellRects }) {
  const useRegDots = cellRects && cellRects.length >= chars.length

  let gap, cellSize, startX, startY
  if (!useRegDots) {
    const geom = getGridGeometry(pageWidth, pageHeight, chars.length, calibration)
    gap = geom.gap; cellSize = geom.cellSize; startX = geom.startX; startY = geom.startY
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

// ─── Async pipeline: trace SVG สำหรับทุก glyph ───
// เรียกหลัง extractGlyphsFromCanvas แล้ว inject svgPath กลับเข้าไป
async function traceAllGlyphs(rawGlyphs) {
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

function getBlueSignal(data, pageWidth, pageHeight, x, y) {
  if (x < 0 || y < 0 || x >= pageWidth || y >= pageHeight) return 0
  const idx = (Math.round(y) * pageWidth + Math.round(x)) * 4
  const a = data[idx + 3]
  if (a < 10) return 0
  const r = data[idx]
  const g = data[idx + 1]
  const b = data[idx + 2]
  // ❌ ข้าม red-dominant pixel (ลายมือปากกาแดง GoodNotes) — ไม่ให้รบกวน guide line signal
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

function GridDebugOverlay({ glyphs }) {
  const stStyle = {
    ok:       { border: "rgba(0,160,70,0.5)",  bg: "rgba(0,200,80,0.06)",  dot: "#00a046" },
    missing:  { border: "rgba(200,60,60,0.5)", bg: "rgba(255,80,80,0.06)", dot: "#c83c3c" },
    overflow: { border: "rgba(200,140,0,0.5)", bg: "rgba(255,180,0,0.06)", dot: "#c88c00" },
  }

  if (!glyphs?.length) return (
    <p style={{ fontSize: 11, color: C.inkLt, padding: "8px 0" }}>ยังไม่มีข้อมูล glyph</p>
  )

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(72px, 1fr))",
        gap: 6,
      }}
    >
      {glyphs.map(g => {
        const s = stStyle[g.status] || stStyle.ok
        return (
          <div
            key={g.id}
            style={{
              background: s.bg,
              border: `1.5px solid ${s.border}`,
              borderRadius: 8,
              padding: "6px 4px 5px",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 3,
            }}
          >
            {/* SVG trace */}
            <div
              style={{
                width: "100%",
                aspectRatio: "1",
                background: "#fff",
                borderRadius: 5,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {g.svgPath ? (
                <svg
                  viewBox={g.viewBox || "0 0 100 100"}
                  style={{ width: "88%", height: "88%", overflow: "visible" }}
                >
                  <path
                    d={g.svgPath}
                    fill="none"
                    stroke={C.ink}
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              ) : (
                <span style={{ fontSize: 9, color: C.inkLt }}>—</span>
              )}
            </div>

            {/* target char + index */}
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
              gridLines: { vLines: [], hLines: [] },
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
      // Hard cap: หน้านึงมีได้สูงสุด 6×6 = 36 ช่อง
      pageMaxCells = Math.min(pageMaxCells, GRID_COLS * 6)
      if (pageMaxCells <= 0) continue

      // Build cell rects from registration dots if available
      const pageCellFrom = page.pageMeta?.cellFrom > 0 ? page.pageMeta.cellFrom : startIndex + 1
      const hasGridLines = (page.regDots?.length ?? 0) >= 4
      // ⚠️ ใช้ let เพราะต้อง reassign หลัง apply calibration offset
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
  }, [pageVersion])

  // ─── SVG Tracing Effect ───
  // เมื่อ glyphs เปลี่ยน → trace SVG async แล้ว setTracedGlyphs
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
    return () => { canceled = true }
  }, [glyphs])

  // ใช้ tracedGlyphs ถ้าพร้อม ไม่งั้นใช้ glyphs ปกติ (เพื่อ UI ไม่กระตุก)
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

      {tracing && (
        <InfoBox color="sage">⏳ กำลัง trace SVG จากลายมือ… รอแป๊บนึงนะ</InfoBox>
      )}
      {!tracing && displayGlyphs.length > 0 && displayGlyphs.some(g => g.svgPath) && (
        <InfoBox color="sage">
          ✅ Trace SVG สำเร็จ {displayGlyphs.filter(g => g.svgPath).length}/{displayGlyphs.length} ตัว — Step 4 พร้อมดัด vector แล้ว
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
          <p style={{ fontSize: 11, color: C.inkLt, marginBottom: 10 }}>
            ภาพที่ crop จากแต่ละช่อง — ขอบสีแสดงสถานะ: <span style={{ color: "#00a046" }}>●</span> OK &nbsp; <span style={{ color: "#c83c3c" }}>●</span> Missing &nbsp; <span style={{ color: "#c88c00" }}>●</span> Overflow
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