import React, { useState } from "react"
import { render } from "@gpuix/react"

const controlStyle = {
  padding: 10,
  backgroundColor: "#313244",
  borderRadius: 6,
  color: "#cdd6f4",
  focusVisible: {
    outlineColor: "#89b4fa",
    outlineWidth: 2,
    outlineOffset: 2,
  },
} as const

function App() {
  const [included, setIncluded] = useState(false)
  const [machines, setMachines] = useState(8)
  const [status, setStatus] = useState("No accessibility action yet")

  const toggleIncluded = () => {
    setIncluded((value) => !value)
    setStatus("Include byproducts activated")
  }

  return (
    <main
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        width: 520,
        padding: 24,
        backgroundColor: "#1e1e2e",
        color: "#cdd6f4",
      }}
    >
      <h1 role="heading" ariaLabel="GPUIX accessibility smoke" ariaLevel={1}>
        <text style={{ fontSize: 24, fontWeight: "bold" }}>GPUIX accessibility smoke</text>
      </h1>

      <button
        role="button"
        ariaLabel="Save factory"
        tabIndex={0}
        style={controlStyle}
        onClick={() => setStatus("Save factory activated")}
      >
        <text>Save factory</text>
      </button>

      <div
        role="checkbox"
        ariaLabel="Include byproducts"
        ariaDescription="Adds secondary outputs to the production plan"
        ariaChecked={included}
        tabIndex={0}
        style={controlStyle}
        onClick={toggleIncluded}
      >
        <text>{`Include byproducts: ${included ? "checked" : "not checked"}`}</text>
      </div>

      <div
        role="spinbutton"
        ariaLabel="Machine count"
        ariaValue={`${machines} machines`}
        ariaValueMin={0}
        ariaValueMax={20}
        ariaValueNow={machines}
        tabIndex={0}
        style={controlStyle}
        onAccessibilityAction={(event) => {
          if (event.accessibilityAction === "increment") {
            setMachines((value) => Math.min(20, value + 1))
            setStatus("Machine count incremented")
          }
          if (event.accessibilityAction === "decrement") {
            setMachines((value) => Math.max(0, value - 1))
            setStatus("Machine count decremented")
          }
        }}
      >
        <text>{`Machine count: ${machines}`}</text>
      </div>

      <a
        role="link"
        ariaLabel="Open recipe library"
        tabIndex={0}
        style={controlStyle}
        onClick={() => setStatus("Recipe library activated")}
      >
        <text>Open recipe library</text>
      </a>

      <div style={{ color: "#a6adc8" }}>
        <text>{status}</text>
      </div>
    </main>
  )
}

render(<App />, { title: "GPUIX Accessibility Smoke", width: 620, height: 560 })
