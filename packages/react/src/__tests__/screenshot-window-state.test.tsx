import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"

import React from "react"
import { expect, it } from "vitest"

import { decodePng } from "../testing-png.js"
import { isNativeTestRendererAvailable } from "../testing.js"
import { cleanup, disposeSharedWindow, render } from "../testing-vitest.js"

const itNative = isNativeTestRendererAvailable() ? it : it.skip

const labels = ["All", "Routed", "Reclaimable", "Unbuilt", "Attention"]
const options = { width: 1280, height: 800, scaleFactor: 2 }

function Scene({ selected, rows = true }: { selected: string; rows?: boolean }) {
  return (
    <div style={{ width: 1280, height: 800, background: "#1a2226", position: "relative" }}>
      {rows && <div style={{ display: "flex", flexDirection: "column" }}>
        {Array.from({ length: 6 }, (_, i) => <div key={i} style={{ display: "flex", height: 24, fontFamily: "Avenir Next", fontSize: 12, color: "#e8ecec" }}>
          <span>Item {i} Wire Limestone Rotor Motor Cable</span>
          <span style={{ fontFamily: "Menlo" }}>{i * 123.45}</span>
        </div>)}
      </div>}
      <div style={{ position: "absolute", left: 612, top: 741, display: "flex", gap: 2 }}>
        {labels.map(label => <button key={label} style={{
          display: "flex", alignItems: "center", minHeight: 36, padding: 7,
          background: label === selected ? "#11171b" : "#2e383f",
        }}><span style={{ fontFamily: "Avenir Next", fontSize: 12, fontWeight: 500,
          lineHeight: "18px", color: label === selected ? "#e8ecec" : "#afbab9" }}>{label}</span></button>)}
      </div>
    </div>
  )
}

// Glyphs painted in one layer share a scene order. Overlapping glyphs, such as
// the two t's in "Attention", must blend in paint order: an order that follows
// atlas tile ids depends on what the reused window rasterised earlier.
itNative("renders text identically in fresh and reused test windows", { timeout: 20_000 }, () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "gpuix-window-state-"))
  try {
    const cold = render(<Scene selected="All" />, options)
    cold.rerender(<Scene selected="Attention" />)
    cold.renderer.captureScreenshot(path.join(directory, "cold.png"))
    cleanup()
    disposeSharedWindow()

    render(<Scene selected="All" rows={false} />, options)
    cleanup()
    const warm = render(<Scene selected="All" />, options)
    warm.rerender(<Scene selected="Attention" />)
    warm.renderer.captureScreenshot(path.join(directory, "warm.png"))

    const a = decodePng(readFileSync(path.join(directory, "cold.png")))
    const b = decodePng(readFileSync(path.join(directory, "warm.png")))
    const differing: number[] = []
    for (let i = 0; i < a.data.length; i += 4) {
      if (!a.data.subarray(i, i + 4).equals(b.data.subarray(i, i + 4))) differing.push(i / 4)
    }
    console.log("different pixels", differing.map(i => [i % a.width, Math.floor(i / a.width)]))
    expect(differing).toEqual([])
  } finally {
    cleanup()
    disposeSharedWindow()
    rmSync(directory, { recursive: true, force: true })
  }
})

const emoji = ["😀", "🚀", "🎉", "🍕", "🐙", "🌈"]

function EmojiScene({ preliminary = false }: { preliminary?: boolean }) {
  return (
    <div style={{ width: 400, height: 200, background: "#1a2226", display: "flex", flexDirection: "column" }}>
      {preliminary && <span style={{ fontSize: 20 }}>{"🐙🌈🍕🎉".repeat(3)}</span>}
      <span style={{ fontSize: 24, letterSpacing: -12 }}>{emoji.join("")}</span>
    </div>
  )
}

// Emoji are polychrome sprites; with negative letter spacing they overlap
// and must blend in paint order too.
itNative("renders overlapping emoji identically in fresh and reused test windows", { timeout: 20_000 }, () => {
  const emojiOptions = { width: 400, height: 200, scaleFactor: 2 }
  const directory = mkdtempSync(path.join(os.tmpdir(), "gpuix-window-state-"))
  try {
    render(<EmojiScene />, emojiOptions).renderer.captureScreenshot(path.join(directory, "cold.png"))
    cleanup()
    disposeSharedWindow()

    render(<EmojiScene preliminary />, emojiOptions)
    cleanup()
    render(<EmojiScene />, emojiOptions).renderer.captureScreenshot(path.join(directory, "warm.png"))

    const a = decodePng(readFileSync(path.join(directory, "cold.png")))
    const b = decodePng(readFileSync(path.join(directory, "warm.png")))
    let differing = 0
    for (let i = 0; i < a.data.length; i += 4) {
      if (!a.data.subarray(i, i + 4).equals(b.data.subarray(i, i + 4))) differing++
    }
    expect(differing).toBe(0)
  } finally {
    cleanup()
    disposeSharedWindow()
    rmSync(directory, { recursive: true, force: true })
  }
})
