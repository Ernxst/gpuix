// The GPU-IX agent skill in `skills/gpuix/` states lists that agents build on
// without checking the source. Each list sits in a fenced block after a
// `<!-- skill-check:<name> -->` marker; these tests fail when one drifts.
import { expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { SUPPORTED_PROPERTIES, transformGpuixCssModule } from "./css-modules.ts"

const repoRoot = path.resolve(import.meta.dir, "../../..")
const skillDir = path.join(repoRoot, "skills/gpuix")

async function listed(file: string, name: string): Promise<string[]> {
  const text = await readFile(path.join(skillDir, file), "utf8")
  const block = new RegExp(`<!-- skill-check:${name} -->\\s*\`\`\`[a-z]*\\n([\\s\\S]*?)\`\`\``).exec(
    text,
  )
  if (!block) throw new Error(`skills/gpuix/${file} has no skill-check:${name} block`)
  return block[1]
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
}

async function packageExports(packageDir: string): Promise<string[]> {
  const manifest = JSON.parse(
    await readFile(path.join(repoRoot, packageDir, "package.json"), "utf8"),
  ) as { name: string; exports: Record<string, unknown> }
  return Object.keys(manifest.exports).map((key) =>
    key === "." ? manifest.name : `${manifest.name}/${key.slice(2)}`,
  )
}

test("the skill lists every CSS module property the plugin accepts", async () => {
  const properties = await listed("references/css-modules.md", "css-module-properties")
  // The skill lists CSS names; the plugin checks their camel-cased form.
  const camelCased = properties.map((property) =>
    property.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase()),
  )
  expect(camelCased.toSorted()).toEqual([...SUPPORTED_PROPERTIES].toSorted())
})

test("the selectors the skill says CSS modules accept compile", async () => {
  for (const selector of await listed("references/css-modules.md", "accepted-selectors")) {
    await expect(
      transformGpuixCssModule(`${selector} { color: red; }`, "/skill/accepted.module.css"),
    ).resolves.toBeDefined()
  }
})

test("the selectors the skill says CSS modules reject fail the build", async () => {
  for (const selector of await listed("references/css-modules.md", "rejected-selectors")) {
    await expect(
      transformGpuixCssModule(`${selector} { color: red; }`, "/skill/rejected.module.css"),
    ).rejects.toThrow("is not supported yet")
  }
})

test("the skill lists every package entry point", async () => {
  const entryPoints = await listed("references/platform.md", "entry-points")
  const exported = [
    ...(await packageExports("packages/react")),
    ...(await packageExports("packages/plugins")),
  ]
  expect(entryPoints.toSorted()).toEqual(exported.toSorted())
})
