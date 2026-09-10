---
'@gpuix/native': minor
'@gpuix/react': minor
---

Add a root `clipboard` export from `@gpuix/react` — `writeText`/`readText`,
shaped like the browser's `navigator.clipboard` (text only). `import
"@gpuix/react/globals"` now also installs `navigator.clipboard` when that
property is absent, so browser code that reaches for it keeps working under
GPUIX. `GpuixRenderer` gains `writeClipboardText`/`readClipboardText` on
macOS, Windows, and Linux; the wasm build rejects, since its consumer already
has the real `navigator.clipboard`.

Refs #464
