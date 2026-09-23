import { describe, expect, it } from "vitest"
import { unresolvedClassNames } from "../class-names.js"
import { cn } from "../cn.js"
import type { StyleDesc } from "../types/host.js"

/**
 * A `.module.css` import is typed as the class name a web build produces, so a
 * shared component calls `cn` with strings whatever the build. This is the
 * value a GPUIX build actually passes.
 */
function asClassNames(...inputs: (StyleDesc | string)[]): string[] {
  return inputs as unknown as string[]
}

describe("cn", () => {
  it("merges class names the way a web build needs them", () => {
    expect(cn("px-4", false, "text-sm", undefined)).toBe("px-4 text-sm")
  })

  it("resolves Tailwind conflicts, as the cn package it re-exports does", () => {
    expect(cn("p-2", "p-4")).toBe("p-4")
  })

  it("merges compiled styles with the later value winning", () => {
    const base: StyleDesc = { color: "red", padding: 4 }
    const active: StyleDesc = { color: "blue" }

    expect(cn(base, active)).toEqual({ color: "blue", padding: 4 })
    expect(cn(base, false && active)).toEqual({ color: "red", padding: 4 })
  })

  it("leaves its inputs untouched", () => {
    const base: StyleDesc = { color: "red" }
    cn(base, { color: "blue" })

    expect(base).toEqual({ color: "red" })
  })

  it("carries class names it cannot compile, without serialising them", () => {
    const merged = cn(...asClassNames({ color: "red" }, "rounded-lg", "px-4"))

    expect(merged).toEqual({ color: "red" })
    expect(Object.keys(merged as unknown as object)).toEqual(["color"])
    expect(JSON.stringify(merged)).toBe('{"color":"red"}')
    expect(unresolvedClassNames(merged as unknown as object)).toEqual(["rounded-lg", "px-4"])
  })

  it("keeps carried class names through a nested call", () => {
    const inner = cn(...asClassNames({ color: "red" }, "rounded-lg"))
    const merged = cn(...asClassNames(inner as unknown as StyleDesc, { padding: 4 }))

    expect(merged).toEqual({ color: "red", padding: 4 })
    expect(unresolvedClassNames(merged as unknown as object)).toEqual(["rounded-lg"])
  })

  it("has nothing to report when every input compiled", () => {
    expect(unresolvedClassNames(cn({ color: "red" }, { padding: 4 }))).toBeUndefined()
  })
})
