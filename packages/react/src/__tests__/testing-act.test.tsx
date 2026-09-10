/** The exported `act`: Testing Library's contract over this renderer, without
 *  going through `render()`. */

import React, { useEffect, useState } from "react"
import { describe, expect, it, vi } from "vitest"
import { act, createTestRoot, isNativeTestRendererAvailable } from "../testing.js"
import { gpuixMatchers, type GpuixMatchers } from "../testing-expect.js"

expect.extend(gpuixMatchers)

declare module "vitest" {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  interface Matchers<T = any> extends GpuixMatchers<T> {}
}

const describeNative = isNativeTestRendererAvailable() ? describe : describe.skip

const ACT_ENVIRONMENT_GLOBAL = "IS_REACT_ACT_ENVIRONMENT"

describeNative("act()", () => {
  it("commits state and flushes effects, with no act warning, and needs no await for a sync scope", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
    const screen = createTestRoot()
    const setCountRef: { current: ((value: number) => void) | null } = { current: null }

    function Counter(): React.ReactElement {
      const [count, setCount] = useState(0)
      const [doubled, setDoubled] = useState(0)
      setCountRef.current = setCount
      // A passive effect derived from the state `act` sets below: committed
      // state alone would not prove effects were flushed too.
      useEffect(() => {
        setDoubled(count * 2)
      }, [count])
      return <text data-testid="count">{`${count}:${doubled}`}</text>
    }

    try {
      screen.render(<Counter />)
      expect(screen.getByTestId("count")).toHaveTextContent("0:0")

      // Not awaited: a synchronous scope has already committed and flushed
      // its effects by the time `act` returns.
      act(() => {
        setCountRef.current?.(1)
      })

      expect(screen.getByTestId("count")).toHaveTextContent("1:2")
      for (const call of consoleError.mock.calls) {
        expect(String(call[0])).not.toContain("not wrapped in act")
        expect(String(call[0])).not.toContain("not configured to support act")
      }
    } finally {
      screen.unmount()
      consoleError.mockRestore()
    }
  })

  it("restores IS_REACT_ACT_ENVIRONMENT after a throwing callback and after an async callback", async () => {
    const previous = Reflect.get(globalThis, ACT_ENVIRONMENT_GLOBAL)

    // A synchronous scope's throw is rethrown synchronously, the same tick —
    // `act` never leaves it as a dangling rejection nobody awaited.
    expect(() =>
      act(() => {
        throw new Error("boom")
      })
    ).toThrow("boom")
    expect(Reflect.get(globalThis, ACT_ENVIRONMENT_GLOBAL)).toBe(previous)

    // An async scope's throw surfaces as a rejection instead, once React has
    // finished draining whatever it scheduled before the rejection.
    await expect(
      act(async () => {
        await Promise.resolve()
        throw new Error("async boom")
      })
    ).rejects.toThrow("async boom")
    expect(Reflect.get(globalThis, ACT_ENVIRONMENT_GLOBAL)).toBe(previous)

    let ranAsyncWork = false
    await act(async () => {
      await Promise.resolve()
      ranAsyncWork = true
    })
    expect(ranAsyncWork).toBe(true)
    expect(Reflect.get(globalThis, ACT_ENVIRONMENT_GLOBAL)).toBe(previous)
  })

  it("rethrows a React-collected error when only a createTestRoot() root is mounted", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
    const screen = createTestRoot()
    const triggerRef: { current: (() => void) | null } = { current: null }

    function Boom({ shouldThrow }: { shouldThrow: boolean }): React.ReactElement | null {
      if (shouldThrow) throw new Error("render boom")
      return null
    }

    function Wrapper(): React.ReactElement {
      const [shouldThrow, setShouldThrow] = useState(false)
      triggerRef.current = () => setShouldThrow(true)
      return <Boom shouldThrow={shouldThrow} />
    }

    try {
      screen.render(<Wrapper />)

      // `act`'s own scope only calls `setShouldThrow` — it does not itself
      // throw. `Boom` throwing during the render that schedules is React's
      // uncaught path, which `act` would otherwise route to the `render()`
      // root. No such root is mounted here — this is a `createTestRoot()`
      // root, not `render()`'s — so `act` rethrows instead.
      expect(() => {
        act(() => {
          triggerRef.current?.()
        })
      }).toThrow("render boom")
    } finally {
      consoleError.mockRestore()
    }
  })
})
