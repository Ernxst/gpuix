import fs from "fs"
import path from "path"
import React from "react"
import { beforeAll, describe, expect, it, vi } from "vitest"
import { connectTest } from "../automation/index.js"
import type { GpuixSyntheticEvent, PublicInstance, StyleDesc } from "../index.js"
import { createTestRoot, isNativeTestRendererAvailable } from "../testing.js"
import { expectScreenshotsEqual, SHOTS_DIR } from "./test-utils.js"

const describeNative = isNativeTestRendererAvailable() ? describe : describe.skip

beforeAll(() => {
  fs.mkdirSync(SHOTS_DIR, { recursive: true })
})

function boundsFor(renderer: ReturnType<typeof createTestRoot>["renderer"], testId: string) {
  const element = renderer.findByTestId(testId)
  expect(element, `missing ${testId}`).toBeDefined()
  const bounds = renderer.getElementBounds(element!.id)
  expect(bounds, `no painted bounds for ${testId}`).toEqual(expect.any(Array))
  return bounds!
}

describeNative("inline text runs", () => {
  it("wraps and truncates styled descendants as one flowing string", () => {
    const shot = path.join(SHOTS_DIR, "inline-text-runs.png")
    const { render, renderer } = createTestRoot()
    const sentence = "Factory output is 240 parts per minute and rising."

    render(
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: 320,
          padding: 24,
          gap: 20,
          backgroundColor: "#10131a",
        }}
      >
        <text
          data-testid="wrapped-inline"
          style={{ width: 220, color: "#e6edf7", fontSize: 20, lineHeight: 27 }}
        >
          {"Factory output is "}
          <text style={{ color: "#7dd3fc", fontWeight: 700, letterSpacing: 1.5 }}>
            240 parts
          </text>
          {" per minute and "}
          <text style={{ color: "#86efac", textDecoration: "underline" }}>rising</text>
          {"."}
        </text>
        <text
          data-testid="truncated-inline"
          style={{
            width: 180,
            color: "#cbd5e1",
            fontSize: 18,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {"Status: "}
          <text style={{ color: "#fbbf24", fontWeight: "bold" }}>overclocked</text>
          {" production line"}
        </text>
      </div>
    )

    const painted = renderer.getPaintedText()
    expect(painted).toContain(sentence)
    expect(painted).toContain("Status: overclocked production line")
    expect(painted).not.toContain("240 parts")
    expect(boundsFor(renderer, "wrapped-inline")[3]).toBeGreaterThan(40)

    renderer.captureScreenshot(shot)
    expect(fs.existsSync(shot)).toBe(true)
    expect(fs.statSync(shot).size).toBeGreaterThan(0)
  })

  it("keeps a preformatted inline run as one selectable layout", () => {
    const shot = path.join(SHOTS_DIR, "inline-text-preformatted.png")
    const { render, renderer } = createTestRoot()
    const content = "line  1\nline  2: ready"

    render(
      <div style={{ display: "flex", padding: 24, width: 420, backgroundColor: "#10131a" }}>
        <text
          data-testid="preformatted-inline"
          style={{ whiteSpace: "pre", color: "#e6edf7", fontSize: 20, lineHeight: "1.4" }}
        >
          {"line  1\nline  "}
          <text style={{ color: "#7dd3fc", fontWeight: 700 }}>2: ready</text>
        </text>
      </div>,
    )

    expect(renderer.getPaintedText()).toContain(content)
    const [x, y, width, height] = boundsFor(renderer, "preformatted-inline")
    expect(height).toBeGreaterThan(40)
    expect(renderer.dragSelect(x + 1, y + 2, x + width + 10, y + height - 2)).toBe(content)

    renderer.captureScreenshot(shot)
    expect(fs.statSync(shot).size).toBeGreaterThan(0)
  })

  it("renders CRLF preformatted text identically to LF", () => {
    const lfSource = "line  1\nline  2: ready"
    const crlfSource = lfSource.replace(/\n/g, "\r\n")
    const style = { whiteSpace: "pre" as const, color: "#e6edf7", fontSize: 20, lineHeight: "1.4" }
    const source = (content: string) => (
      <div style={{ display: "flex", padding: 24, width: 420, backgroundColor: "#10131a" }}>
        <text style={style}>{content}</text>
      </div>
    )

    const lf = createTestRoot()
    lf.render(source(lfSource))
    const lfShot = path.join(SHOTS_DIR, "inline-text-preformatted-lf.png")
    lf.renderer.captureScreenshot(lfShot)

    const crlf = createTestRoot()
    crlf.render(source(crlfSource))
    const crlfShot = path.join(SHOTS_DIR, "inline-text-preformatted-crlf.png")
    crlf.renderer.captureScreenshot(crlfShot)

    expect(crlf.renderer.getPaintedText()).toEqual(lf.renderer.getPaintedText())
    expect(crlf.renderer.getAllText()).toEqual([lfSource])
    expectScreenshotsEqual(crlfShot, lfShot)
  })

  it("selects continuously across run boundaries and soft wraps", () => {
    const { render, renderer } = createTestRoot()
    const sentence = "Alpha beta gamma delta epsilon zeta eta theta."
    render(
      <div style={{ display: "flex", padding: 20, width: 220 }}>
        <text
          data-testid="selection-inline"
          style={{ width: 180, color: "#ffffff", fontSize: 18, lineHeight: 24 }}
        >
          {"Alpha beta "}
          <text style={{ color: "#f472b6", fontWeight: 700 }}>gamma delta</text>
          {" epsilon "}
          <text style={{ letterSpacing: 1 }}>zeta eta</text>
          {" theta."}
        </text>
      </div>
    )

    const [x, y, width, height] = boundsFor(renderer, "selection-inline")
    expect(renderer.dragSelect(x + 1, y + 4, x + width + 200, y + height - 2)).toBe(sentence)
  })

  it("keeps multibyte ranges on UTF-8 boundaries", () => {
    const shot = path.join(SHOTS_DIR, "inline-text-multibyte.png")
    const { render, renderer } = createTestRoot()
    const sentence = "Ångström 核🚀 café Ω"
    render(
      <div style={{ display: "flex", padding: 24, width: 360, backgroundColor: "#111827" }}>
        <text
          data-testid="multibyte-inline"
          style={{ width: 240, color: "#f8fafc", fontSize: 22, lineHeight: 30 }}
        >
          {"Ångström "}
          <text
            style={{
              color: "#fb7185",
              fontWeight: 700,
              letterSpacing: 2,
              textDecoration: "line-through",
            }}
          >
            核🚀
          </text>
          {" café Ω"}
        </text>
      </div>
    )

    expect(renderer.getPaintedText()).toContain(sentence)
    const [x, y, width, height] = boundsFor(renderer, "multibyte-inline")
    expect(renderer.dragSelect(x + 1, y + 4, x + width + 100, y + height - 2)).toBe(sentence)

    renderer.captureScreenshot(shot)
    expect(fs.statSync(shot).size).toBeGreaterThan(0)
  })

  it("uses the nested React host as the click target", () => {
    let targetCurrentTarget: PublicInstance | null = null
    const targetClick = vi.fn((event: GpuixSyntheticEvent) => {
      targetCurrentTarget = event.currentTarget
    })
    const parentClick = vi.fn()
    let target: PublicInstance | null = null
    const { render, renderer } = createTestRoot()

    render(
      <div onClick={parentClick} style={{ display: "flex", padding: 30 }}>
        <text style={{ color: "#ffffff", fontSize: 24 }}>
          {"Open "}
          <text
            ref={(instance) => {
              target = instance
            }}
            data-testid="inline-action"
            onClick={targetClick}
            style={{ color: "#60a5fa", textDecoration: "underline" }}
          >
            details
          </text>
          {" now"}
        </text>
      </div>
    )

    const [x, y, width, height] = boundsFor(renderer, "inline-action")
    renderer.nativeSimulateClick(x + width / 2, y + height / 2)

    expect(targetClick).toHaveBeenCalledOnce()
    expect(parentClick).toHaveBeenCalledOnce()
    const event = targetClick.mock.calls[0]![0] as GpuixSyntheticEvent
    expect(event.target).toBe(target)
    expect(targetCurrentTarget).toBe(target)
  })

  it("resolves an inner data-testid and preserves its event identity", async () => {
    const observedTargets: Array<[PublicInstance, PublicInstance]> = []
    const targetClick = vi.fn((event: GpuixSyntheticEvent) => {
      observedTargets.push([event.target, event.currentTarget])
    })
    let target: PublicInstance | null = null
    const { render, renderer } = createTestRoot()

    render(
      <div style={{ display: "flex", padding: 30 }}>
        <text style={{ color: "#ffffff", fontSize: 24 }}>
          {"Open "}
          <text
            ref={(instance) => {
              target = instance
            }}
            data-testid="inline-data-action"
            onClick={targetClick}
            style={{ color: "#60a5fa", textDecoration: "underline" }}
          >
            details
          </text>
          {" now"}
        </text>
      </div>
    )

    const lowLevel = renderer.findByTestId("inline-data-action")
    expect(lowLevel).toMatchObject({
      id: target?.id,
      type: "text",
      dataTestId: "inline-data-action",
    })

    const app = await connectTest(renderer)
    try {
      await expect(app.getByTestId("inline-data-action").element()).resolves.toMatchObject({
        id: lowLevel?.id,
        type: "text",
        dataTestId: "inline-data-action",
      })
      await app.getByTestId("inline-data-action").click()
    } finally {
      await app.close()
    }

    expect(targetClick).toHaveBeenCalledOnce()
    expect(observedTargets).toHaveLength(1)
    expect(observedTargets[0]![0]).toBe(target)
    expect(observedTargets[0]![1]).toBe(target)
  })

  it("rejects block and custom descendants with a precise error", () => {
    const reportError = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      const invalid = createTestRoot()
      invalid.render(
        <text>
          before
          <code code="const nope = true" />
        </text>
      )

      const error = reportError.mock.calls.flat().find((value) => value instanceof Error) as
        | Error
        | undefined
      expect(error).toBeInstanceOf(Error)
      expect(error?.message).toMatch(
        /<text> can contain only strings and nested <text> elements.*received <code>/is
      )
      expect(invalid.renderer.findByType("text")).toHaveLength(0)
    } finally {
      reportError.mockRestore()
    }
  })

  it("diagnoses styles that cannot vary within flowing text", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      const { render } = createTestRoot()
      render(
        <text>
          prefix
          <text
            data-testid="invalid-inline-style"
            style={{ paddingLeft: 8, color: "red" } as StyleDesc}
          >
            value
          </text>
        </text>
      )

      expect(warn).toHaveBeenCalledWith(expect.stringContaining("invalid-inline-style"))
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("paddingLeft"))
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("outer <text>"))
    } finally {
      warn.mockRestore()
    }
  })
})
