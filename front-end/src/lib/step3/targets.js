import { MIN_TRUSTED_INDEX_TARGETS } from "./constants.js"

/** @param {unknown[]} pages */
export function buildTargetsFromPages(pages) {
  const codeIndices = new Set()
  const numericIndices = new Set()

  for (const page of pages) {
    for (const anchor of page.anchors || []) {
      if (!Number.isFinite(anchor.index) || anchor.index < 1) continue
      if (anchor.kind === "code") {
        codeIndices.add(anchor.index)
      } else {
        numericIndices.add(anchor.index)
      }
    }
  }

  const source = codeIndices.size > 0 ? codeIndices : numericIndices
  if (source.size === 0) return []

  let contiguousCount = 0
  while (source.has(contiguousCount + 1)) contiguousCount += 1

  if (codeIndices.size === 0 && contiguousCount < MIN_TRUSTED_INDEX_TARGETS) return []

  const rawCount = contiguousCount > 0 ? contiguousCount : source.size
  const count = Math.max(1, Math.min(1024, rawCount))
  return Array.from({ length: count }, (_, i) => String(i + 1))
}
