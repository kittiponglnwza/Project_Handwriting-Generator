import { DEFAULT_CALIBRATION } from "./constants.js"

export function mergeCalibration(base, manual = DEFAULT_CALIBRATION) {
  return {
    offsetX: (base?.offsetX || 0) + (manual?.offsetX || 0),
    offsetY: (base?.offsetY || 0) + (manual?.offsetY || 0),
    cellAdjust: (base?.cellAdjust || 0) + (manual?.cellAdjust || 0),
    gapAdjust: (base?.gapAdjust || 0) + (manual?.gapAdjust || 0),
  }
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

export function median(values) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[mid]
  return (sorted[mid - 1] + sorted[mid]) / 2
}
