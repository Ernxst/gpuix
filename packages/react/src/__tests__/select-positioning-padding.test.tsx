import React from "react"
import { beforeEach, describe, expect, it } from "vitest"
import * as Combobox from "../components/combobox.js"
import * as Select from "../components/select.js"
import * as Tooltip from "../components/tooltip.js"
import { isNativeTestRendererAvailable, createTestRoot, type TestRoot } from "../testing.js"

const describeNative = isNativeTestRendererAvailable() ? describe : describe.skip

describeNative("Select popup collision padding", () => {
  let screen: TestRoot

  beforeEach(() => {
    screen = createTestRoot({ width: 240, height: 160 })
  })

  function renderSelect(
    edge: Edge = "left",
    collisionPadding?: number,
    collisionAvoidance?: Select.SelectPositionerProps["collisionAvoidance"]
  ) {
    const scenario = edgeScenario(edge)
    screen.render(
      <Select.Root defaultOpen>
        <Select.Trigger data-testid="trigger" ariaLabel="Fruit" style={scenario.triggerStyle}>
          <Select.Value placeholder="Pick a fruit" />
        </Select.Trigger>
        <Select.Portal>
          <Select.Positioner side={scenario.side} align="center" sideOffset={4} collisionPadding={collisionPadding} collisionAvoidance={collisionAvoidance}>
            <Select.Popup data-testid="popup" style={{ width: 144, height: 100 }}>
              <Select.List>
                <Select.Item value="apple">Apple</Select.Item>
                <Select.Item value="pear">Pear</Select.Item>
              </Select.List>
            </Select.Popup>
          </Select.Positioner>
        </Select.Portal>
      </Select.Root>
    )
    expectTriggerAtEdge(screen.getByTestId("trigger").getBoundingClientRect(), edge)
  }

  it("keeps a centred popup five pixels from the left window edge", () => {
    renderSelect()

    expectEdgePadding(screen.getByTestId("popup").getBoundingClientRect(), "left")
  })

  it("applies the same edge inset when collisionPadding is explicit", () => {
    renderSelect("left", 5)

    expectEdgePadding(screen.getByTestId("popup").getBoundingClientRect(), "left")
  })

  it("applies the edge inset when collision avoidance uses shift", () => {
    renderSelect("left", undefined, { side: "shift", align: "shift" })

    expectEdgePadding(screen.getByTestId("popup").getBoundingClientRect(), "left")
  })

  for (const edge of ["right", "top", "bottom"] as const) {
    it(`keeps a centred popup five pixels from the ${edge} window edge`, () => {
      renderSelect(edge)

      expectEdgePadding(screen.getByTestId("popup").getBoundingClientRect(), edge)
    })
  }
})

type Edge = "left" | "right" | "top" | "bottom"

function edgeScenario(edge: Edge) {
  return {
    side: edge === "left" || edge === "right" ? "bottom" as const : "right" as const,
    triggerStyle: {
      position: "absolute" as const,
      left: edge === "left" ? 8 : edge === "right" ? 140 : 64,
      top: edge === "top" ? 8 : edge === "bottom" ? 120 : 64,
      width: 92,
      height: 32,
    },
  }
}

function expectEdgePadding(rect: DOMRect, edge: Edge) {
  // Base UI 1.8.0 defaults collisionPadding to 5 in useAnchorPositioning.js.
  if (edge === "left") expect(rect.left).toBe(5)
  else if (edge === "right") expect(rect.right).toBe(235)
  else if (edge === "top") expect(rect.top).toBe(5)
  else expect(rect.bottom).toBe(155)
}

function expectTriggerAtEdge(rect: DOMRect, edge: Edge) {
  if (edge === "left") expect(rect.left).toBe(8)
  else if (edge === "right") expect(rect.right).toBe(232)
  else if (edge === "top") expect(rect.top).toBe(8)
  else expect(rect.bottom).toBe(152)
}

function positionAtTriggerCenter(rect: DOMRect, side: "bottom" | "right") {
  return side === "bottom"
    ? { x: rect.left + rect.width / 2, y: rect.bottom }
    : { x: rect.right, y: rect.top + rect.height / 2 }
}

for (const component of ["Tooltip", "Combobox"] as const) {
  describeNative(`${component} popup collision padding`, () => {
    let screen: TestRoot

    beforeEach(() => {
      screen = createTestRoot({ width: 240, height: 160 })
    })

    function renderFloating(edge: Edge) {
      const scenario = edgeScenario(edge)
      if (component === "Tooltip") {
        const handle = Tooltip.createTooltipHandle()
        function Demo() {
          const [anchor, setAnchor] = React.useState<unknown>(null)
          const anchorRect = anchor ? (anchor as { getBoundingClientRect: () => DOMRect }).getBoundingClientRect() : undefined
          return (
            <Tooltip.Provider delay={0} closeDelay={0}>
              <Tooltip.Root handle={handle} defaultOpen defaultTriggerId="anchor">
                <Tooltip.Trigger handle={handle} id="anchor" data-testid="trigger" ref={(instance) => setAnchor(instance)} style={scenario.triggerStyle}>Anchor</Tooltip.Trigger>
                <Tooltip.Portal>
                  <Tooltip.Positioner data-testid="positioner" anchor={anchor as Element | null} position={anchorRect ? positionAtTriggerCenter(anchorRect, scenario.side) : undefined} side={scenario.side}>
                    <Tooltip.Popup data-testid="popup" style={{ width: 144, height: 100 }}>Tooltip</Tooltip.Popup>
                  </Tooltip.Positioner>
                </Tooltip.Portal>
              </Tooltip.Root>
            </Tooltip.Provider>
          )
        }
        screen.render(<Demo />)
        expectTriggerAtEdge(screen.getByTestId("trigger").getBoundingClientRect(), edge)
        return
      }

      function Demo() {
        const [anchor, setAnchor] = React.useState<unknown>(null)
        const anchorRect = anchor ? (anchor as { getBoundingClientRect: () => DOMRect }).getBoundingClientRect() : undefined
        return (
          <Combobox.Root defaultOpen items={["Apple"]}>
            <Combobox.Input data-testid="trigger" ref={(instance) => setAnchor(instance)} style={scenario.triggerStyle} aria-label="Fruit" />
            <Combobox.Portal>
              <Combobox.Positioner data-testid="positioner" anchor={anchor as Element | null} position={anchorRect ? positionAtTriggerCenter(anchorRect, scenario.side) : undefined} side={scenario.side}>
                <Combobox.Popup data-testid="popup" style={{ width: 144, height: 100 }}>
                  <Combobox.List><Combobox.Item value="Apple">Apple</Combobox.Item></Combobox.List>
                </Combobox.Popup>
              </Combobox.Positioner>
            </Combobox.Portal>
          </Combobox.Root>
        )
      }
      screen.render(<Demo />)
      expectTriggerAtEdge(screen.getByTestId("trigger").getBoundingClientRect(), edge)
    }

    for (const edge of ["left", "right", "top", "bottom"] as const) {
      it(`keeps a centred popup five pixels from the ${edge} window edge`, () => {
        renderFloating(edge)

        expectEdgePadding(screen.getByTestId("popup").getBoundingClientRect(), edge)
      })
    }
  })
}
