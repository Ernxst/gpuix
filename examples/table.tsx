import React from "react"
import { render } from "@gpuix/react"
import { powerColumns, powerRows } from "./table-data"

const frame = {
  display: "flex",
  flexDirection: "column",
  gap: 18,
  width: 620,
  padding: 28,
  backgroundColor: "#171a21",
  color: "#edf0f6",
} as const

const row = {
  display: "grid",
  gridTemplateColumns: powerColumns,
  columnGap: 12,
  alignItems: "center",
  padding: 9,
} as const

const cell = {
  minWidth: 0,
  color: "#cbd1dc",
} as const

function App() {
  return (
    <main style={frame}>
      <h1 style={{ fontSize: 23, fontWeight: "bold" }}>Power rates</h1>
      <text style={{ color: "#a9b2c1" }}>
        Table elements use ordinary GPUI boxes. Each row shares one authored grid template.
      </text>
      <table style={{ display: "flex", flexDirection: "column", gap: 1 }}>
        <caption style={{ padding: 10, color: "#edf0f6", fontWeight: "bold" }}>
          Iron production
        </caption>
        <thead style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <tr style={{ ...row, backgroundColor: "#303746" }}>
            <th scope="col" style={{ ...cell, color: "#ffffff", fontWeight: "bold" }}>
              Item
            </th>
            <th scope="col" style={{ ...cell, color: "#ffffff", fontWeight: "bold" }}>
              Machine
            </th>
            <th scope="col" style={{ ...cell, color: "#ffffff", fontWeight: "bold" }}>
              Rate
            </th>
          </tr>
        </thead>
        <tbody style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          {powerRows.map((entry) => (
            <tr key={entry.item} style={{ ...row, backgroundColor: "#222733" }}>
              <th scope="row" style={{ ...cell, color: "#edf0f6" }}>
                {entry.item}
              </th>
              <td style={cell}>{entry.machine}</td>
              <td style={cell}>{entry.rate}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  )
}

render(<App />, { title: "GPUIX Table Example", width: 676, height: 390 })
