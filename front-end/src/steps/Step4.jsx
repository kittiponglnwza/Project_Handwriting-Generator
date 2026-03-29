import { useMemo, useState } from "react"
import Btn from "../components/Btn"
import C from "../styles/colors"

const DNA_PARAMS = [
  { name: "Spacing tendency", dist: "Normal • σ = 0.05em", value: 62 },
  { name: "Baseline offset", dist: "Normal • μ = 0 • σ = 1.5px", value: 45 },
  { name: "Rotation tendency", dist: "Uniform ±1.5°", value: 50 },
  { name: "Scale variation", dist: "Normal • σ = 0.03", value: 38 },
]

const SEEDS = ["0x7f3a2c91", "0x3b9e12f4", "0xa1c8e302", "0x55d0f7ab"]

function hashString(input) {
  let hash = 2166136261
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash +=
      (hash << 1) +
      (hash << 4) +
      (hash << 7) +
      (hash << 8) +
      (hash << 24)
  }
  return hash >>> 0
}

function seededUnit(seedStr) {
  const n = hashString(seedStr)
  return n / 4294967295
}

function mapRange(seedStr, min, max) {
  return min + seededUnit(seedStr) * (max - min)
}

function buildVariant(char, seed, version) {
  const key = `${seed}-${char}-v${version}`
  return {
    version,
    rotate: mapRange(`${key}-r`, -4.2, 4.2),
    skewX: mapRange(`${key}-sx`, -5.5, 5.5),
    scaleX: mapRange(`${key}-x`, 0.93, 1.08),
    scaleY: mapRange(`${key}-y`, 0.9, 1.08),
    shiftX: mapRange(`${key}-tx`, -6.5, 6.5),
    shiftY: mapRange(`${key}-ty`, -8, 6),
    weight: Math.round(mapRange(`${key}-w`, 420, 640)),
  }
}

export default function Step4({ selected, templateChars = [], extractedGlyphs = [] }) {
  const seed = SEEDS[1]
  const sourceChars = useMemo(
    () => (templateChars.length > 0 ? templateChars : [...selected]),
    [selected, templateChars]
  )

  const hasFileSource = extractedGlyphs.length > 0
  const [pickedGlyphId, setPickedGlyphId] = useState("")
  const [pickedChar, setPickedChar] = useState("")

  const activeFileGlyph = useMemo(() => {
    if (!hasFileSource) return null
    return extractedGlyphs.find(g => g.id === pickedGlyphId) || extractedGlyphs[0]
  }, [hasFileSource, extractedGlyphs, pickedGlyphId])

  const baseChar = useMemo(() => {
    if (hasFileSource) return activeFileGlyph?.ch || "ก"
    if (pickedChar && sourceChars.includes(pickedChar)) return pickedChar
    return sourceChars[0] || "ก"
  }, [hasFileSource, activeFileGlyph, pickedChar, sourceChars])

  const basePreview = hasFileSource ? activeFileGlyph?.preview || "" : ""

  const variants = useMemo(() => {
    return [1, 2, 3].map(v => buildVariant(baseChar || "ก", seed, v))
  }, [baseChar, seed])

  const handleRandom = () => {
    if (hasFileSource) {
      const randomIndex = Math.floor(Math.random() * extractedGlyphs.length)
      const randomGlyph = extractedGlyphs[randomIndex]
      if (randomGlyph) setPickedGlyphId(randomGlyph.id)
      return
    }

    if (sourceChars.length === 0) return
    const randomIndex = Math.floor(Math.random() * sourceChars.length)
    setPickedChar(sourceChars[randomIndex])
  }

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
          1 Glyph to 3 Versions
        </p>

        <div
          style={{
            background: C.bgCard,
            border: `1px solid ${C.border}`,
            borderRadius: 14,
            padding: "14px 16px",
            marginBottom: 12,
          }}
        >
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 12, color: C.inkMd }}>
              {hasFileSource ? "เลือกตัวจากไฟล์ PDF:" : "เลือกตัวอักษรต้นแบบ:"}
            </span>
            <select
              value={hasFileSource ? activeFileGlyph?.id || "" : baseChar}
              onChange={e => {
                if (hasFileSource) {
                  setPickedGlyphId(e.target.value)
                } else {
                  setPickedChar(e.target.value)
                }
              }}
              style={{
                minWidth: 180,
                border: `1px solid ${C.border}`,
                borderRadius: 8,
                padding: "6px 10px",
                fontSize: 13,
                background: C.bgCard,
                color: C.ink,
              }}
            >
              {hasFileSource
                ? extractedGlyphs.map(g => (
                    <option key={g.id} value={g.id}>
                      {g.ch} • ช่อง {g.index}
                    </option>
                  ))
                : sourceChars.length > 0
                  ? sourceChars.map(ch => (
                      <option key={ch} value={ch}>
                        {ch}
                      </option>
                    ))
                  : [
                      <option key={baseChar} value={baseChar}>
                        {baseChar}
                      </option>,
                    ]}
            </select>
            <Btn
              onClick={handleRandom}
              variant="ghost"
              size="sm"
              disabled={!hasFileSource && sourceChars.length === 0}
            >
              สุ่ม
            </Btn>
          </div>

          <p style={{ fontSize: 11, color: C.inkLt, marginTop: 8 }}>
            {hasFileSource
              ? "Step 4 กำลังดึงตัวอย่างจากไฟล์ที่แยกใน Step 3 แล้วสร้าง ver 1, ver 2, ver 3 จากรูปตัวเขียนจริง"
              : "ยังไม่มีข้อมูลจากไฟล์ ระบบจะใช้ตัวอักษรมาตรฐานและ DNA จำลองก่อน"}
          </p>

          {hasFileSource && activeFileGlyph && (
            <p style={{ fontSize: 11, color: C.inkLt, marginTop: 4 }}>
              ตัวที่เลือก: ช่อง {activeFileGlyph.index} • {activeFileGlyph.ch} • สถานะ {activeFileGlyph.status.toUpperCase()}
            </p>
          )}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
          {variants.map(v => (
            <div
              key={v.version}
              style={{
                background: C.bgCard,
                border: `1px solid ${C.border}`,
                borderRadius: 14,
                padding: "12px 12px 14px",
              }}
            >
              <p
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: C.inkLt,
                  marginBottom: 8,
                }}
              >
                ver {v.version}
              </p>
              <div
                style={{
                  height: 150,
                  borderRadius: 10,
                  border: `1px dashed ${C.borderMd}`,
                  background: "#fff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  position: "relative",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    left: "7%",
                    right: "7%",
                    top: "58%",
                    borderTop: `1px dashed ${C.borderMd}`,
                  }}
                />

                {basePreview ? (
                  <img
                    src={basePreview}
                    alt={`File glyph ${baseChar} ver ${v.version}`}
                    style={{
                      width: "78%",
                      height: "78%",
                      objectFit: "contain",
                      transform: `translate(${v.shiftX}px, ${v.shiftY}px) rotate(${v.rotate}deg) skewX(${v.skewX}deg) scale(${v.scaleX}, ${v.scaleY})`,
                      transformOrigin: "center",
                      filter: "contrast(1.08) saturate(0.9)",
                    }}
                  />
                ) : (
                  <span
                    style={{
                      display: "inline-block",
                      fontSize: 108,
                      lineHeight: 1,
                      color: C.ink,
                      fontWeight: v.weight,
                      fontFamily: "'TH Sarabun New', 'Noto Sans Thai', 'Tahoma', sans-serif",
                      transform: `translate(${v.shiftX}px, ${v.shiftY}px) rotate(${v.rotate}deg) skewX(${v.skewX}deg) scale(${v.scaleX}, ${v.scaleY})`,
                      transformOrigin: "center",
                      textShadow: "0 0 0.3px rgba(44,36,22,0.45)",
                    }}
                  >
                    {baseChar}
                  </span>
                )}
              </div>
              <p style={{ marginTop: 8, fontSize: 10, color: C.inkLt, lineHeight: 1.6 }}>
                rotate {v.rotate.toFixed(2)}° • skew {v.skewX.toFixed(2)}° • scale {v.scaleX.toFixed(3)}/{v.scaleY.toFixed(3)}
              </p>
            </div>
          ))}
        </div>
      </div>

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
          { l: "Glyph variants", v: "3", u: "versions", s: "ver 1 / ver 2 / ver 3" },
          { l: "Source", v: hasFileSource ? "FILE" : "MOCK", u: "", s: hasFileSource ? "from Step 3" : "no file-derived glyph" },
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
