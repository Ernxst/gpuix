/** Explicit label association, activation, and accessible naming. */

import React from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createTestRoot, isNativeTestRendererAvailable, type TestRoot } from "../testing.js"

const describeNative = isNativeTestRendererAvailable() ? describe : describe.skip

describeNative("explicit label association", () => {
  let screen: TestRoot

  beforeEach(() => {
    screen = createTestRoot({ width: 420, height: 180 })
  })

  afterEach(() => {
    screen.renderer.dispose()
  })

  it("focuses, activates, and names an associated input", async () => {
    const click = vi.fn()
    screen.render(
      <div style={{ padding: 20 }}>
        <label htmlFor="email" data-testid="email-label" style={{ width: 160, height: 40 }}>
          Email
        </label>
        <input id="email" onClick={click} style={{ width: 260, height: 40 }} />
      </div>
    )

    await screen.userEvent.click(screen.getByTestId("email-label"))
    const input = screen.getByRole("textbox", { name: "Email" })
    expect(screen.renderer.getActiveElement()).toBe(input.id)
    expect(click).toHaveBeenCalledOnce()
  })

  it("resolves the current id and htmlFor after rerenders", async () => {
    const firstClick = vi.fn()
    const secondClick = vi.fn()
    const renderFields = (htmlFor: string) => (
      <div style={{ padding: 20 }}>
        <label htmlFor={htmlFor} data-testid="dynamic-label" style={{ width: 160, height: 40 }}>
          Account
        </label>
        <input id="first" onClick={firstClick} style={{ width: 220, height: 40 }} />
        <input id="second" onClick={secondClick} style={{ width: 220, height: 40 }} />
      </div>
    )

    screen.render(renderFields("first"))
    await screen.userEvent.click(screen.getByTestId("dynamic-label"))
    expect(firstClick).toHaveBeenCalledOnce()

    screen.render(renderFields("second"))
    await screen.userEvent.click(screen.getByTestId("dynamic-label"))
    expect(firstClick).toHaveBeenCalledOnce()
    expect(secondClick).toHaveBeenCalledOnce()

    screen.render(
      <div style={{ padding: 20 }}>
        <label htmlFor="renamed" data-testid="dynamic-label" style={{ width: 160, height: 40 }}>
          Account
        </label>
        <input id="renamed" onClick={secondClick} style={{ width: 220, height: 40 }} />
      </div>
    )
    await screen.userEvent.click(screen.getByTestId("dynamic-label"))
    expect(secondClick).toHaveBeenCalledTimes(2)
  })

  it("does nothing for a missing or unsupported target", async () => {
    const unsupportedClick = vi.fn()
    screen.render(
      <div style={{ padding: 20 }}>
        <label htmlFor="missing" data-testid="missing-label" style={{ width: 160, height: 40 }}>
          Missing
        </label>
        <label htmlFor="panel" data-testid="unsupported-label" style={{ width: 160, height: 40 }}>
          Panel
        </label>
        <div id="panel" onClick={unsupportedClick} style={{ width: 160, height: 40 }} />
      </div>
    )

    await screen.userEvent.click(screen.getByTestId("missing-label"))
    await screen.userEvent.click(screen.getByTestId("unsupported-label"))
    expect(unsupportedClick).not.toHaveBeenCalled()
    expect(screen.renderer.getActiveElement()).toBeNull()
  })

  it("cancels the default action when the label click is prevented", async () => {
    const click = vi.fn()
    screen.render(
      <div style={{ padding: 20 }}>
        <label
          htmlFor="prevented"
          data-testid="prevented-label"
          style={{ width: 160, height: 40 }}
          onClick={(event) => event.preventDefault()}
        >
          Prevented
        </label>
        <input id="prevented" onClick={click} style={{ width: 220, height: 40 }} />
      </div>
    )

    await screen.userEvent.click(screen.getByTestId("prevented-label"))
    expect(click).not.toHaveBeenCalled()
    expect(screen.renderer.getActiveElement()).toBeNull()
  })

  for (const disabledProps of [{ disabled: true }, { ariaDisabled: true }]) {
    const state = "disabled" in disabledProps ? "disabled" : "aria-disabled"
    it(`does not focus or activate a ${state} control`, async () => {
      const click = vi.fn()
      screen.render(
        <div style={{ padding: 20 }}>
          <label htmlFor="blocked" data-testid="blocked-label" style={{ width: 160, height: 40 }}>
            Blocked
          </label>
          <input
            id="blocked"
            {...disabledProps}
            onClick={click}
            style={{ width: 220, height: 40 }}
          />
        </div>
      )

      await screen.userEvent.click(screen.getByTestId("blocked-label"))
      expect(click).not.toHaveBeenCalled()
      expect(screen.renderer.getActiveElement()).toBeNull()
    })
  }

  it("focuses and activates an associated textarea", async () => {
    const click = vi.fn()
    screen.render(
      <div style={{ padding: 20 }}>
        <label htmlFor="notes" data-testid="notes-label" style={{ width: 160, height: 40 }}>
          Notes
        </label>
        <textarea id="notes" onClick={click} style={{ width: 240, height: 60 }} />
      </div>
    )

    await screen.userEvent.click(screen.getByTestId("notes-label"))
    const textarea = screen.getByRole("textbox", { name: "Notes" })
    expect(screen.renderer.getActiveElement()).toBe(textarea.id)
    expect(click).toHaveBeenCalledOnce()
  })

  it("activates a button once with normal capture and bubble delivery", async () => {
    const phases: string[] = []
    screen.render(
      <div
        style={{ padding: 20 }}
        onClickCapture={(event) => {
          if (event.target.type === "button") phases.push("capture")
        }}
        onClick={(event) => {
          if (event.target.type === "button") phases.push("bubble")
        }}
      >
        <label htmlFor="save" data-testid="save-label" style={{ width: 160, height: 40 }}>
          Save settings
        </label>
        <button id="save" onClick={() => phases.push("target")} style={{ width: 160, height: 40 }}>
          Save
        </button>
      </div>
    )

    await screen.userEvent.click(screen.getByTestId("save-label"))
    expect(phases).toEqual(["capture", "target", "bubble"])
    expect(screen.getByRole("button", { name: "Save settings" })).toBeDefined()
  })

  it("joins multiple explicit labels in tree order and keeps ARIA precedence", () => {
    screen.render(
      <div>
        <label htmlFor="amount">Invoice</label>
        <label htmlFor="amount">amount</label>
        <input id="amount" placeholder="Fallback" style={{ width: 220, height: 40 }} />
        <label htmlFor="named">Ignored label</label>
        <input id="named" ariaLabel="ARIA name" style={{ width: 220, height: 40 }} />
      </div>
    )

    expect(screen.getByRole("textbox", { name: "Invoice amount" })).toBeDefined()
    expect(screen.getByRole("textbox", { name: "ARIA name" })).toBeDefined()
  })
})
