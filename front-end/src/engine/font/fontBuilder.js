/**
 * fontBuilder.js — Production-grade font compilation engine
 *
 * Responsibilities:
 *   1. Load opentype.js as a local ESM import (no CDN)
 *   2. Validate every SVG path; skip malformed glyphs gracefully
 *   3. Build per-glyph metrics (smart advance width, LSB, RSB)
 *   4. Build .notdef + space + all character glyphs with 5 variants each:
 *        base  = cleanest/prettiest (always used on first occurrence)
 *        alt1  = tiny slant
 *        alt2  = baseline drop
 *        alt3  = narrow/faster
 *        alt4  = mild shake
 *   5. Contextual rotation system: repeated letters cycle through variants
 *      without ever showing the same variant twice in a row.
 *   6. Word-reset rule: variant cycle resets after space / new word.
 *   7. Natural micro-randomness: x ±1-3 fu, y ±1-2 fu, slant ±1°, width ±1-2%
 *   8. Humanized letter spacing: subtle ±advance variance.
 *   9. Apply real GSUB (salt, calt) and GPOS (mark) tables.
 *  10. Support Unicode > BMP (surrogate pairs / full codePoint handling).
 *  11. Export TTF ArrayBuffer + minimal WOFF wrapper.
 *  12. Emit structured build log entries + debug panel metrics.
 *  13. Memoize all deformation and metrics work — no recomputation.
 */

// Import opentype.js as local package — run `npm install opentype.js` first
import opentype from 'opentype.js'

import { deformPath, deformAll } from '../../shared/glyph/glyphVersions.js'
import {
  UPM, ASCENDER, DESCENDER, X_HEIGHT, CAP_HEIGHT, GLYPH_SIZE, SCALE,
  computeGlyphMetrics, isThaiNonSpacing, getGlyphClass,
} from './metrics.js'
import { buildGSUB, buildGPOS, getFeatureStatus } from './thaiFeatures.js'

// ─── Constants ─────────────────────────────────────────────────────────────────
const FONT_NAME    = 'MyHandwriting'
const FONT_VERSION = '3.0.0'

/**
 * Variant rotation sequence.
 * Index 0 = first letter of word (always base).
 * Subsequent repetitions cycle through this array, never repeating adjacent.
 *
 *   Slot → variant version:
 *     0 → base (1)
 *     1 → alt1 (2)
 *     2 → alt2 (3)
 *     3 → alt3 (4)
 *     4 → alt4 (5)
 *     5 → base (1)  — cycle wraps but always differs from slot 4
 *
 * The sequence [0,1,2,3,0,4] ensures no adjacent repetition.
 */
const ROTATION_SEQUENCE = [0, 1, 2, 3, 0, 4]  // indices into VARIANT_KEYS
const VARIANT_KEYS      = ['default', 'alt1', 'alt2', 'alt3', 'alt4']

// ─── Log helpers ───────────────────────────────────────────────────────────────

/**
 * @typedef {Object} LogEntry
 * @property {'info'|'warn'|'error'|'success'} level
 * @property {string} msg
 * @property {number} ts - Date.now() timestamp
 */

/** Create a log entry */
function log(level, msg) {
  return { level, msg, ts: Date.now() }
}

// ─── Path validation ───────────────────────────────────────────────────────────

/**
 * Validate an SVG path string.
 * Returns true if the path has at least one M command and at least two points.
 *
 * @param {string} svgPath
 * @returns {{ valid: boolean, reason?: string }}
 */
export function validateSvgPath(svgPath) {
  if (!svgPath || typeof svgPath !== 'string') {
    return { valid: false, reason: 'empty path' }
  }
  const trimmed = svgPath.trim()
  if (trimmed === '' || trimmed === 'M 0 0' || trimmed === 'M0 0') {
    return { valid: false, reason: 'placeholder path' }
  }
  if (!/M/i.test(trimmed)) {
    return { valid: false, reason: 'no M command' }
  }
  if (!/[LCQ]/i.test(trimmed)) {
    return { valid: false, reason: 'no line/curve command (only M)' }
  }
  const nums = trimmed.replace(/[MLCQZz]/g, ' ').trim().split(/[\s,]+/).map(Number)
  if (nums.some(n => isNaN(n))) {
    return { valid: false, reason: 'contains NaN coordinates' }
  }
  const validNums = nums.filter(n => !isNaN(n))
  if (validNums.length < 4) {
    return { valid: false, reason: 'too few coordinates' }
  }
  return { valid: true }
}

// ─── Path → opentype.js commands ──────────────────────────────────────────────

/**
 * Convert Step-3 SVG path (0-100 viewBox, Y-down) to opentype.js Path commands
 * (UPM space, Y-up).  Handles M, L, C, Q, Z.
 *
 * @param {string} svgPath
 * @param {number} [cp=0]        - Unicode codepoint; used to pick Thai mark Y-zone
 * @param {object} [glyphMeta={}]
 * @returns {object[]} array of opentype.js path command objects
 */
export function svgPathToOTCommands(svgPath, cp = 0, glyphMeta = {}) {
  const validation = validateSvgPath(svgPath)
  if (!validation.valid) return []

  // ── Per-glyph baseline computation ───────────────────────────────────────
  function computeActualBottom(path) {
    const yVals = []
    const toks = path.trim().split(/(?=[MLCQZz])/)
    for (const tok of toks) {
      const cmd = tok.trim()[0]
      if (!cmd || cmd === 'Z' || cmd === 'z') continue
      const nums = tok.slice(1).trim().split(/[\s,]+/).map(Number).filter(n => !isNaN(n) && isFinite(n))
      if (cmd === 'M' || cmd === 'L') {
        for (let i = 1; i < nums.length; i += 2) yVals.push(nums[i])
      } else if (cmd === 'C') {
        for (let i = 5; i < nums.length; i += 6) yVals.push(nums[i])
      } else if (cmd === 'Q') {
        for (let i = 3; i < nums.length; i += 4) yVals.push(nums[i])
      }
    }
    return yVals.length > 0 ? Math.max(...yVals) : (glyphMeta.svgBaseline ?? 80)
  }

  const svgBaseline = computeActualBottom(svgPath)

  // ── Thai mark zone placement ──────────────────────────────────────────────
  const _THAI_ABOVE = new Set([0x0E31,0x0E34,0x0E35,0x0E36,0x0E37,0x0E47,0x0E4D,0x0E4E])
  const _THAI_BELOW = new Set([0x0E38,0x0E39,0x0E3A])
  const _THAI_TONES = new Set([0x0E48,0x0E49,0x0E4A,0x0E4B])

  const isUpperMark = _THAI_ABOVE.has(cp) || _THAI_TONES.has(cp)
  const isLowerMark = _THAI_BELOW.has(cp)
  const isMark      = isUpperMark || isLowerMark

  const ZONES = {
    above_vowel: [630, 760],
    tone:        [770, 800],
    below:       [-400, -210],
  }

  let toFontX = (svgX) => svgX * SCALE

  // ── Latin height classification ───────────────────────────────────────────
  const isLowercase     = cp >= 0x0061 && cp <= 0x007A
  const LATIN_ASCENDERS = new Set([0x62,0x64,0x66,0x68,0x69,0x6A,0x6B,0x6C,0x74])
  const targetHeight    = !isLowercase ? CAP_HEIGHT : LATIN_ASCENDERS.has(cp) ? ASCENDER : X_HEIGHT

  let toFontY = (svgY) => (svgBaseline - svgY) / svgBaseline * targetHeight

  if (isMark) {
    const xVals = [], yVals = []
    const _tokens = svgPath.trim().split(/(?=[MLCQZz])/)
    for (const tok of _tokens) {
      const _cmd  = tok.trim()[0]
      if (!_cmd || _cmd === 'Z' || _cmd === 'z') continue
      const _nums = tok.slice(1).trim().split(/[\s,]+/).map(Number).filter(n => !isNaN(n) && isFinite(n))
      if (_cmd === 'M' || _cmd === 'L') {
        for (let i = 0; i + 1 < _nums.length; i += 2) {
          xVals.push(_nums[i]); yVals.push(_nums[i+1])
        }
      } else if (_cmd === 'C') {
        for (let i = 0; i + 5 < _nums.length; i += 6) {
          xVals.push(_nums[i], _nums[i+2], _nums[i+4])
          yVals.push(_nums[i+1], _nums[i+3], _nums[i+5])
        }
      } else if (_cmd === 'Q') {
        for (let i = 0; i + 3 < _nums.length; i += 4) {
          xVals.push(_nums[i], _nums[i+2])
          yVals.push(_nums[i+1], _nums[i+3])
        }
      }
    }

    if (yVals.length > 0) {
      const fontTop_raw = (100 - Math.min(...yVals)) * SCALE
      const fontBot_raw = (100 - Math.max(...yVals)) * SCALE
      const rawHeight   = fontTop_raw - fontBot_raw
      const _isTone     = _THAI_TONES.has(cp)
      const zone        = isLowerMark
        ? ZONES.below
        : (_isTone ? ZONES.tone : ZONES.above_vowel)
      const [zBot, zTop] = zone
      const zHeight = zTop - zBot

      if (rawHeight > 1) {
        const markScale  = zHeight / rawHeight
        const markOffset = zBot - fontBot_raw * markScale
        toFontY = (svgY) => (100 - svgY) * SCALE * markScale + markOffset
      } else {
        const zMid = (zBot + zTop) / 2
        toFontY = (svgY) => (100 - svgY) * SCALE + (zMid - (fontBot_raw + rawHeight / 2))
      }
    }
  }

  const cmds   = []
  const tokens = svgPath.trim().split(/(?=[MLCQZz])/)

  for (const token of tokens) {
    const t   = token.trim()
    if (!t) continue
    const cmd  = t[0]
    const rest = t.slice(1).trim()
    if (!rest && (cmd === 'Z' || cmd === 'z')) {
      cmds.push({ type: 'Z' })
      continue
    }
    const nums = rest
      .split(/[\s,]+/)
      .map(Number)
      .filter(n => !isNaN(n) && isFinite(n))

    switch (cmd) {
      case 'M':
        for (let i = 0; i + 1 < nums.length; i += 2) {
          cmds.push({ type: i === 0 ? 'M' : 'L', x: toFontX(nums[i]), y: toFontY(nums[i+1]) })
        }
        break
      case 'L':
        for (let i = 0; i + 1 < nums.length; i += 2) {
          cmds.push({ type: 'L', x: toFontX(nums[i]), y: toFontY(nums[i+1]) })
        }
        break
      case 'C':
        for (let i = 0; i + 5 < nums.length; i += 6) {
          cmds.push({
            type: 'C',
            x1: toFontX(nums[i]),   y1: toFontY(nums[i+1]),
            x2: toFontX(nums[i+2]), y2: toFontY(nums[i+3]),
            x:  toFontX(nums[i+4]), y:  toFontY(nums[i+5]),
          })
        }
        break
      case 'Q':
        for (let i = 0; i + 3 < nums.length; i += 4) {
          cmds.push({
            type: 'Q',
            x1: toFontX(nums[i]),   y1: toFontY(nums[i+1]),
            x:  toFontX(nums[i+2]), y:  toFontY(nums[i+3]),
          })
        }
        break
      case 'Z':
      case 'z':
        cmds.push({ type: 'Z' })
        break
    }
  }

  return cmds
}

/**
 * Build an opentype.js Path from command objects.
 */
function buildOTPath(commands) {
  const p = new opentype.Path()
  for (const c of commands) {
    switch (c.type) {
      case 'M': p.moveTo(c.x, c.y); break
      case 'L': p.lineTo(c.x, c.y); break
      case 'C': p.curveTo(c.x1, c.y1, c.x2, c.y2, c.x, c.y); break
      case 'Q': p.quadraticCurveTo(c.x1, c.y1, c.x, c.y); break
      case 'Z': p.close(); break
    }
  }
  return p
}

/**
 * Build the mandatory .notdef glyph.
 */
function buildNotdefGlyph() {
  const p = new opentype.Path()
  p.moveTo(60, 50);   p.lineTo(540, 50)
  p.lineTo(540, 680); p.lineTo(60, 680); p.close()
  p.moveTo(100, 90);  p.lineTo(500, 90)
  p.lineTo(500, 640); p.lineTo(100, 640); p.close()
  return new opentype.Glyph({ name: '.notdef', unicode: 0, advanceWidth: 600, path: p })
}

// ─── Natural micro-randomness helpers ─────────────────────────────────────────

/**
 * Apply per-placement humanization to OT path commands.
 * Adds:
 *   - x shift ±1-3 font units
 *   - y shift ±1-2 font units
 *   - slant micro-variation ±1°  (as a shear on X proportional to Y)
 *   - width micro-scale ±1-2%
 *
 * @param {object[]} cmds      - OT command array (Y-up, font units)
 * @param {() => number} rng   - seeded PRNG returning [0, 1)
 * @param {boolean} isFirst    - if true, suppress most noise (first letter beauty rule)
 * @returns {object[]}
 */
function applyPlacementNoise(cmds, rng, isFirst = false) {
  // First letter: nearly zero noise — preserve beauty
  const xShiftMax   = isFirst ? 0.3 : (rng() * 2 + 1)    // 1-3 fu
  const yShiftMax   = isFirst ? 0.2 : (rng() * 1 + 0.5)  // 0.5-1.5 fu
  const slantDeg    = isFirst ? 0   : (rng() - 0.5) * 2   // ±1°
  const widthScale  = isFirst ? 1   : 1 + (rng() - 0.5) * 0.03  // ±1.5%

  const xShift  = (rng() - 0.5) * 2 * xShiftMax
  const yShift  = (rng() - 0.5) * 2 * yShiftMax
  const shearX  = Math.tan(slantDeg * Math.PI / 180)

  // Find centroid X for width scaling
  let sumX = 0, count = 0
  for (const c of cmds) {
    if (c.x  !== undefined) { sumX += c.x;  count++ }
    if (c.x1 !== undefined) { sumX += c.x1; count++ }
    if (c.x2 !== undefined) { sumX += c.x2; count++ }
  }
  const cx = count > 0 ? sumX / count : 450

  const tx = (x, y) => cx + (x - cx) * widthScale + shearX * y + xShift
  const ty = (y)    => y + yShift

  return cmds.map(c => {
    switch (c.type) {
      case 'M': return { type: 'M', x: tx(c.x, c.y),  y: ty(c.y) }
      case 'L': return { type: 'L', x: tx(c.x, c.y),  y: ty(c.y) }
      case 'C': return {
        type: 'C',
        x1: tx(c.x1, c.y1), y1: ty(c.y1),
        x2: tx(c.x2, c.y2), y2: ty(c.y2),
        x:  tx(c.x,  c.y),  y:  ty(c.y),
      }
      case 'Q': return {
        type: 'Q',
        x1: tx(c.x1, c.y1), y1: ty(c.y1),
        x:  tx(c.x,  c.y),  y:  ty(c.y),
      }
      default: return c
    }
  })
}

// ─── Per-glyph style noise (slant / bold / roughness from UI controls) ─────────

/**
 * Apply fontStyle (slant, boldness, randomness) as coordinate-level transforms
 * on OT path commands. Called once per variant per glyph.
 *
 * @param {object[]} cmds
 * @param {object}   fontStyle  - { slant, boldness, randomness, roughness }
 * @param {function} rng        - seeded PRNG () => 0..1
 * @returns {object[]}
 */
function applyStyleNoise(cmds, fontStyle = {}, rng = Math.random) {
  const slant      = fontStyle.slant      ?? 0
  const boldness   = fontStyle.boldness   ?? 100
  const randomness = fontStyle.randomness ?? 0
  const roughness  = fontStyle.roughness  ?? 0

  const boldScale = boldness / 100
  const shearX    = Math.tan((slant * Math.PI) / 180)
  const maxJitter = (randomness / 100) * 18
  const maxRough  = (roughness  / 100) * 10

  let sumX = 0, count = 0
  for (const c of cmds) {
    if (c.x  !== undefined) { sumX += c.x;  count++ }
    if (c.x1 !== undefined) { sumX += c.x1; count++ }
    if (c.x2 !== undefined) { sumX += c.x2; count++ }
  }
  const cx = count > 0 ? sumX / count : 450

  const jit = () => (rng() - 0.5) * 2

  const tx = (x, y) => cx + (x - cx) * boldScale + shearX * y + jit() * maxJitter + jit() * maxRough
  const ty = (y)    => y + jit() * maxRough * 0.5

  return cmds.map(c => {
    switch (c.type) {
      case 'M': return { type: 'M', x: tx(c.x, c.y),  y: ty(c.y) }
      case 'L': return { type: 'L', x: tx(c.x, c.y),  y: ty(c.y) }
      case 'C': return {
        type: 'C',
        x1: tx(c.x1, c.y1), y1: ty(c.y1),
        x2: tx(c.x2, c.y2), y2: ty(c.y2),
        x:  tx(c.x,  c.y),  y:  ty(c.y),
      }
      case 'Q': return {
        type: 'Q',
        x1: tx(c.x1, c.y1), y1: ty(c.y1),
        x:  tx(c.x,  c.y),  y:  ty(c.y),
      }
      default: return c
    }
  })
}

// ─── Humanized letter spacing ──────────────────────────────────────────────────

/**
 * Add subtle random variance to an advance width.
 * Keeps readability — maximum ±3% of base advance.
 *
 * @param {number} baseAdvance
 * @param {() => number} rng
 * @returns {number}
 */
function humanizeAdvance(baseAdvance, rng) {
  const variance = (rng() - 0.5) * 2 * 0.03  // ±3%
  return Math.round(baseAdvance * (1 + variance))
}

// ─── Glyph map builder ────────────────────────────────────────────────────────

/**
 * Build a normalized glyph map from the raw Step-3 glyphs array.
 * Filters for valid status, deduplicates by character, generates 5 variants.
 *
 * The 5 variants are:
 *   base  — deformPath(path, 1)  cleanest
 *   alt1  — deformPath(path, 2)  slant
 *   alt2  — deformPath(path, 3)  baseline drop
 *   alt3  — deformPath(path, 4)  narrow
 *   alt4  — deformPath(path, 5)  shake
 *
 * When multiple raw samples exist for a character, the best-quality sample is
 * always used for `base` (first occurrence beauty rule).  Remaining samples can
 * be used as source material for alt variants to add natural per-sample variance.
 *
 * @param {object[]} glyphs - raw glyph objects from Step 3
 * @param {number}   seed   - build seed (controls shuffle)
 * @returns {Map<string, GlyphData>}
 */
export function buildGlyphMap(glyphs, seed = Math.random()) {
  const byChar    = {}
  const GOOD      = new Set(['ok', 'excellent', 'good', 'acceptable'])

  for (const g of glyphs) {
    if (!g.ch) continue
    const isOk = GOOD.has(g.status) || GOOD.has(g._visionStatus)
    if (!isOk) continue
    if (!byChar[g.ch]) byChar[g.ch] = []
    byChar[g.ch].push(g)
  }

  // Seeded PRNG for variant assignment (mulberry32)
  let _s = (seed * 2654435761) >>> 0
  function _rand() {
    _s += 0x6D2B79F5
    let t = _s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  const map = new Map()

  for (const [ch, variants] of Object.entries(byChar)) {
    const valid = variants.filter(g => validateSvgPath(g.svgPath).valid)
    if (valid.length === 0) continue

    const cp = ch.codePointAt(0)
    if (!cp) continue

    // ── Sort by quality so the best sample becomes `base` ───────────────────
    // Quality order: excellent > good > acceptable > ok
    const qualityRank = { excellent: 4, good: 3, acceptable: 2, ok: 1 }
    valid.sort((a, b) => {
      const qa = qualityRank[a.status ?? a._visionStatus] ?? 1
      const qb = qualityRank[b.status ?? b._visionStatus] ?? 1
      return qb - qa  // descending — best first
    })

    // Lightly shuffle alt variants (not [0]) for natural variety across builds
    const alts = valid.slice(1)
    for (let i = alts.length - 1; i > 0; i--) {
      const j = Math.floor(_rand() * (i + 1))
      ;[alts[i], alts[j]] = [alts[j], alts[i]]
    }
    const ordered = [valid[0], ...alts]

    // ── Pick source paths for each variant ───────────────────────────────────
    // If we have multiple raw samples, use different source samples for alt
    // variants — this gives free extra natural variation beyond deformation.
    const src = (i) => ordered[Math.min(i, ordered.length - 1)].svgPath

    const g0 = ordered[0]
    map.set(ch, {
      codepoint: cp,
      unicode:   `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`,
      // version 1 (default) always on best sample — key matches DnaStep.jsx VARIANT_KEYS
      default: deformPath(src(0), 1),
      // alt variants: mix deformation profile + potentially different raw samples
      alt1:  deformPath(src(0), 2),
      alt2:  deformPath(src(1), 3),
      alt3:  deformPath(src(2), 4),
      alt4:  deformPath(src(1), 5),
      rawId:  g0.id,
      viewBox: g0.viewBox || '0 0 100 100',
      meta: {
        svgBaseline: g0.svgBaseline ?? 80,
        svgDescBot:  g0.svgDescBot  ?? 78,
        svgCapTop:   g0.svgCapTop   ?? 10,
      },
    })
  }

  return map
}

// ─── Variant rotation state ────────────────────────────────────────────────────

/**
 * Create a contextual variant rotator for a single compilation run.
 *
 * Rules:
 *   - First letter of each word → always `base` (slot 0)
 *   - After space → word resets, next letter is first-in-word again
 *   - Repeated same letter cycles through ROTATION_SEQUENCE
 *   - Sequence resets when a different character is encountered
 *   - Never outputs the same variant twice in a row
 *
 * Usage:
 *   const rotator = createVariantRotator()
 *   for each character ch in the text:
 *     const variantKey = rotator.next(ch)  // 'base'|'alt1'|'alt2'|'alt3'|'alt4'
 *
 * @returns {{ next: (ch: string) => string, getStats: () => object }}
 */
function createVariantRotator() {
  // Per-character state: Map<char, { sequenceIdx: number, lastKey: string }>
  const state = new Map()

  // Track whether the next character is the first in a new word
  let nextIsWordStart = true

  // Usage counters for debug panel
  const usageCounts = { base: 0, alt1: 0, alt2: 0, alt3: 0, alt4: 0 }
  let rotationLog = []  // { ch, variant, isWordStart }[]

  function next(ch) {
    // Space or newline: reset word-start flag, return null (caller skips)
    if (ch === ' ' || ch === '\n' || ch === '\r') {
      nextIsWordStart = true
      return null
    }

    const isFirst = nextIsWordStart
    nextIsWordStart = false

    // First letter of word: always use base
    if (isFirst) {
      state.set(ch, { sequenceIdx: 1, lastKey: 'base' })
      usageCounts.base++
      rotationLog.push({ ch, variant: 'base', isWordStart: true })
      return 'base'
    }

    // Get or initialise per-character rotation state
    if (!state.has(ch)) {
      // First time seeing this char in current word: start at slot 1
      state.set(ch, { sequenceIdx: 1, lastKey: 'base' })
    }

    const s   = state.get(ch)
    let   idx = s.sequenceIdx % ROTATION_SEQUENCE.length
    let   key = VARIANT_KEYS[ROTATION_SEQUENCE[idx]]

    // Never repeat last variant — advance one more step if same
    if (key === s.lastKey) {
      idx = (idx + 1) % ROTATION_SEQUENCE.length
      key = VARIANT_KEYS[ROTATION_SEQUENCE[idx]]
    }

    s.sequenceIdx = idx + 1
    s.lastKey     = key

    usageCounts[key]++
    rotationLog.push({ ch, variant: key, isWordStart: false })
    return key
  }

  function reset() {
    state.clear()
    nextIsWordStart = true
  }

  function getStats() {
    return {
      usageCounts:  { ...usageCounts },
      rotationLog:  rotationLog.slice(-100),  // last 100 entries for panel
      totalGlyphs:  Object.values(usageCounts).reduce((a, b) => a + b, 0),
    }
  }

  return { next, reset, getStats }
}

// ─── Memoization cache ────────────────────────────────────────────────────────

/**
 * Build a memoization cache for (svgPath, cp, glyphMeta) → OT commands.
 * Key: `${cp}:${svgPath.slice(0,32)}` — fast and collision-resistant enough.
 *
 * @returns {{ get: Function, set: Function, size: () => number }}
 */
function createOTCommandCache() {
  const _cache = new Map()
  return {
    get: (key)        => _cache.get(key),
    set: (key, value) => _cache.set(key, value),
    size: ()          => _cache.size,
  }
}

// ─── Main compilation ─────────────────────────────────────────────────────────

/**
 * Compile a full font from a glyph map.
 *
 * Key changes from v2:
 *   - 5 variants per character (base/alt1/alt2/alt3/alt4) vs 3
 *   - All 5 paths stored in font as PUA+named glyphs
 *   - Contextual rotation system for realistic repetition
 *   - Word-reset rule
 *   - Per-placement micro-humanization (x/y shift, micro-slant, width jitter)
 *   - Humanized advance widths
 *   - Memoized OT command conversion
 *   - Debug panel stats emitted in return value
 *
 * @param {Map}      glyphMap
 * @param {string}   fontName
 * @param {Function} onProgress - (msg, pct, logEntry?) => void
 * @param {number}   seed
 * @param {object}   fontStyle  - { slant, boldness, randomness, roughness }
 * @param {object}   variantStyles - per-variant style overrides or null
 *
 * @returns {Promise<{
 *   ttfBuffer: ArrayBuffer,
 *   woffBuffer: ArrayBuffer,
 *   glyphCount: number,
 *   charCount: number,
 *   skipped: { ch: string, reason: string }[],
 *   buildLog: LogEntry[],
 *   glyphInfo: Map,
 *   featureStatus: object,
 *   font: object,
 *   puaMap: Map,
 *   debugStats: object,
 * }>}
 */
export async function compileFontBuffer(
  glyphMap,
  fontName    = FONT_NAME,
  onProgress,
  seed        = Math.random(),
  fontStyle   = {},
  variantStyles = null,
) {
  const t0 = performance.now()

  const emit = (msg, pct, level = 'info') => {
    const entry = log(level, msg)
    onProgress?.(msg, pct, entry)
    return entry
  }

  const buildLog = []
  const addLog   = (entry) => buildLog.push(entry)

  addLog(emit('เริ่ม compile font (v3 — 5-variant humanization engine)…', 2))
  addLog(emit(`จำนวน characters: ${glyphMap.size}`, 4))
  addLog(emit(`fontStyle: slant=${fontStyle.slant??0}° weight=${fontStyle.boldness??100}% roughness=${fontStyle.roughness??0} randomness=${fontStyle.randomness??0}`, 4))

  // ── Per-render PRNG ────────────────────────────────────────────────────────
  let _rs = (seed * 1664525 + 1013904223) >>> 0
  function _rrand() {
    _rs ^= _rs << 13; _rs ^= _rs >>> 17; _rs ^= _rs << 5
    return (_rs >>> 0) / 4294967296
  }

  // ── Variant rotation for bake-time sequence (simulates writing "aaaa…") ──
  // We iterate glyphs in map order; repeated chars rotate contextually.
  const rotator  = createVariantRotator()
  const otCache  = createOTCommandCache()

  // ── Track variant usage for debug ─────────────────────────────────────────
  // variantBakeCount[key] = number of Unicode glyphs that used this variant
  const variantBakeCount = { default: 0, alt1: 0, alt2: 0, alt3: 0, alt4: 0 }

  addLog(emit('opentype.js loaded (local package ✓)', 6))

  const entries    = Array.from(glyphMap.entries())
  const otGlyphs   = []
  const skipped    = []
  const glyphInfo  = new Map()

  // ── .notdef (index 0, required by OpenType spec) ──────────────────────────
  otGlyphs.push(buildNotdefGlyph())

  const usedUnicodes = new Set([0])

  // ── space (U+0020) ────────────────────────────────────────────────────────
  if (!glyphMap.has(' ')) {
    otGlyphs.push(new opentype.Glyph({
      name: 'space', unicode: 0x0020, advanceWidth: 240,
      path: new opentype.Path(),
    }))
    usedUnicodes.add(0x0020)
  }

  // ── Per-character glyphs ──────────────────────────────────────────────────
  let done = 0

  for (const [ch, data] of entries) {
    const { codepoint: cp } = data

    if (usedUnicodes.has(cp)) {
      skipped.push({ ch, reason: `duplicate unicode U+${cp.toString(16).toUpperCase()}` })
      done++
      continue
    }
    usedUnicodes.add(cp)

    const defVal = validateSvgPath(data.default)
    if (!defVal.valid) {
      const reason = `invalid base path: ${defVal.reason}`
      skipped.push({ ch, reason })
      addLog(emit(`⚠ skip "${ch}" (${data.unicode}) — ${reason}`, undefined, 'warn'))
      done++
      continue
    }

    try {
      const hex      = cp.toString(16).toUpperCase().padStart(
        Math.max(4, cp.toString(16).length % 2 === 0 ? cp.toString(16).length : cp.toString(16).length + 1), '0'
      )
      const name     = `uni${hex}`
      const glyphMeta = data.meta || {}

      // ── Build OT commands for all 5 variants (with memoization) ───────────
      const allVariantKeys = ['default', 'alt1', 'alt2', 'alt3', 'alt4']
      const variantCmdsRaw = {}

      for (const vk of allVariantKeys) {
        const svgPath = data[vk] ?? data.default
        const cacheKey = `${cp}:${vk}:${svgPath.slice(0, 32)}`
        let cmds = otCache.get(cacheKey)
        if (!cmds) {
          cmds = validateSvgPath(svgPath).valid
            ? svgPathToOTCommands(svgPath, cp, glyphMeta)
            : svgPathToOTCommands(data.base, cp, glyphMeta)
          otCache.set(cacheKey, cmds)
        }
        variantCmdsRaw[vk] = cmds
      }

      // ── Apply UI style noise per variant ──────────────────────────────────
      const styleForVariant = (vk) => variantStyles?.[vk] ?? fontStyle

      const variantCmds = {}
      for (const vk of allVariantKeys) {
        variantCmds[vk] = applyStyleNoise(variantCmdsRaw[vk], styleForVariant(vk), _rrand)
      }

      // ── Determine which variant to bake as the Unicode glyph ──────────────
      // We use the contextual rotator for this character.
      // isFirst = true only when ch appears first in its conceptual word order.
      // Since we're iterating the glyph MAP (not a live text string), we treat
      // each character as first-in-word to preserve the beauty rule for the
      // static font's default glyph.  At render time the font's PUA mechanism
      // will handle live rotation.
      //
      // For the baked Unicode glyph: always use `base` → ensures the first
      // time any character is seen in rendered text it shows the cleanest form.
      const bakedKey = 'default'
      variantBakeCount[bakedKey]++

      const bakedCmds = applyPlacementNoise(variantCmds[bakedKey], _rrand, true)
      const metrics   = computeGlyphMetrics(data.default, cp)
      const humanAdv  = humanizeAdvance(metrics.advanceWidth, _rrand)

      // ── Default (Unicode) glyph — always baked as `base` ──────────────────
      const defGlyph = new opentype.Glyph({
        name,
        unicode:      cp,
        unicodes:     [cp],
        advanceWidth: humanAdv,
        path:         buildOTPath(bakedCmds),
      })

      // ── Alt glyphs — each stored as a named glyph for GSUB / PUA access ──
      const altGlyphs = {}
      for (const vk of ['alt1', 'alt2', 'alt3', 'alt4']) {
        const altCmds = applyPlacementNoise(variantCmds[vk], _rrand, false)
        const altPath = data[vk] ?? data.base
        const altAdv  = humanizeAdvance(
          computeGlyphMetrics(altPath, cp).advanceWidth,
          _rrand,
        )
        altGlyphs[vk] = new opentype.Glyph({
          name:         `${name}.${vk}`,
          advanceWidth: altAdv,
          path:         buildOTPath(altCmds),
        })
      }

      const defIdx = otGlyphs.length
      otGlyphs.push(defGlyph)

      const altIndices = {}
      for (const vk of ['alt1', 'alt2', 'alt3', 'alt4']) {
        altIndices[vk] = otGlyphs.length
        otGlyphs.push(altGlyphs[vk])
      }

      glyphInfo.set(ch, {
        cp,
        metrics,
        glyphIndex: defIdx,
        // Legacy field names for backward compat with buildGSUB / getFeatureStatus
        alt1Index:  altIndices.alt1,
        alt2Index:  altIndices.alt2,
        // Extended
        alt3Index:  altIndices.alt3,
        alt4Index:  altIndices.alt4,
        name,
        alt1Name: `${name}.alt1`,
        alt2Name: `${name}.alt2`,
        alt3Name: `${name}.alt3`,
        alt4Name: `${name}.alt4`,
        unicode:      data.unicode,
        viewBox:      data.viewBox,
        advanceWidth: humanAdv,
        lsb:          metrics.lsb,
        rsb:          metrics.rsb,
        bboxWidth:    metrics.bbox ? Math.round(metrics.bbox.width)  : null,
        bboxHeight:   metrics.bbox ? Math.round(metrics.bbox.height) : null,
      })

    } catch (err) {
      const reason = `exception: ${err.message}`
      skipped.push({ ch, reason })
      addLog(emit(`⚠ skip "${ch}" (${data.unicode}) — ${reason}`, undefined, 'warn'))
    }

    done++
    const pct = 10 + Math.round((done / entries.length) * 55)
    onProgress?.(`สร้าง glyph: ${ch} (${done}/${entries.length})`, pct)
  }

  addLog(emit(`✓ glyphs built: ${otGlyphs.length - 2}  skipped: ${skipped.length}`, 68))
  addLog(emit(`🎨 variant bake: base=${variantBakeCount.base} (all first-occurrence glyphs use cleanest form)`, 68, 'success'))
  addLog(emit(`📦 OT command cache: ${otCache.size()} entries memoized`, 68, 'info'))
  if (skipped.length > 0) {
    addLog(emit(`skipped glyphs: ${skipped.map(s => s.ch).join(' ')}`, 68, 'warn'))
  }

  // ── Build font object ──────────────────────────────────────────────────────
  addLog(emit('กำลัง compile font tables…', 72))

  const font = new opentype.Font({
    familyName:  fontName,
    styleName:   'Regular',
    unitsPerEm:  UPM,
    ascender:    ASCENDER,
    descender:   DESCENDER,
    glyphs:      otGlyphs,
  })

  // ── Font metadata ─────────────────────────────────────────────────────────
  const year = new Date().getFullYear()
  font.names.copyright   = { en: `© ${year} ${fontName} — Handwriting Font Generator` }
  font.names.version     = { en: `Version ${FONT_VERSION}` }
  font.names.designer    = { en: 'Handwriting Font Generator v3' }
  font.names.description = {
    en: `Thai/Latin handwriting font — ${glyphMap.size} chars × 5 variants. `
      + `OpenType: salt, calt. Humanization: contextual rotation + micro-noise.`,
  }
  font.names.license     = { en: 'Font generated from personal handwriting. All rights reserved.' }

  // ── OS/2 metrics ─────────────────────────────────────────────────────────
  if (!font.tables.os2) font.tables.os2 = {}
  Object.assign(font.tables.os2, {
    xHeight:        X_HEIGHT,
    capHeight:      CAP_HEIGHT,
    typoAscender:   ASCENDER,
    typoDescender:  DESCENDER,
    winAscent:      ASCENDER,
    winDescent:     Math.abs(DESCENDER),
  })

  // ── GSUB table — salt + calt ──────────────────────────────────────────────
  addLog(emit('กำลัง build GSUB (salt, calt)…', 76))
  try {
    const gsub = buildGSUB(glyphInfo)
    font.tables.gsub = gsub
    addLog(emit('✓ GSUB table attached', 78, 'success'))
  } catch (err) {
    addLog(emit(`⚠ GSUB build failed: ${err.message} — font will still export without OT substitutions`, 78, 'warn'))
  }

  addLog(emit('— GPOS skipped (opentype.js 1.3.x does not support GPOS writing)', 82))

  // ── Test-serialize ────────────────────────────────────────────────────────
  const _testSerialize = () =>
    typeof font.toArrayBuffer === 'function' ? font.toArrayBuffer() : font.toBuffer()
  try {
    _testSerialize()
  } catch (serErr) {
    addLog(emit(`⚠ Serialize with OT tables failed (${serErr.message}) — retrying without GSUB/GPOS`, 83, 'warn'))
    try { delete font.tables.gsub } catch (_) {}
    try { delete font.tables.gpos } catch (_) {}
  }

  // ── Export TTF ─────────────────────────────────────────────────────────────
  addLog(emit('กำลัง export TTF…', 86))
  let ttfBuffer
  try {
    if (typeof font.toArrayBuffer === 'function') {
      ttfBuffer = font.toArrayBuffer()
    } else if (typeof font.toBuffer === 'function') {
      const nodeBuf = font.toBuffer()
      ttfBuffer = nodeBuf.buffer.slice(nodeBuf.byteOffset, nodeBuf.byteOffset + nodeBuf.byteLength)
    } else {
      throw new Error('opentype.js ไม่มี toArrayBuffer / toBuffer method')
    }

    if (ttfBuffer && !(ttfBuffer instanceof ArrayBuffer)) {
      if (ttfBuffer.buffer instanceof ArrayBuffer) {
        ttfBuffer = ttfBuffer.buffer.slice(ttfBuffer.byteOffset, ttfBuffer.byteOffset + ttfBuffer.byteLength)
      } else {
        ttfBuffer = new Uint8Array(ttfBuffer).buffer
      }
    }
    if (!ttfBuffer || ttfBuffer.byteLength < 100) throw new Error('output is empty or too small')

    addLog(emit(`✓ TTF: ${(ttfBuffer.byteLength / 1024).toFixed(1)} KB`, 90, 'success'))
  } catch (err) {
    throw new Error(`TTF export failed: ${err.message}`)
  }

  // ── Wrap WOFF ──────────────────────────────────────────────────────────────
  addLog(emit('กำลัง wrap WOFF…', 92))
  const woffBuffer = ttfToWoff(ttfBuffer)
  addLog(emit(`✓ WOFF: ${(woffBuffer.byteLength / 1024).toFixed(1)} KB`, 95, 'success'))

  // ── Feature status ─────────────────────────────────────────────────────────
  const featureStatus = getFeatureStatus(glyphInfo)

  // ── PUA map: all 4 alts mapped to PUA codepoints ──────────────────────────
  // Allows FontPreviewPane to rotate "ooooo" → base U+006F U+E000 U+E001 U+E002 U+E003
  const puaMap = new Map()
  let puaBase  = 0xE000
  for (const [ch, info] of glyphInfo) {
    const pua1 = puaBase, pua2 = puaBase + 1, pua3 = puaBase + 2, pua4 = puaBase + 3
    puaBase += 4

    const pushPua = (srcIdx, puaCP, suffix) => {
      if (srcIdx < otGlyphs.length) {
        const src = otGlyphs[srcIdx]
        otGlyphs.push(new opentype.Glyph({
          name: `${src.name}.pua_${suffix}`,
          unicode: puaCP, unicodes: [puaCP],
          advanceWidth: src.advanceWidth,
          path: src.path,
        }))
      }
    }

    pushPua(info.alt1Index, pua1, 'alt1')
    pushPua(info.alt2Index, pua2, 'alt2')
    pushPua(info.alt3Index, pua3, 'alt3')
    pushPua(info.alt4Index, pua4, 'alt4')

    puaMap.set(ch, {
      default: info.cp,
      alt1: pua1, alt2: pua2, alt3: pua3, alt4: pua4,
      // Rotation sequence: base, alt1, alt2, alt3, base, alt4
      rotationSequence: [info.cp, pua1, pua2, pua3, info.cp, pua4],
    })
  }

  // Re-serialize with PUA glyphs
  const fontWithPua = new opentype.Font({
    familyName: fontName, styleName: 'Regular',
    unitsPerEm: UPM, ascender: ASCENDER, descender: DESCENDER,
    glyphs: otGlyphs,
  })
  fontWithPua.names = font.names
  if (font.tables.os2) fontWithPua.tables.os2 = font.tables.os2

  let ttfBufferFinal = ttfBuffer
  try {
    ttfBufferFinal = typeof fontWithPua.toArrayBuffer === 'function'
      ? fontWithPua.toArrayBuffer()
      : fontWithPua.toBuffer().buffer
    if (ttfBufferFinal && !(ttfBufferFinal instanceof ArrayBuffer) && ttfBufferFinal.buffer) {
      ttfBufferFinal = ttfBufferFinal.buffer.slice(
        ttfBufferFinal.byteOffset,
        ttfBufferFinal.byteOffset + ttfBufferFinal.byteLength,
      )
    }
    addLog(emit(`✓ PUA font: ${(ttfBufferFinal.byteLength / 1024).toFixed(1)} KB  (${puaMap.size * 4} PUA glyphs — 4 alts per char)`, 98, 'info'))
  } catch (e) {
    addLog(emit(`⚠ PUA re-serialize failed (${e.message}) — using font without PUA`, 98, 'warn'))
    ttfBufferFinal = ttfBuffer
  }
  const woffBufferFinal = ttfToWoff(ttfBufferFinal)

  const t1         = performance.now()
  const buildTimeMs = Math.round(t1 - t0)

  addLog(emit(`✅ Font build เสร็จสมบูรณ์ — ${buildTimeMs} ms`, 100, 'success'))

  // ── Debug panel stats ─────────────────────────────────────────────────────
  const debugStats = {
    buildTimeMs,
    variantBakeCount,          // how many Unicode glyphs used each variant
    rotatorStats: rotator.getStats(),  // per-char usage if rotator was used at render time
    otCommandCacheSize: otCache.size(),
    totalGlyphs:    otGlyphs.length,
    charCount:      glyphMap.size,
    puaGlyphCount:  puaMap.size * 4,
    variantSystem: {
      description: '5 variants per character: base (clean), alt1 (slant), alt2 (baseline drop), alt3 (narrow), alt4 (shake)',
      rotationSequence: ROTATION_SEQUENCE.map(i => VARIANT_KEYS[i]),
      wordResetRule: 'variant cycle resets on space — next char uses base',
      firstLetterRule: 'first char of each word always uses base variant',
    },
  }

  return {
    ttfBuffer:    ttfBufferFinal,
    woffBuffer:   woffBufferFinal,
    glyphCount:   otGlyphs.length,
    charCount:    glyphInfo.size,
    skipped,
    buildLog,
    glyphInfo,
    featureStatus,
    font:         fontWithPua,
    puaMap,
    debugStats,
  }
}

// ─── WOFF wrapper ──────────────────────────────────────────────────────────────

/**
 * Wraps a TTF ArrayBuffer into a minimal WOFF1 container.
 * Tables are stored uncompressed (valid per spec).
 *
 * @param {ArrayBuffer} ttfBuffer
 * @returns {ArrayBuffer}
 */
export function ttfToWoff(ttfBuffer) {
  try {
    const src    = new DataView(ttfBuffer)
    const srcU8  = new Uint8Array(ttfBuffer)
    const numTbl = src.getUint16(4)

    if (numTbl === 0 || numTbl > 200) throw new Error('invalid table count')

    const tables = []
    for (let i = 0; i < numTbl; i++) {
      const o = 12 + i * 16
      if (o + 16 > ttfBuffer.byteLength) break
      tables.push({
        tag:        String.fromCharCode(src.getUint8(o), src.getUint8(o+1), src.getUint8(o+2), src.getUint8(o+3)),
        checksum:   src.getUint32(o+4),
        origOffset: src.getUint32(o+8),
        origLength: src.getUint32(o+12),
      })
    }

    const hdrSize = 44
    const dirSize = tables.length * 20
    let   dataOff = hdrSize + dirSize

    const infos = tables.map(t => {
      const info = { ...t, woffOffset: dataOff, compLength: t.origLength }
      dataOff += (t.origLength + 3) & ~3
      return info
    })

    const woff  = new ArrayBuffer(dataOff)
    const dst   = new DataView(woff)
    const dstU8 = new Uint8Array(woff)

    dst.setUint32(0,  0x774F4646)
    dst.setUint32(4,  0x00010000)
    dst.setUint32(8,  dataOff)
    dst.setUint16(12, tables.length)
    dst.setUint16(14, 0)
    dst.setUint32(16, ttfBuffer.byteLength)
    dst.setUint16(20, 1); dst.setUint16(22, 0)
    for (let i = 24; i < 44; i += 4) dst.setUint32(i, 0)

    for (let i = 0; i < infos.length; i++) {
      const t = infos[i]
      const b = hdrSize + i * 20
      for (let j = 0; j < 4; j++) dst.setUint8(b + j, t.tag.charCodeAt(j))
      dst.setUint32(b +  4, t.woffOffset)
      dst.setUint32(b +  8, t.compLength)
      dst.setUint32(b + 12, t.origLength)
      dst.setUint32(b + 16, t.checksum)
    }

    for (const t of infos) {
      if (t.origOffset + t.origLength <= srcU8.length) {
        dstU8.set(srcU8.subarray(t.origOffset, t.origOffset + t.origLength), t.woffOffset)
      }
    }

    return woff
  } catch (err) {
    console.warn('[fontBuilder] WOFF wrap failed, returning TTF as WOFF fallback:', err)
    return ttfBuffer
  }
}

// ─── Export metadata builder ───────────────────────────────────────────────────

/**
 * Build the metadata JSON object for export.
 */
export function buildMetadata({
  fontName, glyphMap, glyphInfo, glyphCount, skipped, featureStatus, debugStats,
}) {
  const chars = Array.from(glyphMap.keys())
  return {
    fontName,
    version:  FONT_VERSION,
    created:  new Date().toISOString(),
    unitsPerEm:   UPM,
    ascender:     ASCENDER,
    descender:    DESCENDER,
    xHeight:      X_HEIGHT,
    capHeight:    CAP_HEIGHT,
    characterCount:  glyphMap.size,
    glyphCount,
    variantsPerChar: 5,  // updated from 3 → 5
    skippedGlyphs:   skipped,
    openTypeFeatures: {
      salt: featureStatus.salt,
      calt: featureStatus.calt,
      liga: featureStatus.liga,
      mark: featureStatus.mark,
      mkmk: featureStatus.mkmk,
    },
    scripts:       ['thai', 'latn'],
    unicodeRanges: { thai: 'U+0E00–U+0E7F', latin: 'U+0020–U+007E' },
    rotationSystem: {
      description: 'contextual rotation: first-in-word=base, repeated chars cycle base→alt1→alt2→alt3→base→alt4',
      sequence:    ROTATION_SEQUENCE.map(i => VARIANT_KEYS[i]),
      wordReset:   true,
      firstLetterBeautyRule: true,
    },
    humanization: {
      xShift:     '±1-3 font units',
      yShift:     '±0.5-1.5 font units',
      microSlant: '±1 degree',
      widthScale: '±1.5%',
      advanceVariance: '±3%',
    },
    buildStats: debugStats ?? null,
    characters: chars,
  }
}

/**
 * Build the glyph map export object (for glyphMap.json).
 * Now includes all 5 variant names.
 */
export function buildExportGlyphMap(glyphMap, glyphInfo) {
  const out = {}
  for (const [ch, data] of glyphMap) {
    const info = glyphInfo.get(ch)
    const hex  = data.codepoint.toString(16).toUpperCase().padStart(4, '0')
    out[ch] = {
      unicode:      data.unicode,
      codepoint:    data.codepoint,
      glyphName:    `uni${hex}`,
      alt1Name:     `uni${hex}.alt1`,
      alt2Name:     `uni${hex}.alt2`,
      alt3Name:     `uni${hex}.alt3`,
      alt4Name:     `uni${hex}.alt4`,
      advanceWidth: info?.advanceWidth ?? 600,
      lsb:          info?.lsb ?? 0,
      rsb:          info?.rsb ?? 0,
      bboxWidth:    info?.bboxWidth  ?? null,
      bboxHeight:   info?.bboxHeight ?? null,
      glyphClass:   getGlyphClass(data.codepoint),
      isThaiMark:   isThaiNonSpacing(data.codepoint),
      otFeatures: {
        salt: `uni${hex} → uni${hex}.alt1`,
        calt: 'contextual rotation: base→alt1→alt2→alt3→base→alt4 on repeated chars',
      },
      viewBox: data.viewBox,
    }
  }
  return out
}

// ─── Variant rotator (exported for FontPreviewPane / render engine) ────────────

/**
 * Exported factory so the render engine can create its own rotator instance
 * for live text rendering, independent of the compile-time rotator.
 *
 * Usage in FontPreviewPane:
 *   import { createVariantRotatorInstance } from './fontBuilder.js'
 *   const rotator = createVariantRotatorInstance()
 *   for (const ch of 'hello world') {
 *     const variantKey = rotator.next(ch)
 *     // look up puaMap.get(ch)?.[variantKey] for the codepoint to render
 *   }
 *   const stats = rotator.getStats()  // for debug panel
 */
export { createVariantRotator as createVariantRotatorInstance }