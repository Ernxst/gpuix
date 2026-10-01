import React from "react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { Button } from "../components/button.js"
import { AlertDialog, Dialog, DialogPopup, DialogPortal, DialogTrigger, DialogTitle } from "../components/dialog.js"
import { Select, SelectItem, SelectPopup, SelectTrigger } from "../components/select.js"
import { Combobox, ComboboxInput, ComboboxItem, ComboboxList, ComboboxPopup } from "../components/combobox.js"
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
    const close = React.createRef<PublicInstance>()
    screen.render(
      <Dialog.Root defaultOpen modal="trap-focus">
        <Dialog.Trigger ariaLabel="Open confirm dialog" />
        <Dialog.Portal>
          <Dialog.Backdrop />
          <Dialog.Viewport>
            <Dialog.Popup>
              <Dialog.Title>Confirm</Dialog.Title>
              <Dialog.Description>Confirm this action.</Dialog.Description>
              <button ref={first} ariaLabel="First" />
              <button ref={last} ariaLabel="Last" />
              <Dialog.Close ref={close}>Close</Dialog.Close>
            </Dialog.Popup>
          </Dialog.Viewport>
        </Dialog.Portal>
      </Dialog.Root>
    )

    expect(screen.renderer.getActiveElement()).toBeDefined()
    screen.renderer.focusElement(last.current!.id)
    screen.renderer.simulateKeystrokes("tab")
    expect(screen.renderer.getActiveElement()).toBe(close.current!.id)
    screen.renderer.simulateKeystrokes("shift-tab")
    expect(screen.renderer.getActiveElement()).toBe(last.current!.id)
    screen.renderer.focusElement(first.current!.id)
    screen.renderer.simulateKeystrokes("shift-tab")
    expect(screen.renderer.getActiveElement()).toBe(close.current!.id)
  })

  it("keeps focus on an empty modal popup for Tab and Shift+Tab", () => {
    const popup = React.createRef<PublicInstance>()
    screen.render(
      <Dialog defaultOpen>
        <DialogPortal>
          <DialogPopup ref={popup}>
            <DialogTitle>Empty dialog</DialogTitle>
          </DialogPopup>
        </DialogPortal>
      </Dialog>
    )

    screen.renderer.focusElement(popup.current!.id)
    screen.renderer.simulateKeystrokes("tab")
    expect(screen.renderer.getActiveElement()).toBe(popup.current!.id)
    screen.renderer.simulateKeystrokes("shift-tab")
    expect(screen.renderer.getActiveElement()).toBe(popup.current!.id)
  })

  it("contains Tab and Shift+Tab in the topmost nested Dialog", () => {
    const outerFirst = React.createRef<PublicInstance>()
    const innerFirst = React.createRef<PublicInstance>()
    const innerLast = React.createRef<PublicInstance>()
    screen.render(
      <Dialog defaultOpen>
        <DialogPortal>
          <DialogPopup>
            <DialogTitle>Outer dialog</DialogTitle>
            <button ref={outerFirst} ariaLabel="Outer first" />
            <Dialog defaultOpen>
              <DialogTrigger ariaLabel="Nested trigger" />
              <DialogPortal>
                <DialogPopup>
                  <DialogTitle>Inner dialog</DialogTitle>
                  <button ref={innerFirst} ariaLabel="Inner first" />
                  <button ref={innerLast} ariaLabel="Inner last" />
                </DialogPopup>
              </DialogPortal>
            </Dialog>
            <button ariaLabel="Outer last" />
          </DialogPopup>
        </DialogPortal>
      </Dialog>
    )

    screen.renderer.focusElement(innerLast.current!.id)
    screen.renderer.simulateKeystrokes("tab")
    expect(screen.renderer.getActiveElement()).toBe(innerFirst.current!.id)
    screen.renderer.simulateKeystrokes("shift-tab")
    expect(screen.renderer.getActiveElement()).toBe(innerLast.current!.id)
    expect(screen.renderer.getActiveElement()).not.toBe(outerFirst.current!.id)
  })

  it("moves to unrendered virtual rows at the Dialog focus boundary", () => {
    screen.render(
      <>
        <button ariaLabel="Outside dialog" />
        <Dialog defaultOpen>
          <DialogPortal>
            <DialogPopup>
              <DialogTitle>Virtual rows</DialogTitle>
              <virtual-list
                overdraw={0}
                estimatedItemHeight={40}
                style={{ width: 240, height: 120 }}
              >
                {Array.from({ length: 12 }, (_, index) => (
                  <a
                    key={index}
                    href={`/${index}`}
                    ariaLabel={`dialog-row-${index}`}
                    data-testid={`dialog-row-${index}`}
                    style={{ width: 200, height: 40, flexShrink: 0 }}
                  >
                    {`Row ${index}`}
                  </a>
                ))}
              </virtual-list>
            </DialogPopup>
          </DialogPortal>
        </Dialog>
      </>
    )

    const lastPainted = screen.renderer.findByTestId("dialog-row-2")!
    screen.renderer.focusElement(lastPainted.id)
    screen.renderer.simulateKeystrokes("tab")

    expect(screen.renderer.getActiveElement()).toBe(screen.renderer.findByTestId("dialog-row-3")!.id)
    expect(screen.renderer.getActiveElement()).not.toBe(screen.getByRole("button", { name: "Outside dialog" }).id)
  })

  it("keeps a radio group to one Tab stop inside the focus trap", () => {
    const after = React.createRef<PublicInstance>()
    screen.render(
      <Dialog defaultOpen>
        <DialogPortal>
          <DialogPopup>
            <DialogTitle>Radio group</DialogTitle>
            <input type="radio" name="choice" ariaLabel="First choice" />
            <input type="radio" name="choice" ariaLabel="Second choice" />
            <button ref={after} ariaLabel="After group" />
          </DialogPopup>
        </DialogPortal>
      </Dialog>
    )

    const radios = screen.getAllByRole("radio")
    screen.renderer.focusElement(radios[0]!.id)
    screen.renderer.simulateKeystrokes("tab")

    expect(screen.renderer.getActiveElement()).toBe(after.current!.id)
  })

  it("opens a Dialog.Trigger with Enter and Space", () => {
    const trigger = React.createRef<PublicInstance>()
    const changes: Array<{ open: boolean; reason: string }> = []
    function ControlledDialog() {
      const [open, setOpen] = React.useState(false)
      return (
        <Dialog.Root
          open={open}
          onOpenChange={(nextOpen, details) => {
            changes.push({ open: nextOpen, reason: details.reason })
            setOpen(nextOpen)
          }}
        >
          <Dialog.Trigger ref={trigger} ariaLabel="Open dialog" />
          <Dialog.Portal>
            <Dialog.Backdrop />
            <Dialog.Viewport>
              <Dialog.Popup>
                <Dialog.Title>Keyboard dialog</Dialog.Title>
                <Dialog.Description>Opened from the trigger.</Dialog.Description>
                <Dialog.Close>Close dialog</Dialog.Close>
              </Dialog.Popup>
            </Dialog.Viewport>
          </Dialog.Portal>
        </Dialog.Root>
      )
    }

    screen.render(<ControlledDialog />)

    screen.renderer.focusElement(trigger.current!.id)
    screen.renderer.simulateKeystrokes("enter")
    expect(screen.getByRole("dialog", { name: "Keyboard dialog" })).toBeDefined()
    expect(changes.at(-1)).toEqual({ open: true, reason: "trigger-press" })
    screen.renderer.simulateKeystrokes("escape")
    expect(changes.at(-1)).toEqual({ open: false, reason: "escape-key" })
    expect(screen.queryByRole("dialog", { name: "Keyboard dialog" })).toBeNull()
    expect(screen.renderer.getActiveElement()).toBe(trigger.current!.id)
    screen.renderer.focusElement(trigger.current!.id)
    screen.renderer.simulateKeystrokes("space")
    expect(screen.getByRole("dialog", { name: "Keyboard dialog" })).toBeDefined()
    screen.renderer.focusElement(screen.getByRole("button", { name: "Close dialog" }).id)
    screen.renderer.simulateKeystrokes("enter")
    expect(screen.queryByRole("dialog", { name: "Keyboard dialog" })).toBeNull()
    expect(changes.at(-1)).toEqual({ open: false, reason: "close-press" })
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

  it("closes a Combobox before its containing Dialog on Escape", () => {
    const input = React.createRef<PublicInstance>()
    screen.render(
      <Dialog defaultOpen>
        <DialogPortal>
          <DialogPopup>
            <DialogTitle>Outer</DialogTitle>
            <Combobox defaultOpen items={["Alpha"]}>
              <ComboboxInput ref={input} />
              <ComboboxPopup>
                <ComboboxList>{(item) => <ComboboxItem key={item} value={item}>{item}</ComboboxItem>}</ComboboxList>
              </ComboboxPopup>
            </Combobox>
          </DialogPopup>
        </DialogPortal>
      </Dialog>
    )

    expect(screen.renderer.getAllText()).toContain("Alpha")
    screen.renderer.focusElement(input.current!.id)
    screen.renderer.simulateKeystrokes("escape")
    expect(screen.getByRole("dialog", { name: "Outer" })).toBeDefined()
    expect(screen.renderer.getAllText()).not.toContain("Alpha")
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

  it("keeps an AlertDialog open on Escape and closes it through Close", () => {
    const close = React.createRef<PublicInstance>()
    const changes: Array<{ open: boolean; reason: string }> = []
    screen.render(
      <AlertDialog
        defaultOpen
        onOpenChange={(open, details) => changes.push({ open, reason: details.reason })}
      >
        <AlertDialog.Trigger>Open alert</AlertDialog.Trigger>
        <AlertDialog.Portal>
          <AlertDialog.Backdrop />
          <AlertDialog.Viewport>
            <AlertDialog.Popup>
              <AlertDialog.Title>Delete file?</AlertDialog.Title>
              <AlertDialog.Description>This cannot be undone.</AlertDialog.Description>
              <AlertDialog.Close ref={close}>Cancel</AlertDialog.Close>
            </AlertDialog.Popup>
          </AlertDialog.Viewport>
        </AlertDialog.Portal>
      </AlertDialog>,
    )

    expect(screen.getByRole("alertdialog", { name: "Delete file?" })).toBeDefined()
    screen.renderer.simulateKeystrokes("escape")
    expect(screen.getByRole("alertdialog", { name: "Delete file?" })).toBeDefined()
    screen.renderer.focusElement(close.current!.id)
    screen.renderer.simulateKeystrokes("enter")
    expect(screen.queryByRole("alertdialog", { name: "Delete file?" })).toBeNull()
    expect(changes).toEqual([{ open: false, reason: "close-press" }])
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
