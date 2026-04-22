/**
 * WEB WORKER FOR SVG TRACING
 *
 * Converts ink pixel mask → filled outline SVG path suitable for TTF embedding.
 *
 * CRITICAL: ทุก sub-path ต้องเป็น CLOSED shape (Z-terminated)
 *   open polyline "M x y L x y" ไม่มี Z → TTF fill ทั้ง bounding box → solid black glyph
 */

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v }

function traceToSVGPath(imageData, width, height) {
  try {
    const { data } = imageData
    const THRESHOLD = 180
    const mask = new Uint8Array(width * height)

    // 1. Build ink mask + tight bounding box
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

    // 2. Scale ink-cropped coords → 0-100 SVG space
    const sx   = 100 / glyphW
    const sy   = 100 / glyphH
    const STEP = Math.max(1, Math.floor(Math.min(glyphW, glyphH) / 80))

    // 3. Extract runs per sampled row
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

    // 4. Build CLOSED sub-paths — Z is mandatory for correct TTF fill
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
      const prevRow = ri > 0 ? rowRuns[ri - 1] : null
      const curr    = rowRuns[ri]
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
    return { path: parts.join(' '), viewBox: '0 0 100 100' }
  } catch (_) {
    return null
  }
}

// ── Message handler ────────────────────────────────────────────────────────────
self.onmessage = function(e) {
  const { type, payload, taskId } = e.data

  switch (type) {
    case 'TRACE_GLYPH': {
      try {
        const { imageData, width, height, glyphId } = payload
        const result = traceToSVGPath(imageData, width, height)
        // CRITICAL: echo taskId back so TracingWorkerManager.pendingTasks lookup works
        self.postMessage({
          type: 'TRACE_COMPLETE',
          taskId,
          payload: { glyphId, result: result || { path: null, viewBox: '0 0 100 100' } },
        })
      } catch (error) {
        self.postMessage({
          type: 'TRACE_ERROR',
          taskId,
          payload: { glyphId: payload?.glyphId, error: error.message },
        })
      }
      break
    }

    case 'TRACE_BATCH': {
      try {
        const { glyphs } = payload
        const results = glyphs.map(glyph => {
          const result = traceToSVGPath(glyph.imageData, glyph.width, glyph.height)
          return { glyphId: glyph.id, result: result || { path: null, viewBox: '0 0 100 100' } }
        })
        self.postMessage({ type: 'BATCH_COMPLETE', taskId, payload: { results } })
      } catch (error) {
        self.postMessage({ type: 'BATCH_ERROR', taskId, payload: { error: error.message } })
      }
      break
    }

    default:
      console.warn('[tracingWorker] unknown message type:', type)
  }
}

// WORKER_READY fires after onmessage is assigned — host receives it correctly
self.postMessage({ type: 'WORKER_READY' })
