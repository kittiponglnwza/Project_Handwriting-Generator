import { HGQR_RE } from "./constants.js"

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
  const acc = []
  let expectedTotal = null
  for (const p of sorted) {
    const m = p.pageMeta
    if (!m || !Number.isFinite(m.cellCount) || m.cellCount < 1) return null
    if (expectedTotal == null && Number.isFinite(m.totalGlyphs)) expectedTotal = m.totalGlyphs
    const c = m.charsFromQr
    if (!Array.isArray(c) || c.length !== m.cellCount) return null
    acc.push(...c)
  }
  if (Number.isFinite(expectedTotal) && acc.length !== expectedTotal) return null
  return acc.length > 0 ? acc : null
}
