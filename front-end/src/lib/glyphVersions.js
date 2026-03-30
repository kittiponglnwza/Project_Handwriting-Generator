// ─── Canonical path deformation — shared by Step 4 UI and Step 5 preview ───────
// version 1 = original, 2 = drooping tail, 3 = wavy/imperfect
export function deformPath(svgPath, version) {
  if (!svgPath) return svgPath

  // เชื่อม “ช่องว่างเล็กๆ” ระหว่าง sub-path ที่ใกล้กันเกินไป
  // ลดอาการเส้นขาดที่เกิดจากการ trace แยกเป็นหลาย M..L กัน
  function bridgeNearbySegments(path, eps = 0.9) {
    if (!path) return path

    // traceToSVGPath สร้างเป็นแพทเทิร์น: "M x y L x y" ซ้ำๆ
    // เรา parse เป็น segment: {start,end} แล้วเชื่อมถ้าปลายเดิมใกล้กับต้นใหม่
    const segRe =
      /M\s+([-]?\d*\.?\d+)\s+([-]?\d*\.?\d+)\s+L\s+([-]?\d*\.?\d+)\s+([-]?\d*\.?\d+)(?=\s+M|$)/g

    const segments = []
    let m
    while ((m = segRe.exec(path)) !== null) {
      segments.push({
        sx: parseFloat(m[1]),
        sy: parseFloat(m[2]),
        ex: parseFloat(m[3]),
        ey: parseFloat(m[4]),
      })
    }

    if (segments.length <= 1) return path

    let out = ""
    let prevEnd = null
    for (let i = 0; i < segments.length; i += 1) {
      const s = segments[i]
      const startIsClose =
        prevEnd &&
        (s.sx - prevEnd.ex) ** 2 + (s.sy - prevEnd.ey) ** 2 <= eps ** 2

      if (i === 0) {
        out += `M ${s.sx} ${s.sy} L ${s.ex} ${s.ey}`
      } else if (startIsClose) {
        // จากจุดปลายเดิมต่อเข้าไปที่ start ของ segment ถัดไป
        out += ` L ${s.sx} ${s.sy} L ${s.ex} ${s.ey}`
      } else {
        out += ` M ${s.sx} ${s.sy} L ${s.ex} ${s.ey}`
      }
      prevEnd = { ex: s.ex, ey: s.ey }
    }

    return out.replace(/\s+/g, " ").trim()
  }

  const clamp = (v, min, max) => Math.min(max, Math.max(min, v))

  // เพิ่มความแรงการดัด และเพิ่มความละเอียดตัวเลข
  // เพื่อให้เส้น “ต่อเนื่องขึ้น” (ลดอาการเส้นขาด/ถูกตัดด้วยกรอบ viewBox)
  const DECIMALS = 2

  // viewBox ของระบบถูกสร้างไว้ที่ 0..100
  const MIN = -0.5
  const MAX = 100.5

  if (version === 1) {
    return bridgeNearbySegments(svgPath, 0.85)
  }

  const deformed = svgPath.replace(/([ML])\s+([-]?[\d.]+)\s+([-]?[\d.]+)/g, (match, cmd, xStr, yStr) => {
    try {
      let x = parseFloat(xStr)
      let y = parseFloat(yStr)
      if (isNaN(x) || isNaN(y)) return match

      if (version === 2) {
        // droop มากขึ้น (หางตกชัดขึ้น)
        const t = y / 100
        const drop = t * 8 // เดิม ~5
        y += drop
        x -= t * 2.4 // เดิม ~1.5
      } else if (version === 3) {
        // wavy มากขึ้น (แกว่ง/ดัดเข้มขึ้น)
        const freq = 0.18 // เดิม 0.15
        const amp = 2.4 // เดิม 1.5
        x += Math.sin(y * freq) * amp
        y += Math.cos(x * freq) * amp
      }

      // กันพิกัดหลุดจากกรอบ เพื่อไม่ให้เกิดการ “ถูกตัด” เป็นจุดขาด
      x = clamp(x, MIN, MAX)
      y = clamp(y, MIN, MAX)

      return `${cmd} ${x.toFixed(DECIMALS)} ${y.toFixed(DECIMALS)}`
    } catch {
      return match
    }
  })

  return bridgeNearbySegments(deformed, version === 2 ? 1.05 : 1.15)
}

/** Each source glyph → 3 entries (version 1, 2, 3) with deformed svgPath. */
export function buildVersionedGlyphs(extractedGlyphs) {
  const result = []
  for (const g of extractedGlyphs) {
    const hasSvg =
      typeof g.svgPath === "string" &&
      g.svgPath.trim() !== "" &&
      g.svgPath.trim() !== "M 0 0"

    for (const ver of [1, 2, 3]) {
      result.push({
        ...g,
        id: `${g.id}-v${ver}`,
        version: ver,
        svgPath: hasSvg ? deformPath(g.svgPath, ver) : g.svgPath || "",
        preview: g.preview || "",
        previewInk: g.previewInk || "",
        verLabel:
          ver === 1 ? "Ver 1: ต้นฉบับ" : ver === 2 ? "Ver 2: หางตก" : "Ver 3: เส้นแกว่ง",
      })
    }
  }
  return result
}
