// thaiAnchors.js — Anchor positioning system for Thai handwriting rendering
//
// This system provides precise positioning for Thai combining marks and vowels
// relative to their base consonants, mimicking natural Thai handwriting placement.
//
// Anchor types:
// - TOP: for tone marks, upper vowels (่ ้ ๊ ๋ ิ ี ึ ื)
// - BOTTOM: for lower vowels (ุ ู ฺ) 
// - LEFT: for leading vowels (เ แ โ ใ ไ)
// - RIGHT: for trailing vowels (า ะ อ)
// - CENTER: for base consonants

// ─── Thai Unicode category classification for anchor positioning ──────────

export const ThaiAnchorType = {
  TOP: 'top',
  BOTTOM: 'bottom', 
  LEFT: 'left',
  RIGHT: 'right',
  CENTER: 'center'
}

function getThaiAnchorType(cp) {
  // Upper vowels and tone marks - attach to top anchor
  if (cp === 0x0e31 || cp === 0x0e34 || cp === 0x0e35 || cp === 0x0e36 || cp === 0x0e37 || 
      cp === 0x0e47 || cp === 0x0e48 || cp === 0x0e49 || cp === 0x0e4a || cp === 0x0e4b) {
    return ThaiAnchorType.TOP
  }
  
  // Lower vowels - attach to bottom anchor
  if (cp === 0x0e38 || cp === 0x0e39 || cp === 0x0e3a) {
    return ThaiAnchorType.BOTTOM
  }
  
  // Leading vowels - position to the left
  if (cp >= 0x0e40 && cp <= 0x0e44) {
    return ThaiAnchorType.LEFT
  }
  
  // Trailing vowels - position to the right
  // NOTE: 0x0e40 (เ) is a LEADING vowel handled above — must NOT be here
  if (cp === 0x0e32 || cp === 0x0e45 || cp === 0x0e2d || cp === 0x0e27) {
    return ThaiAnchorType.RIGHT
  }
  
  // Consonants and other characters - center position
  return ThaiAnchorType.CENTER
}

// ─── Anchor positioning calculations ────────────────────────────────────────

/**
 * Calculate anchor offsets for Thai glyph components
 * @param {Object} cluster - Thai grapheme cluster with components
 * @param {number} fontSize - Current font size for scaling
 * @returns {Array} Array of {component, anchorType, offsetX, offsetY, scale}
 */
export function calculateAnchorPositions(cluster, fontSize = 32) {
  if (!cluster || !cluster.subGlyphs) {
    return []
  }

  // ── Design: ALL components share the SAME slot box (inset:0 / fill the slot).
  //
  // Thai script works by STACKING, not by side-by-side layout:
  //   - Consonant           → fills the slot normally (baseline-aligned)
  //   - Upper vowels/tones  → same slot, shifted UP by ~70% of slot height
  //   - Lower vowels        → same slot, shifted DOWN by ~55% of slot height
  //   - Leading vowels      → rendered as separate cluster token (Intl.Segmenter
  //                           keeps เก as two tokens), so LEFT rarely appears here.
  //                           If it does: small leftward nudge only.
  //   - Trailing vowels     → small rightward nudge only.
  //
  // slotH = fontSize * GLYPH_SLOT_H_RATIO (≈1.10), so for fontSize=48, slotH≈53px.
  // "70% up" means offsetY = -0.70 * slotH ≈ -37px — keeps mark inside the slot area.
  //
  // We use fractions of fontSize (not slotH) since fontSize is what we receive.
  // slotH ≈ 1.10 * fontSize, so:
  //   TOP  offsetY ≈ -0.72 * fontSize  (= -0.65 * slotH)
  //   BOT  offsetY ≈ +0.55 * fontSize  (= +0.50 * slotH)

  const positions = []

  for (const component of cluster.subGlyphs) {
    const cp         = component.ch.codePointAt(0)
    const anchorType = getThaiAnchorType(cp)

    let offsetX = 0
    let offsetY = 0
    let scale   = 1.0

    switch (anchorType) {
      case ThaiAnchorType.TOP:
        // Upper vowels (ิ ี ึ ื ั) and tone marks (่ ้ ๊ ๋):
        // Shift upward so mark sits above the consonant body.
        // offsetY must account for scale (0.78) so mark doesn't overlap next cluster.
        scale   =  0.78
        offsetY = -0.55 * fontSize * scale
        offsetX =  0.0
        break

      case ThaiAnchorType.BOTTOM:
        // Lower vowels (ุ ู ฺ): sit below consonant descender.
        // offsetY must be large enough to clear the full consonant body.
        // 0.40 * scale ≈ 10px at fs=32 — too small (only 28% of slotH).
        // 0.60 * fontSize ≈ 19px — clears consonant bottom comfortably.
        // Note: offsetY is NOT multiplied by scale so the shift is
        // consonant-relative, not mark-size-relative.
        scale   =  0.78
        offsetY = +0.60 * fontSize
        offsetX =  0.0
        break

      case ThaiAnchorType.LEFT:
        // Leading vowels that end up in a cluster (rare after Intl.Segmenter).
        // Small leftward nudge; fill same vertical space.
        offsetX = -0.60 * fontSize
        offsetY =  0.0
        scale   =  0.9
        break

      case ThaiAnchorType.RIGHT:
        // Trailing vowels (า ะ อ ว ๅ): nudge right.
        offsetX = +0.60 * fontSize
        offsetY =  0.0
        scale   =  0.9
        break

      case ThaiAnchorType.CENTER:
      default:
        offsetX = 0
        offsetY = 0
        scale   = 1.0
        break
    }

    positions.push({ component, anchorType, offsetX, offsetY, scale })
  }

  return positions
}

// ─── Cluster width calculation with anchor spacing ───────────────────────────

/**
 * Calculate the visual width of a Thai cluster considering anchor positioning
 * @param {string} cluster - Thai grapheme cluster string
 * @returns {number} Width multiplier relative to base consonant width
 */
export function calculateClusterWidth(cluster) {
  if (!cluster) return 1.0
  
  const chars = [...cluster]
  let width = 1.0 // Start with base consonant width
  
  for (const ch of chars) {
    const cp = ch.codePointAt(0)
    const anchorType = getThaiAnchorType(cp)
    
    // Only left/right anchors affect horizontal width
    if (anchorType === ThaiAnchorType.LEFT) {
      width += 0.3 // Leading vowel adds width to the left
    } else if (anchorType === ThaiAnchorType.RIGHT) {
      width += 0.4 // Trailing vowel adds width to the right  
    }
    // Top/bottom anchors don't affect horizontal width
  }
  
  return Math.min(width, 2.0) // Cap at 2x base width
}

// ─── Validation and debugging utilities ───────────────────────────────────────

/**
 * Validate that all components in a cluster have valid anchor positions
 * @param {Array} positions - Array from calculateAnchorPositions
 * @returns {Object} Validation result with any issues found
 */
export function validateAnchorPositions(positions) {
  const issues = []
  
  if (!positions || positions.length === 0) {
    issues.push('No positions provided')
    return { valid: false, issues }
  }
  
  // Check for base consonant
  const hasBase = positions.some(p => p.anchorType === ThaiAnchorType.CENTER)
  if (!hasBase) {
    issues.push('No base consonant found in cluster')
  }
  
  // Check for overlapping positions
  const byType = {}
  for (const pos of positions) {
    if (!byType[pos.anchorType]) byType[pos.anchorType] = []
    byType[pos.anchorType].push(pos)
  }
  
  // Multiple top anchors might need special handling
  if (byType[ThaiAnchorType.TOP] && byType[ThaiAnchorType.TOP].length > 1) {
    issues.push('Multiple top anchors detected - may need stacking')
  }
  
  return {
    valid: issues.length === 0,
    issues,
    summary: `${positions.length} components, base: ${hasBase}`
  }
}

// ─── Pseudo-code for rendering integration ───────────────────────────────────────

/*
RENDERING ALGORITHM WITH ANCHOR POSITIONING:

function renderThaiCluster(cluster, fontSize, slotW, slotH) {
  // 1. Calculate anchor positions for all components
  const positions = calculateAnchorPositions(cluster, fontSize)
  
  // 2. Create container for the cluster
  const container = createClusterContainer(slotW, slotH)
  
  // 3. Render each component at its anchor position
  for (const pos of positions) {
    const glyphElement = renderGlyph(
      pos.component.glyph,
      pos.component.ch,
      fontSize * pos.scale  // Scale glyph if needed
    )
    
    // Apply anchor positioning
    glyphElement.style.position = 'absolute'
    glyphElement.style.left = `${50 + (pos.offsetX / slotW * 100)}%`
    glyphElement.style.top = `${50 + (pos.offsetY / slotH * 100)}%`
    glyphElement.style.transform = `translate(-50%, -50%)`
    
    container.appendChild(glyphElement)
  }
  
  return container
}

LAYOUT CALCULATION:

function calculateThaiLayout(text, fontSize) {
  const clusters = segmentGraphemes(text)
  let currentX = 0
  
  for (const cluster of clusters) {
    const width = calculateClusterWidth(cluster) * fontSize
    const positions = calculateAnchorPositions(cluster, fontSize)
    
    // Position cluster at currentX
    placeCluster(cluster, currentX, 0, width)
    
    // Advance to next cluster position
    currentX += width + getSpacingAfter(cluster)
  }
}
*/