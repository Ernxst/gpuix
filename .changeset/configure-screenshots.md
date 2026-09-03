---
"@gpuix/react": minor
---

`configureScreenshots({ resolveScreenshotPath })`, exported from
`@gpuix/react/testing/matchers`, sets a suite-wide default golden path for
`toMatchScreenshot` from a vitest setup file, so a suite aligning desktop
goldens with a browser project's layout no longer repeats the same lambda at
every call site:

```ts
// vitest setup file
import { configureScreenshots } from '@gpuix/react/testing/matchers'

configureScreenshots({
  resolveScreenshotPath: ({ root, testFileDirectory, testFileName, arg, ext, platform }) =>
    path.join(root, testFileDirectory, '__goldens__', testFileName, `${arg}-${platform}${ext}`),
})
```

Precedence is vitest browser mode's: a per-call `resolveScreenshotPath` wins
over the configured default, which wins over the built-in
`__screenshots__/<test file>/<name>.png` path. Nothing changes for a suite
that never calls it. Each call replaces the previous defaults wholesale, so
`configureScreenshots({})` restores the built-in behaviour.

It is a function call rather than vitest's `browser.expect.toMatchScreenshot`
config key because that config carries functions, which vitest only delivers
inside the browser runtime — a node worker, where this renderer lives, never
receives them.

Fixes #299
