/**
 * Confidence Scoring System
 * 
 * Provides quality assessment for each glyph with detailed metrics
 * and actionable feedback for problematic extractions.
 */

export class ConfidenceScoring {
  constructor() {
    this.thresholds = {
      excellent: 0.9,
      good: 0.75,
      acceptable: 0.6,
      poor: 0.4,
      critical: 0.2
    }
    
    this.weights = {
      inkDensity: 0.25,
      edgeQuality: 0.20,
      centering: 0.15,
      proportion: 0.15,
      clarity: 0.15,
      thaiMark: 0.10
    }
  }

  /**
   * Calculate comprehensive confidence score for a glyph
   */
  calculateConfidence(glyph, options = {}) {
    const metrics = this.extractMetrics(glyph, options)
    const scores = this.calculateMetricScores(metrics)
    const overall = this.calculateOverallScore(scores)
    const feedback = this.generateFeedback(metrics, scores)
    const status = this.determineStatus(overall)
    
    return {
      overall,
      status,
      metrics,
      scores,
      feedback,
      recommendations: this.generateRecommendations(metrics, scores, status)
    }
  }

  /**
   * Extract all relevant metrics from glyph data
   */
  extractMetrics(glyph, options = {}) {
    const canvas = glyph._normalizedCanvas || glyph._smartCroppedCanvas || glyph.canvas || glyph._inkCanvas
    if (!canvas) {
      return this.emptyMetrics()
    }

    const ctx = canvas.getContext('2d')
    if (!ctx) {
      return this.emptyMetrics()
    }

    const { width, height } = canvas
    const imageData = ctx.getImageData(0, 0, width, height)
    
    return {
      // Basic properties
      width,
      height,
      char: glyph.ch,
      
      // Ink analysis
      inkAnalysis: this.analyzeInk(imageData, width, height),
      
      // Edge quality
      edgeAnalysis: this.analyzeEdges(imageData, width, height),
      
      // Centering and proportion
      spatialAnalysis: this.analyzeSpatialProperties(imageData, width, height, glyph.ch),
      
      // Clarity and noise
      clarityAnalysis: this.analyzeClarity(imageData, width, height),
      
      // Thai-specific properties
      thaiAnalysis: this.analyzeThaiProperties(glyph.ch, imageData, width, height),
      
      // Previous processing scores
      cropConfidence: glyph._cropConfidence || 0,
      normalizationQuality: glyph._normalizationQuality || 0
    }
  }

  /**
   * Return empty metrics for failed extractions
   */
  emptyMetrics() {
    return {
      width: 0,
      height: 0,
      char: '',
      inkAnalysis: { density: 0, coverage: 0, balance: 0 },
      edgeAnalysis: { sharpness: 0, completeness: 0, noise: 1 },
      spatialAnalysis: { centering: 0, proportion: 0, baseline: 0 },
      clarityAnalysis: { contrast: 0, noise: 1, artifacts: 1 },
      thaiAnalysis: { isThaiMark: false, positioning: 0, size: 0 },
      cropConfidence: 0,
      normalizationQuality: 0
    }
  }

  /**
   * Analyze ink properties
   */
  analyzeInk(imageData, width, height) {
    let inkPixels = 0
    let totalInkLuminance = 0
    let minX = width, minY = height, maxX = 0, maxY = 0
    const data = imageData.data  // ✅ ต้องใช้ .data เพราะ imageData เป็น ImageData object
    
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4
        const alpha = data[idx + 3]
        
        if (alpha > 30) {
          const lum = data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114
          
          if (lum < 180) {
            inkPixels++
            totalInkLuminance += lum
            minX = Math.min(minX, x)
            minY = Math.min(minY, y)
            maxX = Math.max(maxX, x)
            maxY = Math.max(maxY, y)
          }
        }
      }
    }
    
    const totalPixels = width * height
    const density = inkPixels / totalPixels
    const coverage = inkPixels > 0 ? ((maxX - minX + 1) * (maxY - minY + 1)) / totalPixels : 0
    const balance = inkPixels > 0 ? 1 - (totalInkLuminance / inkPixels) / 255 : 0
    
    return { density, coverage, balance }
  }

  /**
   * Analyze edge quality
   */
  analyzeEdges(imageData, width, height) {
    let edgePixels = 0
    let totalEdgeStrength = 0
    let noisePixels = 0
    const data = imageData.data  // ✅ fix: ต้องใช้ .data
    
    // Simple edge detection using Sobel operator
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = (y * width + x) * 4
        const alpha = data[idx + 3]
        
        if (alpha > 30) {
          const lum = data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114
          
          if (lum < 180) {
            // Calculate gradient
            const idx_left = (y * width + (x - 1)) * 4
            const idx_right = (y * width + (x + 1)) * 4
            const idx_up = ((y - 1) * width + x) * 4
            const idx_down = ((y + 1) * width + x) * 4
            
            const lum_left = data[idx_left] * 0.299 + data[idx_left + 1] * 0.587 + data[idx_left + 2] * 0.114
            const lum_right = data[idx_right] * 0.299 + data[idx_right + 1] * 0.587 + data[idx_right + 2] * 0.114
            const lum_up = data[idx_up] * 0.299 + data[idx_up + 1] * 0.587 + data[idx_up + 2] * 0.114
            const lum_down = data[idx_down] * 0.299 + data[idx_down + 1] * 0.587 + data[idx_down + 2] * 0.114
            
            const gradX = Math.abs(lum_right - lum_left)
            const gradY = Math.abs(lum_down - lum_up)
            const edgeStrength = Math.sqrt(gradX * gradX + gradY * gradY)
            
            if (edgeStrength > 20) {
              edgePixels++
              totalEdgeStrength += edgeStrength
            }
            
            // Check for noise (isolated pixels)
            if (edgeStrength < 5 && lum < 120) {
              noisePixels++
            }
          }
        }
      }
    }
    
    const totalInkPixels = this.countInkPixels(imageData, width, height)
    const sharpness = edgePixels > 0 ? totalEdgeStrength / edgePixels / 255 : 0
    const completeness = totalInkPixels > 0 ? edgePixels / totalInkPixels : 0
    const noise = totalInkPixels > 0 ? noisePixels / totalInkPixels : 1
    
    return { sharpness, completeness, noise }
  }

  /**
   * Analyze spatial properties
   */
  analyzeSpatialProperties(imageData, width, height, char) {
    let minX = width, minY = height, maxX = 0, maxY = 0
    let inkPixels = 0
    const data = imageData.data  // ✅ fix: ต้องใช้ .data
    
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4
        const alpha = data[idx + 3]
        
        if (alpha > 30) {
          const lum = data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114
          
          if (lum < 180) {
            inkPixels++
            minX = Math.min(minX, x)
            minY = Math.min(minY, y)
            maxX = Math.max(maxX, x)
            maxY = Math.max(maxY, y)
          }
        }
      }
    }
    
    if (inkPixels === 0) {
      return { centering: 0, proportion: 0, baseline: 0 }
    }
    
    // Calculate centering
    const centerX = (minX + maxX) / 2
    const centerY = (minY + maxY) / 2
    const idealCenterX = width / 2
    const idealCenterY = height / 2
    const centering = 1 - (Math.abs(centerX - idealCenterX) + Math.abs(centerY - idealCenterY)) / (width + height)
    
    // Calculate proportion
    const glyphWidth = maxX - minX + 1
    const glyphHeight = maxY - minY + 1
    const aspectRatio = glyphWidth / glyphHeight
    const idealAspectRatio = this.getIdealAspectRatio(char)
    const proportion = 1 - Math.abs(aspectRatio - idealAspectRatio) / idealAspectRatio
    
    // Estimate baseline for Thai characters
    const baseline = this.estimateBaseline(imageData, width, height, minY, maxY)
    
    return { centering, proportion, baseline }
  }

  /**
   * Analyze clarity and noise
   */
  analyzeClarity(imageData, width, height) {
    let totalLuminance = 0
    let luminanceVariance = 0
    let artifactPixels = 0
    let inkPixels = 0
    
    // First pass: calculate mean
    for (let i = 0; i < imageData.data.length; i += 4) {
      const alpha = imageData.data[i + 3]
      if (alpha > 30) {
        const lum = imageData.data[i] * 0.299 + imageData.data[i + 1] * 0.587 + imageData.data[i + 2] * 0.114
        if (lum < 180) {
          totalLuminance += lum
          inkPixels++
        }
      }
    }
    
    const meanLuminance = inkPixels > 0 ? totalLuminance / inkPixels : 128
    
    // Second pass: calculate variance and artifacts
    for (let i = 0; i < imageData.data.length; i += 4) {
      const alpha = imageData.data[i + 3]
      if (alpha > 30) {
        const lum = imageData.data[i] * 0.299 + imageData.data[i + 1] * 0.587 + imageData.data[i + 2] * 0.114
        if (lum < 180) {
          luminanceVariance += Math.pow(lum - meanLuminance, 2)
          
          // Artifact = isolated bright spot WITHIN ink region (lum 130-179)
          // ไม่นับ ink เข้ม (lum < 130) ว่าเป็น artifact
          if (lum > 130 && lum < 180) {
            artifactPixels++
          }
        }
      }
    }
    
    const contrast = inkPixels > 0 ? (255 - meanLuminance) / 255 : 0
    const noise = inkPixels > 0 ? Math.sqrt(luminanceVariance / inkPixels) / 255 : 1
    const artifacts = inkPixels > 0 ? artifactPixels / inkPixels : 1
    
    return { contrast, noise, artifacts }
  }

  /**
   * Analyze Thai-specific properties
   */
  analyzeThaiProperties(char, imageData, width, height) {
    const thaiMarks = ['ิ', 'ี', 'ึ', 'ื', 'ั', '็', '่', '้', '๊', '๋', 'ุ', 'ู', 'ฺ']
    const isThaiMark = thaiMarks.includes(char)
    
    if (!isThaiMark) {
      return { isThaiMark: false, positioning: 0, size: 0 }
    }
    
    // For Thai marks, check positioning and size
    let inkPixels = 0
    let minY = height, maxY = 0
    const data = imageData.data  // ✅ fix: ต้องใช้ .data
    
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4
        const alpha = data[idx + 3]
        
        if (alpha > 30) {
          const lum = data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114
          
          if (lum < 180) {
            inkPixels++
            minY = Math.min(minY, y)
            maxY = Math.max(maxY, y)
          }
        }
      }
    }
    
    const totalPixels = width * height
    const size = inkPixels / totalPixels
    
    // Check positioning (upper marks should be in upper portion, etc.)
    const verticalPosition = minY / height
    const upperMarks = ['ิ', 'ี', 'ึ', 'ื', 'ั', '็', '่', '้', '๊', '๋']
    const lowerMarks = ['ุ', 'ู', 'ฺ']
    
    let positioning = 0
    if (upperMarks.includes(char) && verticalPosition < 0.3) {
      positioning = 1
    } else if (lowerMarks.includes(char) && verticalPosition > 0.7) {
      positioning = 1
    } else if (verticalPosition > 0.3 && verticalPosition < 0.7) {
      positioning = 0.5 // In middle is not ideal for marks
    }
    
    return { isThaiMark, positioning, size }
  }

  /**
   * Calculate individual metric scores
   */
  calculateMetricScores(metrics) {
    return {
      inkDensity: this.scoreInkDensity(metrics.inkAnalysis),
      edgeQuality: this.scoreEdgeQuality(metrics.edgeAnalysis),
      centering: this.scoreCentering(metrics.spatialAnalysis),
      proportion: this.scoreProportion(metrics.spatialAnalysis),
      clarity: this.scoreClarity(metrics.clarityAnalysis),
      thaiMark: this.scoreThaiMark(metrics.thaiAnalysis)
    }
  }

  /**
   * Individual scoring methods
   */
  scoreInkDensity(analysis) {
    const { density, coverage, balance } = analysis
    let score = 0
    
    // Thai handwriting strokes are thin — ideal density is 0.02–0.25
    if (density >= 0.02 && density <= 0.25) {
      score += 0.4
    } else if (density >= 0.01 && density <= 0.5) {
      score += 0.25
    } else if (density > 0) {
      score += 0.1  // มีหมึกบ้าง ดีกว่าว่างเปล่า
    }
    
    // Coverage should be reasonable
    if (coverage >= 0.05 && coverage <= 0.7) {
      score += 0.3
    } else if (coverage > 0) {
      score += 0.15
    }
    
    // Balance should be good (dark ink)
    if (balance > 0.5) {
      score += 0.3
    } else if (balance > 0.2) {
      score += 0.15
    }
    
    return Math.min(1, score)
  }

  scoreEdgeQuality(analysis) {
    const { sharpness, completeness, noise } = analysis
    let score = 0
    
    // Sharp edges are good
    score += Math.min(1, sharpness * 2) * 0.4
    
    // Good edge completeness
    score += completeness * 0.4
    
    // Low noise is good
    score += (1 - noise) * 0.2
    
    return Math.min(1, score)
  }

  scoreCentering(analysis) {
    return Math.max(0, Math.min(1, analysis.centering * 2))
  }

  scoreProportion(analysis) {
    return Math.max(0, Math.min(1, analysis.proportion))
  }

  scoreClarity(analysis) {
    const { contrast, noise, artifacts } = analysis
    return (contrast * 0.4 + (1 - noise) * 0.3 + (1 - artifacts) * 0.3)
  }

  scoreThaiMark(analysis) {
    if (!analysis.isThaiMark) return 1 // Not a Thai mark, no penalty
    
    return (analysis.positioning * 0.6 + Math.min(1, analysis.size * 20) * 0.4)
  }

  /**
   * Calculate overall confidence score
   */
  calculateOverallScore(scores) {
    let weightedSum = 0
    let totalWeight = 0
    
    Object.entries(this.weights).forEach(([metric, weight]) => {
      if (scores[metric] !== undefined) {
        weightedSum += scores[metric] * weight
        totalWeight += weight
      }
    })
    
    return totalWeight > 0 ? weightedSum / totalWeight : 0
  }

  /**
   * Determine status based on confidence score
   */
  determineStatus(confidence) {
    if (confidence >= this.thresholds.excellent) return 'excellent'
    if (confidence >= this.thresholds.good) return 'good'
    if (confidence >= this.thresholds.acceptable) return 'acceptable'
    if (confidence >= this.thresholds.poor) return 'poor'
    return 'critical'
  }

  /**
   * Generate feedback for the user
   */
  generateFeedback(metrics, scores) {
    const feedback = []
    
    if (scores.inkDensity < 0.5) {
      feedback.push('Ink density is unusual - may be too light or too dark')
    }
    
    if (scores.edgeQuality < 0.5) {
      feedback.push('Edges are blurry or incomplete')
    }
    
    if (scores.centering < 0.5) {
      feedback.push('Character is not well-centered')
    }
    
    if (scores.proportion < 0.5) {
      feedback.push('Character proportions are distorted')
    }
    
    if (scores.clarity < 0.5) {
      feedback.push('Image has noise or artifacts')
    }
    
    if (scores.thaiMark < 0.5 && metrics.thaiAnalysis.isThaiMark) {
      feedback.push('Thai mark positioning or size is problematic')
    }
    
    return feedback
  }

  /**
   * Generate actionable recommendations
   */
  generateRecommendations(metrics, scores, status) {
    const recommendations = []
    
    if (status === 'critical') {
      recommendations.push('Re-scan this character - extraction failed')
      return recommendations
    }
    
    if (scores.inkDensity < 0.5) {
      recommendations.push('Adjust ink threshold in smart crop settings')
    }
    
    if (scores.edgeQuality < 0.5) {
      recommendations.push('Check scan quality - may need higher resolution')
    }
    
    if (scores.centering < 0.5) {
      recommendations.push('Adjust grid alignment for this page')
    }
    
    if (metrics.thaiAnalysis.isThaiMark && scores.thaiMark < 0.5) {
      recommendations.push('Enable Thai mark special handling')
    }
    
    return recommendations
  }

  /**
   * Helper methods
   */
  countInkPixels(imageData, width, height) {
    let count = 0
    for (let i = 0; i < imageData.data.length; i += 4) {
      const alpha = imageData.data[i + 3]
      if (alpha > 30) {
        const lum = imageData.data[i] * 0.299 + imageData.data[i + 1] * 0.587 + imageData.data[i + 2] * 0.114
        if (lum < 180) count++
      }
    }
    return count
  }

  getIdealAspectRatio(char) {
    // Basic aspect ratio estimation for common character types
    if (char.length === 1) {
      if (char.match(/[ก-ฮ]/)) return 0.8 // Thai consonants are taller
      if (char.match(/[ิีึืั็่้๊๋]/)) return 1.2 // Upper marks are wider
      if (char.match(/[ฺุู]/)) return 1.0 // Lower marks are balanced
    }
    return 1.0 // Default square
  }

  estimateBaseline(imageData, width, height, minY, maxY) {
    // Simple baseline estimation - return as ratio (0-1)
    return (minY + maxY) / 2 / height
  }

  /**
   * Set custom thresholds
   */
  setThresholds(thresholds) {
    this.thresholds = { ...this.thresholds, ...thresholds }
  }

  /**
   * Set custom weights
   */
  setWeights(weights) {
    this.weights = { ...this.weights, ...weights }
  }
}