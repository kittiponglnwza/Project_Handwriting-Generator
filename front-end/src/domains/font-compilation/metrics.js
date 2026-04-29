/**
 * metrics.js — Smart OpenType glyph metrics
 *
 * Computes per-glyph advance width, LSB, RSB from actual path bounding boxes.
 * Replaces the flat 600-unit advance-width that caused spacing issues.
 *
 * Coordinate system: all values are in font units (UPM space, Y-up).
 */

// ─── UPM Constants ────────────────────────────────────────────────────────────
export const UPM         = 1000
export const ASCENDER    = 800
export const DESCENDER   = -200
export const X_HEIGHT    = 500
export const CAP_HEIGHT  = 680
export const GLYPH_SIZE  = 900   // target draw size within UPM
export const SCALE       = GLYPH_SIZE / 100  // 0-100 SVG → UPM: ×9

// ─── Per-class advance widths (fallback when bbox unavailable) ─────────────────
const CLASS_WIDTHS = {
  // Thai consonants — full width
  thai_consonant: 580,
  // Thai vowels above/below — zero or near-zero advance (non-spacing)
  thai_above:  0,
  thai_below:  0,
  thai_right: 380,
  // Thai leading vowels (เ แ โ ใ ไ) — appear BEFORE consonant, advanceWidth=0
  // The consonant after them carries the full advance.
  thai_leading: 0,
  // Thai tone marks — non-spacing
  thai_tone:   0,
  // Latin uppercase
  latin_upper: 650,
  // Latin lowercase
  latin_lower: 520,
  // Narrow latin (i, l, j, r, f, t)
  latin_narrow: 320,
  // Wide latin (m, w)
  latin_wide:   780,
  // Digits
  digit:        540,
  // Punctuation — narrow
  punctuation:  280,
  // Space
  space:        240,
  // Default fallback
  default:      600,
}

// ─── Thai Unicode ranges ───────────────────────────────────────────────────────
// Reference: Unicode block U+0E00–U+0E7F

/** Thai consonants U+0E01–U+0E2E */
const THAI_CONSONANTS = new Set(
  Array.from({ length: 0x2E }, (_, i) => 0x0E01 + i)
)

/** Thai vowels that appear above the consonant (non-spacing) */
const THAI_ABOVE_VOWELS = new Set([
  0x0E31, // mai han akat (◌ั)
  0x0E34, 0x0E35, 0x0E36, 0x0E37, // sara i, ī, ue, uu
  0x0E47, // maitaikhu (◌็)
  0x0E4D, // nikhahit (◌ํ)
  0x0E4E, // yamakkan (◌๎)
])

/** Thai vowels that appear below the consonant (non-spacing) */
const THAI_BELOW_VOWELS = new Set([
  0x0E38, 0x0E39, // sara u, ū
  0x0E3A, // phinthu (◌ฺ)
])

/** Thai tone marks (non-spacing, above) */
const THAI_TONES = new Set([
  0x0E48, 0x0E49, 0x0E4A, 0x0E4B, // mai ek, tho, tri, jattawa
])

/** Thai right-side vowels (trailing — appear to the RIGHT of the consonant) */
const THAI_RIGHT_VOWELS = new Set([
  0x0E30, // sara a   (◌ะ)
  0x0E32, // sara aa  (◌า)
  0x0E33, // sara am  (◌ำ)
  0x0E45, // lakkhangyao (ๅ)
  // NOTE: 0x0E40–0x0E44 (เ แ โ ใ ไ) are LEADING vowels — they appear to the LEFT
  // of the consonant. Do NOT include them here or they get advanceWidth=380
  // and render on the wrong side causing overlapping black blocks.
])

/** Thai leading vowels (appear to the LEFT of the consonant) */
const THAI_LEADING_VOWELS = new Set([
  0x0E40, // sara e  (เ)
  0x0E41, // sara ae (แ)
  0x0E42, // sara o  (โ)
  0x0E43, // sara ai maimuan (ใ)
  0x0E44, // sara ai maimalai (ไ)
])

/** Narrow latin characters */
const NARROW_LATIN = new Set([
  0x0069, 0x006C, 0x006A, 0x0072, 0x0066, 0x0074, // i l j r f t
  0x0049, 0x004A,                                   // I J
  0x0021, 0x002C, 0x002E, 0x003A, 0x003B,           // ! , . : ;
])

/** Wide latin characters */
const WIDE_LATIN = new Set([
  0x006D, 0x0077, // m w
  0x004D, 0x0057, // M W
])

// ─── Glyph class detection ────────────────────────────────────────────────────

/**
 * Returns the metric class of a Unicode codepoint.
 * @param {number} cp - Unicode codepoint
 * @returns {string} class key into CLASS_WIDTHS
 */
export function getGlyphClass(cp) {
  if (cp === 0x0020) return 'space'
  if (THAI_TONES.has(cp)) return 'thai_tone'          // ่ ้ ๊ ๋  — tone marks (above, own zone)
  if (THAI_ABOVE_VOWELS.has(cp)) return 'thai_above'  // ั ิ ี ึ ื ็ ํ ๎
  if (cp === 0x0E4C) return 'thai_above'              // ์ thanthakat — silent mark (non-spacing, above)
  if (THAI_BELOW_VOWELS.has(cp)) return 'thai_below'
  if (THAI_RIGHT_VOWELS.has(cp)) return 'thai_right'
  if (THAI_LEADING_VOWELS.has(cp)) return 'thai_leading'
  if (THAI_CONSONANTS.has(cp) || (cp >= 0x0E2F && cp <= 0x0E3A)) return 'thai_consonant'
  if (cp >= 0x0E00 && cp <= 0x0E7F) return 'thai_consonant' // other Thai
  if (cp >= 0x0041 && cp <= 0x005A) {                         // A-Z
    if (WIDE_LATIN.has(cp)) return 'latin_wide'
    if (NARROW_LATIN.has(cp)) return 'latin_narrow'
    return 'latin_upper'
  }
  if (cp >= 0x0061 && cp <= 0x007A) {                         // a-z
    if (WIDE_LATIN.has(cp)) return 'latin_wide'
    if (NARROW_LATIN.has(cp)) return 'latin_narrow'
    return 'latin_lower'
  }
  if (cp >= 0x0030 && cp <= 0x0039) return 'digit'           // 0-9
  if (cp >= 0x0020 && cp <= 0x002F) return 'punctuation'     // !"#$%&'()*+,-./
  if (cp >= 0x003A && cp <= 0x0040) return 'punctuation'
  if (cp >= 0x005B && cp <= 0x0060) return 'punctuation'
  if (cp >= 0x007B && cp <= 0x007E) return 'punctuation'
  return 'default'
}

/**
 * Returns true if the codepoint is a Thai combining/non-spacing mark.
 * These glyphs get advanceWidth = 0 in the font.
 */
export function isThaiNonSpacing(cp) {
  return (
    THAI_ABOVE_VOWELS.has(cp) ||
    THAI_BELOW_VOWELS.has(cp) ||
    THAI_TONES.has(cp) ||
    cp === 0x0E4C  // ์ thanthakat — silent mark, non-spacing
    // NOTE: THAI_LEADING_VOWELS (เ แ โ ใ ไ) intentionally excluded here.
    // Leading vowels appear to the LEFT of the consonant and must carry a real
    // advance width derived from their actual bbox, so the shaping engine places
    // them correctly (เ left-of ก, not overlapping ก).
  )
}

// ─── Bounding box computation ─────────────────────────────────────────────────

/**
 * Parse an SVG path string (0-100 space, Y-down) and return the bounding box
 * in font units (UPM space, Y-up).
 *
 * Returns null if the path is empty or unparseable.
 *
 * @param {string} svgPath - raw SVG path from Step 3
 * @returns {{ xMin, yMin, xMax, yMax, width, height } | null}
 */
export function computePathBBox(svgPath) {
  if (!svgPath || svgPath.trim() === '' || svgPath.trim() === 'M 0 0') return null

  let xMin = Infinity, yMin = Infinity, xMax = -Infinity, yMax = -Infinity
  let cx = 0, cy = 0 // current pen position (SVG space)
  let hasPoints = false

  const addPoint = (x, y) => {
    // Convert from SVG space (0-100, Y-down) to font units (Y-up)
    const fx = x * SCALE
    const fy = (100 - y) * SCALE
    if (fx < xMin) xMin = fx
    if (fx > xMax) xMax = fx
    if (fy < yMin) yMin = fy
    if (fy > yMax) yMax = fy
    hasPoints = true
  }

  // Tokenize path: split before each command letter
  const tokens = svgPath.trim().split(/(?=[MLCQZz])/)

  for (const token of tokens) {
    const t = token.trim()
    if (!t) continue
    const cmd  = t[0]
    const nums = t.slice(1)
      .trim()
      .split(/[\s,]+/)
      .map(Number)
      .filter(n => !isNaN(n) && n !== Infinity)

    switch (cmd) {
      case 'M':
        if (nums.length >= 2) {
          cx = nums[0]; cy = nums[1]
          addPoint(cx, cy)
        }
        break
      case 'L':
        if (nums.length >= 2) {
          cx = nums[0]; cy = nums[1]
          addPoint(cx, cy)
        }
        break
      case 'C': {
        // Cubic bezier — approximate bbox by sampling
        if (nums.length < 6) break
        const [x1, y1, x2, y2, xE, yE] = nums
        // Sample 12 points along the curve
        for (let i = 1; i <= 12; i++) {
          const t2 = i / 12
          const mt = 1 - t2
          const bx = mt**3*cx + 3*mt**2*t2*x1 + 3*mt*t2**2*x2 + t2**3*xE
          const by = mt**3*cy + 3*mt**2*t2*y1 + 3*mt*t2**2*y2 + t2**3*yE
          addPoint(bx, by)
        }
        cx = xE; cy = yE
        addPoint(cx, cy)
        break
      }
      case 'Q': {
        // Quadratic bezier — approximate bbox by sampling
        if (nums.length < 4) break
        const [x1, y1, xE, yE] = nums
        for (let i = 1; i <= 8; i++) {
          const t2 = i / 8
          const mt = 1 - t2
          const bx = mt**2*cx + 2*mt*t2*x1 + t2**2*xE
          const by = mt**2*cy + 2*mt*t2*y1 + t2**2*yE
          addPoint(bx, by)
        }
        cx = xE; cy = yE
        addPoint(cx, cy)
        break
      }
      case 'Z':
      case 'z':
        break
    }
  }

  if (!hasPoints) return null
  if (xMin === Infinity) return null

  return {
    xMin, yMin, xMax, yMax,
    width:  xMax - xMin,
    height: yMax - yMin,
  }
}

// ─── Smart advance width ───────────────────────────────────────────────────────

// Side-bearing constants (font units)
const LSB_DEFAULT   = 40   // left side bearing default
const RSB_DEFAULT   = 60   // right side bearing default
const LSB_THAI      = 30
const RSB_THAI      = 50
const LSB_NARROW    = 20
const RSB_NARROW    = 30

/**
 * Compute smart metrics for a single glyph.
 *
 * @param {string} svgPath - raw SVG path (0-100, Y-down)
 * @param {number} cp      - Unicode codepoint of the character
 * @returns {{ advanceWidth, lsb, rsb, bbox: BBox|null }}
 */
export function computeGlyphMetrics(svgPath, cp) {
  const glyphClass = getGlyphClass(cp)
  const bbox = computePathBBox(svgPath)

  // Non-spacing Thai marks: zero advance width, centred on baseline
  if (isThaiNonSpacing(cp)) {
    return { advanceWidth: 0, lsb: 0, rsb: 0, bbox }
  }

  // Space glyph
  if (cp === 0x0020) {
    return { advanceWidth: CLASS_WIDTHS.space, lsb: 0, rsb: 0, bbox: null }
  }

  // No path data — fall back to class default
  if (!bbox || bbox.width < 1) {
    const fallback = CLASS_WIDTHS[glyphClass] ?? CLASS_WIDTHS.default
    return { advanceWidth: fallback, lsb: 0, rsb: 0, bbox }
  }

  // Compute side bearings based on class
  let lsb, rsb
  if (glyphClass.startsWith('thai')) {
    lsb = LSB_THAI
    rsb = RSB_THAI
  } else if (glyphClass === 'latin_narrow' || glyphClass === 'punctuation') {
    lsb = LSB_NARROW
    rsb = RSB_NARROW
  } else {
    lsb = LSB_DEFAULT
    rsb = RSB_DEFAULT
  }

  // advanceWidth = lsb + glyphWidth + rsb
  const advanceWidth = Math.round(lsb + bbox.width + rsb)

  // Clamp to sane range
  const minW = CLASS_WIDTHS[glyphClass] ? Math.round(CLASS_WIDTHS[glyphClass] * 0.5) : 200
  const maxW = 1200

  return {
    advanceWidth: Math.max(minW, Math.min(maxW, advanceWidth)),
    lsb,
    rsb,
    bbox,
  }
}

/**
 * Returns a human-readable metrics summary string for the build log.
 */
export function formatMetricsSummary(metrics, ch) {
  if (!metrics.bbox) {
    return `${ch}: adv=${metrics.advanceWidth} (fallback, no path data)`
  }
  return (
    `${ch}: adv=${metrics.advanceWidth} ` +
    `lsb=${metrics.lsb} rsb=${metrics.rsb} ` +
    `w=${Math.round(metrics.bbox.width)} h=${Math.round(metrics.bbox.height)}`
  )
}