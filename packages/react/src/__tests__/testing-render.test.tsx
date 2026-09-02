import React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  cleanup,
  isNativeTestRendererAvailable,
  render,
  textContent,
  type TestRenderer,
} from "../testing.js"

const describeNative = isNativeTestRendererAvailable() ? describe : describe.skip

const mounts: string[] = []

function Counter({ label = "a" }: { label?: string }): React.ReactElement {
  const [count, setCount] = React.useState(0)
  React.useEffect(() => {
    mounts.push(label)
  }, [label])
  return (
    <div>
      <div
        data-testid="bump"
        role="button"
        ariaLabel="Bump"
        style={{ width: 120, height: 40 }}
        onClick={() => setCount(count + 1)}
      />
      <text data-testid="count">{`count ${count}`}</text>
    </div>
  )
}

function Boom(): React.ReactElement {
  throw new Error("render exploded")
}

describeNative("render", () => {
  // This suite imports the framework-free entry, so it owns its own cleanup.
  afterEach(() => {
    cleanup()
  })

  it("returns working queries and userEvent bound to the rendered node", async () => {
    const screen = render(<Counter />)

    expect(textContent(screen.renderer, screen.getByTestId("count"))).toBe("count 0")
    await screen.userEvent.click(screen.getByRole("button", { name: "Bump" }))
    expect(textContent(screen.renderer, screen.getByTestId("count"))).toBe("count 1")
  })

  it("rerenders in place, keeping the same renderer and window", () => {
    const screen = render(<text data-testid="label">before</text>)
    const { renderer } = screen

    screen.rerender(<text data-testid="label">after</text>)

    expect(screen.renderer).toBe(renderer)
    expect(textContent(renderer, screen.getByTestId("label"))).toBe("after")
  })

  it("shares one window across sequential render() calls in a file", () => {
    const first = render(<text data-testid="first">first</text>)
    const renderer = first.renderer

    const second = render(<text data-testid="second">second</text>)

    expect(second.renderer).toBe(renderer)
    // The second render replaces the tree rather than mounting beside it.
    expect(second.queryByTestId("first")).toBeNull()
    expect(textContent(renderer, second.getByTestId("second"))).toBe("second")
  })

  it("mounts a fresh tree instead of reconciling against the last one", async () => {
    mounts.length = 0
    const first = render(<Counter />)
    await first.userEvent.click(first.getByRole("button", { name: "Bump" }))
    expect(textContent(first.renderer, first.getByTestId("count"))).toBe("count 1")

    const second = render(<Counter label="b" />)

    // A reused window is not a reused tree: state is gone and the effect ran
    // again, as it would in a browser page that got a new container.
    expect(textContent(second.renderer, second.getByTestId("count"))).toBe("count 0")
    expect(mounts).toEqual(["a", "b"])
  })

  it("opens a fresh window when a root died on an uncaught render error", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      const dead = render(<Boom />)
      expect(dead.root.getStatus().status).toBe("failed")

      const live = render(<text data-testid="ok">ok</text>)

      expect(live.renderer).not.toBe(dead.renderer)
      expect(live.root.getStatus().status).toBe("active")
      expect(textContent(live.renderer, live.getByTestId("ok"))).toBe("ok")
    } finally {
      consoleError.mockRestore()
    }
  })

  it("opens a fresh window when the options differ from the live one", () => {
    const wide = render(<text>wide</text>, { width: 900, height: 600 })
    expect(wide.renderer.getWindowSize().width).toBe(900)

    const narrow = render(<text>narrow</text>, { width: 640, height: 480 })

    expect(narrow.renderer).not.toBe(wide.renderer)
    expect(narrow.renderer.getWindowSize().width).toBe(640)

    // Matching options reuse the window that is now live.
    const again = render(<text>again</text>, { width: 640, height: 480 })
    expect(again.renderer).toBe(narrow.renderer)
  })

  it("cleanup() unmounts the tree and keeps the window", () => {
    const screen = render(<text data-testid="kept">kept</text>)
    const renderer = screen.renderer

    cleanup()

    expect(renderer.getAllText()).toEqual([])
    expect(render(<text data-testid="next">next</text>).renderer).toBe(renderer)
  })

  it("unmount() removes the tree without closing the window", () => {
    const screen = render(<text data-testid="kept">kept</text>)

    screen.unmount()

    expect(screen.renderer.getAllText()).toEqual([])
    expect(render(<text>next</text>).renderer).toBe(screen.renderer)
  })

  it("resets focus, activation, the clock and the window size when it reuses the window", () => {
    const first = render(<div data-testid="focusable" tabIndex={0} role="button" ariaLabel="Focus target" />)
    const renderer: TestRenderer = first.renderer
    const size = renderer.getWindowSize()
    renderer.focusElement(first.getByTestId("focusable").id)
    renderer.nativeSimulateWindowActivation(true)
    renderer.simulateResize(700, 500)
    renderer.clockFastForward(60_000)
    expect(renderer.getActiveElement()).not.toBeNull()
    expect(renderer.isActive()).toBe(true)

    const second = render(<text data-testid="plain">plain</text>)

    expect(second.renderer).toBe(renderer)
    expect(renderer.getActiveElement()).toBeNull()
    expect(renderer.isActive()).toBe(false)
    expect(renderer.getWindowSize()).toEqual(size)
    // The clock is live again *and* re-anchored: a bare resume would have kept
    // the 60s offset as this test's baseline.
    expect(renderer.clockPause()).toBeLessThan(5_000)
  })
})
