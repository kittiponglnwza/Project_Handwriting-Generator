/**
 * Step2 — Upload & Parse (SOURCE OF TRUTH)
 *
 * ARCHITECTURE ROLE: Core data producer.
 *
 * Responsibilities:
 *   1. Accept PDF upload (drag-drop or file picker)
 *   2. Validate file (type + size)
 *   3. Parse EVERY page with pdfjs-dist at scale=3
 *   4. Decode QR codes per page (jsQR via CDN)
 *   5. Collect HG text anchors per page
 *   6. Detect registration dots per page
 *   7. Run glyphPipeline to extract raw glyphs per page
 *   8. Emit ONE structured parsedFile object via onParsed(parsedFile)
 *
 * Character extraction contract:
 *   - Characters are ALWAYS extracted automatically from the PDF (QR → HG → index).
 *   - Manual input is a FALLBACK shown only when automatic extraction yields nothing.
 *   - Step2 NEVER blocks parsing waiting for user character input.
 *
 * Output shape (parsedFile):
 * {
 *   file: File,
 *   characters: string[],      // source-of-truth character list
 *   charSource: 'qr'|'hgcode'|'index'|'none'|'manual',
 *   metadata: { pages, detectedSlots, fileName, fileSize },
 *   pages: PageData[],         // pre-rendered canvases + anchors — Step 3 reads these
 *   status: 'parsed'|'error',
 * }
 *
 * Step 3 NEVER re-reads the PDF file. It only reads parsedFile.pages.
 */

import { useEffect, useRef, useState } from "react"
import { GlobalWorkerOptions, getDocument } from "pdfjs-dist"
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url"
import InfoBox from "../components/InfoBox"
import Tag from "../components/Tag"
import Btn from "../components/Btn"
import C from "../styles/colors"
import { collectTextAnchors } from "../domains/glyph-extraction/pipeline/pdfAnchors.js"
import { decodeQRFromImageData, extractCharsetIfCompleteInQr } from "../domains/glyph-extraction/pipeline/qr.js"
import { detectRegDots } from "../domains/glyph-extraction/pipeline/regDots.js"
import { buildAutoPageProfiles } from "../domains/glyph-extraction/pipeline/calibration.js"
import {
  MIN_TRUSTED_INDEX_TARGETS,
  TEMPLATE_CODE_RE,
  TEMPLATE_INDEX_RE,
} from "../domains/glyph-extraction/constants.js"

GlobalWorkerOptions.workerSrc = pdfWorker

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024
const PDF_RENDER_SCALE    = 3
const CHAR_PREVIEW_LIMIT  = 24

// ─── File validation ──────────────────────────────────────────────────────────
function validatePdf(file) {
  if (!file) return "No file found"
  const name = (file.name ?? "").toLowerCase()
  if (!name.endsWith(".pdf") && file.type !== "application/pdf")
    return "Only PDF files (.pdf) are supported"
  if (file.size > MAX_FILE_SIZE_BYTES)
    return "File exceeds 10 MB — please reduce the size before uploading"
  return ""
}

// ─── Ensure jsQR is loaded (needed for QR decode) ────────────────────────────
function ensureJsQr() {
  if (window.jsQR) return Promise.resolve()
  return new Promise((res, rej) => {
    const s = document.createElement("script")
    s.src = "https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js"
    s.onload = res; s.onerror = rej
    document.head.appendChild(s)
  }).catch(() => {}) // non-fatal — QR decode becomes best-effort
}

// ─── Derive character list from slot scan (fallback when no QR) ───────────────
function deriveCharSourceFromAnchors(pages) {
  let maxCodeCount = 0
  for (const p of pages) {
    if (p.hasCodeAnchors && p.codeAnchorCount > maxCodeCount)
      maxCodeCount = p.codeAnchorCount
  }
  if (maxCodeCount > 0) {
    return { characters: null, charSource: "hgcode", detectedSlots: maxCodeCount }
  }

  let totalContiguous = 0
  for (const p of pages) {
    if (p.contiguousCount >= MIN_TRUSTED_INDEX_TARGETS)
      totalContiguous += p.contiguousCount
  }
  if (totalContiguous >= MIN_TRUSTED_INDEX_TARGETS) {
    return { characters: null, charSource: "index", detectedSlots: totalContiguous }
  }

  return { characters: null, charSource: "none", detectedSlots: 0 }
}

// ─── Derive character list from per-cell HGCHAR tags (most reliable method) ────
// Step 1 writes "HGCHAR:N=<char>" as a tiny hidden element for every cell.
// Short strings are NEVER split by pdfjs — completely immune to base64 splitting.
// Works on digital PDFs AND physical print/scan, as long as the text layer survives.
// Supports combined PDFs: detects when indices reset (new segment) and concatenates.
function extractCharsetFromHgCharTags(pages) {
  if (!pages?.length) return null
  const sorted = [...pages].sort((a, b) => a.pageNumber - b.pageNumber)

  // Group pages into segments — a new segment starts when index 1 reappears
  // on a page whose charByIndex also has index 1 (meaning a new Step1 batch).
  const segments = []
  let segMap = new Map()
  let segHasIndex1 = false

  for (const p of sorted) {
    if (!(p.charByIndex instanceof Map) || p.charByIndex.size === 0) continue
    const hasIndex1 = p.charByIndex.has(1)
    // Start new segment if this page resets to index 1 and previous segment isn't empty
    if (hasIndex1 && segMap.size > 0 && segHasIndex1) {
      segments.push(new Map(segMap))
      segMap = new Map()
      segHasIndex1 = false
    }
    for (const [idx, ch] of p.charByIndex) segMap.set(idx, ch)
    if (hasIndex1) segHasIndex1 = true
  }
  if (segMap.size > 0) segments.push(segMap)
  if (segments.length === 0) return null

  const chars = []
  for (const seg of segments) {
    if (seg.size === 0) continue
    const maxIdx = Math.max(...seg.keys())
    for (let i = 1; i <= maxIdx; i++) {
      if (seg.has(i)) chars.push(seg.get(i))
    }
  }
  return chars.length > 0 ? chars : null
}


// ─── Derive character list from HGMETA page-level tags ────────────────────────
// Step 1 writes "HGMETA:page=N,...,j=<base64>" as font-size:0 invisible text.
// This is the best fallback when the QR *image* cannot be decoded (e.g. after
// print and re-scan), but the PDF was originally saved as a digital file with
// an intact text layer. pdfAnchors already decoded charsFromMeta per page.
// Supports combined PDFs made from multiple Step1 sessions by grouping
// consecutive pages that share the same totalPages value.
function extractCharsetFromHgMetaTags(pages) {
  if (!pages?.length) return null
  const sorted = [...pages].sort((a, b) => a.pageNumber - b.pageNumber)

  const segments = []
  let seg = []
  for (const p of sorted) {
    const m = p.pageMeta
    if (!m || !Number.isFinite(m.cellCount) || m.cellCount < 1) {
      if (seg.length) { segments.push(seg); seg = [] }
      continue
    }
    if (seg.length > 0) {
      const prev = seg[seg.length - 1].pageMeta
      if (m.page === 1 || m.totalPages !== prev.totalPages) {
        segments.push(seg); seg = []
      }
    }
    seg.push(p)
  }
  if (seg.length) segments.push(seg)

  if (segments.length === 0) return null

  const acc = []
  for (const segment of segments) {
    const segChars = []
    let expectedTotal = null
    let broken = false
    for (const p of segment) {
      const m = p.pageMeta
      if (expectedTotal == null && Number.isFinite(m.totalGlyphs)) expectedTotal = m.totalGlyphs
      const c = m.charsFromMeta
      // If any page in segment is missing charsFromMeta, skip this segment only (not all)
      if (!Array.isArray(c) || c.length !== m.cellCount) { broken = true; break }
      segChars.push(...c)
    }
    if (broken || segChars.length === 0) continue
    if (Number.isFinite(expectedTotal) && segChars.length !== expectedTotal) continue
    acc.push(...segChars)
  }

  return acc.length > 0 ? acc : null
}


async function parsePdf(file) {
  await ensureJsQr()

  const bytes = new Uint8Array(await file.arrayBuffer())
  const loadingTask = getDocument({ data: bytes })
  let pdf = null

  try {
    pdf = await loadingTask.promise
  } catch (err) {
    // Handle specific PDF error types with Thai-friendly messages
    if (err?.name === 'InvalidPDFException' || err?.message?.includes('Invalid PDF')) {
      throw new Error('PDF file is corrupted or invalid — please re-export the PDF')
    }
    if (err?.name === 'MissingPDFException') {
      throw new Error('PDF file not found — please try uploading again')
    }
    if (err?.name === 'PasswordException') {
      throw new Error('PDF is password-protected — please unlock it before uploading')
    }
    throw new Error('Could not read PDF: ' + (err?.message ?? 'unknown error'))
  }

  // Dummy try block reopened for page-level processing
  try {
    pdf = pdf  // already assigned above

    const pages = []
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page     = await pdf.getPage(pageNumber)
      const viewport = page.getViewport({ scale: PDF_RENDER_SCALE })
      const canvas   = document.createElement("canvas")
      canvas.width   = Math.floor(viewport.width)
      canvas.height  = Math.floor(viewport.height)
      const ctx = canvas.getContext("2d", { willReadFrequently: true })
      if (!ctx) throw new Error("Failed to create canvas context")

      ctx.fillStyle = "#ffffff"
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      await page.render({ canvasContext: ctx, viewport }).promise

      const anchorInfo = await collectTextAnchors(page, viewport, 9999)
      const imgData    = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const qrMeta     = decodeQRFromImageData(imgData.data, canvas.width, canvas.height)
      const regDots    = detectRegDots(imgData.data, canvas.width, canvas.height)

      pages.push({
        ctx,
        pageWidth:  canvas.width,
        pageHeight: canvas.height,
        imageData:  imgData.data,
        regDots,
        pageNumber,
        anchors:          anchorInfo.anchors,
        anchorByIndex:    anchorInfo.byIndex,
        anchorStartIndex: anchorInfo.startIndex,
        contiguousCount:  anchorInfo.contiguousCount,
        hasCodeAnchors:   anchorInfo.hasCodeAnchors,
        codeAnchorCount:  anchorInfo.codeAnchorCount ?? 0,
        charByIndex:      anchorInfo.charByIndex,   // Map<index, char> from HGCHAR tags
        pageMeta: qrMeta
          ? { ...anchorInfo.pageMeta, ...qrMeta }
          : anchorInfo.pageMeta ?? null,
      })
    }

    // ── Characters from QR (primary source) ──────────────────────────────
    const qrCharset = extractCharsetIfCompleteInQr(pages)
    let characters  = qrCharset ?? null
    let charSource  = qrCharset?.length ? "qr" : null

    const profiledPages = buildAutoPageProfiles(pages, characters ?? [])

    // ── Fallback 1a: HGMETA text tag (base64 charset in invisible text layer) ─
    // Step 1 writes "HGMETA:page=N,...,j=<base64>" as font-size:0 text.
    // pdfjs extracts text layers from digital PDFs reliably — this survives
    // even when the QR *image* is unreadable after print/scan, as long as
    // the PDF was saved digitally (not re-scanned to image-only).
    if (!characters) {
      const metaChars = extractCharsetFromHgMetaTags(profiledPages)
      if (metaChars?.length) {
        characters = metaChars
        charSource  = "qr"   // same confidence — embedded by the template
      }
    }

    // ── Fallback 1b: HGCHAR per-cell tags (robust — short strings, never split) ─
    // Step 1 writes "HGCHAR:N=ก" for every cell. pdfjs always extracts short
    // strings intact, regardless of PDF renderer or print/scan quality.
    if (!characters) {
      const hgCharset = extractCharsetFromHgCharTags(profiledPages)
      if (hgCharset?.length) {
        characters = hgCharset
        charSource  = "qr"   // same confidence as QR — embedded by the template
      }
    }

    // ── Fallback 2: anchor scan only gives slot count, not character names ────
    if (!characters) {
      const fromAnchors = deriveCharSourceFromAnchors(profiledPages)
      charSource = fromAnchors.charSource
      // characters stays null → UI will offer optional manual entry
    }

    let detectedSlots = 0
    if (characters?.length) {
      detectedSlots = characters.length
    } else {
      for (const p of profiledPages) {
        detectedSlots += p.anchorCapacity ?? p.contiguousCount ?? 0
      }
    }

    return {
      file,
      characters:  characters ?? [],   // [] = auto-detection yielded nothing
      charSource:  charSource  ?? "none",
      metadata: {
        pages:         pdf.numPages,
        detectedSlots: Math.max(detectedSlots, 0),
        fileName:      file.name,
        fileSize:      file.size,
      },
      pages: profiledPages,
      status: "parsed",
    }
  } finally {
    if (pdf) { pdf.cleanup(); await pdf.destroy() }
    loadingTask.destroy?.()
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatFileSize(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}
function formatDate(ts) {
  return ts ? new Date(ts).toLocaleString("en-GB") : "—"
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Row({ label, val }) {
  return (
    <div style={{ display:"flex", alignItems:"center", padding:"11px 0", borderBottom:`1px solid ${C.border}` }}>
      <span style={{ flex:1, fontSize:12, color:C.inkMd }}>{label}</span>
      <span style={{ fontSize:12, fontWeight:500, color:C.ink, marginRight:12 }}>{val}</span>
      <div style={{
        width:20, height:20, borderRadius:"50%", background:C.sage,
        display:"flex", alignItems:"center", justifyContent:"center",
        color:"#fff", fontSize:10, fontWeight:700,
      }}>✓</div>
    </div>
  )
}

// Thai combining chars (vowels above/below + tone marks) cannot render standalone.
// Prefix with dotted circle ◌ (U+25CC) so the browser has a base glyph to attach to.
const THAI_COMBINING_RE = /^[\u0E30-\u0E4E]$/
function displayChar(ch) {
  if (!ch) return "·"
  if (THAI_COMBINING_RE.test(ch)) return "\u25CC" + ch   // ◌ + combining char
  return ch
}

/**
 * Read-only expandable grid of detected characters.
 * Shown after successful auto-detection or after manual entry.
 */
function CharacterPreview({ characters }) {
  const [expanded, setExpanded] = useState(false)
  const shown    = expanded ? characters : characters.slice(0, CHAR_PREVIEW_LIMIT)
  const overflow = characters.length - CHAR_PREVIEW_LIMIT

  return (
    <div style={{ marginTop:12 }}>
      <div style={{ display:"flex", flexWrap:"wrap", gap:5 }}>
        {shown.map((ch, i) => (
          <span
            key={i}
            title={`#${i + 1}: ${ch} (U+${ch.codePointAt(0)?.toString(16).toUpperCase().padStart(4,"0")})`}
            style={{
              display:"inline-flex", alignItems:"center", justifyContent:"center",
              minWidth:30, height:30, padding:"0 7px",
              background:C.sageLt, border:`1px solid ${C.sageMd}`,
              borderRadius:7, fontSize:14,
              fontFamily:"'TH Sarabun New',Tahoma,sans-serif",
              color:C.ink, fontWeight:500, userSelect:"none",
            }}
          >
            {displayChar(ch)}
          </span>
        ))}

        {!expanded && overflow > 0 && (
          <button
            onClick={() => setExpanded(true)}
            style={{
              display:"inline-flex", alignItems:"center", justifyContent:"center",
              height:30, padding:"0 10px",
              background:"transparent", border:`1px dashed ${C.borderMd}`,
              borderRadius:7, fontSize:11, color:C.inkMd, cursor:"pointer",
            }}
          >
            +{overflow} more
          </button>
        )}

        {expanded && overflow > 0 && (
          <button
            onClick={() => setExpanded(false)}
            style={{
              display:"inline-flex", alignItems:"center", justifyContent:"center",
              height:30, padding:"0 10px",
              background:"transparent", border:`1px dashed ${C.borderMd}`,
              borderRadius:7, fontSize:11, color:C.inkMd, cursor:"pointer",
            }}
          >
            Show less
          </button>
        )}
      </div>

      <p style={{ fontSize:11, color:C.inkLt, marginTop:6 }}>
        {characters.length} characters • read-only preview
      </p>
    </div>
  )
}

/**
 * Detection status banner.
 * Success → green card + CharacterPreview.
 * Failure → amber card + description of what was (partially) found.
 */
function DetectionStatus({ parsedFile }) {
  const { characters, charSource, metadata } = parsedFile
  const hasChars = characters.length > 0

  // ── Success: QR decoded a full character list ─────────────────────────────
  if (charSource === "qr" && hasChars) {
    return (
      <div style={{
        background:C.sageLt, border:`1px solid ${C.sageMd}`,
        borderRadius:12, padding:"14px 16px", marginBottom:20,
      }}>
        <p style={{ fontSize:13, fontWeight:600, color:C.sage, marginBottom:2 }}>
          🗸  Detected {characters.length} characters from QR
        </p>
        <p style={{ fontSize:11, color:C.inkMd }}>
          Characters automatically extracted from QR code — ready for the next step
        </p>
        <CharacterPreview characters={characters} />
      </div>
    )
  }

  // ── Success: user provided manual characters ──────────────────────────────
  if (charSource === "manual" && hasChars) {
    return (
      <div style={{
        background:C.sageLt, border:`1px solid ${C.sageMd}`,
        borderRadius:12, padding:"14px 16px", marginBottom:20,
      }}>
        <p style={{ fontSize:13, fontWeight:600, color:C.sage, marginBottom:2 }}>
          🗸  Using {characters.length} manually entered characters
        </p>
        <p style={{ fontSize:11, color:C.inkMd }}>
          Entered manually — edit below if needed
        </p>
        <CharacterPreview characters={characters} />
      </div>
    )
  }

  // ── Partial: HG codes found but no character list ─────────────────────────
  if (charSource === "hgcode") {
    return (
      <div style={{
        background:C.amberLt, border:`1px solid ${C.amberMd}`,
        borderRadius:12, padding:"14px 16px", marginBottom:20,
      }}>
        <p style={{ fontSize:13, fontWeight:600, color:C.amber, marginBottom:2 }}>
          ⚠️ Found {metadata.detectedSlots} slots — no character data
        </p>
        <p style={{ fontSize:11, color:C.inkMd }}>
          QR decoded but no character payload (happens when too many characters were selected in Step 1)
          — please enter {metadata.detectedSlots} characters below
        </p>
      </div>
    )
  }

  // ── Partial: numeric index anchors found ──────────────────────────────────
  if (charSource === "index") {
    return (
      <div style={{
        background:C.amberLt, border:`1px solid ${C.amberMd}`,
        borderRadius:12, padding:"14px 16px", marginBottom:20,
      }}>
        <p style={{ fontSize:13, fontWeight:600, color:C.amber, marginBottom:2 }}>
          ⚠️ Found {metadata.detectedSlots} slots — no character data
        </p>
        <p style={{ fontSize:11, color:C.inkMd }}>
          QR decoded but no character payload (happens when too many characters were selected in Step 1)
          — please enter {metadata.detectedSlots} characters below
        </p>
      </div>
    )
  }

  // ── None: no detection signals at all ────────────────────────────────────
  return (
    <div style={{
      background:C.amberLt, border:`1px solid ${C.amberMd}`,
      borderRadius:12, padding:"14px 16px", marginBottom:20,
    }}>
      <p style={{ fontSize:13, fontWeight:600, color:C.amber, marginBottom:2 }}>
        ⚠️ No characters detected
      </p>
      <p style={{ fontSize:11, color:C.inkMd }}>
        No QR / HG code / index found in this file — enter characters below (optional)
      </p>
    </div>
  )
}

/**
 * Optional manual character entry.
 * Rendered ONLY when parsedFile.characters is empty or charSource === "none".
 * Calling onParsed updates characters in the app state without blocking anything.
 */
function ManualCharInput({ parsedFile, onParsed }) {
  const [manualChars, setManualChars] = useState("")

  // Reset textarea whenever a new file is processed
  useEffect(() => { setManualChars("") }, [parsedFile?.file?.name])

  const handleApply = () => {
    if (!parsedFile || !manualChars.trim()) return
    const chars = [...new Set(
      manualChars.split(/[,\s]+/).map(s => s.trim()).filter(Boolean)
    )]
    if (chars.length === 0) return
    onParsed({
      ...parsedFile,
      characters: chars,
      charSource:  "manual",
      metadata: { ...parsedFile.metadata, detectedSlots: chars.length },
    })
  }

  const previewCount = [...new Set(
    manualChars.split(/[,\s]+/).filter(Boolean)
  )].length

  return (
    <div style={{
      background:C.bgCard, border:`1px solid ${C.amberMd}`,
      borderRadius:14, padding:"16px 18px",
    }}>
      <p style={{ fontSize:13, fontWeight:500, color:C.ink, marginBottom:4 }}>
        Enter characters for this file{" "}
        <span style={{ fontSize:11, color:C.inkLt, fontWeight:400 }}>(optional)</span>
      </p>
      <p style={{ fontSize:12, color:C.inkMd, marginBottom:10 }}>
        Separate by space or comma — e.g. A,B,C or A B C D
      </p>
      <textarea
        value={manualChars}
        onChange={e => setManualChars(e.target.value)}
        rows={3}
        placeholder="A B C D E ..."
        style={{
          width:"100%", border:`1px solid ${C.border}`, borderRadius:8,
          padding:"8px 10px", fontSize:14,
          fontFamily:"'TH Sarabun New',Tahoma,sans-serif",
          resize:"vertical", outline:"none",
        }}
      />
      <div style={{ display:"flex", justifyContent:"flex-end", alignItems:"center", gap:10, marginTop:8 }}>
        {manualChars.trim() && (
          <span style={{ fontSize:11, color:C.inkLt }}>
            {previewCount} unique characters
          </span>
        )}
        <Btn
          onClick={handleApply}
          variant="primary"
          size="sm"
          disabled={!manualChars.trim()}
        >
          Use these characters →
        </Btn>
      </div>
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────
/**
 * Props:
 *   parsedFile  — current parsedFile from appState (null if no file yet)
 *   onParsed(parsedFile) — called when parse completes or manual chars applied
 *   onClear()   — called when user removes the file
 */
export default function Step2({ parsedFile, onParsed, onClear }) {
  const [parsing,  setParsing]  = useState(false)
  const [drag,     setDrag]     = useState(false)
  const [error,    setError]    = useState("")
  const [progress, setProgress] = useState("")

  const fileInputRef = useRef(null)
  const cancelRef    = useRef(false)

  // ── Trigger parse immediately on file selection — no user input needed ────
  const processFile = async (file) => {
    const validationError = validatePdf(file)
    if (validationError) { setError(validationError); return }

    setError("")
    setParsing(true)
    setProgress("Opening PDF file…")
    cancelRef.current = false

    try {
      setProgress("Reading and analysing all pages + QR + grid…")
      const result = await parsePdf(file)
      if (cancelRef.current) return
      setProgress("")
      // Emit result immediately — characters populated from PDF, or [] if not found.
      // Manual entry is available as fallback but never blocks this call.
      onParsed(result)
    } catch (err) {
      if (cancelRef.current) return
      setError(err?.message ?? "Failed to read PDF")
      setProgress("")
    } finally {
      if (!cancelRef.current) setParsing(false)
    }
  }

  const handleDrop = e => {
    e.preventDefault(); setDrag(false)
    const file = e.dataTransfer?.files?.[0]
    if (file) processFile(file)
  }
  const handleInputChange = e => {
    const file = e.target.files?.[0]
    if (file) processFile(file)
    e.target.value = ""
  }

  // ── Parsing in progress ───────────────────────────────────────────────────
  if (parsing) {
    return (
      <div className="fade-up" style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:"60px 0", gap:16 }}>
        <div className="spinner" />
        <p style={{ fontSize:13, color:C.inkMd }}>{progress || "Analysing…"}</p>
        <p style={{ fontSize:11, color:C.inkLt }}>Reading QR · scanning anchors · detecting reg-dots per page</p>
        <Btn onClick={() => { cancelRef.current = true; setParsing(false); setProgress("") }} variant="ghost" size="sm">
          Cancel
        </Btn>
      </div>
    )
  }

  // ── No file yet — upload zone ─────────────────────────────────────────────
  if (!parsedFile) {
    return (
      <div className="fade-up">
        <InfoBox>
          PDF files only • Characters are automatically extracted from the QR code on upload
        </InfoBox>
        {error && <InfoBox color="amber">{error}</InfoBox>}

        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf,.pdf"
          onChange={handleInputChange}
          style={{ display:"none" }}
        />
        <div
          onClick={() => fileInputRef.current?.click()}
          onDragOver={e => { e.preventDefault(); setDrag(true) }}
          onDragLeave={() => setDrag(false)}
          onDrop={handleDrop}
          style={{
            border:`2px dashed ${drag ? C.ink : C.borderMd}`,
            borderRadius:16, padding:"52px 32px", textAlign:"center",
            cursor:"pointer", background: drag ? C.bgAccent : C.bgCard,
            transition:"all 0.2s ease",
          }}
        >
          <div style={{ width:52, height:52, borderRadius:"50%", background:C.bgMuted, border:`1px solid ${C.border}`, display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto 16px", color:C.inkMd, fontSize:20 }}>↑</div>
          <p style={{ fontSize:14, fontWeight:500, color:C.ink, marginBottom:6 }}>
            Drop PDF here or click to choose a file
          </p>
          <p style={{ fontSize:12, color:C.inkLt }}>
            Characters extracted from QR automatically · max 10 MB
          </p>
        </div>
      </div>
    )
  }

  // ── File parsed — show detection result ──────────────────────────────────
  // Manual entry shows ONLY when auto-detection produced no characters.
  const needsManualEntry = parsedFile.characters.length === 0

  return (
    <div className="fade-up">
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf,.pdf"
        onChange={handleInputChange}
        style={{ display:"none" }}
      />
      {error && <InfoBox color="amber">{error}</InfoBox>}

      {/* Detection status + optional character preview */}
      <DetectionStatus parsedFile={parsedFile} />

      {/* File card */}
      <div style={{ background:C.bgCard, border:`1px solid ${C.border}`, borderRadius:14, padding:"14px 18px", display:"flex", alignItems:"center", gap:14, marginBottom:12 }}>
        <div style={{ width:40, height:40, borderRadius:10, background:C.bgMuted, display:"flex", alignItems:"center", justifyContent:"center", fontSize:20 }}>📄</div>
        <div style={{ flex:1, minWidth:0 }}>
          <p style={{ fontSize:13, fontWeight:500, color:C.ink, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }} title={parsedFile.file.name}>
            {parsedFile.file.name}
          </p>
          <p style={{ fontSize:11, color:C.inkLt, marginTop:2 }}>
            PDF • {formatFileSize(parsedFile.file.size)} • {parsedFile.metadata.pages} pages
          </p>
        </div>
        <Tag color="sage">Uploaded</Tag>
      </div>

      <div style={{ display:"flex", justifyContent:"flex-end", gap:8, marginBottom:20 }}>
        <Btn onClick={() => fileInputRef.current?.click()} variant="ghost" size="sm">Change file</Btn>
        <Btn onClick={onClear} variant="ghost" size="sm">Remove file</Btn>
      </div>

      {/* Parse result table */}
      <div style={{ background:C.bgCard, border:`1px solid ${C.border}`, borderRadius:14, padding:"16px 18px", marginBottom:20 }}>
        <p style={{ fontSize:11, fontWeight:500, letterSpacing:"0.08em", textTransform:"uppercase", color:C.inkLt, marginBottom:4 }}>
          Parse Result
        </p>
        <Row label="File type"       val="PDF" />
        <Row label="File size"        val={formatFileSize(parsedFile.file.size)} />
        <Row label="Pages"            val={parsedFile.metadata.pages} />
        <Row label="Detected slots"   val={parsedFile.metadata.detectedSlots || "—"} />
        <Row label="Character source" val={
          parsedFile.charSource === "qr"     ? "QR code"     :
          parsedFile.charSource === "hgcode" ? "HG code"     :
          parsedFile.charSource === "index"  ? "Index number":
          parsedFile.charSource === "manual" ? "Manual entry":
          "None"
        } />
        <Row label="Characters found" val={parsedFile.characters.length || "—"} />
        <div style={{ display:"flex", alignItems:"center", padding:"11px 0" }}>
          <span style={{ flex:1, fontSize:12, color:C.inkMd }}>Last modified</span>
          <span style={{ fontSize:12, fontWeight:500, color:C.ink, marginRight:12 }}>{formatDate(parsedFile.file.lastModified)}</span>
          <div style={{ width:20, height:20, borderRadius:"50%", background:C.sage, display:"flex", alignItems:"center", justifyContent:"center", color:"#fff", fontSize:10 }}>✓</div>
        </div>
      </div>

      {/* Manual character entry — optional fallback, shown only when auto-detection failed */}
      {needsManualEntry && (
        <ManualCharInput parsedFile={parsedFile} onParsed={onParsed} />
      )}
    </div>
  )
}
