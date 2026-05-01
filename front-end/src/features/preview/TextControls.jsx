// TextControls.jsx — warm minimal redesign
const SIZES = [10,12,14,16,18,20,24,28,32,36,42,48,56,64,72,96]

export const PRESETS = [
  { id: 'body',    label: 'Body',      size: 20, lh: 1.9, ls: 0.01  },
  { id: 'heading', label: 'Heading',   size: 40, lh: 1.3, ls: -0.02 },
  { id: 'note',    label: 'Note',      size: 15, lh: 2.1, ls: 0.01  },
  { id: 'display', label: 'Display',   size: 68, lh: 1.1, ls: -0.03 },
  { id: 'sign',    label: 'Signature', size: 52, lh: 1.2, ls: 0.03  },
]

const sliderBase = {
  WebkitAppearance: 'none',
  width: '100%',
  height: 3,
  borderRadius: 99,
  background: '#E2DDD4',
  outline: 'none',
  cursor: 'pointer',
  accentColor: '#B87333',
  display: 'block',
  marginBottom: 16,
}

export function TextControls({ fontSize, lineHeight, letterSpacing, onFontSize, onLineHeight, onLetterSpacing }) {
  return (
    <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
      <label style={{ fontSize: 11, color: '#6B5E52', display: 'flex', alignItems: 'center', gap: 6 }}>
        Size
        <select
          value={fontSize}
          onChange={e => onFontSize(Number(e.target.value))}
          style={{
            padding: '3px 8px', borderRadius: 6, fontSize: 11,
            border: '1.5px solid #E2DDD4', background: '#FDFBF7',
            color: '#2C2420', outline: 'none', cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          {SIZES.map(s => <option key={s} value={s}>{s}px</option>)}
        </select>
      </label>

      <label style={{ fontSize: 11, color: '#6B5E52', display: 'flex', alignItems: 'center', gap: 6 }}>
        Line height
        <input type="range" min={1} max={3} step={0.05} value={lineHeight}
          onChange={e => onLineHeight(Number(e.target.value))}
          style={{ width: 72, accentColor: '#B87333' }} />
        <span style={{ minWidth: 28, fontSize: 10, color: '#A89A8C' }}>{lineHeight.toFixed(1)}</span>
      </label>

      <label style={{ fontSize: 11, color: '#6B5E52', display: 'flex', alignItems: 'center', gap: 6 }}>
        Letter spacing
        <input type="range" min={-0.1} max={0.2} step={0.005} value={letterSpacing}
          onChange={e => onLetterSpacing(Number(e.target.value))}
          style={{ width: 72, accentColor: '#B87333' }} />
        <span style={{ minWidth: 36, fontSize: 10, color: '#A89A8C' }}>{letterSpacing.toFixed(3)}</span>
      </label>
    </div>
  )
}