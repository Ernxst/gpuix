import "../globals.js"

import React, { useState } from "react"
import { describe, expect, it } from "vitest"

import { __observerCountForRenderer, ResizeObserver } from "../resize-observer.js"
import { act, createTestRoot, isNativeTestRendererAvailable } from "../testing.js"
import type { PublicInstance } from "../types/host.js"

const describeNative = isNativeTestRendererAvailable() ? describe : describe.skip

function paint(root: ReturnType<typeof createTestRoot>): void {
  root.renderer.flush()
  root.renderer.dispatchNativeEvents()
}

describeNative("ResizeObserver", () => {
  it("delivers the initial border and content sizes after paint", () => {
    const root = createTestRoot({ scaleFactor: 2 })
    const target = React.createRef<PublicInstance>()
    const callbacks: ResizeObserverEntry[][] = []

    try {
      root.render(
        <div
          ref={target}
          style={{ width: 100, height: 40, padding: 5, borderWidth: 2, borderStyle: "solid" }}
        />
      )
      expect(globalThis.ResizeObserver).toBeDefined()
      const observer = new ResizeObserver((entries) => callbacks.push(entries))
      observer.observe(target.current!)
      paint(root)

      expect(callbacks).toHaveLength(1)
      const entry = callbacks[0]![0]!
      expect(entry.target).toBe(target.current)
      expect(entry.borderBoxSize[0]).toEqual({ inlineSize: 100, blockSize: 40 })
      expect(entry.contentBoxSize[0]).toEqual({ inlineSize: 86, blockSize: 26 })
      expect(entry.devicePixelContentBoxSize[0]).toEqual({ inlineSize: 172, blockSize: 52 })
      expect(entry.contentRect).toEqual({
        x: 5,
        y: 5,
        width: 86,
        height: 26,
        top: 5,
        left: 5,
        right: 91,
        bottom: 31,
      })
      expect(Object.isFrozen(entry.borderBoxSize)).toBe(true)
      expect(Object.isFrozen(entry.contentBoxSize)).toBe(true)
      expect(Object.isFrozen(entry.devicePixelContentBoxSize)).toBe(true)
    } finally {
      root.unmount()
    }
  })

  it("reports descendant-driven changes once and stays quiet while unchanged", () => {
    const root = createTestRoot()
    const target = React.createRef<PublicInstance>()
    const callbacks: ResizeObserverEntry[][] = []
    let setTall!: (tall: boolean) => void
    let observedRenders = 0

    function ResizedChild() {
      const [tall, updateTall] = useState(false)
      setTall = updateTall
      return <div style={{ width: 100, height: tall ? 60 : 20 }} />
    }

    function Observed() {
      observedRenders += 1
      return (
        <div ref={target} style={{ display: "flex", width: 300 }}>
          <ResizedChild />
        </div>
      )
    }

    try {
      root.render(<Observed />)
      const observer = new ResizeObserver((entries) => callbacks.push(entries))
      observer.observe(target.current!)
      paint(root)
      expect(callbacks).toHaveLength(1)

      act(() => setTall(true))
      paint(root)
      expect(callbacks).toHaveLength(2)
      expect(callbacks[1]![0]!.borderBoxSize[0]!.blockSize).toBe(60)
      expect(observedRenders).toBe(1)

      paint(root)
      expect(callbacks).toHaveLength(2)
      paint(root)
      expect(callbacks).toHaveLength(2)
    } finally {
      root.unmount()
    }
  })

  it("stops delivery on unobserve and disconnect, and reports an unmounted target as zero", () => {
    const root = createTestRoot()
    const target = React.createRef<PublicInstance>()
    const callbacks: ResizeObserverEntry[][] = []
    let setMounted!: (mounted: boolean) => void
    let setWidth!: (width: number) => void

    function Fixture() {
      const [mounted, updateMounted] = useState(true)
      const [width, updateWidth] = useState(100)
      setMounted = updateMounted
      setWidth = updateWidth
      return mounted ? <div ref={target} style={{ width, height: 20 }} /> : null
    }

    try {
      root.render(<Fixture />)
      const observer = new ResizeObserver((entries) => callbacks.push(entries))
      observer.observe(target.current!)
      paint(root)
      expect(callbacks).toHaveLength(1)

      observer.unobserve(target.current!)
      act(() => setWidth(220))
      paint(root)
      expect(callbacks).toHaveLength(1)

      observer.observe(target.current!)
      paint(root)
      expect(callbacks).toHaveLength(2)
      observer.disconnect()
      expect(__observerCountForRenderer(root.renderer)).toBe(0)
      act(() => setWidth(240))
      paint(root)
      expect(callbacks).toHaveLength(2)

      const secondObserver = new ResizeObserver((entries) => callbacks.push(entries))
      observer.observe(target.current!)
      secondObserver.observe(target.current!)
      paint(root)
      const beforeUnmount = callbacks.length
      act(() => setMounted(false))
      paint(root)
      expect(callbacks.length).toBe(beforeUnmount + 2)
      expect(callbacks.at(-1)![0]!.borderBoxSize[0]).toEqual({ inlineSize: 0, blockSize: 0 })
      secondObserver.disconnect()
    } finally {
      root.unmount()
    }
  })

  it("filters padding-only changes by the selected box", () => {
    const root = createTestRoot()
    const target = React.createRef<PublicInstance>()
    const borderCallbacks: ResizeObserverEntry[][] = []
    const contentCallbacks: ResizeObserverEntry[][] = []
    let setPadding!: (padding: number) => void

    function Fixture() {
      const [padding, updatePadding] = useState(0)
      setPadding = updatePadding
      return <div ref={target} style={{ width: 100, height: 40, padding }} />
    }

    try {
      root.render(<Fixture />)
      const borderObserver = new ResizeObserver((entries) => borderCallbacks.push(entries))
      const contentObserver = new ResizeObserver((entries) => contentCallbacks.push(entries))
      borderObserver.observe(target.current!, { box: "border-box" })
      contentObserver.observe(target.current!, { box: "content-box" })
      paint(root)
      expect(borderCallbacks).toHaveLength(1)
      expect(contentCallbacks).toHaveLength(1)

      act(() => setPadding(10))
      paint(root)
      expect(borderCallbacks).toHaveLength(1)
      expect(contentCallbacks).toHaveLength(2)
    } finally {
      root.unmount()
    }
  })

  it("reports effective hover insets for content-box observations", () => {
    const root = createTestRoot()
    const target = React.createRef<PublicInstance>()
    const borderCallbacks: ResizeObserverEntry[][] = []
    const contentCallbacks: ResizeObserverEntry[][] = []

    try {
      root.render(
        <div
          ref={target}
          style={{ width: 100, height: 40, padding: 5, hover: { padding: 20 } }}
        />
      )
      const borderObserver = new ResizeObserver((entries) => borderCallbacks.push(entries))
      const contentObserver = new ResizeObserver((entries) => contentCallbacks.push(entries))
      borderObserver.observe(target.current!, { box: "border-box" })
      contentObserver.observe(target.current!, { box: "content-box" })
      paint(root)
      expect(contentCallbacks[0]![0]!.contentBoxSize[0]).toEqual({
        inlineSize: 90,
        blockSize: 30,
      })

      root.renderer.nativeSimulateMouseMove(10, 10)
      paint(root)

      expect(borderCallbacks).toHaveLength(1)
      expect(contentCallbacks).toHaveLength(2)
      expect(contentCallbacks[1]![0]!.contentBoxSize[0]).toEqual({
        inlineSize: 60,
        blockSize: 0,
      })
      borderObserver.disconnect()
      contentObserver.disconnect()
    } finally {
      root.unmount()
    }
  })

  it("resets native delivery for a second observer without a geometry change", () => {
    const root = createTestRoot()
    const target = React.createRef<PublicInstance>()
    const first: ResizeObserverEntry[][] = []
    const second: ResizeObserverEntry[][] = []

    try {
      root.render(<div ref={target} style={{ width: 100, height: 20 }} />)
      const firstObserver = new ResizeObserver((entries) => first.push(entries))
      const secondObserver = new ResizeObserver((entries) => second.push(entries))
      firstObserver.observe(target.current!)
      paint(root)
      expect(first).toHaveLength(1)

      secondObserver.observe(target.current!)
      paint(root)

      expect(first).toHaveLength(1)
      expect(second).toHaveLength(1)
      firstObserver.disconnect()
      secondObserver.disconnect()
    } finally {
      root.unmount()
    }
  })

  it("isolates callback failures and keeps later observers running", () => {
    const root = createTestRoot()
    const target = React.createRef<PublicInstance>()
    const second: ResizeObserverEntry[][] = []
    const queued: VoidFunction[] = []
    const originalQueueMicrotask = globalThis.queueMicrotask
    const failure = new Error("resize callback")

    globalThis.queueMicrotask = (callback) => {
      queued.push(callback)
    }
    try {
      root.render(<div ref={target} style={{ width: 100, height: 20 }} />)
      const firstObserver = new ResizeObserver(() => {
        throw failure
      })
      const secondObserver = new ResizeObserver((entries) => second.push(entries))
      firstObserver.observe(target.current!)
      secondObserver.observe(target.current!)
      paint(root)

      expect(second).toHaveLength(1)
      expect(queued).toHaveLength(1)
      expect(() => queued[0]!()).toThrow(failure)
      firstObserver.disconnect()
      secondObserver.disconnect()
    } finally {
      globalThis.queueMicrotask = originalQueueMicrotask
      root.unmount()
    }
  })

  it("delivers one entry to each observer and rejects non-instances", () => {
    const root = createTestRoot()
    const target = React.createRef<PublicInstance>()
    const first: ResizeObserverEntry[][] = []
    const second: ResizeObserverEntry[][] = []

    try {
      root.render(<div ref={target} style={{ width: 100, height: 20 }} />)
      const firstObserver = new ResizeObserver((entries) => first.push(entries))
      const secondObserver = new ResizeObserver((entries) => second.push(entries))
      firstObserver.observe(target.current!)
      secondObserver.observe(target.current!)
      paint(root)

      expect(first).toHaveLength(1)
      expect(second).toHaveLength(1)
      expect(first[0]).toHaveLength(1)
      expect(second[0]).toHaveLength(1)
      expect(() => firstObserver.observe({} as PublicInstance)).toThrow(TypeError)
      expect(() => firstObserver.unobserve({} as PublicInstance)).toThrow(TypeError)
    } finally {
      root.unmount()
    }
  })
})
