// PaperPicker.jsx — warm minimal redesign
export const PAPERS = [
  { id: 'blank',  label: 'Blank',       bg: '#FDFBF7', texture: false },
  { id: 'ruled',  label: 'Ruled',       bg: '#FDFBF7', texture: 'ruled' },
  { id: 'grid',   label: 'Grid',        bg: '#FDFBF7', texture: 'grid' },
  { id: 'aged',   label: 'Aged',        bg: '#F2EBD9', texture: false },
  { id: 'dark',   label: 'Blackboard',  bg: '#1A1F2E', texture: false },
  { id: 'kraft',  label: 'Kraft',       bg: '#D4B896', texture: false },
]

export function PaperPicker({ value, onChange }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {PAPERS.map(p => (
        <button
          key={p.id}
          onClick={() => onChange(p.id)}
          style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '8px 11px',
            border: `1.5px solid ${value === p.id ? '#2C2420' : '#E2DDD4'}`,
            borderRadius: 8,
            background: value === p.id ? '#F4F0E8' : '#FDFBF7',
            cursor: 'pointer',
            transition: 'all 0.15s',
            textAlign: 'left',
            fontFamily: 'inherit',
          }}
          onMouseEnter={e => { if (value !== p.id) e.currentTarget.style.borderColor = '#CCC6BB' }}
          onMouseLeave={e => { if (value !== p.id) e.currentTarget.style.borderColor = '#E2DDD4' }}
        >
          {/* Swatch */}
          <div style={{
            width: 28, height: 20, borderRadius: 4, flexShrink: 0,
            background: p.bg,
            border: '1px solid #E2DDD4',
            ...(p.texture === 'ruled' ? {
              backgroundImage: 'repeating-linear-gradient(transparent,transparent 4px,rgba(0,60,180,.12) 4px,rgba(0,60,180,.12) 5px)',
            } : p.texture === 'grid' ? {
              backgroundImage: 'linear-gradient(rgba(0,60,180,.1) 1px,transparent 1px),linear-gradient(90deg,rgba(0,60,180,.1) 1px,transparent 1px)',
              backgroundSize: '5px 5px',
            } : {}),
          }} />
          <span style={{
            fontSize: 11.5,
            color: value === p.id ? '#2C2420' : '#6B5E52',
            fontWeight: value === p.id ? 600 : 400,
          }}>{p.label}</span>
          {value === p.id && (
            <span style={{ marginLeft: 'auto', color: '#B87333', fontSize: 11 }}>✓</span>
          )}
        </button>
      ))}
    </div>
  )
}