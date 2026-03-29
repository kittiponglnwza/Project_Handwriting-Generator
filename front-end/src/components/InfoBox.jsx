import C from "../styles/colors"

const toneStyles = {
  neutral: { background: C.bgMuted, color: C.inkMd, border: C.border },
  sage: { background: C.sageLt, color: C.sage, border: C.sageMd },
  amber: { background: C.amberLt, color: C.amber, border: C.amberMd },
}

export default function InfoBox({ children, color = "neutral" }) {
  const s = toneStyles[color]
  return (
    <div
      style={{
        padding: "10px 14px",
        borderRadius: 10,
        marginBottom: 20,
        background: s.background,
        color: s.color,
        border: `1px solid ${s.border}`,
        fontSize: 12,
        lineHeight: 1.6,
        display: "flex",
        gap: 8,
      }}
    >
      <span style={{ marginTop: 1, fontWeight: 600 }}>ℹ</span>
      <span>{children}</span>
    </div>
  )
}
