import { afterEach, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
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

  server = await createServer({
    appType: "custom",
    configFile: false,
    root: fixture,
    plugins: [gpuixCssModules()],
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
