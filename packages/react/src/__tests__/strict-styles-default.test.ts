import { afterEach, describe, expect, it, vi } from "vitest"
import { createRoot, strictStylesDefault } from "../reconciler/reconciler.js"
import type { NativeRenderer } from "../types/host.js"

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe("strict style defaults", () => {
  it("uses compatibility mode in a standalone Bun executable", () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubGlobal("Bun", { isStandaloneExecutable: true })

    expect(strictStylesDefault()).toBe(false)
  })

  it("keeps the existing default in an interpreted Bun runtime", () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubGlobal("Bun", { isStandaloneExecutable: false })

    expect(strictStylesDefault()).toBe(true)
  })

  it("keeps the existing default when Bun is unavailable", () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubGlobal("Bun", undefined)

    expect(strictStylesDefault()).toBe(true)
  })

  it("uses compatibility mode when a browser bundle has no Node process", () => {
    vi.stubGlobal("process", undefined)

    expect(strictStylesDefault()).toBe(false)
  })

  it("uses compatibility mode in a production Node runtime", () => {
    vi.stubEnv("NODE_ENV", "production")

    expect(strictStylesDefault()).toBe(false)
  })

  it("lets strictStyles override the standalone and development defaults", () => {
    const standaloneRenderer = strictStylesRenderer()
    vi.stubGlobal("Bun", { isStandaloneExecutable: true })
    const standaloneRoot = createRoot(standaloneRenderer, { strictStyles: true })

    expect(standaloneRenderer.setStrictStyles).toHaveBeenCalledWith(true)
    standaloneRoot.unmount()

    const developmentRenderer = strictStylesRenderer()
    vi.stubEnv("NODE_ENV", "development")
    vi.stubGlobal("Bun", { isStandaloneExecutable: false })
    const developmentRoot = createRoot(developmentRenderer, { strictStyles: false })

    expect(developmentRenderer.setStrictStyles).toHaveBeenCalledWith(false)
    developmentRoot.unmount()
  })
})

function strictStylesRenderer(): NativeRenderer & { setStrictStyles: ReturnType<typeof vi.fn> } {
  return {
    commitMutations: vi.fn(),
    setStrictStyles: vi.fn(),
  } as NativeRenderer & { setStrictStyles: ReturnType<typeof vi.fn> }
}
