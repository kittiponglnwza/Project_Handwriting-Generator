function buttonTone(tone) {
  if (tone === "brand") {
    return "border-transparent bg-slate-900 text-white hover:bg-slate-700 disabled:bg-slate-300"
  }
  if (tone === "ghost") {
    return "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50 disabled:text-slate-300"
  }
  return "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50 disabled:bg-slate-100 disabled:text-slate-300"
}

function ToolbarButton({ children, onClick, disabled = false, tone = "default", title }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`inline-flex h-9 items-center justify-center rounded-xl border px-3 text-xs font-semibold transition ${buttonTone(tone)}`}
    >
      {children}
    </button>
  )
}

function FontStatusTag({ fontState }) {
  const tone =
    fontState.status === "ready"
      ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
      : fontState.status === "loading"
      ? "bg-amber-50 text-amber-700 ring-amber-200"
      : "bg-rose-50 text-rose-700 ring-rose-200"

  return (
    <span className={`inline-flex items-center rounded-full px-3 py-1 text-[11px] font-semibold ring-1 ring-inset ${tone}`}>
      {fontState.message}
    </span>
  )
}

export default function Step5Toolbar({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onReset,
  onExportPng,
  onExportTransparentPng,
  onExportPdf,
  onDownloadFont,
  onSaveDesignJson,
  onToggleFullscreen,
  fontState,
}) {
  return (
    <header className="step5-card rounded-2xl border border-white/60 bg-white/80 shadow-sm backdrop-blur">
      <div className="flex flex-wrap items-center gap-2 p-3 md:p-4">
        <div className="flex flex-wrap items-center gap-2">
          <ToolbarButton onClick={onUndo} disabled={!canUndo} title="Undo (Ctrl+Z)">
            Undo
          </ToolbarButton>
          <ToolbarButton onClick={onRedo} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)">
            Redo
          </ToolbarButton>
          <ToolbarButton onClick={onReset} tone="ghost" title="Reset all controls to default">
            Reset
          </ToolbarButton>
        </div>

        <div className="mx-1 h-6 w-px bg-slate-200" />

        <div className="flex flex-wrap items-center gap-2">
          <ToolbarButton onClick={onExportPng} tone="brand">
            Download PNG
          </ToolbarButton>
          <ToolbarButton onClick={onExportTransparentPng} tone="ghost">
            Transparent PNG
          </ToolbarButton>
          <ToolbarButton onClick={onExportPdf} tone="ghost">
            Download PDF
          </ToolbarButton>
          <ToolbarButton onClick={onDownloadFont} tone="ghost">
            Download Font
          </ToolbarButton>
          <ToolbarButton onClick={onSaveDesignJson} tone="ghost">
            Save Design JSON
          </ToolbarButton>
          <ToolbarButton onClick={onToggleFullscreen} tone="ghost">
            Fullscreen
          </ToolbarButton>
        </div>

        <div className="ml-auto">
          <FontStatusTag fontState={fontState} />
        </div>
      </div>
    </header>
  )
}
