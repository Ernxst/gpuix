---
"@gpuix/react": minor
---

Add `toMatchScreenshot(name?, options?)` to `@gpuix/react/testing/matchers`,
mirroring vitest browser mode's golden matcher so a shape assertion reads the
same in a browser suite and a desktop one:

```ts
await expect(screen).toMatchScreenshot('panel')
await expect(screen.getByTestId('tile')).toMatchScreenshot()
```

The receiver is a `render()` result, a `TestRenderer` — the whole offscreen
window — or a `TestElement`, clipped to the device-pixel box it painted. The
decisions are vitest's, wording included: a missing golden is written and the
assertion fails ("a new one was created. Review it before running tests
again."), `vitest --update` overwrites and passes, a size change fails without
comparing pixels rather than skipping, and a pixel mismatch writes the capture
and a diff image and names them. Goldens default to
`${root}/${testFileDirectory}/__screenshots__/${testFileName}/${arg}${ext}`, and
`resolveScreenshotPath` moves them. `comparatorOptions` — `tolerance`,
`differingPixelBudget`, `maxChannelDelta` — tune the native comparison, exact by
default.

Mismatch artifacts land in `__diff_output__/` beside the golden rather than the
runner's attachments directory, which is not reachable from a matcher. There is
no capture-stability retry loop, and no comparator selection: those describe a
browser page.

Fixes #288
