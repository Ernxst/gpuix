---
"@gpuix/native": minor
"@gpuix/react": minor
---

`toMatchScreenshot` now finishes native style transitions and `motion`
animations before capturing by default. Pass `animations: "allow"` when a
suite intentionally asserts an in-flight frame. Settling advances the test
clock and warns when an animation remains active after the 10-second budget.
