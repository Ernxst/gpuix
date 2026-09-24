import { expect, test } from "bun:test"
import { access, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import type { BunPlugin } from "bun"
import postcssCustomProperties from "postcss-custom-properties"
import postcssImport from "postcss-import"
import { createServer } from "vite"
import { gpuix as gpuixBun, gpuixDev } from "./bun.ts"
import { gpuixCssModules, gpuixCssModulesBun } from "./css.ts"
import { transformGpuixCssModule } from "./css-modules.ts"

// The comment matters: a token rule that keeps one after its custom properties
// are removed is still a `:root` rule, which has no native style representation.
const tokenCss = `:root {
  /* drafting palette */
  --band-hover: #252e34;
  --space: 12px;
}
`

const tokenModuleCss = `@import "./tokens.css";

.item {
  background-color: var(--band-hover);
  padding: var(--space);
}
`

const tokenPlugins = [postcssImport(), postcssCustomProperties({ preserve: false })]

test("converts simple CSS module classes into GPUIX style objects", async () => {
  expect(
    await transformGpuixCssModule(
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

test("rejects declarations outside the native style model", async () => {
  await expect(
    transformGpuixCssModule(
      ".panel { animation: fade 1s; }",
      "/fixture/panel.module.css",
    ),
  ).rejects.toThrow('property "animation" is not supported by the native style prop')
})

test("rejects selectors that cannot become one inline style object", async () => {
  // `:hover` and the other interaction states compile now; a pseudo-element
  // still has nothing to become.
  await expect(
    transformGpuixCssModule(".panel::before { color: red; }", "/fixture/panel.module.css"),
  ).rejects.toThrow('selector ".panel::before" is not supported yet')
})

test("inlines imported tokens and resolves custom properties before validation", async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), "gpuix-css-module-postcss-"))
  const expected = {
    item: {
      backgroundColor: "#252e34",
      paddingTop: 12,
      paddingRight: 12,
      paddingBottom: 12,
      paddingLeft: 12,
    },
  }

  try {
    const sourceId = path.join(fixture, "panel.module.css")
    await writeFile(path.join(fixture, "tokens.css"), tokenCss)

    // The default plugins carry this; passing them again must not change it.
    await expect(transformGpuixCssModule(tokenModuleCss, sourceId)).resolves.toEqual(expected)
    await expect(
      transformGpuixCssModule(tokenModuleCss, sourceId, tokenPlugins),
    ).resolves.toEqual(expected)
  } finally {
    await rm(fixture, { recursive: true, force: true })
  }
})

test("Vite and Bun CSS module plugins accept the same PostCSS plugins", async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), "gpuix-css-module-tokens-"))

  try {
    const entry = path.join(fixture, "entry.ts")
    await writeFile(path.join(fixture, "tokens.css"), tokenCss)
    await writeFile(path.join(fixture, "panel.module.css"), tokenModuleCss)
    await writeFile(entry, 'import styles from "./panel.module.css"\nexport default styles.item\n')

    const vite = await createServer({
      appType: "custom",
      configFile: false,
      root: fixture,
      plugins: [gpuixCssModules({ plugins: tokenPlugins })],
    })

    try {
      const viteResult = (await vite.ssrLoadModule("/entry.ts")) as {
        default: Record<string, unknown>
      }
      expect(viteResult.default.backgroundColor).toBe("#252e34")
      expect(viteResult.default.paddingTop).toBe(12)
    } finally {
      await vite.close()
    }

    const bunResult = await Bun.build({
      entrypoints: [entry],
      target: "bun",
      plugins: [gpuixCssModulesBun({ plugins: tokenPlugins })],
    })

    expect(bunResult.success).toBe(true)
    const output = await bunResult.outputs[0]?.text()
    expect(output).toContain('backgroundColor: "#252e34"')
    expect(output).toContain("paddingTop: 12")
  } finally {
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
    // `gpuix()` takes no PostCSS plugins, so imported tokens and `var()` only
    // compile here if the transform carries them by default.
    await writeFile(
      path.join(fixture, "tokens.css"),
      ":root {\n  --panel-band: #123456;\n  --panel-space: 4px;\n}\n",
    )
    await writeFile(
      path.join(fixture, "panel.module.css"),
      '@import "./tokens.css";\n\n.panel { background-color: var(--panel-band); padding: var(--panel-space); }\n',
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
    // Imported tokens and `var()`, so the fixture fails without the default
    // PostCSS plugins the preload entry has no way to be handed.
    await writeFile(
      path.join(fixture, "tokens.css"),
      ":root {\n  --panel-ink: #123456;\n  --panel-space: 4px;\n}\n",
    )
    await writeFile(
      path.join(fixture, "panel.module.css"),
      '@import "./tokens.css";\n\n.panel { color: var(--panel-ink); padding: var(--panel-space); }\n',
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

    // Imported tokens and `var()`, so the fixture fails without the default
    // PostCSS plugins the preload entry has no way to be handed.
    await writeFile(
      path.join(fixture, "tokens.css"),
      ":root {\n  --panel-ink: #123456;\n  --panel-space: 4px;\n}\n",
    )
    await writeFile(
      path.join(fixture, "panel.module.css"),
      '@import "./tokens.css";\n\n.panel { color: var(--panel-ink); padding: var(--panel-space); }\n',
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

test("flattens nested interaction states into their class style", async () => {
  await expect(
    transformGpuixCssModule(
      `
        .button {
          background-color: #111;

          &:hover {
            background-color: #222;
          }

          &:focus-visible {
            outline-color: #fff;
          }
        }
      `,
      "/fixture/button.module.css",
    ),
  ).resolves.toEqual({
    button: {
      backgroundColor: "#111",
      hover: { backgroundColor: "#222" },
      focusVisible: { outlineColor: "#fff" },
    },
  })
})

test("flattens a nested hovered descendant into hoverGroup and hoverWithin styles", async () => {
  const styles = await transformGpuixCssModule(
    `
      .card {
        background-color: #111;

        &:hover .label {
          color: #fff;
        }
      }
    `,
    "/fixture/card.module.css",
  )

  expect(styles.card).toMatchObject({ backgroundColor: "#111" })
  expect(styles.card).toHaveProperty("hoverGroup")
  expect(styles.label).toHaveProperty("hoverWithin", { color: "#fff" })
})

test("rejects a nested descendant selector on its flattened form", async () => {
  // Nesting reaches the native selector rules rather than bypassing them: this
  // becomes `.card .label`, which has no single style object to become.
  await expect(
    transformGpuixCssModule(
      ".card { .label { color: #fff; } }",
      "/fixture/card.module.css",
    ),
  ).rejects.toThrow('selector ".card .label" is not supported yet')
})

test("folds interaction pseudo-classes into their class style", async () => {
  await expect(
    transformGpuixCssModule(
      `
        .button { background-color: #111; }
        .button:hover { background-color: #222; }
        .button:active { opacity: 0.8; }
        .button:focus { outline-width: 2px; }
        .button:focus-visible { outline-color: #fff; }
        .button:focus-within { border-color: #f59e0b; }
      `,
      "/fixture/button.module.css",
    ),
  ).resolves.toEqual({
    button: {
      backgroundColor: "#111",
      hover: { backgroundColor: "#222" },
      active: { opacity: 0.8 },
      focus: { outlineWidth: 2 },
      focusVisible: { outlineColor: "#fff" },
      focusWithin: { borderColor: "#f59e0b" },
    },
  })
})

test("creates a class style when only an interaction selector is present", async () => {
  await expect(
    transformGpuixCssModule(
      ".button:hover { background-color: #222; }",
      "/fixture/button.module.css",
    ),
  ).resolves.toEqual({ button: { hover: { backgroundColor: "#222" } } })
})

test("applies a grouped state selector to each class", async () => {
  await expect(
    transformGpuixCssModule(
      ".button:hover, .icon:focus-visible { color: red; }",
      "/fixture/button.module.css",
    ),
  ).resolves.toEqual({
    button: { hover: { color: "red" } },
    icon: { focusVisible: { color: "red" } },
  })
})

test("compiles a hovered ancestor selector into hoverGroup and hoverWithin styles", async () => {
  await expect(
    transformGpuixCssModule(
      `
        .card { background-color: #12161a; }
        .card:hover .title { color: #ffffff; }
      `,
      "/fixture/card.module.css",
    ),
  ).resolves.toEqual({
    card: {
      backgroundColor: "#12161a",
      hoverGroup: "gpuix-css-module:hover-group:%2Ffixture%2Fcard.module.css:card",
    },
    title: { hoverWithin: { color: "#ffffff" } },
  })
})

test("reuses the generated hover group for an ancestor in several rules", async () => {
  await expect(
    transformGpuixCssModule(
      `
        .card:hover .title { color: #ffffff; }
        .card:hover .subtitle { color: #aaaaaa; }
      `,
      "/fixture/card.module.css",
    ),
  ).resolves.toEqual({
    card: {
      hoverGroup: "gpuix-css-module:hover-group:%2Ffixture%2Fcard.module.css:card",
    },
    title: { hoverWithin: { color: "#ffffff" } },
    subtitle: { hoverWithin: { color: "#aaaaaa" } },
  })
})

test("merges hovered descendant rules from the same ancestor", async () => {
  await expect(
    transformGpuixCssModule(
      `
        .card:hover .title { color: #ffffff; }
        .card:hover .title { background-color: #12161a; }
      `,
      "/fixture/card.module.css",
    ),
  ).resolves.toEqual({
    card: {
      hoverGroup: "gpuix-css-module:hover-group:%2Ffixture%2Fcard.module.css:card",
    },
    title: { hoverWithin: { color: "#ffffff", backgroundColor: "#12161a" } },
  })
})

test("rejects hovered descendant rules from different ancestors", async () => {
  await expect(
    transformGpuixCssModule(
      `
        .card:hover .title { color: red; }
        .panel:hover .title { background-color: blue; }
      `,
      "/fixture/card.module.css",
    ),
  ).rejects.toThrow('selector ".panel:hover .title" conflicts with selector ".card:hover .title"')
})

test("preserves a hand-written hover group on a hovered ancestor", async () => {
  await expect(
    transformGpuixCssModule(
      `
        .card:hover .title { color: #ffffff; }
        .card { hover-group: card; }
      `,
      "/fixture/card.module.css",
    ),
  ).resolves.toEqual({
    card: { hoverGroup: "card" },
    title: { hoverWithin: { color: "#ffffff" } },
  })
})

test("rejects selectors with more than one pseudo-class", async () => {
  await expect(
    transformGpuixCssModule(".panel:hover:focus { color: red; }", "/fixture/panel.module.css"),
  ).rejects.toThrow('selector ".panel:hover:focus" is not supported yet')
})

test("names the interaction state when a declaration is unsupported there", async () => {
  await expect(
    transformGpuixCssModule(".panel:active { animation: fade 1s; }", "/fixture/panel.module.css"),
  ).rejects.toThrow('property "animation" is not supported by the native "active" style')
  await expect(
    transformGpuixCssModule(".panel:hover { transition: opacity 1s; }", "/fixture/panel.module.css"),
  ).rejects.toThrow('property "transition" is not supported by the native "hover" style')
})

test("rejects other selectors and at-rules", async () => {
  await expect(
    transformGpuixCssModule(".panel .child { color: red; }", "/fixture/panel.module.css"),
  ).rejects.toThrow('selector ".panel .child" is not supported yet')
  await expect(
    transformGpuixCssModule(
      ".card:hover > .title { color: red; }",
      "/fixture/card.module.css",
    ),
  ).rejects.toThrow('selector ".card:hover > .title" is not supported yet')
  await expect(
    transformGpuixCssModule(
      ".card:hover .body .title { color: red; }",
      "/fixture/card.module.css",
    ),
  ).rejects.toThrow('selector ".card:hover .body .title" is not supported yet')
  await expect(
    transformGpuixCssModule(
      ".card:focus .title { color: red; }",
      "/fixture/card.module.css",
    ),
  ).rejects.toThrow('selector ".card:focus .title" is not supported yet')
  await expect(
    transformGpuixCssModule("@media (min-width: 1px) { .panel { color: red; } }", "/fixture/panel.module.css"),
  ).rejects.toThrow('at-rule "@media" is not supported yet')
})
