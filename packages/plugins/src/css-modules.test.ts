import { expect, test } from "bun:test"
import { access, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import type { BunPlugin } from "bun"
import { gpuix as gpuixBun, gpuixDev } from "./bun.ts"
import { transformGpuixCssModule } from "./css-modules.ts"

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

test("folds interaction pseudo-classes into their class style", () => {
  expect(
    transformGpuixCssModule(
      `
        .button { background-color: #111; }
        .button:hover { background-color: #222; }
        .button:active { opacity: 0.8; }
        .button:focus { outline-width: 2px; }
        .button:focus-visible { outline-color: #fff; }
      `,
      "/fixture/button.module.css",
    ),
  ).toEqual({
    button: {
      backgroundColor: "#111",
      hover: { backgroundColor: "#222" },
      active: { opacity: 0.8 },
      focus: { outlineWidth: 2 },
      focusVisible: { outlineColor: "#fff" },
    },
  })
})

test("creates a class style when only an interaction selector is present", () => {
  expect(
    transformGpuixCssModule(
      ".button:hover { background-color: #222; }",
      "/fixture/button.module.css",
    ),
  ).toEqual({ button: { hover: { backgroundColor: "#222" } } })
})

test("applies a grouped state selector to each class", () => {
  expect(
    transformGpuixCssModule(
      ".button:hover, .icon:focus-visible { color: red; }",
      "/fixture/button.module.css",
    ),
  ).toEqual({
    button: { hover: { color: "red" } },
    icon: { focusVisible: { color: "red" } },
  })
})

test("compiles a hovered ancestor selector into hoverGroup and hoverWithin styles", () => {
  expect(
    transformGpuixCssModule(
      `
        .card { background-color: #12161a; }
        .card:hover .title { color: #ffffff; }
      `,
      "/fixture/card.module.css",
    ),
  ).toEqual({
    card: {
      backgroundColor: "#12161a",
      hoverGroup: "gpuix-css-module:hover-group:%2Ffixture%2Fcard.module.css:card",
    },
    title: { hoverWithin: { color: "#ffffff" } },
  })
})

test("reuses the generated hover group for an ancestor in several rules", () => {
  expect(
    transformGpuixCssModule(
      `
        .card:hover .title { color: #ffffff; }
        .card:hover .subtitle { color: #aaaaaa; }
      `,
      "/fixture/card.module.css",
    ),
  ).toEqual({
    card: {
      hoverGroup: "gpuix-css-module:hover-group:%2Ffixture%2Fcard.module.css:card",
    },
    title: { hoverWithin: { color: "#ffffff" } },
    subtitle: { hoverWithin: { color: "#aaaaaa" } },
  })
})

test("merges hovered descendant rules from the same ancestor", () => {
  expect(
    transformGpuixCssModule(
      `
        .card:hover .title { color: #ffffff; }
        .card:hover .title { background-color: #12161a; }
      `,
      "/fixture/card.module.css",
    ),
  ).toEqual({
    card: {
      hoverGroup: "gpuix-css-module:hover-group:%2Ffixture%2Fcard.module.css:card",
    },
    title: { hoverWithin: { color: "#ffffff", backgroundColor: "#12161a" } },
  })
})

test("rejects hovered descendant rules from different ancestors", () => {
  expect(() =>
    transformGpuixCssModule(
      `
        .card:hover .title { color: red; }
        .panel:hover .title { background-color: blue; }
      `,
      "/fixture/card.module.css",
    ),
  ).toThrow('selector ".panel:hover .title" conflicts with selector ".card:hover .title"')
})

test("preserves a hand-written hover group on a hovered ancestor", () => {
  expect(
    transformGpuixCssModule(
      `
        .card:hover .title { color: #ffffff; }
        .card { hover-group: card; }
      `,
      "/fixture/card.module.css",
    ),
  ).toEqual({
    card: { hoverGroup: "card" },
    title: { hoverWithin: { color: "#ffffff" } },
  })
})

test("rejects selectors with more than one pseudo-class", () => {
  expect(() =>
    transformGpuixCssModule(".panel:hover:focus { color: red; }", "/fixture/panel.module.css"),
  ).toThrow('selector ".panel:hover:focus" is not supported yet')
})

test("names the interaction state when a declaration is unsupported there", () => {
  expect(() =>
    transformGpuixCssModule(".panel:active { animation: fade 1s; }", "/fixture/panel.module.css"),
  ).toThrow('property "animation" is not supported by the native "active" style')
  expect(() =>
    transformGpuixCssModule(".panel:hover { transition: opacity 1s; }", "/fixture/panel.module.css"),
  ).toThrow('property "transition" is not supported by the native "hover" style')
})

test("rejects other selectors and at-rules", () => {
  expect(() =>
    transformGpuixCssModule(".panel .child { color: red; }", "/fixture/panel.module.css"),
  ).toThrow('selector ".panel .child" is not supported yet')
  expect(() =>
    transformGpuixCssModule(
      ".card:hover > .title { color: red; }",
      "/fixture/card.module.css",
    ),
  ).toThrow('selector ".card:hover > .title" is not supported yet')
  expect(() =>
    transformGpuixCssModule(
      ".card:hover .body .title { color: red; }",
      "/fixture/card.module.css",
    ),
  ).toThrow('selector ".card:hover .body .title" is not supported yet')
  expect(() =>
    transformGpuixCssModule(
      ".card:focus .title { color: red; }",
      "/fixture/card.module.css",
    ),
  ).toThrow('selector ".card:focus .title" is not supported yet')
  expect(() =>
    transformGpuixCssModule("@media (min-width: 1px) { .panel { color: red; } }", "/fixture/panel.module.css"),
  ).toThrow('at-rule "@media" is not supported yet')
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

    const outputFile = path.join(fixture, "entry-built.js")
    await writeFile(outputFile, output ?? "")
    const builtModule = await import(pathToFileURL(outputFile).href)
    expect(
      Object.getOwnPropertySymbols(builtModule.default).includes(
        Symbol.for("gpuix.compiledStyle"),
      ),
    ).toBe(true)

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
    expect(
      Object.getOwnPropertySymbols(result.default).includes(Symbol.for("gpuix.compiledStyle")),
    ).toBe(true)
  } finally {
    Bun.plugin.clearAll()
    await rm(fixture, { recursive: true, force: true })
  }
})

test("Bun preload entry loads native CSS modules at runtime", async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), "gpuix-bun-preload-css-module-"))
  const packageRoot = fileURLToPath(new URL("../", import.meta.url))
  const preload = path.join(packageRoot, "dist/preload.js")

  try {
    try {
      await access(preload)
    } catch {
      throw new Error("@gpuix/plugins/preload is missing from dist; run bun run build before bun test")
    }

    const entry = path.join(fixture, "entry.ts")
    const packageLink = path.join(fixture, "node_modules/@gpuix/plugins")
    await mkdir(path.dirname(packageLink), { recursive: true })
    await symlink(packageRoot, packageLink, "dir")

    await writeFile(
      path.join(fixture, "panel.module.css"),
      ".panel { color: #123456; padding: 4px; }\n",
    )
    await writeFile(
      entry,
      'import styles from "./panel.module.css"\nconsole.log(JSON.stringify({ style: styles.panel, compiled: Object.getOwnPropertySymbols(styles.panel).includes(Symbol.for("gpuix.compiledStyle")) }))\n',
    )

    const result = Bun.spawnSync([process.execPath, "--preload", "@gpuix/plugins/preload", entry], {
      cwd: fixture,
      stdout: "pipe",
      stderr: "pipe",
    })

    expect(result.exitCode, result.stderr.toString()).toBe(0)
    const loaded = JSON.parse(result.stdout.toString()) as {
      style: Record<string, unknown>
      compiled: boolean
    }
    expect(loaded.style).toEqual({
      color: "#123456",
      paddingTop: 4,
      paddingRight: 4,
      paddingBottom: 4,
      paddingLeft: 4,
    })
    expect(loaded.compiled).toBe(true)
  } finally {
    await rm(fixture, { recursive: true, force: true })
  }
})
