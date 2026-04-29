/**
 * StrokeRepair.js — Smart broken-stroke detection and auto-repair (P3.1)
 *
 * Algorithm:
 *   1. Parse SVG path commands into segments (M/L/C/Z)
 *   2. Find gaps > threshold px between sub-path endpoints
 *   3. Auto-connect with a smooth cubic bezier
 *   4. Return repaired path + diagnostic metadata
 *
 * Usage:
 *   import { repairBrokenStrokes } from './StrokeRepair'
 *   const { path, repaired, gapsFixed } = repairBrokenStrokes(svgPath)
 */

// ─── Path parser ──────────────────────────────────────────────────────────────

/**
 * Parse an SVG path string into an array of command objects.
 * Handles M, L, C, Q, Z (absolute, uppercase only after normalization).
 *
 * @param {string} d - SVG path data string
 * @returns {Array<{cmd: string, args: number[]}>}
 */
function parsePath(d) {
  if (!d) return []
  const commands = []
  // Normalize: insert spaces around command letters
  const normalized = d
    .trim()
    .replace(/([MLCQZmlcqz])/g, ' $1 ')
    .replace(/,/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  const tokens = normalized.split(' ')
  let i = 0
  let currentCmd = null

  while (i < tokens.length) {
    const t = tokens[i]
    if (/^[MLCQZmlcqz]$/.test(t)) {
      currentCmd = t.toUpperCase()
      i++
      continue
    }

    // Parse numeric arguments based on command
    const argCount = { M: 2, L: 2, C: 6, Q: 4, Z: 0 }[currentCmd] ?? 2
    if (currentCmd === 'Z') {
      commands.push({ cmd: 'Z', args: [] })
      i++
      continue
    }

    const args = []
    for (let j = 0; j < argCount && i < tokens.length; j++) {
      const n = parseFloat(tokens[i])
      if (!isNaN(n)) { args.push(n); i++ }
      else break
    }

    if (args.length === argCount) {
      commands.push({ cmd: currentCmd, args })
    }
  }

  return commands
}

/**
 * Serialize command objects back to an SVG path string.
 */
function serializePath(commands) {
  return commands
    .map(({ cmd, args }) => `${cmd}${args.map(n => Math.round(n * 100) / 100).join(' ')}`)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// ─── Gap detection ────────────────────────────────────────────────────────────

/**
 * Extract sub-path segments: each sub-path starts with M and ends before the next M or Z.
 * Returns array of { startX, startY, endX, endY, commands[] }.
 */
function extractSubPaths(commands) {
  const subPaths = []
  let current = null

  for (const cmd of commands) {
    if (cmd.cmd === 'M') {
      if (current) subPaths.push(current)
      current = {
        startX: cmd.args[0],
        startY: cmd.args[1],
        endX:   cmd.args[0],
        endY:   cmd.args[1],
        commands: [cmd],
      }
    } else if (cmd.cmd === 'Z') {
      if (current) {
        current.commands.push(cmd)
        current.endX = current.startX
        current.endY = current.startY
        subPaths.push(current)
        current = null
      }
    } else if (current) {
      current.commands.push(cmd)
      // Update endpoint based on last coordinate pair
      const args = cmd.args
      if (args.length >= 2) {
        current.endX = args[args.length - 2]
        current.endY = args[args.length - 1]
      }
    }
  }

  if (current) subPaths.push(current)
  return subPaths
}

/**
 * Euclidean distance between two points.
 */
function dist(x1, y1, x2, y2) {
  return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2)
}

// ─── Bezier connector ─────────────────────────────────────────────────────────

/**
 * Build a smooth cubic bezier from point A to point B.
 * Control points are pulled inward 1/3 of the distance for a natural curve.
 */
function smoothConnect(ax, ay, bx, by) {
  const dx = bx - ax
  const dy = by - ay
  const cp1x = ax + dx * 0.33
  const cp1y = ay + dy * 0.33
  const cp2x = ax + dx * 0.67
  const cp2y = ay + dy * 0.67
  return { cmd: 'C', args: [cp1x, cp1y, cp2x, cp2y, bx, by] }
}

// ─── Main repair function ─────────────────────────────────────────────────────

/**
 * Detect and repair broken strokes in an SVG path.
 *
 * @param {string}  svgPath   - input SVG path data (d attribute)
 * @param {number}  threshold - max gap in px to auto-repair (default 5)
 * @param {object}  opts
 * @param {boolean} opts.useBezier - use smooth bezier instead of straight line (default true)
 *
 * @returns {{
 *   path: string,       // repaired SVG path
 *   repaired: boolean,  // true if any gaps were fixed
 *   gapsFixed: number,  // number of gaps closed
 *   gapsFound: number,  // total gaps detected (including those too large to fix)
 * }}
 */
export function repairBrokenStrokes(svgPath, threshold = 5, opts = {}) {
  const { useBezier = true } = opts

  if (!svgPath) {
    return { path: svgPath, repaired: false, gapsFixed: 0, gapsFound: 0 }
  }

  const commands  = parsePath(svgPath)
  const subPaths  = extractSubPaths(commands)

  if (subPaths.length <= 1) {
    return { path: svgPath, repaired: false, gapsFixed: 0, gapsFound: 0 }
  }

  let gapsFound = 0
  let gapsFixed = 0
  const outputCommands = []

  for (let i = 0; i < subPaths.length; i++) {
    const sp = subPaths[i]

    // Add this sub-path's commands
    outputCommands.push(...sp.commands)

    if (i < subPaths.length - 1) {
      const next = subPaths[i + 1]
      const gap  = dist(sp.endX, sp.endY, next.startX, next.startY)

      if (gap > 0) {
        gapsFound++
        if (gap <= threshold) {
          // Connect with bezier or line
          if (useBezier && gap > 1) {
            outputCommands.push(smoothConnect(sp.endX, sp.endY, next.startX, next.startY))
          } else {
            outputCommands.push({ cmd: 'L', args: [next.startX, next.startY] })
          }
          gapsFixed++
          // Skip the M command at the start of next sub-path (we already connected)
          // by removing M from next.commands — rewrite next sub-path without opening M
          subPaths[i + 1] = {
            ...next,
            commands: next.commands.slice(1), // remove M
          }
        }
      }
    }
  }

  const repairedPath = serializePath(outputCommands)
  return {
    path:      repairedPath,
    repaired:  gapsFixed > 0,
    gapsFixed,
    gapsFound,
  }
}

// ─── Batch repair ─────────────────────────────────────────────────────────────

/**
 * Repair all glyphs in a glyph array.
 *
 * @param {Array<{svgPath: string, [key: string]: any}>} glyphs
 * @param {number} threshold
 * @returns {{ glyphs: Array, stats: { repaired: number, totalGapsFixed: number } }}
 */
export function repairAllGlyphs(glyphs, threshold = 5) {
  let repairedCount   = 0
  let totalGapsFixed  = 0

  const repairedGlyphs = glyphs.map(glyph => {
    const pathKey = glyph.svgPath !== undefined ? 'svgPath' : 'path'
    const original = glyph[pathKey]
    if (!original) return glyph

    const result = repairBrokenStrokes(original, threshold)
    if (result.repaired) {
      repairedCount++
      totalGapsFixed += result.gapsFixed
    }

    return {
      ...glyph,
      [pathKey]: result.path,
      _strokeRepair: {
        repaired:   result.repaired,
        gapsFixed:  result.gapsFixed,
        gapsFound:  result.gapsFound,
      },
    }
  })

  return {
    glyphs: repairedGlyphs,
    stats: { repaired: repairedCount, totalGapsFixed },
  }
}
