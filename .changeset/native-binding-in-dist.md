---
'@gpuix/native': minor
---

The native addon and its generated loader now ship in `dist/` inside the
package: `dist/gpuix-native.<platform>.node`, `dist/index.js` and
`dist/index.d.ts`. Importing `@gpuix/native` is unchanged. A script that copies
the addon by path, such as the macOS app-bundle recipe in the README, must read
it from `node_modules/@gpuix/native/dist/`.
