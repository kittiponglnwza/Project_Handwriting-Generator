export const GRID_COLS = 6

export const TEMPLATE_CODE_RE = /^HG(\d{1,4})$/i
export const HGMETA_RE =
  /HGMETA:page=(\d+),totalPages=(\d+),from=(\d+),to=(\d+),count=(\d+),total=(\d+)(?:,j=([A-Za-z0-9_-]+))?/
export const HGQR_RE =
  /^HG:p=(\d+)\/(\d+),c=(\d+)-(\d+),n=(\d+),t=(\d+)(?:,j=([A-Za-z0-9_-]+))?$/

export const TEMPLATE_INDEX_RE = /^(\d{1,4})$/
export const MIN_TRUSTED_INDEX_TARGETS = 6

export const HGCHAR_RE = /^HGCHAR:(\d+)=(.*)$/

// SINGLE SOURCE OF TRUTH FOR GRID GEOMETRY
// คำนวณสำหรับ Canvas ขนาด 1785 x 2526
// แกน X: 118 + (244*6) + (17*5) + 118 = 1785 ✓
export const GRID_GEOMETRY = {
  pageWidthPx:  1785,
  pageHeightPx: 2526,

  marginPx:     118,
  cellWidthPx:  244,
  gapPx:        17,

  headerPx:     264,
  cellHeightPx: 242,

  startX:       118,   // margin ซ้าย
  startY:       382,   // marginPx + headerPx (118 + 264)

  insetRatio:   0.04,  // Crop Box หลบขอบ 4%
}

export const GRID_CONFIG = {
  padXRatio:   0.0661,  // 118 / 1785
  topRatio:    0.1512,  // 382 / 2526
  bottomRatio: 0.073,
  gapRatio:    0.0095,  // 17 / 1785
  insetRatio:  0.04,
}

// Calibration — รวม 3 objects เหมือนกันให้เหลือตัวเดียว
export const DEFAULT_CALIBRATION = {
  offsetX:    0,
  offsetY:    0,
  cellAdjust: 0,
  gapAdjust:  0,
}

// Aliases (backward compat)
export const TEMPLATE_CALIBRATION = DEFAULT_CALIBRATION
export const ZERO_CALIBRATION     = DEFAULT_CALIBRATION
