import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"

const packageRoot = fileURLToPath(new URL("../", import.meta.url))
const requiredFiles = [
  "dist/index.js",
  "dist/testing.js",
  "dist/testing-vitest.js",
  "dist/testing-expect.js",
  "dist/globals.js",
]

export default function testPreflight() {
  const missingFiles = requiredFiles.filter((file) => !existsSync(`${packageRoot}/${file}`))

  if (missingFiles.length > 0) {
    console.error(
      `[gpuix] React test entry points are missing (${missingFiles.join(", ")}). Run \`bun run build\` in packages/react before running Vitest.`,
    )
    process.exit(1)
  }
}
