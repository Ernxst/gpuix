import React from "react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  createTestRoot,
  isNativeTestRendererAvailable,
  type TestRoot,
} from "../testing.js"
import type { PublicInstance } from "../types/host.js"

const describeNative = isNativeTestRendererAvailable() ? describe : describe.skip

describeNative("PublicInstance.matches", () => {
  let testRoot: TestRoot

  beforeEach(() => {
    testRoot = createTestRoot()
  })

  afterEach(() => {
    testRoot.unmount()
  })

  it("reports focus and focus-visible for keyboard and pointer focus", () => {
    const keyboardRef = React.createRef<PublicInstance>()
    const pointerRef = React.createRef<PublicInstance>()

    testRoot.render(
      <div style={{ width: 400, height: 120, padding: 20 }}>
        <div ref={keyboardRef} tabIndex={0} style={{ width: 160, height: 40 }} />
        <div ref={pointerRef} tabIndex={0} style={{ width: 160, height: 40 }} />
      </div>,
    )

    testRoot.renderer.simulateKeystrokes("tab")
    expect(keyboardRef.current!.matches(":focus")).toBe(true)
    expect(keyboardRef.current!.matches(":focus-visible")).toBe(true)

    const pointerBounds = testRoot.renderer.getElementBounds(pointerRef.current!.id)!
    testRoot.renderer.nativeSimulateClick(
      pointerBounds.x + pointerBounds.width / 2,
      pointerBounds.y + pointerBounds.height / 2,
    )

    expect(keyboardRef.current!.matches(":focus")).toBe(false)
    expect(pointerRef.current!.matches(":focus")).toBe(true)
    expect(pointerRef.current!.matches(":focus-visible")).toBe(false)
  })

  it("reports styled hover and agrees with the applied hover state", () => {
    const targetRef = React.createRef<PublicInstance>()

    testRoot.render(
      <div style={{ width: 400, height: 120, padding: 20 }}>
        <div
          ref={targetRef}
          style={{
            width: 160,
            height: 40,
            backgroundColor: "#333333",
            hover: { backgroundColor: "#667788" },
          }}
        />
      </div>,
    )

    const target = targetRef.current!
    const bounds = testRoot.renderer.getElementBounds(target.id)!
    expect(target.matches(":hover")).toBe(false)
    expect(testRoot.renderer.getResolvedStyle(target.id)).toMatchObject({
      backgroundColor: "#333333",
    })

    testRoot.renderer.nativeSimulateMouseMove(
      bounds.x + bounds.width / 2,
      bounds.y + bounds.height / 2,
    )

    expect(target.matches(":hover")).toBe(true)
    expect(testRoot.renderer.getResolvedStyle(target.id)).toMatchObject({
      backgroundColor: "#667788",
    })
  })

  it("reports hover for an untracked element and its ancestor from painted bounds", () => {
    const ancestorRef = React.createRef<PublicInstance>()
    const plainRef = React.createRef<PublicInstance>()

    testRoot.render(
      <div
        ref={ancestorRef}
        style={{ width: 400, height: 120, padding: 20 }}
      >
        <div ref={plainRef} style={{ width: 160, height: 40 }} />
      </div>,
    )

    const plain = plainRef.current!
    const bounds = testRoot.renderer.getElementBounds(plain.id)!
    testRoot.renderer.nativeSimulateMouseMove(
      bounds.x + bounds.width / 2,
      bounds.y + bounds.height / 2,
    )

    expect(plain.matches(":hover")).toBe(true)
    expect(ancestorRef.current!.matches(":hover")).toBe(true)
  })

  it("reports active only while the pointer is pressed", () => {
    const targetRef = React.createRef<PublicInstance>()

    testRoot.render(
      <div style={{ width: 400, height: 120, padding: 20 }}>
        <div
          ref={targetRef}
          style={{ width: 160, height: 40, active: { opacity: 0.5 } }}
        />
      </div>,
    )

    const target = targetRef.current!
    const bounds = testRoot.renderer.getElementBounds(target.id)!
    const x = bounds.x + bounds.width / 2
    const y = bounds.y + bounds.height / 2

    expect(target.matches(":active")).toBe(false)
    testRoot.renderer.nativeSimulateMouseDown(x, y)
    expect(target.matches(":active")).toBe(true)
    testRoot.renderer.nativeSimulateMouseUp(x, y)
    expect(target.matches(":active")).toBe(false)
  })

  it("uses painted bounds for hover when only active is tracked", () => {
    const targetRef = React.createRef<PublicInstance>()

    testRoot.render(
      <div style={{ width: 400, height: 120, padding: 20 }}>
        <div
          ref={targetRef}
          style={{ width: 160, height: 40, active: { opacity: 0.5 } }}
        />
      </div>,
    )

    const target = targetRef.current!
    const bounds = testRoot.renderer.getElementBounds(target.id)!
    const x = bounds.x + bounds.width / 2
    const y = bounds.y + bounds.height / 2

    testRoot.renderer.nativeSimulateMouseMove(x, y)
    testRoot.renderer.nativeSimulateMouseDown(x, y)
    testRoot.renderer.nativeSimulateMouseUp(x, y)

    expect(target.matches(":hover")).toBe(true)
  })

  it("clears active when the active style is removed during a press", () => {
    const targetRef = React.createRef<PublicInstance>()

    testRoot.render(
      <div style={{ width: 400, height: 120, padding: 20 }}>
        <div
          ref={targetRef}
          style={{ width: 160, height: 40, active: { opacity: 0.5 } }}
        />
      </div>,
    )

    const target = targetRef.current!
    const bounds = testRoot.renderer.getElementBounds(target.id)!
    const x = bounds.x + bounds.width / 2
    const y = bounds.y + bounds.height / 2

    testRoot.renderer.nativeSimulateMouseDown(x, y)
    expect(target.matches(":active")).toBe(true)

    testRoot.render(
      <div style={{ width: 400, height: 120, padding: 20 }}>
        <div ref={targetRef} style={{ width: 160, height: 40 }} />
      </div>,
    )

    expect(targetRef.current!.matches(":active")).toBe(false)
  })

  it("rejects selectors outside the supported state pseudo-classes", () => {
    const targetRef = React.createRef<PublicInstance>()
    testRoot.render(<div ref={targetRef} style={{ width: 100, height: 40 }} />)

    const message = (selector: string) =>
      `Failed to execute 'matches' on 'Element': '${selector}' is not a supported selector. ` +
      "Supported: :focus, :focus-visible, :hover, :active."

    for (const selector of ["div", ":focus-within"]) {
      let thrown: unknown
      try {
        targetRef.current!.matches(selector)
      } catch (error) {
        thrown = error
      }
      expect(thrown).toBeInstanceOf(SyntaxError)
      expect(thrown).toMatchObject({ name: "SyntaxError", message: message(selector) })
    }
  })

  it("returns false for every selector on a detached instance", () => {
    const targetRef = React.createRef<PublicInstance>()
    testRoot.render(<div ref={targetRef} style={{ width: 100, height: 40 }} />)
    const detached = targetRef.current!

    testRoot.render(<div style={{ width: 100, height: 40 }} />)

    expect(detached.matches(":focus")).toBe(false)
    expect(detached.matches(":focus-visible")).toBe(false)
    expect(detached.matches(":hover")).toBe(false)
    expect(detached.matches(":active")).toBe(false)
  })
})
