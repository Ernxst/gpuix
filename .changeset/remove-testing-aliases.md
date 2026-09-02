---
"@gpuix/react": major
---

BREAKING: remove the `nativeTestRendererError` re-export. Import
`nativeTestRendererLoadError` from `@gpuix/react/testing` instead; it is the
same binding under its only name.

BREAKING: remove the legacy `testId` locator prop. `data-testid` is the one
locator on every host element, so `resolveTestId()`, `TestElement`,
`StyleDiagnostic`, the automation tree nodes, and the element props all carry
`data-testid` alone, and strict style diagnostics name it in their subject
line. Rename `testId="x"` to `data-testid="x"`; a `testId` prop is now an
unknown prop and never reaches the renderer.

Fixes #255
