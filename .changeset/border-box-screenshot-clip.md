---
"@gpuix/react": patch
---

`toMatchScreenshot` on a `TestElement` now clips the capture to the **border
box**, matching Playwright and vitest browser mode. Under the old
content-box-shaped bounds, a bordered element's golden cropped its border out
entirely — a border-colour regression was exactly the kind of change the
golden could never catch.

Migration: a downstream golden captured from a **bordered or padded** element
under the old clip is smaller than the border box and will fail with a
dimension mismatch; recapture it with `vitest --update`. Goldens of
unbordered, unpadded elements are unchanged.

Fixes #298
