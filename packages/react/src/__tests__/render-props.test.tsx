import React, { createRef } from "react"
import { mergeProps } from "@base-ui/react/merge-props"
import { afterEach, describe, expect, it, vi } from "vitest"
import * as TooltipPrimitive from "@gpuix/react/tooltip"
import { Dialog } from "@gpuix/react/dialog"
import * as Select from "@gpuix/react/select"
import * as Combobox from "@gpuix/react/combobox"
import { FloatingPositioner, renderSlot } from "../components/floating.js"
import { createTestRoot, isNativeTestRendererAvailable, type TestRoot } from "../testing.js"
import type { PublicInstance } from "../types/host.js"

const describeNative = isNativeTestRendererAvailable() ? describe : describe.skip

function compiled(style: Record<string, unknown>) {
  return Object.defineProperty({ ...style }, Symbol.for("gpuix.compiledStyle"), {
    value: true,
  }) as unknown as string
}

describeNative("render element props", () => {
  let testRoot: TestRoot

  afterEach(() => {
    testRoot?.unmount()
    vi.restoreAllMocks()
  })

  it("preserves a render element class through the documented Tooltip entry point", () => {
    testRoot = createTestRoot()
    const navLink = compiled({ color: "blue" })
    testRoot.render(
      <TooltipPrimitive.Tooltip.Root>
        <TooltipPrimitive.Tooltip.Trigger render={<a className={navLink} href="/" data-testid="render-trigger">Map</a>} />
      </TooltipPrimitive.Tooltip.Root>,
    )

    const element = testRoot.getByTestId("render-trigger")
    expect(testRoot.renderer.getResolvedStyle(element.id)).toMatchObject({ color: "blue" })
  })

  it("keeps a string class when the part class is undefined", () => {
    const merged = renderSlot({
      asChild: true,
      children: <a className="navLink" href="/">Map</a>,
      props: { className: undefined },
    })

    expect(merged.props.className).toBe("navLink")
  })

  it("preserves the render element, part, and forwarded refs", () => {
    const refs: string[] = []
    const instance = {} as PublicInstance
    const merged = renderSlot({
      asChild: true,
      children: <a ref={() => refs.push("render")} />,
      props: { ref: () => refs.push("part") },
      ref: () => refs.push("forwarded"),
    })

    ;(merged.props.ref as (value: PublicInstance) => void)(instance)
    expect(refs).toEqual(["render", "part", "forwarded"])
  })

  it("calls a shared part and forwarded ref only once", () => {
    const refs: string[] = []
    const sharedRef = () => refs.push("shared")
    const merged = renderSlot({
      asChild: true,
      children: <a ref={() => refs.push("render")} />,
      props: { ref: sharedRef },
      ref: sharedRef,
    })

    ;(merged.props.ref as (value: PublicInstance) => void)({} as PublicInstance)
    expect(refs).toEqual(["render", "shared"])
  })

  it("calls FloatingPositioner's forwarded ref once for an element render", () => {
    testRoot = createTestRoot()
    const forwardedRef = vi.fn()
    testRoot.render(
      <FloatingPositioner
        ref={forwardedRef}
        render={<div data-testid="positioner-render" />}
      />,
    )

    expect(testRoot.getByTestId("positioner-render")).toBeTruthy()
    expect(forwardedRef).toHaveBeenCalledTimes(1)
  })

  it("matches the installed Base UI className and style merge order", () => {
    const merged = mergeProps(
      { className: "part", style: { color: "red", backgroundColor: "green" } },
      { className: "navLink", style: { color: "blue" } },
    )

    expect(merged.className).toBe("navLink part")
    expect(merged.style).toEqual({ color: "blue", backgroundColor: "green" })
  })

  it("lets a render element prevent the part event handler", () => {
    const events: string[] = []
    const merged = renderSlot({
      asChild: true,
      children: (
        <button
          onClick={(event) => {
            events.push("render")
            const preventBaseUIHandler = (event as unknown as { preventBaseUIHandler?: () => void }).preventBaseUIHandler
            preventBaseUIHandler?.()
          }}
        />
      ),
      props: { onClick: () => events.push("part") },
    })

    const onClick = merged.props.onClick as (event: { nativeEvent: object }) => void
    onClick({ nativeEvent: {} })
    expect(events).toEqual(["render"])
  })

  it("merges Tooltip render props in Base UI order, including refs and handlers", () => {
    testRoot = createTestRoot()
    const childRef = createRef<PublicInstance>()
    const triggerRef = createRef<PublicInstance>()
    const events: string[] = []
    const childClass = compiled({ color: "blue", backgroundColor: "black" })
    const partClass = compiled({ color: "red" })

    testRoot.render(
      <div style={{ width: 240, height: 80 }}>
        <TooltipPrimitive.Tooltip.Root>
          <TooltipPrimitive.Tooltip.Trigger
            ref={triggerRef}
            className={() => partClass}
            style={{ backgroundColor: "green" }}
            onMouseEnter={() => events.push("part")}
            render={
              <a
                ref={childRef as React.Ref<HTMLAnchorElement>}
                className={childClass}
                style={{ backgroundColor: "white" }}
                data-testid="merged-trigger"
                onMouseEnter={() => events.push("render")}
                href="/"
              >
                Map
              </a>
            }
          />
        </TooltipPrimitive.Tooltip.Root>
      </div>,
    )

    const element = testRoot.getByTestId("merged-trigger")
    expect(childRef.current).toBe(triggerRef.current)
    expect(testRoot.renderer.getResolvedStyle(element.id)).toMatchObject({
      color: "red",
      backgroundColor: "white",
    })

    const bounds = childRef.current!.getBoundingClientRect()
    testRoot.renderer.nativeSimulateMouseMove(bounds.x + 4, bounds.y + 4)
    expect(events).toEqual(["render", "part"])
  })

  it("uses the same class and style merge for Dialog's separate render path", () => {
    testRoot = createTestRoot()
    const childClass = compiled({ color: "blue", backgroundColor: "black" })
    const partClass = compiled({ color: "red" })

    testRoot.render(
      <Dialog.Root>
        <Dialog.Trigger
          className={partClass}
          style={{ backgroundColor: "green" }}
          render={
            <button
              className={childClass}
              style={{ backgroundColor: "white" }}
              data-testid="dialog-trigger"
            >
              Open
            </button>
          }
        />
      </Dialog.Root>,
    )

    const element = testRoot.getByTestId("dialog-trigger")
    expect(testRoot.renderer.getResolvedStyle(element.id)).toMatchObject({
      color: "red",
      backgroundColor: "white",
    })
  })

  it("preserves render element classes through Select parts", () => {
    testRoot = createTestRoot()
    const triggerClass = compiled({ color: "blue" })
    testRoot.render(
      <Select.Root>
        <Select.Trigger render={<button className={triggerClass} data-testid="select-trigger" />} />
      </Select.Root>,
    )

    const element = testRoot.getByTestId("select-trigger")
    expect(testRoot.renderer.getResolvedStyle(element.id)).toMatchObject({ color: "blue" })
  })

  it("preserves render element classes through Combobox parts", () => {
    testRoot = createTestRoot()
    const inputClass = compiled({ color: "blue" })
    testRoot.render(
      <Combobox.Root items={[]}>
        <Combobox.Input render={<input className={inputClass} data-testid="combobox-input" />} />
      </Combobox.Root>,
    )

    const element = testRoot.getByTestId("combobox-input")
    expect(testRoot.renderer.getResolvedStyle(element.id)).toMatchObject({ color: "blue" })
  })
})
