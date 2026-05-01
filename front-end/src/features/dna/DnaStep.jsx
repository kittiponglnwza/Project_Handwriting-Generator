/**
 * Step4.jsx — Hybrid Font Generator (v2 — Production Grade)
 *
 * Architecture:
 *   Step4.jsx          UI shell, state machine, tab routing
 *   domains/font-compilation/fontBuilder  opentype.js compilation engine
 *   domains/font-compilation/metrics      per-glyph smart advance width + bbox
 *   domains/font-compilation/thaiFeatures GSUB salt/calt + GPOS mark-to-base
 *   domains/font-compilation/download     safe Blob download + JSZip export
 *
 * Props:
 *   glyphs: Glyph[]  — from appState.glyphResult.glyphs
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Btn from '../../shared/components/Btn'
import { DOCUMENT_SEED } from '../../lib/documentSeed.js'
import C from '../../styles/colors'

// Font builder modules
import {
  buildGlyphMap,
  compileFontBuffer,
  buildMetadata,
  buildExportGlyphMap,
  validateSvgPath,
} from '../../engine/font/fontBuilder.js'
import { getGlyphClass, isThaiNonSpacing } from '../../engine/font/metrics.js'
import { downloadBuffer, downloadJSON, downloadFontZip } from '../../engine/font/exportAdapters/index.js'

// Sub-components (extracted from this file for modularity)
import { CompileLog }      from './CompileLog.jsx'
import { FontStylePanel }  from './FontStylePanel.jsx'
import { ExportButtons }   from './ExportButtons.jsx'

// ─── Design tokens ─────────────────────────────────────────────────────────────
const FONT_NAME = 'MyHandwriting'

const DEFAULT_STYLE  = { roughness: 30, neatness: 50, slant: 0, boldness: 100, randomness: 40 }
const VARIANT_KEYS   = ['default', 'alt1', 'alt2', 'alt3', 'alt4']
const STORAGE_KEY    = 'dna_variant_styles_v2'

function loadVariantStyles() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (VARIANT_KEYS.every(k => parsed[k])) return parsed
  } catch {}
  return null
}
function saveVariantStyles(styles) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(styles)) } catch {}
}
function makeDefaultVariantStyles() {
  return {
    default: { ...DEFAULT_STYLE },
    alt1:    { ...DEFAULT_STYLE, slant: 5,  roughness: 40 },
    alt2:    { ...DEFAULT_STYLE, slant: 10, roughness: 60, randomness: 60 },
    alt3:    { ...DEFAULT_STYLE, slant: 3,  boldness: 85,  randomness: 30 },
    alt4:    { ...DEFAULT_STYLE, roughness: 70, randomness: 80 },
  }
}

// Log level → colour
const LOG_COLORS = {
  info:    C.inkMd,
  warn:    C.amber,
  error:   C.blush,
  success: C.sage,
}

// ─── Sub-components ────────────────────────────────────────────────────────────

/** Horizontal progress bar */
// ── Auto viewBox from path bounding box ─────────────────────────────────────
function computeViewBox(svgPath, pad = 8) {
  if (!svgPath) return '0 0 100 100'
  const nums = []
  const re = /[MLCQ]\s*([-\d.]+)\s+([-\d.]+)/g
  let m
  while ((m = re.exec(svgPath)) !== null) {
    nums.push({ x: parseFloat(m[1]), y: parseFloat(m[2]) })
  }
  if (nums.length === 0) return '0 0 100 100'
  const xs = nums.map(p => p.x), ys = nums.map(p => p.y)
  const minX = Math.min(...xs) - pad
  const minY = Math.min(...ys) - pad
  return `${minX} ${minY} ${Math.max(...xs) - minX + pad} ${Math.max(...ys) - minY + pad}`
}


function ProgressBar({ pct, label, sublabel }) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5, alignItems: 'flex-end' }}>
        <span style={{ fontSize: 12, color: C.inkMd, fontFamily: 'monospace', maxWidth: '80%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {label}
        </span>
        <span style={{ fontSize: 11, color: C.inkLt, flexShrink: 0 }}>{pct}%</span>
      </div>
      <div style={{ height: 6, background: C.bgMuted, borderRadius: 3, overflow: 'hidden' }}>
        <div style={{
          height: '100%', width: `${Math.max(0, Math.min(100, pct))}%`,
          background: `linear-gradient(90deg, ${C.sage}, #2C8A5A)`,
          borderRadius: 3, transition: 'width 0.3s ease',
        }} />
      </div>
      {sublabel && (
        <div style={{ fontSize: 10, color: C.inkLt, marginTop: 3 }}>{sublabel}</div>
      )}
    </div>
  )
}

/** Build log panel */
function BuildLogPanel({ entries, maxLines = 120 }) {
  const bottomRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [entries])

  const visible = entries.slice(-maxLines)

  return (
    <div style={{
      background: '#13110C', borderRadius: 10, padding: '12px 14px',
      fontFamily: 'monospace', fontSize: 10.5, lineHeight: 1.75,
      maxHeight: 220, overflowY: 'auto',
      border: `1px solid #2A2318`,
    }}>
      {visible.length === 0 && (
        <span style={{ color: '#4A3F30' }}>— no log entries yet —</span>
      )}
      {visible.map((entry, i) => (
        <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <span style={{ color: '#3A3228', flexShrink: 0 }}>
            {new Date(entry.ts).toISOString().slice(11, 19)}
          </span>
          <span style={{
            color: LOG_COLORS[entry.level] ?? C.inkMd,
            wordBreak: 'break-all',
          }}>
            {entry.msg}
          </span>
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  )
}

/** OT feature status badge */
function FeatureBadge({ tag, status }) {
  const on = status?.enabled
  const real = status?.real
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      background: on ? 'rgba(74,124,111,0.18)' : 'rgba(255,255,255,0.04)',
      border: `1px solid ${on ? '#4A7C6F' : '#3A3228'}`,
      borderRadius: 7, padding: '4px 10px',
    }}>
      <span style={{
        fontFamily: 'monospace', fontSize: 12,
        color: on ? '#7CC4B0' : '#5C5340',
        fontWeight: 600,
      }}>{tag}</span>
      {real && on && (
        <span style={{
          fontSize: 8, background: C.sageLt, color: C.sage,
          borderRadius: 3, padding: '1px 4px', letterSpacing: '0.05em',
        }}>REAL</span>
      )}
      {!on && (
        <span style={{ fontSize: 9, color: '#4A3F30' }}>reserved</span>
      )}
    </div>
  )
}

/** Glyph variant thumbnail */
function VariantThumb({ ch, svgPath, viewBox = '0 0 100 100', label, borderColor, isActive }) {
  const valid = validateSvgPath(svgPath).valid
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}>
      <div style={{
        width: 72, height: 72, background: '#fff',
        border: `2px solid ${isActive ? C.sage : borderColor || C.border}`,
        borderRadius: 10,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        overflow: 'hidden',
        boxShadow: isActive ? `0 0 0 3px ${C.sageLt}` : 'none',
        transition: 'all 0.15s',
      }}>
        {valid ? (
          <svg viewBox={computeViewBox(svgPath)} style={{ width: '90%', height: '90%', overflow: 'hidden' }} preserveAspectRatio="xMidYMid meet">
            <path d={svgPath} fill="none" stroke={C.ink} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : (
          <span style={{ fontSize: 30, color: C.inkMd, lineHeight: 1 }}>{ch}</span>
        )}
      </div>
      <span style={{ fontSize: 9, color: C.inkLt, fontFamily: 'monospace', textAlign: 'center', maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {label}
      </span>
    </div>
  )
}

/** Stat card */
function StatCard({ label, value, sub, accent }) {
  return (
    <div style={{
      background: C.bgCard, border: `1px solid ${C.border}`,
      borderRadius: 12, padding: '14px 12px', textAlign: 'center',
      borderTop: accent ? `3px solid ${C.sage}` : undefined,
    }}>
      <p style={{ fontFamily: "'DM Serif Display', serif", fontSize: 26, fontWeight: 400, color: C.ink }}>{value}</p>
      <p style={{ fontSize: 10, color: C.inkMd, marginTop: 3 }}>{label}</p>
      {sub && <p style={{ fontSize: 9, color: C.inkLt, marginTop: 2 }}>{sub}</p>}
    </div>
  )
}

/** Skipped glyphs warning panel */
function SkippedGlyphsPanel({ skipped }) {
  if (!skipped || skipped.length === 0) return null
  return (
    <div style={{
      background: C.amberLt, border: `1px solid ${C.amberMd}`,
      borderRadius: 10, padding: '12px 16px', marginTop: 12,
    }}>
      <p style={{ fontSize: 12, color: C.amber, fontWeight: 600, marginBottom: 6 }}>
        ⚠ {skipped.length} glyph(s) skipped (malformed paths)
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, maxHeight: 100, overflowY: 'auto' }}>
        {skipped.map((s, i) => (
          <div key={i} title={s.reason} style={{
            background: '#FFF8EC', border: `1px solid ${C.amberMd}`,
            borderRadius: 5, padding: '2px 7px',
            fontFamily: 'monospace', fontSize: 11, color: C.amber,
            cursor: 'default',
          }}>
            {s.ch} <span style={{ fontSize: 9, color: C.inkLt }}>({s.reason})</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/** Live font preview textarea with PUA rotation for real handwriting variation */
function FontPreviewPane({ fontName, ttfBuffer, buildSeed, puaMap }) {
  const [previewText, setPreviewText] = useState(
`My name is Krittipong. I am a Computer Science student at King Mongkut's University of Technology North Bangkok. I enjoy coding, building projects, and learning new technologies. I have experience in robotics competitions and won several awards. My goal is to improve my programming skills and create successful projects in the future. I am hardworking, creative, and always ready to learn something new.

ABCDEFGHIJKLMNOPQRSTUVWXYZ
abcdefghijklmnopqrstuvwxyz

0123456789
!@#$%^&*()-+=

This is TopZ's project`
)
  const [fontSize, setFontSize] = useState(42)
  const [fontLoaded, setFontLoaded] = useState(false)
  const [bgMode, setBgMode] = useState('white')

  // seed-based font family name เพื่อกัน browser font cache ระหว่าง builds
  const seedTag    = (buildSeed ?? 0).toString(36).slice(2, 8)
  const fontStyleId = `font-preview-${fontName.replace(/\s+/g, '-')}-${seedTag}`
  const fontFamilyName = `${fontName}-${seedTag}`
  const fontFamily = `'${fontFamilyName}'`

  useEffect(() => {
    if (!ttfBuffer) { setFontLoaded(false); return }
    const existing = document.getElementById(fontStyleId)
    if (existing) existing.remove()
    const blob  = new Blob([ttfBuffer], { type: 'font/ttf' })
    const url   = URL.createObjectURL(blob)
    const style = document.createElement('style')
    style.id    = fontStyleId
    style.textContent = `@font-face { font-family: '${fontFamilyName}'; src: url('${url}') format('truetype'); font-display: block; }`
    document.head.appendChild(style)
    if (typeof FontFace !== 'undefined') {
      const ff = new FontFace(fontFamilyName, `url('${url}')`, { display: 'block' })
      ff.load().then(() => { document.fonts.add(ff); setFontLoaded(true) })
        .catch(() => setTimeout(() => setFontLoaded(true), 300))
    } else {
      setTimeout(() => setFontLoaded(true), 300)
    }
    return () => { style.remove(); URL.revokeObjectURL(url); setFontLoaded(false) }
  }, [ttfBuffer, fontFamilyName])

  // ── Mulberry32 seeded PRNG ────────────────────────────────────────────────
  const makePrng = (seed) => {
    let _s = ((seed ?? Math.random()) * 2654435761) >>> 0
    return () => {
      _s += 0x6D2B79F5
      let t = _s
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }

  // ── Build per-character render tokens: variant codepoint + micro CSS jitter ──
  const renderTokens = useMemo(() => {
    if (!fontLoaded || !puaMap) return null
    const rand = makePrng(buildSeed)

    let isWordStart = true
    const lastCp = {}
    const tokens = []

    for (const ch of previewText) {
      if (ch === '\n' || ch === '\r') {
        tokens.push({ ch, type: 'newline' })
        isWordStart = true
        continue
      }
      if (ch === ' ') {
        tokens.push({ ch, type: 'space' })
        isWordStart = true
        continue
      }

      const entry = puaMap.get(ch)
      if (!entry) {
        tokens.push({ ch, type: 'plain' })
        isWordStart = false
        continue
      }

      const seq = entry.rotationSequence ?? [entry.default, entry.alt1, entry.alt2, entry.alt3, entry.alt4]

      // Variant selection — no repeat, word-start = default
      let cp
      if (isWordStart) {
        cp = seq[0]
      } else {
        const pool = seq.filter(c => c !== lastCp[ch])
        cp = (pool.length > 0 ? pool : seq)[Math.floor(rand() * (pool.length > 0 ? pool.length : seq.length))]
      }
      lastCp[ch] = cp
      isWordStart = false

      // Micro-humanization: CSS-level noise per character
      // ตัวแรกของคำ noise น้อยมาก (beauty rule), ตัวถัดไป noise เต็ม
      const isFirst = cp === seq[0]
      const n = isFirst ? 0.2 : 1.0

      tokens.push({
        ch, type: 'glyph', cp,
        // baseline drift ±1.8% em
        baselineShift: (rand() - 0.5) * 0.036 * n,
        // letter-spacing ±1.5% em
        letterSpacingEm: (rand() - 0.5) * 0.03 * n,
        // micro-rotate ±0.8°
        rotate: (rand() - 0.5) * 1.6 * n,
        // x-scale ±1.5%
        scaleX: 1 + (rand() - 0.5) * 0.03 * n,
      })
    }
    return tokens
  }, [fontLoaded, puaMap, previewText, buildSeed])

  const bgStyles = {
    white: { background: '#FEFCF8', color: '#1A1410' },
    dark:  { background: '#1A1410', color: '#F0EBE0' },
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <span style={{
          fontSize: 11, padding: '3px 10px', borderRadius: 6,
          background: fontLoaded ? '#EBF5EE' : C.amberLt,
          color: fontLoaded ? '#2E6B3E' : C.amber,
          border: `1px solid ${fontLoaded ? '#A8D5B5' : C.amberMd}`,
          fontWeight: 500,
        }}>
          {fontLoaded ? '✓ Font loaded' : '⟳ Loading…'}
        </span>

        {fontLoaded && puaMap && (
          <span style={{
            fontSize: 10, padding: '2px 8px', borderRadius: 5,
            background: '#EEF5FB', color: '#3A6A9A',
            border: '1px solid #B8D4EC', fontFamily: 'monospace',
          }}>
            🎲 variant rotation ON ({puaMap.size} chars)
          </span>
        )}

        <div style={{ display: 'flex', background: '#F2EDE4', borderRadius: 8, padding: 3, gap: 2 }}>
          {[['white','☀'], ['dark','🌙']].map(([m, icon]) => (
            <button key={m} onClick={() => setBgMode(m)} style={{
              background: bgMode === m ? '#fff' : 'transparent',
              border: bgMode === m ? '1px solid #DDD8CE' : '1px solid transparent',
              borderRadius: 6, padding: '3px 10px', cursor: 'pointer',
              fontSize: 12, transition: 'all 0.15s',
              boxShadow: bgMode === m ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
            }}>{icon}</button>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto', background: '#F2EDE4', borderRadius: 8, padding: '5px 12px' }}>
          <span style={{ fontSize: 11, color: '#8A7B62', fontWeight: 500 }}>Size</span>
          <input
            type="range" min={16} max={120} value={fontSize}
            onChange={e => setFontSize(Number(e.target.value))}
            style={{ width: 120, accentColor: '#2C2416' }}
          />
          <span style={{ fontSize: 12, color: '#1A1410', fontWeight: 700, fontVariantNumeric: 'tabular-nums', minWidth: 38, textAlign: 'right' }}>{fontSize}px</span>
        </div>
      </div>

      {/* Edit area: textarea สำหรับ input, div สำหรับ render font จริง */}
      <div style={{ position: 'relative' }}>
        {/* Invisible textarea สำหรับรับ input */}
        <textarea
          value={previewText}
          onChange={e => setPreviewText(e.target.value)}
          style={{
            position: 'absolute', top: 0, left: 0,
            width: '100%', height: '100%', boxSizing: 'border-box',
            opacity: fontLoaded ? 0 : 1,  // ซ่อนเมื่อ font โหลดแล้ว
            resize: 'none', border: 'none', outline: 'none',
            fontFamily: 'monospace', fontSize, lineHeight: 1.6,
            padding: '20px 24px',
            background: 'transparent', color: 'transparent',
            caretColor: bgMode === 'dark' ? '#F0EBE0' : '#1A1410',
            zIndex: 2,
          }}
          spellCheck={false}
        />
        {/* Font display layer */}
        <div
          style={{
            width: '100%', boxSizing: 'border-box',
            minHeight: 420,
            fontFamily: fontLoaded ? `${fontFamily}, cursive` : 'cursive',
            fontSize, lineHeight: 1.6,
            padding: '20px 24px',
            border: `1.5px solid ${fontLoaded ? '#A8D5B5' : '#DDD8CE'}`,
            borderRadius: 12,
            ...bgStyles[bgMode],
            whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            overflowWrap: 'break-word',
            boxShadow: '0 2px 12px rgba(44,36,22,0.06)',
            pointerEvents: 'none',
            userSelect: 'none',
          }}
        >
          {renderTokens
            ? renderTokens.length === 0
              ? <span style={{ opacity: 0.3 }}>Type here to preview the font…</span>
              : renderTokens.map((tok, i) => {
                  if (tok.type === 'newline') return <br key={i} />
                  if (tok.type === 'space')   return <span key={i}> </span>
                  if (tok.type === 'plain')   return <span key={i}>{tok.ch}</span>
                  // type === 'glyph': render with micro-humanization CSS
                  return (
                    <span key={i} style={{
                      display:         'inline-block',
                      position:        'relative',
                      top:             `${tok.baselineShift}em`,
                      letterSpacing:   `${tok.letterSpacingEm}em`,
                      transform:       `rotate(${tok.rotate}deg) scaleX(${tok.scaleX})`,
                      transformOrigin: 'bottom center',
                      willChange:      'transform',
                    }}>
                      {String.fromCodePoint(tok.cp)}
                    </span>
                  )
                })
            : previewText || <span style={{ opacity: 0.3 }}>Type here to preview the font…</span>
          }
        </div>
        {/* Click-to-edit overlay when font loaded */}
        {fontLoaded && (
          <textarea
            value={previewText}
            onChange={e => setPreviewText(e.target.value)}
            style={{
              position: 'absolute', top: 0, left: 0,
              width: '100%', height: '100%', boxSizing: 'border-box',
              opacity: 0, resize: 'none',
              border: 'none', outline: 'none', background: 'transparent',
              fontSize, lineHeight: 1.6, padding: '20px 24px',
              cursor: 'text', zIndex: 3,
            }}
            spellCheck={false}
          />
        )}
      </div>

      {!ttfBuffer && (
        <p style={{ fontSize: 11, color: C.inkLt, marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>⟳</span>
          Auto-building font…
        </p>
      )}
    </div>
  )
}

/** Install guide panel */
function InstallGuidePanel({ fontName }) {
  const [os, setOs] = useState('mac')
  const steps = {
    mac: [
      `Double-click ${fontName}.ttf`,
      'Click "Install Font" in the bottom-left corner',
      'Font will appear in Font Book and be ready to use',
    ],
    win: [
      `Right-click ${fontName}.ttf`,
      'Choose "Install" (current user) or "Install for all users"',
      'Font will be available in Word, Photoshop, etc.',
    ],
    linux: [
      `mkdir -p ~/.local/share/fonts`,
      `cp ${fontName}.ttf ~/.local/share/fonts/`,
      `fc-cache -fv`,
      'Font ready in all applications',
    ],
    web: [
      `Copy ${fontName}.ttf and ${fontName}.woff to your server`,
      'Add @font-face in CSS (see fontface.css in ZIP)',
      `font-family: '${fontName}'; font-feature-settings: "calt" 1, "salt" 1;`,
    ],
  }
  const OS_TABS = [
    { id: 'mac',   label: '🍎 macOS' },
    { id: 'win',   label: '🪟 Windows' },
    { id: 'linux', label: '🐧 Linux' },
    { id: 'web',   label: '🌐 Web CSS' },
  ]
  return (
    <div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 12, flexWrap: 'wrap' }}>
        {OS_TABS.map(t => (
          <button key={t.id} onClick={() => setOs(t.id)} style={{
            background: os === t.id ? C.ink : C.bgMuted,
            color:      os === t.id ? '#FBF9F5' : C.inkMd,
            border: 'none', borderRadius: 7, padding: '5px 12px',
            fontSize: 11, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif",
          }}>{t.label}</button>
        ))}
      </div>
      <ol style={{ margin: 0, paddingLeft: 20 }}>
        {steps[os].map((step, i) => (
          <li key={i} style={{
            fontSize: 12, color: C.inkMd, lineHeight: 1.9,
            fontFamily: (os === 'linux' || os === 'web') ? 'monospace' : 'inherit',
            background: (os === 'linux' || os === 'web') ? C.bgMuted : 'transparent',
            padding: (os === 'linux' || os === 'web') ? '2px 8px' : 0,
            borderRadius: 4, marginBottom: 4,
          }}>{step}</li>
        ))}
      </ol>
    </div>
  )
}

export default function DnaControls({ glyphs = [], fontStyle, onFontStyleChange, onFontReady }) {
  const [buildState,   setBuildState]   = useState('idle')
  const [progress,     setProgress]     = useState({ pct: 0, label: '' })
  const [buildResult,  setBuildResult]  = useState(null)
  const [errorMsg,     setErrorMsg]     = useState('')
  const [previewChar,  setPreviewChar]  = useState(null)
  const [activeTab,    setActiveTab]    = useState('overview')
  const [buildLog,     setBuildLog]     = useState([])
  const [showLog,      setShowLog]      = useState(false)
  const [fontName,     setFontName]     = useState(FONT_NAME)
  const [fontNameError, setFontNameError] = useState('')
  const [debugMode,    setDebugMode]    = useState(false)
  const [debugChars,   setDebugChars]   = useState('mn')
  const [selectedVariant, setSelectedVariant] = useState('default')

  // Per-variant font styles — persisted to localStorage
  const [variantStyles, setVariantStyles] = useState(() => loadVariantStyles() ?? makeDefaultVariantStyles())

  const activeVariantStyle = variantStyles[selectedVariant] ?? DEFAULT_STYLE

  const handleVariantStyleChange = (key, value) => {
    setVariantStyles(prev => {
      const next = { ...prev, [selectedVariant]: { ...prev[selectedVariant], [key]: value } }
      saveVariantStyles(next)
      return next
    })
  }

  const handleResetVariantStyle = () => {
    setVariantStyles(prev => {
      const next = { ...prev, [selectedVariant]: { ...DEFAULT_STYLE } }
      saveVariantStyles(next)
      return next
    })
  }

  const hasGlyphs = glyphs.length > 0
  const [buildSeed, setBuildSeed] = useState(() => Math.random())
  const glyphMap   = useMemo(() => hasGlyphs ? buildGlyphMap(glyphs, buildSeed) : new Map(), [glyphs, hasGlyphs, buildSeed])
  const entries    = useMemo(() => Array.from(glyphMap.entries()), [glyphMap])
  const charCount  = glyphMap.size
  const totalVariants = charCount * 5

  const thaiCount  = useMemo(() =>
    entries.filter(([, d]) => d.codepoint >= 0x0E00 && d.codepoint <= 0x0E7F).length,
  [entries])
  const latinCount = charCount - thaiCount

  useEffect(() => {
    if (entries.length > 0 && !previewChar) setPreviewChar(entries[0][0])
  }, [entries])

  const buildStateRef = useRef(buildState)
  useEffect(() => { buildStateRef.current = buildState }, [buildState])

  // fontStyle ref — อ่านค่าล่าสุดใน handleBuild โดยไม่ต้องใส่ใน deps
  const fontStyleRef = useRef(fontStyle)
  useEffect(() => { fontStyleRef.current = fontStyle }, [fontStyle])

  const variantStylesRef = useRef(variantStyles)
  useEffect(() => { variantStylesRef.current = variantStyles }, [variantStyles])

  // handleBuild ref — ให้ useEffects เรียกได้โดยไม่ต้องใส่ handleBuild ใน deps
  const handleBuildRef = useRef(null)

  const handleBuild = useCallback(async () => {
    if (!hasGlyphs || buildStateRef.current === 'building') return
    const newSeed = Math.random()
    setBuildSeed(newSeed)
    setBuildState('building')
    setErrorMsg('')
    setBuildResult(null)
    setBuildLog([])

    const onProgress = (msg, pct, logEntry) => {
      setProgress({ pct: pct ?? 0, label: msg })
      if (logEntry) setBuildLog(prev => [...prev, logEntry])
    }

    try {
      await new Promise(r => setTimeout(r, 60))

      // build freshGlyphMap ด้วย newSeed ตรงๆ — ไม่ใช้ useMemo ที่ยัง stale
      const freshGlyphMap = buildGlyphMap(glyphs, newSeed)

      const result = await compileFontBuffer(freshGlyphMap, fontName, onProgress, newSeed, fontStyleRef.current, variantStylesRef.current)
      const {
        ttfBuffer, woffBuffer, glyphCount,
        skipped, buildLog: newLog, glyphInfo, featureStatus: fStatus,
        puaMap,
      } = result

      setBuildLog(newLog)

      const exportGlyphMap = buildExportGlyphMap(freshGlyphMap, glyphInfo)
      const metadata       = buildMetadata({
        fontName, glyphMap: freshGlyphMap, glyphInfo, glyphCount,
        skipped, featureStatus: fStatus,
      })

      setBuildResult({
        ttfBuffer, woffBuffer, glyphCount,
        skipped, glyphInfo, exportGlyphMap, metadata,
        featureStatus: fStatus,
        puaMap,
      })
      setBuildState('done')

      onFontReady?.({ ttfBuffer, puaMap })
    } catch (err) {
      console.error('[Step4] Font build failed:', err)
      setErrorMsg(err.message || 'Unknown compilation error')
      setBuildState('error')
      setBuildLog(prev => [
        ...prev,
        { level: 'error', msg: `Build failed: ${err.message}`, ts: Date.now() },
      ])
    }
  }, [hasGlyphs, glyphMap, fontName])

  handleBuildRef.current = handleBuild

  // Auto-build when glyphs are ready
  useEffect(() => {
    if (hasGlyphs && buildStateRef.current === 'idle') {
      const t = setTimeout(() => {
        if (buildStateRef.current === 'idle') handleBuildRef.current?.()
      }, 100)
      return () => clearTimeout(t)
    }
  }, [hasGlyphs])

  // Re-fire onFontReady when component mounts and build is done
  useEffect(() => {
    if (buildState === 'done' && buildResult?.ttfBuffer) {
      onFontReady?.({ ttfBuffer: buildResult.ttfBuffer, puaMap: buildResult.puaMap ?? new Map() })
    }
  }, [])

  // Auto-rebuild when fontStyle changes (debounced 600ms)
  useEffect(() => {
    if (!hasGlyphs || !fontStyle) return
    const t = setTimeout(() => {
      if (buildStateRef.current !== 'building') handleBuildRef.current?.()
    }, 600)
    return () => clearTimeout(t)
  }, [fontStyle, hasGlyphs])

  const previewData = useMemo(() => {
    if (!previewChar || !glyphMap.has(previewChar)) return null
    return glyphMap.get(previewChar)
  }, [previewChar, glyphMap])

  const previewGlyph = useMemo(() => {
    if (!previewChar) return null
    return glyphs.find(g =>
      g.ch === previewChar &&
      (g.status === 'ok' || ['excellent', 'good', 'acceptable'].includes(g._visionStatus))
    ) ?? null
  }, [previewChar, glyphs])

  const featureStatus = buildResult?.featureStatus ?? null

  // Downloads
  const handleDownloadTTF  = () => downloadBuffer(buildResult.ttfBuffer,  `${fontName}.ttf`,  'font/ttf')
  const handleDownloadWOFF = () => downloadBuffer(buildResult.woffBuffer, `${fontName}.woff`, 'font/woff')
  const handleDownloadMeta = () => downloadJSON(buildResult.metadata,       'metadata.json')
  const handleDownloadMap  = () => downloadJSON(buildResult.exportGlyphMap, 'glyphMap.json')
  const handleDownloadZip  = () => downloadFontZip({
    fontName,
    ttfBuffer:   buildResult.ttfBuffer,
    woffBuffer:  buildResult.woffBuffer,
    glyphMapObj: buildResult.exportGlyphMap,
    metadataObj: buildResult.metadata,
    buildLog:    buildLog.map(e => `[${e.level.toUpperCase()}] ${e.msg}`),
  })

  // Tabs
  const TABS = [
    { id: 'overview',  label: 'Overview' },
    { id: 'glyphs',    label: `Glyphs (${charCount})` },
    { id: 'preview',   label: 'Preview' },
    { id: 'download',  label: '⬇ Download' },
  ]

  return (
    <div className="fade-up">
      {/* Header */}
      <div style={{
        background: 'linear-gradient(135deg, #1A1410 0%, #2C2416 100%)',
        borderRadius: 16, padding: '18px 24px', marginBottom: 20,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: 12,
      }}>
        <div>
          <p style={{ fontSize: 18, fontFamily: "'DM Serif Display', serif", color: '#F0EBE0', fontWeight: 400 }}>
            Hybrid Font Generator
            <span style={{ fontSize: 12, color: '#5C5340', fontFamily: 'monospace', marginLeft: 8 }}>v3.0</span>
          </p>
          <p style={{ fontSize: 11, color: '#7A6E58', marginTop: 3 }}>
            Real TTF + WOFF · GSUB salt/calt · Smart per-glyph metrics
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {/* ── Random font seed button ── */}
          <button
            onClick={() => { if (hasGlyphs) handleBuild() }}
            disabled={!hasGlyphs || buildState === 'building'}
            title="Randomise glyph variant assignment seed"
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '5px 12px', borderRadius: 8, fontSize: 11,
              background: hasGlyphs ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.15)',
              color: hasGlyphs ? '#F0EBE0' : '#5C5340',
              cursor: hasGlyphs ? 'pointer' : 'not-allowed',
              fontFamily: "'DM Sans', sans-serif",
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => { if (hasGlyphs) e.currentTarget.style.background = 'rgba(255,255,255,0.18)' }}
            onMouseLeave={e => e.currentTarget.style.background = hasGlyphs ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.04)'}
          >
            <span style={{ fontSize: 13 }}>🎲</span> Random Font
          </button>
          {/* ── Debug m/n toggle ── */}
          <button
            onClick={() => setDebugMode(v => !v)}
            title="Highlight specific characters across all variants"
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '5px 12px', borderRadius: 8, fontSize: 11,
              background: debugMode ? 'rgba(192,80,58,0.25)' : 'rgba(255,255,255,0.06)',
              border: `1px solid ${debugMode ? 'rgba(192,80,58,0.5)' : 'rgba(255,255,255,0.12)'}`,
              color: debugMode ? '#FFB8A8' : '#9E9278',
              cursor: 'pointer', fontFamily: "'DM Sans', sans-serif",
              transition: 'all 0.15s',
            }}
          >
            <span style={{ fontSize: 12 }}>🔍</span> Debug
          </button>
        </div>
      </div>

      {/* ── Debug m/n panel ── */}
      {debugMode && (
        <div style={{
          background: 'linear-gradient(135deg, #2A1810, #3A1C10)',
          border: '1px solid rgba(192,80,58,0.35)',
          borderRadius: 12, padding: '14px 18px', marginBottom: 16,
          display: 'flex', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap',
        }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <p style={{ fontSize: 11, fontWeight: 600, color: '#FFB8A8', marginBottom: 8, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              🔍 Debug: Highlight Characters
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <input
                value={debugChars}
                onChange={e => setDebugChars(e.target.value)}
                placeholder="e.g. mn or กขค"
                maxLength={20}
                style={{
                  background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)',
                  borderRadius: 7, padding: '6px 12px', fontSize: 13, color: '#F0EBE0',
                  fontFamily: 'monospace', outline: 'none', width: 160,
                }}
              />
              <p style={{ fontSize: 10, color: '#7A5040' }}>chars highlighted across all 5 variants below</p>
            </div>
          </div>
          {/* Highlighted preview */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {[...new Set(debugChars.split(''))].filter(ch => ch.trim() && glyphMap.has(ch)).map(ch => {
              const g = glyphs.find(x => x.ch === ch)
              const valid = validateSvgPath(g?.svgPath).valid
              return (
                <div key={ch} style={{ textAlign: 'center' }}>
                  <p style={{ fontSize: 9, color: '#7A5040', marginBottom: 4, fontFamily: 'monospace' }}>U+{ch.codePointAt(0).toString(16).toUpperCase().padStart(4,'0')}</p>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {[1,2,3,4,5].map(ver => {
                      const vg = glyphs.find(x => x.ch === ch && x.version === ver) ?? g
                      const vPath = vg?.svgPath
                      return (
                        <div key={ver} style={{
                          width: 48, height: 48, background: 'rgba(255,255,255,0.06)',
                          border: '1.5px solid rgba(192,80,58,0.5)', borderRadius: 8,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                          {vPath && validateSvgPath(vPath).valid ? (
                            <svg viewBox={computeViewBox(vPath)} style={{ width: '85%', height: '85%' }} preserveAspectRatio="xMidYMid meet">
                              <path d={vPath} fill="none" stroke="#FFB8A8" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          ) : (
                            <span style={{ fontSize: 18, color: '#FFB8A8' }}>{ch}</span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                  <p style={{ fontSize: 9, color: '#F0EBE0', marginTop: 4, fontWeight: 600 }}>{ch}</p>
                  <div style={{ display: 'flex', gap: 4, justifyContent: 'center', marginTop: 2 }}>
                    {['v1','v2','v3','v4','v5'].map(v => <p key={v} style={{ fontSize: 7, color: '#5A3020', fontFamily: 'monospace' }}>{v}</p>)}
                  </div>
                </div>
              )
            })}
            {[...new Set(debugChars.split(''))].filter(ch => ch.trim() && !glyphMap.has(ch) && ch !== '').map(ch => (
              <div key={ch} style={{ textAlign: 'center', opacity: 0.4 }}>
                <div style={{ width: 48, height: 48, border: '1px dashed rgba(192,80,58,0.3)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ fontSize: 18, color: '#5A3020' }}>{ch}</span>
                </div>
                <p style={{ fontSize: 8, color: '#5A3020', marginTop: 3 }}>no glyph</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* No glyphs warning */}
      {!hasGlyphs && (
        <div style={{
          background: C.amberLt, border: `1px solid ${C.amberMd}`,
          borderRadius: 12, padding: '14px 18px', marginBottom: 20,
        }}>
          <p style={{ fontSize: 13, color: C.amber, fontWeight: 500 }}>⚠ No glyph data yet</p>
          <p style={{ fontSize: 11, color: C.inkMd, marginTop: 3 }}>Go back to Step 3 to extract glyphs from the PDF first</p>
        </div>
      )}

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 20 }}>
        <StatCard label="Characters"     value={charCount}        sub="unique glyphs" accent />
        <StatCard label="Total Variants" value={totalVariants}    sub="5× per char"   accent />
        <StatCard label="Thai / Latin"   value={`${thaiCount}/${latinCount}`} sub="scripts" />
        <StatCard label="Output"         value="TTF+WOFF"         sub="+ ZIP package" />
      </div>

      {/* Tab bar */}
      <div style={{
        display: 'flex', gap: 0, marginBottom: 16,
        background: C.bgCard, border: `1px solid ${C.border}`,
        borderRadius: 12, padding: 4, width: '100%', overflowX: 'auto',
      }}>
        {TABS.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
            background: activeTab === tab.id ? C.ink : 'transparent',
            color:      activeTab === tab.id ? '#FBF9F5' : C.inkMd,
            border: 'none', borderRadius: 8, padding: '6px 14px',
            fontSize: 12, fontFamily: "'DM Sans', sans-serif",
            cursor: 'pointer', transition: 'all 0.15s',
            fontWeight: activeTab === tab.id ? 500 : 400, whiteSpace: 'nowrap',
          }}>{tab.label}</button>
        ))}
      </div>

      {/* Tab: Overview */}
      {activeTab === 'overview' && (
        <div style={{ marginBottom: 20 }}>
          {/* Two-column layout: Variants left, FontStylePanel right */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, alignItems: 'start' }}>

            {/* LEFT — Glyph variant picker */}
            <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 14, padding: '16px 20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
                <p style={{ fontSize: 11, fontWeight: 500, letterSpacing: '0.1em', textTransform: 'uppercase', color: C.inkLt }}>
                  1 Character → 5 Variants
                </p>
                {hasGlyphs && (
                  <select value={previewChar ?? ''} onChange={e => setPreviewChar(e.target.value)}
                    style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: '5px 10px', fontSize: 12, background: C.bgCard, color: C.ink }}>
                    {entries.map(([ch, d]) => (
                      <option key={ch} value={ch}>{ch} — {d.unicode}</option>
                    ))}
                  </select>
                )}
              </div>

              {previewData && (() => {
                const cls    = previewData.codepoint ? getGlyphClass(previewData.codepoint) : null
                const isMark = previewData.codepoint ? isThaiNonSpacing(previewData.codepoint) : false
                const VARIANTS = [
                  { key: 'default', svgPath: previewData.default, label: '.default', desc: 'original' },
                  { key: 'alt1',    svgPath: previewData.alt1,    label: '.alt1',    desc: 'slant' },
                  { key: 'alt2',    svgPath: previewData.alt2,    label: '.alt2',    desc: 'baseline drop' },
                  { key: 'alt3',    svgPath: previewData.alt3,    label: '.alt3',    desc: 'narrow' },
                  { key: 'alt4',    svgPath: previewData.alt4,    label: '.alt4',    desc: 'shake' },
                ]
                return (
                  <div>
                    {/* Glyph class badge */}
                    {cls && (
                      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 12 }}>
                        <span style={{ background: C.bgMuted, borderRadius: 4, padding: '2px 7px', fontSize: 10, fontFamily: 'monospace', color: C.inkMd }}>{cls}</span>
                        {isMark && (
                          <span style={{ background: C.sageLt, borderRadius: 4, padding: '2px 7px', fontSize: 10, color: C.sage }}>non-spacing (adv=0)</span>
                        )}
                      </div>
                    )}

                    {/* 5 variant cards — horizontal, each clickable */}
                    {(() => {
                      // Each card uses its OWN variant style for real-time preview
                      return (
                        <div style={{ display: 'flex', gap: 6, marginBottom: 14, minWidth: 0 }}>
                          {VARIANTS.map(({ key, svgPath, label, desc }) => {
                            const isActive = selectedVariant === key
                            const valid    = validateSvgPath(svgPath).valid
                            // Each card reads its OWN variant style
                            const vs       = variantStyles[key] ?? DEFAULT_STYLE
                            const skewX    = -(vs.slant ?? 0) * 0.6
                            const strokeW  = 4 * ((vs.boldness ?? 100) / 100)
                            const opacity  = 1 - ((vs.roughness ?? 0) / 100) * 0.25
                            return (
                              <div key={key}
                                onClick={() => setSelectedVariant(key)}
                                style={{
                                  flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                                  background: isActive ? C.sageLt : C.bgMuted,
                                  border: `2px solid ${isActive ? C.sage : C.border}`,
                                  borderRadius: 10, padding: '8px 4px',
                                  cursor: 'pointer', transition: 'border-color 0.15s, background 0.15s',
                                }}
                                onMouseEnter={e => { if (!isActive) e.currentTarget.style.borderColor = C.borderMd }}
                                onMouseLeave={e => { if (!isActive) e.currentTarget.style.borderColor = C.border }}
                              >
                                <div style={{
                                  width: 48, height: 48, background: '#fff',
                                  border: `1px solid ${isActive ? C.sageMd : C.borderMd}`,
                                  borderRadius: 8,
                                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                                  overflow: 'hidden',
                                }}>
                                  {valid ? (
                                    <svg
                                      viewBox={computeViewBox(svgPath)}
                                      style={{ width: '90%', height: '90%', transform: `skewX(${skewX}deg)`, transition: 'transform 0.1s', opacity }}
                                      preserveAspectRatio="xMidYMid meet"
                                    >
                                      <path d={svgPath} fill="none" stroke={C.ink} strokeWidth={strokeW}
                                        strokeLinecap="round" strokeLinejoin="round"
                                        style={{ transition: 'stroke-width 0.1s' }} />
                                    </svg>
                                  ) : (
                                    <span style={{ fontSize: 26, color: C.inkMd }}>{previewChar}</span>
                                  )}
                                </div>
                                <span style={{ fontSize: 8, fontFamily: 'monospace', color: isActive ? C.sage : C.inkMd, fontWeight: isActive ? 700 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>{label}</span>
                                <span style={{ fontSize: 8, color: C.inkLt, textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>{desc}</span>
                              </div>
                            )
                          })}
                        </div>
                      )
                    })()}

                    {/* calt rotation preview — compact single line */}
                    <div style={{ background: '#1E1A14', borderRadius: 8, padding: '8px 12px', fontFamily: 'monospace', fontSize: 10, color: '#7CC4B0', lineHeight: 1.9 }}>
                      <span style={{ color: '#5C5340' }}># calt</span>{'  '}
                      <span style={{ color: '#9E9278' }}>Input: </span>
                      <span style={{ color: '#F0EBE0' }}>{previewChar}{previewChar}{previewChar}{previewChar}{previewChar}{previewChar}</span>
                      {'  →  '}
                      <span style={{ color: '#7CC4B0' }}>.default .alt1 .alt2 .alt3 .default .alt4</span>
                    </div>
                  </div>
                )
              })()}
            </div>

            {/* RIGHT — Font Style sliders (per variant) */}
            <div>
              <FontStylePanel
                fontStyle={activeVariantStyle}
                onFontStyleChange={handleVariantStyleChange}
                variantLabel={selectedVariant}
                onReset={handleResetVariantStyle}
              />
            </div>
          </div>
        </div>
      )}

      {/* Tab: Glyphs */}
      {activeTab === 'glyphs' && (
        <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 14, padding: '16px 20px', marginBottom: 20 }}>
          <p style={{ fontSize: 11, color: C.inkLt, marginBottom: 14 }}>
            {charCount} characters × 5 variants
            <span style={{ marginLeft: 10, background: C.sageLt, color: C.sage, borderRadius: 4, padding: '1px 6px', fontSize: 9 }}>● = Thai non-spacing mark</span>
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(88px, 1fr))', gap: 8, maxHeight: 500, overflowY: 'auto' }}>
            {entries.map(([ch, data]) => {
              const g      = glyphs.find(x => x.ch === ch && (x.status === 'ok' || ['excellent','good','acceptable'].includes(x._visionStatus)))
              const hasSvg = validateSvgPath(g?.svgPath).valid
              const isMark = isThaiNonSpacing(data.codepoint)
              return (
                <button key={ch} onClick={() => { setPreviewChar(ch); setActiveTab('overview') }} style={{
                  background: previewChar === ch ? C.sageLt : C.bgCard,
                  border: `1.5px solid ${previewChar === ch ? C.sageMd : C.border}`,
                  borderRadius: 10, padding: '10px 6px', cursor: 'pointer',
                  textAlign: 'center', transition: 'all 0.12s', position: 'relative',
                }}>
                  {isMark && (
                    <span style={{ position: 'absolute', top: 3, right: 3, width: 6, height: 6, borderRadius: '50%', background: C.sage, display: 'block' }} />
                  )}
                  <div style={{ width: 44, height: 44, margin: '0 auto 6px', background: '#fff', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', border: `1px dashed ${C.borderMd}` }}>
                    {hasSvg ? (
                      <svg viewBox={computeViewBox(g.svgPath)} style={{ width: '80%', height: '80%', overflow: 'hidden' }} preserveAspectRatio="xMidYMid meet">
                        <path d={g.svgPath} fill="none" stroke={C.ink} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    ) : (
                      <span style={{ fontSize: 24, color: C.inkMd }}>{ch}</span>
                    )}
                  </div>
                  <p style={{ fontSize: 10, color: C.inkMd, fontFamily: 'monospace', marginBottom: 1 }}>{ch}</p>
                  <p style={{ fontSize: 8, color: C.inkLt }}>{data.unicode}</p>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Tab: Preview */}
      {activeTab === 'preview' && (
        <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 14, padding: '24px 28px', marginBottom: 20 }}>
          <FontPreviewPane
            fontName={fontName}
            ttfBuffer={buildResult?.ttfBuffer ?? null}
            buildSeed={buildSeed}
            puaMap={buildResult?.puaMap ?? null}
          />
        </div>
      )}

      {/* Tab: Download */}
      {activeTab === 'download' && (
        <div style={{ marginBottom: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* ── Row 1: Font name + stats ── */}
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr auto',
            gap: 12, alignItems: 'stretch',
          }}>
            {/* Font name input */}
            <div style={{
              background: '#FDFCF9', border: '1px solid #DDD8CE',
              borderRadius: 14, padding: '18px 22px',
              boxShadow: '0 1px 4px rgba(44,36,22,0.05)',
            }}>
              <p style={{ fontSize: 10, color: '#8A7B62', fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 10 }}>Font Family Name</p>
              <input
                value={fontName}
                onChange={e => {
                  const val = e.target.value
                  setFontName(val)
                  setFontNameError(val.trim() === '' ? 'กรุณาใส่ชื่อ font' : '')
                }}
                disabled={buildState === 'building'}
                style={{
                  width: '100%', boxSizing: 'border-box',
                  border: `1.5px solid ${fontNameError ? '#E05C4A' : '#DDD8CE'}`, borderRadius: 9,
                  padding: '10px 14px', fontSize: 16, fontFamily: 'monospace',
                  fontWeight: 600, color: '#1A1410',
                  background: buildState === 'building' ? '#F7F5F0' : '#fff',
                  outline: 'none', transition: 'border-color 0.15s',
                }}
                maxLength={64}
                onFocus={e => { if (!fontNameError) e.target.style.borderColor = '#9E9278' }}
                onBlur={e => {
                  const val = e.target.value.trim()
                  if (val === '') {
                    setFontNameError('กรุณาใส่ชื่อ font')
                    e.target.style.borderColor = '#E05C4A'
                  } else {
                    setFontName(val)
                    setFontNameError('')
                    e.target.style.borderColor = '#DDD8CE'
                  }
                }}
              />
              {fontNameError && (
                <p style={{ fontSize: 11, color: '#E05C4A', marginTop: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span>⚠</span> {fontNameError}
                </p>
              )}
            </div>
            {/* Stats pill */}
            <div style={{
              background: '#1A1410', borderRadius: 14, padding: '18px 22px',
              display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: 4,
              minWidth: 120,
            }}>
              <p style={{ fontSize: 28, fontFamily: "'DM Serif Display', serif", color: '#F0EBE0', fontWeight: 400, lineHeight: 1 }}>{totalVariants}</p>
              <p style={{ fontSize: 10, color: '#5C5340', letterSpacing: '0.08em', textAlign: 'center' }}>
                {charCount} chars × 5<br/>variants
              </p>
            </div>
          </div>

          {/* ── Building state ── */}
          {buildState === 'building' && (
            <div style={{
              background: '#fff', border: '1px solid #DDD8CE',
              borderRadius: 14, padding: '22px 24px',
              boxShadow: '0 1px 4px rgba(44,36,22,0.05)',
            }}>
              <p style={{ fontSize: 10, color: '#8A7B62', fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 14 }}>Compiling Font</p>
              <ProgressBar pct={progress.pct} label={progress.label} sublabel={`${charCount} chars → ${totalVariants} glyphs`} />
              <div style={{ display: 'flex', gap: 6, marginTop: 14, flexWrap: 'wrap' }}>
                {[
                  { label: 'Validating paths',  done: progress.pct >= 10 },
                  { label: 'Computing metrics', done: progress.pct >= 35 },
                  { label: 'Building glyphs',   done: progress.pct >= 65 },
                  { label: 'GSUB/GPOS tables',  done: progress.pct >= 82 },
                  { label: 'Exporting files',   done: progress.pct >= 92 },
                ].map(s => (
                  <span key={s.label} style={{
                    fontSize: 10, padding: '4px 10px',
                    background: s.done ? C.sageLt : C.bgMuted,
                    border: `1px solid ${s.done ? C.sageMd : C.border}`,
                    borderRadius: 6, color: s.done ? C.sage : C.inkLt,
                    transition: 'all 0.3s',
                  }}>{s.done ? '✓' : '○'} {s.label}</span>
                ))}
              </div>
            </div>
          )}

          {/* ── Error state ── */}
          {buildState === 'error' && (
            <div style={{
              background: C.blushLt, border: `1px solid ${C.blushMd}`,
              borderRadius: 12, padding: '16px 20px',
              display: 'flex', alignItems: 'flex-start', gap: 12,
            }}>
              <span style={{ fontSize: 20, flexShrink: 0 }}>⚠</span>
              <div>
                <p style={{ fontSize: 13, color: C.blush, fontWeight: 600, marginBottom: 4 }}>Build failed</p>
                <p style={{ fontSize: 11, color: C.inkMd, fontFamily: 'monospace', lineHeight: 1.6 }}>{errorMsg}</p>
              </div>
            </div>
          )}

          {/* ── Idle state ── */}
          {buildState === 'idle' && (
            <div style={{
              background: '#F7F5F0', border: '1px dashed #DDD8CE',
              borderRadius: 12, padding: '14px 20px',
              display: 'flex', alignItems: 'center', gap: 10,
            }}>
              <span style={{ fontSize: 16, animation: 'spin 2s linear infinite' }}>⟳</span>
              <span style={{ fontSize: 12, color: '#8A7B62' }}>Preparing font build…</span>
            </div>
          )}

          {/* ── Done state ── */}
          {buildState === 'done' && buildResult && (
            <>
              {/* Success banner */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '8px 12px',
                background: '#F0FAF3', border: '1px solid #C4E8CE',
                borderRadius: 9,
              }}>
                <span style={{ fontSize: 13, color: '#2E7D42', fontWeight: 600 }}>✓</span>
                <span style={{ fontSize: 12, color: '#2E7D42', fontWeight: 500 }}>
                  {buildResult.glyphCount} glyphs compiled
                </span>
                {buildResult.skipped.length > 0 && (
                  <span style={{ fontSize: 11, color: C.amber }}>· {buildResult.skipped.length} skipped</span>
                )}
                <button
                  onClick={() => { setBuildState('idle'); setBuildResult(null); setProgress({ pct: 0, label: '' }); setTimeout(() => handleBuild(), 50) }}
                  style={{
                    marginLeft: 'auto', background: 'none', border: 'none',
                    fontSize: 11, color: '#5C9A6A', cursor: 'pointer',
                    fontFamily: "'DM Sans', sans-serif", padding: '2px 6px',
                    borderRadius: 5,
                  }}
                >↺ Rebuild</button>
              </div>
              {buildResult.skipped.length > 0 && <SkippedGlyphsPanel skipped={buildResult.skipped} />}

              {/* ── Download cards row ── */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {/* TTF — primary */}
                <div style={{
                  background: '#1A1410', borderRadius: 14, padding: '20px 22px',
                  display: 'flex', flexDirection: 'column', gap: 12,
                  gridColumn: '1 / -1',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <span style={{ fontSize: 11, fontFamily: 'monospace', background: 'rgba(255,255,255,0.08)', color: '#9E9278', borderRadius: 5, padding: '2px 8px' }}>.ttf</span>
                        <span style={{ fontSize: 10, color: '#4A7C6F', background: 'rgba(74,124,111,0.15)', borderRadius: 5, padding: '2px 8px' }}>TrueType · Primary</span>
                      </div>
                      <p style={{ fontSize: 15, fontWeight: 700, color: '#F0EBE0', fontFamily: 'monospace' }}>{fontName}.ttf</p>
                      <p style={{ fontSize: 11, color: '#5C5340', marginTop: 3 }}>{buildResult.glyphCount} glyphs · GSUB salt/calt · GPOS mark</p>
                    </div>
                    <button onClick={handleDownloadTTF} style={{
                      display: 'inline-flex', alignItems: 'center', gap: 8,
                      background: '#F0EBE0', color: '#1A1410',
                      border: 'none', borderRadius: 10, padding: '12px 28px',
                      fontSize: 13, fontFamily: "'DM Sans', sans-serif",
                      cursor: 'pointer', fontWeight: 700,
                      flexShrink: 0, transition: 'background 0.15s',
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = '#fff'}
                    onMouseLeave={e => e.currentTarget.style.background = '#F0EBE0'}
                    >
                      ⬇ Download .ttf
                    </button>
                  </div>
                </div>

                {/* WOFF */}
                <div style={{
                  background: '#FDFCF9', border: '1px solid #DDD8CE',
                  borderRadius: 14, padding: '16px 20px',
                  display: 'flex', flexDirection: 'column', gap: 10,
                }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                      <span style={{ fontSize: 10, fontFamily: 'monospace', background: '#F2EDE4', color: '#8A7B62', borderRadius: 4, padding: '1px 7px' }}>.woff</span>
                      <span style={{ fontSize: 10, color: '#8A7B62' }}>Web Font</span>
                    </div>
                    <p style={{ fontSize: 12, color: '#3A3228' }}>For web use via CSS @font-face</p>
                  </div>
                  <button onClick={handleDownloadWOFF} style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    background: '#1A1410', color: '#F0EBE0',
                    border: 'none', borderRadius: 8, padding: '9px 18px',
                    fontSize: 12, fontFamily: "'DM Sans', sans-serif",
                    cursor: 'pointer', fontWeight: 600, alignSelf: 'flex-start',
                    transition: 'opacity 0.15s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.opacity = '0.85'}
                  onMouseLeave={e => e.currentTarget.style.opacity = '1'}
                  >
                    ⬇ Download .woff
                  </button>
                </div>

                {/* ZIP bundle */}
                <div style={{
                  background: '#FDFCF9', border: '1px solid #DDD8CE',
                  borderRadius: 14, padding: '16px 20px',
                  display: 'flex', flexDirection: 'column', gap: 10,
                }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                      <span style={{ fontSize: 10, fontFamily: 'monospace', background: '#F2EDE4', color: '#8A7B62', borderRadius: 4, padding: '1px 7px' }}>.zip</span>
                      <span style={{ fontSize: 10, color: '#8A7B62' }}>Full Bundle</span>
                    </div>
                    <p style={{ fontSize: 12, color: '#3A3228' }}>TTF + WOFF + metadata + CSS + build log</p>
                  </div>
                  <button onClick={handleDownloadZip} style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    background: '#1A1410', color: '#F0EBE0',
                    border: 'none', borderRadius: 8, padding: '9px 18px',
                    fontSize: 12, fontFamily: "'DM Sans', sans-serif",
                    cursor: 'pointer', fontWeight: 600, alignSelf: 'flex-start',
                    transition: 'opacity 0.15s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.opacity = '0.85'}
                  onMouseLeave={e => e.currentTarget.style.opacity = '1'}
                  >
                    ⬇ Download .zip
                  </button>
                </div>
              </div>

              {/* ── Install guide ── */}
              <div style={{
                background: '#fff', border: '1px solid #DDD8CE',
                borderRadius: 14, padding: '20px 24px',
                boxShadow: '0 1px 4px rgba(44,36,22,0.05)',
              }}>
                <p style={{ fontSize: 10, color: '#8A7B62', fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 14 }}>Install on Your System</p>
                <InstallGuidePanel fontName={fontName} />
              </div>
            </>
          )}

          {/* ── Build log (always at bottom) ── */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button onClick={() => setShowLog(v => !v)} style={{
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: 11, color: C.inkLt, fontFamily: "'DM Sans', sans-serif",
              display: 'flex', alignItems: 'center', gap: 5, padding: '4px 0',
            }}>
              <span style={{ fontFamily: 'monospace', fontSize: 10 }}>{showLog ? '▾' : '▸'}</span>
              Build Log
              <span style={{ background: C.bgMuted, color: C.inkLt, fontSize: 10, borderRadius: 4, padding: '1px 6px', fontFamily: 'monospace' }}>{buildLog.length}</span>
            </button>
          </div>
          {showLog && <BuildLogPanel entries={buildLog} />}
        </div>
      )}
    </div>
  )
}