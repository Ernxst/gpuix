import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const nativeEntry = fileURLToPath(
  new URL("../packages/native/index.js", import.meta.url)
)
const env = {
  ...process.env,
  GPUI_TEST_DISABLE_DISPLAY_DISCOVERY: "1",
}

function runChild(name: string, source: string) {
  const result = spawnSync(process.execPath, ["-e", source], {
    encoding: "utf8",
    env,
    timeout: 15_000,
  })

  if (result.status !== 0) {
    throw new Error(
      `${name} failed with status ${result.status} and signal ${result.signal}\n${
        result.error?.stack ?? ""
      }\n${result.stdout}${result.stderr}`
    )
  }

  process.stdout.write(result.stdout)
  process.stderr.write(result.stderr)
}

runChild(
  "packaged test renderer",
  `
const { TestGpuixRenderer } = require(${JSON.stringify(nativeEntry)})
if (typeof TestGpuixRenderer !== "function") {
  throw new Error("packaged binding does not export TestGpuixRenderer")
}
new TestGpuixRenderer()
console.log("packaged test renderer uses the virtual display")
`
)

runChild(
  "production initialization panic surface",
  `
const { GpuixRenderer } = require(${JSON.stringify(nativeEntry)})
const renderer = new GpuixRenderer()
try {
  renderer.init()
  throw new Error("production renderer unexpectedly initialized")
} catch (error) {
  const message = String(error)
  if (!message.includes("GPUI macOS renderer initialization")) throw error
  if (!message.includes("display discovery disabled by GPUI_TEST_DISABLE_DISPLAY_DISCOVERY")) throw error
  console.log("production initialization panic is a catchable N-API error")
}
`
)
