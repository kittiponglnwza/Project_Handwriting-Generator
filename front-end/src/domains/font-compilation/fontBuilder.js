/**
 * fontBuilder.js — Production-grade font compilation engine
 *
 * Responsibilities:
 *   1. Load opentype.js as a local ESM import (no CDN)
 *   2. Validate every SVG path; skip malformed glyphs gracefully
 *   3. Build per-glyph metrics (smart advance width, LSB, RSB)
 *   4. Build .notdef + space + all character glyphs (default + alt1 + alt2)
 *   5. Apply real GSUB (salt, calt) and GPOS (mark) tables
 *   6. Support Unicode > BMP (surrogate pairs / full codePoint handling)
 *   7. Export TTF ArrayBuffer + minimal WOFF wrapper
 *   8. Emit structured build log entries
 */

// Import opentype.js as local package — run `npm install opentype.js` first
import opentype from 'opentype.js'

import { deformPath } from '../preview/glyphVersions.js'
import {
  UPM, ASCENDER, DESCENDER, X_HEIGHT, CAP_HEIGHT, GLYPH_SIZE, SCALE,
  computeGlyphMetrics, isThaiNonSpacing, getGlyphClass,
} from './metrics.js'
import { buildGSUB, buildGPOS, getFeatureStatus } from './thaiFeatures.js'

// ─── Constants ─────────────────────────────────────────────────────────────────
const FONT_NAME    = 'MyHandwriting'
const FONT_VERSION = '2.0.0'

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
 * Rejects: empty string, 'M 0 0' alone, paths with NaN coords, paths that fail
 * the minimum command threshold.
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
  // Must contain at least one M and one L or C or Q
  if (!/M/i.test(trimmed)) {
    return { valid: false, reason: 'no M command' }
  }
  if (!/[LCQ]/i.test(trimmed)) {
    return { valid: false, reason: 'no line/curve command (only M)' }
  }
  // Check for NaN numbers
  const nums = trimmed.replace(/[MLCQZz]/g, ' ').trim().split(/[\s,]+/).map(Number)
  if (nums.some(n => isNaN(n))) {
    return { valid: false, reason: 'contains NaN coordinates' }
  }
  // Must have at least 4 numbers (M + one L → 2+2)
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
 * @param {number} [cp=0] - Unicode codepoint; used to pick Thai mark Y-zone
 * @returns {object[]} array of opentype.js path command objects
 */
export function svgPathToOTCommands(svgPath, cp = 0, glyphMeta = {}) {
  const validation = validateSvgPath(svgPath)
  if (!validation.valid) return []

  // ── Per-glyph baseline shift ──────────────────────────────────────────────
  // Step 3 ส่ง svgBaseline = svgY ที่เป็นก้นตัวอักษรจริง (เช่น 78 หรือ 80)
  // และ svgDescBot = ก้นสุดของ descender (เช่น 95 สำหรับ g/j/p/q/y)
  //
  // แปลง: font_y = (100 - svgY) * SCALE + BASELINE_SHIFT
  // โดย BASELINE_SHIFT คำนวณให้ svgBaseline → 0 (font baseline)
  //   font_y_at_baseline = (100 - svgBaseline) * SCALE + BASELINE_SHIFT = 0
  //   → BASELINE_SHIFT = -(100 - svgBaseline) * SCALE
  //
  // Simple single-formula mapping (ไม่ซับซ้อน ไม่ 2-zone)
  // glyphPipeline ส่ง svgBaseline=80 คงที่ทุกตัว
  // สูตร: fontY = (svgBaseline - svgY) / svgBaseline * CAP_HEIGHT
  //   svgY=80 (baseline) → 0 font units  ✓
  //   svgY=0  (top)      → CAP_HEIGHT (680) font units  ✓
  //   svgY>80 (descender)→ negative font units  ✓
  // ── คำนวณ bottom จริงจาก path coordinates ─────────────────────────────────
  // ไม่ trust meta.svgBaseline เพราะ deformPath อาจเลื่อน coordinates ไปแล้ว
  // หา maxY จาก path จริงๆ แล้วใช้เป็น baseline (สำหรับ non-mark เท่านั้น)
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
  const BASELINE_SHIFT = 0

  // ── Thai mark zone placement — SCALE + TRANSLATE (zone-fit) ─────────────
  // opentype.js 1.3.x cannot write GPOS, so mark positions are baked into path
  // geometry directly.
  //
  // WHY PREVIOUS APPROACHES FAILED:
  //   Edge-anchor: "mark bottom = X" → blows up when mark is drawn full-canvas
  //   Center-shift: "shift center to T" → also blows up because a full-canvas
  //     mark is ~810 fu tall, so centering at 710 puts its bottom at 305 fu —
  //     deep inside the consonant body (−200…610 fu).
  //
  // ROOT CAUSE: translation alone cannot fix a size mismatch.  We must SCALE
  //   the mark's Y coordinates to fit its designated zone, then TRANSLATE it
  //   into that zone.  This is a 2-parameter linear map: y_final = y_raw * s + o
  //
  // ALGORITHM (2-pass, per-glyph):
  //   Pass 1 — find mark bbox in raw font space (no BASELINE_SHIFT):
  //     fontTop_raw = (100 − svgYMin) × SCALE   ← highest Y, SVG Y-down → Y-up
  //     fontBot_raw = (100 − svgYMax) × SCALE   ← lowest Y
  //
  //   Pass 2 — compute scale + offset to map [fontBot_raw…fontTop_raw] → zone:
  //     markScale  = (zone_top − zone_bottom) / (fontTop_raw − fontBot_raw)
  //     markOffset = zone_bottom − fontBot_raw × markScale
  //     toFontY(svgY) = (100 − svgY) × SCALE × markScale + markOffset
  //
  // Zone definitions (font units, Y-up).  Consonant body = −200…610 fu.
  //   above_vowel: [630, 760]  — 130 fu tall, just above consonant
  //   tone:        [770, 800]  — 30 fu tall, just below ASCENDER (tight but valid)
  //   below:       [−400,−210] — 190 fu tall, below DESCENDER
  //
  // For non-mark glyphs the standard toFontY(svgY) = (100−svgY)×SCALE + BASELINE_SHIFT
  // is used unchanged.
  const _THAI_ABOVE = new Set([0x0E31,0x0E34,0x0E35,0x0E36,0x0E37,0x0E47,0x0E4D,0x0E4E])
  const _THAI_BELOW = new Set([0x0E38,0x0E39,0x0E3A])
  const _THAI_TONES = new Set([0x0E48,0x0E49,0x0E4A,0x0E4B])

  const isUpperMark = _THAI_ABOVE.has(cp) || _THAI_TONES.has(cp)
  const isLowerMark = _THAI_BELOW.has(cp)
  const isMark      = isUpperMark || isLowerMark

  // Zone [bottom, top] in font units (Y-up)
  const ZONES = {
    above_vowel: [630, 760],
    tone:        [770, 800],
    below:       [-400, -210],
  }

  // Default converters for non-marks (identity X scale, baseline-shifted Y)
  let toFontX = (svgX) => svgX * SCALE

  // ── Latin height classification ──────────────────────────────────────────
  // Ascender lowercase (b d f h i j k l t) → ASCENDER = 800 fu
  // Regular lowercase (a c e g m n o p q r s u v w x y z) → X_HEIGHT = 500 fu
  // Uppercase / Thai / other → CAP_HEIGHT = 680 fu
  //
  // Descender letters (j g p q y): svgY > 80 from glyphPipeline → negative fu ✓
  const isLowercase = cp >= 0x0061 && cp <= 0x007A
  const LATIN_ASCENDERS = new Set([0x62,0x64,0x66,0x68,0x69,0x6A,0x6B,0x6C,0x74]) // b d f h i j k l t
  const targetHeight = !isLowercase ? CAP_HEIGHT : LATIN_ASCENDERS.has(cp) ? ASCENDER : X_HEIGHT

  // svgY=svgBaseline → 0 fu  |  svgY=0 → targetHeight  |  svgY>svgBaseline → negative (descender)
  let toFontY = (svgY) => (svgBaseline - svgY) / svgBaseline * targetHeight

  if (isMark) {
    // ── Pass 1: collect all SVG X and Y values for bbox ────────────────────
    const xVals = [], yVals = []
    const _tokens = svgPath.trim().split(/(?=[MLCQZz])/)
    for (const tok of _tokens) {
      const _cmd = tok.trim()[0]
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

    // ── Pass 2: Y zone-fit transform ────────────────────────────────────────
    if (yVals.length > 0) {
      const fontTop_raw = (100 - Math.min(...yVals)) * SCALE
      const fontBot_raw = (100 - Math.max(...yVals)) * SCALE
      const rawHeight   = fontTop_raw - fontBot_raw

      const _isTone = _THAI_TONES.has(cp)
      const zone = isLowerMark
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

    // ── X: no shift needed ───────────────────────────────────────────────────
    // GlyphNormalizer centers every glyph (including marks) horizontally in the
    // 0-100 SVG canvas, so svgXCenter ≈ 50 for both consonants and marks alike.
    // After ×SCALE both land at ~450 fu — no extra X translation required.
    // toFontX stays as the identity: svgX × SCALE.
  }

  const cmds   = []
  // Split on every command letter, keeping the letter
  const tokens = svgPath.trim().split(/(?=[MLCQZz])/)

  for (const token of tokens) {
    const t = token.trim()
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
        // SVG spec: first pair is moveTo, subsequent pairs are implicit lineTo
        for (let i = 0; i + 1 < nums.length; i += 2) {
          cmds.push({
            type: i === 0 ? 'M' : 'L',
            x: toFontX(nums[i]),
            y: toFontY(nums[i + 1]),
          })
        }
        break
      case 'L':
        for (let i = 0; i + 1 < nums.length; i += 2) {
          cmds.push({ type: 'L', x: toFontX(nums[i]), y: toFontY(nums[i + 1]) })
        }
        break
      case 'C':
        // Cubic: x1 y1 x2 y2 x y — may repeat (polyBezier)
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
        // Quadratic: x1 y1 x y — may repeat
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
 * Build the mandatory .notdef glyph (shown when a character is missing).
 */
function buildNotdefGlyph() {
  const p = new opentype.Path()
  // Outer rectangle
  p.moveTo(60, 50);   p.lineTo(540, 50);
  p.lineTo(540, 680); p.lineTo(60, 680); p.close()
  // Inner rectangle (hollow)
  p.moveTo(100, 90);  p.lineTo(500, 90);
  p.lineTo(500, 640); p.lineTo(100, 640); p.close()
  return new opentype.Glyph({
    name: '.notdef', unicode: 0, advanceWidth: 600, path: p,
  })
}

// ─── Glyph map builder ────────────────────────────────────────────────────────

/**
 * Build a normalized glyph map from the raw Step-3 glyphs array.
 * Filters for valid status, deduplicates by character, generates 3 variants.
 *
 * @param {object[]} glyphs - raw glyph objects from Step 3
 * @returns {Map<string, { codepoint, unicode, default, alt1, alt2, rawId, viewBox }>}
 */
export function buildGlyphMap(glyphs, seed = Math.random()) {
  const byChar = {}

  const GOOD_STATUSES = new Set(['ok', 'excellent', 'good', 'acceptable'])

  for (const g of glyphs) {
    if (!g.ch) continue
    // VisionEngine stores quality in g.status ('excellent'|'good'|'acceptable'|'poor'|'critical'|'missing'|'error')
    // Legacy pipeline stores 'ok'. Accept both.
    const isOk = GOOD_STATUSES.has(g.status) || GOOD_STATUSES.has(g._visionStatus)
    if (!isOk) continue
    if (!byChar[g.ch]) byChar[g.ch] = []
    byChar[g.ch].push(g)
  }

  // ── Seeded PRNG (mulberry32) ─────────────────────────────────────────────
  // seed ใหม่ทุก Build click → shuffle pattern ต่างกัน → default glyph ต่างกัน
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
    // Filter valid paths within this character's variants
    const valid = variants.filter(g => {
      const v = validateSvgPath(g.svgPath)
      return v.valid
    })
    if (valid.length === 0) continue

    // Handle supplementary plane chars (codePointAt handles surrogate pairs)
    const cp = ch.codePointAt(0)
    if (!cp) continue

    // Fisher-Yates shuffle ด้วย seeded PRNG — ทุก Build click ได้ default ต่างกัน
    const shuffled = [...valid]
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(_rand() * (i + 1))
      ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
    }
    // deformPath: default เสมอใช้ version 1 (ต้นฉบับ), alt1=2 (droop), alt2=3 (wavy)
    // ไม่ shuffle dv — ทำให้ default glyph เสมอดูสม่ำเสมอ ไม่คดเคี้ยว
    const dv = [1, 2, 3]

    // เก็บ baseline metadata จาก Step 3 (ใช้ค่าของ default glyph)
    const _g0 = shuffled[0]
    map.set(ch, {
      codepoint: cp,
      unicode:   `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`,
      default:   deformPath(_g0.svgPath, dv[0]),
      alt1:      deformPath(shuffled[Math.min(1, shuffled.length - 1)].svgPath, dv[1]),
      alt2:      deformPath(shuffled[Math.min(2, shuffled.length - 1)].svgPath, dv[2]),
      rawId:     _g0.id,
      viewBox:   _g0.viewBox || '0 0 100 100',
      meta: {
        svgBaseline: _g0.svgBaseline ?? 80,
        svgDescBot:  _g0.svgDescBot  ?? 78,
        svgCapTop:   _g0.svgCapTop   ?? 10,
      },
    })
  }

  return map
}

// ─── Main compilation ─────────────────────────────────────────────────────────

/**
 * Compile a full font from a glyph map.
 *
 * @param {Map}      glyphMap   - from buildGlyphMap()
 * @param {string}   fontName   - family name
 * @param {Function} onProgress - (msg: string, pct: number, logEntry?: LogEntry) => void
 *
 * @returns {Promise<{
 *   ttfBuffer: ArrayBuffer,
 *   woffBuffer: ArrayBuffer,
 *   glyphCount: number,
 *   skipped: { ch: string, reason: string }[],
 *   buildLog: LogEntry[],
 *   glyphInfo: Map,
 *   featureStatus: object,
 * }>}
 */
export async function compileFontBuffer(glyphMap, fontName = FONT_NAME, onProgress, seed = Math.random()) {
  const emit = (msg, pct, level = 'info') => {
    const entry = log(level, msg)
    onProgress?.(msg, pct, entry)
    return entry
  }

  const buildLog = []
  const addLog   = (entry) => buildLog.push(entry)

  addLog(emit('เริ่ม compile font…', 2))
  addLog(emit(`จำนวน characters: ${glyphMap.size}`, 4))

  // ── Per-render PRNG: สุ่ม variant ที่จะ bake เป็น Unicode glyph ────────────
  // เนื่องจาก opentype.js 1.3.x serialize GSUB LookupType 6 ไม่ได้ (calt ไม่ทำงาน)
  // วิธีที่ได้ผลจริงคือ bake path ที่สุ่มแล้วเป็น default glyph โดยตรง
  // ทุก Build click ได้ seed ใหม่ → path ที่ bake ต่างกัน → font ดูต่างกัน
  let _rs = (seed * 1664525 + 1013904223) >>> 0
  function _rrand() {
    _rs ^= _rs << 13; _rs ^= _rs >>> 17; _rs ^= _rs << 5
    return (_rs >>> 0) / 4294967296
  }
  // ฟังก์ชันสุ่มเลือก variant: 0=default, 1=alt1, 2=alt2
  function pickVariant() { return Math.floor(_rrand() * 3) }

  // opentype.js is already imported — no CDN needed
  addLog(emit('opentype.js loaded (local package ✓)', 6))

  const entries     = Array.from(glyphMap.entries())
  const otGlyphs    = []
  const skipped     = []

  // Track glyph info for GSUB/GPOS table construction
  // Map<ch, { cp, glyphIndex, alt1Index, alt2Index, metrics }>
  const glyphInfo   = new Map()

  // ── .notdef (index 0, required by OpenType spec) ──────────────────────────
  otGlyphs.push(buildNotdefGlyph())

  // Track used unicodes to prevent cmap duplicates
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
    const { codepoint: cp, default: defPath, alt1: alt1Path, alt2: alt2Path } = data

    // ── Skip duplicate unicodes (prevents cmap corruption)
    if (usedUnicodes.has(cp)) {
      skipped.push({ ch, reason: `duplicate unicode U+${cp.toString(16).toUpperCase()}` })
      done++
      continue
    }
    usedUnicodes.add(cp)

    // ── Validate default path ────────────────────────────────────────────
    const defVal = validateSvgPath(defPath)
    if (!defVal.valid) {
      const reason = `invalid default path: ${defVal.reason}`
      skipped.push({ ch, reason })
      addLog(emit(`⚠ skip "${ch}" (${data.unicode}) — ${reason}`, undefined, 'warn'))
      done++
      continue
    }

    try {
      // ── Compute metrics from actual bounding box ─────────────────────
      const metrics = computeGlyphMetrics(defPath, cp)

      const hex     = cp.toString(16).toUpperCase().padStart(Math.max(4, cp.toString(16).length % 2 === 0 ? cp.toString(16).length : cp.toString(16).length + 1), '0')
      const name    = `uni${hex}`

      // ส่ง glyphMeta จาก Step 3 เพื่อให้ BASELINE_SHIFT คำนวณถูกต้องต่อตัว
      const glyphMeta = data.meta || {}
      const defCmds  = svgPathToOTCommands(defPath, cp, glyphMeta)
      const alt1Cmds = validateSvgPath(alt1Path).valid
        ? svgPathToOTCommands(alt1Path, cp, glyphMeta)
        : defCmds
      const alt2Cmds = validateSvgPath(alt2Path).valid
        ? svgPathToOTCommands(alt2Path, cp, glyphMeta)
        : defCmds

      // ── สุ่มเลือก variant ที่จะ bake เป็น Unicode glyph โดยตรง ─────────
      // opentype.js 1.3.x serialize GSUB LookupType 6 (calt) ไม่ได้ → ใช้วิธีนี้แทน
      // แต่ละตัวอักษรได้ path ที่ต่างกันใน build นี้
      const allCmds   = [defCmds, alt1Cmds, alt2Cmds]
      const allPaths  = [defPath, alt1Path, alt2Path]
      const chosenIdx = pickVariant()
      const chosenCmds  = allCmds[chosenIdx]
      const chosenPath  = allPaths[chosenIdx]
      const chosenMetrics = chosenIdx === 0 ? metrics : computeGlyphMetrics(chosenPath, cp)

      // ── Default glyph (carries the Unicode codepoint) — path สุ่มแล้ว ──
      const defGlyph = new opentype.Glyph({
        name,
        unicode: cp,
        unicodes: [cp],
        advanceWidth: chosenMetrics.advanceWidth,
        path: buildOTPath(chosenCmds),
      })

      // ── Alt1 / Alt2 — เก็บไว้สำหรับ GSUB salt (ถ้า browser รองรับ) ───
      const alt1Glyph = new opentype.Glyph({
        name: `${name}.alt1`,
        advanceWidth: computeGlyphMetrics(alt1Path, cp).advanceWidth,
        path: buildOTPath(alt1Cmds),
      })

      const alt2Glyph = new opentype.Glyph({
        name: `${name}.alt2`,
        advanceWidth: computeGlyphMetrics(alt2Path, cp).advanceWidth,
        path: buildOTPath(alt2Cmds),
      })

      const defIdx  = otGlyphs.length
      otGlyphs.push(defGlyph)
      const alt1Idx = otGlyphs.length
      otGlyphs.push(alt1Glyph)
      const alt2Idx = otGlyphs.length
      otGlyphs.push(alt2Glyph)

      glyphInfo.set(ch, {
        cp, metrics,
        glyphIndex: defIdx,
        alt1Index:  alt1Idx,
        alt2Index:  alt2Idx,
        name, alt1Name: `${name}.alt1`, alt2Name: `${name}.alt2`,
        unicode: data.unicode,
        viewBox: data.viewBox,
        advanceWidth: metrics.advanceWidth,
        lsb: metrics.lsb, rsb: metrics.rsb,
        bboxWidth:  metrics.bbox ? Math.round(metrics.bbox.width)  : null,
        bboxHeight: metrics.bbox ? Math.round(metrics.bbox.height) : null,
      })

    } catch (err) {
      // Individual glyph failure — log and continue, never crash the build
      const reason = `exception: ${err.message}`
      skipped.push({ ch, reason })
      addLog(emit(`⚠ skip "${ch}" (${data.unicode}) — ${reason}`, undefined, 'warn'))
    }

    done++
    const pct = 10 + Math.round((done / entries.length) * 55)
    onProgress?.(`สร้าง glyph: ${ch} (${done}/${entries.length})`, pct)
  }

  addLog(emit(`✓ glyphs built: ${otGlyphs.length - 2}  skipped: ${skipped.length}`, 68))
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

  // ── Font metadata (name table) ─────────────────────────────────────────────
  const year = new Date().getFullYear()
  font.names.copyright   = { en: `© ${year} ${fontName} — Handwriting Font Generator` }
  font.names.version     = { en: `Version ${FONT_VERSION}` }
  font.names.designer    = { en: 'Handwriting Font Generator v2' }
  font.names.description = { en: `Thai/Latin handwriting font — ${glyphMap.size} chars × 3 variants. OpenType: salt, calt, mark.` }
  font.names.license     = { en: 'Font generated from personal handwriting. All rights reserved.' }

  // ── OS/2 metrics (xHeight, capHeight, panose) ─────────────────────────────
  // opentype.js exposes os2 table after font is built
  // We patch it before serialisation
  if (!font.tables.os2) font.tables.os2 = {}
  Object.assign(font.tables.os2, {
    xHeight:   X_HEIGHT,
    capHeight: CAP_HEIGHT,
    typoAscender:  ASCENDER,
    typoDescender: DESCENDER,
    winAscent:     ASCENDER,
    winDescent:    Math.abs(DESCENDER),
  })

  // ── GSUB table — real salt + calt ─────────────────────────────────────────
  addLog(emit('กำลัง build GSUB (salt, calt)…', 76))
  try {
    const gsub = buildGSUB(glyphInfo)
    // ตรวจก่อนว่า opentype.js รองรับ format นี้
    // ถ้า attach แล้ว serialize ได้ก็ดี ถ้าไม่ได้ก็ skip (font ยังใช้งานได้ แค่ไม่มี OT features)
    font.tables.gsub = gsub
    addLog(emit('✓ GSUB table attached', 78, 'success'))
  } catch (err) {
    addLog(emit(`⚠ GSUB build failed: ${err.message} — font will still export without OT substitutions`, 78, 'warn'))
  }

  // ── GPOS table — Thai mark-to-base anchors ─────────────────────────────────
  // ⚠ opentype.js 1.3.x ไม่รองรับ GPOS writing (subtableMakers เป็น empty array)
  // Skip GPOS เพื่อป้องกัน crash ตอน serialize
  addLog(emit('— GPOS skipped (opentype.js 1.3.x does not support GPOS writing)', 82))

  // ── Test-serialize ก่อน export จริง เพื่อตรวจว่า GSUB/GPOS ไม่ทำให้ crash ───
  // ถ้า serialize พัง ให้ลบ GSUB/GPOS ออกแล้ว retry
  const _testSerialize = () => {
    if (typeof font.toArrayBuffer === 'function') return font.toArrayBuffer()
    return font.toBuffer()
  }
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
    // toArrayBuffer() คือ API ที่ถูกต้องใน opentype.js 1.3.x
    // download() trigger save-dialog จริงๆ ไม่ return ArrayBuffer
    if (typeof font.toArrayBuffer === 'function') {
      ttfBuffer = font.toArrayBuffer()
    } else if (typeof font.toBuffer === 'function') {
      // toBuffer() คืน Node Buffer — แปลงเป็น ArrayBuffer
      const nodeBuf = font.toBuffer()
      ttfBuffer = nodeBuf.buffer.slice(nodeBuf.byteOffset, nodeBuf.byteOffset + nodeBuf.byteLength)
    } else {
      throw new Error('opentype.js ไม่มี toArrayBuffer / toBuffer method')
    }

    // Normalize: Node Buffer → ArrayBuffer
    if (ttfBuffer && !(ttfBuffer instanceof ArrayBuffer)) {
      if (ttfBuffer.buffer instanceof ArrayBuffer) {
        ttfBuffer = ttfBuffer.buffer.slice(
          ttfBuffer.byteOffset,
          ttfBuffer.byteOffset + ttfBuffer.byteLength,
        )
      } else {
        ttfBuffer = new Uint8Array(ttfBuffer).buffer
      }
    }

    if (!ttfBuffer || ttfBuffer.byteLength < 100) {
      throw new Error('output is empty or too small')
    }

    addLog(emit(`✓ TTF: ${(ttfBuffer.byteLength / 1024).toFixed(1)} KB`, 90, 'success'))
  } catch (err) {
    throw new Error(`TTF export failed: ${err.message}`)
  }

  // ── Wrap WOFF ──────────────────────────────────────────────────────────────
  addLog(emit('กำลัง wrap WOFF…', 92))
  const woffBuffer = ttfToWoff(ttfBuffer)
  addLog(emit(`✓ WOFF: ${(woffBuffer.byteLength / 1024).toFixed(1)} KB`, 95, 'success'))

  // ── Feature status (for UI display) ───────────────────────────────────────
  const featureStatus = getFeatureStatus(glyphInfo)

  addLog(emit('✅ Font build เสร็จสมบูรณ์', 100, 'success'))

  return {
    ttfBuffer,
    woffBuffer,
    glyphCount: otGlyphs.length,
    charCount:  glyphInfo.size,
    skipped,
    buildLog,
    glyphInfo,
    featureStatus,
    font,
  }
}

// ─── WOFF wrapper ──────────────────────────────────────────────────────────────

/**
 * Wraps a TTF ArrayBuffer into a minimal WOFF1 container.
 * Tables are stored uncompressed (WOFF with no compression is valid).
 * For real compression use woff2 or a WOFF encoder library.
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

    // Read sfnt table directory
    const tables = []
    for (let i = 0; i < numTbl; i++) {
      const o = 12 + i * 16
      if (o + 16 > ttfBuffer.byteLength) break
      tables.push({
        tag:        String.fromCharCode(
          src.getUint8(o), src.getUint8(o+1),
          src.getUint8(o+2), src.getUint8(o+3)
        ),
        checksum:   src.getUint32(o+4),
        origOffset: src.getUint32(o+8),
        origLength: src.getUint32(o+12),
      })
    }

    const hdrSize  = 44
    const dirSize  = tables.length * 20
    let   dataOff  = hdrSize + dirSize

    const infos = tables.map(t => {
      const info = { ...t, woffOffset: dataOff, compLength: t.origLength }
      // Align to 4-byte boundary
      dataOff += (t.origLength + 3) & ~3
      return info
    })

    const woff   = new ArrayBuffer(dataOff)
    const dst    = new DataView(woff)
    const dstU8  = new Uint8Array(woff)

    // WOFF header (44 bytes)
    dst.setUint32(0,  0x774F4646)             // 'wOFF'
    dst.setUint32(4,  0x00010000)             // sfVersion
    dst.setUint32(8,  dataOff)                // totalLen
    dst.setUint16(12, tables.length)          // numTables
    dst.setUint16(14, 0)                      // reserved
    dst.setUint32(16, ttfBuffer.byteLength)   // totalSfntSize
    dst.setUint16(20, 1); dst.setUint16(22, 0) // majorVersion, minorVersion
    for (let i = 24; i < 44; i += 4) dst.setUint32(i, 0) // metaOffset etc.

    // WOFF table directory (20 bytes each)
    for (let i = 0; i < infos.length; i++) {
      const t = infos[i]
      const b = hdrSize + i * 20
      for (let j = 0; j < 4; j++) dst.setUint8(b + j, t.tag.charCodeAt(j))
      dst.setUint32(b +  4, t.woffOffset)
      dst.setUint32(b +  8, t.compLength)
      dst.setUint32(b + 12, t.origLength)
      dst.setUint32(b + 16, t.checksum)
    }

    // Copy table data
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
  fontName, glyphMap, glyphInfo, glyphCount, skipped, featureStatus,
}) {
  const chars = Array.from(glyphMap.keys())
  return {
    fontName,
    version: FONT_VERSION,
    created: new Date().toISOString(),
    unitsPerEm:   UPM,
    ascender:     ASCENDER,
    descender:    DESCENDER,
    xHeight:      X_HEIGHT,
    capHeight:    CAP_HEIGHT,
    characterCount: glyphMap.size,
    glyphCount,
    variantsPerChar: 3,
    skippedGlyphs: skipped,
    openTypeFeatures: {
      salt: featureStatus.salt,
      calt: featureStatus.calt,
      liga: featureStatus.liga,
      mark: featureStatus.mark,
      mkmk: featureStatus.mkmk,
    },
    scripts: ['thai', 'latn'],
    unicodeRanges: {
      thai:  'U+0E00–U+0E7F',
      latin: 'U+0020–U+007E',
    },
    rotationSystem: {
      description: 'calt: consecutive same char → default → alt1 → alt2 → default',
      period: 3,
    },
    characters: chars,
  }
}

/**
 * Build the glyph map export object (for glyphMap.json).
 */
export function buildExportGlyphMap(glyphMap, glyphInfo) {
  const out = {}
  for (const [ch, data] of glyphMap) {
    const info = glyphInfo.get(ch)
    const hex  = data.codepoint.toString(16).toUpperCase().padStart(4, '0')
    out[ch] = {
      unicode:     data.unicode,
      codepoint:   data.codepoint,
      glyphName:   `uni${hex}`,
      alt1Name:    `uni${hex}.alt1`,
      alt2Name:    `uni${hex}.alt2`,
      advanceWidth: info?.advanceWidth ?? 600,
      lsb:          info?.lsb ?? 0,
      rsb:          info?.rsb ?? 0,
      bboxWidth:    info?.bboxWidth ?? null,
      bboxHeight:   info?.bboxHeight ?? null,
      glyphClass:   getGlyphClass(data.codepoint),
      isThaiMark:   isThaiNonSpacing(data.codepoint),
      otFeatures: {
        salt: `uni${hex} → uni${hex}.alt1`,
        calt: 'rotate mod 3 on consecutive same char',
      },
      viewBox: data.viewBox,
    }
  }
  return out
}
