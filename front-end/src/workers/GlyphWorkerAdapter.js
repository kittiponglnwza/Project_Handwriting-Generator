export class GlyphWorkerAdapter {
  constructor(workerCount = 2) {
    this.workers = []
    this.taskQueue = []
    this.activeJobs = new Map()

    // แก้ Bug #3 — ใช้ import.meta.url แบบ Vite (ไม่ใช่ './svgWorker.js' แบบเก่า)
    for (let i = 0; i < workerCount; i++) {
      const worker = new Worker(
        new URL('./tracingWorker.js', import.meta.url),
        { type: 'module' }
      )
      worker.onmessage = this.handleWorkerMessage.bind(this)
      this.workers.push({ worker, busy: false, id: i })
    }
  }

  async processGlyphs(glyphs) {
    const promises = glyphs.map(glyph =>
      this.scheduleTask('TRACE_GLYPH', {
        imageData: glyph._imageData || this.getImageDataFromCanvas(glyph._inkCanvas),
        width: glyph._inkW,
        height: glyph._inkH,
        glyphId: glyph.id
      })
    )

    return Promise.all(promises)
  }

  getImageDataFromCanvas(canvas) {
    if (!canvas) return null
    const ctx = canvas.getContext('2d')
    return ctx.getImageData(0, 0, canvas.width, canvas.height)
  }

  scheduleTask(type, payload) {
    return new Promise((resolve, reject) => {
      const taskId = `${type}_${Date.now()}_${Math.random()}`

      this.taskQueue.push({ taskId, type, payload, resolve, reject, timestamp: Date.now() })
      this.activeJobs.set(taskId, { resolve, reject })
      this.processQueue()
    })
  }

  processQueue() {
    if (this.taskQueue.length === 0) return

    const availableWorker = this.workers.find(w => !w.busy)
    if (!availableWorker) return

    const task = this.taskQueue.shift()
    availableWorker.busy = true

    availableWorker.worker.postMessage({
      type: task.type,
      payload: task.payload,
      taskId: task.taskId
    })
  }

  handleWorkerMessage(e) {
    const { type, payload, taskId } = e.data
    const worker = this.workers.find(w => w.worker === e.target)
    const job = this.activeJobs.get(taskId)

    if (!job) return

    if (type === 'TRACE_COMPLETE') {
      worker.busy = false
      job.resolve(payload)
      this.activeJobs.delete(taskId)
      this.processQueue()
    } else if (type === 'TRACE_ERROR') {
      worker.busy = false
      job.reject(new Error(payload.error))
      this.activeJobs.delete(taskId)
      this.processQueue()
    }
  }

  cleanup() {
    this.workers.forEach(w => w.worker.terminate())
    this.workers = []
    this.taskQueue = []
    this.activeJobs.clear()
  }
}
