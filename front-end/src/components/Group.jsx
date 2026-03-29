import C from "../styles/colors"
import CharCell from "./CharCell"
import Btn from "./Btn"

export default function Group({
  label,
  chars,
  selected,
  onToggle,
  onSelectGroup = () => {},
  onClearGroup = () => {},
}) {
  const selectedCount = chars.reduce((count, ch) => (selected.has(ch) ? count + 1 : count), 0)
  const allSelected = selectedCount === chars.length && chars.length > 0
  const hasAnySelected = selectedCount > 0

  return (
    <div style={{ marginBottom: 24 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 10,
          flexWrap: "wrap",
        }}
      >
        <p
          style={{
            fontSize: 10,
            fontWeight: 500,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: C.inkLt,
            marginRight: "auto",
          }}
        >
          {label} ({selectedCount}/{chars.length})
        </p>
        <Btn
          onClick={() => onSelectGroup(chars)}
          variant={allSelected ? "ghost" : "sage"}
          size="sm"
          disabled={allSelected}
        >
          เลือกทั้งหมวด
        </Btn>
        <Btn
          onClick={() => onClearGroup(chars)}
          variant="ghost"
          size="sm"
          disabled={!hasAnySelected}
        >
          ล้างหมวด
        </Btn>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(38px, 1fr))",
          gap: 6,
        }}
      >
        {chars.map(ch => (
          <CharCell key={ch} ch={ch} selected={selected} onToggle={onToggle} />
        ))}
      </div>
    </div>
  )
}
