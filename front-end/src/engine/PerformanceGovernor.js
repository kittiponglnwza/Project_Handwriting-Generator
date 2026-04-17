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

    // แก้ Bug #5 — add() ต้อง return ผลลัพธ์
    async add(items, processor) {
      this.queue.push(...items)

      if (!this.processing) {
        this.processing = true
        const results = await this.processBatches(processor)
        this.processing = false
        return results
      }
      // ถ้า processing อยู่ รอ queue drain แล้ว return
      return this.waitForDrain()
    },

    async waitForDrain() {
      return new Promise(resolve => {
        const check = () => {
          if (!this.processing) {
            resolve([])
          } else {
            setTimeout(check, 10)
          }
        }
        check()
      })
    },

    // แก้ Bug #5 — processBatches ต้อง accumulate และ return results
    async processBatches(processor) {
      const allResults = []

      while (this.queue.length > 0) {
        const batch = this.queue.splice(0, PerformanceGovernor.config.maxBatchSize)

        const frameStart = performance.now()
        const batchResults = await processor(batch)
        const frameTime = performance.now() - frameStart

        if (Array.isArray(batchResults)) {
          allResults.push(...batchResults)
        }

        if (frameTime > PerformanceGovernor.config.frameBudget) {
          // Yield to browser
          await new Promise(resolve => setTimeout(resolve, 0))
        }
      }

      return allResults
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
