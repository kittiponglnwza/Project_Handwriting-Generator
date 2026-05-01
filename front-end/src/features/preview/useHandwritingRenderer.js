// useHandwritingRenderer.js — builds glyph map for SVG text rendering
import { useMemo } from 'react'

/**
 * Builds a Map<char, VersionedGlyph[]> from versionedGlyphs array.
 * Used by PaperCanvas to look up per-character SVG paths.
 */
export function useHandwritingRenderer({ versionedGlyphs }) {
  const glyphMap = useMemo(() => {
    const map = new Map()
    for (const g of versionedGlyphs) {
      if (!map.has(g.ch)) map.set(g.ch, [])
      map.get(g.ch).push(g)
    }
    return map
  }, [versionedGlyphs])

  return { glyphMap }
}