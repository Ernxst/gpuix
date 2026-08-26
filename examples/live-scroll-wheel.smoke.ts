import { launch } from "@gpuix/react/automation"

const app = await launch({ command: "bun", args: ["live-scroll-wheel.tsx"] })

try {
  const target = await app.getByTestId("scroll-target").element()
  await app.call("scrollWheel", { x: 240, y: 180, deltaX: 0, deltaY: -96 })
  await app.getByText("Last wheel: 0, -96").waitFor()
  const { offset } = await app.call("getScrollOffset", { elementId: target.id })
  if (!offset || offset[1] >= 0) {
    throw new Error(`Expected a negative vertical scroll offset, received ${offset}`)
  }
  console.log("live scroll-wheel automation passed")
} finally {
  await app.close()
}
