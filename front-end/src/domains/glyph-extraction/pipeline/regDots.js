import { GRID_COLS } from "../constants.js"

// ─── Registration dot detection ──────────────────────────────────────────────
// Template CSS: .reg-tl/tr/bl/br { width:4px; height:4px; background:#3A7BD5; border-radius:50% }
// At PDF scale=3: dot renders ~12px diameter
// Color #3A7BD5 = RGB(58, 123, 213) → b dominant, mid luminance ~116
// Guide lines are #A8C1DD = RGB(168, 193, 221) → lighter, lower b-r spread

export function detectRegDots(imageData, pageWidth, pageHeight) {
  const data = imageData
  const dots = []
  const visited = new Uint8Array(pageWidth * pageHeight)

  for (let y = 0; y < pageHeight; y++) {
    for (let x = 0; x < pageWidth; x++) {
      if (visited[y * pageWidth + x]) continue
      const idx = (y * pageWidth + x) * 4
      const r = data[idx],
        g = data[idx + 1],
        b = data[idx + 2],
        a = data[idx + 3]
      if (a < 80) continue
      // Loosened threshold: accept any pixel where blue clearly dominates
      // Original: b < 150 || b - r < 80 || b - g < 40 (too strict for print/scan)
      // New:      b < 100 || b - r < 40 || b - g < 20 (handles color shift after scanning)
      if (b < 100 || b - r < 40 || b - g < 20) continue
      if (r > 180 && r - b > 30) continue  // reject warm/red pixels

      let minX = x,
        maxX = x,
        minY = y,
        maxY = y
      const stack = [y * pageWidth + x]
      while (stack.length > 0) {
        const pos = stack.pop()
        if (visited[pos]) continue
        const px = pos % pageWidth
        const py = Math.floor(pos / pageWidth)
        if (px < 0 || px >= pageWidth || py < 0 || py >= pageHeight) continue
        const i2 = pos * 4
        const r2 = data[i2],
          g2 = data[i2 + 1],
          b2 = data[i2 + 2],
          a2 = data[i2 + 3]
        if (a2 < 60) continue
        // Looser flood-fill threshold too
        if (b2 < 80 || b2 - r2 < 20 || b2 - g2 < 10) continue
        if (r2 > 180 && r2 - b2 > 20) continue
        visited[pos] = 1
        if (px < minX) minX = px
        if (px > maxX) maxX = px
        if (py < minY) minY = py
        if (py > maxY) maxY = py
        if (px + 1 < pageWidth) stack.push(pos + 1)
        if (px - 1 >= 0) stack.push(pos - 1)
        if (py + 1 < pageHeight) stack.push(pos + pageWidth)
        if (py - 1 >= 0) stack.push(pos - pageWidth)
      }

      const w = maxX - minX + 1
      const h = maxY - minY + 1
      // Allow slightly smaller dots (scale=3 → ~9-12px; after scan may compress)
      if (w < 4 || h < 4 || w > 40 || h > 40) continue
      if (Math.max(w, h) / Math.min(w, h) > 2.5) continue

      dots.push({ x: (minX + maxX) / 2, y: (minY + maxY) / 2, w, h })
    }
  }

  return dots
}

// detectCellGridLines — not used (template has explicit reg dots)
export function detectCellGridLines() {
  return { vLines: [], hLines: [] }
}

export function buildCellRectsFromDots(dots, pageWidth, pageHeight) {
  if (dots.length < 4) return null

  function clusterCoords(vals, pageSize) {
    const sorted = [...vals].sort((a, b) => a - b)
    // CRITICAL FIX: 0.04 * pageWidth(~2480px) = 99px which swallows real column gaps (~17px).
    // Use 0.015 → ~37px: big enough to merge jitter within a column, small enough to split columns.
    const minGap = Math.max(8, pageSize * 0.015)
    const clusters = []
    let group = [sorted[0]]
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i] - sorted[i - 1] < minGap) {
        group.push(sorted[i])
      } else {
        clusters.push(group.reduce((s, v) => s + v, 0) / group.length)
        group = [sorted[i]]
      }
    }
    clusters.push(group.reduce((s, v) => s + v, 0) / group.length)
    return clusters
  }

  const xs = clusterCoords(dots.map(d => d.x), pageWidth)
  const ys = clusterCoords(dots.map(d => d.y), pageHeight)

  if (xs.length < 2 || ys.length < 2) return null

  const minCellW = pageWidth * 0.05
  const minCellH = pageHeight * 0.04
  const maxCellW = pageWidth * 0.35
  const maxCellH = pageHeight * 0.3

  const cellRects = []
  for (let row = 0; row + 1 < ys.length; row++) {
    for (let col = 0; col + 1 < xs.length; col++) {
      const x1 = xs[col],
        y1 = ys[row]
      const x2 = xs[col + 1],
        y2 = ys[row + 1]
      const w = x2 - x1,
        h = y2 - y1
      if (w < minCellW || h < minCellH || w > maxCellW || h > maxCellH) continue
      cellRects.push({ x: x1, y: y1, w, h, row, col })
    }
  }

  return cellRects.length > 0 ? cellRects : null
}

export function buildCellRectsFromLines() {
  return null
}

export function sortCellRectsReadingOrder(rects) {
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

export function filterCellRectsNearAnchorHull(cellRects, anchorByIndex, cellFrom, cellCount) {
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

export function orderCellRectsByAnchorIndex(cellRects, anchorByIndex, cellFrom, cellCount) {
  if (!Array.isArray(cellRects) || cellRects.length === 0) return null
  if (!cellCount || cellCount < 1) return null

  const indices = Array.from({ length: cellCount }, (_, i) => cellFrom + i)
  const assigned = new Map()
  const usedRi = new Set()

  if (!anchorByIndex || anchorByIndex.size === 0) {
    const sorted = sortCellRectsReadingOrder(cellRects)
    return sorted.length >= cellCount ? sorted.slice(0, cellCount) : null
  }

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

export function buildOrderedCellRectsForPage(page, pageCellFrom, pageMaxCells) {
  if (!page?.regDots?.length || pageMaxCells <= 0) return null
  const cellRectsRaw = buildCellRectsFromDots(
    page.regDots,
    page.pageWidth,
    page.pageHeight,
    GRID_COLS,
    pageMaxCells
  )
  if (!cellRectsRaw?.length) {
    console.warn(
      `[buildOrderedCellRectsForPage] หน้า ${page.pageNumber}: dots=${page.regDots.length} แต่สร้าง cell rects ไม่ได้`
    )
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
