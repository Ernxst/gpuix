---
"@gpuix/native": patch
---

Clip `overflow: "hidden"` content to uniform and per-corner border radii across native GPU backends while preserving the rectangular fast path for zero-radius masks.

Upstream research: this uses the scene clip-node design from [zed-industries/zed#60829](https://github.com/zed-industries/zed/pull/60829), avoiding the radius-merging approach reverted by [zed-industries/zed#37480](https://github.com/zed-industries/zed/pull/37480) because nested rounded clips cannot be folded into one radius.

Fixes #51
