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
  console.log("live scroll-wheel automation passed")
} finally {
  await app.close()
}
