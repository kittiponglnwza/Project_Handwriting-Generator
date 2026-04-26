/**
 * Step4.jsx — Hybrid Font Generator (v2 — Production Grade)
 *
 * Architecture:
 *   Step4.jsx          UI shell, state machine, tab routing
 *   step4/fontBuilder  opentype.js compilation engine
 *   step4/metrics      per-glyph smart advance width + bbox
 *   step4/thaiFeatures GSUB salt/calt + GPOS mark-to-base
 *   step4/download     safe Blob download + JSZip export
 *
 * Props:
 *   glyphs: Glyph[]  — from appState.glyphResult.glyphs
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Btn from '../components/Btn'
import { DOCUMENT_SEED } from '../lib/documentSeed.js'
import C from '../styles/colors'

// Font builder modules (local — no CDN)
import {
  buildGlyphMap,
  compileFontBuffer,
  buildMetadata,
  buildExportGlyphMap,
  validateSvgPath,
} from './step4/fontBuilder.js'
import { getGlyphClass, isThaiNonSpacing } from './step4/metrics.js'
import {
  downloadBuffer,
  downloadJSON,
  downloadFontZip,
} from './step4/download.js'

// ─── Design tokens ─────────────────────────────────────────────────────────────
const FONT_NAME = 'MyHandwriting'

// Log level → colour
const LOG_COLORS = {
  info:    C.inkMd,
  warn:    C.amber,
  error:   C.blush,
  success: C.sage,
}

// ─── Sub-components ────────────────────────────────────────────────────────────

/** Horizontal progress bar */
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
          <svg viewBox={viewBox} style={{ width: '84%', height: '84%', overflow: 'visible' }}>
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

/** Live font preview textarea */
function FontPreviewPane({ fontName, ttfBuffer }) {
const [previewText, setPreviewText] = useState(
`\nMy name is Krittipong. I am a Computer Science student at King Mongkut's University of Technology North Bangkok. I enjoy coding, building projects, and learning new technologies. I have experience in robotics competitions and won several awards. My goal is to improve my programming skills and create successful projects in the future. I am hardworking, creative, and always ready to learn something new.

ABCDEFGHIJKLMNOPQRSTUVWXYZ
abcdefghijklmnopqrstuvwxyz

0123456789
!@#$%^&*()-+=

This is TopZ's project

ตอนนี้ยังไม่มีภาษาไทย`
)
  const [fontSize, setFontSize] = useState(42)
  const [fontLoaded, setFontLoaded] = useState(false)
  const [bgMode, setBgMode] = useState('white') // white | ruled | dark
  const fontStyleId = `font-preview-${fontName.replace(/\s+/g, '-')}`
  const fontFamily  = `'${fontName}-Preview'`

  useEffect(() => {
    if (!ttfBuffer) { setFontLoaded(false); return }
    const existing = document.getElementById(fontStyleId)
    if (existing) existing.remove()
    const blob  = new Blob([ttfBuffer], { type: 'font/ttf' })
    const url   = URL.createObjectURL(blob)
    const style = document.createElement('style')
    style.id    = fontStyleId
    style.textContent = `@font-face { font-family: '${fontName}-Preview'; src: url('${url}') format('truetype'); font-display: block; }`
    document.head.appendChild(style)
    if (typeof FontFace !== 'undefined') {
      const ff = new FontFace(`${fontName}-Preview`, `url('${url}')`, { display: 'block' })
      ff.load().then(() => { document.fonts.add(ff); setFontLoaded(true) })
        .catch(() => setTimeout(() => setFontLoaded(true), 300))
    } else {
      setTimeout(() => setFontLoaded(true), 300)
    }
    return () => { style.remove(); URL.revokeObjectURL(url); setFontLoaded(false) }
  }, [ttfBuffer, fontName])

  const bgStyles = {
    white: { background: '#FEFCF8', color: '#1A1410' },
    ruled: {
      background: '#FEFCF8',
      backgroundImage: `repeating-linear-gradient(transparent, transparent ${fontSize * 1.6 - 1}px, #C8D8E8 ${fontSize * 1.6 - 1}px, #C8D8E8 ${fontSize * 1.6}px)`,
      backgroundPositionY: '14px',
      color: '#1A1410',
    },
    dark:  { background: '#1A1410', color: '#F0EBE0' },
  }

  return (
    <div>
      {/* ── Toolbar ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        {/* Status badge */}
        <span style={{
          fontSize: 11, padding: '3px 10px', borderRadius: 6,
          background: fontLoaded ? '#EBF5EE' : C.amberLt,
          color: fontLoaded ? '#2E6B3E' : C.amber,
          border: `1px solid ${fontLoaded ? '#A8D5B5' : C.amberMd}`,
          fontWeight: 500,
        }}>
          {fontLoaded ? '✓ Font loaded' : '⟳ Loading…'}
        </span>

        {/* BG mode toggle */}
        <div style={{ display: 'flex', background: '#F2EDE4', borderRadius: 8, padding: 3, gap: 2 }}>
          {[['white','☀'],  ['dark','🌙']].map(([m, icon]) => (
            <button key={m} onClick={() => setBgMode(m)} style={{
              background: bgMode === m ? '#fff' : 'transparent',
              border: bgMode === m ? '1px solid #DDD8CE' : '1px solid transparent',
              borderRadius: 6, padding: '3px 10px', cursor: 'pointer',
              fontSize: 12, transition: 'all 0.15s',
              boxShadow: bgMode === m ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
            }}>{icon}</button>
          ))}
        </div>

        {/* Size slider */}
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

      {/* ── Preview area ── */}
      <textarea
        value={previewText}
        onChange={e => setPreviewText(e.target.value)}
        style={{
          width: '100%', boxSizing: 'border-box',
          minHeight: 420, resize: 'vertical',
          fontFamily: fontLoaded ? `${fontFamily}, cursive` : 'cursive',
          fontSize,
          lineHeight: 1.6,
          padding: '20px 24px',
          border: `1.5px solid ${fontLoaded ? '#A8D5B5' : '#DDD8CE'}`,
          borderRadius: 12,
          ...bgStyles[bgMode],
          outline: 'none',
          transition: 'border-color 0.2s, background 0.2s',
          boxShadow: '0 2px 12px rgba(44,36,22,0.06)',
        }}
        placeholder="Type here to preview the font…"
        spellCheck={false}
      />

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

// ─── Main component ────────────────────────────────────────────────────────────

// ─── Font Quality Slider config (P1.1) ───────────────────────────────────────
const FONT_SLIDERS = [
  { key: "roughness",  label: "Roughness",   min: 0,   max: 100, unit: ""  },
  { key: "neatness",   label: "Neatness",  min: 0,   max: 100, unit: ""  },
  { key: "slant",      label: "Slant",      min: -30, max: 30,  unit: "°" },
  { key: "boldness",   label: "Weight",    min: 70,  max: 150, unit: "%" },
  { key: "randomness", label: "Randomness",   min: 0,   max: 100, unit: ""  },
]

function FontStylePanel({ fontStyle, onFontStyleChange }) {
  if (!fontStyle || !onFontStyleChange) return null
  return (
    <div style={{
      background: '#fff',
      borderRadius: 14,
      padding: '20px 24px',
      marginBottom: 0,
      border: '1px solid #DDD8CE',
      boxShadow: '0 1px 4px rgba(44,36,22,0.07)',
    }}>
      <p style={{
        fontSize: 11, fontWeight: 600, color: '#8A7B62',
        marginBottom: 18, letterSpacing: '0.1em', textTransform: 'uppercase',
      }}>
        Font Style
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 32px' }}>
        {FONT_SLIDERS.map(({ key, label, min, max, unit }) => {
          const pct = ((fontStyle[key] - min) / (max - min)) * 100
          return (
            <div key={key} style={{ paddingBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                <label style={{ fontSize: 12, color: '#5C5040', fontWeight: 500 }}>{label}</label>
                <span style={{
                  fontSize: 12, color: '#1A1410', fontWeight: 700,
                  fontVariantNumeric: 'tabular-nums',
                  background: '#F2EDE4', borderRadius: 5,
                  padding: '1px 7px', minWidth: 36, textAlign: 'center',
                }}>
                  {fontStyle[key]}{unit}
                </span>
              </div>
              <div style={{ position: 'relative', height: 20, display: 'flex', alignItems: 'center' }}>
                {/* track filled */}
                <div style={{
                  position: 'absolute', left: 0, top: '50%', transform: 'translateY(-50%)',
                  width: '100%', height: 3, background: '#E5DFD4', borderRadius: 3,
                }} />
                <div style={{
                  position: 'absolute', left: 0, top: '50%', transform: 'translateY(-50%)',
                  width: `${pct}%`, height: 3, background: '#2C2416', borderRadius: 3,
                  transition: 'width 0.05s',
                }} />
                <input
                  type="range" min={min} max={max} value={fontStyle[key]}
                  onChange={e => onFontStyleChange(key, Number(e.target.value))}
                  style={{
                    position: 'relative', width: '100%', margin: 0,
                    appearance: 'none', WebkitAppearance: 'none',
                    background: 'transparent', cursor: 'pointer',
                    height: 20,
                  }}
                />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function Step4({ glyphs = [], fontStyle, onFontStyleChange, onFontReady }) {
  const [buildState,   setBuildState]   = useState('idle')
  const [progress,     setProgress]     = useState({ pct: 0, label: '' })
  const [buildResult,  setBuildResult]  = useState(null)
  const [errorMsg,     setErrorMsg]     = useState('')
  const [previewChar,  setPreviewChar]  = useState(null)
  const [activeTab,    setActiveTab]    = useState('overview')
  const [buildLog,     setBuildLog]     = useState([])
  const [showLog,      setShowLog]      = useState(false)
  const [fontName,     setFontName]     = useState(FONT_NAME)

  const hasGlyphs = glyphs.length > 0

  // buildSeed เปลี่ยนทุก Build click → buildGlyphMap + compileFontBuffer สุ่มใหม่
  const [buildSeed, setBuildSeed] = useState(() => Math.random())
  const glyphMap   = useMemo(() => hasGlyphs ? buildGlyphMap(glyphs, buildSeed) : new Map(), [glyphs, hasGlyphs, buildSeed])
  const entries    = useMemo(() => Array.from(glyphMap.entries()), [glyphMap])
  const charCount  = glyphMap.size
  const totalVariants = charCount * 3

  const thaiCount  = useMemo(() =>
    entries.filter(([, d]) => d.codepoint >= 0x0E00 && d.codepoint <= 0x0E7F).length,
  [entries])
  const latinCount = charCount - thaiCount

  useEffect(() => {
    if (entries.length > 0 && !previewChar) setPreviewChar(entries[0][0])
  }, [entries])

  const buildStateRef = useRef(buildState)
  useEffect(() => { buildStateRef.current = buildState }, [buildState])

  // ── Auto-build เมื่อ glyphs พร้อม และยังไม่เคย build ─────────────────────
  // ทำให้ Step 5 ได้ font ทันทีแม้ user ไม่เคยเข้า Step 4 เลย
  useEffect(() => {
    if (hasGlyphs && buildStateRef.current === 'idle') {
      // delay เล็กน้อยเพื่อให้ glyphMap compute เสร็จก่อน
      const t = setTimeout(() => {
        if (buildStateRef.current === 'idle') handleBuild()
      }, 100)
      return () => clearTimeout(t)
    }
  }, [hasGlyphs]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Re-fire onFontReady เมื่อ component mount กลับมา และ build เสร็จแล้ว ─
  // กรณี user navigate Step4 → Step5 → Step4 → Step5 โดยไม่ build ใหม่
  useEffect(() => {
    if (buildState === 'done' && buildResult?.ttfBuffer) {
      onFontReady?.({ ttfBuffer: buildResult.ttfBuffer, puaMap: buildResult.puaMap ?? new Map() })
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

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

  // ── Build ──────────────────────────────────────────────────────────────────
  const handleBuild = useCallback(async () => {
    if (!hasGlyphs || buildStateRef.current === 'building') return
    const newSeed = Math.random()
    setBuildSeed(newSeed)           // seed ใหม่ → glyphMap + compile สุ่มใหม่ทั้งหมด
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

      const result = await compileFontBuffer(glyphMap, fontName, onProgress, newSeed)
      const {
        ttfBuffer, woffBuffer, glyphCount,
        skipped, buildLog: newLog, glyphInfo, featureStatus: fStatus,
        puaMap,  // ← PUA randomization map (ch → {v0,v1,v2})
      } = result

      setBuildLog(newLog)

      const exportGlyphMap = buildExportGlyphMap(glyphMap, glyphInfo)
      const metadata       = buildMetadata({
        fontName, glyphMap, glyphInfo, glyphCount,
        skipped, featureStatus: fStatus,
      })

      setBuildResult({
        ttfBuffer, woffBuffer, glyphCount,
        skipped, glyphInfo, exportGlyphMap, metadata,
        featureStatus: fStatus,
        puaMap,
      })
      setBuildState('done')

      // ── แจ้ง App ว่า font พร้อมแล้ว → ส่ง ttfBuffer + puaMap ไป Step5 ──
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

  // ── Downloads ──────────────────────────────────────────────────────────────
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

  // ── Tabs ───────────────────────────────────────────────────────────────────
  const TABS = [
    { id: 'overview',  label: 'Overview' },
    { id: 'glyphs',    label: `Glyphs (${charCount})` },
    { id: 'features',  label: 'OT Features' },
    { id: 'metrics',   label: 'Font Metrics' },
    { id: 'preview',   label: 'Preview' },
    { id: 'download',  label: '⬇ Download' },
  ]

  return (
    <div className="fade-up">

      {/* ── Dark header ───────────────────────────────────────────────────── */}
      <div style={{
        background: 'linear-gradient(135deg, #1A1410 0%, #2C2416 100%)',
        borderRadius: 16, padding: '18px 24px', marginBottom: 20,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: 12,
      }}>
        <div>
          <p style={{ fontSize: 18, fontFamily: "'DM Serif Display', serif", color: '#F0EBE0', fontWeight: 400 }}>
            Hybrid Font Generator
            <span style={{ fontSize: 12, color: '#5C5340', fontFamily: 'monospace', marginLeft: 8 }}>v2.0</span>
          </p>
          <p style={{ fontSize: 11, color: '#7A6E58', marginTop: 3 }}>
            Real TTF + WOFF · GSUB salt/calt · Smart per-glyph metrics
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {featureStatus
            ? Object.entries(featureStatus).map(([tag, status]) => (
                <FeatureBadge key={tag} tag={tag} status={status} />
              ))
            : ['salt', 'calt', 'liga', 'mark', 'mkmk'].map(tag => (
                <FeatureBadge key={tag} tag={tag}
                  status={{ enabled: hasGlyphs && !['liga','mkmk'].includes(tag), real: false }} />
              ))
          }
        </div>
      </div>

      {/* ── No glyphs warning ─────────────────────────────────────────────── */}
      {!hasGlyphs && (
        <div style={{
          background: C.amberLt, border: `1px solid ${C.amberMd}`,
          borderRadius: 12, padding: '14px 18px', marginBottom: 20,
        }}>
          <p style={{ fontSize: 13, color: C.amber, fontWeight: 500 }}>⚠ No glyph data yet</p>
          <p style={{ fontSize: 11, color: C.inkMd, marginTop: 3 }}>Go back to Step 3 to extract glyphs from the PDF first</p>
        </div>
      )}

      {/* ── Stats ─────────────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 20 }}>
        <StatCard label="Characters"     value={charCount}        sub="unique glyphs" accent />
        <StatCard label="Total Variants" value={totalVariants}    sub="3× per char"   accent />
        <StatCard label="Thai / Latin"   value={`${thaiCount}/${latinCount}`} sub="scripts" />
        <StatCard label="Output"         value="TTF+WOFF"         sub="+ ZIP package" />
      </div>

      {/* ── Tab bar ───────────────────────────────────────────────────────── */}
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

      {/* ════════════ Tab: Overview ════════════ */}
      {activeTab === 'overview' && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 14, padding: '16px 20px', marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
              <p style={{ fontSize: 11, fontWeight: 500, letterSpacing: '0.1em', textTransform: 'uppercase', color: C.inkLt }}>
                1 Character → 3 Variants
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
            {previewData && (
              <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                <div style={{ display: 'flex', gap: 12 }}>
                  <VariantThumb ch={previewChar} svgPath={previewData.default} viewBox={previewGlyph?.viewBox} label=".default" isActive />
                  <VariantThumb ch={previewChar} svgPath={previewData.alt1}    viewBox={previewGlyph?.viewBox} label=".alt1" borderColor={C.border} />
                  <VariantThumb ch={previewChar} svgPath={previewData.alt2}    viewBox={previewGlyph?.viewBox} label=".alt2" borderColor={C.border} />
                </div>
                <div style={{ flex: 1, minWidth: 160 }}>
                  {previewData.codepoint && (() => {
                    const cls    = getGlyphClass(previewData.codepoint)
                    const isMark = isThaiNonSpacing(previewData.codepoint)
                    return (
                      <div style={{ marginBottom: 10 }}>
                        <p style={{ fontSize: 10, color: C.inkLt, marginBottom: 4 }}>Glyph class</p>
                        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                          <span style={{ background: C.bgMuted, borderRadius: 4, padding: '2px 7px', fontSize: 10, fontFamily: 'monospace', color: C.inkMd }}>{cls}</span>
                          {isMark && (
                            <span style={{ background: C.sageLt, borderRadius: 4, padding: '2px 7px', fontSize: 10, color: C.sage }}>non-spacing (adv=0)</span>
                          )}
                        </div>
                      </div>
                    )
                  })()}
                  <p style={{ fontSize: 11, color: C.inkLt, lineHeight: 1.9 }}>
                    <b style={{ color: C.inkMd }}>.default</b> — original<br />
                    <b style={{ color: C.inkMd }}>.alt1</b> — drooping tail<br />
                    <b style={{ color: C.inkMd }}>.alt2</b> — wavy stroke
                  </p>
                  <div style={{ marginTop: 10, background: '#1E1A14', borderRadius: 8, padding: '8px 12px', fontFamily: 'monospace', fontSize: 10, color: '#7CC4B0', lineHeight: 1.9 }}>
                    <span style={{ color: '#5C5340' }}># calt — consecutive rotation</span><br />
                    <span style={{ color: '#9E9278' }}>Input:  </span>{previewChar}{previewChar}{previewChar}{previewChar}<br />
                    <span style={{ color: '#9E9278' }}>Output: </span>.default .alt1 .alt2 .default
                  </div>
                </div>
              </div>
            )}
          </div>
          <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 14, padding: '16px 20px' }}>
            <p style={{ fontSize: 11, fontWeight: 500, letterSpacing: '0.1em', textTransform: 'uppercase', color: C.inkLt, marginBottom: 12 }}>
              Rotating Variant System — calt (GSUB LookupType 6 Format 3)
            </p>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
              {['default', 'alt1', 'alt2', 'default', 'alt1', '…'].map((v, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{
                    padding: '3px 9px',
                    background: v==='default' ? C.sageLt : v==='alt1' ? C.amberLt : v==='alt2' ? C.blushLt : C.bgMuted,
                    border: `1px solid ${v==='default' ? C.sageMd : v==='alt1' ? C.amberMd : v==='alt2' ? C.blushMd : C.border}`,
                    borderRadius: 6, fontSize: 10, fontFamily: 'monospace',
                    color: v==='default' ? C.sage : v==='alt1' ? C.amber : v==='alt2' ? C.blush : C.inkLt,
                  }}>.{v}</span>
                  {i < 5 && <span style={{ color: C.borderMd, fontSize: 10 }}>→</span>}
                </div>
              ))}
            </div>
            <p style={{ fontSize: 10, color: C.inkLt, lineHeight: 1.7 }}>
              Implemented as real GSUB6 chaining context lookups — not a UI label.
              Detects repeated glyphs and cycles variants to simulate natural handwriting.
            </p>
          </div>

          {/* Font Style Sliders */}
          <div style={{ marginTop: 14 }}>
            <FontStylePanel fontStyle={fontStyle} onFontStyleChange={onFontStyleChange} />
          </div>
        </div>
      )}

      {/* ════════════ Tab: Glyphs ════════════ */}
      {activeTab === 'glyphs' && (
        <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 14, padding: '16px 20px', marginBottom: 20 }}>
          <p style={{ fontSize: 11, color: C.inkLt, marginBottom: 14 }}>
            {charCount} characters × 3 variants
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
                      <svg viewBox={g.viewBox || '0 0 100 100'} style={{ width: '80%', height: '80%', overflow: 'visible' }}>
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

      {/* ════════════ Tab: OT Features ════════════ */}
      {activeTab === 'features' && (
        <div style={{ marginBottom: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {[
            {
              tag: 'salt', table: 'GSUB', full: 'Stylistic Alternates', active: true, real: true,
              desc: 'GSUB LookupType 1 Format 2 — maps every default glyph to its .alt1 variant when the feature is toggled on. Real SingleSubstitution table embedded in the font.',
              lookup: 'GSUB1 Format 2: uniXXXX → uniXXXX.alt1 (per-glyph coverage)',
              example: 'ก→ก.alt1  A→A.alt1  1→1.alt1',
            },
            {
              tag: 'calt', table: 'GSUB', full: 'Contextual Alternates', active: true, real: true,
              desc: 'GSUB LookupType 6 Format 3 — chaining context that detects runs of the same glyph. After one occurrence, substitutes to .alt1; after two, to .alt2; repeats cyclically. Two chaining rules per character × two SingleSubst lookups.',
              lookup: 'GSUB6 Format 3: backtrack=[default] input=[default] → lookup(1=toAlt1) and backtrack=[alt1] input=[default] → lookup(2=toAlt2)',
              example: 'กกกกก → .default .alt1 .alt2 .default .alt1',
            },
            {
              tag: 'liga', table: 'GSUB', full: 'Standard Ligatures', active: false, real: false,
              desc: 'Feature record present in font with 0 lookups — reserved for future Thai stacked vowel ligatures or latin fi/fl pairs.',
              lookup: '— 0 lookups (reserved)',
              example: '—',
            },
            {
              tag: 'mark', table: 'GPOS', full: 'Mark-to-Base Positioning', active: thaiCount > 0, real: true,
              desc: 'GPOS LookupType 4 — positions Thai above-vowels (ั ิ ี ึ ็ ํ) above the consonant and below-vowels (ุ ู ฺ) below, using anchors derived from the actual glyph bounding box. Enables correct Thai text rendering without relying on zero-width hacks.',
              lookup: 'GPOS4 Format 1: markArray(class0=above,class1=below) + baseArray(2 anchors each)',
              example: 'ก + ◌ั → sara-a anchor above glyph top-centre',
            },
            {
              tag: 'mkmk', table: 'GPOS', full: 'Mark-to-Mark Positioning', active: false, real: false,
              desc: 'Reserved for stacked Thai marks (tone over above-vowel). Structure present, 0 lookups.',
              lookup: '— 0 lookups (future)',
              example: '—',
            },
          ].map(f => (
            <div key={f.tag} style={{
              background: C.bgCard, border: `1px solid ${f.active ? C.sageMd : C.border}`,
              borderRadius: 14, padding: '16px 20px',
              borderLeft: `4px solid ${f.active ? C.sage : C.borderMd}`,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                <span style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 700, color: f.active ? C.sage : C.inkLt, background: f.active ? C.sageLt : C.bgMuted, border: `1px solid ${f.active ? C.sageMd : C.border}`, borderRadius: 6, padding: '2px 8px' }}>{f.tag}</span>
                <span style={{ fontSize: 13, fontWeight: 500, color: C.ink }}>{f.full}</span>
                <span style={{ fontSize: 9, color: C.inkLt, fontFamily: 'monospace', background: C.bgMuted, padding: '1px 6px', borderRadius: 4 }}>{f.table}</span>
                {f.real && f.active && (
                  <span style={{ fontSize: 9, color: C.sage, background: C.sageLt, border: `1px solid ${C.sageMd}`, borderRadius: 4, padding: '1px 6px' }}>✓ REAL TABLE</span>
                )}
                {!f.active && <span style={{ fontSize: 10, color: C.inkLt, marginLeft: 'auto' }}>reserved</span>}
              </div>
              <p style={{ fontSize: 11, color: C.inkMd, lineHeight: 1.7, marginBottom: 10 }}>{f.desc}</p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <div style={{ background: C.bgMuted, borderRadius: 6, padding: '4px 10px', flex: 1, minWidth: 180 }}>
                  <span style={{ fontSize: 9, color: C.inkLt, letterSpacing: '0.08em' }}>LOOKUP  </span>
                  <code style={{ fontSize: 10, color: C.inkMd, fontFamily: 'monospace' }}>{f.lookup}</code>
                </div>
                {f.example !== '—' && (
                  <div style={{ background: C.bgMuted, borderRadius: 6, padding: '4px 10px' }}>
                    <span style={{ fontSize: 9, color: C.inkLt, letterSpacing: '0.08em' }}>EXAMPLE  </span>
                    <code style={{ fontSize: 10, color: C.inkMd, fontFamily: 'monospace' }}>{f.example}</code>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ════════════ Tab: Metrics ════════════ */}
      {activeTab === 'metrics' && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 14, padding: '16px 20px', marginBottom: 12 }}>
            <p style={{ fontSize: 11, fontWeight: 500, letterSpacing: '0.1em', textTransform: 'uppercase', color: C.inkLt, marginBottom: 14 }}>Global Font Metrics</p>
            {[
              { label: 'Units Per Em', value: 1000, bar: 1.0,  note: 'standard' },
              { label: 'Ascender',     value: 800,  bar: 0.8,  note: 'above baseline' },
              { label: 'Descender',    value: -200, bar: 0.2,  note: 'below baseline', neg: true },
              { label: 'x-Height',     value: 500,  bar: 0.5,  note: 'lowercase top' },
              { label: 'Cap Height',   value: 680,  bar: 0.68, note: 'uppercase top' },
            ].map(m => (
              <div key={m.label} style={{ marginBottom: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 12, color: C.inkMd }}>{m.label}</span>
                  <span style={{ fontFamily: 'monospace', fontSize: 12, color: C.ink, fontWeight: 500 }}>
                    {m.value} <span style={{ fontSize: 10, color: C.inkLt, fontFamily: 'sans-serif' }}>{m.note}</span>
                  </span>
                </div>
                <div style={{ height: 4, background: C.bgMuted, borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${m.bar * 100}%`, background: m.neg ? C.blush : C.sage, borderRadius: 2 }} />
                </div>
              </div>
            ))}
          </div>
          <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 14, padding: '16px 20px', marginBottom: 12 }}>
            <p style={{ fontSize: 11, fontWeight: 500, letterSpacing: '0.1em', textTransform: 'uppercase', color: C.inkLt, marginBottom: 14 }}>Smart Per-Glyph Advance Width</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }}>
              {[
                { cls: 'thai_consonant', adv: '~580', lsb: 30, rsb: 50 },
                { cls: 'thai_above',     adv: '0',    lsb: 0,  rsb: 0,  note: 'non-spacing' },
                { cls: 'thai_below',     adv: '0',    lsb: 0,  rsb: 0,  note: 'non-spacing' },
                { cls: 'latin_upper',    adv: '~650', lsb: 40, rsb: 60 },
                { cls: 'latin_lower',    adv: '~520', lsb: 40, rsb: 60 },
                { cls: 'latin_narrow',   adv: '~320', lsb: 20, rsb: 30, note: 'i l j r f t' },
                { cls: 'latin_wide',     adv: '~780', lsb: 40, rsb: 60, note: 'm w' },
                { cls: 'digit',          adv: '~540', lsb: 40, rsb: 60 },
                { cls: 'punctuation',    adv: '~280', lsb: 20, rsb: 30 },
              ].map(r => (
                <div key={r.cls} style={{ background: C.bgMuted, borderRadius: 8, padding: '8px 12px' }}>
                  <p style={{ fontFamily: 'monospace', fontSize: 10, color: C.ink, marginBottom: 3 }}>{r.cls}</p>
                  <p style={{ fontSize: 10, color: C.inkMd }}>adv={r.adv} lsb={r.lsb} rsb={r.rsb}{r.note ? ` (${r.note})` : ''}</p>
                </div>
              ))}
            </div>
            <p style={{ fontSize: 10, color: C.inkLt, marginTop: 10, lineHeight: 1.7 }}>
              advanceWidth = LSB + actual_bbox_width + RSB, clamped to ±50% of class default.
              BBox computed by sampling Bézier curves at 8–12 points each.
            </p>
          </div>
          <div style={{ background: '#1E1A14', borderRadius: 12, padding: '14px 18px' }}>
            <p style={{ fontSize: 10, color: '#5C5340', marginBottom: 8, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Encoding</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {[
                ['Thai', 'U+0E00–U+0E7F'],
                ['Latin+punct', 'U+0020–U+007E'],
                ['Digits', 'U+0030–U+0039'],
                ['Supplementary', 'full codePointAt()'],
                ['Variant algo', 'deformPath() v1–v3'],
                ['Seed', DOCUMENT_SEED.toString()],
              ].map(([k, v]) => (
                <div key={k}>
                  <p style={{ fontSize: 9, color: '#5C5340' }}>{k}</p>
                  <p style={{ fontFamily: 'monospace', fontSize: 11, color: '#9E9278' }}>{v}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ════════════ Tab: Preview ════════════ */}
      {/* always mounted เพื่อป้องกัน @font-face หาย เมื่อ switch tab */}
      <div style={{ display: activeTab === 'preview' ? 'block' : 'none', background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 14, padding: '24px 28px', marginBottom: 20 }}>
        <FontPreviewPane fontName={fontName} ttfBuffer={buildResult?.ttfBuffer ?? null} />
      </div>

      {/* ════════════ Tab: Download ════════════ */}
      {activeTab === 'download' && (
        <div style={{ marginBottom: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* ── Font name row ── */}
          <div style={{ background: '#fff', border: '1px solid #DDD8CE', borderRadius: 14, padding: '20px 24px', boxShadow: '0 1px 4px rgba(44,36,22,0.06)' }}>
            <p style={{ fontSize: 11, color: '#8A7B62', fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>Font Family Name</p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
              <input
                value={fontName}
                onChange={e => setFontName(e.target.value.trim() || FONT_NAME)}
                disabled={buildState === 'building'}
                style={{
                  flex: 1, minWidth: 200, boxSizing: 'border-box',
                  border: '1.5px solid #DDD8CE', borderRadius: 8,
                  padding: '9px 14px', fontSize: 14, fontFamily: 'monospace',
                  color: '#1A1410', background: buildState === 'building' ? '#F7F5F0' : '#FDFCF9',
                  outline: 'none',
                }}
                maxLength={64}
              />
              <span style={{ fontSize: 12, color: '#8A7B62', whiteSpace: 'nowrap', background: '#F2EDE4', borderRadius: 8, padding: '5px 12px' }}>
                {charCount} chars × 3 = <b style={{ color: '#1A1410' }}>{totalVariants}</b> glyphs
              </span>
            </div>
          </div>

          {/* ── Progress ── */}
          {buildState === 'building' && (
            <div style={{ background: '#fff', border: '1px solid #DDD8CE', borderRadius: 14, padding: '20px 24px', boxShadow: '0 1px 4px rgba(44,36,22,0.06)' }}>
              <ProgressBar pct={progress.pct} label={progress.label} sublabel={`${charCount} chars → ${totalVariants} glyphs`} />
              <div style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
                {[
                  { label: 'Validating paths',  done: progress.pct >= 10 },
                  { label: 'Computing metrics', done: progress.pct >= 35 },
                  { label: 'Building glyphs',   done: progress.pct >= 65 },
                  { label: 'GSUB/GPOS tables',  done: progress.pct >= 82 },
                  { label: 'Exporting files',   done: progress.pct >= 92 },
                ].map(s => (
                  <span key={s.label} style={{
                    fontSize: 10, padding: '3px 9px',
                    background: s.done ? C.sageLt : C.bgMuted,
                    border: `1px solid ${s.done ? C.sageMd : C.border}`,
                    borderRadius: 6, color: s.done ? C.sage : C.inkLt,
                    transition: 'all 0.25s',
                  }}>{s.done ? '✓' : '○'} {s.label}</span>
                ))}
              </div>
            </div>
          )}

          {/* ── Error ── */}
          {buildState === 'error' && (
            <div style={{ background: C.blushLt, border: `1px solid ${C.blushMd}`, borderRadius: 12, padding: '14px 20px' }}>
              <p style={{ fontSize: 12, color: C.blush, fontWeight: 600 }}>⚠ Build failed</p>
              <p style={{ fontSize: 11, color: C.inkMd, marginTop: 4, fontFamily: 'monospace' }}>{errorMsg}</p>
            </div>
          )}

          {/* ── Success state ── */}
          {buildState === 'done' && buildResult && (<>

            {/* compiled badge + skipped */}
            <div style={{ background: '#F0FAF3', border: '1px solid #A8D5B5', borderRadius: 12, padding: '14px 20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 18 }}>✅</span>
                <div>
                  <p style={{ fontSize: 13, fontWeight: 600, color: '#1E5C30' }}>Font compiled successfully</p>
                  <p style={{ fontSize: 11, color: '#3A7A4A', marginTop: 2 }}>
                    {buildResult.glyphCount} total glyphs
                    {buildResult.skipped.length > 0 && <span style={{ color: C.amber, marginLeft: 8 }}>· {buildResult.skipped.length} skipped</span>}
                  </p>
                </div>
              </div>
              {buildResult.skipped.length > 0 && (
                <div style={{ marginTop: 10 }}><SkippedGlyphsPanel skipped={buildResult.skipped} /></div>
              )}
            </div>

            {/* Install guide */}
            <div style={{ background: '#fff', border: '1px solid #DDD8CE', borderRadius: 14, padding: '20px 24px', boxShadow: '0 1px 4px rgba(44,36,22,0.06)' }}>
              <p style={{ fontSize: 11, color: '#8A7B62', fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 16 }}>Install on Your System</p>
              <InstallGuidePanel fontName={fontName} />
            </div>

            {/* Download button */}
            <div style={{ background: '#1A1410', border: '1px solid #2C2416', borderRadius: 14, padding: '20px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 14 }}>
              <div>
                <p style={{ fontSize: 13, fontWeight: 600, color: '#F0EBE0' }}>{fontName}.ttf</p>
                <p style={{ fontSize: 11, color: '#7A6E58', marginTop: 3 }}>TrueType · {buildResult.glyphCount} glyphs · ready to install</p>
              </div>
              <button onClick={handleDownloadTTF} style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                background: '#F0EBE0', color: '#1A1410',
                border: 'none', borderRadius: 10, padding: '11px 28px',
                fontSize: 13, fontFamily: "'DM Sans', sans-serif",
                cursor: 'pointer', fontWeight: 700, letterSpacing: '0.01em',
                flexShrink: 0,
              }}>
                ⬇ Download .ttf
              </button>
            </div>

          </>)}

          {/* ── Build / Rebuild button ── */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {buildState === 'idle' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#F7F5F0', border: '1px solid #DDD8CE', borderRadius: 10, padding: '10px 16px' }}>
                <span style={{ fontSize: 12, color: '#8A7B62' }}>⟳ Preparing font build…</span>
              </div>
            )}
            {buildState === 'done' && (
              <Btn onClick={() => { setBuildState('idle'); setBuildResult(null); setProgress({ pct: 0, label: '' }); setTimeout(() => handleBuild(), 50) }} variant="ghost" size="sm">
                ↺ Rebuild
              </Btn>
            )}
            {/* Build log toggle */}
            <button onClick={() => setShowLog(v => !v)} style={{
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: 11, color: C.inkLt, fontFamily: "'DM Sans', sans-serif",
              display: 'flex', alignItems: 'center', gap: 4, padding: 0,
            }}>
              <span style={{ fontFamily: 'monospace' }}>{showLog ? '▾' : '▸'}</span>
              Build Log ({buildLog.length} entries)
            </button>
          </div>
          {showLog && <BuildLogPanel entries={buildLog} />}

        </div>
      )}

    </div>
  )
}