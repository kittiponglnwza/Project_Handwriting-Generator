import { HGMETA_RE, HGCHAR_RE, TEMPLATE_CODE_RE, TEMPLATE_INDEX_RE } from "../constants.js"
import { decodeHgQrCharsPayload } from "./qr.js"

// ---------------------------------------------------------------------------
// NCR DECODER
// ---------------------------------------------------------------------------
// Step 1 encodes Thai combining characters as Numeric Character References
// (e.g. &#x0E48; or &#3656;) so PDF.js cannot silently drop them during
// text-content extraction. We must decode them back before any clustering.
function decodeNcr(str) {
  if (!str || !str.includes("&")) return str
  return str
    .replace(/&#x([0-9A-Fa-f]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
}

// ---------------------------------------------------------------------------
// THAI UNICODE CATEGORY HELPERS
// ---------------------------------------------------------------------------
// Thai script is an abugida: consonants are the base units, and vowels /
// diacritics are written above, below, before, or after the consonant.
// Crucially, many of these marks are NOT spacing characters — they share
// the same horizontal slot as their base consonant.
//
// PDF.js honours the order in which glyphs appear in the PDF content stream,
// which matches visual left-to-right order. For Thai this means:
//   • Leading vowels  (เ แ โ ใ ไ) appear BEFORE their base consonant in
//     the content stream but are rendered to the LEFT of it on screen.
//   • Non-spacing marks (tone marks, above/below vowels) appear AFTER the
//     base consonant in the content stream.
//
// Because PDF.js emits one textItem per glyph position, a single written
// syllable like "เก้า" arrives as four separate items: ["เ","ก","้","า"].
// If we treat each item as an independent anchor the layout engine places
// them as four separate characters with their own grid cells, which is wrong.
// We must re-join them into a single cluster BEFORE creating anchors.

/** True for Thai base consonants (U+0E01–U+0E2E). */
function isThaiConsonant(cp) {
  return cp >= 0x0e01 && cp <= 0x0e2e
}

/**
 * True for Thai leading vowels that precede the consonant visually but
 * follow it in Unicode logical order when encoded correctly. In PDF content
 * streams these arrive BEFORE the consonant glyph.
 *   เ U+0E40   แ U+0E41   โ U+0E42   ใ U+0E43   ไ U+0E44
 */
function isThaiLeadingVowel(cp) {
  return cp >= 0x0e40 && cp <= 0x0e44
}

/**
 * True for Thai non-spacing combining marks: above/below vowels and tone
 * marks (U+0E31, U+0E34–U+0E3A, U+0E47–U+0E4E).
 * These share the horizontal slot of their base consonant and must never
 * become standalone anchors.
 */
function isThaiCombining(cp) {
  return (
    cp === 0x0e31 ||                      // ั  sara a (above)
    (cp >= 0x0e34 && cp <= 0x0e3a) ||    // ิ ี ึ ื ุ ู  sara i…u (above/below)
    (cp >= 0x0e47 && cp <= 0x0e4e)       // ็ ่ ้ ๊ ๋ ์ ํ ๎  mai/thanthakat/…
  )
}

/** True for Thai trailing vowels that follow the consonant (า ะ อ ว …). */
function isThaiTrailingVowel(cp) {
  // U+0E30–U+0E33, U+0E40–U+0E44 that are NOT leading, U+0E45–U+0E46, etc.
  // Practically: anything in the Thai block that is not a consonant, not a
  // leading vowel, and not a combining mark is treated as a trailing vowel.
  return (
    cp >= 0x0e00 && cp <= 0x0e7f &&
    !isThaiConsonant(cp) &&
    !isThaiLeadingVowel(cp) &&
    !isThaiCombining(cp) &&
    cp !== 0x0e00  // reserved
  )
}

/** True if a code-point is anywhere in the Thai Unicode block. */
function isThai(cp) {
  return cp >= 0x0e00 && cp <= 0x0e7f
}

// ---------------------------------------------------------------------------
// THAI GRAPHEME CLUSTER BUILDER
// ---------------------------------------------------------------------------
/**
 * buildThaiClusters(textItems)
 *
 * Takes the raw array of PDF.js textItems (each with .str, .transform,
 * .width, .height) and returns an array of cluster objects.
 *
 * A CLUSTER represents one logical grapheme unit:
 *   { text: string, glyphs: textItem[], bbox: {x, y, width, height} }
 *
 * Clustering rules (applied left-to-right over the content-stream order):
 *   1. A Thai LEADING VOWEL starts a pending cluster; the following
 *      consonant joins it as the base.
 *   2. A Thai CONSONANT that is not already part of a pending cluster
 *      starts a new cluster.
 *   3. Thai COMBINING MARKS (tone marks, above/below vowels) always attach
 *      to the most-recently-opened Thai cluster.
 *   4. Thai TRAILING VOWELS attach to the most-recently-opened Thai cluster.
 *   5. Any non-Thai character (Latin, digit, punctuation, …) is emitted as
 *      its own single-glyph cluster immediately, flushing any pending Thai
 *      cluster first.
 *
 * BOUNDING BOX merging:
 *   The cluster bbox is the axis-aligned union of all constituent glyph
 *   bboxes, computed in PDF-space (y increases upward from bottom-left).
 *   Downstream code converts to screen-space separately.
 *
 * NOTE: This function does NOT touch the anchor-position logic. It only
 * re-groups textItems. The caller maps each cluster to one anchor.
 */
export function buildThaiClusters(textItems) {
  const clusters = []

  // pendingLeading: a leading vowel waiting for its consonant
  let pendingLeading = null  // textItem | null

  // currentCluster: the Thai cluster we are currently appending to
  let currentCluster = null  // { text, glyphs, bbox } | null

  function flushCurrent() {
    if (currentCluster) {
      clusters.push(currentCluster)
      currentCluster = null
    }
  }

  function flushLeading() {
    // A leading vowel that never found a consonant — emit it alone.
    if (pendingLeading) {
      clusters.push(makeCluster(pendingLeading))
      pendingLeading = null
    }
  }

  function makeCluster(item) {
    return {
      text: item.str,
      glyphs: [item],
      bbox: itemBbox(item),
    }
  }

  function appendToCluster(cluster, item) {
    cluster.text += item.str
    cluster.glyphs.push(item)
    cluster.bbox = unionBbox(cluster.bbox, itemBbox(item))
  }

  for (const item of textItems) {
    const raw = decodeNcr(String(item?.str || ""))
    if (!raw) continue

    // Iterate over the characters in this item (usually 1, occasionally 2+
    // if PDF.js merged ligatures). We re-pack with the same item reference
    // since the bbox belongs to the whole item.
    const cp = raw.codePointAt(0)

    if (isThaiLeadingVowel(cp)) {
      // --- Leading vowel (เ แ โ ใ ไ) ---
      // Flush any previous cluster. This vowel attaches to the NEXT consonant,
      // so we park it and wait.
      flushCurrent()
      flushLeading()
      pendingLeading = { ...item, str: raw }
      continue
    }

    if (isThaiConsonant(cp)) {
      // --- Base consonant ---
      // Close any open cluster (previous syllable is complete once we hit a new consonant).
      flushCurrent()
      // Start a fresh cluster; prepend the leading vowel if one is parked.
      const clusterText = pendingLeading ? pendingLeading.str + raw : raw
      const clusterGlyphs = pendingLeading ? [pendingLeading, { ...item, str: raw }] : [{ ...item, str: raw }]
      const bbox = pendingLeading
        ? unionBbox(itemBbox(pendingLeading), itemBbox(item))
        : itemBbox(item)
      currentCluster = { text: clusterText, glyphs: clusterGlyphs, bbox }
      pendingLeading = null
      continue
    }

    if (isThaiCombining(cp)) {
      // --- Combining mark (tone / above-vowel / below-vowel) ---
      // Must attach to the current Thai cluster. If there is no open cluster
      // (e.g. the PDF has a stray combining mark) we open one.
      if (currentCluster) {
        appendToCluster(currentCluster, { ...item, str: raw })
      } else if (pendingLeading) {
        // Unusual but possible: combining mark after a leading vowel.
        // Attach to pending leading vowel and wait for the consonant.
        pendingLeading = { ...pendingLeading, str: pendingLeading.str + raw }
      } else {
        // Stray combining mark — emit as singleton.
        clusters.push(makeCluster({ ...item, str: raw }))
      }
      continue
    }

    if (isThai(cp)) {
      // --- Other Thai characters: trailing vowels, digits, punctuation ---
      // Attach to current cluster if one is open, otherwise start a new one.
      if (currentCluster) {
        appendToCluster(currentCluster, { ...item, str: raw })
      } else {
        flushLeading()
        currentCluster = makeCluster({ ...item, str: raw })
      }
      continue
    }

    // --- Non-Thai character (Latin, digit, space, punctuation, …) ---
    // Close any Thai cluster in progress; emit this item as its own cluster.
    flushCurrent()
    flushLeading()
    clusters.push(makeCluster({ ...item, str: raw }))
  }

  // Flush whatever is left.
  flushCurrent()
  flushLeading()

  return clusters
}

// ---------------------------------------------------------------------------
// BOUNDING BOX UTILITIES (PDF-space: origin at bottom-left, y up)
// ---------------------------------------------------------------------------

/**
 * Extract a {x, y, width, height} bbox from a PDF.js textItem.
 * The transform matrix is [a, b, c, d, e, f] where (e, f) is the glyph
 * origin in user space (PDF units, y-axis pointing UP).
 */
function itemBbox(item) {
  const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0] = item.transform || []
  return {
    x: Number(e),
    y: Number(f),
    width: Number(item.width || Math.abs(a) || 0),
    height: Number(item.height || Math.abs(d) || 0),
  }
}

/**
 * Return the axis-aligned union of two bboxes in PDF-space.
 * Because y increases upward in PDF-space:
 *   • The "bottom" of a glyph is at bbox.y
 *   • The "top"    of a glyph is at bbox.y + bbox.height
 */
function unionBbox(a, b) {
  const left   = Math.min(a.x, b.x)
  const bottom = Math.min(a.y, b.y)
  const right  = Math.max(a.x + a.width,  b.x + b.width)
  const top    = Math.max(a.y + a.height, b.y + b.height)
  return {
    x:      left,
    y:      bottom,
    width:  right - left,
    height: top  - bottom,
  }
}

// ---------------------------------------------------------------------------
// ANCHOR CREATION FROM A CLUSTER
// ---------------------------------------------------------------------------
/**
 * Convert a cluster's merged bbox from PDF-space to screen-space and build
 * the anchor object that the rest of Step 3 consumes.
 *
 * PDF-space:    y increases upward,  origin at bottom-left of page.
 * Screen-space: y increases downward, origin at top-left of page.
 * Conversion:   screenY = viewportHeight - pdfY
 */
function clusterToAnchor(cluster, index, kind, viewport) {
  const { x, y, width, height } = cluster.bbox
  return {
    index,
    kind,
    x,
    // Flip from PDF y-up to screen y-down using the viewport height.
    y: viewport.height - y,
    width,
    height,
    // Carry cluster metadata forward for downstream Thai-aware layout.
    clusterText:  cluster.text,
    clusterGlyphs: cluster.glyphs,
  }
}

// ---------------------------------------------------------------------------
// MAIN EXPORT — collectTextAnchors
// ---------------------------------------------------------------------------
export async function collectTextAnchors(page, viewport, maxIndex) {
  const textContent = await page.getTextContent()
  const items = textContent.items || []
  const rawAnchors = []

  // ------------------------------------------------------------------
  // Pass 1 — Harvest HGCHAR tags
  // ------------------------------------------------------------------
  // Step 1 writes invisible "HGCHAR:N=ก" text elements, one per template
  // cell, so we know which character lives in which cell without relying on
  // visual position alone.
  //
  // IMPORTANT: PDF.js splits Thai combining characters onto SEPARATE
  // textItems — e.g. "HGCHAR:5=ก" and then "้" as the very next item.
  // The existing peek-ahead handles that split. But the old code called
  // processThaiCharacter() only on the single char recovered from the tag,
  // NOT on a full run of items, so it missed leading-vowel clusters that
  // span multiple items. The buildThaiClusters() pass below covers that
  // general case; for HGCHAR we keep the simpler peek-ahead because the
  // tag already tells us the cell index.
  const charByIndex = new Map()

  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    const rawUntrimmed = String(item?.str || "")
    const raw = rawUntrimmed.trim()

    // Try untrimmed first so combining characters at the start of the string
    // survive (trim() eats leading combining marks on some JS engines).
    const hgChar = rawUntrimmed.match(HGCHAR_RE) || raw.match(HGCHAR_RE)
    if (hgChar) {
      const idx = Number(hgChar[1])
      let ch = decodeNcr(hgChar[2]).trim()

      // PDF.js may split the combining mark to the next textItem.
      if (!ch && i + 1 < items.length) {
        const nextRaw = String(items[i + 1]?.str || "")
        if (/^[\u0E00-\u0E7F]$/.test(nextRaw)) {
          ch = nextRaw
          i++
        }
      }

      // IMPORTANT: Do NOT merge this cell's char with the next item.
      // The template (Step 1) stores ONE code-point per cell.
      // charByIndex must map index → single code-point so glyphMap has
      // individual char keys ("ก", "้", "า") that tokens.js can look up
      // component-by-component when composing grapheme clusters.
      //
      // Cluster composition is handled entirely by tokens.js at render time:
      //   segmentGraphemes("เก้า") → ["เก้า"]
      //   clusterComponents("เก้า") → ["เ","ก","้","า"]
      //   glyphMap.get("เ"), glyphMap.get("ก"), … each looked up separately.
      //
      // Merging here would produce cluster keys ("เก", "วั") that tokens.js
      // cannot decompose back to individual glyphMap lookups.

      if (ch && idx >= 1 && idx <= maxIndex) charByIndex.set(idx, ch)
      continue
    }

    // ------------------------------------------------------------------
    // Pass 1b — Harvest positional anchors (HGN / plain-index items)
    // ------------------------------------------------------------------
    if (!raw) continue

    const codeMatch  = raw.match(TEMPLATE_CODE_RE)
    const indexMatch = raw.match(TEMPLATE_INDEX_RE)
    const prevRaw    = String(items[i - 1]?.str || "").trim()
    const hasCodePrefix = /^HG$/i.test(prevRaw)

    let kind  = null
    let index = 0

    if (codeMatch) {
      kind  = "code"
      index = Number(codeMatch[1])
    } else if (indexMatch && hasCodePrefix) {
      kind  = "code"
      index = Number(indexMatch[1])
    } else if (indexMatch) {
      kind  = "index"
      index = Number(indexMatch[1])
    } else {
      continue
    }

    if (!Number.isFinite(index) || index < 1 || index > maxIndex) continue

    // ------------------------------------------------------------------
    // KEY CHANGE: instead of creating one anchor per PDF.js textItem we
    // now look ahead to collect all textItems that belong to the SAME
    // Thai grapheme cluster starting at this position, then build a single
    // merged anchor for the whole cluster.
    //
    // Why? Because PDF.js emits one textItem per glyph slot in the PDF
    // content stream. Thai syllables occupy multiple glyph slots but
    // represent a single logical character. If we place an anchor per
    // glyph, the grid assigns separate cells to vowels and tone marks,
    // which breaks the handwriting layout.
    // ------------------------------------------------------------------

    // Collect consecutive items that look like they belong to this cluster.
    // We peek ahead only for Thai combining material so that non-Thai items
    // always produce exactly one anchor (existing behaviour preserved).
    const clusterItems = [item]
    let j = i + 1

    // Only attempt clustering when the anchor item itself is Thai or the
    // very next item is a Thai combining mark (handles the split-mark case
    // for positional items, mirroring the HGCHAR peek-ahead above).
    const anchorCp = raw.codePointAt(0)
    if (isThai(anchorCp) || (j < items.length && isThaiCombining((items[j]?.str || "").codePointAt(0)))) {
      while (j < items.length) {
        const nextStr = String(items[j]?.str || "")
        const nextCp  = nextStr.codePointAt(0)
        if (isThaiCombining(nextCp) || isThaiTrailingVowel(nextCp)) {
          clusterItems.push(items[j])
          j++
        } else {
          break
        }
      }
      // Advance outer loop past consumed items.
      if (j > i + 1) i = j - 1
    }

    // Build merged bbox over all cluster items.
    const mergedBbox = clusterItems.reduce((acc, it) => {
      const bbox = itemBbox(it)
      return acc ? unionBbox(acc, bbox) : bbox
    }, null) || itemBbox(item)

    const screenY = viewport.height - mergedBbox.y

    // Sanity-filter: reject anchors in header/footer or implausibly large.
    if (screenY < viewport.height * 0.14 || screenY > viewport.height * 0.97) continue
    if (mergedBbox.height > viewport.height * 0.07) continue
    if (mergedBbox.width  > viewport.width  * 0.16) continue

    rawAnchors.push({
      index,
      kind,
      x:      mergedBbox.x,
      y:      screenY,
      width:  mergedBbox.width,
      height: mergedBbox.height,
    })
  }

  // ------------------------------------------------------------------
  // Pass 2 — Deduplicate: keep one anchor per cell index
  // ------------------------------------------------------------------
  const byIndex = new Map()
  for (const anchor of rawAnchors) {
    const prev = byIndex.get(anchor.index)
    if (!prev) {
      byIndex.set(anchor.index, anchor)
      continue
    }
    // Prefer "code" anchors over "index" anchors.
    if (prev.kind !== "code" && anchor.kind === "code") {
      byIndex.set(anchor.index, anchor)
      continue
    }
    // Among same kind, prefer the one closest to the vertical centre.
    const mid = viewport.height * 0.55
    if (Math.abs(anchor.y - mid) < Math.abs(prev.y - mid)) {
      byIndex.set(anchor.index, anchor)
    }
  }

  const anchors = [...byIndex.values()].sort((a, b) => a.index - b.index)
  const codeAnchorCount = anchors.filter(a => a.kind === "code").length
  const allIndices = anchors.map(a => a.index)
  const startIndex = allIndices.length > 0 ? Math.min(...allIndices) : null

  let contiguousCount = 0
  if (startIndex != null) {
    while (byIndex.has(startIndex + contiguousCount)) contiguousCount++
  }

  // ------------------------------------------------------------------
  // Pass 3 — Extract page-level metadata (HGMETA tag)
  // ------------------------------------------------------------------
  let pageMeta = null
  for (const item of items) {
    const raw = String(item?.str || "")
    const m   = raw.match(HGMETA_RE)
    if (m) {
      const cellCount = Number(m[5])
      const rawChars  = m[7] ? decodeHgQrCharsPayload(m[7]) : null
      pageMeta = {
        page:         Number(m[1]),
        totalPages:   Number(m[2]),
        cellFrom:     Number(m[3]),
        cellTo:       Number(m[4]),
        cellCount,
        totalGlyphs:  Number(m[6]),
        charsFromMeta:
          Array.isArray(rawChars) && rawChars.length === cellCount ? rawChars : null,
      }
      break
    }
  }

  return {
    anchors,
    byIndex,
    startIndex,
    contiguousCount,
    hasCodeAnchors:  codeAnchorCount > 0,
    codeAnchorCount,
    pageMeta,
    charByIndex,   // Map<number, string> — Thai chars already merged into clusters
  }
}
