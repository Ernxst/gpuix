import { afterEach, describe, expect, it, vi } from "vitest"
import { strictStylesDefault } from "../reconciler/reconciler.js"

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe("strict style defaults", () => {
  it("uses compatibility mode when a browser bundle has no Node process", () => {
    vi.stubGlobal("process", undefined)

    expect(strictStylesDefault()).toBe(false)
  })

  it("uses compatibility mode in a production Node runtime", () => {
    vi.stubEnv("NODE_ENV", "production")

    expect(strictStylesDefault()).toBe(false)
  })
})
