/**
 * Thai Special Handling Engine
 * 
 * Specialized processing for Thai marks, vowels, and special characters
 * that are often too small or have unique positioning requirements.
 */

export class ThaiSpecialHandling {
  constructor() {
    // Thai character classifications
    this.characterClasses = {
      // Consonants (ก-ฮ)
      consonants: /^[ก-ฮ]$/,
      
      // Upper vowels and marks (go above the consonant)
      upperMarks: /^[ิีึืั็่้๊๋]$/,
      
      // Lower vowels and marks (go below the consonant)
      lowerMarks: /^[ฺุู]$/,
      
      // Leading vowels (go before the consonant)
      leadingVowels: /^[เแโใไ]$/,
      
      // Following vowels (go after the consonant)
      followingVowels: /^[ๅฤฦ]$/,
      
      // Special characters and punctuation
      specials: /^[ฯๆ๏]$/,
      
      // Numbers
      numbers: /^[๐-๙]$/,
      
      // Latin characters (for mixed scripts)
      latin: /^[a-zA-Z]$/
    }

    // Sensitive processing thresholds for small marks
    this.sensitiveThresholds = {
      markInkThreshold: 160,      // Lower threshold for small marks
      markMinPadding: 2,          // Less padding for marks
      markMaxPadding: 8,           // Max padding for marks
      markScaleMultiplier: 1.5,    // Scale up marks slightly
      markDetectionRadius: 3       // Search radius for mark detection
    }

    // Positioning rules for Thai composition
    this.positioningRules = {
      upperMarkZone: { min: 0.0, max: 0.35 },    // Top 35% of canvas
      lowerMarkZone: { min: 0.65, max: 1.0 },    // Bottom 35% of canvas
      consonantZone: { min: 0.35, max: 0.65 },   // Middle 30% of canvas
      baselineRatio: 0.65                        // Thai baseline position
    }
  }

  /**
   * Classify Thai character type
   */
  classifyCharacter(char) {
    for (const [className, regex] of Object.entries(this.characterClasses)) {
      if (regex.test(char)) {
        return className
      }
    }
    return 'unknown'
  }

  /**
   * Check if character requires sensitive processing
   */
  requiresSensitiveProcessing(char) {
    const classification = this.classifyCharacter(char)
    return ['upperMarks', 'lowerMarks'].includes(classification)
  }

  /**
   * Get optimized processing parameters for Thai characters
   */
  getThaiOptimizedParams(char) {
    const classification = this.classifyCharacter(char)
    const params = {
      classification,
      isThai: true,
      requiresSpecialHandling: false
    }

    switch (classification) {
      case 'upperMarks':
      case 'lowerMarks':
        return {
          ...params,
          requiresSpecialHandling: true,
          inkThreshold: this.sensitiveThresholds.markInkThreshold,
          minPadding: this.sensitiveThresholds.markMinPadding,
          maxPadding: this.sensitiveThresholds.markMaxPadding,
          scaleMultiplier: this.sensitiveThresholds.markScaleMultiplier,
          detectionRadius: this.sensitiveThresholds.markDetectionRadius,
          targetZone: classification === 'upperMarks' 
            ? this.positioningRules.upperMarkZone 
            : this.positioningRules.lowerMarkZone
        }

      case 'consonants':
        return {
          ...params,
          requiresSpecialHandling: false,
          inkThreshold: 180,
          minPadding: 4,
          maxPadding: 12,
          scaleMultiplier: 1.0,
          targetZone: this.positioningRules.consonantZone
        }

      case 'leadingVowels':
      case 'followingVowels':
        return {
          ...params,
          requiresSpecialHandling: true,
          inkThreshold: 170,
          minPadding: 3,
          maxPadding: 10,
          scaleMultiplier: 1.1,
          targetZone: this.positioningRules.consonantZone
        }

      default:
        return {
          ...params,
          requiresSpecialHandling: false,
          inkThreshold: 180,
          minPadding: 4,
          maxPadding: 12,
          scaleMultiplier: 1.0,
          targetZone: this.positioningRules.consonantZone
        }
    }
  }

  /**
   * Enhanced ink detection for small Thai marks
   */
  detectThaiMarkInk(imageData, width, height, params) {
    const { inkThreshold, detectionRadius } = params
    const inkPixels = []
    const data = imageData.data  // ✅ fix: ต้องใช้ .data
    
    // Use connected component analysis for small marks
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4
        const alpha = data[idx + 3]
        
        if (alpha > 20) { // Lower alpha threshold for marks
          const lum = data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114
          
          if (lum < inkThreshold) {
            // Check neighborhood to reduce noise
            if (this.hasInkNeighborhood(imageData, width, height, x, y, detectionRadius, inkThreshold)) {
              inkPixels.push({ x, y, lum })
            }
          }
        }
      }
    }
    
    return inkPixels
  }

  /**
   * Check if pixel has ink neighbors (noise reduction)
   */
  hasInkNeighborhood(imageData, width, height, centerX, centerY, radius, threshold) {
    let neighborCount = 0
    const data = imageData.data  // ✅ fix
    
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx === 0 && dy === 0) continue
        
        const x = centerX + dx
        const y = centerY + dy
        
        if (x >= 0 && x < width && y >= 0 && y < height) {
          const idx = (y * width + x) * 4
          const alpha = data[idx + 3]
          
          if (alpha > 20) {
            const lum = data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114
            if (lum < threshold) {
              neighborCount++
            }
          }
        }
      }
    }
    
    return neighborCount >= 2 // Require at least 2 neighbors
  }

  /**
   * Calculate bounding box with Thai-specific adjustments
   */
  calculateThaiBoundingBox(inkPixels, params, canvasWidth, canvasHeight) {
    if (inkPixels.length === 0) {
      return { x: 0, y: 0, width: 0, height: 0 }
    }

    let minX = canvasWidth, minY = canvasHeight, maxX = 0, maxY = 0
    
    inkPixels.forEach(pixel => {
      minX = Math.min(minX, pixel.x)
      minY = Math.min(minY, pixel.y)
      maxX = Math.max(maxX, pixel.x)
      maxY = Math.max(maxY, pixel.y)
    })

    // Apply Thai-specific padding rules
    const { minPadding, maxPadding, targetZone } = params
    const basePadding = Math.max(minPadding, Math.min(maxPadding, 4))

    // Adjust bounding box for target zone
    let adjustedX = minX - basePadding
    let adjustedY = minY - basePadding
    let adjustedWidth = (maxX - minX + 1) + basePadding * 2
    let adjustedHeight = (maxY - minY + 1) + basePadding * 2

    // Ensure the bounding box respects target zone constraints
    if (params.requiresSpecialHandling) {
      const zoneMinY = canvasHeight * targetZone.min
      const zoneMaxY = canvasHeight * targetZone.max
      
      // Adjust vertical position to be within target zone
      if (adjustedY < zoneMinY) {
        adjustedY = zoneMinY
      } else if (adjustedY + adjustedHeight > zoneMaxY) {
        adjustedY = zoneMaxY - adjustedHeight
      }
    }

    // Ensure bounds are within canvas
    adjustedX = Math.max(0, Math.min(adjustedX, canvasWidth - 1))
    adjustedY = Math.max(0, Math.min(adjustedY, canvasHeight - 1))
    adjustedWidth = Math.max(1, Math.min(adjustedWidth, canvasWidth - adjustedX))
    adjustedHeight = Math.max(1, Math.min(adjustedHeight, canvasHeight - adjustedY))

    return {
      x: adjustedX,
      y: adjustedY,
      width: adjustedWidth,
      height: adjustedHeight
    }
  }

  /**
   * Process Thai character with special handling
   */
  processThaiCharacter(glyphCanvas, char) {
    const params = this.getThaiOptimizedParams(char)
    
    if (!params.requiresSpecialHandling) {
      return {
        canvas: glyphCanvas,
        params,
        wasProcessed: false,
        confidence: 1.0
      }
    }

    const ctx = glyphCanvas.getContext('2d')
    if (!ctx) {
      throw new Error('Invalid canvas context')
    }

    const { width, height } = glyphCanvas
    const imageData = ctx.getImageData(0, 0, width, height)

    // Detect ink with Thai-specific parameters
    const inkPixels = this.detectThaiMarkInk(imageData, width, height, params)
    
    if (inkPixels.length === 0) {
      return {
        canvas: glyphCanvas,
        params,
        wasProcessed: false,
        confidence: 0.0,
        isEmpty: true
      }
    }

    // Calculate optimized bounding box
    const bbox = this.calculateThaiBoundingBox(inkPixels, params, width, height)

    // Create processed canvas
    const processedCanvas = document.createElement('canvas')
    processedCanvas.width = bbox.width
    processedCanvas.height = bbox.height
    const processedCtx = processedCanvas.getContext('2d')

    // Copy the optimized region
    processedCtx.drawImage(
      glyphCanvas,
      bbox.x, bbox.y, bbox.width, bbox.height,
      0, 0, bbox.width, bbox.height
    )

    // Calculate processing confidence
    const confidence = this.calculateThaiProcessingConfidence(inkPixels, bbox, params)

    return {
      canvas: processedCanvas,
      params,
      wasProcessed: true,
      confidence,
      isEmpty: false,
      metadata: {
        originalSize: { width, height },
        processedSize: { width: bbox.width, height: bbox.height },
        inkCount: inkPixels.length,
        bbox,
        classification: params.classification
      }
    }
  }

  /**
   * Calculate confidence for Thai processing
   */
  calculateThaiProcessingConfidence(inkPixels, bbox, params) {
    let confidence = 0.5

    // Factor 1: Ink density in bounding box
    const bboxArea = bbox.width * bbox.height
    const density = inkPixels.length / bboxArea
    if (density >= 0.1 && density <= 0.6) {
      confidence += 0.2
    }

    // Factor 2: Size appropriateness for character type
    const sizeScore = this.scoreSizeForCharacterType(bbox, params.classification)
    confidence += sizeScore * 0.2

    // Factor 3: Positioning within target zone
    if (params.requiresSpecialHandling && params.targetZone) {
      const centerRatio = (bbox.y + bbox.height / 2) / (bbox.height * 2) // Approximate
      const zoneCenter = (params.targetZone.min + params.targetZone.max) / 2
      const positionScore = 1 - Math.abs(centerRatio - zoneCenter)
      confidence += positionScore * 0.1
    }

    return Math.min(1, confidence)
  }

  /**
   * Score size appropriateness for character type
   */
  scoreSizeForCharacterType(bbox, classification) {
    const area = bbox.width * bbox.height
    
    switch (classification) {
      case 'upperMarks':
      case 'lowerMarks':
        // Marks should be relatively small
        return area < 500 ? 1 : area < 1000 ? 0.7 : 0.3
      
      case 'consonants':
        // Consonants should be medium-sized
        return area > 500 && area < 2000 ? 1 : area > 200 && area < 3000 ? 0.7 : 0.3
      
      case 'leadingVowels':
      case 'followingVowels':
        // Vowels can be variable
        return area > 300 && area < 2500 ? 1 : 0.5
      
      default:
        return 0.5
    }
  }

  /**
   * Batch process Thai characters
   */
  batchProcessThai(glyphs) {
    const results = []
    const stats = {
      total: glyphs.length,
      thaiChars: 0,
      specialProcessed: 0,
      avgConfidence: 0,
      failed: 0
    }

    for (let i = 0; i < glyphs.length; i++) {
      const glyph = glyphs[i]
      const canvas = glyph._smartCroppedCanvas || glyph.canvas || glyph._inkCanvas
      
      if (!canvas) {
        stats.failed++
        results.push({
          ...glyph,
          _thaiProcessedCanvas: null,
          _thaiProcessingConfidence: 0,
          _thaiProcessingError: 'No canvas available'
        })
        continue
      }

      const params = this.getThaiOptimizedParams(glyph.ch)
      
      if (params.isThai) {
        stats.thaiChars++
        
        try {
          const result = this.processThaiCharacter(canvas, glyph.ch)
          
          if (result.wasProcessed) {
            stats.specialProcessed++
          }
          
          stats.avgConfidence += result.confidence
          
          results.push({
            ...glyph,
            _thaiProcessedCanvas: result.canvas,
            _thaiProcessingConfidence: result.confidence,
            _thaiProcessingParams: result.params,
            _thaiProcessingMetadata: result.metadata,
            _wasThaiProcessed: result.wasProcessed
          })
        } catch (error) {
          console.error(`Failed to process Thai character ${i} (${glyph.ch}):`, error)
          stats.failed++
          results.push({
            ...glyph,
            _thaiProcessedCanvas: canvas,
            _thaiProcessingConfidence: 0,
            _thaiProcessingError: error.message
          })
        }
      } else {
        // Non-Thai character, pass through
        results.push({
          ...glyph,
          _thaiProcessedCanvas: canvas,
          _thaiProcessingConfidence: 1.0,
          _thaiProcessingParams: params,
          _wasThaiProcessed: false
        })
      }
    }

    // Calculate averages
    if (stats.thaiChars > 0) {
      stats.avgConfidence /= stats.thaiChars
    }

    return { results, stats }
  }

  /**
   * Get Thai composition rules for font generation
   */
  getThaiCompositionRules() {
    return {
      baselineRatio: this.positioningRules.baselineRatio,
      zones: this.positioningRules,
      characterClasses: this.characterClasses,
      compositionOrder: [
        'leadingVowels',  // เแโใไ
        'consonants',     // ก-ฮ
        'upperMarks',     // ิีึืั็่้๊๋
        'lowerMarks'      // ฺุู
      ]
    }
  }

  /**
   * Update sensitive thresholds
   */
  updateSensitiveThresholds(newThresholds) {
    this.sensitiveThresholds = { ...this.sensitiveThresholds, ...newThresholds }
  }

  /**
   * Update positioning rules
   */
  updatePositioningRules(newRules) {
    this.positioningRules = { ...this.positioningRules, ...newRules }
  }
}