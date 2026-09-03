---
"@gpuix/react": minor
---

Declare the reconciler versions GPUIX actually tests. The `react-reconciler`
peer moves to `^0.33.0` and `scheduler` to `^0.27.0` — the pair React 19.2 and
`react-dom` 19.2 resolve, and the pair the controlled-input restore's
`flushSync` behaviour is verified against. The old `^0.31.0` / `^0.25.0` ranges
claimed support for lines the workspace no longer installs, and left consumers
on React 19.2 with a `scheduler` conflict against `react-dom`.

**Breaking:** the `react` peer narrows from `^18.0.0 || ^19.0.0` to `^19.2.0`.
React 18 leaves the published contract because `react-reconciler` 0.33 declares
`react ^19.2.0` itself — a React 18 resolution was never one GPUIX could honour,
only one a consumer could silence.

Fixes #290
