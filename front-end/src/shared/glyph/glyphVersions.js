/**
 * glyphVersions.js — Handwriting Deformation Engine
 *
 * Generates 5 perceptually-distinct but believable path variants per glyph:
 *   base  (version 1) — cleanest original form, used for first occurrence
 *   alt1  (version 2) — tiny rightward slant, like pen angle shifting
 *   alt2  (version 3) — slight baseline drop, pen drifting lower
 *   alt3  (version 4) — narrower / compressed, faster writing speed
 *   alt4  (version 5) — mild shake / looseness, hand tremor at normal speed
 *
 * Design constraints:
 *   - All deformations are SUBTLE. No ugly warping.
 *   - Each variant must read as the same letter — only rhythm differs.
 *   - Transforms operate in the 0-100 SVG coordinate space (Y-down).
 *   - Math is deterministic per (path, version) pair — same input always
 *     yields the same output, enabling stable caching.
 */

// ─── Tiny deterministic hash (for seeding per-path randomness) ─────────────────

/**
 * A lightweight 32-bit hash of an arbitrary string.
 * Used to give each glyph its own reproducible jitter pattern so that
 * 'a' and 'b' don't wobble in synchrony.
 *
 * @param {string} str
 * @returns {number} unsigned 32-bit integer
 */
function hashStr(str) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h
}

/**
 * Seeded PRNG (xorshift32).  Returns a function () => [0, 1).
 *
 * @param {number} seed - unsigned 32-bit integer
 * @returns {() => number}
 */
function makePrng(seed) {
  let s = seed || 1
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return (s >>> 0) / 4294967296
  }
}

// ─── SVG path parser ───────────────────────────────────────────────────────────

/**
 * Parse an SVG path string into an array of command objects.
 * Each object: { cmd: string, nums: number[] }
 *
 * Only absolute commands are expected (M, L, C, Q, Z).
 *
 * @param {string} pathStr
 * @returns {{ cmd: string, nums: number[] }[]}
 */
function parsePath(pathStr) {
  if (!pathStr || typeof pathStr !== 'string') return []
  const tokens = pathStr.trim().split(/(?=[MLCQZz])/)
  const result = []
  for (const tok of tokens) {
    const t = tok.trim()
    if (!t) continue
    const cmd  = t[0]
    const nums = t.slice(1).trim()
      .split(/[\s,]+/)
      .map(Number)
      .filter(n => !isNaN(n) && isFinite(n))
    result.push({ cmd, nums })
  }
  return result
}

/**
 * Serialise a parsed command array back to an SVG path string.
 *
 * @param {{ cmd: string, nums: number[] }[]} cmds
 * @returns {string}
 */
function serializePath(cmds) {
  return cmds.map(({ cmd, nums }) =>
    nums.length > 0
      ? `${cmd}${nums.map(n => +n.toFixed(3)).join(' ')}`
      : cmd
  ).join(' ')
}

// ─── Coordinate-level transforms ──────────────────────────────────────────────

/**
 * Apply a transform function to every (x, y) pair in a parsed command list.
 * The transform fn receives (x, y, pointIndex) and returns [x', y'].
 *
 * @param {{ cmd: string, nums: number[] }[]} cmds
 * @param {(x: number, y: number, i: number) => [number, number]} fn
 * @returns {{ cmd: string, nums: number[] }[]}
 */
function transformCoords(cmds, fn) {
  let pi = 0  // global point counter for smooth progressive deformations
  return cmds.map(({ cmd, nums }) => {
    if (cmd === 'Z' || cmd === 'z' || nums.length === 0) return { cmd, nums }
    const newNums = [...nums]

    // Determine stride (how many numbers form one point-pair)
    // M / L: stride 2   |   Q: stride 2 for cp, 2 for anchor = 4 total
    // C: stride 2+2+2=6 |   Z: no nums
    let stride = 2
    if (cmd === 'C') stride = 6
    else if (cmd === 'Q') stride = 4

    for (let i = 0; i + stride <= newNums.length; i += stride) {
      if (cmd === 'C') {
        // control1 (i, i+1), control2 (i+2, i+3), anchor (i+4, i+5)
        const [cx1, cy1] = fn(newNums[i],   newNums[i+1], pi)
        const [cx2, cy2] = fn(newNums[i+2], newNums[i+3], pi)
        const [ax,  ay]  = fn(newNums[i+4], newNums[i+5], pi)
        newNums[i]   = cx1; newNums[i+1] = cy1
        newNums[i+2] = cx2; newNums[i+3] = cy2
        newNums[i+4] = ax;  newNums[i+5] = ay
      } else if (cmd === 'Q') {
        // control (i, i+1), anchor (i+2, i+3)
        const [cx, cy] = fn(newNums[i],   newNums[i+1], pi)
        const [ax, ay] = fn(newNums[i+2], newNums[i+3], pi)
        newNums[i]   = cx; newNums[i+1] = cy
        newNums[i+2] = ax; newNums[i+3] = ay
      } else {
        // M or L: single (x, y) pair
        const [nx, ny] = fn(newNums[i], newNums[i+1], pi)
        newNums[i]   = nx
        newNums[i+1] = ny
      }
      pi++
    }
    return { cmd, nums: newNums }
  })
}

// ─── Variant deformation profiles ─────────────────────────────────────────────

/**
 * version 1 — base (cleanest form)
 * Identity transform with imperceptible micro-jitter (< ±0.4 units) so each
 * glyph still has a slightly unique texture from its siblings.
 */
function applyBase(cmds, _rng) {
  // Base = original path untouched — no transform, no noise.
  // This is the cleanest/prettiest form, used for first occurrence of each word.
  return cmds
}

/**
 * version 2 — alt1 (tiny rightward slant)
 * Simulates pen nib angle tilting ~1.5° rightward.
 * Shear is Y-down: x' = x + shear * (y - baseline)
 * We use baseline ≈ 80 (the SVG baseline in 0-100 space).
 */
function applyAlt1(cmds, rng) {
  const BASELINE = 80
  const SHEAR    = 0.022   // tan(~1.3°) — very subtle
  return transformCoords(cmds, (x, y) => [
    x + SHEAR * (y - BASELINE) + (rng() - 0.5) * 0.5,
    y + (rng() - 0.5) * 0.4,
  ])
}

/**
 * version 3 — alt2 (slight baseline drop + looser curves)
 * The pen drops 1.5 units below the expected baseline — like writing
 * casually without ruled lines. Control points get a tiny loosening nudge.
 */
function applyAlt2(cmds, rng) {
  const DROP = 1.5  // SVG units downward
  return transformCoords(cmds, (x, y, i) => {
    // Progressive drop: later strokes settle slightly lower (natural fatigue arc)
    const progressiveDrop = DROP + (i % 6) * 0.08
    return [
      x + (rng() - 0.5) * 0.6,
      y + progressiveDrop + (rng() - 0.5) * 0.5,
    ]
  })
}

/**
 * version 4 — alt3 (narrower / faster writing)
 * Width compressed ~5%, like the writer sped up and letters got tighter.
 * Centroid-anchored so the glyph stays in place horizontally.
 */
function applyAlt3(cmds, rng) {
  // Compute centroid X across all anchor points for stable compression
  let sumX = 0, count = 0
  for (const { cmd, nums } of cmds) {
    if (cmd === 'Z' || !nums.length) continue
    const stride = cmd === 'C' ? 6 : cmd === 'Q' ? 4 : 2
    for (let i = 0; i + stride <= nums.length; i += stride) {
      // Anchor X is always at stride-2 offset
      sumX += nums[i + stride - 2]
      count++
    }
  }
  const cx    = count > 0 ? sumX / count : 50
  const SCALE = 0.95  // 5% narrower

  return transformCoords(cmds, (x, y) => [
    cx + (x - cx) * SCALE + (rng() - 0.5) * 0.5,
    y  + (rng() - 0.5) * 0.4,
  ])
}

/**
 * version 5 — alt4 (mild shake / pressure variation)
 * Adds a smooth low-frequency wobble that mimics hand tremor at writing
 * speed. Uses a sinusoidal wave so the shake looks organic, not jagged.
 * Amplitude is kept very small (≤ 1.2 units) to avoid ugly distortion.
 */
function applyAlt4(cmds, rng) {
  const AMP_X  = 0.9   // horizontal wobble amplitude (SVG units)
  const AMP_Y  = 0.7   // vertical wobble amplitude
  const FREQ   = 0.45  // cycles per point (lower = smoother wave)
  const PHASE  = rng() * Math.PI * 2  // random phase per glyph

  return transformCoords(cmds, (x, y, i) => {
    const wave  = Math.sin(i * FREQ * Math.PI * 2 + PHASE)
    const wave2 = Math.sin(i * FREQ * Math.PI * 1.3 + PHASE + 1.1)
    return [
      x + wave  * AMP_X + (rng() - 0.5) * 0.5,
      y + wave2 * AMP_Y + (rng() - 0.5) * 0.5,
    ]
  })
}

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Apply a deformation profile to an SVG path string.
 *
 * @param {string} svgPath  - Input path in 0-100 SVG space
 * @param {1|2|3|4|5} version
 *   1 = base (cleanest)
 *   2 = alt1 (slant)
 *   3 = alt2 (baseline drop)
 *   4 = alt3 (narrow/faster)
 *   5 = alt4 (shake)
 * @returns {string} Transformed SVG path string
 */
export function deformPath(svgPath, version = 1) {
  if (!svgPath || typeof svgPath !== 'string') return svgPath

  // version 1 = base: return original path verbatim.
  // Bypasses parse/serialize so validateSvgPath always passes downstream.
  if (version === 1) return svgPath

  const cmds = parsePath(svgPath)
  if (cmds.length === 0) return svgPath

  const seed = hashStr(svgPath.slice(0, 64) + version)
  const rng  = makePrng(seed)

  let transformed
  switch (version) {
    case 2:  transformed = applyAlt1(cmds, rng);  break
    case 3:  transformed = applyAlt2(cmds, rng);  break
    case 4:  transformed = applyAlt3(cmds, rng);  break
    case 5:  transformed = applyAlt4(cmds, rng);  break
    default: transformed = applyAlt1(cmds, rng);  break
  }

  return serializePath(transformed)
}

/**
 * Convenience: generate all 5 variants at once.
 * Returns an object with keys: base, alt1, alt2, alt3, alt4.
 *
 * @param {string} svgPath
 * @returns {{ base: string, alt1: string, alt2: string, alt3: string, alt4: string }}
 */
export function deformAll(svgPath) {
  return {
    default: deformPath(svgPath, 1),  // key matches DnaStep.jsx VARIANT_KEYS
    alt1: deformPath(svgPath, 2),
    alt2: deformPath(svgPath, 3),
    alt3: deformPath(svgPath, 4),
    alt4: deformPath(svgPath, 5),
  }
}

// ─── Backward-compatible export ───────────────────────────────────────────────

/**
 * Legacy API — preserved so existing imports don't break.
 * Generates 3 versioned entries per glyph (version 1/2/3 = base/alt1/alt2).
 * New code should use deformAll() or deformPath() directly.
 *
 * @param {object[]} extractedGlyphs
 * @returns {object[]}
 */
export function buildVersionedGlyphs(extractedGlyphs) {
  const result = []
  for (const g of extractedGlyphs) {
    const hasSvg =
      typeof g.svgPath === 'string' &&
      g.svgPath.trim() !== '' &&
      g.svgPath.trim() !== 'M 0 0'

    for (const ver of [1, 2, 3]) {
      result.push({
        ...g,
        id:      `${g.id}-v${ver}`,
        version: ver,
        svgPath: hasSvg ? deformPath(g.svgPath, ver) : g.svgPath || '',
        preview:    g.preview    || '',
        previewInk: g.previewInk || '',
        verLabel:
          ver === 1 ? 'Ver 1: ต้นฉบับ'
          : ver === 2 ? 'Ver 2: หางตก'
          : 'Ver 3: เส้นแกว่ง',
      })
    }
  }
  return result
}