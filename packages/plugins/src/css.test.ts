import { afterEach, expect, test } from "bun:test"
import { existsSync, realpathSync } from "node:fs"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { createServer, type ViteDevServer } from "vite"
import {
  cssModuleId,
  gpuixCssModules,
  gpuixCssModulesBun,
  loadCssModule,
  resolveCssModule,
} from "./css.ts"

let server: ViteDevServer | undefined
let fixture: string | undefined

afterEach(async () => {
  await server?.close()
  server = undefined
  if (fixture) await rm(fixture, { recursive: true, force: true })
  fixture = undefined
})

test("compiles CSS modules in a plain Vite config, with no gpuix environment", async () => {
  fixture = await mkdtemp(path.join(path.dirname(fileURLToPath(import.meta.url)), ".css-spike-"))
  await writeFile(
    path.join(fixture, "tokens.css"),
    ":root {\n  --button-ink: #ffffff;\n  --button-space: 1rem 2px;\n}\n",
  )
  // No `plugins` option, so the default PostCSS plugins are what make the
  // import and the `var()` references compile.
  await writeFile(
    path.join(fixture, "button.module.css"),
    '@import "./tokens.css";\n\n.button { color: var(--button-ink); padding: var(--button-space); }\n',
  )
  await writeFile(
    path.join(fixture, "entry.ts"),
    'export { default as styles } from "./button.module.css"\n',
  )

  const cssPlugin = gpuixCssModules()
  server = await createServer({
    appType: "custom",
    configFile: false,
    root: fixture,
    plugins: [cssPlugin],
  })

  const module = (await server.ssrLoadModule("/entry.ts")) as {
    styles: Record<string, unknown>
  }

  const style = module.styles.button as Record<symbol, unknown>

  expect(module.styles).toEqual({
    button: { color: "#ffffff", paddingTop: 16, paddingRight: 2, paddingBottom: 16, paddingLeft: 2 },
  })
  expect(style[Symbol.for("gpuix.compiledStyle")]).toBe(true)
  expect(Object.getOwnPropertyDescriptor(style, Symbol.for("gpuix.compiledStyle"))?.enumerable).toBe(
    false,
  )
})

test("Vite imports CSS modules through package imports like relative imports", async () => {
  fixture = await mkdtemp(path.join(os.tmpdir(), "gpuix-css-vite-imports-"))
  await writeFile(
    path.join(fixture, "package.json"),
    JSON.stringify({ imports: { "#styles/*": "./src/styles/*" } }),
  )
  await mkdir(path.join(fixture, "src/styles"), { recursive: true })
  const stylePackage = path.join(fixture, "node_modules/style-package")
  await mkdir(stylePackage, { recursive: true })
  await writeFile(
    path.join(stylePackage, "package.json"),
    JSON.stringify({ name: "style-package", exports: { "./card.module.css": "./card.module.css" } }),
  )
  const packageModule = path.join(stylePackage, "card.module.css")
  await writeFile(packageModule, ".card { display: flex; }\n")
  await writeFile(path.join(fixture, "src/styles/card.module.css"), ".card { display: flex; }\n")
  await writeFile(
    path.join(fixture, "entry.ts"),
    'import relative from "./src/styles/card.module.css"\nimport queried from "./src/styles/card.module.css?used"\nimport aliased from "#styles/card.module.css"\nimport exported from "style-package/card.module.css"\nexport default { relative: relative.card, queried: queried.card, aliased: aliased.card, exported: exported.card }\n',
  )

  const cssPlugin = gpuixCssModules()
  let packageHotUpdate: { file: string; modules: string[]; virtualModules: string[] } | undefined
  const handleHotUpdate = cssPlugin.handleHotUpdate
  if (handleHotUpdate) {
    cssPlugin.handleHotUpdate = async function (context) {
      const modules = await handleHotUpdate.call(this, context)
      if (context.file.includes("style-package")) {
        packageHotUpdate = {
          file: context.file,
          modules: modules?.map((module) => module.id) ?? [],
          virtualModules: [...context.server.moduleGraph.idToModuleMap.keys()].filter((id) =>
            id.startsWith("\0gpuix:css-module:"),
          ),
        }
      }
      return modules
    }
  }
  server = await createServer({
    appType: "custom",
    configFile: false,
    root: fixture,
    plugins: [cssPlugin],
  })
  await server.listen()
  const loaded = (await server.ssrLoadModule("/entry.ts")).default as Record<string, unknown>
  expect(loaded.aliased).toEqual(loaded.relative)
  expect(loaded.queried).toEqual(loaded.relative)
  expect(loaded.exported).toEqual({ display: "flex" })
  expect(Object.getOwnPropertySymbols(loaded.exported as object)).toContain(
    Symbol.for("gpuix.compiledStyle"),
  )
  expect(Object.getOwnPropertySymbols(loaded.aliased as object)).toContain(
    Symbol.for("gpuix.compiledStyle"),
  )
  const source = path.join(fixture, "src/styles/card.module.css")
  await writeFile(source, ".card { display: block; }\n")
  server.watcher.emit("change", realpathSync(source))
  let updated: Record<string, unknown> | undefined
  let deadline = Date.now() + 3_000
  while (Date.now() < deadline) {
    updated = (await server.ssrLoadModule("/entry.ts")).default as Record<string, unknown>
    if (JSON.stringify(updated.relative) === JSON.stringify({ display: "block" })) break
    await new Promise((resolve) => setTimeout(resolve, 30))
  }
  expect(updated?.relative).toEqual({ display: "block" })
  expect(updated?.aliased).toEqual(updated?.relative)

  await writeFile(packageModule, ".card { display: grid; }\n")
  server.watcher.emit("change", realpathSync(packageModule))
  deadline = Date.now() + 3_000
  while (Date.now() < deadline) {
    updated = (await server.ssrLoadModule("/entry.ts")).default as Record<string, unknown>
    if (JSON.stringify(updated.exported) === JSON.stringify({ display: "grid" })) break
    await new Promise((resolve) => setTimeout(resolve, 30))
  }
  expect(updated?.exported, JSON.stringify(packageHotUpdate)).toEqual({ display: "grid" })
})

test("Vitest imports CSS modules through package imports like relative imports", async () => {
  fixture = await mkdtemp(path.join(path.dirname(fileURLToPath(import.meta.url)), ".css-vitest-imports-"))
  await mkdir(path.join(fixture, "src/styles"), { recursive: true })
  await writeFile(
    path.join(fixture, "package.json"),
    JSON.stringify({ imports: { "#styles/*": "./src/styles/*" } }),
  )
  await writeFile(path.join(fixture, "src/styles/card.module.css"), ".card { color: blue; }\n")
  const stylePackage = path.join(fixture, "node_modules/style-package")
  await mkdir(stylePackage, { recursive: true })
  await writeFile(
    path.join(stylePackage, "package.json"),
    JSON.stringify({ name: "style-package", exports: { "./card.module.css": "./card.module.css" } }),
  )
  await writeFile(path.join(stylePackage, "card.module.css"), ".card { color: green; }\n")
  await writeFile(
    path.join(fixture, "entry.test.ts"),
    'import { expect, test } from "vitest"\nimport relative from "./src/styles/card.module.css"\nimport aliased from "#styles/card.module.css"\nimport exported from "style-package/card.module.css"\ntest("uses the compiled style", () => { expect(aliased.card).toEqual(relative.card); expect(exported.card).toEqual({ color: "green" }); expect(Object.getOwnPropertySymbols(aliased.card)).toContain(Symbol.for("gpuix.compiledStyle")); expect(Object.getOwnPropertySymbols(exported.card)).toContain(Symbol.for("gpuix.compiledStyle")) })\n',
  )
  const cssPlugin = pathToFileURL(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "css.ts")).href
  await writeFile(
    path.join(fixture, "vitest.config.mts"),
    `import { gpuixCssModules } from ${JSON.stringify(cssPlugin)}\nexport default { plugins: [gpuixCssModules()], test: { include: ["entry.test.ts"] } }\n`,
  )

  const vitest = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../react/node_modules/.bin/vitest",
  )
  const result = Bun.spawnSync([vitest, "run", "--config", path.join(fixture, "vitest.config.mts")], {
    cwd: fixture,
    stdout: "pipe",
    stderr: "pipe",
  })
  expect(result.exitCode, `${result.stdout.toString()}\n${result.stderr.toString()}`).toBe(0)
}, 30_000)

test("resolves and watches a composed CSS module in Vite", async () => {
  fixture = await mkdtemp(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "css-vite-composes-"),
  )
  const tile = path.join(fixture, "tile.module.css")
  await writeFile(
    tile,
    ".plate { color: white; &:hover { color: silver; } }\n",
  )
  await writeFile(
    path.join(fixture, "button.module.css"),
    '.button { composes: plate from "./tile.module.css"; background-color: black; &:hover { background-color: navy; } }\n',
  )
  await writeFile(
    path.join(fixture, "entry.ts"),
    'import styles from "./button.module.css"\nexport default styles.button\n',
  )

  server = await createServer({
    appType: "custom",
    configFile: false,
    root: fixture,
    plugins: [gpuixCssModules()],
  })
  const loaded = (await server.ssrLoadModule("/entry.ts")) as {
    default: Record<string, unknown>
  }

  expect(loaded.default).toEqual({
    color: "white",
    backgroundColor: "black",
    hover: { color: "silver", backgroundColor: "navy" },
  })
  const watched = Object.entries(server.watcher.getWatched()).some(
    ([directory, files]) => path.resolve(directory) === fixture && files.includes("tile.module.css"),
  )
  expect(watched).toBe(true)

  await writeFile(tile, ".plate { color: silver; &:hover { color: gray; } }\n")
  server.watcher.emit("change", realpathSync(tile))
  const deadline = Date.now() + 3_000
  let updated: Record<string, unknown> | undefined
  while (Date.now() < deadline) {
    updated = (await server.ssrLoadModule("/entry.ts")).default as Record<string, unknown>
    if (
      updated.color === "silver" &&
      (updated.hover as Record<string, unknown>).color === "gray"
    ) {
      break
    }
    await new Promise((resolve) => setTimeout(resolve, 30))
  }
  expect(updated?.color).toBe("silver")
  expect(updated?.backgroundColor).toBe("black")
  expect((updated?.hover as Record<string, unknown>).color).toBe("gray")
  expect((updated?.hover as Record<string, unknown>).backgroundColor).toBe("navy")
})

test("resolves a Bun import against its importer", async () => {
  // A POSIX-style literal like "/app/main.tsx" is not a genuine absolute path
  // on Windows (no drive letter), so `path.resolve` would resolve it against
  // the current drive instead of treating it as already absolute.
  const importer = path.join(path.dirname(fileURLToPath(import.meta.url)), "main.tsx")
  const id = await resolveCssModule({}, "./button.module.css", importer, "bun")

  expect(id).toBe(cssModuleId(path.join(path.dirname(importer), "button.module.css")))
})

test("compiles a virtual module id and watches its source", async () => {
  fixture = await mkdtemp(path.join(path.dirname(fileURLToPath(import.meta.url)), ".css-load-"))
  const source = path.join(fixture, "card.module.css")
  await writeFile(source, ".card { display: flex; }\n")

  const watched: string[] = []
  const id = (await resolveCssModule({}, source, undefined, "bun")) as string
  const result = await loadCssModule({ addWatchFile: (file: string) => watched.push(file) }, id)

  expect(result.code).toContain('Symbol.for("gpuix.compiledStyle")')
  expect(result.code).toContain("export default styles")
  expect(watched).toEqual([source])
})

test("compiles under Node's CommonJS interop, not only Bun's", () => {
  // A Vitest run loads the transform through Node, which hands back the module
  // namespace where Bun hands back the function itself.
  const dist = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "dist",
    "css-modules.js",
  )
  if (!existsSync(dist)) throw new Error("run `bun run build` before this test")

  const result = Bun.spawnSync([
    "node",
    "--input-type=module",
    "-e",
    `const { transformGpuixCssModule } = await import(${JSON.stringify(pathToFileURL(dist).href)})
process.stdout.write(JSON.stringify(await transformGpuixCssModule(".card { display: flex; }", "card.module.css")))`,
  ])

  expect(result.stderr.toString()).toBe("")
  expect(result.stdout.toString()).toBe('{"card":{"display":"flex"}}')
})

test("compiles CSS modules for Bun's bundler, which otherwise emits class names", async () => {
  fixture = await mkdtemp(path.join(path.dirname(fileURLToPath(import.meta.url)), ".css-bun-"))
  await writeFile(path.join(fixture, "card.module.css"), ".card { display: flex; }\n")
  await writeFile(
    path.join(fixture, "entry.ts"),
    'import styles from "./card.module.css"\nconsole.log(JSON.stringify(styles))\n',
  )

  const build = async (plugins: Parameters<typeof Bun.build>[0]["plugins"]) => {
    const result = await Bun.build({
      entrypoints: [path.join(fixture as string, "entry.ts")],
      target: "bun",
      plugins,
    })
    if (!result.success) throw new AggregateError(result.logs, "Bun build failed")
    return result.outputs[0].text()
  }

  expect(await build([gpuixCssModulesBun()])).toMatch(/card:\s*\{\s*display:\s*"flex"\s*\}/)
  // Bun's own CSS modules name the class instead, which the renderer cannot use.
  expect(await build([])).toMatch(/card:\s*"card_/)
})

test("Bun.build imports package CSS modules like relative imports", async () => {
  fixture = await mkdtemp(path.join(path.dirname(fileURLToPath(import.meta.url)), ".css-bun-imports-"))
  await mkdir(path.join(fixture, "src/styles"), { recursive: true })
  await mkdir(path.join(fixture, "src/bun"), { recursive: true })
  await writeFile(
    path.join(fixture, "package.json"),
    JSON.stringify({ imports: { "#styles/*": { bun: "./src/bun/*", default: "./src/styles/*" } } }),
  )
  await writeFile(path.join(fixture, "src/styles/card.module.css"), ".card { color: blue; }\n")
  await writeFile(path.join(fixture, "src/bun/card.module.css"), ".card { color: red; }\n")
  const stylePackage = path.join(fixture, "node_modules/style-package")
  await mkdir(stylePackage, { recursive: true })
  await writeFile(
    path.join(stylePackage, "package.json"),
    JSON.stringify({ name: "style-package", exports: { "./card.module.css": "./card.module.css" } }),
  )
  await writeFile(path.join(stylePackage, "card.module.css"), ".card { color: green; }\n")
  await writeFile(
    path.join(fixture, "entry.ts"),
    'import relative from "./src/bun/card.module.css"\nimport aliased from "#styles/card.module.css"\nimport exported from "style-package/card.module.css"\nif (JSON.stringify(relative.card) !== JSON.stringify(aliased.card)) throw new Error("CSS imports differ")\nconsole.log(JSON.stringify({ relative: relative.card, aliased: aliased.card, exported: exported.card }))\n',
  )

  const result = await Bun.build({
    entrypoints: [path.join(fixture, "entry.ts")],
    target: "bun",
    plugins: [gpuixCssModulesBun()],
  })
  expect(result.success, result.logs.map(String).join("\n")).toBe(true)
  const outputFile = path.join(fixture, "entry-built.js")
  await writeFile(outputFile, await result.outputs[0]!.text())
  const output = Bun.spawnSync([process.execPath, outputFile], { stdout: "pipe", stderr: "pipe" })
  expect(output.exitCode, output.stderr.toString()).toBe(0)
  expect(JSON.parse(output.stdout.toString())).toEqual({
    relative: { color: "red" },
    aliased: { color: "red" },
    exported: { color: "green" },
  })
})

test("resolves composed CSS modules in Bun.build()", async () => {
  fixture = await mkdtemp(path.join(path.dirname(fileURLToPath(import.meta.url)), ".css-bun-composes-"))
  await writeFile(path.join(fixture, "tile.module.css"), ".plate { color: white; }\n")
  await writeFile(
    path.join(fixture, "button.module.css"),
    '.button { composes: plate from "./tile.module.css"; background-color: black; }\n',
  )
  await writeFile(
    path.join(fixture, "entry.ts"),
    'import styles from "./button.module.css"\nconsole.log(JSON.stringify(styles.button))\n',
  )

  const result = await Bun.build({
    entrypoints: [path.join(fixture, "entry.ts")],
    target: "bun",
    plugins: [gpuixCssModulesBun()],
  })
  expect(result.success, result.logs.map(String).join("\n")).toBe(true)
  const output = await result.outputs[0]?.text()
  expect(output).toContain('color: "white"')
  expect(output).toContain('backgroundColor: "black"')
})
