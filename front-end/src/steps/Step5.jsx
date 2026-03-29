import { useState } from "react"
import Divider from "../components/Divider"
import Tag from "../components/Tag"
import C from "../styles/colors"

export default function Step5() {
  const [text, setText] = useState("สวัสดีครับ ทดสอบลายมือดิจิทัล")
  const [fontSize, setFontSize] = useState(20)
  const [lineH, setLineH] = useState(2.0)

  return (
    <div className="fade-up">
      <div
        style={{
          background: C.bgCard,
          border: `1px solid ${C.border}`,
          borderRadius: 16,
          overflow: "hidden",
          marginBottom: 16,
        }}
      >
        <div
          style={{
            padding: "10px 16px",
            borderBottom: `1px solid ${C.border}`,
            background: C.bgMuted,
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <Tag color="draft">Draft • Canvas</Tag>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 10, color: C.inkLt }}>ขนาด</span>
              <select
                value={fontSize}
                onChange={e => setFontSize(Number(e.target.value))}
                style={{
                  fontSize: 11,
                  border: `1px solid ${C.border}`,
                  borderRadius: 6,
                  padding: "3px 8px",
                  background: C.bgCard,
                  color: C.ink,
                  fontFamily: "inherit",
                }}
              >
                {[14, 16, 18, 20, 24, 28].map(s => (
                  <option key={s} value={s}>
                    {s}px
                  </option>
                ))}
              </select>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 10, color: C.inkLt }}>บรรทัด</span>
              <select
                value={lineH}
                onChange={e => setLineH(Number(e.target.value))}
                style={{
                  fontSize: 11,
                  border: `1px solid ${C.border}`,
                  borderRadius: 6,
                  padding: "3px 8px",
                  background: C.bgCard,
                  color: C.ink,
                  fontFamily: "inherit",
                }}
              >
                {[1.6, 1.8, 2.0, 2.2, 2.5].map(s => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
        <div
          style={{
            minHeight: 120,
            padding: "20px 24px",
            fontSize,
            lineHeight: lineH,
            color: C.ink,
            fontFamily: "'DM Serif Display', serif",
            letterSpacing: "0.01em",
          }}
        >
          {text || " "}
          <span className="cursor" />
        </div>
      </div>
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        rows={3}
        placeholder="พิมพ์ข้อความที่ต้องการ..."
        style={{
          width: "100%",
          border: `1px solid ${C.border}`,
          borderRadius: 12,
          padding: "12px 16px",
          fontSize: 14,
          resize: "none",
          background: C.bgCard,
          color: C.ink,
          outline: "none",
          fontFamily: "'DM Sans', sans-serif",
          lineHeight: 1.6,
          transition: "border-color 0.15s",
        }}
        onFocus={e => (e.target.style.borderColor = C.ink)}
        onBlur={e => (e.target.style.borderColor = C.border)}
      />
      <Divider />
      <p
        style={{
          fontSize: 10,
          fontWeight: 500,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: C.inkLt,
          marginBottom: 14,
        }}
      >
        Export
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <button
          className="glyph-card"
          style={{
            background: C.ink,
            border: "none",
            borderRadius: 14,
            padding: "20px 16px",
            textAlign: "center",
            cursor: "pointer",
          }}
        >
          <div style={{ fontSize: 24, marginBottom: 10 }}>📄</div>
          <p style={{ fontSize: 13, fontWeight: 500, color: "#FBF9F5", marginBottom: 4 }}>
            Export PDF
          </p>
          <p style={{ fontSize: 10, color: "#7C6E58" }}>SVG Mode • Full DNA • Deterministic</p>
        </button>
        <button
          className="glyph-card"
          style={{
            background: C.bgCard,
            border: `1px solid ${C.border}`,
            borderRadius: 14,
            padding: "20px 16px",
            textAlign: "center",
            cursor: "pointer",
          }}
        >
          <div style={{ fontSize: 24, marginBottom: 10 }}>✈</div>
          <p style={{ fontSize: 13, fontWeight: 500, color: C.ink, marginBottom: 4 }}>
            Export SVG
          </p>
          <p style={{ fontSize: 10, color: C.inkLt }}>Vector • โครงสร้างเดิม</p>
        </button>
      </div>
    </div>
  )
}
