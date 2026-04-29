export const FEATURES = {
  enableWoff2Export: false,
  enableGlyphEditor: false,
  enableKerning: true,
  enableThaiGSUB: true,
}

export const PIPELINE_CONFIG = {
  extractionBatchSize: 24,
  traceBatchSize: 32,
  minTrustedIndexTargets: 3,
  confidenceThresholds: {
    good: 0.78,
    acceptable: 0.58,
    poor: 0.35,
  },
}

