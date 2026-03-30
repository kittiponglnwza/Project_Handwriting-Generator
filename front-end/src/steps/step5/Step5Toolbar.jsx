function RibbonBtn({ onClick, active, title, children, disabled }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: 28,
        height: 26,
        padding: "0 6px",
        border: `1px solid ${active ? "#0078d4" : "transparent"}`,
        borderRadius: 4,
        background: active ? "#deecf9" : "transparent",
        color: active ? "#0078d4" : "#323130",
        cursor: disabled ? "not-allowed" : "pointer",
        fontSize: 12,
        opacity: disabled ? 0.45 : 1,
      }}
    >
      {children}
    </button>
  )
}

function RibbonGroup({ label, children }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 4,
        padding: "6px 10px 4px",
        borderLeft: "1px solid #d2d0ce",
        minHeight: 72,
      }}
    >
      <div style={{ display: "flex", flexWrap: "wrap", gap: 2, justifyContent: "center" }}>{children}</div>
      <span
        style={{
          fontSize: 10,
          color: "#605e5c",
          userSelect: "none",
          marginTop: "auto",
          paddingTop: 2,
        }}
      >
        {label}
      </span>
    </div>
  )
}

function ColorDot({ color, active, onClick, title }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      style={{
        width: 18,
        height: 18,
        borderRadius: "50%",
        background: color,
        border: active ? "2px solid #0078d4" : "1px solid #c8c6c4",
        cursor: "pointer",
        flexShrink: 0,
        transform: active ? "scale(1.1)" : "scale(1)",
      }}
    />
  )
}

export default function Step5Toolbar({
  hasFileGlyphs,
  versionedGlyphs,
  fontSize,
  setFontSize,
  fontWeight,
  setFontWeight,
  textColor,
  setTextColor,
  lineHeight,
  setLineHeight,
  alignment,
  setAlignment,
  hlColor,
  setHlColor,
  marginPx,
  setMarginPx,
  paraSpacing,
  setParaSpacing,
  exportPdf,
  text,
  outputOffsetX,
  setOutputOffsetX,
  showVersionDebug,
  setShowVersionDebug,
  setDnaNonce,
  overlapFactor,
  setOverlapFactor,
  slotWRatio,
  setSlotWRatio,
  LINE_PRESETS,
  ALIGN_OPTS,
  WEIGHT_OPTS,
  FONT_SIZES,
  TEXT_COLORS,
  HL_COLORS,
}) {
  return (
    <div
      style={{
        background: "#ffffff",
        borderBottom: "1px solid #d2d0ce",
        padding: "6px 12px 0",
        flexShrink: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 2 }}>
        <span style={{ fontSize: 12, color: "#605e5c", padding: "4px 10px" }}>ไฟล์</span>
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: "#323130",
            padding: "6px 14px",
            borderBottom: "3px solid #0078d4",
            marginBottom: -1,
          }}
        >
          หน้าแรก
        </span>
        <span style={{ fontSize: 12, color: "#605e5c", padding: "4px 10px" }}>แทรก</span>
        <span style={{ fontSize: 12, color: "#605e5c", padding: "4px 10px" }}>การออกแบบ</span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: "#605e5c" }}>
          {hasFileGlyphs
            ? `ลายมือ: ${versionedGlyphs.length} สล็อต (×3 เวอร์ชัน) • Step 3 → DNA`
            : "ยังไม่มี glyph — อัปโหลด PDF ใน Step 2"}
        </span>
      </div>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "stretch",
          background: "#f3f2f1",
          border: "1px solid #d2d0ce",
          borderRadius: "4px 4px 0 0",
          marginTop: 4,
        }}
      >
        <RibbonGroup label="คลิปบอร์ด">
          <RibbonBtn title="สุ่มลายมือใหม่" onClick={() => setDnaNonce(n => n + 1)}>
            🎲 DNA
          </RibbonBtn>
        </RibbonGroup>

        <RibbonGroup label="แบบอักษร">
          <select
            value={fontSize}
            onChange={e => setFontSize(Number(e.target.value))}
            style={{
              height: 26,
              padding: "0 6px",
              fontSize: 12,
              borderRadius: 4,
              border: "1px solid #d2d0ce",
              background: "#fff",
              minWidth: 64,
            }}
          >
            {FONT_SIZES.map(s => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <input
            type="number"
            min={16}
            max={120}
            step={1}
            value={fontSize}
            onChange={e => setFontSize(Math.max(16, Math.min(120, Number(e.target.value) || 16)))}
            style={{
              height: 26,
              width: 72,
              padding: "0 6px",
              fontSize: 12,
              borderRadius: 4,
              border: "1px solid #d2d0ce",
              background: "#fff",
            }}
            aria-label="Font size custom"
            title="Font size custom"
          />
          {WEIGHT_OPTS.map(w => (
            <RibbonBtn key={w} active={fontWeight === w} onClick={() => setFontWeight(w)} title={w}>
              <span style={{ fontWeight: w === "bold" ? 700 : w === "light" ? 300 : 500, fontSize: 11 }}>
                {w === "bold" ? "B" : w === "light" ? "L" : "Aa"}
              </span>
            </RibbonBtn>
          ))}
          <span style={{ fontSize: 10, color: "#605e5c", marginLeft: 4 }}>สี</span>
          {TEXT_COLORS.map(c => (
            <ColorDot key={c} color={c} active={textColor === c} onClick={() => setTextColor(c)} title={c} />
          ))}
        </RibbonGroup>

        <RibbonGroup label="ย่อหน้า">
          {LINE_PRESETS.map(p => (
            <RibbonBtn
              key={p.value}
              active={lineHeight === p.value}
              onClick={() => setLineHeight(p.value)}
              title={`ระยะบรรทัด ${p.label}`}
            >
              {p.label}×
            </RibbonBtn>
          ))}
          <label
            style={{
              fontSize: 11,
              display: "flex",
              alignItems: "center",
              gap: 4,
              padding: "0 4px",
              marginTop: 2,
            }}
            title="ปรับระยะห่างระหว่างบรรทัดอิสระ"
          >
            <input
              type="range"
              min={0}
              max={5}
              step={0.05}
              value={lineHeight}
              onChange={e => setLineHeight(Number(e.target.value))}
              style={{ width: 90, accentColor: "#0078d4" }}
            />
            <input
              type="number"
              min={0}
              step={0.05}
              value={lineHeight}
              onChange={e => {
                const v = Number(e.target.value)
                if (!isNaN(v) && v >= 0) setLineHeight(v)
              }}
              style={{
                width: 56,
                height: 24,
                padding: "0 4px",
                fontSize: 12,
                borderRadius: 4,
                border: "1px solid #d2d0ce",
                background: "#fff",
              }}
              aria-label="Custom line height"
            />
            <span style={{ color: "#605e5c" }}>×</span>
          </label>
          {ALIGN_OPTS.map(a => (
            <RibbonBtn
              key={a.id}
              active={alignment === a.id}
              onClick={() => setAlignment(a.id)}
              title={a.title}
            >
              {a.icon}
            </RibbonBtn>
          ))}
          <span style={{ fontSize: 10, color: "#605e5c" }}>HL</span>
          {HL_COLORS.map((c, i) => (
            <ColorDot
              key={i}
              color={c || "#f3f2f1"}
              active={hlColor === c}
              onClick={() => setHlColor(c)}
              title={c || "ไม่เน้น"}
            />
          ))}
        </RibbonGroup>

        <RibbonGroup label="หน้า">
          <label style={{ fontSize: 11, display: "flex", alignItems: "center", gap: 4 }}>
            ขอบ
            <input
              type="range"
              min={16}
              max={96}
              value={marginPx}
              onChange={e => setMarginPx(+e.target.value)}
              style={{ width: 72, accentColor: "#0078d4" }}
            />
            <span style={{ minWidth: 28 }}>{marginPx}</span>
          </label>
          <label style={{ fontSize: 11, display: "flex", alignItems: "center", gap: 4 }}>
            ระยะย่อหน้า
            <input
              type="range"
              min={0}
              max={28}
              value={paraSpacing}
              onChange={e => setParaSpacing(+e.target.value)}
              style={{ width: 64, accentColor: "#0078d4" }}
            />
          </label>
        </RibbonGroup>

        <RibbonGroup label="ระยะห่างตัวอักษร">
          <label style={{ fontSize: 11, display: "flex", alignItems: "center", gap: 4 }}>
            ชิด←→ห่าง
            <input
              type="range"
              min={0}
              max={0.55}
              step={0.01}
              value={overlapFactor}
              onChange={e => setOverlapFactor(Number(e.target.value))}
              style={{ width: 80, accentColor: "#0078d4" }}
            />
            <span style={{ minWidth: 28, fontVariantNumeric: "tabular-nums" }}>
              {Math.round(overlapFactor * 100)}%
            </span>
          </label>
          <label style={{ fontSize: 11, display: "flex", alignItems: "center", gap: 4 }}>
            กว้าง←→แคบ
            <input
              type="range"
              min={0.35}
              max={0.90}
              step={0.01}
              value={slotWRatio}
              onChange={e => setSlotWRatio(Number(e.target.value))}
              style={{ width: 80, accentColor: "#0078d4" }}
            />
            <span style={{ minWidth: 28, fontVariantNumeric: "tabular-nums" }}>
              {Math.round(slotWRatio * 100)}%
            </span>
          </label>
        </RibbonGroup>

        <RibbonGroup label="ส่งออก">
          <button
            type="button"
            onClick={exportPdf}
            disabled={!text.trim()}
            style={{
              height: 28,
              padding: "0 16px",
              borderRadius: 4,
              border: "none",
              background: text.trim() ? "#0078d4" : "#c8c6c4",
              color: "#fff",
              fontWeight: 600,
              fontSize: 12,
              cursor: text.trim() ? "pointer" : "not-allowed",
            }}
          >
            Export PDF
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: 8, paddingLeft: 6 }}>
            <span style={{ fontSize: 10, color: "#605e5c", whiteSpace: "nowrap" }}>Output X</span>
            <input
              type="range"
              min={-120}
              max={120}
              value={outputOffsetX}
              onChange={e => setOutputOffsetX(+e.target.value)}
              style={{ width: 110, accentColor: "#0078d4" }}
            />
            <span style={{ fontSize: 10, color: "#605e5c", minWidth: 34, textAlign: "right" }}>
              {outputOffsetX}
            </span>
          </div>
          <RibbonBtn active={showVersionDebug} onClick={() => setShowVersionDebug(v => !v)} title="แสดง v1/v2/v3">
            v?
          </RibbonBtn>
        </RibbonGroup>
      </div>
    </div>
  )
}