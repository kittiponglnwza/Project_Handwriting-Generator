/**
 * Per-Page Calibration Engine
 * 
 * Solves the core problem: each page needs individual rotation/scale/translation
 * instead of using global calibration across all pages.
 */

export class PerPageCalibration {
  constructor() {
    this.cornerMarkers = null
    this.pageTransforms = new Map()
  }

  /**
   * Detect page rotation using Hough transform on edge features
   */
  detectPageRotation(imageData, width, height) {
    // Sample edges at multiple angles to find dominant orientation
    const angles = []
    const step = 4 // Sample every 4 pixels for performance
    const data = imageData.data  // ✅ fix: ต้องใช้ .data
    let totalEdgeCount = 0  // ✅ fix: ต้องนับ total นอก loop ไม่ใช่อ่าน edgeCount จาก iteration สุดท้าย
    
    // Detect horizontal edges
    for (let y = step; y < height - step; y += step * 4) {
      let edgeSum = 0
      let edgeCount = 0
      
      for (let x = step; x < width - step; x += step) {
        const idx1 = (y * width + x) * 4
        const idx2 = (y * width + x + step) * 4
        
        if (data[idx1 + 3] > 10 && data[idx2 + 3] > 10) {
          const lum1 = data[idx1] * 0.299 + data[idx1 + 1] * 0.587 + data[idx1 + 2] * 0.114
          const lum2 = data[idx2] * 0.299 + data[idx2 + 1] * 0.587 + data[idx2 + 2] * 0.114
          const gradient = Math.abs(lum2 - lum1)
          
          if (gradient > 30) {
            edgeSum += gradient
            edgeCount++
          }
        }
      }
      
      if (edgeCount > 0) {
        angles.push({ y, strength: edgeSum / edgeCount })
        totalEdgeCount += edgeCount  // ✅ fix: สะสม edge count ทุก row
      }
    }

    // Calculate skew from edge distribution
    if (angles.length < 3) return { rotation: 0, confidence: 0 }
    
    // Simple linear regression to find tilt
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0
    angles.forEach((point, i) => {
      sumX += i
      sumY += point.y
      sumXY += i * point.y
      sumX2 += i * i
    })
    
    const n = angles.length
    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX)
    const rotation = Math.atan(slope) * (180 / Math.PI)
    
    return {
      rotation: Math.max(-5, Math.min(5, rotation)), // Clamp to ±5°
      confidence: Math.min(1, totalEdgeCount / (width * height / (step * step)))  // ✅ fix: ใช้ totalEdgeCount
    }
  }

  /**
   * Detect page scale by measuring expected grid cell dimensions
   */
  detectPageScale(imageData, width, height, expectedCellSize) {
    // Find dark cell boundaries by sampling grid patterns
    const samplePoints = 20
    let measuredSize = 0
    let validSamples = 0
    
    for (let i = 0; i < samplePoints; i++) {
      const y = Math.floor(height * 0.2 + (height * 0.6) * (i / samplePoints))
      
      // Find consecutive dark horizontal lines (cell boundaries)
      let boundaryCount = 0
      let lastDarkX = -1
      const data = imageData.data  // ✅ fix
      
      for (let x = width * 0.1; x < width * 0.9; x += 2) {
        const idx = (y * width + Math.floor(x)) * 4
        const lum = data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114
        
        if (lum < 150) { // Dark pixel
          if (lastDarkX >= 0 && x - lastDarkX > expectedCellSize * 0.7) {
            boundaryCount++
            lastDarkX = x
          } else if (lastDarkX < 0) {
            lastDarkX = x
          }
        }
      }
      
      if (boundaryCount >= 4) { // Found at least 4 cell boundaries
        const avgCellWidth = (width * 0.8) / boundaryCount
        measuredSize += avgCellWidth
        validSamples++
      }
    }
    
    if (validSamples === 0) return { scale: 1, confidence: 0 }
    
    const avgMeasuredSize = measuredSize / validSamples
    const scale = avgMeasuredSize / expectedCellSize
    
    return {
      scale: Math.max(0.8, Math.min(1.2, scale)), // Clamp to reasonable range
      confidence: validSamples / samplePoints
    }
  }

  /**
   * Detect translation by finding grid origin using corner detection
   */
  detectTranslation(imageData, width, height) {
    // Find top-left corner marker (dark L-shape)
    const searchSize = Math.min(width, height) * 0.15
    let bestScore = 0
    let bestX = 0, bestY = 0
    const data = imageData.data  // ✅ fix
    
    // Search for top-left corner area
    for (let y = 10; y < searchSize; y += 5) {
      for (let x = 10; x < searchSize; x += 5) {
        let score = 0
        
        // Check for dark pixels forming corner pattern
        for (let dy = 0; dy < 20; dy += 2) {
          for (let dx = 0; dx < 20; dx += 2) {
            const idx = ((y + dy) * width + (x + dx)) * 4
            const lum = data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114
            
            // Expect dark pixels in corner pattern
            if (dy < 5 || dx < 5) {
              score += lum < 120 ? 1 : -0.5
            }
          }
        }
        
        if (score > bestScore) {
          bestScore = score
          bestX = x
          bestY = y
        }
      }
    }
    
    return {
      translateX: bestX,
      translateY: bestY,
      confidence: bestScore / 400 // Normalize score
    }
  }

  /**
   * Calibrate a single page with all transforms
   */
  calibratePage(pageData, expectedGeometry) {
    const { imageData, width, height, pageNumber } = pageData
    
    // Detect all transforms
    const rotation = this.detectPageRotation(imageData, width, height)
    const scale = this.detectPageScale(imageData, width, height, expectedGeometry.cellWidth)
    const translation = this.detectTranslation(imageData, width, height)
    
    // Combine into transformation matrix
    const transform = {
      rotation: rotation.rotation,
      scale: scale.scale,
      translateX: translation.translateX - expectedGeometry.startX,
      translateY: translation.translateY - expectedGeometry.startY,
      confidence: (rotation.confidence + scale.confidence + translation.confidence) / 3,
      pageNumber
    }
    
    // Store for this page
    this.pageTransforms.set(pageNumber, transform)
    
    return transform
  }

  /**
   * Apply page-specific calibration to grid coordinates
   */
  applyPageCalibration(x, y, pageNumber) {
    const transform = this.pageTransforms.get(pageNumber)
    if (!transform) return { x, y }
    
    // Apply transformations in order: translate -> rotate -> scale
    let newX = x + transform.translateX
    let newY = y + transform.translateY
    
    // Apply rotation around origin
    if (Math.abs(transform.rotation) > 0.1) {
      const rad = transform.rotation * Math.PI / 180
      const cos = Math.cos(rad)
      const sin = Math.sin(rad)
      
      const tempX = newX
      const tempY = newY
      newX = tempX * cos - tempY * sin
      newY = tempX * sin + tempY * cos
    }
    
    // Apply scale
    newX *= transform.scale
    newY *= transform.scale
    
    return { x: newX, y: newY }
  }

  /**
   * Get calibration for a specific page
   */
  getPageCalibration(pageNumber) {
    return this.pageTransforms.get(pageNumber) || {
      rotation: 0,
      scale: 1,
      translateX: 0,
      translateY: 0,
      confidence: 0,
      pageNumber
    }
  }

  /**
   * Reset all calibrations
   */
  reset() {
    this.pageTransforms.clear()
    this.cornerMarkers = null
  }
}