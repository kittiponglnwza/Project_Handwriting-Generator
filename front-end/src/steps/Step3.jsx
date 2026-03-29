import { useEffect, useMemo, useRef, useState } from "react"
import { GlobalWorkerOptions, getDocument } from "pdfjs-dist"
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url"
import Btn from "../components/Btn"
import InfoBox from "../components/InfoBox"
import C from "../styles/colors"

GlobalWorkerOptions.workerSrc = pdfWorker

const GRID_COLS = 6
const TEMPLATE_CODE_RE = /^HG(\d{1,4})$/i
const TEMPLATE_INDEX_RE = /^(\d{1,3})$/
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

  const sorted = [...source].sort((a, b) => a - b)
  let contiguousCount = 0
  while (source.has(contiguousCount + 1)) {
    contiguousCount += 1
  }

  const rawCount = contiguousCount > 0 ? contiguousCount : sorted[sorted.length - 1]
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
  const rawAnchors = []

  for (const item of textContent.items || []) {
    const raw = String(item?.str || "").trim()
    if (!raw) continue

    const codeMatch = raw.match(TEMPLATE_CODE_RE)
    const indexMatch = raw.match(TEMPLATE_INDEX_RE)
    let kind = null
    let index = 0

    if (codeMatch) {
      kind = "code"
      index = Number(codeMatch[1])
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
  const allIndices = anchors.map(a => a.index)
  const startIndex = allIndices.length > 0 ? Math.min(...allIndices) : null
  let contiguousCount = 0
  if (startIndex != null) {
    while (byIndex.has(startIndex + contiguousCount)) {
      contiguousCount += 1
    }
  }

  return {
    anchors,
    byIndex,
    startIndex,
    contiguousCount,
    hasCodeAnchors: anchors.some(a => a.kind === "code"),
  }
}

function extractGlyphsFromCanvas({ ctx, pageWidth, pageHeight, chars, calibration }) {
  const { gap, cellSize, startX, startY } = getGridGeometry(
    pageWidth,
    pageHeight,
    chars.length,
    calibration
  )

  return chars.map((ch, i) => {
    const row = Math.floor(i / GRID_COLS)
    const col = i % GRID_COLS

    const x = Math.round(startX + col * (cellSize + gap))
    const y = Math.round(startY + row * (cellSize + gap))
    const inset = Math.round(cellSize * GRID_CONFIG.insetRatio)
    const size = Math.max(20, Math.round(cellSize - inset * 2))

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

  const firstAnchor = page.anchors[0]
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
    const picked =
      anchorAuto && anchorAuto.score >= gridAuto.score - 10 ? anchorAuto : gridAuto

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

export default function Step3({ selected, pdfFile, templateChars = [], onGlyphsUpdate = () => {} }) {
  const fallbackChars = useMemo(
    () => (templateChars.length > 0 ? templateChars : [...selected]),
    [selected, templateChars]
  )
  const [pdfTargets, setPdfTargets] = useState([])
  const chars = useMemo(
    () => (pdfTargets.length > 0 ? pdfTargets : fallbackChars),
    [pdfTargets, fallbackChars]
  )

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
      setPdfTargets([])
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
      setPdfTargets([])

      ;(async () => {
        let loadingTask = null
        let pdf = null

        try {
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
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height).data
            pages.push({
              ctx,
              pageWidth: canvas.width,
              pageHeight: canvas.height,
              imageData,
              pageNumber,
              anchors: anchorInfo.anchors,
              anchorByIndex: anchorInfo.byIndex,
              anchorStartIndex: anchorInfo.startIndex,
              contiguousCount: anchorInfo.contiguousCount,
              hasCodeAnchors: anchorInfo.hasCodeAnchors,
            })
          }

          if (canceled) return

          const derivedTargets = buildTargetsFromPages(pages)
          const effectiveChars = derivedTargets.length > 0 ? derivedTargets : fallbackChars
          const profiledPages = buildAutoPageProfiles(pages, effectiveChars)
          pageRef.current = {
            pages: profiledPages,
            totalPages: profiledPages.length,
          }
          setPdfTargets(derivedTargets)

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
              ? `Auto aligned ${profiledPages.length} pages (PDF targets ${effectiveChars.length}, anchored ${anchorPages}, code ${codeAnchorPages}, avg score ${avgScore.toFixed(1)})`
              : `Auto aligned ${profiledPages.length} pages (PDF targets ${effectiveChars.length}, anchored ${anchorPages}, code ${codeAnchorPages})`
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

      const baseCalibration = page.autoCalibration || DEFAULT_CALIBRATION
      const pageCalibration = {
        offsetX: baseCalibration.offsetX + calibration.offsetX,
        offsetY: baseCalibration.offsetY + calibration.offsetY,
        cellAdjust: baseCalibration.cellAdjust + calibration.cellAdjust,
        gapAdjust: baseCalibration.gapAdjust + calibration.gapAdjust,
      }

      const anchoredStart =
        Number.isFinite(page.anchorStartIndex) && page.anchorStartIndex != null
          ? Math.max(0, page.anchorStartIndex - 1)
          : null
      const startIndex = anchoredStart == null ? cursor : Math.max(cursor, anchoredStart)

      const geometry = getGridGeometry(
        page.pageWidth,
        page.pageHeight,
        Math.min(chars.length - startIndex, 24),
        pageCalibration
      )
      let pageMaxCells = getPageCapacity(
        page.pageHeight,
        geometry.startY,
        geometry.cellSize,
        geometry.gap
      )
      if (page.anchorCapacity > 0) {
        pageMaxCells = Math.min(pageMaxCells, page.anchorCapacity)
      }
      if (pageMaxCells <= 0) continue

      const pageChars = chars.slice(startIndex, startIndex + pageMaxCells)
      if (pageChars.length === 0) break

      const pageGlyphs = extractGlyphsFromCanvas({
        ctx: page.ctx,
        pageWidth: page.pageWidth,
        pageHeight: page.pageHeight,
        chars: pageChars,
        calibration: pageCalibration,
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

      <InfoBox color="amber">
        ถ้าลำดับ 0-9 ไม่ตรง ให้ปรับ Grid Alignment ด้านล่างก่อน จากนั้นคลิกภาพเพื่อดูแบบขยาย
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
          </div>
        </div>
      </div>

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
                ช่องที่ {activeGlyph.index} • เป้าหมาย: <b style={{ color: C.ink }}>{activeGlyph.ch}</b>
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
                ช่องที่ {zoomGlyph.index} • {zoomGlyph.ch}
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
