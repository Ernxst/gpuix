// Vite config for the `@gpuix/vite` half of the hot-reload benchmark. Run
// with `bun run --bun vite --config examples/bench/vite.config.ts` from
// `examples/bench`, or let `scripts/app-bench.ts` drive it.
//
// `@gpuix/vite` is imported from the built package directly, not as an
// `examples` devDependency: the `examples` workspace package doesn't declare
// it, and adding it would touch the frozen lockfile for a benchmark-only
// config. Run `bun run build:vite` first so `packages/vite/dist` exists.
import { defineConfig } from 'vite'
import { gpuix } from '../../packages/vite/dist/index.js'

export default defineConfig({
  appType: 'custom',
  plugins: [gpuix({ entry: 'hot-reload-fixture.tsx' })],
})
