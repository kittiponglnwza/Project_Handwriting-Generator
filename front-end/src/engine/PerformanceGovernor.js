export class PerformanceGovernor {
  static config = {
    maxBatchSize: 50,
    frameBudget: 16.67, // 60fps
    workerQueueLimit: 100,
    canvasPoolLimit: 20,
    memoryThreshold: 100 * 1024 * 1024 // 100MB
  }

  static batchProcessor = {
    queue: [],
    processing: false,
    // รายการ pending callers ที่รอ current run เสร็จ
    _waiters: [],
    // abort controller สำหรับ cancel run ปัจจุบัน
    _abortController: null,

    /**
     * เพิ่ม items เข้า batch แล้ว run processor
     * ถ้ากำลัง processing อยู่ จะ abort run เดิมแล้ว restart ด้วย queue ใหม่
     * ทำให้ caller ทุกคนได้ผลลัพธ์ครบ ไม่มีหายกลางทาง
     */
    async add(items, processor) {
      this.queue.push(...items)

      if (this.processing) {
        // Cancel run เดิม แล้วรอ run ใหม่ที่จะ kick off หลัง abort
        this._abortController?.abort()
        return new Promise((resolve, reject) => {
          this._waiters.push({ resolve, reject })
        })
      }

      return this._run(processor)
    },

    async _run(processor) {
      this.processing = true
      this._abortController = new AbortController()
      const { signal } = this._abortController

      let allResults = []

      try {
        while (this.queue.length > 0) {
          if (signal.aborted) break

          const batch      = this.queue.splice(0, PerformanceGovernor.config.maxBatchSize)
          const frameStart = performance.now()
          const batchResults = await processor(batch)
          const frameTime  = performance.now() - frameStart

          if (Array.isArray(batchResults)) allResults.push(...batchResults)

          if (frameTime > PerformanceGovernor.config.frameBudget) {
            await new Promise(r => setTimeout(r, 0)) // yield to browser
          }
        }
      } finally {
        this.processing = false
        this._abortController = null
      }

      // ถ้ายังมี queue เหลือ (จาก abort) ให้ re-run จนหมด
      if (this.queue.length > 0) {
        const extraResults = await this._run(processor)
        allResults = [...allResults, ...extraResults]
      }

      // Resolve waiters ที่รออยู่
      const waiters = this._waiters.splice(0)
      waiters.forEach(w => w.resolve(allResults))

      return allResults
    },

    /** ล้าง queue และ abort run ปัจจุบันทันที */
    cancel() {
      this.queue = []
      this._abortController?.abort()
      const waiters = this._waiters.splice(0)
      waiters.forEach(w => w.resolve([]))
    }
  }

  static workerManager = {
    workers: [],
    queue: [],

    async schedule(task) {
      if (this.queue.length >= PerformanceGovernor.config.workerQueueLimit) {
        throw new Error('Worker queue exceeded limit')
      }

      this.queue.push(task)
      return this.processQueue()
    },

    async processQueue() {
      if (this.queue.length === 0) return

      const availableWorker = this.workers.find(w => !w.busy)
      if (!availableWorker) return

      const task = this.queue.shift()
      availableWorker.busy = true

      try {
        const result = await this.executeTask(availableWorker, task)
        task.resolve(result)
      } catch (error) {
        task.reject(error)
      } finally {
        availableWorker.busy = false
        this.processQueue()
      }
    },

    executeTask(workerEntry, task) {
      return new Promise((resolve, reject) => {
        const taskId = `wm_${Date.now()}_${Math.random().toString(36).slice(2)}`

        const handler = (e) => {
          if (e.data?.taskId !== taskId) return
          workerEntry.instance.removeEventListener('message', handler)
          workerEntry.instance.removeEventListener('error', errHandler)
          if (e.data.error) {
            reject(new Error(e.data.error))
          } else {
            resolve(e.data.result)
          }
        }

        const errHandler = (err) => {
          workerEntry.instance.removeEventListener('message', handler)
          workerEntry.instance.removeEventListener('error', errHandler)
          reject(err)
        }

        workerEntry.instance.addEventListener('message', handler)
        workerEntry.instance.addEventListener('error', errHandler)
        workerEntry.instance.postMessage({ taskId, ...task.data })
      })
    }
  }

  static memoryMonitor = {
    checkMemory() {
      const usage = performance.memory?.usedJSHeapSize || 0

      if (usage > PerformanceGovernor.config.memoryThreshold) {
        console.warn('Memory threshold exceeded, triggering cleanup')
        this.triggerCleanup()
      }
    },

    triggerCleanup() {
      if (window.gc) window.gc()
      window.dispatchEvent(new CustomEvent('memory-pressure'))
    }
  }
}