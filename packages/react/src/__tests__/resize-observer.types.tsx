import { ResizeObserver } from "../index.js"
import type { PublicInstance } from "../types/host.js"

declare const target: PublicInstance

const observer = new ResizeObserver((entries, currentObserver) => {
  const entry = entries[0]!
  const observedTarget: PublicInstance = entry.target
  const { x, y, width, height, top, left, right, bottom } = entry.contentRect
  const border = entry.borderBoxSize[0]!
  const content = entry.contentBoxSize[0]!
  const devicePixels = entry.devicePixelContentBoxSize[0]!
  const { inlineSize: borderInline, blockSize: borderBlock } = border
  const { inlineSize: contentInline, blockSize: contentBlock } = content
  const { inlineSize: deviceInline, blockSize: deviceBlock } = devicePixels
  void currentObserver
  void observedTarget
  void x
  void y
  void width
  void height
  void top
  void left
  void right
  void bottom
  void borderInline
  void borderBlock
  void contentInline
  void contentBlock
  void deviceInline
  void deviceBlock
})

observer.observe(target)
observer.observe(target, { box: "border-box" })
observer.observe(target, { box: "device-pixel-content-box" })
observer.unobserve(target)
observer.disconnect()
