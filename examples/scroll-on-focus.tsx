import React from "react"
import { render } from "@gpuix/react"

const rows = Array.from({ length: 12 }, (_, index) => index)
const rowStyle = {
  width: 240,
  height: 40,
  flexShrink: 0,
  paddingLeft: 12,
  backgroundColor: "#252a38",
  color: "#f4f4f5",
  focusVisible: {
    outlineColor: "#67e8f9",
    outlineWidth: 3,
    outlineOffset: -3,
    backgroundColor: "#164e63",
  },
} as const

function FocusRow({ label }: { label: string }) {
  return (
    <a href={`#${label}`} ariaLabel={label} style={rowStyle}>
      <text>{label}</text>
    </a>
  )
}

function App() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 16,
        width: 600,
        height: 320,
        padding: 24,
        backgroundColor: "#111827",
        color: "#f4f4f5",
      }}
    >
      <text style={{ fontSize: 18, fontWeight: "bold" }}>Scroll on focus GUI check</text>
      <text style={{ color: "#a1a1aa" }}>
        Press Tab repeatedly. The cyan focus ring should stay within each viewport.
      </text>
      <div style={{ display: "flex", gap: 24 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <text>Plain overflow</text>
          <div style={{ width: 240, height: 120, overflowY: "scroll" }}>
            {rows.map((row) => (
              <FocusRow key={row} label={`plain row ${row + 1}`} />
            ))}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <text>Virtual list</text>
          <virtual-list
            overdraw={0}
            estimatedItemHeight={40}
            style={{ width: 240, height: 120 }}
          >
            {rows.map((row) => (
              <FocusRow key={row} label={`virtual row ${row + 1}`} />
            ))}
          </virtual-list>
        </div>
      </div>
    </div>
  )
}

render(<App />, { title: "GPUIX scroll on focus", width: 648, height: 368 })
