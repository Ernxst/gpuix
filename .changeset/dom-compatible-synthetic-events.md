---
'@gpuix/native': patch
'@gpuix/react': minor
---

Wrap native interaction payloads in a DOM-compatible `GpuixSyntheticEvent`.

Handlers keep the native fields they already consumed and gain `nativeEvent`,
capture/bubble propagation, stable `target` and phase-specific `currentTarget`
host handles, flattened modifiers, a primary-button default,
`preventDefault()`, and `stopPropagation()`. Preventing an Enter or Space key
event also suppresses its keyboard-generated click.

Fixes #11
