/**
 * Smart Crop Engine with Ink Bounding Box Detection
 * 
 * Replaces fixed-size crop boxes with intelligent ink detection
 * and proper whitespace trimming for each glyph.
 */

export class SmartCropEngine {
  constructor() {
    this.inkThreshold = 180 // Luminance threshold for ink detection
    this.minPadding = 4     // Minimum padding around ink
    this.maxPadding = 12    // Maximum padding around ink
  }

  /**
   * Detect ink pixels and calculate bounding box
   */
  detectInkBoundingBox(imageData, width, height, options = {}) {
    const {
      threshold = this.inkThreshold,
      minPadding = this.minPadding,
      maxPadding = this.maxPadding,
      isThaiMark = false
    } = options

    let minX = width, minY = height, maxX = 0, maxY = 0
    let inkPixels = []
    const data = imageData.data  // ✅ fix: ImageData object ต้องใช้ .data
    
    // Scan for ink pixels
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4
        const alpha = data[idx + 3]
        
        if (alpha < 30) continue // Skip transparent pixels
        
        const lum = data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114
        
        // Adaptive threshold for Thai marks (smaller characters)
        const adaptiveThreshold = isThaiMark ? threshold - 20 : threshold
        
        if (lum < adaptiveThreshold) {
          inkPixels.push({ x, y, lum })
          minX = Math.min(minX, x)
          minY = Math.min(minY, y)
          maxX = Math.max(maxX, x)
          maxY = Math.max(maxY, y)
        }
      }
    }

    // If no ink found, return empty bounding box
    if (inkPixels.length === 0) {
      return {
        bbox: { x: 0, y: 0, width: 0, height: 0 },
        inkPixels: [],
        inkCount: 0,
        isEmpty: true
      }
    }

    // Calculate optimal padding based on ink density
    const inkArea = (maxX - minX + 1) * (maxY - minY + 1)
    const inkDensity = inkPixels.length / inkArea
    const paddingFactor = this.calculatePaddingFactor(inkDensity, isThaiMark)
    
    // Apply padding
    const padding = Math.round(Math.min(maxPadding, Math.max(minPadding, paddingFactor)))
    
    const bbox = {
      x: Math.max(0, minX - padding),
      y: Math.max(0, minY - padding),
      width: Math.min(width - minX + padding, maxX - minX + 1 + padding * 2),
      height: Math.min(height - minY + padding, maxY - minY + 1 + padding * 2)
    }

    return {
      bbox,
      inkPixels,
      inkCount: inkPixels.length,
      isEmpty: false,
      density: inkDensity,
      padding
    }
  }

  /**
   * Calculate optimal padding based on ink density and character type
   */
  calculatePaddingFactor(inkDensity, isThaiMark) {
    // Higher density = less padding, lower density = more padding
    let basePadding = 8
    
    if (isThaiMark) {
      // Thai marks need more careful padding
      basePadding = 6
    } else if (inkDensity > 0.3) {
      // Dense characters need less padding
      basePadding = 4
    } else if (inkDensity < 0.05) {
      // Sparse characters need more padding
      basePadding = 12
    }
    
    return basePadding
  }

  /**
   * Check if character is likely a Thai mark/vowel
   */
  isThaiMarkCharacter(char) {
    const thaiMarks = ['ิ', 'ี', 'ึ', 'ื', 'ั', '็', '่', '้', '๊', '๋', 'ุ', 'ู', 'ฺ']
    return thaiMarks.includes(char)
  }

  /**
   * Smart crop a glyph canvas to ink boundaries
   */
  smartCropGlyph(glyphCanvas, char, options = {}) {
    const ctx = glyphCanvas.getContext('2d')
    if (!ctx) {
      throw new Error('Invalid canvas context')
    }

    const width = glyphCanvas.width
    const height = glyphCanvas.height
    const imageData = ctx.getImageData(0, 0, width, height)

    // Detect ink bounding box
    const isThaiMark = this.isThaiMarkCharacter(char)
    const detection = this.detectInkBoundingBox(imageData, width, height, {
      ...options,
      isThaiMark
    })

    if (detection.isEmpty) {
      // Return minimal canvas for empty glyphs
      const emptyCanvas = document.createElement('canvas')
      emptyCanvas.width = 20
      emptyCanvas.height = 20
      return {
        canvas: emptyCanvas,
        bbox: detection.bbox,
        isEmpty: true,
        confidence: 0
      }
    }

    // Create cropped canvas
    const { bbox } = detection
    const croppedCanvas = document.createElement('canvas')
    croppedCanvas.width = bbox.width
    croppedCanvas.height = bbox.height
    const croppedCtx = croppedCanvas.getContext('2d')

    // Copy only the ink region
    croppedCtx.drawImage(
      glyphCanvas,
      bbox.x, bbox.y, bbox.width, bbox.height,
      0, 0, bbox.width, bbox.height
    )

    // Calculate confidence based on ink distribution
    const confidence = this.calculateCropConfidence(detection, bbox)

    return {
      canvas: croppedCanvas,
      bbox: detection.bbox,
      isEmpty: false,
      confidence,
      inkCount: detection.inkCount,
      density: detection.density,
      padding: detection.padding,
      isThaiMark
    }
  }

  /**
   * Calculate confidence score for the crop quality
   */
  calculateCropConfidence(detection, bbox) {
    if (detection.isEmpty) return 0

    let confidence = 0.5 // Base confidence

    // Factor 1: Ink density (moderate density is better)
    const density = detection.density
    if (density > 0.05 && density < 0.4) {
      confidence += 0.2
    } else if (density >= 0.4) {
      confidence += 0.1
    }

    // Factor 2: Bounding box utilization (not too much empty space)
    const bboxArea = bbox.width * bbox.height
    const utilization = detection.inkCount / bboxArea
    if (utilization > 0.1 && utilization < 0.8) {
      confidence += 0.2
    }

    // Factor 3: Aspect ratio sanity check
    const aspectRatio = bbox.width / bbox.height
    if (aspectRatio > 0.3 && aspectRatio < 3) {
      confidence += 0.1
    }

    return Math.min(1, confidence)
  }

  /**
   * Batch process multiple glyphs
   */
  batchSmartCrop(glyphs, options = {}) {
    const results = []
    const stats = {
      total: glyphs.length,
      empty: 0,
      thaiMarks: 0,
      avgConfidence: 0,
      avgPadding: 0
    }

    for (let i = 0; i < glyphs.length; i++) {
      const glyph = glyphs[i]
      
      try {
        const canvasSource = glyph.canvas || glyph._inkCanvas
        
        // Skip glyphs that have no valid canvas (e.g. extraction errors)
        if (!canvasSource || typeof canvasSource.getContext !== 'function') {
          console.warn(`Skipping glyph ${i} (${glyph.ch}): no valid canvas`)
          results.push({
            ...glyph,
            _smartCroppedCanvas: null,
            _cropBbox: { x: 0, y: 0, width: glyph._inkW || 0, height: glyph._inkH || 0 },
            _cropConfidence: 0,
            _isEmpty: true,
            _isThaiMark: false
          })
          continue
        }

        const result = this.smartCropGlyph(canvasSource, glyph.ch, options)
        
        // Update stats
        if (result.isEmpty) stats.empty++
        if (result.isThaiMark) stats.thaiMarks++
        stats.avgConfidence += result.confidence
        stats.avgPadding += result.padding

        results.push({
          ...glyph,
          _smartCroppedCanvas: result.canvas,
          _cropBbox: result.bbox,
          _cropConfidence: result.confidence,
          _isEmpty: result.isEmpty,
          _isThaiMark: result.isThaiMark
        })
      } catch (error) {
        console.error(`Failed to crop glyph ${i} (${glyph.ch}):`, error)
        results.push({
          ...glyph,
          _smartCroppedCanvas: glyph.canvas || glyph._inkCanvas,
          _cropBbox: { x: 0, y: 0, width: glyph._inkW || 0, height: glyph._inkH || 0 },
          _cropConfidence: 0,
          _isEmpty: true,
          _isThaiMark: false
        })
      }
    }

    // Calculate averages
    if (results.length > 0) {
      stats.avgConfidence /= results.length
      stats.avgPadding /= results.length
    }

    return { results, stats }
  }

  /**
   * Get debug information for a specific crop
   */
  getCropDebugInfo(originalCanvas, char, options = {}) {
    const result = this.smartCropGlyph(originalCanvas, char, options)
    
    return {
      original: {
        width: originalCanvas.width,
        height: originalCanvas.height
      },
      cropped: {
        width: result.canvas.width,
        height: result.canvas.height,
        bbox: result.bbox
      },
      metrics: {
        confidence: result.confidence,
        inkCount: result.inkCount,
        density: result.density,
        padding: result.padding,
        isThaiMark: result.isThaiMark,
        isEmpty: result.isEmpty
      }
    }
  }

  /**
   * Set custom thresholds for special cases
   */
  setThresholds(options = {}) {
    if (options.inkThreshold !== undefined) {
      this.inkThreshold = options.inkThreshold
    }
    if (options.minPadding !== undefined) {
      this.minPadding = options.minPadding
    }
    if (options.maxPadding !== undefined) {
      this.maxPadding = options.maxPadding
    }
  }

  /**
   * Reset to default thresholds
   */
  resetThresholds() {
    this.inkThreshold = 180
    this.minPadding = 4
    this.maxPadding = 12
  }
}