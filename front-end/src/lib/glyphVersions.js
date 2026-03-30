// ─── Canonical path deformation — shared by Step 4 UI and Step 5 preview ───────
// version 1 = original, 2 = drooping tail, 3 = wavy/imperfect
export function deformPath(svgPath, version) {
  if (!svgPath || version === 1) return svgPath

  return svgPath.replace(
    /([ML])\s+([-]?[\d.]+)\s+([-]?[\d.]+)/g,
    (match, cmd, xStr, yStr) => {
      try {
        let x = parseFloat(xStr)
        let y = parseFloat(yStr)
        if (isNaN(x) || isNaN(y)) return match

        if (version === 2) {
          const drop = (y / 100) * 5
          y += drop
          x -= (y / 100) * 1.5
        } else if (version === 3) {
          x += Math.sin(y * 0.15) * 1.5
          y += Math.cos(x * 0.15) * 1.5
        }
        return `${cmd} ${x.toFixed(1)} ${y.toFixed(1)}`
      } catch {
        return match
      }
    }
  )
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
