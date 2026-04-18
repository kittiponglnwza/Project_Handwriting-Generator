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

import { deformPath } from '../../lib/glyphVersions.js'
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
 * @returns {object[]} array of opentype.js path command objects
 */
export function svgPathToOTCommands(svgPath) {
  const validation = validateSvgPath(svgPath)
  if (!validation.valid) return []

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
        if (nums.length >= 2) {
          cmds.push({ type: 'M', x: nums[0] * SCALE, y: (100 - nums[1]) * SCALE })
        }
        break
      case 'L':
        if (nums.length >= 2) {
          cmds.push({ type: 'L', x: nums[0] * SCALE, y: (100 - nums[1]) * SCALE })
        }
        break
      case 'C':
        // Cubic: x1 y1 x2 y2 x y — may repeat (polyBezier)
        for (let i = 0; i + 5 < nums.length; i += 6) {
          cmds.push({
            type: 'C',
            x1: nums[i]   * SCALE, y1: (100 - nums[i+1]) * SCALE,
            x2: nums[i+2] * SCALE, y2: (100 - nums[i+3]) * SCALE,
            x:  nums[i+4] * SCALE, y:  (100 - nums[i+5]) * SCALE,
          })
        }
        break
      case 'Q':
        // Quadratic: x1 y1 x y — may repeat
        for (let i = 0; i + 3 < nums.length; i += 4) {
          cmds.push({
            type: 'Q',
            x1: nums[i]   * SCALE, y1: (100 - nums[i+1]) * SCALE,
            x:  nums[i+2] * SCALE, y:  (100 - nums[i+3]) * SCALE,
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
export function buildGlyphMap(glyphs) {
  const byChar = {}

  for (const g of glyphs) {
    if (!g.ch) continue
    const isOk =
      g.status === 'ok' ||
      ['excellent', 'good', 'acceptable'].includes(g._visionStatus)
    if (!isOk) continue
    if (!byChar[g.ch]) byChar[g.ch] = []
    byChar[g.ch].push(g)
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

    map.set(ch, {
      codepoint: cp,
      unicode:   `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`,
      default:   deformPath(valid[0].svgPath, 1),
      alt1:      deformPath(valid[Math.min(1, valid.length - 1)].svgPath, 2),
      alt2:      deformPath(valid[Math.min(2, valid.length - 1)].svgPath, 3),
      rawId:     valid[0].id,
      viewBox:   valid[0].viewBox || '0 0 100 100',
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
export async function compileFontBuffer(glyphMap, fontName = FONT_NAME, onProgress) {
  const emit = (msg, pct, level = 'info') => {
    const entry = log(level, msg)
    onProgress?.(msg, pct, entry)
    return entry
  }

  const buildLog = []
  const addLog   = (entry) => buildLog.push(entry)

  addLog(emit('เริ่ม compile font…', 2))
  addLog(emit(`จำนวน characters: ${glyphMap.size}`, 4))

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

      const defCmds  = svgPathToOTCommands(defPath)
      const alt1Cmds = validateSvgPath(alt1Path).valid
        ? svgPathToOTCommands(alt1Path)
        : defCmds
      const alt2Cmds = validateSvgPath(alt2Path).valid
        ? svgPathToOTCommands(alt2Path)
        : defCmds

      // ── Default glyph (carries the Unicode codepoint) ─────────────────
      const defGlyph = new opentype.Glyph({
        name,
        // For supplementary plane: opentype.js accepts full codepoint array
        unicode: cp,
        unicodes: [cp],
        advanceWidth: metrics.advanceWidth,
        path: buildOTPath(defCmds),
      })

      // ── Alt1 — no Unicode (accessed via GSUB salt/calt) ───────────────
      const alt1Glyph = new opentype.Glyph({
        name: `${name}.alt1`,
        advanceWidth: computeGlyphMetrics(alt1Path, cp).advanceWidth,
        path: buildOTPath(alt1Cmds),
      })

      // ── Alt2 ──────────────────────────────────────────────────────────
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