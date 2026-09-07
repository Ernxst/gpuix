import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url))
const reactRoot = join(repositoryRoot, 'packages/react')
const fixture = fileURLToPath(new URL('./layout-cache.probe.test.tsx', import.meta.url))

export default {
  root: reactRoot,
  test: {
    include: [fixture],
    isolate: false,
    testTimeout: 300_000,
  },
}
