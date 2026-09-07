---
'@gpuix/react': patch
---

Document how to ship a GPUIX React app on [hermes-node](https://github.com/tmikov/hermes-node) instead of Bun or Node.

The guide is at `website/src/guides/hermes.mdx` and is linked from the README. It covers the macOS rebuild (the published tarball strips `napi_*`), `bun build --format=cjs`, wrapping the two files in a `.app` with [cargo-packager](https://github.com/crabnebula-dev/cargo-packager), shrinking the `.node` with `napi --strip` / `strip -x` (**22 MB** down to **17 MB**), and the measured ship set: **12 MB** executable plus a **22 MB** native sidecar (**34 MB** `.app`).
