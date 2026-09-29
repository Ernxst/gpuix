import React from "react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { Button } from "../components/button.js"
import { Dialog, DialogPopup, DialogPortal, DialogTrigger, DialogTitle } from "../components/dialog.js"
import { Select, SelectItem, SelectPopup, SelectTrigger } from "../components/select.js"
import { createTestRoot, isNativeTestRendererAvailable, type TestRoot } from "../testing.js"
import type { PublicInstance } from "../types/host.js"

const describeNative = isNativeTestRendererAvailable() ? describe : describe.skip

describeNative("Dialog", () => {
  let screen: TestRoot

  beforeEach(() => {
    screen = createTestRoot({ width: 480, height: 320, strictStyles: false })
  })

  afterEach(() => screen.renderer.dispose())

  it("cycles Tab and Shift+Tab within a modal popup", () => {
    const first = React.createRef<PublicInstance>()
    const last = React.createRef<PublicInstance>()
    screen.render(
      <Dialog defaultOpen>
        <DialogPortal>
          <DialogPopup>
            <DialogTitle>Confirm</DialogTitle>
            <button ref={first} ariaLabel="First" />
            <button ref={last} ariaLabel="Last" />
          </DialogPopup>
        </DialogPortal>
      </Dialog>
    )

    expect(screen.renderer.getActiveElement()).toBeDefined()
    screen.renderer.focusElement(last.current!.id)
    screen.renderer.simulateKeystrokes("tab")
    expect(screen.renderer.getActiveElement()).toBe(first.current!.id)
    screen.renderer.simulateKeystrokes("shift-tab")
    expect(screen.renderer.getActiveElement()).toBe(last.current!.id)
  })

  it("opens a Dialog.Trigger with Enter and Space", () => {
    const trigger = React.createRef<PublicInstance>()
    screen.render(
      <Dialog>
        <DialogTrigger ref={trigger} ariaLabel="Open dialog" />
        <DialogPortal>
          <DialogPopup><DialogTitle>Keyboard dialog</DialogTitle></DialogPopup>
        </DialogPortal>
      </Dialog>
    )

    screen.renderer.focusElement(trigger.current!.id)
    screen.renderer.simulateKeystrokes("enter")
    expect(screen.getByRole("dialog", { name: "Keyboard dialog" })).toBeDefined()
    screen.renderer.simulateKeystrokes("escape")
    screen.renderer.focusElement(trigger.current!.id)
    screen.renderer.simulateKeystrokes("space")
    expect(screen.getByRole("dialog", { name: "Keyboard dialog" })).toBeDefined()
  })

  it("dispatches keyboard button activation as a bubbling click event", () => {
    const button = React.createRef<PublicInstance>()
    const events: string[] = []
    let clickInputSource: string | undefined
    screen.render(
      <div onClickCapture={() => events.push("capture")} onClick={() => events.push("bubble")}>
        <Button
          ref={button}
          onClick={(event) => {
            events.push(event.type)
            clickInputSource = event.inputSource
          }}
        >
          Save
        </Button>
      </div>
    )

    screen.renderer.focusElement(button.current!.id)
    screen.renderer.simulateKeystrokes("enter")

    expect(events).toEqual(["capture", "click", "bubble"])
    expect(clickInputSource).toBe("keyboard")
  })

  it("can disable shared Tab navigation at the root", () => {
    const root = createTestRoot({ tabNavigation: false })
    try {
      const first = React.createRef<PublicInstance>()
      root.render(<><button ref={first} ariaLabel="First" /><button ariaLabel="Second" /></>)
      root.renderer.focusElement(first.current!.id)
      root.renderer.simulateKeystrokes("tab")
      expect(root.renderer.getActiveElement()).toBe(first.current!.id)
    } finally {
      root.renderer.dispose()
    }
  })

  it("closes only the topmost open layer on Escape", () => {
    const selectPopup = React.createRef<PublicInstance>()
    screen.render(
      <Dialog defaultOpen>
        <DialogPortal>
          <DialogPopup>
            <DialogTitle>Outer</DialogTitle>
            <Select defaultOpen>
              <SelectTrigger ariaLabel="Choose" />
              <SelectPopup ref={selectPopup}>
                <SelectItem value="one">One</SelectItem>
              </SelectPopup>
            </Select>
          </DialogPopup>
        </DialogPortal>
      </Dialog>
    )

    screen.renderer.focusElement(selectPopup.current!.id)
    screen.renderer.simulateKeystrokes("escape")
    expect(screen.getByRole("dialog", { name: "Outer" })).toBeDefined()
    expect(screen.queryByRole("option", { name: "One" })).toBeNull()
    screen.renderer.simulateKeystrokes("escape")
    expect(screen.queryByRole("dialog", { name: "Outer" })).toBeNull()
  })

  it("restores focus to a nested dialog trigger when the top layer closes", () => {
    const nestedTrigger = React.createRef<PublicInstance>()
    const nestedPopup = React.createRef<PublicInstance>()
    screen.render(
      <Dialog defaultOpen>
        <DialogPortal>
          <DialogPopup>
            <DialogTitle>Outer</DialogTitle>
            <Dialog defaultOpen>
              <DialogTrigger ref={nestedTrigger} ariaLabel="Open nested" />
              <DialogPortal>
                <DialogPopup ref={nestedPopup}>
                  <DialogTitle>Nested</DialogTitle>
                  <input ariaLabel="Nested field" />
                </DialogPopup>
              </DialogPortal>
            </Dialog>
          </DialogPopup>
        </DialogPortal>
      </Dialog>
    )

    expect(screen.renderer.getActiveElement()).toBe(nestedPopup.current!.id)
    screen.renderer.simulateKeystrokes("escape")
    expect(screen.queryByRole("dialog", { name: "Nested" })).toBeNull()
    expect(screen.getByRole("dialog", { name: "Outer" })).toBeDefined()
    expect(screen.renderer.getActiveElement()).toBe(nestedTrigger.current!.id)
  })

  it("focuses initialFocus and restores finalFocus", () => {
    const trigger = React.createRef<PublicInstance>()
    const initial = React.createRef<PublicInstance>()
    const final = React.createRef<PublicInstance>()
    function Fixture({ open }: { open: boolean }) {
      return (
        <>
          <Dialog open={open}>
            <DialogTrigger ref={trigger} ariaLabel="Open" />
            <DialogPortal>
              <DialogPopup initialFocus={initial} finalFocus={final}>
                <button ref={initial} ariaLabel="Initial" />
              </DialogPopup>
            </DialogPortal>
          </Dialog>
          <button ref={final} ariaLabel="Final" />
        </>
      )
    }

    screen.render(<Fixture open />)
    expect(screen.renderer.getActiveElement()).toBe(initial.current!.id)
    screen.render(<Fixture open={false} />)
    expect(screen.renderer.getActiveElement()).toBe(final.current!.id)
  })

  it("exposes modal semantics in the accessibility tree", () => {
    screen.render(
      <Dialog defaultOpen>
        <DialogPortal>
          <DialogPopup>
            <DialogTitle>Accessible dialog</DialogTitle>
            <text>Contents</text>
          </DialogPopup>
        </DialogPortal>
      </Dialog>
    )
    screen.renderer.drawPendingFrame()
    const dialog = Object.values(screen.renderer.getAccessibilityTree().nodes).find(
      (node) => node.aria.role === "Dialog"
    )
    expect(dialog?.aria.modal).toBe(true)
  })

  it("accepts aria-modal on dialog roles and removes it when false", () => {
    screen.render(<div role="dialog" aria-modal="true" ariaLabel="Standard dialog" />)
    screen.renderer.drawPendingFrame()
    let dialog = Object.values(screen.renderer.getAccessibilityTree().nodes).find(
      (node) => node.aria.role === "Dialog"
    )
    expect(dialog?.aria.modal).toBe(true)

    screen.render(<div role="dialog" ariaModal={false} ariaLabel="Standard dialog" />)
    screen.renderer.drawPendingFrame()
    dialog = Object.values(screen.renderer.getAccessibilityTree().nodes).find(
      (node) => node.aria.role === "Dialog"
    )
    expect(dialog?.aria.role).toBe("Dialog")
    expect(dialog?.aria.modal).not.toBe(true)
  })

  it("exposes modal semantics on alert dialogs and anchored hosts", () => {
    screen.render(
      <>
        <div role="alertdialog" ariaModal="true" ariaLabel="Alert" />
        <anchored role="dialog" aria-modal="true" ariaLabel="Anchored dialog" />
      </>
    )
    screen.renderer.drawPendingFrame()
    const nodes = Object.values(screen.renderer.getAccessibilityTree().nodes)
    expect(nodes.find((node) => node.aria.role === "AlertDialog")?.aria.modal).toBe(true)
    expect(nodes.find((node) => node.aria.role === "Dialog")?.aria.modal).toBe(true)
  })
})
