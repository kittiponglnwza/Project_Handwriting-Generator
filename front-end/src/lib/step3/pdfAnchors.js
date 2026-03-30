import { HGMETA_RE, TEMPLATE_CODE_RE, TEMPLATE_INDEX_RE } from "./constants.js"

export async function collectTextAnchors(page, viewport, maxIndex) {
  const textContent = await page.getTextContent()
  const items = textContent.items || []
  const rawAnchors = []

  for (let i = 0; i < items.length; i += 1) {
    const item = items[i]
    const raw = String(item?.str || "").trim()
    if (!raw) continue

    const codeMatch = raw.match(TEMPLATE_CODE_RE)
    const indexMatch = raw.match(TEMPLATE_INDEX_RE)
    const prevRaw = String(items[i - 1]?.str || "").trim()
    const hasCodePrefix = /^HG$/i.test(prevRaw)
    let kind = null
    let index = 0

    if (codeMatch) {
      kind = "code"
      index = Number(codeMatch[1])
    } else if (indexMatch && hasCodePrefix) {
      kind = "code"
      index = Number(indexMatch[1])
    } else if (indexMatch) {
      kind = "index"
      index = Number(indexMatch[1])
    } else {
      continue
    }

    if (!Number.isFinite(index) || index < 1 || index > maxIndex) {
      continue
    }

    const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0] = item.transform || []
    const x = Number(e)
    const y = viewport.height - Number(f)
    const width = Number(item.width || Math.hypot(a, b) * raw.length || 0)
    const height = Number(item.height || Math.hypot(c, d) || 0)

    if (y < viewport.height * 0.14 || y > viewport.height * 0.97) continue
    if (height > viewport.height * 0.07) continue
    if (width > viewport.width * 0.16) continue

    rawAnchors.push({
      index,
      kind,
      x,
      y,
      width,
      height,
    })
  }

  const byIndex = new Map()
  for (const anchor of rawAnchors) {
    const prev = byIndex.get(anchor.index)
    if (!prev) {
      byIndex.set(anchor.index, anchor)
      continue
    }
    if (prev.kind !== "code" && anchor.kind === "code") {
      byIndex.set(anchor.index, anchor)
      continue
    }
    const prevDistance = Math.abs(prev.y - viewport.height * 0.55)
    const nextDistance = Math.abs(anchor.y - viewport.height * 0.55)
    if (nextDistance < prevDistance) {
      byIndex.set(anchor.index, anchor)
    }
  }

  const anchors = [...byIndex.values()].sort((a, b) => a.index - b.index)
  const codeAnchorCount = anchors.filter(a => a.kind === "code").length
  const allIndices = anchors.map(a => a.index)
  const startIndex = allIndices.length > 0 ? Math.min(...allIndices) : null
  let contiguousCount = 0
  if (startIndex != null) {
    while (byIndex.has(startIndex + contiguousCount)) {
      contiguousCount += 1
    }
  }

  let pageMeta = null
  for (const item of items) {
    const raw = String(item?.str || "")
    const m = raw.match(HGMETA_RE)
    if (m) {
      pageMeta = {
        page: Number(m[1]),
        totalPages: Number(m[2]),
        cellFrom: Number(m[3]),
        cellTo: Number(m[4]),
        cellCount: Number(m[5]),
        totalGlyphs: Number(m[6]),
      }
      break
    }
  }

  return {
    anchors,
    byIndex,
    startIndex,
    contiguousCount,
    hasCodeAnchors: codeAnchorCount > 0,
    codeAnchorCount,
    pageMeta,
  }
}
