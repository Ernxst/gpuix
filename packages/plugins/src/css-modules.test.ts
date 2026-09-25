import { describe, expect, test } from "bun:test"
import { access, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import type { BunPlugin } from "bun"
import postcssCustomProperties from "postcss-custom-properties"
import postcssImport from "postcss-import"
import React from "react"
import { createTestRoot, isNativeTestRendererAvailable } from "@gpuix/react/testing"
import { createServer } from "vite"
import { gpuix as gpuixBun, gpuixDev } from "./bun.ts"
import { cssModuleId, gpuixCssModules, gpuixCssModulesBun, loadCssModule } from "./css.ts"
import { transformGpuixCssModule } from "./css-modules.ts"

const describeNative = isNativeTestRendererAvailable() ? describe : describe.skip

async function canonicalFiles(files: string[]): Promise<string[]> {
  return Promise.all(files.map((file) => realpath(file)))
}

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

test("converts text-decoration shorthand and longhands to style prop keys", async () => {
  await expect(
    transformGpuixCssModule(
      ".plain { text-decoration: underline; } .line { text-decoration-line: line-through; text-decoration-style: solid; }",
      "/fixture/decoration.module.css",
    ),
  ).resolves.toEqual({
    plain: { textDecoration: "underline" },
    line: { textDecoration: "line-through" },
  })

  await expect(
    transformGpuixCssModule(
      ".coloured { text-decoration: underline red; }",
      "/fixture/decoration.module.css",
    ),
  ).rejects.toThrow('property "textDecorationColor" is not supported by the native style prop')
  await expect(
    transformGpuixCssModule(
      ".coloured { text-decoration-color: blue; }",
      "/fixture/decoration.module.css",
    ),
  ).rejects.toThrow('property "textDecorationColor" is not supported by the native style prop')
  await expect(
    transformGpuixCssModule(
      ".multiple { text-decoration: underline line-through; }",
      "/fixture/decoration.module.css",
    ),
  ).rejects.toThrow('property "textDecoration" value "underline line-through" is not supported')
})

describeNative("desktop renderer", () => {
  test("renders a text-decoration CSS module", async () => {
    const fixture = await mkdtemp(path.join(os.tmpdir(), "gpuix-css-module-decoration-"))
    const sourceId = path.join(fixture, "decoration.module.css")
    await writeFile(sourceId, ".link { text-decoration: underline; }")
    const vite = await createServer({
      appType: "custom",
      configFile: false,
      root: fixture,
      plugins: [gpuixCssModules()],
    })

    try {
      const styles = (await vite.ssrLoadModule("/decoration.module.css")) as {
        default: { link: string }
      }
      const root = createTestRoot()
      try {
        root.render(
          React.createElement(
            "text",
            { className: styles.default.link, "data-testid": "link" },
            "link",
          ),
        )
        expect(root.renderer.getAllText()).toEqual(["link"])
        const link = root.renderer.findByTestId("link")!
        expect(root.renderer.getResolvedStyle(link.id)).toMatchObject({ textDecoration: "underline" })
      } finally {
        root.unmount()
      }
    } finally {
      await vite.close()
      await rm(fixture, { recursive: true, force: true })
    }
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

test("resolves composes in imported CSS from the stylesheet that declares it", async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), "gpuix-css-module-imported-composes-"))
  try {
    const sourceId = path.join(fixture, "button.module.css")
    const parts = path.join(fixture, "parts")
    await mkdir(parts)
    await writeFile(sourceId, '@import "./parts/base.css";\n.button { composes: base; }\n')
    await writeFile(
      path.join(parts, "base.css"),
      '.base { composes: accent from "./accent.module.css"; }\n',
    )
    await writeFile(path.join(parts, "accent.module.css"), ".accent { color: magenta; }\n")

    const resolutions: Array<[string, string]> = []
    await expect(
      transformGpuixCssModule(
        await Bun.file(sourceId).text(),
        sourceId,
        [],
        async (specifier, importer) => {
          resolutions.push([specifier, importer])
          return path.resolve(path.dirname(importer), specifier)
        },
      ),
    ).resolves.toMatchObject({ button: { color: "magenta" } })
    const compositionResolutions = resolutions.filter(
      ([specifier]) => specifier === "./accent.module.css",
    )
    expect(compositionResolutions.length).toBeGreaterThan(0)
    expect(
      compositionResolutions.every(([, importer]) => importer === path.join(parts, "base.css")),
    ).toBe(true)
  } finally {
    await rm(fixture, { recursive: true, force: true })
  }
})

test("watches token files imported by a Vite CSS module", async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), "gpuix-css-module-watch-"))
  try {
    const sourceId = path.join(fixture, "panel.module.css")
    const tokens = path.join(fixture, "tokens.css")
    await writeFile(sourceId, tokenModuleCss)
    await writeFile(tokens, tokenCss)
    const watched: string[] = []
    await loadCssModule({ addWatchFile: (id: string) => watched.push(id) }, cssModuleId(sourceId))
    expect(await canonicalFiles(watched)).toEqual(await canonicalFiles([sourceId, tokens]))
  } finally {
    await rm(fixture, { recursive: true, force: true })
  }
})

test("matches watched files that use different path aliases", async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), "gpuix-css-module-watch-alias-"))
  const tokens = path.join(fixture, "tokens.css")
  const alias = `${fixture}${path.sep}nested${path.sep}..${path.sep}tokens.css`

  try {
    await mkdir(path.join(fixture, "nested"))
    await writeFile(tokens, tokenCss)
    expect(await canonicalFiles([alias])).toEqual(await canonicalFiles([tokens]))
  } finally {
    await rm(fixture, { recursive: true, force: true })
  }
})

test("keeps unitless line-height as a ratio and pixel line-height as a length", async () => {
  await expect(
    transformGpuixCssModule(
      ".ratio { font-size: 12px; line-height: 1.5; } .pixels { line-height: 18px; } .composed { composes: pixels; }",
      "/fixture/text.module.css",
    ),
  ).resolves.toEqual({
    ratio: { fontSize: 12, lineHeight: "1.5" },
    pixels: { lineHeight: "18px" },
    composed: { lineHeight: "18px" },
  })
})

test("Vite and Bun resolve package imports and bare CSS packages inside nested modules", async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), "gpuix-css-module-resolution-"))

  try {
    const entry = path.join(fixture, "entry.ts")
    const moduleDir = path.join(fixture, "src/components")
    const themeDir = path.join(fixture, "node_modules/@fixture/theme")
    const stylePackageDir = path.join(fixture, "node_modules/style-package")
    await mkdir(moduleDir, { recursive: true })
    await mkdir(themeDir, { recursive: true })
    await mkdir(stylePackageDir, { recursive: true })
    await writeFile(
      path.join(fixture, "package.json"),
      JSON.stringify({ imports: { "#styles/tokens.css": "./src/styles/tokens.css" } }),
    )
    await mkdir(path.join(fixture, "src/styles"), { recursive: true })
    await writeFile(path.join(fixture, "src/styles/tokens.css"), '@import "./palette.css";')
    await writeFile(path.join(fixture, "src/styles/palette.css"), ":root { --ink: #123456; }")
    await writeFile(
      path.join(themeDir, "package.json"),
      JSON.stringify({ name: "@fixture/theme", exports: "./tokens.css" }),
    )
    await writeFile(path.join(themeDir, "tokens.css"), ":root { --space: 7px; }")
    await writeFile(
      path.join(stylePackageDir, "package.json"),
      JSON.stringify({ name: "style-package", main: "index.js", style: "tokens.css" }),
    )
    await writeFile(path.join(stylePackageDir, "index.js"), "export default 'not CSS'")
    await writeFile(path.join(stylePackageDir, "tokens.css"), ":root { --accent: #abcdef; }")
    await writeFile(
      path.join(moduleDir, "panel.module.css"),
      '@import "#styles/tokens.css";\n@import "@fixture/theme";\n@import "style-package";\n.panel { color: var(--ink); background-color: var(--accent); padding: var(--space); line-height: 1.5; }',
    )
    await writeFile(entry, 'import styles from "./src/components/panel.module.css"\nexport default styles.panel\n')

    const vite = await createServer({
      appType: "custom",
      configFile: false,
      root: fixture,
      plugins: [gpuixCssModules()],
    })
    try {
      const loaded = (await vite.ssrLoadModule("/entry.ts")) as { default: Record<string, unknown> }
      expect(loaded.default).toMatchObject({
        color: "#123456",
        backgroundColor: "#abcdef",
        paddingTop: 7,
        lineHeight: "1.5",
      })
    } finally {
      await vite.close()
    }

    const built = await Bun.build({
      entrypoints: [entry],
      target: "bun",
      plugins: [gpuixCssModulesBun()],
    })
    expect(built.success, built.logs.map(String).join("\n")).toBe(true)
    const output = await built.outputs[0]?.text()
    expect(output).toContain('color: "#123456"')
    expect(output).toContain('backgroundColor: "#abcdef"')
    expect(output).toContain("paddingTop: 7")
    expect(output).toContain('lineHeight: "1.5"')
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
    const builtModule = await import(pathToFileURL(await realpath(outputFile)).href)
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
    await mkdir(path.join(fixture, "src/components"), { recursive: true })
    await mkdir(path.join(fixture, "src/styles"), { recursive: true })
    const themeDir = path.join(fixture, "node_modules/@fixture/theme")
    const stylePackageDir = path.join(fixture, "node_modules/style-package")
    await mkdir(themeDir, { recursive: true })
    await mkdir(stylePackageDir, { recursive: true })
    await writeFile(
      path.join(fixture, "package.json"),
      JSON.stringify({ imports: { "#styles/tokens.css": "./src/styles/tokens.css" } }),
    )
    await writeFile(path.join(fixture, "src/styles/tokens.css"), ":root { --panel-ink: #123456; }")
    await writeFile(
      path.join(themeDir, "package.json"),
      JSON.stringify({ name: "@fixture/theme", exports: "./tokens.css" }),
    )
    await writeFile(path.join(themeDir, "tokens.css"), ":root { --panel-space: 4px; }")
    await writeFile(
      path.join(stylePackageDir, "package.json"),
      JSON.stringify({ name: "style-package", main: "index.js", style: "tokens.css" }),
    )
    await writeFile(path.join(stylePackageDir, "index.js"), "export default 'not CSS'")
    await writeFile(path.join(stylePackageDir, "tokens.css"), ":root { --panel-band: #abcdef; }")
    await writeFile(
      path.join(fixture, "src/components/plate.module.css"),
      ".plate { font-size: 11px; }\n",
    )

    // Imported tokens and `var()`, so the fixture fails without the default
    // PostCSS plugins the preload entry has no way to be handed.
    await writeFile(
      path.join(fixture, "src/components/panel.module.css"),
      '@import "#styles/tokens.css";\n@import "@fixture/theme";\n@import "style-package";\n.panel { composes: plate from "./plate.module.css"; color: var(--panel-ink); background-color: var(--panel-band); padding: var(--panel-space); line-height: 1.5; }\n',
    )
    await writeFile(
      entry,
      'import styles from "./src/components/panel.module.css"\nconsole.log(JSON.stringify({ style: styles.panel, compiled: Object.getOwnPropertySymbols(styles.panel).includes(Symbol.for("gpuix.compiledStyle")) }))\n',
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
      backgroundColor: "#abcdef",
      fontSize: 11,
      paddingTop: 4,
      paddingRight: 4,
      paddingBottom: 4,
      paddingLeft: 4,
      lineHeight: "1.5",
    })
    expect(loaded.compiled).toBe(true)
  } finally {
    await rm(fixture, { recursive: true, force: true })
  }
})

test("Bun preload resolves package imports in CSS compositions", async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), "gpuix-bun-composes-import-"))
  const preload = fileURLToPath(new URL("../dist/preload.js", import.meta.url))

  try {
    await mkdir(path.join(fixture, "ui/control"), { recursive: true })
    await mkdir(path.join(fixture, "ui/button"), { recursive: true })
    const packageDir = path.join(fixture, "node_modules/style-pkg")
    const legacyPackageDir = path.join(fixture, "node_modules/legacy-pkg")
    await mkdir(packageDir, { recursive: true })
    await mkdir(legacyPackageDir, { recursive: true })
    await writeFile(
      path.join(fixture, "package.json"),
      JSON.stringify({ imports: { "#local/*": "./ui/*", "#ui/*": "style-pkg/*" } }),
    )
    await writeFile(
      path.join(fixture, "ui/control/control.module.css"),
      ".control { display: flex; }\n",
    )
    await writeFile(
      path.join(packageDir, "package.json"),
      JSON.stringify({ name: "style-pkg", exports: { "./tile.module.css": "./tile.module.css" } }),
    )
    await writeFile(path.join(packageDir, "tile.module.css"), ".tile { color: red; }\n")
    await writeFile(path.join(legacyPackageDir, "package.json"), JSON.stringify({ name: "legacy-pkg" }))
    await writeFile(
      path.join(legacyPackageDir, "tile.module.css"),
      ".tile { background-color: blue; }\n",
    )
    await writeFile(
      path.join(fixture, "ui/button/button.module.css"),
      '.button { composes: control from "#local/control/control.module.css"; composes: tile from "style-pkg/tile.module.css"; composes: tile from "#ui/tile.module.css"; composes: tile from "legacy-pkg/tile.module.css"; }\n',
    )
    const entry = path.join(fixture, "entry.ts")
    await writeFile(
      entry,
      'import styles from "./ui/button/button.module.css"\nconsole.log(JSON.stringify(styles.button))\n',
    )

    const result = Bun.spawnSync([process.execPath, "--preload", preload, entry], {
      cwd: fixture,
      stdout: "pipe",
      stderr: "pipe",
    })

    expect(result.exitCode, result.stderr.toString()).toBe(0)
    expect(JSON.parse(result.stdout.toString())).toEqual({
      display: "flex",
      color: "red",
      backgroundColor: "blue",
    })
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
    title: {
      hoverWithinGroup:
        "gpuix-css-module:hover-group:%2Ffixture%2Fcard.module.css:card",
      hoverWithin: { color: "#ffffff" },
    },
  })
})

test("compiles a pressed ancestor selector into the shared group and activeWithin styles", async () => {
  await expect(
    transformGpuixCssModule(
      `
        .card:hover .title { color: #ffffff; }
        .card:active .title { background-color: #22c55e; }
      `,
      "/fixture/card.module.css",
    ),
  ).resolves.toEqual({
    card: {
      hoverGroup: "gpuix-css-module:hover-group:%2Ffixture%2Fcard.module.css:card",
    },
    title: {
      hoverWithinGroup:
        "gpuix-css-module:hover-group:%2Ffixture%2Fcard.module.css:card",
      hoverWithin: { color: "#ffffff" },
      activeWithin: { backgroundColor: "#22c55e" },
    },
  })
})

test("composes same-file classes in stylesheet order", async () => {
  await expect(
    transformGpuixCssModule(
      `
        .base { color: red; }
        .icon { font-size: 12px; }
        .button { color: blue; composes: base icon; }
        .base { color: green; }
      `,
      "/fixture/composes.module.css",
    ),
  ).resolves.toMatchObject({
    button: { color: "green", fontSize: 12 },
  })
})

test("merges cross-file classes in composition order before local rules", async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), "gpuix-css-module-order-"))
  try {
    await writeFile(path.join(fixture, "light.module.css"), ".light { color: white; }\n")
    await writeFile(path.join(fixture, "dark.module.css"), ".dark { color: black; }\n")
    const styles = await transformGpuixCssModule(
      `
        .button {
          composes: light from "./light.module.css";
          composes: dark from "./dark.module.css";
          background-color: blue;
        }
        .local {
          composes: light from "./light.module.css";
          composes: dark from "./dark.module.css";
          color: red;
        }
      `,
      path.join(fixture, "button.module.css"),
    )

    expect(styles.button).toEqual({ color: "black", backgroundColor: "blue" })
    expect(styles.local).toEqual({ color: "red" })
  } finally {
    await rm(fixture, { recursive: true, force: true })
  }
})

test("rejects composed classes with conflicting hovered-descendant relationships", async () => {
  await expect(
    transformGpuixCssModule(
      `
        .card:hover .label { color: red; }
        .panel:hover .caption { background-color: blue; }
        .title { composes: label caption; }
      `,
      "/fixture/conflicting-hover-within.module.css",
    ),
  ).rejects.toThrow('class ".title" cannot compose conflicting "hoverWithinGroup" values')

  await expect(
    transformGpuixCssModule(
      `
        .card:hover .label { color: red; }
        .panel:hover .caption { background-color: blue; }
        .frame { composes: card panel; }
      `,
      "/fixture/conflicting-hover-group.module.css",
    ),
  ).rejects.toThrow('class ".frame" cannot compose conflicting "hoverGroup" values')
})

test("merges composed and local declarations inside every interaction state", async () => {
  const styles = await transformGpuixCssModule(
    `
      .base:hover { color: red; }
      .button:hover { background-color: blue; }
      .base:active { color: red; }
      .button:active { background-color: blue; }
      .base:focus { color: red; }
      .button:focus { background-color: blue; }
      .base:focus-visible { color: red; }
      .button:focus-visible { background-color: blue; }
      .base:focus-within { color: red; }
      .button:focus-within { background-color: blue; }
      .panel:hover .base { color: red; }
      .panel:hover .button { background-color: blue; }
      .button { composes: base; }
    `,
    "/fixture/states.module.css",
  )

  expect(styles.button).toEqual({
    hover: { color: "red", backgroundColor: "blue" },
    active: { color: "red", backgroundColor: "blue" },
    focus: { color: "red", backgroundColor: "blue" },
    focusVisible: { color: "red", backgroundColor: "blue" },
    focusWithin: { color: "red", backgroundColor: "blue" },
    hoverWithinGroup:
      `gpuix-css-module:hover-group:${encodeURIComponent("/fixture/states.module.css")}:panel`,
    hoverWithin: { color: "red", backgroundColor: "blue" },
  })
  expect(styles.panel).toHaveProperty("hoverGroup")
})

test("composes the hovered ancestor and descendant across modules", async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), "gpuix-css-module-hover-composes-"))
  try {
    const hoverModule = path.join(fixture, "hover.module.css")
    await writeFile(hoverModule, ".card:hover .label { color: white; }\n")
    const styles = await transformGpuixCssModule(
      `
        .frame { composes: card from "./hover.module.css"; }
        .caption { composes: label from "./hover.module.css"; }
        .other { hover-group: unrelated; }
      `,
      path.join(fixture, "consumer.module.css"),
    )

    expect(styles.frame).toHaveProperty(
      "hoverGroup",
      `gpuix-css-module:hover-group:${encodeURIComponent(hoverModule)}:card`,
    )
    expect(styles.caption).toEqual({
      hoverWithinGroup: styles.frame.hoverGroup,
      hoverWithin: { color: "white" },
    })
    expect(styles.caption.hoverWithinGroup).not.toBe(styles.other.hoverGroup)
  } finally {
    await rm(fixture, { recursive: true, force: true })
  }
})

test("rejects missing composed classes and missing composed files", async () => {
  await expect(
    transformGpuixCssModule(
      ".button { composes: missing; }",
      "/fixture/missing-class.module.css",
    ),
  ).rejects.toThrow('declaration "composes: missing" references missing class ".missing"')

  await expect(
    transformGpuixCssModule(
      '.button { composes: plate from "./missing.module.css"; }',
      "/fixture/missing-file.module.css",
    ),
  ).rejects.toThrow(/declaration .*composes: plate from.*missing\.module\.css.*could not read/)

  const fixture = await mkdtemp(path.join(os.tmpdir(), "gpuix-css-module-missing-composed-class-"))
  try {
    await writeFile(path.join(fixture, "tile.module.css"), ".other { color: white; }\n")
    await expect(
      transformGpuixCssModule(
        '.button { composes: missing from "./tile.module.css"; }',
        path.join(fixture, "button.module.css"),
      ),
    ).rejects.toThrow(/declaration .*references missing class "\.missing" in/)
  } finally {
    await rm(fixture, { recursive: true, force: true })
  }
})

test("rejects global composition with a diagnostic naming the declaration", async () => {
  await expect(
    transformGpuixCssModule(
      ".button { composes: reset from global; }",
      "/fixture/global.module.css",
    ),
  ).rejects.toThrow('declaration "composes: reset from global" cannot use "from global"')
})

test("rejects composition cycles with the class chain", async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), "gpuix-css-module-cycle-"))
  try {
    await writeFile(
      path.join(fixture, "a.module.css"),
      '.a { composes: b from "./b.module.css"; }\n',
    )
    await writeFile(
      path.join(fixture, "b.module.css"),
      '.b { composes: a from "./a.module.css"; }\n',
    )
    await expect(
      transformGpuixCssModule(
        await Bun.file(path.join(fixture, "a.module.css")).text(),
        path.join(fixture, "a.module.css"),
      ),
    ).rejects.toThrow(
      `composition cycle: ${path.join(fixture, "a.module.css")}#.a -> ${path.join(fixture, "b.module.css")}#.b -> ${path.join(fixture, "a.module.css")}#.a`,
    )
  } finally {
    await rm(fixture, { recursive: true, force: true })
  }
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
    title: {
      hoverWithinGroup:
        "gpuix-css-module:hover-group:%2Ffixture%2Fcard.module.css:card",
      hoverWithin: { color: "#ffffff" },
    },
    subtitle: {
      hoverWithinGroup:
        "gpuix-css-module:hover-group:%2Ffixture%2Fcard.module.css:card",
      hoverWithin: { color: "#aaaaaa" },
    },
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
    title: {
      hoverWithinGroup:
        "gpuix-css-module:hover-group:%2Ffixture%2Fcard.module.css:card",
      hoverWithin: { color: "#ffffff", backgroundColor: "#12161a" },
    },
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
    title: { hoverWithinGroup: "card", hoverWithin: { color: "#ffffff" } },
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
