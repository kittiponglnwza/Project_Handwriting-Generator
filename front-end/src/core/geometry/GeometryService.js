import { GRID_GEOMETRY as _GRID_GEOMETRY } from '../../lib/step3/constants.js'

export class GeometryService {
  // Single source of truth — ดึงมาจาก lib/step3/constants.js
  static GRID_GEOMETRY = _GRID_GEOMETRY

  static getGridGeometry(calibration = {}) {
    const { offsetX = 0, offsetY = 0, cellAdjust = 0, gapAdjust = 0 } = calibration

    return {
      cellWidth: this.GRID_GEOMETRY.cellWidthPx + cellAdjust,
      cellHeight: this.GRID_GEOMETRY.cellHeightPx + cellAdjust,
      gap: this.GRID_GEOMETRY.gapPx + gapAdjust,
      startX: this.GRID_GEOMETRY.startX + offsetX,
      startY: this.GRID_GEOMETRY.startY + offsetY,
    }
  }

  static calculateCellPosition(index, cols = 6, geometry) {
    const row = Math.floor(index / cols)
    const col = index % cols

    return {
      x: geometry.startX + col * (geometry.cellWidth + geometry.gap),
      y: geometry.startY + row * (geometry.cellHeight + geometry.gap),
      width: geometry.cellWidth,
      height: geometry.cellHeight,
    }
  }

  static calculateCropRectangle(cellPosition, insetRatio = _GRID_GEOMETRY.insetRatio) {
    const inset = Math.round(Math.min(cellPosition.width, cellPosition.height) * insetRatio)

    return {
      x: cellPosition.x + inset,
      y: cellPosition.y + inset,
      width: Math.max(20, cellPosition.width - inset * 2),
      height: Math.max(20, cellPosition.height - inset * 2),
    }
  }

  static validateGeometry(geometry) {
    const errors = []

    if (geometry.cellWidth <= 0) errors.push('Cell width must be positive')
    if (geometry.cellHeight <= 0) errors.push('Cell height must be positive')
    if (geometry.startX < 0) errors.push('Start X must be non-negative')
    if (geometry.startY < 0) errors.push('Start Y must be non-negative')
    if (geometry.gap < 0) errors.push('Gap must be non-negative')

    return errors
  }
}
