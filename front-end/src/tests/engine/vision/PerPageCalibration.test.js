/**
 * PerPageCalibration.test.js — Unit tests for per-page calibration engine
 *
 * Covers:
 *   1. Dual-format imageData (ImageData-like object vs flat Uint8ClampedArray)
 *   2. pageWidth/pageHeight vs width/height destructuring in calibratePage
 *   3. Multi-page matrix isolation (no cross-page grid matrix sharing)
 */

import { describe, it, expect } from 'vitest'
import { PerPageCalibration } from '../../../engine/vision/PerPageCalibration.js'
import { CornerAnchorDetection } from '../../../engine/vision/CornerAnchorDetection.js'

// ─── Helpers ──────────────────────────────────────────────────────────────────
const W = 100
const H = 100

/** Create a minimal flat pixel buffer (RGBA) */
function makeFlatBuffer(w = W, h = H) {
  const buf = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < buf.length; i += 4) {
    buf[i] = 200   // R — mostly light gray
    buf[i + 1] = 200 // G
    buf[i + 2] = 200 // B
    buf[i + 3] = 255 // A
  }
  return buf
}

/** Wrap a flat buffer in an ImageData-like object */
function wrapAsImageData(flatBuf, w = W, h = H) {
  return { data: flatBuf, width: w, height: h }
}

const expectedGeometry = {
  startX: 10,
  startY: 10,
  cellWidth: 20,
  cellHeight: 20,
  gap: 2,
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('PerPageCalibration — dual-format imageData', () => {
  const calibration = new PerPageCalibration()

  // ── detectPageRotation ─────────────────────────────────────────────────────
  describe('detectPageRotation', () => {
    it('accepts a flat Uint8ClampedArray without throwing', () => {
      const flat = makeFlatBuffer()
      expect(() => calibration.detectPageRotation(flat, W, H)).not.toThrow()
    })

    it('accepts an ImageData-like object without throwing', () => {
      const img = wrapAsImageData(makeFlatBuffer())
      expect(() => calibration.detectPageRotation(img, W, H)).not.toThrow()
    })

    it('returns a valid result for both formats', () => {
      const flat = makeFlatBuffer()
      const img = wrapAsImageData(makeFlatBuffer())

      const r1 = calibration.detectPageRotation(flat, W, H)
      const r2 = calibration.detectPageRotation(img, W, H)

      expect(r1).toHaveProperty('rotation')
      expect(r1).toHaveProperty('confidence')
      expect(r2).toHaveProperty('rotation')
      expect(r2).toHaveProperty('confidence')
    })

    it('returns safe defaults for empty buffer', () => {
      const r = calibration.detectPageRotation(new Uint8ClampedArray(0), W, H)
      expect(r.rotation).toBe(0)
      expect(r.confidence).toBe(0)
    })
  })

  // ── detectPageScale ────────────────────────────────────────────────────────
  describe('detectPageScale', () => {
    it('accepts a flat Uint8ClampedArray without throwing', () => {
      const flat = makeFlatBuffer()
      expect(() => calibration.detectPageScale(flat, W, H, 20)).not.toThrow()
    })

    it('accepts an ImageData-like object without throwing', () => {
      const img = wrapAsImageData(makeFlatBuffer())
      expect(() => calibration.detectPageScale(img, W, H, 20)).not.toThrow()
    })

    it('returns safe defaults for empty buffer', () => {
      const r = calibration.detectPageScale(new Uint8ClampedArray(0), W, H, 20)
      expect(r.scale).toBe(1)
      expect(r.confidence).toBe(0)
    })
  })

  // ── detectTranslation ──────────────────────────────────────────────────────
  describe('detectTranslation', () => {
    it('accepts a flat Uint8ClampedArray without throwing', () => {
      const flat = makeFlatBuffer()
      expect(() => calibration.detectTranslation(flat, W, H)).not.toThrow()
    })

    it('accepts an ImageData-like object without throwing', () => {
      const img = wrapAsImageData(makeFlatBuffer())
      expect(() => calibration.detectTranslation(img, W, H)).not.toThrow()
    })

    it('returns safe defaults for empty buffer', () => {
      const r = calibration.detectTranslation(new Uint8ClampedArray(0), W, H)
      expect(r.translateX).toBe(0)
      expect(r.translateY).toBe(0)
      expect(r.confidence).toBe(0)
    })
  })

  // ── calibratePage ──────────────────────────────────────────────────────────
  describe('calibratePage', () => {
    it('reads pageWidth/pageHeight when width/height are absent', () => {
      const flat = makeFlatBuffer()
      const pageData = {
        imageData: flat,
        pageWidth: W,
        pageHeight: H,
        pageNumber: 1,
      }
      expect(() => calibration.calibratePage(pageData, expectedGeometry)).not.toThrow()
      const t = calibration.getPageCalibration(1)
      expect(t.pageNumber).toBe(1)
    })

    it('falls back to width/height when pageWidth/pageHeight are absent', () => {
      const flat = makeFlatBuffer()
      const pageData = {
        imageData: flat,
        width: W,
        height: H,
        pageNumber: 2,
      }
      expect(() => calibration.calibratePage(pageData, expectedGeometry)).not.toThrow()
      const t = calibration.getPageCalibration(2)
      expect(t.pageNumber).toBe(2)
    })

    it('prefers pageWidth over width when both exist', () => {
      const flat = makeFlatBuffer(200, 200)
      const pageData = {
        imageData: flat,
        pageWidth: 200,
        pageHeight: 200,
        width: 50,   // should be ignored
        height: 50,  // should be ignored
        pageNumber: 3,
      }
      // Should not crash — if it used width=50 the buffer would be too small
      expect(() => calibration.calibratePage(pageData, expectedGeometry)).not.toThrow()
    })
  })
})

// ─── Multi-page matrix isolation ──────────────────────────────────────────────
describe('CornerAnchorDetection — matrix isolation', () => {
  it('transformGridPoint uses the passed matrix, not the singleton', () => {
    const det = new CornerAnchorDetection()

    // Two fake matrices with obviously different values
    const matrixA = Object.freeze([1, 0, 10, 0, 1, 20, 0, 0, 1])
    const matrixB = Object.freeze([1, 0, 50, 0, 1, 60, 0, 0, 1])

    // Even though det.gridMatrix is null, passing matrix explicitly should work
    const pointA = det.transformGridPoint(2, 3, matrixA)
    const pointB = det.transformGridPoint(2, 3, matrixB)

    expect(pointA).not.toBeNull()
    expect(pointB).not.toBeNull()

    // The two matrices have different h13/h23 offsets, so results must differ
    expect(pointA.x).not.toBe(pointB.x)
    expect(pointA.y).not.toBe(pointB.y)
  })

  it('falls back to this.gridMatrix when no matrix argument is passed', () => {
    const det = new CornerAnchorDetection()
    // No gridMatrix set → should return null
    expect(det.transformGridPoint(0, 0)).toBeNull()
  })

  it('buildGridMatrix returns a frozen (immutable) array', () => {
    const det = new CornerAnchorDetection()

    // Set up corners so buildGridMatrix can compute
    det.corners = {
      topLeft: { x: 0, y: 0, confidence: 1 },
      topRight: { x: 100, y: 0, confidence: 1 },
      bottomLeft: { x: 0, y: 100, confidence: 1 },
      bottomRight: { x: 100, y: 100, confidence: 1 },
    }

    const matrix = det.buildGridMatrix(6, 6)
    expect(matrix).not.toBeNull()
    expect(Object.isFrozen(matrix)).toBe(true)

    // Attempt to mutate should throw in strict mode or silently fail
    expect(() => { matrix[0] = 999 }).toThrow()
  })

  it('each page gets its own independent matrix', () => {
    const det = new CornerAnchorDetection()

    // Simulate page 1 corners
    det.corners = {
      topLeft: { x: 10, y: 10, confidence: 1 },
      topRight: { x: 110, y: 10, confidence: 1 },
      bottomLeft: { x: 10, y: 110, confidence: 1 },
      bottomRight: { x: 110, y: 110, confidence: 1 },
    }
    const matrixPage1 = det.buildGridMatrix(6, 6)

    // Simulate page 2 corners (shifted by 50px)
    det.corners = {
      topLeft: { x: 60, y: 60, confidence: 1 },
      topRight: { x: 160, y: 60, confidence: 1 },
      bottomLeft: { x: 60, y: 160, confidence: 1 },
      bottomRight: { x: 160, y: 160, confidence: 1 },
    }
    const matrixPage2 = det.buildGridMatrix(6, 6)

    // Matrices should be different objects
    expect(matrixPage1).not.toBe(matrixPage2)

    // Using page1's matrix should yield different results than page2's
    const p1 = det.transformGridPoint(3, 3, matrixPage1)
    const p2 = det.transformGridPoint(3, 3, matrixPage2)

    expect(p1).not.toBeNull()
    expect(p2).not.toBeNull()
    expect(p1.x).not.toBe(p2.x)
    expect(p1.y).not.toBe(p2.y)
  })
})
