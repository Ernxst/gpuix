---
'@gpuix/react': minor
---

Add an opt-in `@gpuix/react/globals` entry. Importing it installs exactly
`requestAnimationFrame`, `cancelAnimationFrame`, `window`, and `scrollTo` on
`globalThis`, each only when absent, so browser code that reaches for these
DOM globals (TanStack Router's `window?.origin` and `scrollTo()`, for
example) keeps working under GPUIX. The root `@gpuix/react` entry installs no
global.
