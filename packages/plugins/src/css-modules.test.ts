import { expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { createServer } from "vite"
import type { BunPlugin } from "bun"
import { gpuix as gpuixBun, gpuixDev } from "./bun.ts"
import { transformGpuixCssModule } from "./css-modules.ts"
import { gpuix } from "./index.ts"

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
