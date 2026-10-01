import { defineConfig } from "tsdown"

export default defineConfig({
  entry: ["src/bun.ts", "src/css.ts", "src/preload.ts"],
  platform: "node",
  // `exports` in package.json names `.js` files; node's default here is `.mjs`.
  fixedExtension: false,
  unbundle: true,
  failOnWarn: true,
  sourcemap: true,
  dts: { sourcemap: true },
  deps: { neverBundle: true },
})
