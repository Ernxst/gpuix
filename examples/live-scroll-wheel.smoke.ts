import { launch, type ParamsOf } from "@gpuix/react/automation"

const app = await launch({ command: "bun", args: ["live-scroll-wheel.tsx"] })

async function scrollWithoutSynchronousDraw(
  params: ParamsOf<"scrollWheel">
): Promise<void> {
  const before = await app.call("getSynchronousScrollDrawCount", {})
  await app.call("scrollWheel", params)
  const after = await app.call("getSynchronousScrollDrawCount", {})
  const synchronousDraws = after.count - before.count
  if (synchronousDraws !== 0) {
    throw new Error(
      `Expected zero synchronous draws for one live scroll event, received ${synchronousDraws}`
    )
  }
}

function assertOffset(
  label: string,
  offset: number[] | null,
  expectedX: number,
  expectedY: number
): void {
  if (
    !offset ||
    Math.abs(offset[0] - expectedX) > 0.01 ||
    Math.abs(offset[1] - expectedY) > 0.01
  ) {
    throw new Error(`Expected ${label} offset ${expectedX},${expectedY}; received ${offset}`)
  }
}

try {
  const target = await app.getByTestId("scroll-target").element()
  await scrollWithoutSynchronousDraw({
    x: 240,
    y: 180,
    deltaX: 0,
    deltaY: -24,
    phase: "started",
    deltaUnit: "pixels",
    modifiers: { alt: true },
  })
  await app.getByText("Last wheel: started: 0, -24; alt=true").waitFor()
  await new Promise((resolve) => setTimeout(resolve, 16))
  await scrollWithoutSynchronousDraw({
    x: 240,
    y: 180,
    deltaX: 0,
    deltaY: -2,
    phase: "moved",
    deltaUnit: "lines",
    modifiers: { alt: true },
  })
  await app.getByText("Last wheel: moved: 0, -40; alt=true").waitFor()
  await new Promise((resolve) => setTimeout(resolve, 16))
  await scrollWithoutSynchronousDraw({
    x: 240,
    y: 180,
    deltaX: 0,
    deltaY: -24,
    phase: "ended",
    deltaUnit: "pixels",
    modifiers: { alt: true },
  })
  await app.getByText("Last wheel: ended: 0, -24; alt=true").waitFor()
  const { offset } = await app.call("getScrollOffset", { elementId: target.id })
  if (!offset || offset[1] >= 0) {
    throw new Error(`Expected a negative vertical scroll offset, received ${offset}`)
  }

  const parent = await app.getByTestId("nested-scroll-parent").element()
  const inner = await app.getByTestId("nested-scroll-list").element()
  const { bounds } = await app.call("getBounds", { elementId: parent.id })
  if (!bounds) throw new Error("Expected painted bounds for nested scroll parent")
  const nestedX = bounds.x + 160

  await scrollWithoutSynchronousDraw({
    x: nestedX,
    y: bounds.y + 60,
    deltaX: 0,
    deltaY: -340,
    phase: "started",
    deltaUnit: "pixels",
  })
  assertOffset(
    "nested inner at boundary",
    (await app.call("getScrollOffset", { elementId: inner.id })).offset,
    0,
    -280
  )
  assertOffset(
    "nested parent after residual",
    (await app.call("getScrollOffset", { elementId: parent.id })).offset,
    0,
    -60
  )

  await scrollWithoutSynchronousDraw({
    x: nestedX,
    y: bounds.y + 30,
    deltaX: 0,
    deltaY: 40,
    phase: "moved",
    deltaUnit: "pixels",
  })
  assertOffset(
    "nested inner after reversal",
    (await app.call("getScrollOffset", { elementId: inner.id })).offset,
    0,
    -240
  )
  assertOffset(
    "nested parent after reversal",
    (await app.call("getScrollOffset", { elementId: parent.id })).offset,
    0,
    -60
  )
  await scrollWithoutSynchronousDraw({
    x: nestedX,
    y: bounds.y + 30,
    deltaX: 0,
    deltaY: 0,
    phase: "ended",
    deltaUnit: "pixels",
  })
  console.log("live scroll-wheel automation passed")
} finally {
  await app.close()
}
