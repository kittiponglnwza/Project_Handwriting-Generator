import C from "../styles/colors"

const DNA_PARAMS = [
  { name: "Spacing tendency", dist: "Normal • σ = 0.05em", value: 62 },
  { name: "Baseline offset", dist: "Normal • μ = 0 • σ = 1.5px", value: 45 },
  { name: "Rotation tendency", dist: "Uniform ±1.5°", value: 50 },
  { name: "Scale variation", dist: "Normal • σ = 0.03", value: 38 },
]

const SEEDS = ["0x7f3a2c91", "0x3b9e12f4", "0xa1c8e302", "0x55d0f7ab"]

export default function Step4() {
  const seed = SEEDS[1]
  return (
    <div className="fade-up">
      <div style={{ marginBottom: 24 }}>
        <p
          style={{
            fontSize: 10,
            fontWeight: 500,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: C.inkLt,
            marginBottom: 8,
          }}
        >
          Document Seed
        </p>
        <div
          style={{
            background: "#1E1A14",
            borderRadius: 12,
            padding: "14px 18px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span style={{ fontFamily: "monospace", fontSize: 13, color: "#9E9278" }}>
            seed: <span style={{ color: "#7CC4B0", fontWeight: 600 }}>{seed}</span>
          </span>
          <span style={{ fontSize: 10, color: "#5C5340", letterSpacing: "0.05em" }}>
            Mulberry32 • deterministic
          </span>
        </div>
      </div>
      <p
        style={{
          fontSize: 10,
          fontWeight: 500,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: C.inkLt,
          marginBottom: 12,
        }}
      >
        DNA Parameters
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 24 }}>
        {DNA_PARAMS.map(p => (
          <div
            key={p.name}
            style={{
              background: C.bgCard,
              border: `1px solid ${C.border}`,
              borderRadius: 12,
              padding: "14px 18px",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
                marginBottom: 10,
              }}
            >
              <p style={{ fontSize: 13, fontWeight: 500, color: C.ink }}>{p.name}</p>
              <p style={{ fontSize: 10, color: C.inkLt, fontFamily: "monospace" }}>{p.dist}</p>
            </div>
            <div style={{ height: 4, background: C.bgMuted, borderRadius: 2, overflow: "hidden" }}>
              <div
                className="bar-fill"
                style={{ height: "100%", width: `${p.value}%`, background: C.ink, borderRadius: 2 }}
              />
            </div>
            <p style={{ fontSize: 10, color: C.inkLt, marginTop: 6 }}>{p.value}% variance applied</p>
          </div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10 }}>
        {[
          { l: "Thai layers", v: "4", u: "layers", s: "P1 offset table" },
          { l: "Glyph variants", v: "1", u: "page", s: "multi-page: future" },
          { l: "Export parity", v: "100", u: "%", s: "same seed = same" },
        ].map(s => (
          <div
            key={s.l}
            style={{
              background: C.bgCard,
              border: `1px solid ${C.border}`,
              borderRadius: 12,
              padding: "14px 12px",
              textAlign: "center",
            }}
          >
            <p style={{ fontFamily: "'DM Serif Display', serif", fontSize: 24, fontWeight: 400, color: C.ink }}>
              {s.v}
              <span style={{ fontSize: 12, color: C.inkLt, marginLeft: 2 }}>{s.u}</span>
            </p>
            <p style={{ fontSize: 10, color: C.inkMd, marginTop: 4 }}>{s.l}</p>
            <p style={{ fontSize: 9, color: C.inkLt, marginTop: 2 }}>{s.s}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
