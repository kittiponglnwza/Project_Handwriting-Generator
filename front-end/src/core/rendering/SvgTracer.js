/**
 * SvgTracer.js — Main-thread SVG tracing (ใช้เมื่อ worker ไม่พร้อม)
 *
 * ROOT CAUSE ของ solid black glyph:
 *   open polyline "M x y L x y" ไม่มี Z → TTF fill ทั้ง bounding box → solid black
 *
 * FIX: ทุก sub-path ต้องเป็น CLOSED shape (Z-terminated) เหมือน tracingWorker.js
 *   - สองแถวที่ต่อเนื่องกัน → trapezoid (4 corners + Z)
 *   - แถวเดี่ยว → rectangle (4 corners + Z)
 */

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v }

/**
 * Trace ink canvas → closed SVG path suitable for TTF embedding
 * @param {HTMLCanvasElement} inkCanvas
 * @param {number} width
 * @param {number} height
 * @param {object} options  — { ch } optional char hint
 * @returns {{ path: string, viewBox: string, glyphMetrics: object } | null}
 */
export function traceToSVGPath(inkCanvas, width, height, options = {}) {
  try {
    const ctx = inkCanvas.getContext('2d')
    if (!ctx) return null

    const imageData = ctx.getImageData(0, 0, width, height)
    const { data }  = imageData
    const THRESHOLD = 180

    // ── 1. Build ink mask + tight bounding box ────────────────────────
    const mask = new Uint8Array(width * height)
    let inkCount = 0
    let minX = width, minY = height, maxX = 0, maxY = 0

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4
        if (data[i + 3] < 50) continue
        const lum = data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722
        if (lum < THRESHOLD) {
          mask[y * width + x] = 1
          inkCount++
          if (x < minX) minX = x
          if (x > maxX) maxX = x
          if (y < minY) minY = y
          if (y > maxY) maxY = y
        }
      }
    }

    if (inkCount < 10) return null

    const glyphW = maxX - minX + 1
    const glyphH = maxY - minY + 1

    // ── 2. Scale to 0-100 SVG space (crop to ink bounds) ─────────────
    const sx = 100 / glyphW
    const sy = 100 / glyphH
    const STEP = Math.max(1, Math.floor(Math.min(glyphW, glyphH) / 80))

    // ── 3. Extract runs per row (in ink-cropped coordinates) ──────────
    const rowRuns = []
    for (let y = minY; y <= maxY; y += STEP) {
      const runs = []
      let inRun = false, runStart = 0
      for (let x = minX; x <= maxX; x++) {
        const ink = mask[y * width + x] === 1
        if (ink && !inRun)  { inRun = true;  runStart = x }
        if (!ink && inRun)  { inRun = false; runs.push({ start: runStart - minX, end: x - 1 - minX }) }
      }
      if (inRun) runs.push({ start: runStart - minX, end: maxX - minX })

      for (const r of runs) {
        r.midX  = (r.start + r.end) / 2 * sx
        r.midY  = (y - minY) * sy
        r.halfW = clamp((r.end - r.start + 1) / 2 * sx, 0.8, 15)
      }
      rowRuns.push({ y: (y - minY) * sy, runs })
    }

    // ── 4. Build CLOSED sub-paths (trapezoids / rects) ────────────────
    //    Z-termination is mandatory — open paths fill the entire bbox in TTF
    const parts = []
    const halfStep = STEP * sy * 0.5

    function emitRect(r, rowY) {
      const x0 = (r.midX - r.halfW).toFixed(2)
      const x1 = (r.midX + r.halfW).toFixed(2)
      const yt  = Math.max(0,   rowY - halfStep).toFixed(2)
      const yb  = Math.min(100, rowY + halfStep).toFixed(2)
      parts.push(`M ${x0} ${yt} L ${x1} ${yt} L ${x1} ${yb} L ${x0} ${yb} Z`)
    }

    function emitTrap(top, topY, bot, botY) {
      const tx0 = (top.midX - top.halfW).toFixed(2)
      const tx1 = (top.midX + top.halfW).toFixed(2)
      const bx0 = (bot.midX - bot.halfW).toFixed(2)
      const bx1 = (bot.midX + bot.halfW).toFixed(2)
      parts.push(
        `M ${tx0} ${topY.toFixed(2)} L ${tx1} ${topY.toFixed(2)} ` +
        `L ${bx1} ${botY.toFixed(2)} L ${bx0} ${botY.toFixed(2)} Z`
      )
    }

    for (let ri = 0; ri < rowRuns.length; ri++) {
      const prevRow  = ri > 0 ? rowRuns[ri - 1] : null
      const curr     = rowRuns[ri]
      for (const run of curr.runs) {
        if (prevRow) {
          const matched = prevRow.runs.find(
            pr => pr.start <= run.end + STEP * 2 && pr.end >= run.start - STEP * 2
          )
          if (matched) { emitTrap(matched, prevRow.y, run, curr.y); continue }
        }
        emitRect(run, curr.y)
      }
    }

    if (parts.length === 0) return null

    return {
      path: parts.join(' '),
      viewBox: '0 0 100 100',
      glyphMetrics: { width: glyphW, height: glyphH }
    }
  } catch (err) {
    console.error('[SvgTracer] error:', err)
    return null
  }
}

// ─── Median consonant height (ใช้สำหรับ normalization ใน 2-pass) ─────────────
const BASE_CONSONANTS = new Set([
  0x0e01,0x0e02,0x0e03,0x0e04,0x0e05,0x0e06,0x0e07,0x0e08,0x0e09,0x0e0a,
  0x0e0b,0x0e0c,0x0e0d,0x0e0e,0x0e0f,0x0e10,0x0e11,0x0e12,0x0e13,0x0e14,
  0x0e15,0x0e16,0x0e17,0x0e18,0x0e19,0x0e1a,0x0e1b,0x0e1c,0x0e1d,0x0e1e,
  0x0e1f,0x0e20,0x0e21,0x0e22,0x0e23,0x0e24,0x0e25,0x0e26,0x0e27,0x0e28,
  0x0e29,0x0e2a,0x0e2b,0x0e2c,0x0e2d,0x0e2e,
])

let medianConsonantHeight = null

export function updateMedianConsonantHeight(glyphs) {
  const heights = []
  for (const g of glyphs) {
    if (!g.ch) continue
    const cp = g.ch.codePointAt(0)
    if (!BASE_CONSONANTS.has(cp)) continue
    if (g.glyphMetrics?.height > 0) heights.push(g.glyphMetrics.height)
  }
  if (heights.length === 0) return
  heights.sort((a, b) => a - b)
  const mid = Math.floor(heights.length / 2)
  medianConsonantHeight = heights.length % 2 === 0
    ? (heights[mid - 1] + heights[mid]) / 2
    : heights[mid]
}

export function getMedianConsonantHeight() { return medianConsonantHeight }

// ─── traceAllGlyphs — 2-pass pipeline ────────────────────────────────────────
export async function traceAllGlyphs(rawGlyphs) {
  const BATCH_SIZE = 8

  function traceOne(g) {
    if (!g._inkCanvas || g.status === 'missing') return null
    return traceToSVGPath(g._inkCanvas, g._inkW, g._inkH, { ch: g.ch })
  }

  function toResult(g, traced) {
    const { _inkCanvas, _inkW, _inkH, ...rest } = g
    return {
      ...rest,
      svgPath:      traced?.path   || null,
      viewBox:      traced?.viewBox || '0 0 100 100',
      glyphMetrics: traced?.glyphMetrics,
    }
  }

  // ── Pass 1: trace all, collect metrics ───────────────────────────────
  const pass1 = []
  for (let i = 0; i < rawGlyphs.length; i += BATCH_SIZE) {
    const batch = rawGlyphs.slice(i, i + BATCH_SIZE)
    const batchResults = await Promise.all(
      batch.map(g => new Promise(resolve => {
        const run = () => {
          try { resolve(toResult(g, traceOne(g))) }
          catch (e) { console.error('[traceAllGlyphs] pass1 error:', e); resolve(toResult(g, null)) }
        }
        window.requestIdleCallback ? window.requestIdleCallback(run) : setTimeout(run, 0)
      }))
    )
    pass1.push(...batchResults)
    if (i + BATCH_SIZE < rawGlyphs.length) await new Promise(r => setTimeout(r, 10))
  }

  // ── Compute median from pass1 ─────────────────────────────────────────
  updateMedianConsonantHeight(pass1)

  // ── Pass 2: re-trace only if median changed the normalization ─────────
  // (ปัจจุบัน traceToSVGPath crop to ink bounds ตายตัวแล้ว ไม่ต้อง re-trace)
  // เก็บ hook ไว้สำหรับอนาคตถ้าต้องการ scale normalization ข้าม glyphs

  return pass1
}
