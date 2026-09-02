/// Tests for GPUIX event handling — verifies that React components receive
/// events correctly through the full native GPUI pipeline (end-to-end).
///
/// Every test goes through: React render → Rust RetainedTree → GpuixView::render()
/// → build_element() → GPUI layout → native simulate → GPUI hit test/dispatch →
/// event handler → emit_event_full → drainEvents → handleGpuixEvent → React handler.
///
/// All components use explicit sizes so GPUI can lay them out and hit-test
/// against known coordinates.
///
/// JSX types now resolve to GPUIX's Props via jsxImportSource in tsconfig.

import fs from "fs"
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import React, { useState, useRef } from "react"
import {
  createRoute,
  createLink,
  createMemoryHistory,
  createRootRoute,
  createRouter,
  Link,
  RouterContextProvider,
} from "@tanstack/react-router"
import { createTestRoot, isNativeTestRendererAvailable, TestRenderer } from "../testing"
import {
  render as renderApp,
  resetRender,
  startFrameLoop,
} from "../reconciler/renderer.js"
import type { EventPayload } from "@gpuix/native"
import { handleGpuixEvent } from "../reconciler/event-registry.js"
import type { GpuixSyntheticEvent } from "../reconciler/synthetic-event.js"
import type { Props, PublicInstance, RendererCapabilities } from "../types/host.js"
import { expectScreenshotsDiffer, expectScreenshotsEqual, SHOTS_DIR } from "./test-utils"

// All tests require the native GPUI test renderer (cargo build with test-support).
const describeNative = isNativeTestRendererAvailable() ? describe : describe.skip

describeNative("application menus", () => {
  it("installs the default application menu when menus are omitted", () => {
    resetRender()
    const renderer = new TestRenderer()

    try {
      renderApp(<text>Default menu test</text>, { renderer })
      expect(renderer.hasMainMenu()).toBe(true)
    } finally {
      resetRender()
    }
  })

  it("installs a main menu and dispatches custom action ids exactly once through GPUI", () => {
    resetRender()
    const renderer = new TestRenderer()
    const actions: string[] = []

    try {
      renderApp(<text>Menu test</text>, {
        renderer,
        menus: [
          {
            name: "Test",
            items: [
              {
                kind: "action",
                id: "mark",
                label: "Mark",
                keyEquivalent: "cmd-m",
              },
            ],
          },
        ],
        onMenuAction: ({ id }) => actions.push(id),
      })

      expect(renderer.hasMainMenu()).toBe(true)
      renderer.simulateMenuAction("mark")
      expect(actions).toEqual(["mark"])

      renderer.setMenus([])
      expect(renderer.hasMainMenu()).toBe(false)
    } finally {
      resetRender()
    }
  })

  it("routes a menu key equivalent through the same action handler", () => {
    resetRender()
    const renderer = new TestRenderer()
    const actions: string[] = []

    try {
      renderApp(<text>Shortcut test</text>, {
        renderer,
        menus: [
          {
            name: "Test",
            items: [
              {
                kind: "action",
                id: "shortcut",
                label: "Shortcut",
                keyEquivalent: "cmd-q",
              },
            ],
          },
        ],
        onMenuAction: ({ id }) => actions.push(id),
      })

      renderer.simulateKeystrokes("cmd-q")
      expect(actions).toEqual(["shortcut"])
    } finally {
      resetRender()
    }
  })

})

describe("frame loop", () => {
  it("keeps the active timer kind when an external frame source falls back", () => {
    let kind: RendererCapabilities["frameClock"]["kind"] = "display-link"
    const capabilities = (): RendererCapabilities => ({
      platform: "macos",
      frameClock: { kind, requiresTick: true, externalFrame: true },
      window: { activation: true, activate: true, resize: true, multiple: false },
      images: { privateNetwork: true },
      automation: {
        click: true,
        hover: true,
        drag: true,
        scrollWheel: true,
        keyboard: "native",
        screenshot: true,
        screenshotFormats: ["png"],
        clock: true,
        tree: true,
      },
    })
    const loop = startFrameLoop(
      {
        capabilities,
        requiresTick: () => true,
        tick: () => false,
        tickIdle: () => true,
        setFrameRequestHandler: () => {
          kind = "timer"
          return false
        },
      },
      { frameMs: 0 },
    )

    expect(capabilities().frameClock.kind).toBe("timer")
    loop.stop()
  })

  it("does not tick when the native platform owns its event loop", () => {
    let ticks = 0
    const loop = startFrameLoop({
      requiresTick: () => false,
      tick: () => {
        ticks += 1
      },
    })

    expect(ticks).toBe(0)
    loop.stop()
  })

  it("drives AppKit from native frame requests when available", async () => {
    let ticks = 0
    let frameRequest: (() => void) | null = null
    const loop = startFrameLoop(
      {
        requiresTick: () => true,
        tick: () => {
          ticks += 1
        },
        tickIdle: () => true,
        setFrameRequestHandler: (callback) => {
          frameRequest = callback ?? null
          return true
        },
      },
      { frameMs: 50 },
    )

    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(ticks).toBe(0)
    frameRequest?.()
    expect(ticks).toBe(1)
    loop.stop()
    expect(frameRequest).toBeNull()
  })

  it("falls back to timer pumps when native frame requests stall", async () => {
    let frameTicks = 0
    let idleTicks = 0
    const loop = startFrameLoop(
      {
        requiresTick: () => true,
        tick: () => {
          frameTicks += 1
        },
        tickIdle: () => {
          idleTicks += 1
        },
        setFrameRequestHandler: () => true,
      },
      { frameMs: 2 },
    )

    await new Promise((resolve) => setTimeout(resolve, 18))
    loop.stop()
    expect(idleTicks).toBeGreaterThanOrEqual(2)
    expect(frameTicks).toBe(0)
  })

  it("ignores a queued native frame request after stop", () => {
    let ticks = 0
    let frameRequest: (() => void) | null = null
    const loop = startFrameLoop({
      requiresTick: () => true,
      tick: () => {
        ticks += 1
      },
      tickIdle: () => true,
      setFrameRequestHandler: (callback) => {
        if (callback) frameRequest = callback
        return true
      },
    })
    const queuedFrameRequest = frameRequest

    loop.stop()
    queuedFrameRequest?.()
    expect(ticks).toBe(0)
  })

  it("does not let successful idle pumps mask repeated frame failures", async () => {
    let frameRequest: (() => void) | null = null
    let quitCalls = 0
    let unrecoverableErrors = 0
    const loop = startFrameLoop(
      {
        requiresTick: () => true,
        tick: () => {
          throw new Error("injected native frame failure")
        },
        tickIdle: () => true,
        quit: () => {
          quitCalls += 1
        },
        setFrameRequestHandler: (callback) => {
          frameRequest = callback ?? null
          return true
        },
      },
      {
        frameMs: 2,
        maxConsecutiveTickErrors: 3,
        onUnrecoverableError: () => {
          unrecoverableErrors += 1
        },
      },
    )

    const request = frameRequest
    for (let attempt = 0; attempt < 3; attempt += 1) {
      request?.()
      await new Promise((resolve) => setTimeout(resolve, 5))
    }

    expect(quitCalls).toBe(1)
    expect(unrecoverableErrors).toBe(1)
    loop.stop()
  })

  it("schedules the next tick immediately after a long tick", async () => {
    let ticks = 0
    const loop = startFrameLoop(
      {
        requiresTick: () => true,
        tick: () => {
          ticks += 1
          if (ticks === 1) {
            const start = Date.now()
            while (Date.now() - start < 25) {}
          }
        },
      },
      { frameMs: 20 },
    )
    await new Promise((resolve) => setTimeout(resolve, 8))
    loop.stop()
    expect(ticks).toBeGreaterThanOrEqual(2)
  })

  it("still waits after a short tick", async () => {
    let ticks = 0
    const loop = startFrameLoop(
      {
        requiresTick: () => true,
        tick: () => {
          ticks += 1
        },
      },
      { frameMs: 40 },
    )
    await new Promise((resolve) => setTimeout(resolve, 15))
    loop.stop()
    expect(ticks).toBe(1)
  })

  it("stops and reports termination when tick returns false", async () => {
    let ticks = 0
    let terminated = 0
    const loop = startFrameLoop(
      {
        requiresTick: () => true,
        tick: () => {
          ticks += 1
          return false
        },
      },
      {
        frameMs: 5,
        onTerminated: () => {
          terminated += 1
        },
      },
    )
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(ticks).toBe(1)
    expect(terminated).toBe(1)
    loop.stop()
  })

  it("keeps ticking until a later false, then exits once", async () => {
    let ticks = 0
    let terminated = 0
    const loop = startFrameLoop(
      {
        requiresTick: () => true,
        tick: () => {
          ticks += 1
          return ticks < 3
        },
      },
      {
        frameMs: 5,
        onTerminated: () => {
          terminated += 1
        },
      }
    )
    await new Promise((resolve) => setTimeout(resolve, 40))
    expect(ticks).toBe(3)
    expect(terminated).toBe(1)
    loop.stop()
  })

  it("recovers after tick throws instead of abandoning the AppKit pump", async () => {
    let ticks = 0
    let terminated = 0
    const loop = startFrameLoop(
      {
        requiresTick: () => true,
        tick: () => {
          ticks += 1
          if (ticks === 1) throw new Error("injected tick failure")
          return false
        },
      },
      {
        frameMs: 1,
        onTerminated: () => {
          terminated += 1
        },
      },
    )

    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(ticks).toBe(2)
    expect(terminated).toBe(1)
    loop.stop()
  })

  it("quits after repeated tick failures instead of leaving an unpumped window", async () => {
    let ticks = 0
    let quits = 0
    const failures: unknown[] = []
    const loop = startFrameLoop(
      {
        requiresTick: () => true,
        tick: () => {
          ticks += 1
          throw new Error(`tick failure ${ticks}`)
        },
        quit: () => {
          quits += 1
        },
      },
      {
        frameMs: 1,
        maxConsecutiveTickErrors: 3,
        onUnrecoverableError: (error) => failures.push(error),
      },
    )

    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(ticks).toBe(3)
    expect(quits).toBe(1)
    expect(failures).toHaveLength(1)
    loop.stop()
  })
})

describeNative("events", () => {
  let testRoot: ReturnType<typeof createTestRoot>

  beforeEach(() => {
    testRoot = createTestRoot()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe("click events", () => {
    it("should handle onClick and trigger re-render", () => {
      function Counter() {
        const [count, setCount] = useState(0)
        return (
          <div
            style={{ width: 200, height: 50 }}
            onClick={() => setCount((c) => c + 1)}
          >
            <text>{`Count: ${count}`}</text>
          </div>
        )
      }

      testRoot.render(<Counter />)
      expect(testRoot.renderer.getAllText()).toMatchInlineSnapshot(`
        [
          "Count: 0",
        ]
      `)

      // Click within the div bounds (GPUI does hit testing)
      testRoot.renderer.nativeSimulateClick(10, 10)

      expect(testRoot.renderer.getAllText()).toMatchInlineSnapshot(`
        [
          "Count: 1",
        ]
      `)

      // Click again
      testRoot.renderer.nativeSimulateClick(10, 10)

      expect(testRoot.renderer.getAllText()).toMatchInlineSnapshot(`
        [
          "Count: 2",
        ]
      `)
    })

    it("dispatches one event through capture, target, and bubble with DOM-shaped targets", () => {
      const calls: Array<{
        name: string
        phase: number
        target: PublicInstance
        currentTarget: PublicInstance
        defaultPrevented: boolean
      }> = []
      let parent: PublicInstance | null = null
      let target: PublicInstance | null = null

      const record = (name: string, event: GpuixSyntheticEvent): void => {
        calls.push({
          name,
          phase: event.eventPhase,
          target: event.target,
          currentTarget: event.currentTarget,
          defaultPrevented: event.defaultPrevented,
        })
      }

      testRoot.render(
        <div
          ref={(instance) => {
            parent = instance
          }}
          onClickCapture={(event) => record("parent capture", event)}
          onClick={(event) => record("parent bubble", event)}
          style={{ width: 240, height: 100 }}
        >
          <a
            ref={(instance) => {
              target = instance
            }}
            target="_self"
            onClickCapture={(event) => record("target capture", event)}
            onClick={(event) => {
              event.preventDefault()
              record("target bubble", event)
            }}
            style={{ width: 120, height: 50 }}
          >
            Factory
          </a>
        </div>
      )

      const nativeEvent: EventPayload = {
        elementId: target!.id,
        eventType: "click",
        modifiers: { alt: true, ctrl: false, cmd: true, shift: false },
      }
      const result = handleGpuixEvent(nativeEvent, testRoot.renderer)

      expect(calls.map(({ name }) => name)).toEqual([
        "parent capture",
        "target capture",
        "target bubble",
        "parent bubble",
      ])
      expect(calls.map(({ phase }) => phase)).toEqual([1, 2, 2, 3])
      expect(calls.every((call) => call.target === target)).toBe(true)
      expect(calls[0]!.currentTarget).toBe(parent)
      expect(calls[1]!.currentTarget).toBe(target)
      expect(calls[3]!.currentTarget).toBe(parent)
      expect(calls[3]!.defaultPrevented).toBe(true)
      expect(target!.getAttribute("target")).toBe("_self")
      expect(target!.getAttribute("missing")).toBeNull()
      expect(result).toEqual({ defaultPrevented: true, propagationStopped: false })
    })

    it("stops React propagation before an ancestor bubble handler", () => {
      const parentClick = vi.fn()
      const targetClick = vi.fn((event: GpuixSyntheticEvent) => event.stopPropagation())
      let target: PublicInstance | null = null

      testRoot.render(
        <div onClick={parentClick} style={{ width: 240, height: 100 }}>
          <div
            ref={(instance) => {
              target = instance
            }}
            onClick={targetClick}
            style={{ width: 120, height: 50 }}
          />
        </div>
      )

      testRoot.renderer.nativeSimulateClick(10, 10)

      expect(targetClick).toHaveBeenCalledOnce()
      expect(parentClick).not.toHaveBeenCalled()
      expect(targetClick.mock.calls[0]![0].isPropagationStopped()).toBe(true)
    })

    it("bubbles a click from a background-painted child to its anchor", () => {
      const click = vi.fn()
      testRoot.render(
        <a onClick={click} style={{ width: 240, height: 100 }}>
          <span
            testId="painted-click-child"
            style={{ width: 160, height: 60, backgroundColor: "#273449" }}
          >
            Factory
          </span>
        </a>
      )

      const child = testRoot.renderer.findByTestId("painted-click-child")!
      const [x, y, width, height] = testRoot.renderer.getElementBounds(child.id)!
      testRoot.renderer.nativeSimulateClick(x + width / 2, y + height / 2)

      expect(click).toHaveBeenCalledOnce()
      expect(click.mock.calls[0]![0].target.id).toBe(child.id)
    })

    it("bubbles a click from a painted grandchild to its anchor", () => {
      const click = vi.fn()
      testRoot.render(
        <a onClick={click} style={{ width: 240, height: 100 }}>
          <span style={{ width: 180, height: 70 }}>
            <span
              testId="painted-click-grandchild"
              style={{ width: 140, height: 50, backgroundColor: "#273449" }}
            >
              Factory
            </span>
          </span>
        </a>
      )

      const grandchild = testRoot.renderer.findByTestId("painted-click-grandchild")!
      const [x, y, width, height] = testRoot.renderer.getElementBounds(grandchild.id)!
      testRoot.renderer.nativeSimulateClick(x + width / 2, y + height / 2)

      expect(click).toHaveBeenCalledOnce()
      expect(click.mock.calls[0]![0].target.id).toBe(grandchild.id)
    })

    it("keeps an interactive painted descendant as the click target", () => {
      const anchorClick = vi.fn()
      const buttonClick = vi.fn((event: GpuixSyntheticEvent) => event.stopPropagation())
      testRoot.render(
        <a onClick={anchorClick} style={{ width: 240, height: 100 }}>
          <button
            testId="interactive-painted-click-child"
            onClick={buttonClick}
            style={{ width: 160, height: 60, backgroundColor: "#273449" }}
          >
            Factory
          </button>
        </a>
      )

      const button = testRoot.renderer.findByTestId("interactive-painted-click-child")!
      const [x, y, width, height] = testRoot.renderer.getElementBounds(button.id)!
      testRoot.renderer.nativeSimulateClick(x + width / 2, y + height / 2)

      expect(buttonClick).toHaveBeenCalledOnce()
      expect(buttonClick.mock.calls[0]![0].target.id).toBe(button.id)
      expect(anchorClick).not.toHaveBeenCalled()
    })

    it("keeps transparent descendants clickable through their anchor", () => {
      const click = vi.fn()
      testRoot.render(
        <a onClick={click} style={{ width: 240, height: 100 }}>
          <span
            testId="transparent-click-child"
            style={{ width: 160, height: 60, backgroundColor: "rgba(39, 52, 73, 0)" }}
          >
            Factory
          </span>
        </a>
      )

      const child = testRoot.renderer.findByTestId("transparent-click-child")!
      const [x, y, width, height] = testRoot.renderer.getElementBounds(child.id)!
      testRoot.renderer.nativeSimulateClick(x + width / 2, y + height / 2)

      expect(click).toHaveBeenCalledOnce()
      expect(click.mock.calls[0]![0].target.id).toBe(child.id)
    })

    it("runs an unadapted TanStack createLink handler through the synthetic surface", () => {
      vi.stubGlobal("window", { origin: "http://localhost" })
      type NativeAnchorProps = Props & {
        href?: string
        target?: string
      }
      const NativeAnchor = React.forwardRef<PublicInstance, NativeAnchorProps>(
        (props, ref) => <a {...props} ref={ref} />
      )
      const TanStackLink = createLink(NativeAnchor)
      const rootRoute = createRootRoute()
      const router = createRouter({
        routeTree: rootRoute,
        history: createMemoryHistory({ initialEntries: ["/"] }),
        isServer: false,
      })
      const navigate = vi.spyOn(router, "navigate").mockResolvedValue(undefined)

      testRoot.render(
        <RouterContextProvider router={router}>
          <TanStackLink
            to="/factory"
            preload={false}
            testId="tanstack-link"
            style={{ width: 180, height: 50 }}
          >
            Factory
          </TanStackLink>
        </RouterContextProvider>
      )

      const link = testRoot.renderer.findByTestId("tanstack-link")!
      expect(link.events.has("click")).toBe(true)
      const modified = handleGpuixEvent(
        {
          elementId: link.id,
          eventType: "click",
          modifiers: { alt: false, ctrl: false, cmd: true, shift: false },
        },
        testRoot.renderer
      )
      expect(modified.defaultPrevented).toBe(false)
      expect(navigate).not.toHaveBeenCalled()

      const primary = handleGpuixEvent(
        { elementId: link.id, eventType: "click" },
        testRoot.renderer
      )
      expect(primary.defaultPrevented).toBe(true)
      expect(navigate).toHaveBeenCalledOnce()
      expect(navigate).toHaveBeenCalledWith(expect.objectContaining({ to: "/factory" }))
    })

    it("navigates an unadapted TanStack createLink link on focused Enter", () => {
      vi.stubGlobal("window", { origin: "http://localhost" })
      type NativeAnchorProps = Props & {
        href?: string
        target?: string
      }
      const NativeAnchor = React.forwardRef<PublicInstance, NativeAnchorProps>(
        (props, ref) => <a {...props} ref={ref} />
      )
      const TanStackLink = createLink(NativeAnchor)
      const rootRoute = createRootRoute()
      const router = createRouter({
        routeTree: rootRoute,
        history: createMemoryHistory({ initialEntries: ["/"] }),
        isServer: false,
      })
      const navigate = vi.spyOn(router, "navigate").mockResolvedValue(undefined)

      testRoot.render(
        <RouterContextProvider router={router}>
          <TanStackLink
            to="/factory"
            preload={false}
            testId="tanstack-keyboard-link"
            style={{ width: 180, height: 50 }}
          >
            Factory
          </TanStackLink>
        </RouterContextProvider>
      )

      const link = testRoot.renderer.findByTestId("tanstack-keyboard-link")!
      expect(link.customProps?.tabIndex).toBe(0)

      testRoot.renderer.focusElement(link.id)
      testRoot.renderer.simulateKeyDown("enter")
      testRoot.renderer.simulateKeyUp("enter")

      expect(navigate).toHaveBeenCalledOnce()
      expect(navigate).toHaveBeenCalledWith(expect.objectContaining({ to: "/factory" }))
    })

    function renderBareTanStackLink() {
      const rootRoute = createRootRoute()
      const factoryRoute = createRoute({
        getParentRoute: () => rootRoute,
        path: "factory",
      })
      const router = createRouter({
        routeTree: rootRoute.addChildren([factoryRoute]),
        history: createMemoryHistory({ initialEntries: ["/"] }),
        isServer: false,
      })

      testRoot.render(
        <RouterContextProvider router={router}>
          <Link to="/factory" preload={false} style={{ width: 180, height: 50 }}>
            Factory
          </Link>
        </RouterContextProvider>
      )

      const text = testRoot.renderer.findByText("Factory")!
      const anchor = testRoot.renderer.getElement(text.parentId!)!
      return { router, anchor }
    }

    it("navigates a bare TanStack Link on primary click", () => {
      vi.stubGlobal("window", { origin: "http://localhost" })
      const { router, anchor } = renderBareTanStackLink()
      const [x, y, width, height] = testRoot.renderer.getElementBounds(anchor.id)!

      testRoot.renderer.nativeSimulateClick(x + width / 2, y + height / 2)

      expect(router.history.location.pathname).toBe("/factory")
    })

    it("navigates a bare TanStack Link on focused Enter through simulateKeystrokes", () => {
      vi.stubGlobal("window", { origin: "http://localhost" })
      const { router, anchor } = renderBareTanStackLink()

      testRoot.renderer.focusElement(anchor.id)
      testRoot.renderer.simulateKeystrokes("enter")

      expect(router.history.location.pathname).toBe("/factory")
    })

    it("routes pointer click and focused Space through the same implicit button handler", () => {
      const click = vi.fn()
      testRoot.render(
        <button
          autoFocus
          testId="space-activation"
          onClick={click}
          style={{ width: 180, height: 50 }}
        />
      )

      const target = testRoot.renderer.findByTestId("space-activation")!
      const [x, y, width, height] = testRoot.renderer.getElementBounds(target.id)!
      testRoot.renderer.nativeSimulateClick(x + width / 2, y + height / 2)
      expect(click).toHaveBeenCalledOnce()

      testRoot.renderer.focusElement(target.id)
      testRoot.renderer.simulateKeyDown("space")
      expect(click).toHaveBeenCalledOnce()

      testRoot.renderer.simulateKeyUp("space")
      expect(click).toHaveBeenCalledTimes(2)
    })

    it("activates a focused anchor only on unmodified Enter", () => {
      const navigate = vi.fn()
      testRoot.render(
        <a
          autoFocus
          href="/factory"
          testId="anchor-activation"
          onClick={() => navigate("/factory")}
          style={{ width: 180, height: 50 }}
        >
          <span style={{ width: 140, height: 40, backgroundColor: "#273449" }}>
            Factory
          </span>
        </a>
      )

      const anchor = testRoot.renderer.findByTestId("anchor-activation")!
      const tree = testRoot.renderer.getAccessibilityTree()
      expect(Object.values(tree.nodes)).toContainEqual(
        expect.objectContaining({ aria: expect.objectContaining({ role: "Link" }) })
      )
      expect(tree.frame?.tab_stop_count).toBe(1)
      testRoot.renderer.focusElement(anchor.id)

      testRoot.renderer.simulateKeystrokes("space")
      expect(navigate).not.toHaveBeenCalled()

      testRoot.renderer.simulateKeystrokes("cmd-enter")
      expect(navigate).not.toHaveBeenCalled()

      testRoot.renderer.simulateKeystrokes("enter")
      expect(navigate).toHaveBeenCalledOnce()
      expect(navigate).toHaveBeenLastCalledWith("/factory")
    })

    it.each(["enter", "space"] as const)(
      "suppresses a keyboard-synthesized click after prevented %s",
      (key) => {
        const click = vi.fn()
        const keyUp = vi.fn()
        let target: PublicInstance | null = null

        testRoot.render(
          <a
            ref={(instance) => {
              target = instance
            }}
            autoFocus
            tabIndex={0}
            onKeyDown={(event) => event.preventDefault()}
            onKeyUp={keyUp}
            onClick={click}
            style={{ width: 180, height: 50 }}
          >
            Factory
          </a>
        )

        testRoot.renderer.nativeSimulateKeyDown(target!.id, key)
        testRoot.renderer.nativeSimulateKeyUp(target!.id, key)

        expect(click).not.toHaveBeenCalled()
        expect(keyUp).toHaveBeenCalledOnce()
      }
    )

    it("keeps pointer click but does not turn Space in a text editor into activation", () => {
      const onClick = vi.fn()
      testRoot.render(
        <input
          autoFocus
          value=""
          onClick={onClick}
          style={{ width: 200, height: 60 }}
        />
      )

      testRoot.renderer.nativeSimulateClick(100, 30)
      expect(onClick).toHaveBeenCalledTimes(1)

      testRoot.renderer.simulateKeyDown("space")
      testRoot.renderer.simulateKeyUp("space")

      expect(onClick).toHaveBeenCalledTimes(1)
    })
  })

  describe("focus state styles", () => {
    it("keeps implicit buttons visually primitive and applies focusVisible from keyboard focus", () => {
      const testRoot = createTestRoot()
      const style = {
        width: 180,
        height: 60,
        backgroundColor: "#334155",
        focusVisible: { outlineColor: "#67e8f9", outlineWidth: 4, outlineOffset: 5 },
      }
      testRoot.render(
        <div style={{ display: "flex", gap: 20 }}>
          <div autoFocus tabIndex={0} style={{ width: 1, height: 1 }} />
          <button testId="implicit-focus-button" style={style} />
          <div testId="primitive-div" style={style} />
        </div>
      )

      const button = testRoot.renderer.findByTestId("implicit-focus-button")!
      const div = testRoot.renderer.findByTestId("primitive-div")!
      expect(testRoot.renderer.getResolvedStyle(button.id)).toEqual(
        testRoot.renderer.getResolvedStyle(div.id)
      )

      testRoot.renderer.simulateKeystrokes("tab")
      expect(testRoot.renderer.getResolvedStyle(button.id)).toMatchObject({
        outlineColor: "#67e8f9",
        outlineWidth: 4,
        outlineOffset: 5,
      })
    })

    const focusProbe = (
      staticFocused = false,
      keyboardSentinel = false,
      staticFocusVisible = false
    ) => (
      <div
        style={{
          display: "flex",
          width: "100%",
          height: "100%",
          padding: 80,
          backgroundColor: "#101010",
        }}
      >
        {keyboardSentinel && (
          <div
            autoFocus={!staticFocused}
            tabIndex={staticFocused ? undefined : 0}
            style={{ width: 1, height: 1 }}
          />
        )}
        <div
          tabIndex={staticFocused ? undefined : 0}
          style={{
            width: 240,
            height: 100,
            backgroundColor: staticFocused ? "#c2415d" : "#334155",
            borderRadius: 12,
            outlineColor: staticFocusVisible ? "#67e8f9" : undefined,
            outlineWidth: staticFocusVisible ? 4 : undefined,
            outlineOffset: staticFocusVisible ? 5 : undefined,
            focus: { backgroundColor: "#c2415d" },
            focusVisible: {
              outlineColor: "#67e8f9",
              outlineWidth: 4,
              outlineOffset: 5,
            },
          }}
        />
      </div>
    )

    it("applies focus on pointer focus but reserves focusVisible for keyboard focus", () => {
      const pointerPath = "/tmp/gpuix-focus-pointer.png"
      const pointerExpectedPath = "/tmp/gpuix-focus-pointer-expected.png"
      const keyboardPath = "/tmp/gpuix-focus-keyboard.png"
      const keyboardExpectedPath = "/tmp/gpuix-focus-keyboard-expected.png"

      const pointer = createTestRoot()
      pointer.render(focusProbe())
      pointer.renderer.nativeSimulateClick(120, 120)
      pointer.renderer.captureScreenshot(pointerPath)

      const pointerExpected = createTestRoot()
      pointerExpected.render(focusProbe(true))
      pointerExpected.renderer.captureScreenshot(pointerExpectedPath)

      const keyboard = createTestRoot()
      keyboard.render(focusProbe(false, true))
      keyboard.renderer.simulateKeystrokes("tab")
      keyboard.renderer.captureScreenshot(keyboardPath)

      const keyboardExpected = createTestRoot()
      keyboardExpected.render(focusProbe(true, true, true))
      keyboardExpected.renderer.captureScreenshot(keyboardExpectedPath)

      expectScreenshotsEqual(pointerPath, pointerExpectedPath)
      expectScreenshotsEqual(keyboardPath, keyboardExpectedPath)
      expectScreenshotsDiffer(pointerPath, keyboardPath)
    }, 20_000)

    it("keeps focus-visible styling on the directly focused control", () => {
      const actualPath = "/tmp/gpuix-focus-scoped.png"
      const expectedPath = "/tmp/gpuix-focus-scoped-expected.png"

      const tree = (staticChildOutline: boolean) => (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            width: "100%",
            height: "100%",
            gap: 36,
            padding: 80,
            backgroundColor: "#101010",
          }}
        >
          <div
            autoFocus={!staticChildOutline}
            tabIndex={staticChildOutline ? undefined : 0}
            style={{ width: 1, height: 1 }}
          />
          <div
            style={{
              width: 180,
              height: 60,
              backgroundColor: "#334155",
              focusVisible: {
                outlineColor: "#c084fc",
                outlineWidth: 4,
              },
            }}
          />
          <div
            tabIndex={-1}
            style={{
              width: 320,
              height: 150,
              padding: 28,
              backgroundColor: "#1e293b",
              focusVisible: {
                outlineColor: "#fb7185",
                outlineWidth: 4,
              },
            }}
          >
            <div
              testId="focus-scoped-child"
              tabIndex={staticChildOutline ? undefined : 0}
              style={{
                width: 180,
                height: 70,
                backgroundColor: "#334155",
                outlineColor: staticChildOutline ? "#4ade80" : undefined,
                outlineWidth: staticChildOutline ? 4 : undefined,
                outlineOffset: staticChildOutline ? 4 : undefined,
                focusVisible: {
                  outlineColor: "#4ade80",
                  outlineWidth: 4,
                  outlineOffset: 4,
                },
              }}
            />
          </div>
        </div>
      )

      const actual = createTestRoot()
      actual.render(tree(false))
      actual.renderer.simulateKeystrokes("tab")
      actual.renderer.captureScreenshot(actualPath)

      const expected = createTestRoot()
      expected.render(tree(true))
      expected.renderer.captureScreenshot(expectedPath)

      expectScreenshotsEqual(actualPath, expectedPath)
    })
  })

  describe("keyboard events", () => {
    it("should handle onKeyDown and update state", () => {
      function KeyTracker() {
        const [lastKey, setLastKey] = useState("none")
        return (
          <div
            style={{ width: 200, height: 50 }}
            tabIndex={0}
            onKeyDown={(e: EventPayload) => setLastKey(e.key ?? "unknown")}
          >
            <text>{`Key: ${lastKey}`}</text>
          </div>
        )
      }

      testRoot.render(<KeyTracker />)
      expect(testRoot.renderer.getAllText()).toMatchInlineSnapshot(`
        [
          "Key: none",
        ]
      `)

      const div = testRoot.renderer
        .findByType("div")
        .find((d) => d.events.has("keyDown"))!

      // GPUI uses "down" not "arrowDown"
      testRoot.renderer.nativeSimulateKeystrokes(div.id, "down")

      expect(testRoot.renderer.getAllText()).toMatchInlineSnapshot(`
        [
          "Key: down",
        ]
      `)

      testRoot.renderer.nativeSimulateKeystrokes(div.id, "escape")

      expect(testRoot.renderer.getAllText()).toMatchInlineSnapshot(`
        [
          "Key: escape",
        ]
      `)
    })

    it("should pass modifiers in keyboard events", () => {
      const receivedEvents: EventPayload[] = []

      function ModifierTracker() {
        return (
          <div
            style={{ width: 200, height: 50 }}
            tabIndex={0}
            onKeyDown={(e: EventPayload) => receivedEvents.push(e)}
          />
        )
      }

      testRoot.render(<ModifierTracker />)
      const div = testRoot.renderer
        .findByType("div")
        .find((d) => d.events.has("keyDown"))!

      testRoot.renderer.nativeSimulateKeystrokes(div.id, "cmd-s")

      expect(receivedEvents.length).toBeGreaterThanOrEqual(1)
      const event = receivedEvents.find((e) => e.key === "s")
      expect(event).toBeDefined()
      expect(event!.modifiers?.cmd).toBe(true)
    })
  })

  describe("hover events", () => {
    it("fires mouseEnter and mouseLeave on a bare anchor", () => {
      const enter = vi.fn()
      const leave = vi.fn()

      testRoot.render(
        <a
          href="/factory"
          testId="anchor-events"
          onMouseEnter={enter}
          onMouseLeave={leave}
          style={{ hoverGroup: "anchor", width: 200, height: 100 }}
        >
          <span
            testId="anchor-painted-child"
            style={{ minHeight: 36, padding: 8, backgroundColor: "#1f272d" }}
          >
            <text
              testId="anchor-hover-within"
              style={{
                color: "#334155",
                hoverWithin: { color: "#f59e0b" },
              }}
            >
              Factory
            </text>
          </span>
        </a>
      )

      const anchor = testRoot.renderer.findByTestId("anchor-events")!
      const paintedChild = testRoot.renderer.findByTestId("anchor-painted-child")!
      const hoverWithin = testRoot.renderer.findByTestId("anchor-hover-within")!
      const [x, y, width, height] = testRoot.renderer.getElementBounds(paintedChild.id)!

      expect(anchor.events).toEqual(new Set(["mouseEnter", "mouseLeave"]))

      testRoot.renderer.nativeSimulateMouseMove(x + width / 2, y + height / 2)
      expect(enter).toHaveBeenCalledOnce()
      expect(testRoot.renderer.getResolvedStyle(hoverWithin.id)).toMatchObject({
        color: "#f59e0b",
      })

      testRoot.renderer.nativeSimulateMouseMove(500, 500)
      expect(leave).toHaveBeenCalledOnce()
    })

    it("delivers ancestor hover handlers through painted descendants", () => {
      const opaqueParentEnter = vi.fn()
      const opaqueParentLeave = vi.fn()
      const opaqueChildEnter = vi.fn()
      const opaqueChildLeave = vi.fn()
      const lowAlphaEnter = vi.fn()
      const lowAlphaLeave = vi.fn()
      const grandchildEnter = vi.fn()
      const grandchildLeave = vi.fn()
      const order: string[] = []

      testRoot.render(
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <a
            testId="opaque-anchor"
            onMouseEnter={() => {
              order.push("opaque-parent-enter")
              opaqueParentEnter()
            }}
            onMouseLeave={() => {
              order.push("opaque-parent-leave")
              opaqueParentLeave()
            }}
            style={{ width: 240, height: 52 }}
          >
            <span
              testId="opaque-painted-child"
              onMouseEnter={() => {
                order.push("opaque-child-enter")
                opaqueChildEnter()
              }}
              onMouseLeave={() => {
                order.push("opaque-child-leave")
                opaqueChildLeave()
              }}
              style={{ minHeight: 36, padding: 8, backgroundColor: "#1f272d" }}
            >
              opaque background
            </span>
          </a>
          <a
            testId="low-alpha-anchor"
            onMouseEnter={lowAlphaEnter}
            onMouseLeave={lowAlphaLeave}
            style={{ width: 240, height: 52 }}
          >
            <span
              testId="low-alpha-painted-child"
              style={{ minHeight: 36, padding: 8, backgroundColor: "rgba(31, 39, 45, 0.04)" }}
            >
              low alpha background
            </span>
          </a>
          <a
            testId="grandchild-anchor"
            onMouseEnter={grandchildEnter}
            onMouseLeave={grandchildLeave}
            style={{ width: 240, height: 52 }}
          >
            <span style={{ minHeight: 36, padding: 8 }}>
              <span
                testId="grandchild-painted-child"
                style={{ minHeight: 20, padding: 4, backgroundColor: "#1f272d" }}
              >
                grandchild background
              </span>
            </span>
          </a>
        </div>
      )

      const moveTo = (testId: string) => {
        const element = testRoot.renderer.findByTestId(testId)!
        const [x, y, width, height] = testRoot.renderer.getElementBounds(element.id)!
        testRoot.renderer.nativeSimulateMouseMove(x + width / 2, y + height / 2)
      }

      moveTo("opaque-painted-child")
      testRoot.renderer.nativeSimulateMouseMove(700, 700)
      expect(order).toEqual([
        "opaque-parent-enter",
        "opaque-child-enter",
        "opaque-child-leave",
        "opaque-parent-leave",
      ])
      expect(opaqueParentEnter).toHaveBeenCalledOnce()
      expect(opaqueParentLeave).toHaveBeenCalledOnce()
      expect(opaqueChildEnter).toHaveBeenCalledOnce()
      expect(opaqueChildLeave).toHaveBeenCalledOnce()

      moveTo("low-alpha-painted-child")
      testRoot.renderer.nativeSimulateMouseMove(700, 700)
      expect(lowAlphaEnter).toHaveBeenCalledOnce()
      expect(lowAlphaLeave).toHaveBeenCalledOnce()

      moveTo("grandchild-painted-child")
      testRoot.renderer.nativeSimulateMouseMove(700, 700)
      expect(grandchildEnter).toHaveBeenCalledOnce()
      expect(grandchildLeave).toHaveBeenCalledOnce()
    })

    it("delivers one ancestor hover edge around a transitioning custom surface", () => {
      const events: string[] = []

      testRoot.render(
        <div
          onMouseEnter={() => events.push("parent-enter")}
          onMouseLeave={() => events.push("parent-leave")}
          style={{ width: 260, height: 120, padding: 12 }}
        >
          <code
            code="const hover = true"
            testId="transition-hover-code"
            onMouseEnter={() => events.push("child-enter")}
            onMouseLeave={() => events.push("child-leave")}
            style={{
              width: 220,
              height: 80,
              opacity: 0.5,
              hover: { opacity: 1 },
              transition: { properties: ["opacity"], durationMs: 100 },
            }}
          />
        </div>
      )

      const child = testRoot.renderer.findByTestId("transition-hover-code")!
      const [x, y, width, height] = testRoot.renderer.getElementBounds(child.id)!
      testRoot.renderer.nativeSimulateMouseMove(x + width / 2, y + height / 2)
      expect(events).toEqual(["parent-enter", "child-enter"])

      testRoot.renderer.nativeSimulateMouseMove(700, 700)
      expect(events).toEqual([
        "parent-enter",
        "child-enter",
        "child-leave",
        "parent-leave",
      ])
    })

    it("delivers one ancestor hover edge around a transitioning canvas", () => {
      const events: string[] = []

      testRoot.render(
        <div
          onMouseEnter={() => events.push("parent-enter")}
          onMouseLeave={() => events.push("parent-leave")}
          style={{ width: 260, height: 120, padding: 12 }}
        >
          <canvas
            width={220}
            height={80}
            testId="transition-hover-canvas"
            onMouseEnter={() => events.push("child-enter")}
            onMouseLeave={() => events.push("child-leave")}
            style={{
              width: 220,
              height: 80,
              opacity: 0.5,
              hover: { opacity: 1 },
              transition: { properties: ["opacity"], durationMs: 100 },
            }}
          />
        </div>
      )

      const child = testRoot.renderer.findByTestId("transition-hover-canvas")!
      const [x, y, width, height] = testRoot.renderer.getElementBounds(child.id)!
      testRoot.renderer.nativeSimulateMouseMove(x + width / 2, y + height / 2)
      expect(events).toEqual(["parent-enter", "child-enter"])

      testRoot.renderer.nativeSimulateMouseMove(700, 700)
      expect(events).toEqual([
        "parent-enter",
        "child-enter",
        "child-leave",
        "parent-leave",
      ])
    })

    it("delivers the canvas hover enter pair before its first mouse move", () => {
      const events: string[] = []

      testRoot.render(
        <div
          onMouseEnter={() => events.push("parent-enter")}
          style={{ width: 260, height: 120, padding: 12 }}
        >
          <canvas
            width={220}
            height={80}
            testId="ordered-hover-canvas"
            onMouseEnter={() => events.push("child-enter")}
            onMouseMove={() => events.push("child-move")}
            style={{ width: 220, height: 80 }}
          />
        </div>
      )

      const child = testRoot.renderer.findByTestId("ordered-hover-canvas")!
      const [x, y, width, height] = testRoot.renderer.getElementBounds(child.id)!
      testRoot.renderer.nativeSimulateMouseMove(x + width / 2, y + height / 2)

      expect(events).toEqual(["parent-enter", "child-enter", "child-move"])
    })

    it("keeps common ancestors hovered while moving between painted siblings", () => {
      const events: string[] = []

      testRoot.render(
        <div
          testId="sibling-parent"
          onMouseEnter={() => events.push("parent-enter")}
          onMouseLeave={() => events.push("parent-leave")}
          style={{ display: "flex", width: 240, height: 52 }}
        >
          <span
            testId="left-painted-sibling"
            onMouseEnter={() => events.push("left-enter")}
            onMouseLeave={() => events.push("left-leave")}
            style={{ flexGrow: 1, backgroundColor: "#1f272d" }}
          >
            left
          </span>
          <span
            testId="right-painted-sibling"
            onMouseEnter={() => events.push("right-enter")}
            onMouseLeave={() => events.push("right-leave")}
            style={{ flexGrow: 1, backgroundColor: "#334155" }}
          >
            right
          </span>
        </div>
      )

      const moveTo = (testId: string) => {
        const element = testRoot.renderer.findByTestId(testId)!
        const [x, y, width, height] = testRoot.renderer.getElementBounds(element.id)!
        testRoot.renderer.nativeSimulateMouseMove(x + width / 2, y + height / 2)
      }

      moveTo("left-painted-sibling")
      moveTo("right-painted-sibling")
      expect(events).toEqual(["parent-enter", "left-enter", "left-leave", "right-enter"])

      testRoot.renderer.nativeSimulateMouseMove(700, 700)
      expect(events).toEqual([
        "parent-enter",
        "left-enter",
        "left-leave",
        "right-enter",
        "right-leave",
        "parent-leave",
      ])
    })

    it("should handle mouseEnter and mouseLeave via mouse move", () => {
      function HoverBox() {
        const [hovered, setHovered] = useState(false)
        return (
          <div
            style={{ width: 200, height: 100 }}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
          >
            <text>{hovered ? "hovered" : "not hovered"}</text>
          </div>
        )
      }

      testRoot.render(<HoverBox />)
      expect(testRoot.renderer.getAllText()).toMatchInlineSnapshot(`
        [
          "not hovered",
        ]
      `)

      // Move mouse into element bounds → triggers on_hover(true) → mouseEnter
      testRoot.renderer.nativeSimulateMouseMove(50, 50)
      expect(testRoot.renderer.getAllText()).toMatchInlineSnapshot(`
        [
          "hovered",
        ]
      `)

      // Move mouse out of element bounds → triggers on_hover(false) → mouseLeave
      testRoot.renderer.nativeSimulateMouseMove(500, 500)
      expect(testRoot.renderer.getAllText()).toMatchInlineSnapshot(`
        [
          "not hovered",
        ]
      `)
    })

    it("keeps container hover styles and listeners active over descendant text", () => {
      const events: string[] = []
      testRoot.render(
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: "100%",
            height: "100%",
            backgroundColor: "#101010",
          }}
        >
          <div
            testId="hover-row"
            onMouseEnter={() => events.push("enter")}
            onMouseLeave={() => events.push("leave")}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 360,
              height: 96,
              backgroundColor: "#253047",
              hover: { backgroundColor: "#d97706" },
            }}
          >
            <text testId="hover-row-label" style={{ color: "#ffffff", fontSize: 22 }}>
              Destination
            </text>
          </div>
        </div>
      )

      const label = testRoot.renderer.findByTestId("hover-row-label")!
      const [x, y, width, height] = testRoot.renderer.getElementBounds(label.id)!
      const before = "/tmp/gpuix-descendant-container-hover-before.png"
      const after = "/tmp/gpuix-descendant-container-hover-after.png"

      testRoot.renderer.nativeSimulateMouseMove(10, 10)
      testRoot.renderer.captureScreenshot(before)
      testRoot.renderer.nativeSimulateMouseMove(x + width / 2, y + height / 2)
      testRoot.renderer.captureScreenshot(after)

      expect(events).toEqual(["enter"])
      expectScreenshotsDiffer(before, after)

      testRoot.renderer.nativeSimulateMouseMove(10, 10)
      expect(events).toEqual(["enter", "leave"])
    })
  })

  describe("mouseDownOutside", () => {
    it("should handle click outside to close pattern", () => {
      function Dropdown() {
        const [open, setOpen] = useState(false)
        return (
          <div style={{ width: 400, height: 400 }}>
            <div
              style={{ width: 100, height: 30 }}
              onClick={() => setOpen(true)}
            >
              <text>trigger</text>
            </div>
            {open && (
              <div
                style={{ width: 100, height: 100 }}
                onMouseDownOutside={() => setOpen(false)}
              >
                <text>dropdown content</text>
              </div>
            )}
          </div>
        )
      }

      testRoot.render(<Dropdown />)
      expect(testRoot.renderer.getAllText()).toMatchInlineSnapshot(`
        [
          "trigger",
        ]
      `)

      // Click on the trigger to open (within trigger bounds)
      testRoot.renderer.nativeSimulateClick(10, 10)

      expect(testRoot.renderer.getAllText()).toMatchInlineSnapshot(`
        [
          "trigger",
          "dropdown content",
        ]
      `)

      // Click outside the dropdown — GPUI fires on_mouse_down_out
      testRoot.renderer.nativeSimulateClick(350, 350)

      expect(testRoot.renderer.getAllText()).toMatchInlineSnapshot(`
        [
          "trigger",
        ]
      `)
    })
  })

  describe("dialog overlay", () => {
    it("should open a tooltip-like dialog on button click and close on outside click", () => {
      function DialogDemo() {
        const [open, setOpen] = useState(false)

        return (
          <div style={{ width: 420, height: 260, position: "relative" }}>
            <div
              style={{
                width: 120,
                height: 32,
                marginTop: 16,
                marginLeft: 16,
                borderRadius: 8,
                backgroundColor: "#2f4ea3",
              }}
              onClick={() => setOpen(true)}
            >
              <text>Open dialog</text>
            </div>

            {open && (
              <div
                style={{
                  position: "absolute",
                  top: 140,
                  left: 220,
                  width: 170,
                  height: 90,
                  padding: 10,
                  gap: 6,
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: "#3d4660",
                  backgroundColor: "#1c2233",
                }}
                onMouseDownOutside={() => setOpen(false)}
              >
                <text>Tooltip Dialog</text>
                <text>Some content inside</text>
              </div>
            )}
          </div>
        )
      }

      testRoot.render(<DialogDemo />)
      expect(testRoot.renderer.getAllText()).toMatchInlineSnapshot(`
        [
          "Open dialog",
        ]
      `)

      // Open via button click.
      testRoot.renderer.nativeSimulateClick(20, 20)
      expect(testRoot.renderer.getAllText()).toMatchInlineSnapshot(`
        [
          "Open dialog",
          "Tooltip Dialog",
          "Some content inside",
        ]
      `)

      // Click inside dialog bounds (relies on absolute top/left placement).
      testRoot.renderer.nativeSimulateClick(260, 170)
      expect(testRoot.renderer.getAllText()).toMatchInlineSnapshot(`
        [
          "Open dialog",
          "Tooltip Dialog",
          "Some content inside",
        ]
      `)

      // Click outside to close.
      testRoot.renderer.nativeSimulateClick(40, 220)
      expect(testRoot.renderer.getAllText()).toMatchInlineSnapshot(`
        [
          "Open dialog",
        ]
      `)
    })

    it("should capture screenshot changes when the dialog opens", () => {
      function DialogScreenshotProbe() {
        const [open, setOpen] = useState(false)

        return (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: "100%",
              height: "100%",
              backgroundColor: "#0f1320",
            }}
          >
            <div
              style={{
                width: 460,
                height: 260,
                position: "relative",
                borderRadius: 18,
                backgroundColor: "#1a2238",
                padding: 20,
              }}
              onClick={() => setOpen(true)}
            >
              <div
                style={{
                  width: 148,
                  height: 36,
                  borderRadius: 10,
                  backgroundColor: "#3a5ecf",
                }}
              >
                <text>Open dialog</text>
              </div>

              {open && (
                <div
                  style={{
                    position: "absolute",
                    top: 84,
                    left: 188,
                    width: 236,
                    height: 130,
                    padding: 12,
                    gap: 8,
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: "#4a5678",
                    backgroundColor: "#0d172b",
                  }}
                >
                  <text>Tooltip Dialog</text>
                  <text>Visual screenshot probe</text>
                </div>
              )}
            </div>
          </div>
        )
      }

      testRoot.render(<DialogScreenshotProbe />)

      const path0 = `${SHOTS_DIR}/gpuix-dialog-0.png`
      const path1 = `${SHOTS_DIR}/gpuix-dialog-1.png`

      if (fs.existsSync(path0)) fs.unlinkSync(path0)
      if (fs.existsSync(path1)) fs.unlinkSync(path1)

      testRoot.renderer.captureScreenshot(path0)
      // Click centered card area to open dialog.
      testRoot.renderer.nativeSimulateClick(640, 400)
      testRoot.renderer.captureScreenshot(path1)

      expect(fs.existsSync(path0)).toBe(true)
      expect(fs.existsSync(path1)).toBe(true)
      expect(fs.statSync(path0).size).toBeGreaterThan(0)
      expect(fs.statSync(path1).size).toBeGreaterThan(0)
      expect(fs.readFileSync(path0).equals(fs.readFileSync(path1))).toBe(false)
    })

    it("should support anchored deferred dialog overlays", () => {
      function AnchoredDialogDemo() {
        const [open, setOpen] = useState(false)

        return (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: "100%",
              height: "100%",
              backgroundColor: "#0c1020",
            }}
          >
            <div
              style={{
                width: 320,
                height: 180,
                borderRadius: 14,
                backgroundColor: "#1e2b4f",
                padding: 16,
              }}
              onClick={() => setOpen(true)}
            >
              <text>Open anchored</text>
              {open && (
                <anchored
                  position={{ x: 700, y: 360 }}
                  anchor="topLeft"
                  deferred
                  priority={1}
                >
                  <div
                    style={{
                      width: 190,
                      height: 96,
                      padding: 10,
                      gap: 6,
                      borderRadius: 12,
                      borderWidth: 1,
                      borderColor: "#4f5b82",
                      backgroundColor: "#131c34",
                    }}
                    onMouseDownOutside={() => setOpen(false)}
                  >
                    <text>Anchored Dialog</text>
                    <text>Deferred popover layer</text>
                  </div>
                </anchored>
              )}
            </div>
          </div>
        )
      }

      testRoot.render(<AnchoredDialogDemo />)
      expect(testRoot.renderer.getAllText()).toMatchInlineSnapshot(`
        [
          "Open anchored",
        ]
      `)

      // Click centered card to open anchored dialog.
      testRoot.renderer.nativeSimulateClick(640, 400)
      expect(testRoot.renderer.getAllText()).toMatchInlineSnapshot(`
        [
          "Open anchored",
          "Anchored Dialog",
          "Deferred popover layer",
        ]
      `)

      // Click inside anchored dialog area (x/y from anchored props).
      testRoot.renderer.nativeSimulateClick(730, 390)
      expect(testRoot.renderer.getAllText()).toMatchInlineSnapshot(`
        [
          "Open anchored",
          "Anchored Dialog",
          "Deferred popover layer",
        ]
      `)

      // Click outside should close via mouseDownOutside.
      testRoot.renderer.nativeSimulateClick(80, 80)
      expect(testRoot.renderer.getAllText()).toMatchInlineSnapshot(`
        [
          "Open anchored",
        ]
      `)
    })
  })

  describe("keyboard navigation", () => {
    it("should support arrow key navigation in a list", () => {
      function SelectableList() {
        const items = ["Apple", "Banana", "Cherry"]
        const [selected, setSelected] = useState(0)

        return (
          <div
            style={{ width: 200, height: 200 }}
            tabIndex={0}
            onKeyDown={(e: EventPayload) => {
              if (e.key === "down") {
                setSelected((s) => Math.min(s + 1, items.length - 1))
              } else if (e.key === "up") {
                setSelected((s) => Math.max(s - 1, 0))
              }
            }}
          >
            {items.map((item, i) => (
              <div key={item}>
                <text>{`${i === selected ? "> " : "  "}${item}`}</text>
              </div>
            ))}
          </div>
        )
      }

      testRoot.render(<SelectableList />)
      expect(testRoot.renderer.getAllText()).toMatchInlineSnapshot(`
        [
          "> Apple",
          "  Banana",
          "  Cherry",
        ]
      `)

      const list = testRoot.renderer
        .findByType("div")
        .find((d) => d.events.has("keyDown"))!

      // Arrow down through native GPUI pipeline
      testRoot.renderer.nativeSimulateKeystrokes(list.id, "down")
      expect(testRoot.renderer.getAllText()).toMatchInlineSnapshot(`
        [
          "  Apple",
          "> Banana",
          "  Cherry",
        ]
      `)

      // Arrow down again
      testRoot.renderer.nativeSimulateKeystrokes(list.id, "down")
      expect(testRoot.renderer.getAllText()).toMatchInlineSnapshot(`
        [
          "  Apple",
          "  Banana",
          "> Cherry",
        ]
      `)

      // Arrow down at bottom — should stay
      testRoot.renderer.nativeSimulateKeystrokes(list.id, "down")
      expect(testRoot.renderer.getAllText()).toMatchInlineSnapshot(`
        [
          "  Apple",
          "  Banana",
          "> Cherry",
        ]
      `)

      // Arrow up
      testRoot.renderer.nativeSimulateKeystrokes(list.id, "up")
      expect(testRoot.renderer.getAllText()).toMatchInlineSnapshot(`
        [
          "  Apple",
          "> Banana",
          "  Cherry",
        ]
      `)
    })
  })

  describe("scroll events", () => {
    it("should handle onScroll and receive exact delta values", () => {
      const receivedEvents: EventPayload[] = []

      function ScrollBox() {
        return (
          <div
            style={{ width: 200, height: 200 }}
            onScroll={(e: EventPayload) => receivedEvents.push(e)}
          >
            <text>scrollable</text>
          </div>
        )
      }

      testRoot.render(<ScrollBox />)
      testRoot.renderer.nativeSimulateScrollWheel(100, 100, 0, -50)

      expect(receivedEvents.length).toBeGreaterThanOrEqual(1)
      const scrollEvent = receivedEvents.find(
        (e) => e.eventType === "scroll"
      )
      expect(scrollEvent).toBeDefined()
      expect(scrollEvent!.eventType).toBe("scroll")
      expect(scrollEvent!.deltaX).toBe(0)
      expect(scrollEvent!.deltaY).toBe(-50)
      expect(scrollEvent!.touchPhase).toBe("moved")
    })

    it("should update state on scroll", () => {
      function ScrollCounter() {
        const [scrollCount, setScrollCount] = useState(0)
        return (
          <div
            style={{ width: 200, height: 200 }}
            onScroll={() => setScrollCount((c) => c + 1)}
          >
            <text>{`Scrolls: ${scrollCount}`}</text>
          </div>
        )
      }

      testRoot.render(<ScrollCounter />)
      expect(testRoot.renderer.getAllText()).toMatchInlineSnapshot(`
        [
          "Scrolls: 0",
        ]
      `)

      testRoot.renderer.nativeSimulateScrollWheel(100, 100, 0, -30)
      expect(testRoot.renderer.getAllText()).toMatchInlineSnapshot(`
        [
          "Scrolls: 1",
        ]
      `)
    })
  })

  describe("keyDown and keyUp events", () => {
    it("should handle onKeyDown via nativeSimulateKeyDown", () => {
      function KeyTracker() {
        const [lastKey, setLastKey] = useState("none")
        return (
          <div
            style={{ width: 200, height: 50 }}
            tabIndex={0}
            onKeyDown={(e: EventPayload) => setLastKey(e.key ?? "unknown")}
          >
            <text>{`Key: ${lastKey}`}</text>
          </div>
        )
      }

      testRoot.render(<KeyTracker />)
      const div = testRoot.renderer
        .findByType("div")
        .find((d) => d.events.has("keyDown"))!

      testRoot.renderer.nativeSimulateKeyDown(div.id, "a")

      expect(testRoot.renderer.getAllText()).toMatchInlineSnapshot(`
        [
          "Key: a",
        ]
      `)
    })

    it("should handle onKeyUp via nativeSimulateKeyUp", () => {
      const events: string[] = []

      function KeyUpTracker() {
        return (
          <div
            style={{ width: 200, height: 50 }}
            tabIndex={0}
            onKeyDown={(e: EventPayload) => events.push(`down:${e.key}`)}
            onKeyUp={(e: EventPayload) => events.push(`up:${e.key}`)}
          />
        )
      }

      testRoot.render(<KeyUpTracker />)
      const div = testRoot.renderer
        .findByType("div")
        .find((d) => d.events.has("keyDown") && d.events.has("keyUp"))!

      testRoot.renderer.nativeSimulateKeyDown(div.id, "enter")
      testRoot.renderer.nativeSimulateKeyUp(div.id, "enter")

      expect(events).toContain("down:enter")
      expect(events).toContain("up:enter")
    })

    it("should handle onKeyUp state update", () => {
      function KeyUpStateTracker() {
        const [lastKey, setLastKey] = useState("none")
        return (
          <div
            style={{ width: 200, height: 50 }}
            tabIndex={0}
            onKeyUp={(e: EventPayload) => setLastKey(e.key ?? "unknown")}
          >
            <text>{`Released: ${lastKey}`}</text>
          </div>
        )
      }

      testRoot.render(<KeyUpStateTracker />)
      expect(testRoot.renderer.getAllText()).toMatchInlineSnapshot(`
        [
          "Released: none",
        ]
      `)

      const div = testRoot.renderer
        .findByType("div")
        .find((d) => d.events.has("keyUp"))!

      testRoot.renderer.nativeSimulateKeyUp(div.id, "a")
      expect(testRoot.renderer.getAllText()).toMatchInlineSnapshot(`
        [
          "Released: a",
        ]
      `)
    })
  })

  describe("mouseDown and mouseUp events", () => {
    it("should handle onMouseDown and onMouseUp", () => {
      function PressTracker() {
        const [pressed, setPressed] = useState(false)
        return (
          <div
            style={{ width: 200, height: 100 }}
            onMouseDown={() => setPressed(true)}
            onMouseUp={() => setPressed(false)}
          >
            <text>{pressed ? "pressed" : "released"}</text>
          </div>
        )
      }

      testRoot.render(<PressTracker />)
      expect(testRoot.renderer.getAllText()).toMatchInlineSnapshot(`
        [
          "released",
        ]
      `)

      testRoot.renderer.nativeSimulateMouseDown(10, 10)
      expect(testRoot.renderer.getAllText()).toMatchInlineSnapshot(`
        [
          "pressed",
        ]
      `)

      testRoot.renderer.nativeSimulateMouseUp(10, 10)
      expect(testRoot.renderer.getAllText()).toMatchInlineSnapshot(`
        [
          "released",
        ]
      `)
    })

    it("should receive correct mouse button in mouseDown payload", () => {
      const receivedEvents: EventPayload[] = []

      function ButtonTracker() {
        return (
          <div
            style={{ width: 200, height: 100 }}
            onMouseDown={(e: EventPayload) => receivedEvents.push(e)}
          />
        )
      }

      testRoot.render(<ButtonTracker />)

      // Left click (button=0)
      testRoot.renderer.nativeSimulateMouseDown(10, 10, 0)
      expect(receivedEvents[0].button).toBe(0)

      // Right click (button=2)
      testRoot.renderer.nativeSimulateMouseDown(10, 10, 2)
      expect(receivedEvents[1].button).toBe(2)

      // Middle click (button=1)
      testRoot.renderer.nativeSimulateMouseDown(10, 10, 1)
      expect(receivedEvents[2].button).toBe(1)
    })

    it("bubbles mouse down and up from a background-painted child", () => {
      const down = vi.fn()
      const up = vi.fn()
      testRoot.render(
        <a
          onMouseDown={down}
          onMouseUp={up}
          style={{ width: 240, height: 100 }}
        >
          <span
            testId="painted-press-child"
            style={{ width: 160, height: 60, backgroundColor: "#273449" }}
          >
            Factory
          </span>
        </a>
      )

      const child = testRoot.renderer.findByTestId("painted-press-child")!
      const [x, y, width, height] = testRoot.renderer.getElementBounds(child.id)!
      testRoot.renderer.nativeSimulateMouseDown(x + width / 2, y + height / 2)
      testRoot.renderer.nativeSimulateMouseUp(x + width / 2, y + height / 2)

      expect(down).toHaveBeenCalledOnce()
      expect(up).toHaveBeenCalledOnce()
      expect(down.mock.calls[0]![0].target.id).toBe(child.id)
      expect(up.mock.calls[0]![0].target.id).toBe(child.id)
    })
  })

  describe("mouseMove events", () => {
    it("should handle onMouseMove and receive exact position", () => {
      const receivedEvents: EventPayload[] = []

      function MoveTracker() {
        return (
          <div
            style={{ width: 300, height: 300 }}
            onMouseMove={(e: EventPayload) => receivedEvents.push(e)}
          />
        )
      }

      testRoot.render(<MoveTracker />)
      testRoot.renderer.nativeSimulateMouseMove(50, 75)

      expect(receivedEvents.length).toBeGreaterThanOrEqual(1)
      const moveEvent = receivedEvents.find(
        (e) => e.eventType === "mouseMove"
      )
      expect(moveEvent).toBeDefined()
      expect(moveEvent!.eventType).toBe("mouseMove")
      expect(moveEvent!.x).toBe(50)
      expect(moveEvent!.y).toBe(75)
    })

    it("bubbles mouse move from a background-painted child", () => {
      const move = vi.fn()
      testRoot.render(
        <a onMouseMove={move} style={{ width: 240, height: 100 }}>
          <span
            testId="painted-move-child"
            style={{ width: 160, height: 60, backgroundColor: "#273449" }}
          >
            Factory
          </span>
        </a>
      )

      const child = testRoot.renderer.findByTestId("painted-move-child")!
      const [x, y, width, height] = testRoot.renderer.getElementBounds(child.id)!
      testRoot.renderer.nativeSimulateMouseMove(x + width / 2, y + height / 2)

      expect(move).toHaveBeenCalledOnce()
      expect(move.mock.calls[0]![0].target.id).toBe(child.id)
    })

    it("should receive pressedButton during drag", () => {
      const receivedEvents: EventPayload[] = []

      function DragTracker() {
        return (
          <div
            style={{ width: 300, height: 300 }}
            onMouseMove={(e: EventPayload) => receivedEvents.push(e)}
          />
        )
      }

      testRoot.render(<DragTracker />)

      // Move without button pressed
      testRoot.renderer.nativeSimulateMouseMove(10, 10)
      expect(receivedEvents.length).toBeGreaterThanOrEqual(1)
      const noButtonEvent = receivedEvents.find((e) => e.eventType === "mouseMove")!
      expect(noButtonEvent.pressedButton).toBeUndefined()

      // Move with left button pressed (simulating drag)
      receivedEvents.length = 0
      testRoot.renderer.nativeSimulateMouseMove(50, 50, 0)
      const dragEvent = receivedEvents.find((e) => e.eventType === "mouseMove")!
      expect(dragEvent.pressedButton).toBe(0)
    })

    it("continues a drag after mouse down mounts and flushes its continuation surface", () => {
      const trace: string[] = []

      function DragContinuation() {
        const [dragging, setDragging] = useState(false)
        return (
          <div style={{ position: "relative", width: 600, height: 400 }}>
            <div
              style={{ width: 120, height: 80 }}
              onMouseDown={(event: GpuixSyntheticEvent) => {
                trace.push(`down:${event.x},${event.y}`)
                event.setPointerCapture()
                setDragging(true)
              }}
              onMouseMove={(event: EventPayload) =>
                trace.push(`move:${event.x},${event.y}`)
              }
              onMouseUp={(event: EventPayload) => {
                trace.push(`up:${event.x},${event.y}`)
                setDragging(false)
              }}
            />
            {dragging ? (
              <div
                style={{
                  position: "absolute",
                  top: 0,
                  right: 0,
                  bottom: 0,
                  left: 0,
                  backgroundColor: "#00000010",
                }}
              />
            ) : null}
          </div>
        )
      }

      testRoot.render(<DragContinuation />)

      testRoot.renderer.nativeSimulateMouseDown(20, 20, 0)
      testRoot.renderer.nativeSimulateMouseMove(216, 20, 0)
      testRoot.renderer.nativeSimulateMouseUp(216, 20, 0)

      expect(trace).toEqual([
        "down:20,20",
        "move:216,20",
        "up:216,20",
      ])
    })

    it("captures through the host ref and releases explicitly", () => {
      const trace: string[] = []

      function RefCapture() {
        const handle = useRef<PublicInstance>(null)
        return (
          <div
            style={{ width: 600, height: 400 }}
            onMouseMove={(event) => trace.push(`surface-move:${event.eventPhase}`)}
          >
            <div
              ref={handle}
              style={{ width: 80, height: 80 }}
              onMouseDown={() => handle.current?.setPointerCapture()}
              onMouseMove={(event: GpuixSyntheticEvent) => {
                trace.push("handle-move")
                event.releasePointerCapture()
              }}
            />
          </div>
        )
      }

      testRoot.render(<RefCapture />)
      testRoot.renderer.nativeSimulateMouseDown(20, 20, 0)
      testRoot.renderer.nativeSimulateMouseMove(180, 20, 0)
      testRoot.renderer.nativeSimulateMouseMove(220, 20, 0)
      testRoot.renderer.nativeSimulateMouseUp(220, 20, 0)

      expect(trace).toEqual(["handle-move", "surface-move:3", "surface-move:2"])
    })

    it("releases capture when its retained owner unmounts", () => {
      const trace: string[] = []

      function UnmountingCapture() {
        const [mounted, setMounted] = useState(true)
        return (
          <div
            style={{ width: 600, height: 400 }}
            onMouseMove={() => trace.push("surface-move")}
            onMouseUp={() => trace.push("surface-up")}
          >
            {mounted ? (
              <div
                style={{ width: 80, height: 80 }}
                onMouseDown={(event: GpuixSyntheticEvent) => {
                  trace.push("down")
                  event.setPointerCapture()
                  setMounted(false)
                }}
              />
            ) : null}
          </div>
        )
      }

      testRoot.render(<UnmountingCapture />)
      testRoot.renderer.nativeSimulateMouseDown(20, 20, 0)
      testRoot.renderer.nativeSimulateMouseMove(180, 20, 0)
      testRoot.renderer.nativeSimulateMouseUp(180, 20, 0)

      expect(trace).toEqual(["down", "surface-move", "surface-up"])
    })

    it("cancels capture when the window deactivates", () => {
      const trace: string[] = []
      testRoot.render(
        <div
          style={{ width: 600, height: 400 }}
          onMouseMove={() => trace.push("surface-move")}
          onMouseUp={() => trace.push("surface-up")}
        >
          <div
            style={{ width: 80, height: 80 }}
            onMouseDown={(event: GpuixSyntheticEvent) => {
              trace.push("down")
              event.setPointerCapture()
            }}
            onMouseMove={() => trace.push("handle-move")}
            onMouseUp={() => trace.push("handle-up")}
          />
        </div>
      )

      testRoot.renderer.nativeSimulateMouseDown(20, 20, 0)
      testRoot.renderer.nativeSimulateWindowDeactivation()
      testRoot.renderer.nativeSimulateMouseMove(180, 20, 0)
      testRoot.renderer.nativeSimulateMouseUp(180, 20, 0)

      expect(trace).toEqual(["down", "surface-move", "surface-up"])
    })

    it("should update state on mouse move", () => {
      function PositionTracker() {
        const [pos, setPos] = useState("0,0")
        return (
          <div
            style={{ width: 300, height: 300 }}
            onMouseMove={(e: EventPayload) =>
              setPos(`${Math.round(e.x ?? 0)},${Math.round(e.y ?? 0)}`)
            }
          >
            <text>{`Position: ${pos}`}</text>
          </div>
        )
      }

      testRoot.render(<PositionTracker />)
      expect(testRoot.renderer.getAllText()).toMatchInlineSnapshot(`
        [
          "Position: 0,0",
        ]
      `)

      testRoot.renderer.nativeSimulateMouseMove(42, 99)
      expect(testRoot.renderer.getAllText()).toMatchInlineSnapshot(`
        [
          "Position: 42,99",
        ]
      `)
    })

    it("keeps mouseMove and mouseUp after the pointer leaves the hitbox", () => {
      const received: string[] = []

      function Handle() {
        return (
          <div
            style={{ width: 80, height: 40, backgroundColor: "#3366ff" }}
            onMouseDown={() => received.push("down")}
            onMouseMove={(e: EventPayload) =>
              received.push(`move:${Math.round(e.x ?? 0)},${e.pressedButton}`)
            }
            onMouseUp={() => received.push("up")}
          >
            <text>handle</text>
          </div>
        )
      }

      testRoot.render(<Handle />)
      testRoot.renderer.nativeSimulateMouseDown(20, 20)
      testRoot.renderer.nativeSimulateMouseMove(200, 20, 0)
      testRoot.renderer.nativeSimulateMouseUp(200, 20, 0)

      expect(received).toEqual(["down", "move:200,0", "up"])
    })

    it("does not capture when the element only listens for mouseDown and mouseUp", () => {
      const received: string[] = []

      function PressOnly() {
        return (
          <div
            style={{ width: 80, height: 40, backgroundColor: "#3366ff" }}
            onMouseDown={() => received.push("down")}
            onMouseUp={() => received.push("up")}
          >
            <text>press</text>
          </div>
        )
      }

      testRoot.render(<PressOnly />)
      testRoot.renderer.nativeSimulateMouseDown(20, 20)
      testRoot.renderer.nativeSimulateMouseUp(200, 20, 0)

      expect(received).toEqual(["down"])
    })

    it("still delivers move and up to an overlay mounted on mouseDown", () => {
      const received: string[] = []

      function OverlayDrag() {
        const [dragging, setDragging] = useState(false)
        return (
          <div
            style={{
              width: 400,
              height: 200,
              position: "relative",
              backgroundColor: "#111111",
            }}
          >
            <div
              style={{ width: 80, height: 40, backgroundColor: "#3366ff" }}
              onMouseDown={() => {
                received.push("clip-down")
                setDragging(true)
              }}
            >
              <text>clip</text>
            </div>
            {dragging && (
              <div
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: 400,
                  height: 200,
                  backgroundColor: "#00000001",
                }}
                onMouseMove={() => received.push("overlay-move")}
                onMouseUp={() => received.push("overlay-up")}
              >
                <text>overlay</text>
              </div>
            )}
          </div>
        )
      }

      testRoot.render(<OverlayDrag />)
      testRoot.renderer.nativeSimulateMouseDown(20, 20)
      testRoot.renderer.nativeSimulateMouseMove(200, 20, 0)
      testRoot.renderer.nativeSimulateMouseUp(200, 20, 0)

      expect(received).toEqual(["clip-down", "overlay-move", "overlay-up"])
    })

    it("fires mouseUp once when released inside the captured element", () => {
      const received: string[] = []

      function Handle() {
        return (
          <div
            style={{ width: 80, height: 40, backgroundColor: "#3366ff" }}
            onMouseDown={() => received.push("down")}
            onMouseMove={() => received.push("move")}
            onMouseUp={() => received.push("up")}
          >
            <text>handle</text>
          </div>
        )
      }

      testRoot.render(<Handle />)
      testRoot.renderer.nativeSimulateMouseDown(20, 20)
      testRoot.renderer.nativeSimulateMouseMove(30, 20, 0)
      testRoot.renderer.nativeSimulateMouseUp(30, 20, 0)

      expect(received).toEqual(["down", "move", "up"])
    })

    it("does not deliver captured moves to a sibling", () => {
      const received: string[] = []

      function Pair() {
        return (
          <div style={{ width: 400, height: 80, display: "flex" }}>
            <div
              style={{ width: 80, height: 40, backgroundColor: "#3366ff" }}
              onMouseDown={() => received.push("handle-down")}
              onMouseMove={() => received.push("handle-move")}
              onMouseUp={() => received.push("handle-up")}
            >
              <text>handle</text>
            </div>
            <div
              style={{ width: 200, height: 40, backgroundColor: "#22aa66" }}
              onMouseMove={() => received.push("sibling-move")}
              onMouseUp={() => received.push("sibling-up")}
            >
              <text>sibling</text>
            </div>
          </div>
        )
      }

      testRoot.render(<Pair />)
      testRoot.renderer.nativeSimulateMouseDown(20, 20)
      testRoot.renderer.nativeSimulateMouseMove(160, 20, 0)
      testRoot.renderer.nativeSimulateMouseUp(160, 20, 0)

      expect(received).toEqual(["handle-down", "handle-move", "handle-up"])
    })

    it("releases capture when the captured node is removed", () => {
      const received: string[] = []

      function Drag() {
        const [gone, setGone] = useState(false)
        if (gone) {
          return (
            <div
              style={{ width: 400, height: 80, backgroundColor: "#22aa66" }}
              onMouseMove={() => received.push("replacement-move")}
              onMouseUp={() => received.push("replacement-up")}
            >
              <text>replacement</text>
            </div>
          )
        }
        return (
          <div
            style={{ width: 80, height: 40, backgroundColor: "#3366ff" }}
            onMouseDown={() => {
              received.push("down")
              setGone(true)
            }}
            onMouseMove={() => received.push("handle-move")}
            onMouseUp={() => received.push("handle-up")}
          >
            <text>handle</text>
          </div>
        )
      }

      testRoot.render(<Drag />)
      testRoot.renderer.nativeSimulateMouseDown(20, 20)
      testRoot.renderer.nativeSimulateMouseMove(20, 20, 0)
      testRoot.renderer.nativeSimulateMouseUp(20, 20, 0)

      expect(received).toEqual(["down", "replacement-move", "replacement-up"])
    })

    it("does not hover a sibling while the pointer is captured", () => {
      const received: string[] = []

      function Pair() {
        return (
          <div style={{ width: 400, height: 80, display: "flex" }}>
            <div
              style={{ width: 80, height: 40, backgroundColor: "#3366ff" }}
              onMouseDown={() => received.push("handle-down")}
              onMouseMove={() => received.push("handle-move")}
              onMouseUp={() => received.push("handle-up")}
            >
              <text>handle</text>
            </div>
            <div
              style={{ width: 200, height: 40, backgroundColor: "#22aa66" }}
              onMouseEnter={() => received.push("sibling-enter")}
            >
              <text>sibling</text>
            </div>
          </div>
        )
      }

      testRoot.render(<Pair />)
      testRoot.renderer.nativeSimulateMouseDown(20, 20)
      testRoot.renderer.nativeSimulateMouseMove(160, 20, 0)
      expect(received).toEqual(["handle-down", "handle-move"])
      testRoot.renderer.nativeSimulateMouseUp(160, 20, 0)
      expect(received.slice(0, 3)).toEqual([
        "handle-down",
        "handle-move",
        "handle-up",
      ])
    })
  })

  describe("pointer hit testing", () => {
    const fill = {
      position: "absolute" as const,
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    }

    it("lets an absolute painted decoration block ordinary pointer hits", () => {
      const clicks: string[] = []
      testRoot.render(
        <div style={{ position: "relative", width: 200, height: 100 }}>
          <div style={fill} onClick={() => clicks.push("button")} />
          <div style={{ ...fill, backgroundColor: "#ffffff20" }} />
        </div>
      )

      testRoot.renderer.nativeSimulateClick(50, 50)
      expect(clicks).toEqual([])
    })

    it("lets an explicitly interactive overlay own the hit", () => {
      const clicks: string[] = []
      testRoot.render(
        <div style={{ position: "relative", width: 200, height: 100 }}>
          <div style={fill} onClick={() => clicks.push("button")} />
          <div
            style={{ ...fill, pointerEvents: "auto" }}
            onClick={() => clicks.push("overlay")}
          />
        </div>
      )

      testRoot.renderer.nativeSimulateClick(50, 50)
      expect(clicks).toEqual(["overlay"])
    })

    it("always excludes pointerEvents none from hit testing", () => {
      const clicks: string[] = []
      testRoot.render(
        <div style={{ position: "relative", width: 200, height: 100 }}>
          <div style={fill} onClick={() => clicks.push("button")} />
          <div
            style={{ ...fill, pointerEvents: "none" }}
            onClick={() => clicks.push("ignored-overlay")}
          />
        </div>
      )

      testRoot.renderer.nativeSimulateClick(50, 50)
      expect(clicks).toEqual(["button"])
    })
  })

  describe("combined event interactions", () => {
    it("should support keyboard shortcuts with modifiers", () => {
      function ShortcutHandler() {
        const [action, setAction] = useState("none")

        return (
          <div
            style={{ width: 200, height: 50 }}
            tabIndex={0}
            onKeyDown={(e: EventPayload) => {
              const mods = e.modifiers
              if (mods?.cmd && e.key === "s") {
                setAction("save")
              } else if (mods?.cmd && mods?.shift && e.key === "p") {
                setAction("command-palette")
              } else if (e.key === "escape") {
                setAction("cancel")
              }
            }}
          >
            <text>{`Action: ${action}`}</text>
          </div>
        )
      }

      testRoot.render(<ShortcutHandler />)
      expect(testRoot.renderer.getAllText()).toMatchInlineSnapshot(`
        [
          "Action: none",
        ]
      `)

      const div = testRoot.renderer
        .findByType("div")
        .find((d) => d.events.has("keyDown"))!

      // Cmd+S
      testRoot.renderer.nativeSimulateKeystrokes(div.id, "cmd-s")
      expect(testRoot.renderer.getAllText()).toMatchInlineSnapshot(`
        [
          "Action: save",
        ]
      `)

      // Cmd+Shift+P
      testRoot.renderer.nativeSimulateKeystrokes(div.id, "cmd-shift-p")
      expect(testRoot.renderer.getAllText()).toMatchInlineSnapshot(`
        [
          "Action: command-palette",
        ]
      `)

      // Escape (no modifiers)
      testRoot.renderer.nativeSimulateKeystrokes(div.id, "escape")
      expect(testRoot.renderer.getAllText()).toMatchInlineSnapshot(`
        [
          "Action: cancel",
        ]
      `)
    })
  })

  describe("screenshot", () => {
    it("should capture screenshot and reflect visual state changes", () => {
      function ScreenshotProbe() {
        const [active, setActive] = useState(false)
        return (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: "100%",
              height: "100%",
              backgroundColor: "#0f111a",
            }}
          >
            <div
              style={{
                width: 280,
                height: 120,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 10,
                borderRadius: 16,
                backgroundColor: active ? "#f5f7ff" : "#1f2333",
              }}
              onClick={() => setActive((v) => !v)}
            >
              <text style={{ color: active ? "#1f2333" : "#cbd5ff", fontSize: 18 }}>
                {active ? "active" : "idle"}
              </text>
              <text style={{ color: active ? "#525b76" : "#7f8bb3", fontSize: 12 }}>
                click to toggle theme
              </text>
            </div>
          </div>
        )
      }

      testRoot.render(<ScreenshotProbe />)

      // Capture initial state
      const path0 = `${SHOTS_DIR}/gpuix-counter-0.png`
      const path1 = `${SHOTS_DIR}/gpuix-counter-1.png`

      // Clean up from previous runs
      if (fs.existsSync(path0)) fs.unlinkSync(path0)
      if (fs.existsSync(path1)) fs.unlinkSync(path1)

      testRoot.renderer.captureScreenshot(path0)

      // Click and capture again
      testRoot.renderer.nativeSimulateClick(640, 400)
      testRoot.renderer.captureScreenshot(path1)

      expectScreenshotsDiffer(path0, path1)
    })

    it("should capture screenshot changes for keyDown interactions", () => {
      function KeydownScreenshotProbe() {
        const [state, setState] = useState("idle")
        return (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: "100%",
              height: "100%",
              backgroundColor: "#10131d",
            }}
          >
            <div
              style={{
                width: 320,
                height: 120,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                borderRadius: 16,
                backgroundColor: state === "idle" ? "#2b324d" : "#1f5a45",
              }}
              tabIndex={0}
              onKeyDown={(e: EventPayload) => {
                if (e.key === "enter") setState("enter")
              }}
            >
              <text style={{ color: "#e8edff", fontSize: 18 }}>{`State: ${state}`}</text>
              <text style={{ color: "#a8b2d8", fontSize: 12 }}>press Enter to switch</text>
            </div>
          </div>
        )
      }

      testRoot.render(<KeydownScreenshotProbe />)

      const keyTarget = testRoot.renderer
        .findByType("div")
        .find((d) => d.events.has("keyDown"))!

      const path0 = `${SHOTS_DIR}/gpuix-keydown-0.png`
      const path1 = `${SHOTS_DIR}/gpuix-keydown-1.png`

      if (fs.existsSync(path0)) fs.unlinkSync(path0)
      if (fs.existsSync(path1)) fs.unlinkSync(path1)

      testRoot.renderer.captureScreenshot(path0)
      testRoot.renderer.nativeSimulateKeyDown(keyTarget.id, "enter")
      testRoot.renderer.captureScreenshot(path1)

      expectScreenshotsDiffer(path0, path1)
    })

    it("should capture screenshot changes for hover interactions", () => {
      function HoverScreenshotProbe() {
        const [hovered, setHovered] = useState(false)
        return (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: "100%",
              height: "100%",
              backgroundColor: "#0f1319",
            }}
          >
            <div
              style={{
                width: 300,
                height: 130,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                borderRadius: 20,
                backgroundColor: hovered ? "#f6d48b" : "#2f3347",
              }}
              onMouseEnter={() => setHovered(true)}
              onMouseLeave={() => setHovered(false)}
            >
              <text style={{ color: hovered ? "#46361e" : "#d5daf2", fontSize: 18 }}>
                {hovered ? "hovered" : "not-hovered"}
              </text>
              <text style={{ color: hovered ? "#7a5e2c" : "#9da6c8", fontSize: 12 }}>
                move cursor over card
              </text>
            </div>
          </div>
        )
      }

      testRoot.render(<HoverScreenshotProbe />)

      const path0 = `${SHOTS_DIR}/gpuix-hover-0.png`
      const path1 = `${SHOTS_DIR}/gpuix-hover-1.png`

      if (fs.existsSync(path0)) fs.unlinkSync(path0)
      if (fs.existsSync(path1)) fs.unlinkSync(path1)

      testRoot.renderer.captureScreenshot(path0)
      testRoot.renderer.nativeSimulateMouseMove(640, 400)
      testRoot.renderer.captureScreenshot(path1)

      expectScreenshotsDiffer(path0, path1)
    })

  })

  describe("tree structure", () => {
    it("should produce correct element tree", () => {
      function App() {
        return (
          <div style={{ display: "flex", gap: 8 }}>
            <text>Hello</text>
            <div onClick={() => {}}>
              <text>Click me</text>
            </div>
          </div>
        )
      }

      testRoot.render(<App />)
      expect(testRoot.renderer.toJSON()).toMatchInlineSnapshot(`
        {
          "children": [
            {
              "children": [
                {
                  "id": 1,
                  "text": "Hello",
                  "type": "text",
                },
              ],
              "id": 2,
              "type": "text",
            },
            {
              "children": [
                {
                  "children": [
                    {
                      "id": 3,
                      "text": "Click me",
                      "type": "text",
                    },
                  ],
                  "id": 4,
                  "type": "text",
                },
              ],
              "events": [
                "click",
              ],
              "id": 5,
              "type": "div",
            },
          ],
          "id": 6,
          "style": {
            "display": "flex",
            "gap": 8,
          },
          "type": "div",
        }
      `)
    })
  })

  describe("scrollable containers", () => {
    it("should scroll content when overflow is scroll", () => {
      function ScrollableList() {
        return (
          <div style={{ width: 300, height: 200, overflow: "scroll" }}>
            <div style={{ height: 100, backgroundColor: "#ff0000" }}>
              <text>Item 1</text>
            </div>
            <div style={{ height: 100, backgroundColor: "#00ff00" }}>
              <text>Item 2</text>
            </div>
            <div style={{ height: 100, backgroundColor: "#0000ff" }}>
              <text>Item 3</text>
            </div>
            <div style={{ height: 100, backgroundColor: "#ffff00" }}>
              <text>Item 4</text>
            </div>
            <div style={{ height: 100, backgroundColor: "#ff00ff" }}>
              <text>Item 5</text>
            </div>
          </div>
        )
      }

      testRoot.render(<ScrollableList />)

      // Find the scrollable container (the one with overflow: scroll)
      const scrollContainer = testRoot.renderer
        .findByType("div")
        .find((d) => d.style.overflow === "scroll")!
      expect(scrollContainer).toBeDefined()

      // Initially scroll offset should be 0,0
      const initialOffset = testRoot.renderer.getScrollOffset(scrollContainer.id)
      expect(initialOffset).toEqual([0, 0])

      // Simulate scrolling down 50px (negative deltaY = scroll down)
      testRoot.renderer.nativeSimulateScrollWheel(150, 100, 0, -50)

      // Scroll offset should have changed (y becomes more negative as we scroll down)
      const afterScrollOffset = testRoot.renderer.getScrollOffset(scrollContainer.id)
      expect(afterScrollOffset).not.toBeNull()
      expect(afterScrollOffset![1]).toBeLessThan(0) // scrolled down
    })

    it("routes a phased wheel from a nested virtual list into its parent", () => {
      const rows = Array.from({ length: 10 }, (_, index) => index)

      function NestedVirtualScroller() {
        return (
          <div
            testId="nested-scroll-parent"
            style={{
              display: "flex",
              flexDirection: "column",
              width: 320,
              height: 240,
              overflowY: "scroll",
              backgroundColor: "#10131a",
            }}
          >
            <virtual-list
              testId="nested-scroll-list"
              itemCount={rows.length}
              windowStart={0}
              estimatedItemHeight={40}
              style={{ width: 320, height: 120, flexShrink: 0 }}
            >
              {rows.map((row) => (
                <div
                  key={row}
                  style={{
                    width: 320,
                    height: 40,
                    flexShrink: 0,
                    backgroundColor: row % 2 === 0 ? "#27324a" : "#35415d",
                  }}
                >
                  <text style={{ color: "#ffffff" }}>Row {row}</text>
                </div>
              ))}
            </virtual-list>
            <div
              style={{
                width: 320,
                height: 400,
                flexShrink: 0,
                backgroundColor: "#713f51",
              }}
            >
              <text style={{ color: "#ffffff" }}>Parent tail</text>
            </div>
          </div>
        )
      }

      testRoot.render(<NestedVirtualScroller />)

      const parent = testRoot.renderer.findByTestId("nested-scroll-parent")!
      const inner = testRoot.renderer.findByTestId("nested-scroll-list")!
      const beforePath = `${SHOTS_DIR}/nested-scroll-before.png`
      const boundaryPath = `${SHOTS_DIR}/nested-scroll-boundary.png`
      const reversedPath = `${SHOTS_DIR}/nested-scroll-reversed.png`
      for (const path of [beforePath, boundaryPath, reversedPath]) {
        if (fs.existsSync(path)) fs.unlinkSync(path)
      }

      testRoot.renderer.captureScreenshot(beforePath)
      testRoot.renderer.nativeSimulateScrollWheel(160, 60, 0, -340, {
        phase: "started",
        deltaUnit: "pixels",
      })

      expect(testRoot.renderer.getScrollOffset(inner.id)?.[1]).toBeCloseTo(-280)
      expect(testRoot.renderer.getScrollOffset(parent.id)?.[1]).toBeCloseTo(-60)
      testRoot.renderer.flush()
      testRoot.renderer.captureScreenshot(boundaryPath)

      testRoot.renderer.nativeSimulateScrollWheel(160, 30, 0, 40, {
        phase: "moved",
        deltaUnit: "pixels",
      })

      expect(testRoot.renderer.getScrollOffset(inner.id)?.[1]).toBeCloseTo(-240)
      expect(testRoot.renderer.getScrollOffset(parent.id)?.[1]).toBeCloseTo(-60)
      testRoot.renderer.flush()
      testRoot.renderer.captureScreenshot(reversedPath)
      testRoot.renderer.nativeSimulateScrollWheel(160, 30, 0, 0, {
        phase: "ended",
        deltaUnit: "pixels",
      })

      expectScreenshotsDiffer(beforePath, boundaryPath)
      expectScreenshotsDiffer(boundaryPath, reversedPath)
    })

    function NestedAxisScroll() {
      return (
        <div style={{ width: 240, height: 120, overflowY: "scroll" }}>
          <div style={{ width: 240, height: 80, overflowX: "scroll" }}>
            <div style={{ width: 800, height: 80 }}>
              <text>wide row</text>
            </div>
          </div>
          <div style={{ height: 400 }}>
            <text>below</text>
          </div>
        </div>
      )
    }

    it("does not remap a vertical wheel onto overflow-x", () => {
      testRoot.render(<NestedAxisScroll />)

      const parent = testRoot.renderer
        .findByType("div")
        .find((d) => d.style.overflowY === "scroll")!
      const inner = testRoot.renderer
        .findByType("div")
        .find((d) => d.style.overflowX === "scroll")!

      expect(testRoot.renderer.getScrollOffset(parent.id)).toEqual([0, 0])
      expect(testRoot.renderer.getScrollOffset(inner.id)).toEqual([0, 0])

      testRoot.renderer.nativeSimulateScrollWheel(80, 40, 0, -60)

      const parentOffset = testRoot.renderer.getScrollOffset(parent.id)
      const innerOffset = testRoot.renderer.getScrollOffset(inner.id)
      expect(parentOffset).not.toBeNull()
      expect(parentOffset![1]).toBeLessThan(0)
      expect(innerOffset).toEqual([0, 0])
    })

    it("switches a phased nested gesture after a strong direction change", () => {
      testRoot.render(<NestedAxisScroll />)

      const parent = testRoot.renderer
        .findByType("div")
        .find((d) => d.style.overflowY === "scroll")!
      const inner = testRoot.renderer
        .findByType("div")
        .find((d) => d.style.overflowX === "scroll")!

      testRoot.renderer.nativeSimulateScrollWheel(80, 40, -40, -5, {
        phase: "started",
        deltaUnit: "pixels",
      })
      expect(testRoot.renderer.getScrollOffset(inner.id)?.[0]).toBeCloseTo(-40)
      expect(testRoot.renderer.getScrollOffset(parent.id)?.[1]).toBeCloseTo(0)

      testRoot.renderer.nativeSimulateScrollWheel(80, 40, -5, -40, {
        phase: "moved",
        deltaUnit: "pixels",
      })
      expect(testRoot.renderer.getScrollOffset(inner.id)?.[0]).toBeCloseTo(-40)
      expect(testRoot.renderer.getScrollOffset(parent.id)?.[1]).toBeCloseTo(-40)
    })

    it("continues the finger axis into nested scroll momentum", () => {
      testRoot.render(<NestedAxisScroll />)

      const parent = testRoot.renderer
        .findByType("div")
        .find((d) => d.style.overflowY === "scroll")!
      const inner = testRoot.renderer
        .findByType("div")
        .find((d) => d.style.overflowX === "scroll")!

      testRoot.renderer.nativeSimulateScrollWheel(80, 40, -40, -5, {
        phase: "started",
        deltaUnit: "pixels",
      })
      testRoot.renderer.nativeSimulateScrollWheel(80, 40, 0, 0, {
        phase: "ended",
        deltaUnit: "pixels",
      })
      testRoot.renderer.nativeSimulateScrollWheel(80, 40, -7, -10, {
        momentumPhase: "started",
        deltaUnit: "pixels",
      })

      expect(testRoot.renderer.getScrollOffset(inner.id)?.[0]).toBeCloseTo(-47)
      expect(testRoot.renderer.getScrollOffset(parent.id)?.[1]).toBeCloseTo(0)

      testRoot.renderer.nativeSimulateScrollWheel(80, 40, 0, 0, {
        momentumPhase: "ended",
        deltaUnit: "pixels",
      })
      testRoot.renderer.nativeSimulateScrollWheel(80, 40, 0, -20, {
        phase: "started",
        deltaUnit: "pixels",
      })
      expect(testRoot.renderer.getScrollOffset(inner.id)?.[0]).toBeCloseTo(-47)
      expect(testRoot.renderer.getScrollOffset(parent.id)?.[1]).toBeCloseTo(-20)
    })

    it("pans overflow-x when the child is wider than the viewport", () => {
      function WideRow() {
        return (
          <div style={{ width: 240, height: 80 }}>
            <div style={{ width: "100%", height: 80, overflowX: "scroll" }}>
              <div style={{ width: 800, height: 80, flexShrink: 0 }}>
                <text>wide row</text>
              </div>
            </div>
          </div>
        )
      }

      testRoot.render(<WideRow />)

      const scroller = testRoot.renderer
        .findByType("div")
        .find((d) => d.style.overflowX === "scroll")!
      expect(testRoot.renderer.getScrollOffset(scroller.id)).toEqual([0, 0])

      testRoot.renderer.nativeSimulateScrollWheel(80, 40, -80, 0)
      const offset = testRoot.renderer.getScrollOffset(scroller.id)
      expect(offset).not.toBeNull()
      expect(offset![0]).toBeLessThan(0)
    })

    it("lets a parent scroller take a vertical wheel over a filled child", () => {
      function FilledColumn() {
        return (
          <div style={{ width: 240, height: 120, overflowY: "scroll" }}>
            <div style={{ height: 80, width: "100%", backgroundColor: "#1e1e2e" }}>
              <text>card</text>
            </div>
            <div style={{ height: 400 }}>
              <text>below</text>
            </div>
          </div>
        )
      }

      testRoot.render(<FilledColumn />)
      const parent = testRoot.renderer
        .findByType("div")
        .find((d) => d.style.overflowY === "scroll")!
      testRoot.renderer.nativeSimulateScrollWheel(80, 40, 0, -80)
      const offset = testRoot.renderer.getScrollOffset(parent.id)
      expect(offset).not.toBeNull()
      expect(offset![1]).toBeLessThan(0)
    })

    it("lets an ancestor take the wheel over an absolutely placed child", () => {
      // A pannable canvas places every item absolutely: a timeline clip, a
      // graph node. If absolute stole the wheel, the pan listener never ran.
      const deltas: number[] = []

      function Canvas() {
        return (
          <div
            style={{ width: 320, height: 200, position: "relative" }}
            onScroll={(e: EventPayload) => deltas.push(e.deltaY ?? 0)}
          >
            <div
              style={{
                position: "absolute",
                left: 40,
                top: 40,
                width: 120,
                height: 40,
                backgroundColor: "#3366ff",
              }}
            >
              <text>clip</text>
            </div>
          </div>
        )
      }

      testRoot.render(<Canvas />)
      testRoot.renderer.nativeSimulateScrollWheel(100, 60, 0, -80)

      expect(deltas).toEqual([-80])
    })

    it("lets an absolute sibling pass the wheel to a scroller below it", () => {
      // BlockMouseExceptScroll is not DOM ancestor bubbling: it lets every
      // scroll hitbox behind the element take the wheel, including one that
      // is not an ancestor. An overlay that must not do this needs
      // `pointerEvents: "auto"`.
      function OverlayOverScroller() {
        return (
          <div style={{ width: 320, height: 200, position: "relative" }}>
            <div style={{ width: 320, height: 200, overflowY: "scroll" }}>
              <div style={{ height: 900, backgroundColor: "#1e1e2e" }}>
                <text>tall</text>
              </div>
            </div>
            <div
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                width: 320,
                height: 200,
                backgroundColor: "#101010",
              }}
            >
              <text>card</text>
            </div>
          </div>
        )
      }

      testRoot.render(<OverlayOverScroller />)
      const scroller = testRoot.renderer
        .findByType("div")
        .find((d) => d.style.overflowY === "scroll")!
      testRoot.renderer.nativeSimulateScrollWheel(160, 100, 0, -80)

      const offset = testRoot.renderer.getScrollOffset(scroller.id)
      expect(offset).not.toBeNull()
      expect(offset![1]).toBeLessThan(0)
    })

    it("stops the wheel at a child with pointerEvents auto", () => {
      const deltas: number[] = []

      function ModalOverCanvas() {
        return (
          <div
            style={{ width: 320, height: 200, position: "relative" }}
            onScroll={(e: EventPayload) => deltas.push(e.deltaY ?? 0)}
          >
            <div
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                width: 320,
                height: 200,
                backgroundColor: "#101010",
                pointerEvents: "auto",
              }}
            >
              <text>modal</text>
            </div>
          </div>
        )
      }

      testRoot.render(<ModalOverCanvas />)
      testRoot.renderer.nativeSimulateScrollWheel(100, 60, 0, -80)

      expect(deltas).toEqual([])
    })

    it("reports the modifiers held during a simulated wheel", () => {
      const held: Array<boolean | undefined> = []

      function ZoomSurface() {
        return (
          <div
            style={{ width: 200, height: 200, backgroundColor: "#101010" }}
            onScroll={(e: EventPayload) => held.push(e.modifiers?.cmd)}
          >
            <text>surface</text>
          </div>
        )
      }

      testRoot.render(<ZoomSurface />)
      testRoot.renderer.nativeSimulateScrollWheel(100, 100, 0, -40)
      testRoot.renderer.nativeSimulateScrollWheel(100, 100, 0, -40, "cmd")

      expect(held).toEqual([false, true])
    })

    it("should support overflow-y scroll only", () => {
      function VerticalScroll() {
        return (
          <div style={{ width: 300, height: 100, overflowY: "scroll" }}>
            <div style={{ height: 500 }}>
              <text>Tall content</text>
            </div>
          </div>
        )
      }

      testRoot.render(<VerticalScroll />)

      const container = testRoot.renderer
        .findByType("div")
        .find((d) => d.style.overflowY === "scroll")!
      expect(container).toBeDefined()

      const initialOffset = testRoot.renderer.getScrollOffset(container.id)
      expect(initialOffset).toEqual([0, 0])

      // Scroll down
      testRoot.renderer.nativeSimulateScrollWheel(150, 50, 0, -80)
      const offset = testRoot.renderer.getScrollOffset(container.id)
      expect(offset).not.toBeNull()
      expect(offset![1]).toBeLessThan(0) // scrolled down vertically
    })

    it("should support programmatic scrollTo", () => {
      function ScrollableBox() {
        return (
          <div style={{ width: 200, height: 100, overflow: "scroll" }}>
            <div style={{ height: 500 }}>
              <text>Very tall content</text>
            </div>
          </div>
        )
      }

      testRoot.render(<ScrollableBox />)

      const container = testRoot.renderer
        .findByType("div")
        .find((d) => d.style.overflow === "scroll")!

      // Initially at 0,0
      expect(testRoot.renderer.getScrollOffset(container.id)).toEqual([0, 0])

      // Scroll programmatically to y=-100
      testRoot.renderer.scrollTo(container.id, 0, -100)

      const offset = testRoot.renderer.getScrollOffset(container.id)
      expect(offset).not.toBeNull()
      expect(offset![1]).toBe(-100)
    })

    it("should support programmatic scrollToItem", () => {
      function ItemList() {
        return (
          <div style={{ width: 200, height: 100, overflow: "scroll" }}>
            <div style={{ height: 80 }}>
              <text>Item A</text>
            </div>
            <div style={{ height: 80 }}>
              <text>Item B</text>
            </div>
            <div style={{ height: 80 }}>
              <text>Item C</text>
            </div>
            <div style={{ height: 80 }}>
              <text>Item D</text>
            </div>
          </div>
        )
      }

      testRoot.render(<ItemList />)

      const container = testRoot.renderer
        .findByType("div")
        .find((d) => d.style.overflow === "scroll")!

      // Initially at top
      expect(testRoot.renderer.getScrollOffset(container.id)).toEqual([0, 0])

      // Scroll to item 3 (index 3, the 4th child "Item D")
      testRoot.renderer.scrollToItem(container.id, 3)

      // After scrolling to item, offset should have changed
      const offset = testRoot.renderer.getScrollOffset(container.id)
      expect(offset).not.toBeNull()
      expect(offset![1]).toBeLessThan(0) // scrolled down to reveal item
    })

    it("should render scrollable container with visible screenshot diff", () => {
      function ScreenshotScroller() {
        return (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: "100%",
              height: "100%",
              backgroundColor: "#1a1a2e",
            }}
          >
            <div
              style={{
                width: 300,
                height: 200,
                overflow: "scroll",
                backgroundColor: "#16213e",
                borderRadius: 8,
                borderWidth: 2,
                borderColor: "#0f3460",
              }}
            >
              <div style={{ height: 80, backgroundColor: "#e94560", padding: 16 }}>
                <text style={{ color: "#ffffff", fontSize: 20 }}>Section 1 (Red)</text>
              </div>
              <div style={{ height: 80, backgroundColor: "#0f3460", padding: 16 }}>
                <text style={{ color: "#ffffff", fontSize: 20 }}>Section 2 (Blue)</text>
              </div>
              <div style={{ height: 80, backgroundColor: "#533483", padding: 16 }}>
                <text style={{ color: "#ffffff", fontSize: 20 }}>Section 3 (Purple)</text>
              </div>
              <div style={{ height: 80, backgroundColor: "#e94560", padding: 16 }}>
                <text style={{ color: "#ffffff", fontSize: 20 }}>Section 4 (Red)</text>
              </div>
              <div style={{ height: 80, backgroundColor: "#0f3460", padding: 16 }}>
                <text style={{ color: "#ffffff", fontSize: 20 }}>Section 5 (Blue)</text>
              </div>
            </div>
          </div>
        )
      }

      testRoot.render(<ScreenshotScroller />)

      const path0 = `${SHOTS_DIR}/gpuix-scroll-before.png`
      const path1 = `${SHOTS_DIR}/gpuix-scroll-after.png`

      if (fs.existsSync(path0)) fs.unlinkSync(path0)
      if (fs.existsSync(path1)) fs.unlinkSync(path1)

      // Screenshot before scrolling
      testRoot.renderer.captureScreenshot(path0)

      // Scroll down 150px inside the scrollable container
      testRoot.renderer.nativeSimulateScrollWheel(640, 400, 0, -150)

      // Screenshot after scrolling
      testRoot.renderer.captureScreenshot(path1)

      // Both screenshots should exist and be different (content shifted)
      expect(fs.existsSync(path0)).toBe(true)
      expect(fs.existsSync(path1)).toBe(true)
      expect(fs.statSync(path0).size).toBeGreaterThan(0)
      expect(fs.statSync(path1).size).toBeGreaterThan(0)
      // Before and after scroll should produce different pixels
      expect(fs.readFileSync(path0).equals(fs.readFileSync(path1))).toBe(false)
    })

    it("should combine onScroll event with overflow scroll", () => {
      const receivedScrollEvents: EventPayload[] = []

      function ScrollWithEvent() {
        return (
          <div
            style={{ width: 300, height: 100, overflow: "scroll" }}
            onScroll={(e: EventPayload) => receivedScrollEvents.push(e)}
          >
            <div style={{ height: 500 }}>
              <text>Scrollable with events</text>
            </div>
          </div>
        )
      }

      testRoot.render(<ScrollWithEvent />)

      // Scroll should fire the onScroll event AND move the content
      testRoot.renderer.nativeSimulateScrollWheel(150, 50, 0, -40)

      // Event should have fired
      expect(receivedScrollEvents.length).toBeGreaterThanOrEqual(1)
      const scrollEvent = receivedScrollEvents.find(
        (e) => e.eventType === "scroll"
      )
      expect(scrollEvent).toBeDefined()
      expect(scrollEvent!.deltaY).toBe(-40)

      // Content should have scrolled
      const container = testRoot.renderer
        .findByType("div")
        .find((d) => d.style.overflow === "scroll")!
      const offset = testRoot.renderer.getScrollOffset(container.id)
      expect(offset).not.toBeNull()
      expect(offset![1]).toBeLessThan(0)
    })

    it("should expose element id via ref for programmatic scroll", () => {
      let capturedRef: any = null

      function RefScroller() {
        const scrollRef = useRef<any>(null)
        // Capture the ref after render so the test can access it
        capturedRef = scrollRef

        return (
          <div
            ref={scrollRef}
            style={{ width: 200, height: 100, overflow: "scroll" }}
          >
            <div style={{ height: 80 }}>
              <text>Item A</text>
            </div>
            <div style={{ height: 80 }}>
              <text>Item B</text>
            </div>
            <div style={{ height: 80 }}>
              <text>Item C</text>
            </div>
          </div>
        )
      }

      testRoot.render(<RefScroller />)

      // ref.current should be the Instance with a numeric id
      expect(capturedRef).not.toBeNull()
      expect(capturedRef.current).not.toBeNull()
      expect(typeof capturedRef.current.id).toBe("number")
      expect(capturedRef.current.id).toBeGreaterThan(0)

      // Use the ref's id with the scroll API
      const elementId = capturedRef.current.id

      // Initially at 0,0
      expect(testRoot.renderer.getScrollOffset(elementId)).toEqual([0, 0])

      // Programmatic scroll via ref id
      testRoot.renderer.scrollTo(elementId, 0, -60)
      const offset = testRoot.renderer.getScrollOffset(elementId)
      expect(offset).not.toBeNull()
      expect(offset![1]).toBe(-60)
    })
  })
})
