export const GRID_COLS = 6

export const TEMPLATE_CODE_RE = /^HG(\d{1,4})$/i
export const HGMETA_RE =
  /HGMETA:page=(\d+),totalPages=(\d+),from=(\d+),to=(\d+),count=(\d+),total=(\d+)(?:,j=([A-Za-z0-9_-]+))?/
// Optional ,j=… = base64url(JSON array of one string per cell on this page)
export const HGQR_RE =
  /^HG:p=(\d+)\/(\d+),c=(\d+)-(\d+),n=(\d+),t=(\d+)(?:,j=([A-Za-z0-9_-]+))?$/

export const TEMPLATE_INDEX_RE = /^(\d{1,4})$/
export const MIN_TRUSTED_INDEX_TARGETS = 6

// Per-cell character identity tag — written as a tiny hidden element per cell in Step 1.
// Short strings are never split by pdfjs text extraction, unlike long base64 payloads.
// Format: HGCHAR:N=<char>  where N is the 1-based cell index.
export const HGCHAR_RE = /^HGCHAR:(\d+)=(.*)$/

// STEP 1 — SINGLE SOURCE OF TRUTH FOR GRID GEOMETRY
export const GRID_GEOMETRY = {
  // A4 page at PDF.js scale=3
  pageWidthPx:  1785,
  pageHeightPx: 2526,

  // ปรับ Margin เข้ามาอีกนิด เพื่อให้ตรงกับระยะ Print จริงมากขึ้น
  marginPx: 125,

  // ความสูง Header
  headerPx: 260,

  // 💡 ทำให้กรอบ "เล็กลงกระชับขึ้น" (ลด Width/Height แต่ไปเพิ่ม Gap แทนเพื่อรักษาศูนย์กลาง)
  cellWidthPx:  235,    // ทรงสี่เหลี่ยมจัตุรัสที่พอดีช่อง
  cellHeightPx: 235,    
  gapPx: 25,            // เพิ่ม gap เพื่อรักษาระยะห่างศูนย์กลางให้เป๊ะ

  // จุดเริ่มต้น
  startX: 125,          // ขยับซ้ายเข้ามานิดนึงให้กรอบตรงเป๊ะ
  startY: 385,          // ขยับลงมาให้พ้นเส้นขอบหัวตาราง

  // 💡 เพิ่ม Inset เป็น 4% เพื่อให้ Crop Zone (เส้นสีฟ้า) กินลึกเข้าไปอีก ตัดขอบดำทิ้งได้ชัวร์ขึ้น
  insetRatio: 0.04,
}

// อัปเดต GRID_CONFIG ให้สัมพันธ์กับตัวเลขด้านบน
export const GRID_CONFIG = {
  padXRatio:   0.07,    // (125 / 1785)
  topRatio:    0.1524,  // (385 / 2526)
  bottomRatio: 0.073,
  gapRatio:    0.014,   // (25 / 1785)
  insetRatio:  0.04,    // อัปเดตให้ตรงกับข้างบน
}

// Zero offset — GRID_CONFIG is now accurately matched to Step1 CSS layout.
// autoCalibration handles per-page fine-tuning on top of this.
export const DEFAULT_CALIBRATION = {
  offsetX: 0,
  offsetY: 0,
  cellAdjust: 0,
  gapAdjust: 0,
}

export const TEMPLATE_CALIBRATION = {
  offsetX: 0,
  offsetY: 0,
  cellAdjust: 0,
  gapAdjust: 0,
}

// ZERO_CALIBRATION — initial user-delta in Step 3 (starts at zero, not DEFAULT).
export const ZERO_CALIBRATION = {
  offsetX: 0,
  offsetY: 0,
  cellAdjust: 0,
  gapAdjust: 0,
}