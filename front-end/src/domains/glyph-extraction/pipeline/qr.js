import { HGQR_RE } from "../constants.js"

export function decodeHgQrCharsPayload(b64url) {
  if (!b64url) return null
  try {
    let b64 = b64url.replace(/-/g, "+").replace(/_/g, "/")
    const pad = b64.length % 4
    if (pad) b64 += "=".repeat(4 - pad)
    const binary = atob(b64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
    const json = new TextDecoder("utf-8").decode(bytes)
    const arr = JSON.parse(json)
    if (!Array.isArray(arr)) return null
    return arr.map(x => (x == null ? "" : String(x)))
  } catch {
    return null
  }
}

// Scan imageData for QR code using jsQR (loaded via CDN)
export function decodeQRFromImageData(imageData, width, height) {
  try {
    const jsQR = window.jsQR
    if (!jsQR) return null
    const result = jsQR(imageData, width, height, { inversionAttempts: "dontInvert" })
    if (!result?.data) return null
    const m = result.data.trim().match(HGQR_RE)
    if (!m) return null
    const cellCount = Number(m[5])
    let charsFromQr = m[7] ? decodeHgQrCharsPayload(m[7]) : null
    if (charsFromQr && charsFromQr.length !== cellCount) charsFromQr = null
    return {
      page: Number(m[1]),
      totalPages: Number(m[2]),
      cellFrom: Number(m[3]),
      cellTo: Number(m[4]),
      cellCount,
      totalGlyphs: Number(m[6]),
      charsFromQr: charsFromQr || null,
      qrBounds: result.location,
    }
  } catch {
    return null
  }
}

export function extractCharsetIfCompleteInQr(pages) {
  if (!pages?.length) return null
  const sorted = [...pages].sort((a, b) => a.pageNumber - b.pageNumber)

  const segments = []
  let seg = []

  const flushSeg = () => {
    if (seg.length > 0) { segments.push(seg); seg = [] }
  }

  for (const p of sorted) {
    const m = p.pageMeta
    if (!m || !Number.isFinite(m.cellCount) || m.cellCount < 1) {
      flushSeg()
      continue
    }
    if (seg.length > 0) {
      const prev = seg[seg.length - 1].pageMeta
      if (m.page === 1 || m.totalPages !== prev.totalPages) flushSeg()
    }
    seg.push(p)
  }
  flushSeg()

  if (segments.length === 0) return null

  const acc = []
  for (const segment of segments) {
    const segChars = []
    let expectedTotal = null
    let broken = false
    for (const p of segment) {
      const m = p.pageMeta
      if (expectedTotal == null && Number.isFinite(m.totalGlyphs)) expectedTotal = m.totalGlyphs

      // Try charsFromQr first, then charsFromMeta, then charByIndex as per-page fallbacks
      let pageChars = null
      if (Array.isArray(m.charsFromQr) && m.charsFromQr.length === m.cellCount) {
        pageChars = m.charsFromQr
      } else if (Array.isArray(m.charsFromMeta) && m.charsFromMeta.length === m.cellCount) {
        pageChars = m.charsFromMeta
      } else if (p.charByIndex instanceof Map && p.charByIndex.size >= m.cellCount) {
        // Reconstruct from HGCHAR tags
        const fromTags = []
        for (let i = m.cellFrom; i <= m.cellTo; i++) {
          const ch = p.charByIndex.get(i - m.cellFrom + 1) ?? p.charByIndex.get(i)
          if (ch) fromTags.push(ch)
        }
        if (fromTags.length === m.cellCount) pageChars = fromTags
      }

      if (!pageChars) { broken = true; break }
      segChars.push(...pageChars)
    }
    if (broken || segChars.length === 0) continue
    if (Number.isFinite(expectedTotal) && segChars.length !== expectedTotal) continue
    acc.push(...segChars)
  }

  return acc.length > 0 ? acc : null
}
