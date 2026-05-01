// FontStylePanel.jsx — Roughness / neatness / slant / boldness / randomness sliders
import { useState } from 'react'

const FONT_SLIDERS = [
  { key: 'roughness',  label: 'Roughness',  min: 0,   max: 100, unit: ''  },
  { key: 'neatness',   label: 'Neatness',   min: 0,   max: 100, unit: ''  },
  { key: 'slant',      label: 'Slant',      min: -30, max: 30,  unit: '°' },
  { key: 'boldness',   label: 'Weight',     min: 70,  max: 150, unit: '%' },
  { key: 'randomness', label: 'Randomness', min: 0,   max: 100, unit: ''  },
]

export function FontStylePanel({ fontStyle, onFontStyleChange }) {
  const [editingKey, setEditingKey] = useState(null)
  const [editingVal, setEditingVal] = useState('')

  if (!fontStyle || !onFontStyleChange) return null

  const commitEdit = (key, min, max) => {
    const num = parseInt(editingVal, 10)
    if (!isNaN(num)) {
      onFontStyleChange(key, Math.min(max, Math.max(min, num)))
    }
    setEditingKey(null)
  }

  return (
    <div style={{
      background: '#fff', borderRadius: 14, padding: '20px 24px',
      border: '1px solid #DDD8CE', boxShadow: '0 1px 4px rgba(44,36,22,0.07)',
    }}>
      <p style={{ fontSize: 11, fontWeight: 600, color: '#8A7B62', marginBottom: 18, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
        Font Style
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 32px' }}>
        {FONT_SLIDERS.map(({ key, label, min, max, unit }) => {
          const pct = ((fontStyle[key] - min) / (max - min)) * 100
          const isEditing = editingKey === key
          return (
            <div key={key} style={{ paddingBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <label style={{ fontSize: 12, color: '#5C5040', fontWeight: 500 }}>{label}</label>
                {isEditing ? (
                  <input
                    type="text"
                    value={editingVal}
                    autoFocus
                    onChange={e => setEditingVal(e.target.value)}
                    onBlur={() => commitEdit(key, min, max)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') commitEdit(key, min, max)
                      if (e.key === 'Escape') setEditingKey(null)
                    }}
                    style={{
                      fontSize: 12, fontWeight: 700, color: '#1A1410',
                      background: '#FBF9F5', border: '1.5px solid #2C2416',
                      borderRadius: 5, padding: '1px 5px', width: 52,
                      textAlign: 'center', outline: 'none', fontFamily: 'monospace',
                    }}
                  />
                ) : (
                  <span
                    onClick={() => { setEditingKey(key); setEditingVal(String(fontStyle[key])) }}
                    title="Click to type a value"
                    style={{
                      fontSize: 12, color: '#1A1410', fontWeight: 700,
                      background: '#F2EDE4', borderRadius: 5, padding: '1px 7px',
                      minWidth: 36, textAlign: 'center', cursor: 'text',
                      border: '1px solid transparent',
                      transition: 'border-color 0.12s, background 0.12s',
                      userSelect: 'none',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = '#C4B89A'; e.currentTarget.style.background = '#EDE8DC' }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = 'transparent'; e.currentTarget.style.background = '#F2EDE4' }}
                  >
                    {fontStyle[key]}{unit}
                  </span>
                )}
              </div>
              <div style={{ position: 'relative', height: 20, display: 'flex', alignItems: 'center' }}>
                <div style={{ position: 'absolute', left: 0, top: '50%', transform: 'translateY(-50%)', width: '100%', height: 3, background: '#E5DFD4', borderRadius: 3 }} />
                <div style={{ position: 'absolute', left: 0, top: '50%', transform: 'translateY(-50%)', width: `${pct}%`, height: 3, background: '#2C2416', borderRadius: 3, transition: 'width 0.05s' }} />
                <input
                  type="range" min={min} max={max} value={fontStyle[key]}
                  onChange={e => onFontStyleChange(key, Number(e.target.value))}
                  style={{ position: 'relative', width: '100%', margin: 0, appearance: 'none', WebkitAppearance: 'none', background: 'transparent', cursor: 'pointer', height: 20 }}
                />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}