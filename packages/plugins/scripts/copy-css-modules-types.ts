import { copyFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import path from "node:path"

const packageRoot = fileURLToPath(new URL("..", import.meta.url))

await copyFile(
  path.join(packageRoot, "src", "css-modules-types.d.ts"),
  path.join(packageRoot, "dist", "css-modules-types.d.ts"),
)
