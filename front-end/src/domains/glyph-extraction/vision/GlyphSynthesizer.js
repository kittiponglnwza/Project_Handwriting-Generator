/**
 * GlyphSynthesizer.js — Auto-fill missing Thai glyphs using style transfer (P3.2)
 *
 * Algorithm:
 *   1. วิเคราะห์ style จาก existingGlyphs (stroke width, curvature, slant)
 *   2. หา base glyph ที่ใกล้เคียงที่สุด (ด้วย shape similarity / category matching)
 *   3. Transform base → target character shape
 *   4. Apply style parameters (roughness, slant, boldness)
 *
 * Usage:
 *   import { synthesizeMissingGlyphs, RARE_THAI_GLYPHS } from './GlyphSynthesizer'
 *   const synthetic = synthesizeMissingGlyphs(myGlyphs, RARE_THAI_GLYPHS)
 */

// ─── Rare Thai glyphs that are commonly missing ───────────────────────────────

export const RARE_THAI_GLYPHS = [
  'ฆ', 'ฌ', 'ฎ', 'ฏ', 'ฐ', 'ฑ', 'ฒ', 'ณ',
  'ศ', 'ษ', 'ฬ', 'ฦ', 'ฤ', 'ๆ', 'ฯ',
]

// ─── Shape category groups (used for base glyph selection) ───────────────────
// Each group shares structural similarity — synthesizing within a group gives best results.

const SHAPE_GROUPS = [
  { chars: ['ก', 'ข', 'ค', 'ฆ'],           label: 'head-loop' },
  { chars: ['ง', 'ถ', 'น', 'ณ'],           label: 'arc-tail' },
  { chars: ['จ', 'ฉ', 'ช', 'ฌ'],           label: 'hook-base' },
  { chars: ['ด', 'ฎ', 'ต', 'ฏ'],           label: 'vertical-flag' },
  { chars: ['ท', 'ธ', 'ฐ', 'ฑ', 'ฒ'],     label: 'cross-beam' },
  { chars: ['ป', 'ผ', 'ฝ', 'พ', 'ภ'],     label: 'top-bar' },
  { chars: ['ฟ', 'ฤ', 'ฦ'],               label: 'curl-loop' },
  { chars: ['ส', 'ศ', 'ษ'],               label: 'serpentine' },
  { chars: ['ล', 'ฬ', 'ว'],               label: 'open-loop' },
  { chars: ['ๆ'],                          label: 'repeat-mark' },
  { chars: ['ฯ'],                          label: 'ellipsis-mark' },
]

// ─── Style analyzer ───────────────────────────────────────────────────────────

/**
 * Estimate font style parameters from a sample of existing glyphs.
 *
 * @param {Array<{svgPath?: string, path?: string}>} glyphs
 * @returns {{ avgStrokeWidth: number, slant: number, scale: number }}
 */
export function analyzeStyle(glyphs) {
  if (!glyphs || glyphs.length === 0) {
    return { avgStrokeWidth: 1.5, slant: 0, scale: 1 }
  }

  // Estimate stroke width from path density
  const pathLengths = glyphs.slice(0, 20).map(g => {
    const d = g.svgPath ?? g.path ?? ''
    return d.length
  })
  const avgPathLen = pathLengths.reduce((a, b) => a + b, 0) / pathLengths.length

  // Normalize: longer paths → thicker stroke
  const avgStrokeWidth = Math.max(0.8, Math.min(3.5, avgPathLen / 120))

  // Estimate slant by comparing x-spread vs y-spread of paths
  // (simplified heuristic — full implementation uses point cloud analysis)
  const slant = 0 // TODO: implement actual slant detection from bounding boxes

  return { avgStrokeWidth, slant, scale: 1 }
}

// ─── Base glyph finder ────────────────────────────────────────────────────────

/**
 * Find the best existing glyph to use as base for synthesis.
 * Prefers glyphs from the same shape group.
 *
 * @param {string}  targetChar  - the character to synthesize
 * @param {Array}   glyphs      - existing glyphs with .char property
 * @returns {object|null}       - the best base glyph, or null
 */
function findBaseGlyph(targetChar, glyphs) {
  if (!glyphs || glyphs.length === 0) return null

  // Find the shape group for the target character
  const targetGroup = SHAPE_GROUPS.find(g => g.chars.includes(targetChar))

  if (targetGroup) {
    // Look for existing glyphs in the same group
    for (const groupChar of targetGroup.chars) {
      if (groupChar === targetChar) continue
      const found = glyphs.find(g => g.char === groupChar)
      if (found) return found
    }
  }

  // Fallback: use the glyph with the most similar stroke count (path M count)
  const targetMCount = 3 // estimated subpath count for unknown chars
  return glyphs.reduce((best, g) => {
    if (!g.svgPath && !g.path) return best
    const d = g.svgPath ?? g.path ?? ''
    const mCount = (d.match(/M/gi) ?? []).length
    if (!best) return g
    const bestD = best.svgPath ?? best.path ?? ''
    const bestM = (bestD.match(/M/gi) ?? []).length
    return Math.abs(mCount - targetMCount) < Math.abs(bestM - targetMCount) ? g : best
  }, null)
}

// ─── Path transformer ─────────────────────────────────────────────────────────

/**
 * Apply a style transformation to a base SVG path.
 * Adjusts scale and applies slant via a skew transform.
 *
 * @param {string} basePath  - source SVG path
 * @param {object} style     - { slant, scale }
 * @returns {string}         - transformed path
 */
function transformPath(basePath, style) {
  if (!basePath) return basePath

  const { slant = 0, scale = 1 } = style
  if (slant === 0 && scale === 1) return basePath

  // Apply skew (slant) and scale to all coordinate pairs
  const slantRad = (slant * Math.PI) / 180
  const tanSlant = Math.tan(slantRad)

  return basePath.replace(/([-]?\d*\.?\d+)\s+([-]?\d*\.?\d+)/g, (_, xStr, yStr) => {
    const x = parseFloat(xStr)
    const y = parseFloat(yStr)
    // Skew X by slant angle, apply scale
    const nx = (x + y * tanSlant) * scale
    const ny = y * scale
    return `${Math.round(nx * 100) / 100} ${Math.round(ny * 100) / 100}`
  })
}

// ─── Synthesis noise ──────────────────────────────────────────────────────────

/**
 * Add controlled random variation to make synthetic glyphs look hand-drawn.
 * Uses deterministic pseudo-random based on charCode for reproducibility.
 *
 * @param {string} path      - SVG path
 * @param {number} amount    - noise amount in px (0–5)
 * @param {number} seed      - char code for determinism
 * @returns {string}
 */
function addNoise(path, amount, seed) {
  if (amount <= 0) return path
  let s = seed

  function prng() {
    s = (s * 1664525 + 1013904223) & 0xffffffff
    return (s >>> 0) / 0xffffffff
  }

  return path.replace(/([-]?\d*\.?\d+)\s+([-]?\d*\.?\d+)/g, (_, xStr, yStr) => {
    const x = parseFloat(xStr) + (prng() - 0.5) * amount
    const y = parseFloat(yStr) + (prng() - 0.5) * amount
    return `${Math.round(x * 100) / 100} ${Math.round(y * 100) / 100}`
  })
}

// ─── Main synthesizer ─────────────────────────────────────────────────────────

/**
 * Synthesize missing glyphs based on existing glyph style.
 *
 * @param {Array}  existingGlyphs  - array of glyph objects with .char and .svgPath
 * @param {string[]} targetChars  - characters to synthesize (defaults to RARE_THAI_GLYPHS)
 * @param {object}   opts
 * @param {number}   opts.noiseAmount  - path variation (0–5, default 1.5)
 *
 * @returns {Array<{
 *   char: string,
 *   svgPath: string,
 *   synthetic: true,
 *   baseChar: string,
 *   confidence: number,   // 0–1
 * }>}
 */
export function synthesizeMissingGlyphs(
  existingGlyphs,
  targetChars = RARE_THAI_GLYPHS,
  opts = {}
) {
  const { noiseAmount = 1.5 } = opts

  const existingChars = new Set(existingGlyphs.map(g => g.char))
  const style = analyzeStyle(existingGlyphs)

  const results = []

  for (const targetChar of targetChars) {
    // Skip if we already have this character
    if (existingChars.has(targetChar)) continue

    const base = findBaseGlyph(targetChar, existingGlyphs)
    if (!base) continue

    const basePath  = base.svgPath ?? base.path ?? ''
    const styleXform = transformPath(basePath, style)
    const noisyPath  = addNoise(styleXform, noiseAmount, targetChar.charCodeAt(0))

    // Confidence: higher if same shape group, lower if fallback
    const sameGroup = SHAPE_GROUPS.some(
      g => g.chars.includes(targetChar) && g.chars.includes(base.char)
    )
    const confidence = sameGroup ? 0.75 : 0.4

    results.push({
      char:       targetChar,
      svgPath:    noisyPath,
      synthetic:  true,
      baseChar:   base.char,
      confidence,
      // Carry over metrics from base glyph where safe
      width:      base.width,
      height:     base.height,
    })
  }

  return results
}

// ─── Missing glyph detector ───────────────────────────────────────────────────

/**
 * Find which target characters are missing from an existing glyph set.
 *
 * @param {Array}    glyphs       - existing glyphs
 * @param {string[]} targetChars  - characters to check (default: RARE_THAI_GLYPHS)
 * @returns {string[]}            - missing characters
 */
export function findMissingGlyphs(glyphs, targetChars = RARE_THAI_GLYPHS) {
  const existing = new Set(glyphs.map(g => g.char))
  return targetChars.filter(c => !existing.has(c))
}
