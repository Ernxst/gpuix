import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"

const packageRoot = fileURLToPath(new URL("../", import.meta.url))
const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url))
const requiredFiles = [
  ["packages/plugins/dist/bun.js", `${packageRoot}/dist/bun.js`],
  ["packages/plugins/dist/css.js", `${packageRoot}/dist/css.js`],
  ["packages/plugins/dist/preload.js", `${packageRoot}/dist/preload.js`],
  ["packages/plugins/dist/css-modules-types.d.ts", `${packageRoot}/dist/css-modules-types.d.ts`],
  ["packages/react/dist/testing.js", `${repositoryRoot}/packages/react/dist/testing.js`],
]
const missingFiles = requiredFiles.filter(([, file]) => !existsSync(file)).map(([name]) => name)

if (missingFiles.length > 0) {
  console.error(
    `[gpuix] Test entry points are missing (${missingFiles.join(", ")}). Run \`bun run build\` in packages/react and packages/plugins before running Bun tests.`,
  )
  process.exit(1)
}
