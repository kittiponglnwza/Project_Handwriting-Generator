# Refactor Changelog — April 2026

## Dead Code Removed
- `lib/fontEngine/` — alternative engine ที่ไม่ได้ใช้ (18 files)
- `lib/handwritingEngine/` — alternative renderer (6 files)
- `lib/step5/` — token-based rendering ที่ถูก replace ด้วย browser font shaping (8 files)
- `steps/step5/Step5Preview.jsx` — orphaned component (ไม่ถูก import ที่ไหน)
- `steps/step5/Step5Toolbar.jsx` — orphaned component

## Bug Fixes

### [CRITICAL] Worker path — Vite production build
**File:** `lib/step3/tracingWorkerManager.js`  
`new Worker('./workers/...')` → `new Worker(new URL('../../workers/tracingWorker.js', import.meta.url), { type: 'module' })`  
เหตุผล: Vite ไม่ bundle string literal worker path ใน production build → worker 404

### [CRITICAL] Step4 mount before glyphs ready
**File:** `App.jsx`  
เพิ่ม guard `(appState.glyphResult?.glyphs?.length ?? 0) > 0` ก่อน mount Step4  
เหตุผล: Step4 เคย mount ตั้งแต่ render ครั้งแรก ทำให้ auto-build trigger ก่อนมี glyphs

### [WARN] PerformanceGovernor concurrent batch loss
**File:** `engine/PerformanceGovernor.js`  
Rewrote `batchProcessor.add()` ด้วย AbortController + waiter queue pattern  
เหตุผล: concurrent call ขณะ processing อยู่จะ resolve ด้วย `[]` ทำให้ glyphs หาย  
เพิ่ม `cancel()` method สำหรับ Step3 re-trigger

### [WARN] exportPNG custom font not captured
**File:** `steps/Step5.jsx`  
แทนที่ XMLSerializer + SVG foreignObject ด้วย html2canvas (CDN ESM import)  
มี Canvas-text fallback ถ้า html2canvas โหลดไม่ได้  
เหตุผล: Chrome security sandbox block custom font ใน SVG foreignObject

### [WARN] Step3 engine re-created on every effect
**File:** `steps/Step3.jsx`  
เพิ่ม singleton guard `if (stateMachineRef.current) return` ใน init useEffect  
เพิ่ม cleanup reset refs เมื่อ unmount จริง  
เหตุผล: HMR / React StrictMode สร้าง instance ใหม่โดยไม่จำเป็น

## Code Quality
- `core/rendering/ThaiEngine.jsx` — แปลง CRLF → LF
- เพิ่ม `.editorconfig` + `.gitattributes` เพื่อ enforce LF ทั้ง repo
