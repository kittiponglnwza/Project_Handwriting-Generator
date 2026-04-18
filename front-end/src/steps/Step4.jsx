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
        <span style={{ color: '#4A3F30' }}>— ยังไม่มี log —</span>
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
            <path d={svgPath} fill="none" stroke={C.ink} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
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
        ⚠ {skipped.length} glyph ถูกข้าม (malformed paths)
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
    'กขคงจฉชซญดตถทธนบปผฝพฟภมยรลวศษสหอฮ\nThe quick brown fox jumps over the lazy dog.\nABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz\n0123456789 !@#$%^&*()-+=\nสวัสดี ภาษาไทย ทดสอบระบบ ฟอนต์ลายมือ'
  )
  const [fontSize, setFontSize] = useState(32)
  const fontStyleId = `font-preview-${fontName.replace(/\s+/g, '-')}`

  useEffect(() => {
    if (!ttfBuffer) return
    const existing = document.getElementById(fontStyleId)
    if (existing) existing.remove()

    const blob  = new Blob([ttfBuffer], { type: 'font/ttf' })
    const url   = URL.createObjectURL(blob)
    const style = document.createElement('style')
    style.id    = fontStyleId
    style.textContent = `@font-face { font-family: '${fontName}-Preview'; src: url('${url}') format('truetype'); }`
    document.head.appendChild(style)

    return () => {
      style.remove()
      URL.revokeObjectURL(url)
    }
  }, [ttfBuffer, fontName])

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
        <p style={{ fontSize: 11, fontWeight: 500, color: C.inkLt, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          Live Font Preview
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
          <span style={{ fontSize: 11, color: C.inkLt }}>Size:</span>
          <input
            type="range" min={14} max={80} value={fontSize}
            onChange={e => setFontSize(Number(e.target.value))}
            style={{ width: 80 }}
          />
          <span style={{ fontSize: 11, color: C.inkMd, fontFamily: 'monospace' }}>{fontSize}px</span>
        </div>
      </div>
      <textarea
        value={previewText}
        onChange={e => setPreviewText(e.target.value)}
        style={{
          width: '100%', boxSizing: 'border-box',
          minHeight: 180, resize: 'vertical',
          fontFamily: ttfBuffer ? `'${fontName}-Preview', cursive` : 'cursive',
          fontSize,
          lineHeight: 1.6,
          padding: '14px 16px',
          border: `1px solid ${C.border}`,
          borderRadius: 10,
          background: '#FEFCF8',
          color: C.ink,
          outline: 'none',
        }}
        placeholder="พิมพ์ข้อความเพื่อดูตัวอย่างฟอนต์..."
        spellCheck={false}
      />
      {!ttfBuffer && (
        <p style={{ fontSize: 10, color: C.inkLt, marginTop: 6 }}>
          ⚠ Build font ก่อนเพื่อดู preview ด้วยฟอนต์จริง (ตอนนี้แสดงฟอนต์ cursive ของระบบ)
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
      'คลิก "Install Font" ที่มุมซ้ายล่าง',
      'ฟอนต์จะปรากฏใน Font Book และพร้อมใช้งาน',
    ],
    win: [
      `Right-click ${fontName}.ttf`,
      'เลือก "Install" (เฉพาะ user) หรือ "Install for all users"',
      'ฟอนต์จะพร้อมใช้งานใน Word, Photoshop ฯลฯ',
    ],
    linux: [
      `mkdir -p ~/.local/share/fonts`,
      `cp ${fontName}.ttf ~/.local/share/fonts/`,
      `fc-cache -fv`,
      'ฟอนต์พร้อมใช้ในแอปทั้งหมด',
    ],
    web: [
      `คัดลอก ${fontName}.ttf และ ${fontName}.woff ไปใส่ server`,
      'ใส่ @font-face ใน CSS (ดูใน ZIP: fontface.css)',
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

export default function Step4({ glyphs = [], onFontReady }) {
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

  const glyphMap   = useMemo(() => hasGlyphs ? buildGlyphMap(glyphs) : new Map(), [glyphs, hasGlyphs])
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

  // ── Auto-build เมื่อ glyphs พร้อม และยังไม่เคย build ─────────────────────
  // ทำให้ Step 5 ได้ font ทันทีแม้ user ไม่เคยเข้า Step 4 เลย
  useEffect(() => {
    if (hasGlyphs && buildState === 'idle') {
      handleBuild()
    }
  }, [hasGlyphs]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Re-fire onFontReady เมื่อ component mount กลับมา และ build เสร็จแล้ว ─
  // กรณี user navigate Step4 → Step5 → Step4 → Step5 โดยไม่ build ใหม่
  useEffect(() => {
    if (buildState === 'done' && buildResult?.ttfBuffer) {
      onFontReady?.(buildResult.ttfBuffer)
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
    if (!hasGlyphs || buildState === 'building') return
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

      const result = await compileFontBuffer(glyphMap, fontName, onProgress)
      const {
        ttfBuffer, woffBuffer, glyphCount,
        skipped, buildLog: newLog, glyphInfo, featureStatus: fStatus,
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
      })
      setBuildState('done')

      // ── แจ้ง App ว่า font พร้อมแล้ว → Step 5 จะ inject @font-face ทันที ──
      onFontReady?.(ttfBuffer)
    } catch (err) {
      console.error('[Step4] Font build failed:', err)
      setErrorMsg(err.message || 'Unknown compilation error')
      setBuildState('error')
      setBuildLog(prev => [
        ...prev,
        { level: 'error', msg: `Build failed: ${err.message}`, ts: Date.now() },
      ])
    }
  }, [hasGlyphs, buildState, glyphMap, fontName])

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
    { id: 'overview',  label: 'ภาพรวม' },
    { id: 'glyphs',    label: `Glyphs (${charCount})` },
    { id: 'features',  label: 'OT Features' },
    { id: 'metrics',   label: 'Font Metrics' },
    { id: 'preview',   label: 'Preview' },
    { id: 'install',   label: 'Install Guide' },
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
            Real TTF + WOFF · GSUB salt/calt · GPOS Thai mark anchors · Smart per-glyph metrics
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
          <p style={{ fontSize: 13, color: C.amber, fontWeight: 500 }}>⚠ ยังไม่มีข้อมูล glyph</p>
          <p style={{ fontSize: 11, color: C.inkMd, marginTop: 3 }}>กลับไป Step 3 เพื่อ extract glyphs จากไฟล์ PDF ก่อน</p>
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
                    <b style={{ color: C.inkMd }}>.default</b> — ต้นฉบับ<br />
                    <b style={{ color: C.inkMd }}>.alt1</b> — หางตก (droop)<br />
                    <b style={{ color: C.inkMd }}>.alt2</b> — เส้นแกว่ง (wavy)
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
                        <path d={g.svgPath} fill="none" stroke={C.ink} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
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
      {activeTab === 'preview' && (
        <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 14, padding: '16px 20px', marginBottom: 20 }}>
          <FontPreviewPane fontName={fontName} ttfBuffer={buildResult?.ttfBuffer ?? null} />
        </div>
      )}

      {/* ════════════ Tab: Install ════════════ */}
      {activeTab === 'install' && (
        <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 14, padding: '16px 20px', marginBottom: 20 }}>
          <p style={{ fontSize: 11, fontWeight: 500, letterSpacing: '0.1em', textTransform: 'uppercase', color: C.inkLt, marginBottom: 14 }}>Install Font on Your System</p>
          <InstallGuidePanel fontName={fontName} />
        </div>
      )}

      {/* ════════════ Build Panel ════════════ */}
      <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 16, padding: '20px 24px', marginBottom: 14 }}>

        {/* Font name input */}
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <p style={{ fontSize: 11, color: C.inkLt, marginBottom: 5 }}>Font Family Name</p>
            <input
              value={fontName}
              onChange={e => setFontName(e.target.value.trim() || FONT_NAME)}
              disabled={buildState === 'building'}
              style={{
                width: '100%', boxSizing: 'border-box',
                border: `1px solid ${C.border}`, borderRadius: 8,
                padding: '7px 12px', fontSize: 13, fontFamily: 'monospace',
                color: C.ink, background: buildState === 'building' ? C.bgMuted : C.bgCard,
              }}
              maxLength={64}
            />
          </div>
          <p style={{ fontSize: 11, color: C.inkLt, paddingBottom: 8 }}>
            {charCount} chars × 3 = {totalVariants} glyphs
          </p>
        </div>

        {/* Progress */}
        {buildState === 'building' && (
          <div style={{ marginBottom: 16 }}>
            <ProgressBar pct={progress.pct} label={progress.label} sublabel={`${charCount} chars → ${totalVariants} glyphs`} />
            <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
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

        {/* Error */}
        {buildState === 'error' && (
          <div style={{ background: C.blushLt, border: `1px solid ${C.blushMd}`, borderRadius: 8, padding: '10px 14px', marginBottom: 14 }}>
            <p style={{ fontSize: 11, color: C.blush, fontWeight: 500 }}>⚠ Build failed</p>
            <p style={{ fontSize: 10, color: C.inkMd, marginTop: 4, fontFamily: 'monospace' }}>{errorMsg}</p>
          </div>
        )}

        {/* Success */}
        {buildState === 'done' && buildResult && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#EBF5EE', border: '1px solid #A8D5B5', borderRadius: 8, padding: '6px 14px', fontSize: 12, color: '#2E6B3E', marginBottom: 14 }}>
              ✅ Font compiled — {buildResult.glyphCount} total glyphs
              {buildResult.skipped.length > 0 && (
                <span style={{ color: C.amber, marginLeft: 6 }}>({buildResult.skipped.length} skipped)</span>
              )}
            </div>

            <SkippedGlyphsPanel skipped={buildResult.skipped} />

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 14, marginBottom: 12 }}>
              {[
                { label: `${fontName}.ttf`,  action: handleDownloadTTF,  primary: true  },
                { label: `${fontName}.woff`, action: handleDownloadWOFF, primary: true  },
                { label: 'glyphMap.json',     action: handleDownloadMap,  primary: false },
                { label: 'metadata.json',     action: handleDownloadMeta, primary: false },
              ].map(f => (
                <button key={f.label} onClick={f.action} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  background: f.primary ? C.ink : C.bgMuted,
                  color:      f.primary ? '#FBF9F5' : C.inkMd,
                  border: `1px solid ${f.primary ? C.ink : C.border}`,
                  borderRadius: 8, padding: '7px 14px',
                  fontSize: 12, fontFamily: "'DM Sans', sans-serif", cursor: 'pointer',
                }}>⬇ {f.label}</button>
              ))}
            </div>

            <button onClick={handleDownloadZip} style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              background: C.sage, color: '#fff', border: 'none',
              borderRadius: 10, padding: '9px 22px',
              fontSize: 13, fontFamily: "'DM Sans', sans-serif",
              cursor: 'pointer', fontWeight: 500,
            }}>
              📦 Export ZIP (fonts + CSS + INSTALL.md + build.log)
            </button>
          </div>
        )}

        {buildState !== 'done' && (
          <Btn onClick={handleBuild} disabled={!hasGlyphs || buildState === 'building'} variant="sage" size="md">
            {buildState === 'building'
              ? `⟳ กำลัง build… ${progress.pct}%`
              : buildState === 'error'
              ? '↺ ลองอีกครั้ง'
              : `⚙ Build Font — ${charCount} characters`}
          </Btn>
        )}

        {buildState === 'done' && (
          <Btn
            onClick={() => { setBuildState('idle'); setBuildResult(null); setProgress({ pct: 0, label: '' }) }}
            variant="ghost" size="sm"
          >↺ Rebuild</Btn>
        )}

        {/* Build log */}
        <div style={{ marginTop: 14 }}>
          <button onClick={() => setShowLog(v => !v)} style={{
            background: 'none', border: 'none', cursor: 'pointer',
            fontSize: 11, color: C.inkLt, fontFamily: "'DM Sans', sans-serif",
            display: 'flex', alignItems: 'center', gap: 5, padding: 0,
          }}>
            <span style={{ fontFamily: 'monospace' }}>{showLog ? '▾' : '▸'}</span>
            Build Log ({buildLog.length} entries)
          </button>
          {showLog && <div style={{ marginTop: 8 }}><BuildLogPanel entries={buildLog} /></div>}
        </div>
      </div>

    </div>
  )
}