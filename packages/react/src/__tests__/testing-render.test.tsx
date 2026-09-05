import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"

import React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  cleanup,
  isNativeTestRendererAvailable,
  render,
  textContent,
  type TestRenderer,
} from "../testing.js"
import { gpuixMatchers, type GpuixMatchers } from "../testing-expect.js"
import { readPngSize } from "../testing-png.js"

expect.extend(gpuixMatchers)

declare module "vitest" {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  interface Matchers<T = any> extends GpuixMatchers<T> {}
}

const describeNative = isNativeTestRendererAvailable() ? describe : describe.skip

const TILE_WIDTH = 160
const TILE_HEIGHT = 90

/** Decorative and textless: exactly the tree no query can reach. */
function Decoration({ color = "#ff0000" }: { color?: string }): React.ReactElement {
  return (
    <div
      ariaHidden
      style={{ width: TILE_WIDTH, height: TILE_HEIGHT, backgroundColor: color }}
    />
  )
}

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

const registrationCleanups: string[] = []

/** A child that only announces itself through an effect, the way a portal
 *  registers with its outlet. It renders nothing; the label reaches the screen
 *  through the state its effect sets on the parent. */
function Registrar({
  label,
  register,
}: {
  label: string
  register: (label: string | null) => void
}): null {
  React.useEffect(() => {
    register(label)
    return () => {
      register(null)
      registrationCleanups.push(label)
    }
  }, [label, register])
  return null
}

function Outlet({ label }: { label: string }): React.ReactElement {
  const [registered, setRegistered] = React.useState<string | null>(null)
  const register = React.useCallback((next: string | null) => {
    setRegistered(next)
  }, [])
  return (
    <div>
      <Registrar label={label} register={register} />
      <text data-testid="outlet">{registered ?? "empty"}</text>
    </div>
  )
}

/** A component whose re-render throws, so the error surfaces from an event
 *  dispatch rather than from `render`. */
function ExplodeOnClick(): React.ReactElement {
  const [exploded, setExploded] = React.useState(false)
  if (exploded) throw new Error("click exploded")
  return (
    <div
      data-testid="detonate"
      role="button"
      ariaLabel="Detonate"
      style={{ width: 120, height: 40 }}
      onClick={() => setExploded(true)}
    />
  )
}

/** React expects a caller opening its own `act` scope to have declared the
 *  environment, which a Testing Library setup does globally. Scoped here,
 *  because the rest of this file drives React through `render`. */
function withActEnvironment(scope: () => void): void {
  const previous = Reflect.get(globalThis, "IS_REACT_ACT_ENVIRONMENT")
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true)
  try {
    scope()
  } finally {
    Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", previous)
  }
}

/** A click whose result only appears once the effect the click's state change
 *  scheduled has run and set state of its own. */
function ConfirmOnClick(): React.ReactElement {
  const [clicks, setClicks] = React.useState(0)
  const [confirmed, setConfirmed] = React.useState<string | null>(null)
  React.useEffect(() => {
    if (clicks === 0) return
    setConfirmed(`confirmed ${clicks}`)
  }, [clicks])
  return (
    <div>
      <div
        data-testid="press"
        role="button"
        ariaLabel="Press"
        style={{ width: 120, height: 40 }}
        onClick={() => setClicks((count) => count + 1)}
      />
      <text data-testid="confirmed">{confirmed ?? "idle"}</text>
    </div>
  )
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

  it("flushes passive effects before render, rerender and unmount return", () => {
    registrationCleanups.length = 0

    const screen = render(<Outlet label="LEGEND" />)

    // Synchronously on screen: no findBy*, no waitFor, no clock.
    expect(screen.getByText("LEGEND")).not.toBeNull()
    expect(textContent(screen.renderer, screen.getByTestId("outlet"))).toBe("LEGEND")

    screen.rerender(<Outlet label="SECOND" />)

    expect(screen.getByText("SECOND")).not.toBeNull()
    // Changing the effect's dependency ran the old registration's cleanup.
    expect(registrationCleanups).toEqual(["LEGEND"])

    screen.unmount()

    expect(registrationCleanups).toEqual(["LEGEND", "SECOND"])
  })

  it("flushes passive effects before a dispatched event returns", async () => {
    const screen = render(<ConfirmOnClick />)

    expect(textContent(screen.renderer, screen.getByTestId("confirmed"))).toBe("idle")

    await screen.userEvent.click(screen.getByRole("button", { name: "Press" }))

    // The click set state, that state's effect set more, and both are on screen
    // — no findBy*, no waitFor, no clock.
    expect(screen.getByText("confirmed 1")).not.toBeNull()
    expect(textContent(screen.renderer, screen.getByTestId("confirmed"))).toBe("confirmed 1")

    await screen.userEvent.click(screen.getByRole("button", { name: "Press" }))

    expect(textContent(screen.renderer, screen.getByTestId("confirmed"))).toBe("confirmed 2")
  })

  it("hands an event's uncaught render error back to the root, not the caller", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      const screen = render(<ExplodeOnClick />)

      // `act` collects React's uncaught errors and rethrows them at whoever
      // called it. The dispatch puts them back where React would have: the
      // root reads as dead, and the click itself does not throw.
      await screen.userEvent.click(screen.getByRole("button", { name: "Detonate" }))

      expect(screen.root.getStatus().status).toBe("failed")
    } finally {
      consoleError.mockRestore()
    }
  })

  it("commits and unmounts inside a caller's own act scope, which owns the queue", () => {
    // React keeps one act queue and leaves it to the outermost scope to drain,
    // so nesting `act` here would commit nothing before returning. These calls
    // fall back to a synchronous flush instead.
    const textAfterRender: string[][] = []
    const textAfterUnmount: string[][] = []

    withActEnvironment(() => {
      void React.act(() => {
        const screen = render(<text data-testid="nested">nested</text>)
        textAfterRender.push(screen.renderer.getAllText())
        screen.unmount()
        textAfterUnmount.push(screen.renderer.getAllText())
      })
    })

    expect(textAfterRender[0]).toEqual(["nested"])
    expect(textAfterUnmount[0]).toEqual([])
  })

  it("leaves effect-scheduled work to the caller's act scope to drain", () => {
    registrationCleanups.length = 0
    let screen: ReturnType<typeof render> | undefined

    withActEnvironment(() => {
      void React.act(() => {
        screen = render(<Outlet label="NESTED" />)
      })
    })

    // Painting is the frame loop's job, and no `render()` ran after the
    // caller's scope drained its queue.
    screen!.renderer.flush()
    expect(textContent(screen!.renderer, screen!.getByTestId("outlet"))).toBe("NESTED")
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

  // Testing Library's two mount handles. The golden the screenshot test needs
  // is written into a temporary directory and thrown away: the assertion is
  // about which box the matcher captured, not about particular pixels.
  describe("container and baseElement", () => {
    it("mounts the tree as the container's children, inside the base element", () => {
      const screen = render(<text data-testid="leaf">hello</text>)

      const { container, baseElement } = screen
      expect(container.children.map((child) => child.type)).toEqual(["text"])
      expect(container.parentElement).toEqual(baseElement)
      expect(baseElement.parentElement).toBeNull()
      // The bound queries search the base element, so the mounted tree is under
      // both handles and neither handle is the rendered node itself.
      expect(screen.getByTestId("leaf").parentElement).toEqual(container)
    })

    it("scopes queries when passed to within()", () => {
      const screen = render(
        <div>
          <text data-testid="inside">scoped</text>
        </div>
      )

      expect(screen.within(screen.container).getByText("scoped")).toEqual(
        screen.getByText("scoped")
      )
      expect(screen.within(screen.container).getByTestId("inside")).toEqual(
        screen.getByTestId("inside")
      )
    })

    it("is a TestElement every matcher and box read accepts", () => {
      const screen = render(<Decoration />)

      expect(screen.container).toBeInTheDocument()
      expect(screen.container).toBeVisible()
      // The base element is the window's own box: `document.body`'s analogue.
      const window = screen.renderer.getWindowSize()
      expect(screen.baseElement.getBoundingClientRect()).toMatchObject({
        x: 0,
        y: 0,
        width: window.width,
        height: window.height,
      })
      // The container is the DOM's block box: the base element's width, and the
      // height of the tree inside it.
      expect(screen.container.getBoundingClientRect()).toMatchObject({
        x: 0,
        y: 0,
        width: window.width,
        height: TILE_HEIGHT,
      })
    })

    it("resolves a top-level percentage height against the container, not the window", () => {
      // Breaking, and the DOM's own answer: the container's height comes from
      // the tree, so a percentage of it resolves against auto and measures
      // nothing. Size the window, or give the tree an explicit height.
      const screen = render(<div data-testid="filler" style={{ height: "100%" }} />)

      expect(screen.getByTestId("filler").getBoundingClientRect()).toMatchObject({
        y: 0,
        height: 0,
      })
      expect(screen.container.getBoundingClientRect()).toMatchObject({ height: 0 })

      // `flexGrow` has nothing to grow into for the same reason.
      screen.rerender(<div data-testid="filler" style={{ flexGrow: 1 }} />)
      expect(screen.getByTestId("filler").getBoundingClientRect()).toMatchObject({
        height: 0,
      })

      // An explicit height is unaffected, and so is a window-sized tree.
      screen.rerender(<div data-testid="filler" style={{ height: 120 }} />)
      expect(screen.getByTestId("filler").getBoundingClientRect()).toMatchObject({
        height: 120,
      })
    })

    it("mounts every child of a top-level fragment", () => {
      // The window has one root, so before there was a container to append
      // into each top-level child overwrote the last and only one survived.
      const screen = render(
        <>
          <text data-testid="first">first</text>
          <text data-testid="second">second</text>
        </>
      )

      expect(screen.container.children).toHaveLength(2)
      expect(textContent(screen.renderer, screen.getByTestId("first"))).toBe("first")
      expect(textContent(screen.renderer, screen.getByTestId("second"))).toBe("second")
    })

    it("leaves the container mounted and empty after unmount", () => {
      const screen = render(
        <div data-testid="tree">
          <Decoration />
        </div>
      )
      const containerId = screen.container.id
      const tree = screen.getByTestId("tree")

      screen.unmount()

      // Testing Library's `unmount` empties its container and leaves it in the
      // page. Both handles are still the same mounted elements.
      expect(screen.container.id).toBe(containerId)
      expect(screen.container).toBeInTheDocument()
      expect(screen.baseElement).toBeInTheDocument()
      expect(screen.container).toBeEmptyDOMElement()
      // What went is the tree that was inside it.
      expect(tree).not.toBeInTheDocument()
    })

    it("takes both handles out of the window on cleanup", () => {
      const screen = render(<Decoration />)
      const containerId = screen.container.id

      // `cleanup()` is the between-tests teardown, not `unmount`: this is what
      // the vitest entry's afterEach and the next render()'s window reuse do.
      cleanup()

      expect(screen.container.id).toBe(containerId)
      expect(screen.container).not.toBeInTheDocument()
      expect(screen.baseElement).not.toBeInTheDocument()
    })

    it("runs unmount effects before returning, with the container still mounted", () => {
      registrationCleanups.length = 0
      const screen = render(<Outlet label="HANDLE" />)

      screen.unmount()

      // #332's guarantee survives the split: the empty container is rendered
      // inside the same act scope, so the cleanup has run before this returns.
      expect(registrationCleanups).toEqual(["HANDLE"])
      expect(screen.container).toBeEmptyDOMElement()
    })

    it("wraps the render inherited from createTestRoot()", () => {
      const screen = render(<text data-testid="first">first</text>)

      // Not `rerender`: the `render` every TestRoot carries must mount through
      // the same wrappers, or the container would point inside the tree.
      screen.render(<text data-testid="second">second</text>)

      expect(screen.container.children.map((child) => child.type)).toEqual(["text"])
      expect(screen.getByTestId("second").parentElement).toEqual(screen.container)
    })

    it("keeps both handles pointing at the live elements across rerender", () => {
      const screen = render(<Decoration color="#ff0000" />)
      const container = screen.container
      const baseElement = screen.baseElement

      screen.rerender(
        <div>
          <Decoration color="#0000ff" />
          <text data-testid="added">added</text>
        </div>
      )

      expect(screen.container.id).toBe(container.id)
      expect(screen.baseElement.id).toBe(baseElement.id)
      // Live, not a snapshot: the handle reaches the tree the rerender mounted.
      expect(screen.within(screen.container).getByTestId("added")).not.toBeNull()
    })

    it("captures the container's box rather than the whole window", async () => {
      const directory = mkdtempSync(path.join(os.tmpdir(), "gpuix-container-test-"))
      try {
        const screen = render(<Decoration />)
        const golden = path.join(directory, "container.png")

        // The first run always writes the golden and fails; the file it wrote
        // is what this test is about.
        await expect(
          expect(screen.container).toMatchScreenshot({
            resolveScreenshotPath: () => golden,
          })
        ).rejects.toThrowError(/a new one was created/)

        const window = screen.renderer.getWindowSize()
        expect(readPngSize(readFileSync(golden), golden)).toEqual({
          width: window.width * window.scaleFactor,
          height: TILE_HEIGHT * window.scaleFactor,
        })

        // The result itself is still the whole offscreen window.
        const windowGolden = path.join(directory, "window.png")
        await expect(
          expect(screen).toMatchScreenshot({ resolveScreenshotPath: () => windowGolden })
        ).rejects.toThrowError(/a new one was created/)
        expect(readPngSize(readFileSync(windowGolden), windowGolden)).toEqual({
          width: window.width * window.scaleFactor,
          height: window.height * window.scaleFactor,
        })
      } finally {
        rmSync(directory, { recursive: true, force: true })
      }
    })
  })
})
