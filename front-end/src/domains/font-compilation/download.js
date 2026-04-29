/**
 * download.js — Safe download & ZIP export utilities
 *
 * Fixes:
 *   - Blob URL is revoked only after a generous delay (5 s), not synchronously
 *   - Each file download queued with staggered setTimeout to avoid browser throttle
 *   - ZIP export bundles all font files + metadata into a single .zip
 *   - Error handling: download failure is reported, not silently swallowed
 */

// ─── Single file download ─────────────────────────────────────────────────────

/**
 * Download an ArrayBuffer as a file.
 * The Blob URL is kept alive for REVOKE_DELAY ms so browsers have time to start
 * the download before the object URL is invalidated.
 *
 * @param {ArrayBuffer} buffer   - file contents
 * @param {string}      filename - suggested download filename
 * @param {string}      mime     - MIME type
 * @returns {Promise<void>}      - resolves after the click, rejects on failure
 */
export function downloadBuffer(buffer, filename, mime = 'application/octet-stream') {
  return new Promise((resolve, reject) => {
    try {
      const blob = new Blob([buffer], { type: mime })
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href     = url
      a.download = filename
      a.style.display = 'none'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)

      // Revoke after generous delay — never synchronously
      setTimeout(() => URL.revokeObjectURL(url), 5000)
      resolve()
    } catch (err) {
      reject(new Error(`Download failed for "${filename}": ${err.message}`))
    }
  })
}

/**
 * Download a JSON-serialisable object as .json.
 */
export function downloadJSON(obj, filename) {
  const str = JSON.stringify(obj, null, 2)
  const enc = new TextEncoder().encode(str)
  return downloadBuffer(enc.buffer, filename, 'application/json')
}

/**
 * Download a plain string as a text file.
 */
export function downloadText(text, filename) {
  const enc = new TextEncoder().encode(text)
  return downloadBuffer(enc.buffer, filename, 'text/plain;charset=utf-8')
}

// ─── Staggered multi-file download ────────────────────────────────────────────

/**
 * Download multiple files with a stagger delay between each.
 * Prevents browsers from blocking simultaneous download initiations.
 *
 * @param {{ buffer: ArrayBuffer, filename: string, mime: string }[]} files
 * @param {number} [staggerMs=500]
 * @returns {Promise<void[]>} - resolves when all downloads have been initiated
 */
export async function downloadAllStaggered(files, staggerMs = 500) {
  const results = []
  for (let i = 0; i < files.length; i++) {
    const f = files[i]
    await new Promise(resolve => setTimeout(resolve, i === 0 ? 0 : staggerMs))
    results.push(downloadBuffer(f.buffer, f.filename, f.mime))
  }
  return Promise.all(results)
}

// ─── ZIP export ───────────────────────────────────────────────────────────────

/**
 * Bundle all font files + metadata into a single .zip archive and trigger
 * download.  Uses JSZip (must be installed: npm install jszip).
 *
 * If JSZip is not available, falls back to staggered individual downloads.
 *
 * @param {string}      fontName     - used for filenames inside the zip
 * @param {ArrayBuffer} ttfBuffer
 * @param {ArrayBuffer} woffBuffer
 * @param {object}      glyphMapObj  - JSON-serialisable glyph map
 * @param {object}      metadataObj  - JSON-serialisable metadata
 * @param {string[]}    buildLog     - build log lines to include as .txt
 * @returns {Promise<void>}
 */
export async function downloadFontZip({
  fontName,
  ttfBuffer,
  woffBuffer,
  glyphMapObj,
  metadataObj,
  buildLog = [],
}) {
  let JSZip
  try {
    JSZip = (await import('jszip')).default
  } catch {
    // JSZip not installed — fall back to individual downloads
    console.warn('[download] jszip not available, falling back to individual downloads')
    return downloadAllStaggered([
      { buffer: ttfBuffer,  filename: `${fontName}.ttf`,         mime: 'font/ttf'  },
      { buffer: woffBuffer, filename: `${fontName}.woff`,        mime: 'font/woff' },
      { buffer: new TextEncoder().encode(JSON.stringify(glyphMapObj, null, 2)).buffer,
        filename: 'glyphMap.json', mime: 'application/json' },
      { buffer: new TextEncoder().encode(JSON.stringify(metadataObj, null, 2)).buffer,
        filename: 'metadata.json', mime: 'application/json' },
    ])
  }

  const zip = new JSZip()

  // Fonts folder
  zip.file(`${fontName}.ttf`,  ttfBuffer)
  zip.file(`${fontName}.woff`, woffBuffer)

  // CSS @font-face snippet for convenience
  const cssSnippet = _generateFontFaceCSS(fontName)
  zip.file(`${fontName}-fontface.css`, cssSnippet)

  // Metadata
  zip.file('glyphMap.json',  JSON.stringify(glyphMapObj, null, 2))
  zip.file('metadata.json',  JSON.stringify(metadataObj, null, 2))

  // Install guide (Markdown)
  zip.file('INSTALL.md', _generateInstallGuide(fontName))

  // Build log
  if (buildLog.length > 0) {
    zip.file('build.log', buildLog.join('\n'))
  }

  const zipBlob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  })

  const url = URL.createObjectURL(zipBlob)
  const a   = document.createElement('a')
  a.href     = url
  a.download = `${fontName}-font-package.zip`
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

// ─── Generated file content helpers ──────────────────────────────────────────

function _generateFontFaceCSS(fontName) {
  return `/* ${fontName} — generated by Handwriting Font Generator */
@font-face {
  font-family: '${fontName}';
  src: url('${fontName}.woff') format('woff'),
       url('${fontName}.ttf')  format('truetype');
  font-weight: normal;
  font-style:  normal;
  font-display: swap;
}

/* Enable OpenType features */
.handwriting {
  font-family: '${fontName}', cursive;
  /* Stylistic alternates (salt): toggle for variant style */
  font-feature-settings: "salt" 1, "calt" 1;
}

/* Thai text needs correct unicode-range and script feature */
.handwriting-thai {
  font-family: '${fontName}', cursive;
  font-feature-settings: "salt" 1, "calt" 1, "mark" 1;
  unicode-range: U+0E00-0E7F;
}
`
}

function _generateInstallGuide(fontName) {
  return `# Installing ${fontName}

## macOS
1. Double-click \`${fontName}.ttf\`
2. Click "Install Font"

## Windows
1. Right-click \`${fontName}.ttf\`
2. Select "Install" or "Install for all users"

## Linux (Ubuntu/Debian)
\`\`\`bash
mkdir -p ~/.local/share/fonts
cp ${fontName}.ttf ~/.local/share/fonts/
fc-cache -fv
\`\`\`

## Web (CSS)
Include the \`${fontName}-fontface.css\` in your HTML or copy the
\`@font-face\` block from it into your stylesheet.

Then use:
\`\`\`css
.my-text {
  font-family: '${fontName}', cursive;
  font-feature-settings: "salt" 1, "calt" 1;
}
\`\`\`

## OpenType Features
| Feature | Code | Description |
|---------|------|-------------|
| Stylistic Alternates | \`"salt" 1\` | Switch all glyphs to alt-1 variant |
| Contextual Alternates | \`"calt" 1\` | Auto-rotate variants on repeated chars |
| Mark Positioning | \`"mark" 1\` | Thai vowel & tone mark anchors (auto) |

## Notes
- Thai mark glyphs (vowels above/below, tone marks) have zero advance width
  and are positioned automatically via GPOS anchors.
- The font contains 3 variants per character: default, alt1, alt2.
`
}

// ─── P1.3 — SVG Export ────────────────────────────────────────────────────────

/**
 * Export raw glyph paths as a single SVG file.
 * Each glyph occupies a 110×110 cell with its char label below.
 *
 * @param {Array<{char: string, path: string}>} glyphs
 * @param {string} filename
 * @returns {Promise<void>}
 */
export async function exportSVG(glyphs, filename = 'handwriting-glyphs.svg') {
  const CELL = 110
  const PAD  = 8
  const COLS = Math.min(16, glyphs.length)
  const ROWS = Math.ceil(glyphs.length / COLS)
  const W    = COLS * CELL + PAD * 2
  const H    = ROWS * CELL + PAD * 2

  const cells = glyphs.map((g, i) => {
    const col = i % COLS
    const row = Math.floor(i / COLS)
    const tx  = PAD + col * CELL
    const ty  = PAD + row * CELL
    const pathD = g.svgPath ?? g.path ?? ''

    return `
  <g transform="translate(${tx}, ${ty})">
    <rect width="${CELL - 4}" height="${CELL - 18}" rx="4"
      fill="#FAFAFA" stroke="#E5E0D5" stroke-width="0.75"/>
    <g transform="scale(${(CELL - 4) / 100})" fill="none" stroke="#2C2416" stroke-width="1.5"
       stroke-linecap="round" stroke-linejoin="round">
      <path d="${pathD}"/>
    </g>
    <text x="${(CELL - 4) / 2}" y="${CELL - 6}"
      text-anchor="middle" font-size="9" fill="#888"
      font-family="system-ui, sans-serif">${g.char ?? ''}</text>
  </g>`
  }).join('')

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="#F7F5F0"/>
  ${cells}
</svg>`

  const enc = new TextEncoder().encode(svg)
  return downloadBuffer(enc.buffer, filename, 'image/svg+xml')
}

// ─── P1.3 — PDF Export (canvas → jsPDF) ──────────────────────────────────────

/**
 * Export a canvas element as a PDF page using jsPDF.
 * Falls back to PNG download if jsPDF is unavailable.
 *
 * @param {HTMLCanvasElement} canvasEl
 * @param {string} filename
 * @returns {Promise<void>}
 */
export async function exportPDF(canvasEl, filename = 'handwriting-preview.pdf') {
  // jspdf is not in package.json — use the built-in PDF fallback which needs no external deps.
  // The _canvasToPdfFallback below produces a valid PDF-1.4 file without any library.
  // To re-enable jspdf: run `npm install jspdf` then uncomment the block below.
  //
  // let jsPDF = null
  // try {
  //   const mod = await import(/* @vite-ignore */ 'jspdf')
  //   jsPDF = mod.jsPDF ?? mod.default?.jsPDF ?? null
  // } catch { /* jspdf not installed */ }
  // if (jsPDF) { ... }

  console.info('[exportPDF] using built-in PDF fallback (no jspdf dep needed)')
  return _canvasToPdfFallback(canvasEl, filename)
}

// ── jsPDF branch preserved below for future use ────────────────────────────
// async function _exportWithJsPDF(canvasEl, filename, jsPDF) {
//   const w   = canvasEl.width
//   const h   = canvasEl.height
//   const orientation = w > h ? 'l' : 'p'
//   const doc = new jsPDF({ orientation, unit: 'px', format: [w, h] })
//   const imgData = canvasEl.toDataURL('image/jpeg', 0.92)
//   doc.addImage(imgData, 'JPEG', 0, 0, w, h)
//   const pdfBytes = doc.output('arraybuffer')
//   return downloadBuffer(pdfBytes, filename, 'application/pdf')
// }


/**
 * Minimal PDF-1.4 wrapper around a JPEG image.
 * Works without any external library.
 * @private
 */
async function _canvasToPdfFallback(canvasEl, filename) {
  const jpegDataUrl = canvasEl.toDataURL('image/jpeg', 0.92)
  const base64      = jpegDataUrl.split(',')[1]

  // Decode base64 → byte array
  const binaryStr = atob(base64)
  const jpegBytes = new Uint8Array(binaryStr.length)
  for (let i = 0; i < binaryStr.length; i++) jpegBytes[i] = binaryStr.charCodeAt(i)

  const W = canvasEl.width
  const H = canvasEl.height

  // Build minimal PDF structure
  const enc = new TextEncoder()
  const parts = []
  const offsets = []

  function push(str) { parts.push(enc.encode(str)) }
  function pushBytes(bytes) { parts.push(bytes) }

  // Header
  push('%PDF-1.4\n')

  // Object 1 — Catalog
  offsets[1] = parts.reduce((a, b) => a + b.length, 0)
  push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n')

  // Object 2 — Pages
  offsets[2] = parts.reduce((a, b) => a + b.length, 0)
  push(`2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n`)

  // Object 3 — Page
  offsets[3] = parts.reduce((a, b) => a + b.length, 0)
  push(`3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Contents 4 0 R /Resources << /XObject << /Im1 5 0 R >> >> >>\nendobj\n`)

  // Object 4 — Content stream
  const contentStr = `q ${W} 0 0 ${H} 0 0 cm /Im1 Do Q`
  offsets[4] = parts.reduce((a, b) => a + b.length, 0)
  push(`4 0 obj\n<< /Length ${contentStr.length} >>\nstream\n${contentStr}\nendstream\nendobj\n`)

  // Object 5 — JPEG image XObject
  offsets[5] = parts.reduce((a, b) => a + b.length, 0)
  const imgHeader = enc.encode(
    `5 0 obj\n<< /Type /XObject /Subtype /Image /Width ${W} /Height ${H} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>\nstream\n`
  )
  parts.push(imgHeader)
  pushBytes(jpegBytes)
  push('\nendstream\nendobj\n')

  // Cross-reference table
  const xrefOffset = parts.reduce((a, b) => a + b.length, 0)
  push('xref\n')
  push(`0 6\n`)
  push('0000000000 65535 f \n')
  for (let i = 1; i <= 5; i++) {
    push(String(offsets[i]).padStart(10, '0') + ' 00000 n \n')
  }
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`)

  // Merge all parts
  const totalLen = parts.reduce((a, b) => a + b.length, 0)
  const out = new Uint8Array(totalLen)
  let pos = 0
  for (const p of parts) { out.set(p, pos); pos += p.length }

  return downloadBuffer(out.buffer, filename, 'application/pdf')
}

// ─── P1.3 — PNG Export (verify existing) ─────────────────────────────────────

/**
 * Export a canvas element as a PNG file.
 * Uses toBlob for better memory handling on large canvases.
 *
 * @param {HTMLCanvasElement} canvasEl
 * @param {string} filename
 * @returns {Promise<void>}
 */
export function exportPNG(canvasEl, filename = 'handwriting-preview.png') {
  return new Promise((resolve, reject) => {
    try {
      canvasEl.toBlob(blob => {
        if (!blob) {
          reject(new Error('toBlob returned null — canvas may be tainted or empty'))
          return
        }
        const url = URL.createObjectURL(blob)
        const a   = document.createElement('a')
        a.href     = url
        a.download = filename
        a.style.display = 'none'
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        setTimeout(() => URL.revokeObjectURL(url), 5000)
        resolve()
      }, 'image/png')
    } catch (err) {
      reject(new Error(`PNG export failed: ${err.message}`))
    }
  })
}

/**
 * Export TTF buffer as a .ttf file.
 * Thin wrapper around downloadBuffer for consistent API.
 *
 * @param {ArrayBuffer} ttfBuffer
 * @param {string} filename
 * @returns {Promise<void>}
 */
export function exportTTF(ttfBuffer, filename = 'handwriting.ttf') {
  return downloadBuffer(ttfBuffer, filename, 'font/ttf')
}