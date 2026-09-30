import "@gpuix/react/globals"
import type { PublicInstance } from "@gpuix/react"

declare const target: PublicInstance
declare const element: Element

const observer = new ResizeObserver(() => {})
observer.observe(target)
observer.observe(target, { box: "border-box" })
observer.observe(element)

void observer
