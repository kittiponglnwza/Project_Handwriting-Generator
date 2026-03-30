import C from "../../styles/colors"

export function Adjuster({ label, value, min, max, step, onChange }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ fontSize: 11, color: C.inkMd }}>{label}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={e => onChange(Number(e.target.value))}
          style={{ flex: 1 }}
        />
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={e => onChange(Number(e.target.value))}
          style={{
            width: 64,
            border: `1px solid ${C.border}`,
            borderRadius: 8,
            padding: "4px 6px",
            fontSize: 11,
            color: C.ink,
            background: C.bgCard,
          }}
        />
      </div>
    </label>
  )
}

export function GridDebugOverlay({ glyphs }) {
  const stStyle = {
    ok: { border: "rgba(0,160,70,0.5)", bg: "rgba(0,200,80,0.06)", dot: "#00a046" },
    missing: { border: "rgba(200,60,60,0.5)", bg: "rgba(255,80,80,0.06)", dot: "#c83c3c" },
    overflow: { border: "rgba(200,140,0,0.5)", bg: "rgba(255,180,0,0.06)", dot: "#c88c00" },
  }

  if (!glyphs?.length)
    return <p style={{ fontSize: 11, color: C.inkLt, padding: "8px 0" }}>ยังไม่มีข้อมูล glyph</p>

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(72px, 1fr))",
        gap: 6,
      }}
    >
      {glyphs.map(g => {
        const s = stStyle[g.status] || stStyle.ok
        return (
          <div
            key={g.id}
            style={{
              background: s.bg,
              border: `1.5px solid ${s.border}`,
              borderRadius: 8,
              padding: "6px 4px 5px",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 3,
            }}
          >
            <div
              style={{
                width: "100%",
                aspectRatio: "1",
                background: "#fff",
                borderRadius: 5,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {g.svgPath ? (
                <svg
                  viewBox={g.viewBox || "0 0 100 100"}
                  style={{ width: "88%", height: "88%", overflow: "visible" }}
                >
                  <path
                    d={g.svgPath}
                    fill="none"
                    stroke={C.ink}
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              ) : (
                <span style={{ fontSize: 9, color: C.inkLt }}>—</span>
              )}
            </div>

            <p style={{ fontSize: 13, fontWeight: 600, color: C.ink, lineHeight: 1 }}>{g.ch}</p>
            <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
              <span
                style={{ width: 6, height: 6, borderRadius: "50%", background: s.dot, flexShrink: 0 }}
              />
              <p style={{ fontSize: 9, color: C.inkLt }}>#{g.index}</p>
            </div>
          </div>
        )
      })}
    </div>
  )
}
