import { Suspense } from "react"
import { describe, expect, it, vi } from "vitest"
import { handleGpuixEvent } from "../reconciler/event-registry.js"
import { hostConfig } from "../reconciler/host-config.js"
import { createRoot, flushSync } from "../reconciler/reconciler.js"
import { createTestRoot, isNativeTestRendererAvailable, TestRenderer } from "../testing.js"
import type { Container, HostContext, MutationRenderer, Props } from "../types/host.js"

const describeNative = isNativeTestRendererAvailable() ? describe : describe.skip

function recordingRenderer(): MutationRenderer & {
  styles: object[]
  eventListeners: Array<[id: number, eventType: string, hasHandler: boolean]>
} {
  const styles: object[] = []
  const eventListeners: Array<[id: number, eventType: string, hasHandler: boolean]> = []
  return {
    styles,
    eventListeners,
    createElement() {},
    destroyElement: () => [],
    appendChild() {},
    insertBefore() {},
    setStyle(_id, style) {
      styles.push(style)
    },
    setText() {},
    setEventListener(id, eventType, hasHandler) {
      eventListeners.push([id, eventType, hasHandler])
    },
    setRoot() {},
    setCustomProp() {},
    flushMutations() {},
  }
}

function createRecordingInstance(
  type: Parameters<typeof hostConfig.createInstance>[0],
  props: Props
) {
  const renderer = recordingRenderer()
  const container: Container = {
    renderer,
    ids: { nextElementId: 0 },
    eventHandlers: new Map(),
    windowKeyEventHandlers: {},
    windowKeyEventId: 0,
    windowSelectionEventId: 0,
  }
  const instance = hostConfig.createInstance(
    type,
    props,
    container,
    null as unknown as HostContext
  )
  return { container, instance, renderer }
}

describe("host config hideInstance", () => {
  it("keeps the element style when React hides the element", () => {
    const props: Props = {
      style: {
        width: 80,
        height: 40,
        backgroundColor: "#f38ba8",
        hover: { backgroundColor: "#a6e3a1" },
      },
    }
    const { instance, renderer } = createRecordingInstance("div", props)

    hostConfig.hideInstance(instance)
    expect(renderer.styles.at(-1)).toEqual({
      width: 80,
      height: 40,
      backgroundColor: "#f38ba8",
      visibility: "hidden",
    })

    hostConfig.unhideInstance(instance, props)
    expect(renderer.styles.at(-1)).toEqual(props.style)
  })
})

describe("host config event listener updates", () => {
  it("does not inspect event props during a style-only update", () => {
    const initialProps: Props = { style: { width: 40, height: 40 } }
    const { instance, renderer } = createRecordingInstance("img", initialProps)
    let eventPropReads = 0
    const observeEventReads = (props: Props): Props =>
      new Proxy(props, {
        get(target, key, receiver) {
          if (typeof key === "string" && key.startsWith("on")) eventPropReads += 1
          return Reflect.get(target, key, receiver)
        },
      })

    hostConfig.commitUpdate(
      instance,
      "img",
      observeEventReads(initialProps),
      observeEventReads({ style: { width: 48, height: 48 } }),
      null
    )

    expect(eventPropReads).toBe(0)
    expect(renderer.eventListeners).toEqual([])
  })

  it("keeps null event props on the fast path", () => {
    const initialProps: Props = { style: { width: 40 }, onClick: undefined }
    const { instance, renderer } = createRecordingInstance("img", initialProps)
    let eventPropReads = 0
    const observeEventReads = (props: Props): Props =>
      new Proxy(props, {
        get(target, key, receiver) {
          if (typeof key === "string" && key.startsWith("on")) eventPropReads += 1
          return Reflect.get(target, key, receiver)
        },
      })

    hostConfig.commitUpdate(
      instance,
      "img",
      observeEventReads(initialProps),
      observeEventReads({ style: { width: 48 }, onClick: null }),
      null
    )

    expect(eventPropReads).toBeLessThan(10)
    expect(renderer.eventListeners).toEqual([])
  })

  it("preserves native click listener ownership while handlers change", () => {
    const initialProps: Props = { style: { width: 40 } }
    const firstHandler = vi.fn()
    const replacementHandler = vi.fn()
    const captureHandler = vi.fn()
    const { container, instance, renderer } = createRecordingInstance("div", initialProps)
    const firstProps: Props = { ...initialProps, onClick: firstHandler }

    hostConfig.commitUpdate(instance, "div", initialProps, firstProps, null)
    expect(renderer.eventListeners).toEqual([[instance.id, "click", true]])
    expect(container.eventHandlers.get(instance.id)?.get("click")).toBe(firstHandler)

    renderer.eventListeners.length = 0
    const replacementProps: Props = { ...initialProps, onClick: replacementHandler }
    hostConfig.commitUpdate(instance, "div", firstProps, replacementProps, null)
    expect(renderer.eventListeners).toEqual([])
    expect(container.eventHandlers.get(instance.id)?.get("click")).toBe(replacementHandler)

    const captureProps: Props = { ...replacementProps, onClickCapture: captureHandler }
    hostConfig.commitUpdate(instance, "div", replacementProps, captureProps, null)
    expect(renderer.eventListeners).toEqual([])
    expect(container.eventHandlers.get(instance.id)?.get("clickCapture")).toBe(captureHandler)

    hostConfig.commitUpdate(instance, "div", captureProps, replacementProps, null)
    expect(renderer.eventListeners).toEqual([])
    expect(container.eventHandlers.get(instance.id)?.has("clickCapture")).toBe(false)
    expect(container.eventHandlers.get(instance.id)?.get("click")).toBe(replacementHandler)

    hostConfig.commitUpdate(instance, "div", replacementProps, initialProps, null)
    expect(renderer.eventListeners).toEqual([[instance.id, "click", false]])
    expect(container.eventHandlers.has(instance.id)).toBe(false)
  })

  it("keeps onDrop and onFileDrop as distinct registry entries", () => {
    const initialProps: Props = { style: { width: 40 } }
    const onDrop = vi.fn()
    const onFileDrop = vi.fn()
    const { container, instance, renderer } = createRecordingInstance("div", initialProps)
    const bothProps: Props = { ...initialProps, onDrop, onFileDrop }

    hostConfig.commitUpdate(instance, "div", initialProps, bothProps, null)
    expect(renderer.eventListeners).toEqual([
      [instance.id, "drop", true],
      [instance.id, "fileDrop", true],
    ])
    expect(container.eventHandlers.get(instance.id)?.get("drop")).toBe(onDrop)
    expect(container.eventHandlers.get(instance.id)?.get("fileDrop")).toBe(onFileDrop)

    renderer.eventListeners.length = 0
    const legacyOnlyProps: Props = { ...initialProps, onFileDrop }
    hostConfig.commitUpdate(instance, "div", bothProps, legacyOnlyProps, null)
    expect(renderer.eventListeners).toEqual([[instance.id, "drop", false]])
    expect(container.eventHandlers.get(instance.id)?.has("drop")).toBe(false)
    expect(container.eventHandlers.get(instance.id)?.get("fileDrop")).toBe(onFileDrop)
  })
})

describeNative("mutation lifecycle", () => {
  it("renders structural JSX aliases as native divs", () => {
    const { render, renderer, unmount } = createTestRoot()

    try {
      render(
        <section data-testid="content">
          <text>content</text>
        </section>
      )

      expect(renderer.findByTestId("content")?.type).toBe("div")
      expect(renderer.findByType("section")).toEqual([])
    } finally {
      unmount()
    }
  })

  it("does not paint host nodes from an abandoned Suspense render", () => {
    const { render, renderer, unmount } = createTestRoot()
    const pending = new Promise<never>(() => {})

    function Suspend(): never {
      throw pending
    }

    try {
      render(
        <Suspense fallback={<text>fallback</text>}>
          <div>
            <text>abandoned</text>
          </div>
          <Suspend />
        </Suspense>
      )

      expect(renderer.getPaintedText()).toEqual(["fallback"])
    } finally {
      unmount()
    }
  })

  it("keeps unchanged event handlers registered across renders", () => {
    const { render, renderer, unmount } = createTestRoot()
    const onClick = vi.fn()
    const clickable = (
      <div style={{ width: 100, height: 100 }} onClick={onClick}>
        click
      </div>
    )

    try {
      render(clickable)
      renderer.nativeSimulateClick(10, 10)
      render(clickable)
      renderer.nativeSimulateClick(10, 10)

      expect(onClick).toHaveBeenCalledTimes(2)
    } finally {
      unmount()
    }
  })

  it("keeps element ids and click handlers isolated across live roots", () => {
    const a = createTestRoot()
    const b = createTestRoot()
    const onA = vi.fn()
    const onB = vi.fn()

    try {
      a.render(
        <div style={{ width: 100, height: 100 }} onClick={onA}>
          a
        </div>
      )
      b.render(
        <div style={{ width: 100, height: 100 }} onClick={onB}>
          b
        </div>
      )

      expect(a.renderer.findByType("text")[0]?.id).toBe(1)
      expect(b.renderer.findByType("text")[0]?.id).toBe(1)
      expect(a.renderer.getRoot()?.id).toBe(2)
      expect(b.renderer.getRoot()?.id).toBe(2)

      const click = { elementId: 2, eventType: "click" }
      handleGpuixEvent(click, a.renderer)
      expect(onA).toHaveBeenCalledTimes(1)
      expect(onB).not.toHaveBeenCalled()

      handleGpuixEvent(click, b.renderer)
      expect(onA).toHaveBeenCalledTimes(1)
      expect(onB).toHaveBeenCalledTimes(1)
    } finally {
      a.unmount()
      b.unmount()
    }
  })

  it("creates a working offscreen root after disposing the previous root", () => {
    const first = createTestRoot()
    first.render(<div style={{ width: 100, height: 100 }}>first</div>)
    first.unmount()

    expect(() => first.renderer.flush()).toThrow("TestGpuixRenderer has been disposed")

    const second = createTestRoot()
    const onClick = vi.fn()
    try {
      second.render(
        <div style={{ width: 100, height: 100 }} onClick={onClick}>
          second
        </div>
      )
      second.renderer.nativeSimulateClick(10, 10)

      expect(onClick).toHaveBeenCalledTimes(1)
    } finally {
      second.unmount()
    }
  })

  it("does not give a remounted root the old element ids", () => {
    const renderer = new TestRenderer()
    const first = createRoot(renderer)
    const onFirst = vi.fn()
    const onSecond = vi.fn()
    const tree = (onClick: () => void) => (
      <div style={{ width: 100, height: 100 }} onClick={onClick}>
        row
      </div>
    )

    flushSync(() => first.render(tree(onFirst)))
    renderer.flush()
    const firstRootId = renderer.getRoot()?.id
    expect(firstRootId).toBe(2)
    first.unmount()

    const second = createRoot(renderer)
    try {
      flushSync(() => second.render(tree(onSecond)))
      renderer.flush()
      expect(renderer.getRoot()?.id).not.toBe(firstRootId)

      handleGpuixEvent({ elementId: firstRootId!, eventType: "click" }, renderer)
      expect(onSecond).not.toHaveBeenCalled()
    } finally {
      second.unmount()
    }
  })

  // React calls `detachDeletedInstance` only for host components, never for a
  // host text node, so a removed string used to stay in the retained tree with
  // no parent and no way back to it.
  it("frees a removed text node instead of leaking it", () => {
    const { render, renderer, unmount } = createTestRoot()

    try {
      render(<div style={{ width: 100, height: 100 }}>{"hello"}</div>)
      const withText = renderer.getRetainedElementCount()

      render(<div style={{ width: 100, height: 100 }}>{null}</div>)
      expect(renderer.getAllText()).toEqual([])
      expect(renderer.getRetainedElementCount()).toBe(withText - 1)

      // A whole removed subtree frees every node in it, not just its root.
      render(
        <div style={{ width: 100, height: 100 }}>
          <div>
            <text>deep</text>
          </div>
        </div>
      )
      const withSubtree = renderer.getRetainedElementCount()
      expect(withSubtree).toBe(withText + 2)

      render(<div style={{ width: 100, height: 100 }}>{null}</div>)
      expect(renderer.getRetainedElementCount()).toBe(withText - 1)
    } finally {
      unmount()
    }
  })

  it("refuses a second simultaneous root on one renderer", () => {
    const renderer = new TestRenderer()
    const first = createRoot(renderer)
    const onFirst = vi.fn()

    try {
      flushSync(() =>
        first.render(
          <div style={{ width: 100, height: 100 }} onClick={onFirst}>
            first
          </div>
        )
      )
      renderer.flush()

      expect(() => createRoot(renderer)).toThrowErrorMatchingInlineSnapshot(
        `[Error: This renderer already drives a mounted GPUIX root. One renderer owns one window, one native root id, and one event map, so a second root would silently take both over. Unmount the first root first.]`
      )

      // The rejected root must not have disturbed the live one.
      handleGpuixEvent({ elementId: renderer.getRoot()!.id, eventType: "click" }, renderer)
      expect(onFirst).toHaveBeenCalledTimes(1)
    } finally {
      first.unmount()
    }
  })

  it("allows a new root once the previous one unmounts", () => {
    const renderer = new TestRenderer()
    const first = createRoot(renderer)
    flushSync(() => first.render(<text>first</text>))
    renderer.flush()
    first.unmount()

    const second = createRoot(renderer)
    const onSecond = vi.fn()
    try {
      flushSync(() =>
        second.render(
          <div style={{ width: 100, height: 100 }} onClick={onSecond}>
            second
          </div>
        )
      )
      renderer.flush()
      handleGpuixEvent({ elementId: renderer.getRoot()!.id, eventType: "click" }, renderer)
      expect(onSecond).toHaveBeenCalledTimes(1)
    } finally {
      second.unmount()
    }
  })
})
