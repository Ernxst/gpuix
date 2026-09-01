import React, { useState } from "react"
import { render } from "@gpuix/react"

function App() {
  const [clicks, setClicks] = useState(0)
  const [hovered, setHovered] = useState(false)

  return (
    <a
      testId="appkit-click-anchor"
      onClick={() => setClicks((count) => count + 1)}
      onMouseEnter={() => setHovered(true)}
      style={{
        width: 280,
        height: 120,
        padding: 16,
        active: { backgroundColor: "#1a2638" },
      }}
    >
      <span
        testId="appkit-click-painted-child"
        style={{ width: 200, height: 70, backgroundColor: "#273449" }}
      >
        Click through AppKit
      </span>
      <text>{`AppKit clicks: ${clicks}`}</text>
      <text>{hovered ? "Pointer is over the clickable element" : "Pointer is away"}</text>
    </a>
  )
}

render(<App />, { title: "GPUIX AppKit click smoke", width: 360, height: 220 })
