/** Select discovers items by registration, so a wrapped Item is still found. */

import React, { useState } from "react"
import { beforeEach, describe, expect, it } from "vitest"
import * as SelectPrimitive from "../components/select"
import { createTestRoot, isNativeTestRendererAvailable } from "../testing"

const describeNative = isNativeTestRendererAvailable() ? describe : describe.skip

const triggerStyle = {
  width: 180,
  height: 36,
  padding: 8,
  backgroundColor: "#27324a",
  color: "#ffffff",
}

const contentStyle = {
  width: 180,
  maxHeight: 150,
  overflowY: "scroll",
  padding: 4,
  backgroundColor: "#111827",
  color: "#ffffff",
}

const itemStyle = ({ highlighted, selected, disabled }) => ({
  height: 32,
  padding: 6,
  opacity: disabled ? 0.4 : 1,
  backgroundColor: highlighted ? "#334155" : selected ? "#1e3a5f" : "#111827",
})

/** A user component that wraps `SelectPrimitive.Item`, hiding it from any
 *  discovery that inspects the element tree by type. */
function WrappedItem(props: SelectPrimitive.SelectItemProps) {
  return <SelectPrimitive.Item {...props} />
}

/** A wrapper that, unlike `WrappedItem`, renders its own styled host element
 *  around the primitive `Item` - the kind of wrapper Select does not control
 *  the closed-state hiding of. */
function StyledWrapper({
  testId,
  ...props
}: SelectPrimitive.SelectItemProps & { testId: string }) {
  return (
    <div data-testid={testId} style={{ width: 120, height: 40, backgroundColor: "#f00" }}>
      <SelectPrimitive.Item {...props} />
    </div>
  )
}

describeNative("Select item registration", () => {
  let testRoot: ReturnType<typeof createTestRoot>

  beforeEach(() => {
    testRoot = createTestRoot()
  })

  it("navigates and selects a wrapped Item, and shows its label in Value", () => {
    function Demo() {
      const [value, setValue] = useState<string | undefined>(undefined)
      return (
        <div style={{ width: 400, height: 300, padding: 12 }}>
          <SelectPrimitive.Root value={value} onValueChange={setValue}>
            <SelectPrimitive.Trigger style={triggerStyle}>
              <SelectPrimitive.Value placeholder="Choose" />
            </SelectPrimitive.Trigger>
            <SelectPrimitive.Content side="bottom" sideOffset={4} style={contentStyle}>
              <WrappedItem value="alpha" style={itemStyle}>Alpha</WrappedItem>
              <WrappedItem value="beta" style={itemStyle}>Beta</WrappedItem>
            </SelectPrimitive.Content>
          </SelectPrimitive.Root>
          <text>{`Value: ${value ?? "none"}`}</text>
        </div>
      )
    }

    testRoot.render(<Demo />)
    testRoot.renderer.nativeSimulateClick(30, 25)
    expect(testRoot.renderer.getAllText()).toContain("Beta")

    testRoot.renderer.simulateKeystrokes("down")
    testRoot.renderer.simulateKeystrokes("enter")

    expect(testRoot.renderer.getAllText()).toContain("Value: alpha")
    expect(testRoot.renderer.getAllText()).toContain("Alpha")
  })

  it("skips a disabled wrapped Item during keyboard navigation", () => {
    function Demo() {
      const [value, setValue] = useState<string | undefined>(undefined)
      return (
        <div style={{ width: 400, height: 300, padding: 12 }}>
          <SelectPrimitive.Root value={value} onValueChange={setValue}>
            <SelectPrimitive.Trigger style={triggerStyle}>
              <SelectPrimitive.Value placeholder="Choose" />
            </SelectPrimitive.Trigger>
            <SelectPrimitive.Content side="bottom" sideOffset={4} style={contentStyle}>
              <WrappedItem value="disabled" disabled style={itemStyle}>
                Disabled
              </WrappedItem>
              <WrappedItem value="enabled" style={itemStyle}>Enabled</WrappedItem>
            </SelectPrimitive.Content>
          </SelectPrimitive.Root>
          <text>{`Value: ${value ?? "none"}`}</text>
        </div>
      )
    }

    testRoot.render(<Demo />)
    testRoot.renderer.nativeSimulateClick(30, 25)

    testRoot.renderer.simulateKeystrokes("down")
    testRoot.renderer.simulateKeystrokes("enter")

    expect(testRoot.renderer.getAllText()).toContain("Value: enabled")
  })

  it("drops a wrapped Item from navigation once it unmounts", () => {
    function Demo({ showBeta }: { showBeta: boolean }) {
      const [value, setValue] = useState<string | undefined>(undefined)
      return (
        <div style={{ width: 400, height: 300, padding: 12 }}>
          <SelectPrimitive.Root value={value} onValueChange={setValue}>
            <SelectPrimitive.Trigger style={triggerStyle}>
              <SelectPrimitive.Value placeholder="Choose" />
            </SelectPrimitive.Trigger>
            <SelectPrimitive.Content side="bottom" sideOffset={4} style={contentStyle}>
              <WrappedItem value="alpha" style={itemStyle}>Alpha</WrappedItem>
              {showBeta ? (
                <WrappedItem value="beta" style={itemStyle}>Beta</WrappedItem>
              ) : null}
            </SelectPrimitive.Content>
          </SelectPrimitive.Root>
          <text>{`Value: ${value ?? "none"}`}</text>
        </div>
      )
    }

    testRoot.render(<Demo showBeta />)
    testRoot.renderer.nativeSimulateClick(30, 25)
    expect(testRoot.renderer.getAllText()).toContain("Beta")

    testRoot.render(<Demo showBeta={false} />)
    expect(testRoot.renderer.getAllText()).not.toContain("Beta")

    testRoot.renderer.simulateKeystrokes("down")
    testRoot.renderer.simulateKeystrokes("enter")

    expect(testRoot.renderer.getAllText()).toContain("Value: alpha")
  })

  it("clips a wrapper's own host element to zero size while closed, and keeps its item navigable once open", () => {
    function Demo() {
      const [value, setValue] = useState<string | undefined>(undefined)
      return (
        <div style={{ width: 400, height: 300, padding: 12 }}>
          <SelectPrimitive.Root value={value} onValueChange={setValue}>
            <SelectPrimitive.Trigger style={triggerStyle}>
              <SelectPrimitive.Value placeholder="Choose" />
            </SelectPrimitive.Trigger>
            <SelectPrimitive.Content side="bottom" sideOffset={4} style={contentStyle}>
              <StyledWrapper testId="styled-wrapper" value="alpha" style={itemStyle}>
                Alpha
              </StyledWrapper>
            </SelectPrimitive.Content>
          </SelectPrimitive.Root>
          <text>{`Value: ${value ?? "none"}`}</text>
        </div>
      )
    }

    testRoot.render(<Demo />)

    // The wrapper's own style still asks for 120x40 - Select doesn't own that
    // element - but its clipping parent (the closed content's zero-size box)
    // is what keeps it from taking layout space or painting.
    const wrapper = testRoot.getByTestId("styled-wrapper")
    const clippingParent = wrapper.parentElement
    expect(clippingParent).not.toBeNull()
    const closedRect = clippingParent!.getBoundingClientRect()
    expect(closedRect.width).toBe(0)
    expect(closedRect.height).toBe(0)

    testRoot.renderer.nativeSimulateClick(30, 25)
    testRoot.renderer.simulateKeystrokes("down")
    testRoot.renderer.simulateKeystrokes("enter")

    expect(testRoot.renderer.getAllText()).toContain("Value: alpha")
  })
})
