import { spawnSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const packageRoot = fileURLToPath(new URL("../../", import.meta.url))
const fixture = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures/bun-hover-group-ancestor.tsx",
)

describe("Bun CSS-module preload with the native desktop renderer", () => {
  it("mounts a descendant bound to its two-levels-up hover group", { timeout: 30_000 }, () => {
    const result = spawnSync(
      "bun",
      ["--preload", "@gpuix/plugins/preload", fixture],
      { cwd: packageRoot, encoding: "utf8", timeout: 30_000 },
    )

    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain("BUN_PRELOAD_HOVER_GROUP_MOUNT_OK")
  })
})
