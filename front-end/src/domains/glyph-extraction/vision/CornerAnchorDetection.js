/**
 * Corner Anchor Detection and Grid Regression
 * 
 * Replaces manual X/Y sliders with intelligent corner detection
 * and perfect grid reconstruction using 4 corner anchors.
 */

export class CornerAnchorDetection {
  constructor() {
    this.corners = null
    this.gridMatrix = null
  }

  /**
   * Detect the 4 corner markers of the template grid
   */
  detectCornerMarkers(imageData, width, height) {
    const corners = {
      topLeft: this.findCornerMarker(imageData, width, height, 'top-left'),
      topRight: this.findCornerMarker(imageData, width, height, 'top-right'),
      bottomLeft: this.findCornerMarker(imageData, width, height, 'bottom-left'),
      bottomRight: this.findCornerMarker(imageData, width, height, 'bottom-right')
    }

    // Validate that we found reasonable corners
    const confidence = this.validateCorners(corners, width, height)
    
    if (confidence > 0.5) {
      this.corners = corners
      return { corners, confidence }
    }
    
    return { corners: null, confidence: 0 }
  }

  /**
   * Find a specific corner marker
   */
  findCornerMarker(imageData, width, height, corner) {
    const searchArea = this.getSearchArea(width, height, corner)
    const { startX, endX, startY, endY } = searchArea
    
    let bestScore = 0
    let bestLocation = { x: 0, y: 0 }
    
    // Search for corner pattern (L-shaped dark region)
    for (let y = startY; y < endY; y += 3) {
      for (let x = startX; x < endX; x += 3) {
        const score = this.scoreCornerPattern(imageData, width, height, x, y, corner)
        
        if (score > bestScore) {
          bestScore = score
          bestLocation = { x, y }
        }
      }
    }
    
    return {
      x: bestLocation.x,
      y: bestLocation.y,
      confidence: bestScore / 100 // Normalize
    }
  }

  /**
   * Get search area for specific corner
   */
  getSearchArea(width, height, corner) {
    const margin = Math.min(width, height) * 0.1
    
    switch (corner) {
      case 'top-left':
        return { startX: margin, endX: width * 0.3, startY: margin, endY: height * 0.3 }
      case 'top-right':
        return { startX: width * 0.7, endX: width - margin, startY: margin, endY: height * 0.3 }
      case 'bottom-left':
        return { startX: margin, endX: width * 0.3, startY: height * 0.7, endY: height - margin }
      case 'bottom-right':
        return { startX: width * 0.7, endX: width - margin, startY: height * 0.7, endY: height - margin }
    }
  }

  /**
   * Score a location for corner pattern match
   */
  scoreCornerPattern(imageData, width, height, centerX, centerY, corner) {
    let score = 0
    const sampleSize = 15
    const data = imageData.data  // ✅ fix: ต้องใช้ .data
    
    for (let dy = -sampleSize; dy <= sampleSize; dy += 2) {
      for (let dx = -sampleSize; dx <= sampleSize; dx += 2) {
        const x = Math.floor(centerX + dx)
        const y = Math.floor(centerY + dy)
        
        if (x < 0 || x >= width || y < 0 || y >= height) continue
        
        const idx = (y * width + x) * 4
        const lum = data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114
        
        // Expect dark pixels in L-shape pattern based on corner
        const isDark = lum < 120
        const isInPattern = this.isInCornerPattern(dx, dy, corner, sampleSize)
        
        score += isDark && isInPattern ? 2 : (isDark && !isInPattern ? -1 : 0)
      }
    }
    
    return Math.max(0, score)
  }

  /**
   * Check if relative position matches corner L-shape pattern
   */
  isInCornerPattern(dx, dy, corner, size) {
    const threshold = size * 0.6
    
    switch (corner) {
      case 'top-left':
        return (dx >= -threshold && dx <= threshold && dy >= -threshold && dy <= threshold) ||
               (dx >= -threshold && dx <= threshold && dy >= threshold && dy <= size)
      case 'top-right':
        return (dx >= -threshold && dx <= threshold && dy >= -threshold && dy <= threshold) ||
               (dx >= -threshold && dx <= threshold && dy >= threshold && dy <= size)
      case 'bottom-left':
        return (dx >= -threshold && dx <= threshold && dy >= -threshold && dy <= threshold) ||
               (dx >= -threshold && dx <= threshold && dy >= -size && dy <= -threshold)
      case 'bottom-right':
        return (dx >= -threshold && dx <= threshold && dy >= -threshold && dy <= threshold) ||
               (dx >= -threshold && dx <= threshold && dy >= -size && dy <= -threshold)
    }
    return false
  }

  /**
   * Validate detected corners are reasonable
   */
  validateCorners(corners, width, height) {
    if (!corners.topLeft || !corners.topRight || !corners.bottomLeft || !corners.bottomRight) {
      return 0
    }

    // Check corners form reasonable rectangle
    const topLeft = corners.topLeft
    const topRight = corners.topRight
    const bottomLeft = corners.bottomLeft
    const bottomRight = corners.bottomRight

    // Basic geometry validation
    const widthRatio = (topRight.x - topLeft.x) / width
    const heightRatio = (bottomLeft.y - topLeft.y) / height
    
    if (widthRatio < 0.3 || widthRatio > 0.9 || heightRatio < 0.3 || heightRatio > 0.9) {
      return 0
    }

    // Check corner confidence
    const avgConfidence = (
      topLeft.confidence + topRight.confidence + 
      bottomLeft.confidence + bottomRight.confidence
    ) / 4

    return avgConfidence
  }

  /**
   * Build transformation matrix from corner anchors
   */
  buildGridMatrix(expectedCols = 6, expectedRows = 6) {
    if (!this.corners) return null

    const { topLeft, topRight, bottomLeft, bottomRight } = this.corners

    // Calculate perspective transformation matrix
    const srcPoints = [
      [0, 0],                    // top-left of ideal grid
      [expectedCols - 1, 0],     // top-right of ideal grid
      [0, expectedRows - 1],     // bottom-left of ideal grid
      [expectedCols - 1, expectedRows - 1]  // bottom-right of ideal grid
    ]

    const dstPoints = [
      [topLeft.x, topLeft.y],
      [topRight.x, topRight.y],
      [bottomLeft.x, bottomLeft.y],
      [bottomRight.x, bottomRight.y]
    ]

    this.gridMatrix = this.solvePerspectiveTransform(srcPoints, dstPoints)
    return this.gridMatrix
  }

  /**
   * Solve perspective transformation matrix using least squares
   */
  solvePerspectiveTransform(srcPoints, dstPoints) {
    // Build coefficient matrix for perspective transform
    const A = []
    const B = []

    for (let i = 0; i < 4; i++) {
      const [x, y] = srcPoints[i]
      const [u, v] = dstPoints[i]

      // For u' transformation
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y])
      B.push(u)

      // For v' transformation  
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y])
      B.push(v)
    }

    // Solve using simple least squares approximation
    const matrix = this.leastSquares(A, B)
    
    // Return as flat 9-element array [h11..h33] matching transformGridPoint destructuring:
    // const [h11, h12, h13, h21, h22, h23, h31, h32, h33] = this.gridMatrix
    // matrix = [h11, h12, h13, h21, h22, h23, h31, h32] (8 values, h33 = 1)
    return [
      matrix[0], matrix[1], matrix[2],  // h11, h12, h13
      matrix[3], matrix[4], matrix[5],  // h21, h22, h23
      matrix[6], matrix[7], 1           // h31, h32, h33
    ]
  }

  /**
   * Simple least squares solver
   */
  leastSquares(A, B) {
    const n = A[0].length
    const m = A.length
    
    // Compute A^T * A
    const ATA = Array(n).fill(0).map(() => Array(n).fill(0))
    const ATB = Array(n).fill(0)
    
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        for (let k = 0; k < m; k++) {
          ATA[i][j] += A[k][i] * A[k][j]
        }
      }
      for (let k = 0; k < m; k++) {
        ATB[i] += A[k][i] * B[k]
      }
    }
    
    // Gaussian elimination (simplified)
    const X = Array(n).fill(0)
    
    for (let i = 0; i < n; i++) {
      // Find pivot
      let maxRow = i
      for (let k = i + 1; k < n; k++) {
        if (Math.abs(ATA[k][i]) > Math.abs(ATA[maxRow][i])) {
          maxRow = k
        }
      }
      
      // Swap rows
      const tempATA = ATA[i]
      const tempATB = ATB[i]
      ATA[i] = ATA[maxRow]
      ATB[i] = ATB[maxRow]
      ATA[maxRow] = tempATA
      ATB[maxRow] = tempATB
      
      // Eliminate column
      for (let k = i + 1; k < n; k++) {
        const factor = ATA[k] && ATA[k][i] ? ATA[k][i] / ATA[i][i] : 0
        ATB[k] -= factor * ATB[i]
        for (let j = i; j < n; j++) {
          ATA[k][j] -= factor * (ATA[i] && ATA[i][j] ? ATA[i][j] : 0)
        }
      }
    }
    
    // Back substitution
    for (let i = n - 1; i >= 0; i--) {
      X[i] = ATB[i] / (ATA[i] && ATA[i][i] ? ATA[i][i] : 1)
      for (let k = i - 1; k >= 0; k--) {
        ATB[k] -= (ATA[k] && ATA[k][i] ? ATA[k][i] : 0) * X[i]
      }
    }
    
    return X
  }

  /**
   * Transform ideal grid coordinates to actual page coordinates
   */
  transformGridPoint(col, row) {
    if (!this.gridMatrix) return null

    const [h11, h12, h13, h21, h22, h23, h31, h32, h33] = this.gridMatrix
    
    const x = col
    const y = row
    
    const w = h31 * x + h32 * y + h33
    const transformedX = (h11 * x + h12 * y + h13) / w
    const transformedY = (h21 * x + h22 * y + h23) / w
    
    return { x: transformedX, y: transformedY }
  }

  /**
   * Generate all cell positions for the grid
   */
  generateCellPositions(cols, rows) {
    if (!this.corners) return []

    const positions = []
    
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const point = this.transformGridPoint(col, row)
        if (point) {
          positions.push({
            col,
            row,
            x: point.x,
            y: point.y,
            index: row * cols + col
          })
        }
      }
    }
    
    return positions
  }

  /**
   * Get the transformation matrix for external use
   */
  getGridMatrix() {
    return this.gridMatrix
  }

  /**
   * Reset detection state
   */
  reset() {
    this.corners = null
    this.gridMatrix = null
  }
}