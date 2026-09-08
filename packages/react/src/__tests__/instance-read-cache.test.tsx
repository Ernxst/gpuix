import React from "react"
import { describe, expect, it } from "vitest"

import { createTestRoot, isNativeTestRendererAvailable } from "../testing.js"
import { flushSync } from "../reconciler/reconciler.js"

const describeNative = isNativeTestRendererAvailable() ? describe : describe.skip

describeNative("instance reads reuse a clean rendered frame", () => {
  it("does not draw repeated bounds and client-rect reads", () => {
    const root = createTestRoot()
    try {
      root.render(
        <div style={{ width: 500, height: 120, padding: 10 }}>
          <div data-testid="first" style={{ width: 100, height: 30 }} />
          <div data-testid="second" style={{ width: 140, height: 40 }} />
          <div data-testid="third" style={{ width: 180, height: 50 }} />
        </div>,
      )

      root.renderer.resetDebugFrameOverlayStats()
      const elements = [
        root.renderer.findByTestId("first")!,
        root.renderer.findByTestId("second")!,
        root.renderer.findByTestId("third")!,
      ]
      expect(root.renderer.getElementBounds(elements[0]!.id)).toEqual([10, 10, 100, 30])
      const framesAfterFirstRead = root.renderer.getDebugFrameOverlayStats().frames

      for (let iteration = 0; iteration < 10; iteration += 1) {
        for (const element of elements) {
          expect(root.renderer.getElementBounds(element.id)).not.toBeNull()
          expect(element.getBoundingClientRect().width).toBeGreaterThan(0)
        }
      }

      expect(root.renderer.getDebugFrameOverlayStats().frames).toBe(framesAfterFirstRead)
    } finally {
      root.unmount()
    }
  })

  it("draws once when a rerender changes an element's bounds", () => {
    const root = createTestRoot()
    try {
      root.render(<div data-testid="target" style={{ width: 100, height: 40 }} />)
      const target = root.renderer.findByTestId("target")!
      expect(root.renderer.getElementBounds(target.id)?.[2]).toBe(100)
      root.renderer.resetDebugFrameOverlayStats()

      flushSync(() => {
        root.root.render(<div data-testid="target" style={{ width: 240, height: 40 }} />)
      })
      const framesBeforeChangedRead = root.renderer.getDebugFrameOverlayStats().frames
      expect(target.getBoundingClientRect().width).toBe(240)
      const framesAfterChangedRead = root.renderer.getDebugFrameOverlayStats().frames
      expect(root.renderer.getElementBounds(target.id)?.[2]).toBe(240)
      expect(root.renderer.getDebugFrameOverlayStats().frames).toBe(framesAfterChangedRead)
      expect(framesAfterChangedRead - framesBeforeChangedRead).toBe(1)
    } finally {
      root.unmount()
    }
  })

  it("draws a pending resize before reading percentage geometry", () => {
    const root = createTestRoot({ width: 320, height: 200 })
    try {
      root.render(<div data-testid="target" style={{ width: "100%", height: 40 }} />)
      const target = root.renderer.findByTestId("target")!
      expect(target.getBoundingClientRect().width).toBe(320)

      root.renderer.simulateResize(180, 200)
      expect(target.getBoundingClientRect().width).toBe(180)
    } finally {
      root.unmount()
    }
  })

  it("draws a pending transition before reading resolved style", () => {
    const root = createTestRoot()
    try {
      root.renderer.clockPause()
      const card = (expanded: boolean) => (
        <div
          data-testid="target"
          style={{
            width: expanded ? 200 : 100,
            height: 40,
            transition: { properties: ["width"], durationMs: 100, easing: "linear" },
          }}
        />
      )

      root.render(card(false))
      const target = root.renderer.findByTestId("target")!
      root.renderer.getResolvedStyle(target.id)
      root.render(card(true))
      root.renderer.advanceAsyncClock(50)

      expect(root.renderer.getResolvedStyle(target.id)?.width).toBe(150)
    } finally {
      root.unmount()
    }
  })

  it("draws the hover invalidation before reading hovered geometry", () => {
    const root = createTestRoot()
    try {
      root.render(
        <div
          data-testid="target"
          style={{ width: 100, height: 40, hover: { width: 220 } }}
        />,
      )
      const target = root.renderer.findByTestId("target")!
      expect(target.getBoundingClientRect().width).toBe(100)

      root.renderer.nativeSimulateMouseMove(20, 20)

      expect(root.renderer.getElementBounds(target.id)?.[2]).toBe(220)
    } finally {
      root.unmount()
    }
  })
})
