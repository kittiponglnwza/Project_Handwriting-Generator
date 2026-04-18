/**
 * Glyph Normalization Engine
 * 
 * Normalizes all glyphs to standard canvas size with proper centering,
 * baseline alignment, and scale normalization for font generation.
 */

export class GlyphNormalizer {
  constructor() {
    this.targetSize = { width: 100, height: 100 }
    this.baselineRatio = 0.75 // Baseline at 75% of height
    this.thaiMarkAdjustment = true
  }

  /**
   * Check if character is Thai mark/vowel that needs special positioning
   */
  isThaiMarkCharacter(char) {
    // Upper marks (go above baseline)
    const upperMarks = ['ิ', 'ี', 'ึ', 'ื', 'ั', '็', '่', '้', '๊', '๋']
    // Lower marks (go below baseline)
    const lowerMarks = ['ุ', 'ู', 'ฺ']
    
    if (upperMarks.includes(char)) return { type: 'upper', position: 'above' }
    if (lowerMarks.includes(char)) return { type: 'lower', position: 'below' }
    return null
  }

  /**
   * Detect baseline position in glyph
   */
  detectBaseline(imageData, width, height) {
    // Sample bottom-heavy pixels to find baseline
    let maxDensity = 0
    let baselineY = Math.floor(height * 0.8) // Default baseline
    const data = imageData.data  // ✅ fix: ต้องใช้ .data
    
    // Scan from bottom to top looking for densest row
    for (let y = Math.floor(height * 0.6); y < Math.floor(height * 0.9); y++) {
      let darkPixels = 0
      
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4
        const alpha = data[idx + 3]
        
        if (alpha > 30) {
          const lum = data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114
          if (lum < 180) darkPixels++
        }
      }
      
      const density = darkPixels / width
      if (density > maxDensity) {
        maxDensity = density
        baselineY = y
      }
    }
    
    return baselineY / height // Return as ratio
  }

  /**
   * Calculate optimal scale for glyph
   */
  calculateOptimalScale(glyphWidth, glyphHeight, char, isThaiMark = false) {
    const targetWidth = this.targetSize.width
    const targetHeight = this.targetSize.height
    
    // Thai marks need different scaling
    if (isThaiMark) {
      // Scale marks to be smaller but still visible
      const markScale = Math.min(
        (targetWidth * 0.4) / glyphWidth,
        (targetHeight * 0.4) / glyphHeight
      )
      return Math.min(markScale, 2.0) // Cap scale for tiny marks
    }
    
    // Regular characters: fit within target size with some padding
    const scaleX = (targetWidth * 0.8) / glyphWidth
    const scaleY = (targetHeight * 0.8) / glyphHeight
    
    return Math.min(scaleX, scaleY, 3.0) // Cap maximum scale
  }

  /**
   * Calculate centering offset for glyph
   */
  calculateCenteringOffset(glyphWidth, glyphHeight, scale, baselineRatio, charInfo) {
    const scaledWidth = glyphWidth * scale
    const scaledHeight = glyphHeight * scale
    
    let offsetX = (this.targetSize.width - scaledWidth) / 2
    let offsetY = (this.targetSize.height - scaledHeight) / 2
    
    // Adjust for Thai marks
    if (charInfo && this.thaiMarkAdjustment) {
      if (charInfo.position === 'above') {
        // Position upper marks above baseline
        offsetY = this.targetSize.height * (1 - this.baselineRatio) - scaledHeight * 0.2
      } else if (charInfo.position === 'below') {
        // Position lower marks below baseline
        offsetY = this.targetSize.height * this.baselineRatio
      }
    }
    
    return { x: offsetX, y: offsetY }
  }

  /**
   * Normalize a single glyph to standard canvas
   */
  normalizeGlyph(glyphCanvas, char, options = {}) {
    const ctx = glyphCanvas.getContext('2d')
    if (!ctx) {
      throw new Error('Invalid canvas context')
    }

    const { width: glyphWidth, height: glyphHeight } = glyphCanvas
    const imageData = ctx.getImageData(0, 0, glyphWidth, glyphHeight)
    
    // Detect character properties
    const charInfo = this.isThaiMarkCharacter(char)
    const baselineRatio = this.detectBaseline(imageData, glyphWidth, glyphHeight)
    const isThaiMark = !!charInfo
    
    // Calculate transformations
    const scale = this.calculateOptimalScale(glyphWidth, glyphHeight, char, isThaiMark)
    const offset = this.calculateCenteringOffset(glyphWidth, glyphHeight, scale, baselineRatio, charInfo)
    
    // Create normalized canvas
    const normalizedCanvas = document.createElement('canvas')
    normalizedCanvas.width = this.targetSize.width
    normalizedCanvas.height = this.targetSize.height
    const normalizedCtx = normalizedCanvas.getContext('2d')
    
    // Clear canvas (transparent background)
    normalizedCtx.clearRect(0, 0, this.targetSize.width, this.targetSize.height)
    
    // Apply transformations and draw glyph
    normalizedCtx.save()
    normalizedCtx.translate(offset.x, offset.y)
    normalizedCtx.scale(scale, scale)
    normalizedCtx.drawImage(glyphCanvas, 0, 0)
    normalizedCtx.restore()
    
    // Calculate quality metrics
    const quality = this.calculateNormalizationQuality({
      originalSize: { width: glyphWidth, height: glyphHeight },
      scale,
      offset,
      charInfo,
      baselineRatio,
      finalSize: this.targetSize
    })
    
    return {
      canvas: normalizedCanvas,
      scale,
      offset,
      baselineRatio,
      charInfo,
      quality,
      metadata: {
        originalWidth: glyphWidth,
        originalHeight: glyphHeight,
        targetWidth: this.targetSize.width,
        targetHeight: this.targetSize.height,
        isThaiMark,
        char
      }
    }
  }

  /**
   * Calculate quality metrics for normalization
   */
  calculateNormalizationQuality(params) {
    let quality = 0.5 // Base quality
    
    const { originalSize, scale, offset, charInfo, finalSize } = params
    
    // Factor 1: Scale reasonableness
    if (scale >= 0.5 && scale <= 2.0) {
      quality += 0.2
    } else if (scale >= 0.3 && scale <= 3.0) {
      quality += 0.1
    }
    
    // Factor 2: Centering quality
    const scaledWidth = originalSize.width * scale
    const scaledHeight = originalSize.height * scale
    const offsetXRatio = offset.x / finalSize.width
    const offsetYRatio = offset.y / finalSize.height
    
    if (Math.abs(offsetXRatio - 0.5) < 0.1 && Math.abs(offsetYRatio - 0.5) < 0.1) {
      quality += 0.2
    }
    
    // Factor 3: Thai mark positioning
    if (charInfo) {
      if (charInfo.position === 'above' && offsetYRatio < 0.3) {
        quality += 0.1
      } else if (charInfo.position === 'below' && offsetYRatio > 0.7) {
        quality += 0.1
      }
    }
    
    return Math.min(1, quality)
  }

  /**
   * Batch normalize multiple glyphs
   */
  batchNormalize(glyphs, options = {}) {
    const results = []
    const stats = {
      total: glyphs.length,
      thaiMarks: 0,
      avgScale: 0,
      avgQuality: 0,
      failed: 0
    }
    
    for (let i = 0; i < glyphs.length; i++) {
      const glyph = glyphs[i]
      const canvas = glyph._smartCroppedCanvas || glyph.canvas || glyph._inkCanvas
      
      if (!canvas) {
        stats.failed++
        results.push({
          ...glyph,
          _normalizedCanvas: null,
          _normalizationQuality: 0,
          _normalizationError: 'No canvas available'
        })
        continue
      }
      
      try {
        const result = this.normalizeGlyph(canvas, glyph.ch, options)
        
        // Update stats
        if (result.charInfo) stats.thaiMarks++
        stats.avgScale += result.scale
        stats.avgQuality += result.quality
        
        results.push({
          ...glyph,
          _normalizedCanvas: result.canvas,
          _normalizationScale: result.scale,
          _normalizationOffset: result.offset,
          _normalizationBaseline: result.baselineRatio,
          _normalizationQuality: result.quality,
          _normalizationMetadata: result.metadata
        })
      } catch (error) {
        console.error(`Failed to normalize glyph ${i} (${glyph.ch}):`, error)
        stats.failed++
        results.push({
          ...glyph,
          _normalizedCanvas: null,
          _normalizationQuality: 0,
          _normalizationError: error.message
        })
      }
    }
    
    // Calculate averages
    if (results.length > 0) {
      stats.avgScale /= results.length
      stats.avgQuality /= results.length
    }
    
    return { results, stats }
  }

  /**
   * Set custom target size
   */
  setTargetSize(width, height) {
    this.targetSize = { width, height }
  }

  /**
   * Set baseline ratio (0-1, where 1 is bottom)
   */
  setBaselineRatio(ratio) {
    this.baselineRatio = Math.max(0, Math.min(1, ratio))
  }

  /**
   * Enable/disable Thai mark adjustments
   */
  setThaiMarkAdjustment(enabled) {
    this.thaiMarkAdjustment = enabled
  }

  /**
   * Get debug information for normalization
   */
  getNormalizationDebugInfo(glyphCanvas, char, options = {}) {
    const result = this.normalizeGlyph(glyphCanvas, char, options)
    
    return {
      input: {
        width: glyphCanvas.width,
        height: glyphCanvas.height,
        char
      },
      output: {
        width: result.canvas.width,
        height: result.canvas.height,
        scale: result.scale,
        offset: result.offset,
        baselineRatio: result.baselineRatio
      },
      quality: {
        score: result.quality,
        charInfo: result.charInfo,
        metadata: result.metadata
      }
    }
  }
}