/** Select discovers items by registration, so a wrapped Item is still found. */

import React, { useState } from "react"
import { beforeEach, describe, expect, it } from "vitest"
import * as SelectPrimitive from "../components/select"
import { createTestRoot, isNativeTestRendererAvailable } from "../testing"
import type { PublicInstance } from "../types/host.js"

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

  it("builds nothing beneath a closed panel, and keeps its item navigable once open", () => {
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
    // element - but the closed content panel is `display: none`, which builds
    // no children beneath it in the native renderer (see
    // display-none.test.tsx): the wrapper's host node exists in the tree, but
    // nothing under the hidden panel is laid out or painted, so it has no bounds.
    const wrapper = testRoot.renderer.findByTestId("styled-wrapper")
    expect(wrapper).toBeDefined()
    expect(testRoot.renderer.getElementBounds(wrapper!.id)).toBeNull()

    testRoot.renderer.nativeSimulateClick(30, 25)
    testRoot.renderer.simulateKeystrokes("down")
    testRoot.renderer.simulateKeystrokes("enter")

    expect(testRoot.renderer.getAllText()).toContain("Value: alpha")
  })
})

describeNative("Select item order (issue #387)", () => {
  let testRoot: ReturnType<typeof createTestRoot>

  beforeEach(() => {
    testRoot = createTestRoot()
  })

  /** `beta` mounts only once `show` is true, after its siblings register. */
  function Demo({ show }: { show: boolean }) {
    const [value, setValue] = useState<string | undefined>(undefined)
    return (
      <div style={{ width: 400, height: 300, padding: 12 }}>
        <SelectPrimitive.Root value={value} onValueChange={setValue}>
          <SelectPrimitive.Trigger data-testid="trigger" style={triggerStyle}>
            <SelectPrimitive.Value placeholder="Choose" />
          </SelectPrimitive.Trigger>
          <SelectPrimitive.Content side="bottom" sideOffset={4} style={contentStyle}>
            <SelectPrimitive.Item value="alpha" style={itemStyle}>Alpha</SelectPrimitive.Item>
            {show ? (
              <SelectPrimitive.Item value="beta" style={itemStyle}>Beta</SelectPrimitive.Item>
            ) : null}
            <SelectPrimitive.Item value="gamma" style={itemStyle}>Gamma</SelectPrimitive.Item>
          </SelectPrimitive.Content>
        </SelectPrimitive.Root>
        <text>{`Value: ${value ?? "none"}`}</text>
      </div>
    )
  }

  it("orders a middle item mounted after its siblings while open, by document position", () => {
    testRoot.render(<Demo show={false} />)
    testRoot.renderer.nativeSimulateClick(30, 25)
    expect(testRoot.renderer.getAllText()).not.toContain("Beta")

    testRoot.render(<Demo show />)
    expect(testRoot.renderer.getAllText()).toContain("Beta")

    // Alpha, then Beta, then Gamma - JSX order, not registration order.
    testRoot.renderer.simulateKeystrokes("down")
    testRoot.renderer.simulateKeystrokes("down")
    testRoot.renderer.simulateKeystrokes("enter")

    expect(testRoot.renderer.getAllText()).toContain("Value: beta")
  })

  it("orders a middle item mounted while closed, once keyboard navigation opens the Select", () => {
    testRoot.render(<Demo show={false} />)
    testRoot.render(<Demo show />)
    expect(testRoot.renderer.getAllText()).not.toContain("Beta")

    const trigger = testRoot.renderer.findByTestId("trigger")!
    testRoot.renderer.focusElement(trigger.id)
    // ArrowUp with nothing active wraps to the last item - Gamma only if
    // Beta was placed between Alpha and Gamma while the Select was closed.
    testRoot.renderer.simulateKeystrokes("up")
    testRoot.renderer.simulateKeystrokes("enter")

    expect(testRoot.renderer.getAllText()).toContain("Value: gamma")
  })

  it("re-orders keyed items React moves in place, not just ones newly mounted", () => {
    function Reorderable({ order }: { order: string[] }) {
      const [value, setValue] = useState<string | undefined>(undefined)
      return (
        <div style={{ width: 400, height: 300, padding: 12 }}>
          <SelectPrimitive.Root value={value} onValueChange={setValue}>
            <SelectPrimitive.Trigger data-testid="trigger" style={triggerStyle}>
              <SelectPrimitive.Value placeholder="Choose" />
            </SelectPrimitive.Trigger>
            <SelectPrimitive.Content side="bottom" sideOffset={4} style={contentStyle}>
              {order.map((itemValue) => (
                <SelectPrimitive.Item key={itemValue} value={itemValue} style={itemStyle}>
                  {itemValue === "alpha" ? "Alpha" : "Beta"}
                </SelectPrimitive.Item>
              ))}
            </SelectPrimitive.Content>
          </SelectPrimitive.Root>
          <text>{`Value: ${value ?? "none"}`}</text>
        </div>
      )
    }

    testRoot.render(<Reorderable order={["alpha", "beta"]} />)
    // Same two elements, same props, moved by key - not a mount/unmount, so
    // neither item's own registration effect necessarily re-fires. Select's
    // own re-sort still has to pick up the swap because it reads current
    // document position on every commit rather than relying on that effect.
    testRoot.render(<Reorderable order={["beta", "alpha"]} />)

    const trigger = testRoot.renderer.findByTestId("trigger")!
    testRoot.renderer.focusElement(trigger.id)
    testRoot.renderer.simulateKeystrokes("down")
    testRoot.renderer.simulateKeystrokes("enter")

    expect(testRoot.renderer.getAllText()).toContain("Value: beta")
  })
})

describeNative("Select item identity (issue #420)", () => {
  let testRoot: ReturnType<typeof createTestRoot>

  beforeEach(() => {
    testRoot = createTestRoot()
  })

  it("keeps a plain item's and a grouped item's host element identity across open, close, and reopen", () => {
    const plainRef = React.createRef<PublicInstance>()
    const groupedRef = React.createRef<PublicInstance>()
    const contentRef = React.createRef<PublicInstance>()

    function Demo() {
      const [value, setValue] = useState<string | undefined>(undefined)
      return (
        <div style={{ width: 400, height: 300, padding: 12 }}>
          <SelectPrimitive.Root value={value} onValueChange={setValue}>
            <SelectPrimitive.Trigger data-testid="trigger" style={triggerStyle}>
              <SelectPrimitive.Value placeholder="Choose" />
            </SelectPrimitive.Trigger>
            <SelectPrimitive.Content
              ref={contentRef}
              side="bottom"
              sideOffset={4}
              style={contentStyle}
            >
              <SelectPrimitive.Item value="alpha" ref={plainRef} style={itemStyle}>
                Alpha
              </SelectPrimitive.Item>
              <SelectPrimitive.Group>
                <SelectPrimitive.Item value="beta" ref={groupedRef} style={itemStyle}>
                  Beta
                </SelectPrimitive.Item>
              </SelectPrimitive.Group>
            </SelectPrimitive.Content>
          </SelectPrimitive.Root>
          <text>{`Value: ${value ?? "none"}`}</text>
        </div>
      )
    }

    testRoot.render(<Demo />)

    // Open, so both items mount their real host element and registration
    // can capture the ids that must survive close and reopen unchanged.
    testRoot.renderer.nativeSimulateClick(30, 25)
    const plainIdBeforeClose = plainRef.current?.id
    const groupedIdBeforeClose = groupedRef.current?.id
    expect(plainIdBeforeClose).toBeDefined()
    expect(groupedIdBeforeClose).toBeDefined()

    testRoot.renderer.simulateKeystrokes("escape")
    expect(contentRef.current).toBeNull()
    testRoot.renderer.nativeSimulateClick(30, 25)

    expect(plainRef.current?.id).toBe(plainIdBeforeClose)
    expect(groupedRef.current?.id).toBe(groupedIdBeforeClose)
    expect(testRoot.renderer.getActiveElement()).toBe(contentRef.current?.id)

    // Keyboard navigation still works on this second open - the content
    // panel reacquires a focus handle and autoFocus fires again on reopen.
    testRoot.renderer.simulateKeystrokes("down")
    testRoot.renderer.simulateKeystrokes("enter")

    expect(testRoot.renderer.getAllText()).toContain("Value: alpha")
  })
})
