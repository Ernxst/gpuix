import { expect, test } from "bun:test"
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { createServer } from "vite"
import type { BunPlugin } from "bun"
import { gpuix as gpuixBun, gpuixDev } from "./bun.ts"
import { transformGpuixCssModule } from "./css-modules.ts"
import { gpuix } from "./index.ts"

function originalPositionAt(
  mappings: string,
  generatedLine: number,
  generatedColumn: number,
): { line: number; column: number } | undefined {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
  let source = 0
  let originalLine = 0
  let originalColumn = 0

  for (const [lineIndex, line] of mappings.split(";").entries()) {
    let generated = 0
    let match: { line: number; column: number } | undefined
    for (const segment of line.split(",")) {
      if (segment.length === 0) continue
      const values: number[] = []
      let value = 0
      let shift = 0
      for (const character of segment) {
        const digit = alphabet.indexOf(character)
        value += (digit & 31) << shift
        if ((digit & 32) !== 0) {
          shift += 5
        } else {
          values.push((value & 1) === 1 ? -(value >> 1) : value >> 1)
          value = 0
          shift = 0
        }
      }
      generated += values[0] ?? 0
      if (values.length >= 4) {
        source += values[1] ?? 0
        originalLine += values[2] ?? 0
        originalColumn += values[3] ?? 0
        if (lineIndex + 1 === generatedLine && generated <= generatedColumn) {
          match = { line: originalLine + 1, column: originalColumn }
        }
      }
    }
    if (lineIndex + 1 === generatedLine) return match
  }
  return undefined
}

test("converts simple CSS module classes into GPUIX style objects", () => {
  expect(
    transformGpuixCssModule(
      `
        .panel {
          display: flex;
          padding: 1rem 2px;
          color: #ffffff;
          font-size: 14px;
        }
      `,
      "/fixture/panel.module.css",
    ),
  ).toEqual({
    panel: {
      display: "flex",
      paddingTop: 16,
      paddingRight: 2,
      paddingBottom: 16,
      paddingLeft: 2,
      color: "#ffffff",
      fontSize: 14,
    },
  })
})

test("rejects declarations outside the native style model", () => {
  expect(() =>
    transformGpuixCssModule(
      ".panel { animation: fade 1s; }",
      "/fixture/panel.module.css",
    ),
  ).toThrow('property "animation" is not supported by the native style prop')
})

test("rejects selectors that cannot become one inline style object", () => {
  expect(() =>
    transformGpuixCssModule(".panel:hover { color: red; }", "/fixture/panel.module.css"),
  ).toThrow('selector ".panel:hover" is not supported yet')
})

test("Vite rejects native builds", () => {
  const plugin = gpuix({ entry: "main.tsx" })
  const apply = plugin.apply

  expect(typeof apply).toBe("function")
  expect(() =>
    Reflect.apply(apply as (...args: unknown[]) => unknown, undefined, [
      {},
      { command: "build", mode: "production" },
    ]),
  ).toThrow(
    "[gpuix] Vite builds are not supported for native apps; use @gpuix/plugins/bun with Bun.build().",
  )
})

test("Vite serves a native CSS module as a JavaScript style object", async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), "gpuix-vite-css-module-"))
  let server: Awaited<ReturnType<typeof createServer>> | undefined

  try {
    await writeFile(
      path.join(fixture, "panel.module.css"),
      ".panel { background-color: #123456; }\n",
    )
    const basePlugin = gpuix({ entry: "main.tsx" })

    server = await createServer({
      appType: "custom",
      configFile: false,
      root: fixture,
      plugins: [{ ...basePlugin, configureServer: undefined }],
    })

    const result = await server.environments.gpuix.transformRequest("/panel.module.css")
    expect(result?.code).toContain('__vite_ssr_export_default__')
    expect(result?.code).toContain('"backgroundColor":"#123456"')

    const browserResult = await server.transformRequest("/panel.module.css")
    expect(browserResult?.code).toContain("__vite__css")
    expect(browserResult?.code).not.toContain("backgroundColor")
  } finally {
    await server?.close()
    await rm(fixture, { recursive: true, force: true })
  }
})

test("Vite rewrites only real Bun asset imports", async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), "gpuix-vite-asset-import-syntax-"))
  let server: Awaited<ReturnType<typeof createServer>> | undefined

  try {
    const entry = path.join(fixture, "entry.ts")
    await writeFile(path.join(fixture, "note.txt"), "note contents\n")
    await writeFile(path.join(fixture, "nodes.json"), '{"nodes":["fixture"]}\n')
    const source = `import note from "./note.txt" with { type: "text" }
import bundled from "./nodes.json" with { type: "file" }
const stringValue = 'from "./note.txt" with { type: "text" }'
const templateValue = \`from "./nodes.json" with { type: "file" }\`
// from "./nodes.json" with { type: "file" }
export default { stringValue, templateValue, note, bundled }
`
    await writeFile(entry, source)

    const basePlugin = gpuix({ entry: "entry.ts" })
    server = await createServer({
      appType: "custom",
      configFile: false,
      root: fixture,
      plugins: [{ ...basePlugin, configureServer: undefined }],
    })

    const transformed = await server.environments.gpuix.transformRequest("/entry.ts")
    expect(transformed?.code).toContain('// from "./nodes.json" with { type: "file" }')

    const environment = server.environments.gpuix as unknown as {
      runner: { import: (id: string) => Promise<{ default: Record<string, string> }> }
    }
    const result = await environment.runner.import(entry)
    expect(result.default).toEqual({
      stringValue: 'from "./note.txt" with { type: "text" }',
      templateValue: 'from "./nodes.json" with { type: "file" }',
      note: "note contents\n",
      bundled: await realpath(path.join(fixture, "nodes.json")),
    })
  } finally {
    await server?.close()
    await rm(fixture, { recursive: true, force: true })
  }
})

test("Vite maps an expression after a file import attribute to its original column", async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), "gpuix-vite-file-import-map-"))
  let server: Awaited<ReturnType<typeof createServer>> | undefined

  try {
    const entry = path.join(fixture, "counter.tsx")
    const source = `import bundled from "./nodes.json" with { type: "file" }; const afterImport = bundled.length + 1; export function Counter() { return afterImport }`
    await writeFile(path.join(fixture, "nodes.json"), '{"nodes":["fixture"]}\n')
    await writeFile(entry, source)

    const basePlugin = gpuix({ entry: "counter.tsx" })
    server = await createServer({
      appType: "custom",
      configFile: false,
      root: fixture,
      plugins: [{ ...basePlugin, configureServer: undefined }],
    })

    const transformed = await server.environments.gpuix.transformRequest("/counter.tsx")
    expect(transformed?.map?.sourcesContent).toEqual([source])
    const generatedIndex = transformed?.code.indexOf("afterImport") ?? -1
    const beforeExpression = transformed?.code.slice(0, generatedIndex) ?? ""
    const generatedLine = beforeExpression.split("\n").length
    const generatedColumn = generatedIndex - beforeExpression.lastIndexOf("\n") - 1
    expect(
      originalPositionAt(transformed?.map?.mappings ?? "", generatedLine, generatedColumn),
    ).toEqual({ line: 1, column: source.indexOf("afterImport") })
  } finally {
    await server?.close()
    await rm(fixture, { recursive: true, force: true })
  }
})

test("Vite file imports resolve extensionless files named like the query marker", async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), "gpuix-vite-file-marker-name-"))
  let server: Awaited<ReturnType<typeof createServer>> | undefined

  try {
    const target = path.join(fixture, "__gpuix_file")
    const entry = path.join(fixture, "entry.ts")
    await writeFile(target, "fixture file contents\n")
    await writeFile(
      entry,
      'import file from "./__gpuix_file" with { type: "file" }\nexport default file\n',
    )

    const basePlugin = gpuix({ entry: "entry.ts" })
    server = await createServer({
      appType: "custom",
      configFile: false,
      root: fixture,
      plugins: [{ ...basePlugin, configureServer: undefined }],
    })

    const environment = server.environments.gpuix as unknown as {
      runner: { import: (id: string) => Promise<{ default: string }> }
    }
    const result = await environment.runner.import(entry)
    expect(result.default).toBe(await realpath(target))
  } finally {
    await server?.close()
    await rm(fixture, { recursive: true, force: true })
  }
})

test("Vite leaves an import query value ending in the file marker alone", async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), "gpuix-vite-file-marker-query-"))
  let server: Awaited<ReturnType<typeof createServer>> | undefined

  try {
    const entry = path.join(fixture, "entry.ts")
    await writeFile(path.join(fixture, "value.ts"), 'export default "ordinary module"\n')
    await writeFile(
      entry,
      'import value from "./value.ts?label=__gpuix_file"\nexport default value\n',
    )

    const basePlugin = gpuix({ entry: "entry.ts" })
    server = await createServer({
      appType: "custom",
      configFile: false,
      root: fixture,
      plugins: [{ ...basePlugin, configureServer: undefined }],
    })

    const environment = server.environments.gpuix as unknown as {
      runner: { import: (id: string) => Promise<{ default: string }> }
    }
    const result = await environment.runner.import(entry)
    expect(result.default).toBe("ordinary module")
  } finally {
    await server?.close()
    await rm(fixture, { recursive: true, force: true })
  }
})

test("Bun builds native CSS modules and receives GPUIX build defaults", async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), "gpuix-bun-css-module-"))
  const observed: {
    target?: string
    format?: string
    external?: string[]
    define?: Record<string, string>
    conditions?: string | string[]
    jsx?: { runtime?: string; importSource?: string }
  } = {}

  const configObserver: BunPlugin = {
    name: "gpuix-test-config-observer",
    setup(build) {
      observed.target = build.config.target
      observed.format = build.config.format
      observed.external = build.config.external
      observed.define = build.config.define
      observed.conditions = build.config.conditions
      observed.jsx = build.config.jsx
    },
  }

  try {
    const entry = path.join(fixture, "entry.ts")
    await writeFile(entry, 'import styles from "./panel.module.css"\nexport default styles.panel\n')
    await writeFile(
      path.join(fixture, "panel.module.css"),
      ".panel { background-color: #123456; padding: 4px; }\n",
    )

    const result = await Bun.build({
      entrypoints: [entry],
      external: ["user-external"],
      define: { "process.env.USER_DEFINE": JSON.stringify("config") },
      conditions: ["user-condition"],
      jsx: { importSource: "@user/react" },
      plugins: [
        gpuixBun({
          external: ["plugin-external"],
          define: { "process.env.PLUGIN_DEFINE": JSON.stringify("plugin") },
          conditions: ["plugin-condition"],
        }),
        configObserver,
      ],
    })

    expect(result.success).toBe(true)
    const output = await result.outputs[0]?.text()
    expect(output).toContain('backgroundColor: "#123456"')
    expect(output).toContain("paddingTop: 4")
    expect(observed.target).toBe("bun")
    expect(observed.format).toBe("esm")
    expect(observed.external).toEqual([
      "user-external",
      "@gpuix/native",
      "plugin-external",
    ])
    expect(observed.define).toEqual({
      "process.env.PLUGIN_DEFINE": JSON.stringify("plugin"),
      "process.env.USER_DEFINE": JSON.stringify("config"),
    })
    expect(observed.conditions).toEqual(["plugin-condition", "user-condition"])
    expect(observed.jsx).toMatchObject({
      runtime: "automatic",
      importSource: "@user/react",
    })
  } finally {
    await rm(fixture, { recursive: true, force: true })
  }
})

test("Bun dev plugin loads native CSS modules at runtime", async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), "gpuix-bun-dev-css-module-"))

  try {
    const entry = path.join(fixture, "entry.ts")
    await writeFile(
      path.join(fixture, "panel.module.css"),
      ".panel { color: #123456; padding: 4px; }\n",
    )
    await writeFile(
      entry,
      'import styles from "./panel.module.css"\nexport default styles.panel\n',
    )

    Bun.plugin(gpuixDev())
    const result = await import(pathToFileURL(entry).href)

    expect(result.default).toEqual({
      color: "#123456",
      paddingTop: 4,
      paddingRight: 4,
      paddingBottom: 4,
      paddingLeft: 4,
    })
  } finally {
    Bun.plugin.clearAll()
    await rm(fixture, { recursive: true, force: true })
  }
})
