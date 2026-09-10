---
'@gpuix/react': minor
---

`@gpuix/react/testing/vitest` now registers the `expect.extend(gpuixMatchers)`
matcher pack and its `declare module "vitest"` augmentation as a side effect
of the import, so wiring it up — as a `setupFiles` entry or per file — is
enough to get `expect(el).toBeVisible()` and the rest of the pack. The manual
`expect.extend` form documented on `@gpuix/react/testing/matchers` still works
for other runners.

`SharedStyle` is exported from `@gpuix/react`: the mapped type over the keys
React `CSSProperties` and `StyleDesc` both accept, for a style helper that
compiles against both renderers without hand-rolling the mapped type per
consumer.

Fixes #458
