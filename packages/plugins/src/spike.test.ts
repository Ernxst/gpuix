import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { createServer, type ViteDevServer } from "vite"
import { gpuix } from "./index.ts"
import { transformReactRefresh } from "./refresh.ts"

// The native fixture renders through TestRenderer, which only macOS and
// Windows builds include. Checking the platform rather than importing
// @gpuix/react/testing keeps the test process from loading GPUIX before Vite.
const nativeTest =
  process.platform === "darwin" || process.platform === "win32" ? test : test.skip

let server: ViteDevServer | undefined
let fixture: string | undefined

async function waitFor(check: () => boolean, description: string): Promise<void> {
  const deadline = Date.now() + 10_000
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${description}`)
    await Bun.sleep(20)
  }
}

function component(prefix: string): string {
  return `
import React, { useState } from "react"
import icon from "./icon.svg" with { type: "text" }
import styles from "./counter.module.css"

export function Counter({ label }: { label: string }) {
  const [count, setCount] = useState(0)
  Reflect.set(globalThis, "__gpuixViteClick", () => setCount((value) => value + 1))
  Reflect.set(globalThis, "__gpuixViteIcon", icon)
  Reflect.set(globalThis, "__gpuixViteStyle", styles.label)
  Reflect.set(globalThis, "__gpuixViteText", "${prefix} " + label + " " + count)
  return <text style={styles.label}>${prefix} {label} {count}</text>
}
`
}

function route(label: string): string {
  return `
import { Counter } from "./counter.tsx"

export const Route = { component: Screen }

export function Screen() {
  return <Counter label="${label}" />
}
`
}

const entry = `
import { render, resetRender } from "@gpuix/react"
import { TestRenderer } from "@gpuix/react/testing"
import { Route } from "./route.tsx"

const slot = globalThis as typeof globalThis & {
  __gpuixViteRenderer?: InstanceType<typeof TestRenderer>
  __gpuixViteFlushTimer?: ReturnType<typeof setInterval>
}
const renderer = slot.__gpuixViteRenderer ??= new TestRenderer()
render(<Route.component />, { renderer })
renderer.flush()
slot.__gpuixViteFlushTimer ??= setInterval(() => renderer.flush(), 10)
Reflect.set(globalThis, "__gpuixViteStop", () => {
  clearInterval(slot.__gpuixViteFlushTimer)
  Reflect.deleteProperty(slot, "__gpuixViteFlushTimer")
  resetRender()
  renderer.flush()
  renderer.dispose()
})
Reflect.set(globalThis, "__gpuixViteFlush", () => renderer.flush())
`

afterEach(async () => {
  const stop = Reflect.get(globalThis, "__gpuixViteStop") as (() => void) | undefined
  stop?.()
  Reflect.deleteProperty(globalThis, "__gpuixViteStop")
  Reflect.deleteProperty(globalThis, "__gpuixViteClick")
  Reflect.deleteProperty(globalThis, "__gpuixViteFlush")
  Reflect.deleteProperty(globalThis, "__gpuixViteIcon")
  Reflect.deleteProperty(globalThis, "__gpuixViteStyle")
  Reflect.deleteProperty(globalThis, "__gpuixViteText")
  await server?.close()
  server = undefined
  if (fixture) await rm(fixture, { recursive: true, force: true })
  fixture = undefined
})

test("offsets source maps for the injected Refresh preamble", () => {
  const result = transformReactRefresh(
    'export function Counter() { return <text style={{ color: "#fff" }}>counter</text> }',
    "/fixture/counter.tsx",
  )

  expect(result).toBeDefined()
  expect(result?.map).not.toBeNull()
  expect(result?.map?.mappings.startsWith(";".repeat(11))).toBe(true)
})

nativeTest("Vite refreshes a native component and remounts an invalidated route", async () => {
  fixture = await mkdtemp(path.join(path.dirname(fileURLToPath(import.meta.url)), ".vite-spike-"))
  await writeFile(path.join(fixture, "main.tsx"), entry)
  await writeFile(path.join(fixture, "counter.tsx"), component("before"))
  await writeFile(
    path.join(fixture, "counter.module.css"),
    `.label { color: #ffffff; font-size: 14px; padding: 1rem 2px; display: flex; }\n`,
  )
  await writeFile(path.join(fixture, "icon.svg"), '<svg xmlns="http://www.w3.org/2000/svg"/>\n')
  await writeFile(path.join(fixture, "route.tsx"), route("child"))

  server = await createServer({
    appType: "custom",
    configFile: false,
    root: fixture,
    plugins: [gpuix({ entry: "main.tsx" })],
  })

  await waitFor(
    () => Reflect.get(globalThis, "__gpuixViteText") === "before child 0",
    "the initial native render",
  )
  expect(Reflect.get(globalThis, "__gpuixViteIcon")).toBe(
    '<svg xmlns="http://www.w3.org/2000/svg"/>\n',
  )
  expect(Reflect.get(globalThis, "__gpuixViteStyle")).toEqual({
    color: "#ffffff",
    fontSize: 14,
    paddingTop: 16,
    paddingRight: 2,
    paddingBottom: 16,
    paddingLeft: 2,
    display: "flex",
  })
  const click = Reflect.get(globalThis, "__gpuixViteClick") as () => void
  click()
  const flush = Reflect.get(globalThis, "__gpuixViteFlush") as () => void
  flush()
  await waitFor(
    () => Reflect.get(globalThis, "__gpuixViteText") === "before child 1",
    "the state update before refresh",
  )

  await writeFile(path.join(fixture, "counter.tsx"), component("after"))
  await waitFor(
    () => Reflect.get(globalThis, "__gpuixViteText") === "after child 1",
    "the refreshed component with retained state",
  )

  await writeFile(
    path.join(fixture, "counter.module.css"),
    `.label { color: #00ff00; font-size: 16px; }\n`,
  )
  await waitFor(
    () =>
      (Reflect.get(globalThis, "__gpuixViteStyle") as { color?: string })?.color ===
      "#00ff00",
    "the refreshed native CSS module",
  )
  expect(Reflect.get(globalThis, "__gpuixViteStyle")).toEqual({
    color: "#00ff00",
    fontSize: 16,
  })

  await writeFile(path.join(fixture, "route.tsx"), route("next"))
  await waitFor(
    () => Reflect.get(globalThis, "__gpuixViteText") === "after next 0",
    "the remounted route after invalidation",
  )

  expect(Reflect.get(globalThis, "__gpuixViteText")).toBe("after next 0")
}, 15_000)
