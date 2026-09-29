import "../globals.js"

import React, { createRef } from "react"
import { describe, expect, it } from "vitest"
import { Radio } from "@base-ui/react/radio"
import { RadioGroup } from "@base-ui/react/radio-group"
import { Tabs } from "@base-ui/react/tabs"
import { Toggle } from "@base-ui/react/toggle"
import { ToggleGroup } from "@base-ui/react/toggle-group"
import { Toolbar } from "@base-ui/react/toolbar"
import { Field } from "@base-ui/react/field"

import { createTestRoot, isNativeTestRendererAvailable } from "../testing.js"
import type { PublicInstance } from "../types/host.js"

const describeNative = isNativeTestRendererAvailable() ? describe : describe.skip

describeNative("Base UI composite keyboard navigation", () => {
  it("moves ToggleGroup focus to the next item with Right Arrow", async () => {
    const first = createRef<PublicInstance>()
    const second = createRef<PublicInstance>()
    const screen = createTestRoot()
    try {
      screen.render(
        <ToggleGroup aria-label="Text alignment">
          <Toggle ref={first} value="left">Left</Toggle>
          <Toggle ref={second} value="center">Center</Toggle>
        </ToggleGroup>
      )
      screen.renderer.nativeSimulateKeystrokes(first.current!.id, "right")
      await Promise.resolve()

      expect(globalThis.document.activeElement?.id).toBe(second.current!.id)
    } finally {
      screen.unmount()
    }
  })

  it("moves Toolbar focus to the next button with Right Arrow", async () => {
    const first = createRef<PublicInstance>()
    const second = createRef<PublicInstance>()
    const screen = createTestRoot()

    try {
      screen.render(
        <Toolbar.Root aria-label="Formatting">
          <Toolbar.Button ref={first}>Bold</Toolbar.Button>
          <Toolbar.Button ref={second}>Italic</Toolbar.Button>
        </Toolbar.Root>
      )

      screen.renderer.nativeSimulateKeystrokes(first.current!.id, "right")
      await Promise.resolve()

      expect(globalThis.document.activeElement?.id).toBe(second.current!.id)
    } finally {
      screen.unmount()
    }
  })

  it("moves RadioGroup focus to the next radio with Right Arrow", async () => {
    const first = createRef<PublicInstance>()
    const second = createRef<PublicInstance>()
    const screen = createTestRoot()

    try {
      screen.render(
        <Field.Root>
          <RadioGroup aria-label="Fruit" defaultValue="apple">
            <Radio.Root ref={first} value="apple" />
            <Radio.Root ref={second} value="orange" />
          </RadioGroup>
        </Field.Root>
      )

      screen.renderer.nativeSimulateKeystrokes(first.current!.id, "right")
      await Promise.resolve()

      expect(globalThis.document.activeElement?.id).toBe(second.current!.id)
    } finally {
      screen.unmount()
    }
  })

  it("moves Tabs focus to the next tab with Right Arrow", async () => {
    const first = createRef<PublicInstance>()
    const second = createRef<PublicInstance>()
    const screen = createTestRoot()

    try {
      screen.render(
        <Tabs.Root defaultValue="one">
          <Tabs.List>
            <Tabs.Tab ref={first} value="one">One</Tabs.Tab>
            <Tabs.Tab ref={second} value="two">Two</Tabs.Tab>
          </Tabs.List>
          <Tabs.Panel value="one">Panel one</Tabs.Panel>
          <Tabs.Panel value="two">Panel two</Tabs.Panel>
        </Tabs.Root>
      )

      screen.renderer.nativeSimulateKeystrokes(first.current!.id, "right")
      await Promise.resolve()

      expect(globalThis.document.activeElement?.id).toBe(second.current!.id)
    } finally {
      screen.unmount()
    }
  })
})
