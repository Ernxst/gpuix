---
"@gpuix/native": patch
"@gpuix/react": patch
---

Run the GPU-backed test renderer against a deterministic virtual display, convert GPUI initialization panics into catchable native errors without leaking macOS window setup, keep display fault injection out of published bindings, and preserve native test-binding load diagnostics.

Fixes Ernxst/gpuix#2
