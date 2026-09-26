/** @jsxImportSource react */

import React from "react"
import { createRoot } from "react-dom/client"
import { powerRows } from "./table-data"

function App() {
  return (
    <main>
      <h1>Power rates</h1>
      <p>Native HTML table markup rendered by react-dom.</p>
      <table>
        <caption>Iron production</caption>
        <thead>
          <tr>
            <th scope="col">Item</th>
            <th scope="col">Machine</th>
            <th scope="col">Rate</th>
          </tr>
        </thead>
        <tbody>
          {powerRows.map((entry) => (
            <tr key={entry.item}>
              <th scope="row">{entry.item}</th>
              <td>{entry.machine}</td>
              <td>{entry.rate}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  )
}

createRoot(document.getElementById("root")!).render(<App />)
