import type { ReactNode } from "react"
import React from "react"
import { describe, expect, it, vi } from "vitest"
import { createRoot, flushSync } from "../reconciler/reconciler.js"
import type { NativeRenderer } from "../types/host.js"

function rendererStub(): NativeRenderer {
  return {
    applyBatch: vi.fn(() => []),
    setStrictStyles: vi.fn(),
  }
}

function captureStrictFailure(node: ReactNode): {
  thrown: unknown
  status: unknown
  diagnostics: unknown[]
  remainingDiagnostics: unknown[]
} {
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
  const renderer = rendererStub()
  const root = createRoot(renderer, { strictStyles: true })
  let thrown: unknown

  try {
    try {
      flushSync(() => root.render(node))
    } catch (error) {
      thrown = error
    }

    root.unmount()
    const getStatus = Reflect.get(root, "getStatus")
    const status =
      typeof getStatus === "function" ? Reflect.apply(getStatus, root, []) : undefined
    const drainDiagnostics = Reflect.get(renderer, "drainStyleDiagnostics")
    const diagnostics =
      typeof drainDiagnostics === "function"
        ? Reflect.apply(drainDiagnostics, renderer, [])
        : []
    const remainingDiagnostics =
      typeof drainDiagnostics === "function"
        ? Reflect.apply(drainDiagnostics, renderer, [])
        : []
    return {
      thrown,
      status,
      diagnostics,
      remainingDiagnostics,
    }
  } finally {
    root.unmount()
    consoleError.mockRestore()
  }
}

function expectFailedRoot(result: ReturnType<typeof captureStrictFailure>, message: string): void {
  expect(result.diagnostics).toEqual([
    {
      elementId: 0,
      elementType: "root",
      property: "status",
      value: '"failed"',
      message: expect.stringContaining(message),
    },
  ])
  expect(result.remainingDiagnostics).toEqual([])
  expect(result.status).toMatchObject({
    status: "failed",
    diagnostic: {
      elementId: 0,
      elementType: "root",
      property: "status",
      value: '"failed"',
      message: expect.stringContaining(message),
    },
  })
}

describe("root failure state", () => {
  it("exposes render-phase strict failures as dead-root diagnostics", () => {
    const cases = [
      {
        node: React.createElement("div", { accessibilityRole: "button" }),
        name: "UnsupportedAccessibilityRolePropError",
        message: "does not support accessibilityRole",
      },
      {
        node: React.createElement("text", {
          role: "heading",
          visuallyHidden: true,
          ariaHidden: true,
        } as never),
        name: "ContradictoryAccessibilityVisibilityError",
        message: "cannot combine visuallyHidden with ariaHidden=true",
      },
    ]

    for (const testCase of cases) {
      const result = captureStrictFailure(testCase.node)
      expect(result.thrown).toBeUndefined()
      expectFailedRoot(result, "React root is dead after an uncaught render error")
      expect(result.status).toMatchObject({
        status: "failed",
        error: {
          name: testCase.name,
          message: expect.stringContaining(testCase.message),
        },
      })
    }

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const renderer = rendererStub()
    const root = createRoot(renderer, { strictStyles: false })
    try {
      flushSync(() => {
        root.render(
          React.createElement("text", {
            role: "heading",
            visuallyHidden: true,
            ariaHidden: true,
          } as never)
        )
      })
      expect(warn).toHaveBeenCalledTimes(1)
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("cannot combine visuallyHidden with ariaHidden=true")
      )
    } finally {
      root.unmount()
      warn.mockRestore()
    }
  })

  it("exposes a commit-phase strict failure as a dead-root diagnostic", () => {
    const result = captureStrictFailure(
      React.createElement("div", { style: "banana" })
    )

    expect(result.thrown).toBeUndefined()
    expectFailedRoot(result, "React root is dead after an uncaught render error")
    expect(result.status).toMatchObject({
      status: "failed",
      error: {
        name: "InvalidStylePropError",
        message: expect.stringContaining("received an invalid style prop"),
      },
    })
  })
})
