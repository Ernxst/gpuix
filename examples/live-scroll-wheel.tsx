/**
 * Live-window scroll-wheel automation smoke target.
 *
 * Run its controller with `bun run live-scroll-wheel:smoke`.
 */

import React, { useState } from "react"
import { render } from "@gpuix/react"
import type { EventPayload } from "@gpuix/native"

function LiveScrollWheel() {
  const [lastWheel, setLastWheel] = useState("none")

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        padding: 24,
        width: 480,
        height: 360,
        backgroundColor: "#171717",
      }}
    >
      <text style={{ color: "#f5f5f5", fontSize: 18 }}>Live scroll-wheel automation</text>
      <text testId="scroll-state" style={{ color: "#a3e635" }}>
        {`Last wheel: ${lastWheel}`}
      </text>
      <div
        testId="scroll-target"
        style={{ flex: 1, overflow: "scroll", backgroundColor: "#262626", padding: 12 }}
        onScroll={(event: EventPayload) =>
          setLastWheel(
            `${event.touchPhase ?? "unknown"}: ${event.deltaX ?? 0}, ${event.deltaY ?? 0}; alt=${event.modifiers?.alt ?? false}`
          )
        }
      >
        <div style={{ height: 960 }}>
          <text style={{ color: "#d4d4d4" }}>Wheel input moves this live native scroll area.</text>
        </div>
      </div>
    </div>
  )
}

render(<LiveScrollWheel />, { title: "GPUIX live scroll wheel", width: 528, height: 408 })
