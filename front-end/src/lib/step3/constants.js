export const GRID_COLS = 6

export const TEMPLATE_CODE_RE = /^HG(\d{1,4})$/i
export const HGMETA_RE =
  /HGMETA:page=(\d+),totalPages=(\d+),from=(\d+),to=(\d+),count=(\d+),total=(\d+)/
// Optional ,j=… = base64url(JSON array of one string per cell on this page)
export const HGQR_RE =
  /^HG:p=(\d+)\/(\d+),c=(\d+)-(\d+),n=(\d+),t=(\d+)(?:,j=([A-Za-z0-9_-]+))?$/

export const TEMPLATE_INDEX_RE = /^(\d{1,4})$/
export const MIN_TRUSTED_INDEX_TARGETS = 6

export const GRID_CONFIG = {
  padXRatio: 0.075,
  topRatio: 0.19,
  bottomRatio: 0.08,
  gapRatio: 0.011,
  insetRatio: 0.08,
}

export const DEFAULT_CALIBRATION = {
  // ผสานค่าที่ต้อง “เลื่อนเพิ่ม” ให้พอดีต่อใช้งานจริงและส่งออก
  // (ผู้ใช้ต้องปรับเพิ่ม x += 25, y += 37 เพื่อให้ตรง)
  offsetX: 25,
  offsetY: 37,
  cellAdjust: 0,
  gapAdjust: 0,
}

// Measured from HG anchor positions in template PDF at scale=3:
//   HG001 x1=352.6px → cell left=116px, baseStartX=133.9 → offsetX=-18
//   HG001 y0=370.3px → cell top=344.3px, desiredStartY=479.9 → offsetY=-136
//   row pitch actual=256.5px ≈ computed=256.1px → cellAdjust=0
export const TEMPLATE_CALIBRATION = {
  offsetX: -18,
  offsetY: -136,
  cellAdjust: 0,
  gapAdjust: 0,
}
