/**
 * WEB WORKER MANAGER FOR SVG TRACING
 *
 * FIXES:
 *   - Worker path ใช้ import.meta.url (Vite-compatible)
 *   - handleWorkerMessage ใช้ taskId จาก response (ไม่ใช่ glyphId) → pendingTasks lookup ถูกต้อง
 *   - WORKER_READY listener ตั้งก่อน onmessage เพื่อป้องกัน race condition
 */

class TracingWorkerManager {
  constructor() {
    this.workerPool     = []
    this.busyWorkers    = new Set()
    this.pendingTasks   = new Map()
    this.taskId         = 0
    this.isInitialized  = false
  }

  async initialize() {
    if (this.isInitialized) return

    try {
      const workerCount = Math.min(2, navigator.hardwareConcurrency || 2)
      const readyPromises = []

      for (let i = 0; i < workerCount; i++) {
        const worker = new Worker(
          new URL('../../workers/tracingWorker.js', import.meta.url),
          { type: 'module' }
        )

        // Set up WORKER_READY listener BEFORE onmessage to avoid race
        const readyP = new Promise(resolve => {
          const handler = (e) => {
            if (e.data.type === 'WORKER_READY') {
              worker.removeEventListener('message', handler)
              resolve()
            }
          }
          worker.addEventListener('message', handler)
        })
        readyPromises.push(readyP)

        // Main message handler (registered after ready listener to avoid conflict)
        worker.onmessage = (e) => this.handleWorkerMessage(worker, e.data)

        worker.onerror = (error) => {
          console.error('[TracingWorkerManager] worker error:', error)
          this.busyWorkers.delete(worker)
          this.processQueue()
        }

        this.workerPool.push(worker)
      }

      await Promise.all(readyPromises)
      this.isInitialized = true
      console.log(`✅ TracingWorkerManager: ${workerCount} workers ready`)
    } catch (error) {
      console.warn('[TracingWorkerManager] init failed, will fallback to main thread:', error)
      this.isInitialized = false
    }
  }

  handleWorkerMessage(worker, message) {
    // taskId is echoed at top level by tracingWorker.js
    const { type, taskId, payload } = message

    switch (type) {
      case 'TRACE_COMPLETE':
      case 'BATCH_COMPLETE': {
        const task = this.pendingTasks.get(taskId)
        if (task) {
          task.resolve(payload)
          this.pendingTasks.delete(taskId)
        }
        this.busyWorkers.delete(worker)
        this.processQueue()
        break
      }
      case 'TRACE_ERROR':
      case 'BATCH_ERROR': {
        const task = this.pendingTasks.get(taskId)
        if (task) {
          task.reject(new Error(payload?.error || 'unknown worker error'))
          this.pendingTasks.delete(taskId)
        }
        this.busyWorkers.delete(worker)
        this.processQueue()
        break
      }
    }
  }

  getAvailableWorker() {
    return this.workerPool.find(w => !this.busyWorkers.has(w))
  }

  // Placeholder for future priority queue
  processQueue() {}

  /** Trace a single glyph — falls back to main thread if workers not ready */
  async traceGlyph(imageData, width, height, glyphId) {
    if (!this.isInitialized) {
      return this._traceMainThread(imageData, width, height, glyphId)
    }

    let worker = this.getAvailableWorker()
    if (!worker) {
      // Wait for a worker to free up
      await new Promise(resolve => {
        const poll = setInterval(() => {
          if (this.getAvailableWorker()) { clearInterval(poll); resolve() }
        }, 10)
      })
      worker = this.getAvailableWorker()
    }

    this.busyWorkers.add(worker)
    const taskId = `glyph_${this.taskId++}`

    return new Promise((resolve, reject) => {
      this.pendingTasks.set(taskId, { resolve, reject })
      worker.postMessage({ type: 'TRACE_GLYPH', taskId, payload: { imageData, width, height, glyphId } })
    })
  }

  /** Trace a batch of glyphs */
  async traceGlyphBatch(glyphs) {
    if (!this.isInitialized) {
      return this._traceBatchMainThread(glyphs)
    }

    const batchSize = Math.ceil(glyphs.length / Math.max(1, this.workerPool.length))
    const batches   = []
    for (let i = 0; i < glyphs.length; i += batchSize) {
      batches.push(glyphs.slice(i, i + batchSize))
    }

    const batchResults = await Promise.all(
      batches.map(async batch => {
        let worker = this.getAvailableWorker()
        if (!worker) {
          await new Promise(resolve => {
            const poll = setInterval(() => {
              if (this.getAvailableWorker()) { clearInterval(poll); resolve() }
            }, 10)
          })
          worker = this.getAvailableWorker()
        }

        this.busyWorkers.add(worker)
        const taskId = `batch_${this.taskId++}`

        return new Promise((resolve, reject) => {
          this.pendingTasks.set(taskId, { resolve, reject })
          worker.postMessage({
            type: 'TRACE_BATCH',
            taskId,
            payload: {
              glyphs: batch.map(g => ({
                id:        g.id,
                imageData: g._imageData || (g._inkCanvas
                  ? g._inkCanvas.getContext('2d').getImageData(0, 0, g._inkW, g._inkH)
                  : null),
                width:  g._inkW,
                height: g._inkH,
              })),
            },
          })
        })
      })
    )

    return batchResults.flatMap(b => b.results)
  }

  // ── Main-thread fallbacks ─────────────────────────────────────────────────
  async _traceMainThread(imageData, width, height, glyphId) {
    // Import SvgTracer dynamically to avoid circular deps
    const { traceToSVGPath } = await import('../core/rendering/SvgTracer.js').catch(() => ({}))
    if (!traceToSVGPath) return { glyphId, result: { path: null, viewBox: '0 0 100 100' } }

    // Create temp canvas from imageData
    const canvas = new OffscreenCanvas(width, height)
    const ctx    = canvas.getContext('2d')
    ctx.putImageData(new ImageData(new Uint8ClampedArray(imageData.data), width, height), 0, 0)
    const result = traceToSVGPath(canvas, width, height)
    return { glyphId, result: result || { path: null, viewBox: '0 0 100 100' } }
  }

  async _traceBatchMainThread(glyphs) {
    return Promise.all(glyphs.map(g => this._traceMainThread(
      g._imageData || (g._inkCanvas
        ? g._inkCanvas.getContext('2d').getImageData(0, 0, g._inkW, g._inkH)
        : { data: new Uint8ClampedArray(g._inkW * g._inkH * 4) }),
      g._inkW, g._inkH, g.id
    )))
  }

  terminate() {
    this.workerPool.forEach(w => w.terminate())
    this.workerPool   = []
    this.busyWorkers.clear()
    this.pendingTasks.clear()
    this.isInitialized = false
  }
}

// Singleton
const tracingWorkerManager = new TracingWorkerManager()
export default tracingWorkerManager
