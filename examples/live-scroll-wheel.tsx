/**
 * Live-window scroll-wheel automation smoke target.
 *
 * Run its controller with `bun run live-scroll-wheel:smoke`.
 */

import React, { useState } from "react"
import { render } from "@gpuix/react"
import type { EventPayload } from "@gpuix/native"

const nestedRows = Array.from({ length: 10 }, (_, index) => index)

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
        height: 700,
        backgroundColor: "#171717",
      }}
    >
      <text style={{ color: "#f5f5f5", fontSize: 18 }}>Live scroll-wheel automation</text>
      <text data-testid="scroll-state" style={{ color: "#a3e635" }}>
        {`Last wheel: ${lastWheel}`}
      </text>
      <div
        data-testid="scroll-target"
        style={{ height: 220, overflow: "scroll", backgroundColor: "#262626", padding: 12 }}
        onWheel={(event: EventPayload) =>
          setLastWheel(
            `${event.touchPhase ?? "unknown"}: ${event.deltaX ?? 0}, ${event.deltaY ?? 0}; alt=${event.modifiers?.alt ?? false}`
          )
        }
      >
        <div style={{ height: 960 }}>
          <text data-testid="scroll-content" style={{ color: "#d4d4d4" }}>
            Wheel input moves this live native scroll area.
          </text>
        </div>
      </div>
      <text style={{ color: "#f5f5f5", fontSize: 18 }}>Nested residual routing</text>
      <div
        data-testid="nested-scroll-parent"
        style={{
          display: "flex",
          flexDirection: "column",
          width: 320,
          height: 240,
          flexShrink: 0,
          overflowY: "scroll",
          backgroundColor: "#10131a",
        }}
      >
        <virtual-list
          data-testid="nested-scroll-list"
          itemCount={nestedRows.length}
          windowStart={0}
          estimatedItemHeight={40}
          style={{ width: 320, height: 120, flexShrink: 0 }}
        >
          {nestedRows.map((row) => (
            <div
              key={row}
              style={{
                width: 320,
                height: 40,
                flexShrink: 0,
                backgroundColor: row % 2 === 0 ? "#27324a" : "#35415d",
              }}
            >
              <text style={{ color: "#ffffff" }}>Row {row}</text>
            </div>
          ))}
        </virtual-list>
        <div
          style={{
            width: 320,
            height: 400,
            flexShrink: 0,
            backgroundColor: "#713f51",
          }}
        >
          <text style={{ color: "#ffffff" }}>Parent tail</text>
        </div>
      </div>
    </div>
  )
}

render(<LiveScrollWheel />, { title: "GPUIX live scroll wheel", width: 528, height: 748, focus: false })
