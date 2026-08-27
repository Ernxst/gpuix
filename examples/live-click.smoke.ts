import { launch } from "@gpuix/react/automation"

const app = await launch({ command: "bun", args: ["live-click.tsx"] })

try {
  const child = await app.getByTestId("appkit-click-painted-child").element()
  const { bounds } = await app.call("getBounds", { elementId: child.id })
  if (!bounds) throw new Error("Expected painted child bounds for AppKit click smoke")

  await app.call("appKitClick", {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  })
  await app.getByText("AppKit clicks: 1").waitFor({ timeoutMs: 10_000 })
  console.log("live AppKit click automation passed")
} finally {
  await app.close()
}
