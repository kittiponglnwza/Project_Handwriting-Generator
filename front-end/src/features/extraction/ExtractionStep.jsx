/**
 * Step3 – Preview / Adjust / Validate
 *
 * ARCHITECTURE ROLE: Pure consumer + glyph extractor.
 *
 * Props:
 *   parsedFile        – from appState.parsedFile (set by Step 2)
 *   onGlyphsUpdate(glyphs[]) – called whenever extracted glyphs change
 *   pipelineMachine   – PipelineStateMachine instance from usePipeline()
 */
import { useEffect, useMemo, useRef, useState, useCallback } from "react"
import Btn from "../../shared/components/Btn"
import InfoBox from "../../shared/components/InfoBox"
import C from "../../styles/colors"
import { buildAutoPageProfiles } from "../../engine/vision/calibration.js"
import { getGridGeometry, traceAllGlyphs } from "../../engine/vision/glyphPipeline.js"
import { ZERO_CALIBRATION } from "../../engine/vision/constants.js"
import { Adjuster, GridDebugOverlay, PageDebugOverlay } from "./ExtractionPanels.jsx"
import DebugOverlay from "../../shared/debug/DebugOverlay.jsx"
import { PipelineStateMachine, PipelineStates } from "../../engine/pipeline/PipelineStateMachine.js"
import { Telemetry } from "../../engine/pipeline/Telemetry.js"
import { PerformanceGovernor } from "../../engine/pipeline/PerformanceGovernor.js"
import { VisionEngine } from "../../engine/vision/VisionEngine.js"
import QADashboard from "../../shared/debug/QADashboard.jsx"

// ─── Tabs ──────────────────────────────────────────────────────────────────────
const TABS = [
  { id: "glyphs", label: "Glyphs" },
  { id: "pages", label: "Page Debug" },
  { id: "qa", label: "QA" },
  { id: "telemetry", label: "Telemetry" },
]

// ─── Main Component ────────────────────────────────────────────────────────────
export default function ExtractionStep({ parsedFile, onGlyphsUpdate, pipelineMachine }) {
  const [tab, setTab] = useState("glyphs")
  const [glyphs, setGlyphs] = useState([])
  const [qaReport, setQaReport] = useState(null)
  const [telemetryData, setTelemetryData] = useState({})
  const [status, setStatus] = useState("idle") // idle | running | done | error
  const [errorMsg, setErrorMsg] = useState("")
  const [progress, setProgress] = useState(0)
  const [calibration, setCalibration] = useState(ZERO_CALIBRATION)
  const [showDebug, setShowDebug] = useState(false)

  const visionEngineRef = useRef(null)
  const abortRef = useRef(false)

  // ── Auto-calibration from pages ──────────────────────────────────────────────
  const autoProfiles = useMemo(() => {
    if (!parsedFile?.pages?.length) return []
    return buildAutoPageProfiles(parsedFile.pages, parsedFile.characters ?? [])
  }, [parsedFile])

  // ── Run extraction ───────────────────────────────────────────────────────────
  const runExtraction = useCallback(async () => {
    if (!parsedFile?.pages?.length || !parsedFile?.characters?.length) return

    abortRef.current = false
    setStatus("running")
    setProgress(0)
    setErrorMsg("")
    setGlyphs([])

    pipelineMachine?.transition(PipelineStates.CALIBRATING)

    try {
      if (!visionEngineRef.current) {
        visionEngineRef.current = new VisionEngine()
      }
      const engine = visionEngineRef.current

      const pages = parsedFile.pages
      const chars = parsedFile.characters

      pipelineMachine?.transition(PipelineStates.EXTRACTING)
      setProgress(10)

      // VisionEngine.processPages() handles calibration → extract → crop → normalize → score internally
      const result = await engine.processPages(pages, chars, calibration)

      setProgress(70)
      pipelineMachine?.transition(PipelineStates.TRACING)

      // Trace SVG paths (potrace) — needed for Step 4 font compilation
      const rawGlyphs = result?.glyphs ?? []
      const traced = rawGlyphs.length > 0 ? await traceAllGlyphs(rawGlyphs) : rawGlyphs
      const finalGlyphs = traced?.length ? traced : rawGlyphs

      setProgress(90)
      pipelineMachine?.transition(PipelineStates.COMPOSING)

      const qaRep = result?.qaReport ?? buildQaReport(finalGlyphs)

      setQaReport(qaRep)

      setGlyphs(finalGlyphs)
      console.log("sample glyph:", JSON.stringify({
        ch: finalGlyphs[0]?.ch,
        viewBox: finalGlyphs[0]?.viewBox,
        svgPath: finalGlyphs[0]?.svgPath?.slice(0, 80)
      }))
      
      onGlyphsUpdate(finalGlyphs)
      setProgress(100)
      setStatus("done")

      pipelineMachine?.transition(PipelineStates.DONE, { glyphCount: finalGlyphs.length })
      setTelemetryData(Telemetry.getSummary?.() ?? {})
    } catch (err) {
      console.error("[ExtractionStep] extraction failed:", err)
      setErrorMsg(err.message ?? "Unknown error")
      setStatus("error")
      pipelineMachine?.transition(PipelineStates.ERROR, { error: err.message })
    }
  }, [parsedFile, calibration, onGlyphsUpdate, pipelineMachine])

  // Auto-run when parsedFile arrives
  useEffect(() => {
    if (parsedFile?.status === "parsed" && parsedFile.characters?.length > 0) {
      runExtraction()
    }
    return () => { abortRef.current = true }
  }, [parsedFile]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Calibration handlers ─────────────────────────────────────────────────────
  const handleCalChange = (key, value) =>
    setCalibration(prev => ({ ...prev, [key]: value }))

  // ── Guard: no file ───────────────────────────────────────────────────────────
  if (!parsedFile) {
    return (
      <div className="fade-up">
        <InfoBox color="neutral">
          Upload a PDF in Step 2 first, then come back here to extract glyphs.
        </InfoBox>
      </div>
    )
  }

  const chars = parsedFile.characters ?? []

  return (
    <div className="fade-up">

      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 600, color: C.ink, margin: 0 }}>
            Glyph Extraction
          </h2>
          <p style={{ fontSize: 12, color: C.inkLt, marginTop: 4 }}>
            {chars.length} characters · {parsedFile.pages?.length ?? 0} pages
            {status === "done" && ` · ${glyphs.length} glyphs extracted`}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Btn
            variant="ghost"
            size="sm"
            onClick={() => setShowDebug(v => !v)}
          >
            {showDebug ? "Hide debug" : "Debug"}
          </Btn>
          <Btn
            variant="primary"
            size="sm"
            onClick={runExtraction}
            disabled={status === "running"}
          >
            {status === "running" ? "Extracting…" : "Re-extract"}
          </Btn>
        </div>
      </div>

      {/* ── Progress ── */}
      {status === "running" && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <span style={{ fontSize: 12, color: C.inkMd }}>Extracting glyphs…</span>
            <span style={{ fontSize: 12, color: C.inkLt }}>{progress}%</span>
          </div>
          <div style={{ height: 6, background: C.border, borderRadius: 3, overflow: "hidden" }}>
            <div style={{
              height: "100%",
              width: `${progress}%`,
              background: C.ink,
              borderRadius: 3,
              transition: "width 0.3s ease",
            }} />
          </div>
        </div>
      )}

      {/* ── Error ── */}
      {status === "error" && (
        <InfoBox color="amber">
          Extraction error: {errorMsg}. Check the console for details.
        </InfoBox>
      )}

      {/* ── Calibration sliders ── */}
      {showDebug && (
        <div style={{
          background: C.bgCard, border: `1px solid ${C.border}`,
          borderRadius: 12, padding: 16, marginBottom: 20,
        }}>
          <p style={{ fontSize: 13, fontWeight: 500, color: C.ink, marginBottom: 14 }}>
            Manual Calibration
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <Adjuster label="Offset X" value={calibration.offsetX} min={-60} max={60} step={1} onChange={v => handleCalChange("offsetX", v)} />
            <Adjuster label="Offset Y" value={calibration.offsetY} min={-60} max={60} step={1} onChange={v => handleCalChange("offsetY", v)} />
            <Adjuster label="Cell ±" value={calibration.cellAdjust} min={-40} max={40} step={1} onChange={v => handleCalChange("cellAdjust", v)} />
            <Adjuster label="Gap ±" value={calibration.gapAdjust} min={-20} max={20} step={1} onChange={v => handleCalChange("gapAdjust", v)} />
          </div>
          <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
            <Btn variant="ghost" size="sm" onClick={() => setCalibration(ZERO_CALIBRATION)}>Reset</Btn>
            <Btn variant="primary" size="sm" onClick={runExtraction} disabled={status === "running"}>Apply & Re-extract</Btn>
          </div>
        </div>
      )}

      {/* ── Tabs ── */}
      <div style={{ display: "flex", gap: 4, marginBottom: 16, borderBottom: `1px solid ${C.border}`, paddingBottom: 0 }}>
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: "8px 16px",
              fontSize: 12,
              fontWeight: tab === t.id ? 500 : 400,
              color: tab === t.id ? C.ink : C.inkLt,
              background: "transparent",
              border: "none",
              borderBottom: tab === t.id ? `2px solid ${C.ink}` : "2px solid transparent",
              cursor: "pointer",
              marginBottom: -1,
            }}
          >
            {t.label}
            {t.id === "glyphs" && glyphs.length > 0 && (
              <span style={{
                marginLeft: 6, fontSize: 10, fontWeight: 600,
                background: C.bgMuted, color: C.inkMd,
                padding: "1px 6px", borderRadius: 10,
              }}>
                {glyphs.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Tab content ── */}

      {tab === "glyphs" && (
        <div>
          {glyphs.length === 0 && status !== "running" && (
            <p style={{ fontSize: 13, color: C.inkLt, textAlign: "center", padding: 40 }}>
              {status === "idle" ? "Waiting to start…" : "No glyphs extracted yet."}
            </p>
          )}
          <GridDebugOverlay glyphs={glyphs} />
        </div>
      )}

      {tab === "pages" && (
        <PageDebugOverlay
          pages={parsedFile.pages ?? []}
          calibration={calibration}
          chars={chars}
          getGridGeometry={getGridGeometry}
        />
      )}

      {tab === "qa" && (
        <QADashboard
          glyphs={glyphs}
          qaReport={qaReport}
          onGlyphSelect={(g) => console.log("[QA] selected:", g)}
          onRetryExtraction={runExtraction}
        />
      )}

      {tab === "telemetry" && (
        <div style={{ position: "relative", minHeight: 200 }}>
          <DebugOverlay metrics={telemetryData} />
        </div>
      )}

    </div>
  )
}

// ─── QA Report builder ─────────────────────────────────────────────────────────
function buildQaReport(glyphs) {
  const counts = { excellent: 0, good: 0, acceptable: 0, poor: 0, critical: 0, overflow: 0, missing: 0, error: 0 }
  let totalConfidence = 0
  const issues = []

  for (const g of glyphs) {
    const st = g.confidence?.status ?? g.status ?? "good"
    if (counts[st] !== undefined) counts[st]++
    else counts.error++

    const conf = g.confidence?.overall ?? 0.8
    totalConfidence += conf

    if (conf < 0.6 || st === "poor" || st === "critical" || st === "error") {
      issues.push({
        id: g.id,
        char: g.ch,
        issue: st,
        confidence: conf,
        feedback: g.confidence?.feedback ?? [],
      })
    }
  }

  const total = glyphs.length
  const averageConfidence = total > 0 ? totalConfidence / total : 0
  const goodRate = total > 0 ? (counts.excellent + counts.good) / total : 0

  const recommendations = []
  if (counts.missing > 0) recommendations.push(`${counts.missing} cells appear empty — check scan quality or calibration.`)
  if (counts.overflow > 0) recommendations.push(`${counts.overflow} glyphs overflow their cell — try reducing Cell size.`)
  if (averageConfidence < 0.6) recommendations.push("Low average confidence — consider re-scanning at higher DPI.")

  return { ...counts, total, averageConfidence, goodRate, issues, recommendations }
}