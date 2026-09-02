/// Accessibility props are universal host props, so every custom element has to
/// project them. Before this, only <img> and <input> did, and an explicit role
/// on <canvas>, <svg>, <code>, <diff>, <markdown> or <anchored> was inert.
import React from "react"
import { describe, expect, it } from "vitest"
import { createTestRoot, isNativeTestRendererAvailable } from "../testing.js"

const describeNative = isNativeTestRendererAvailable() ? describe : describe.skip

const ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" fill="#000"/></svg>'

const PATCH =
  "diff --git a/file.txt b/file.txt\n--- a/file.txt\n+++ b/file.txt\n@@ -1 +1 @@\n-old\n+new"

describeNative("accessibility props on custom elements", () => {
  it("projects an explicit role and name from <canvas>", () => {
    const screen = createTestRoot()

    try {
      screen.render(
        <canvas
          data-testid="chart"
          role="img"
          ariaLabel="Throughput chart"
          width={120}
          height={80}
        />
      )

      expect(screen.getByRole("img", { name: "Throughput chart" })).toBe(
        screen.getByTestId("chart")
      )
    } finally {
      screen.unmount()
    }
  })

  it("gives <svg> the graphics-document role by default", () => {
    const screen = createTestRoot()

    try {
      screen.render(
        <svg data-testid="icon" source={ICON} style={{ width: 32, height: 32 }} />
      )

      expect(screen.getByRole("graphics-document")).toBe(screen.getByTestId("icon"))
    } finally {
      screen.unmount()
    }
  })

  it("lets an explicit role and name override the svg default", () => {
    const screen = createTestRoot()

    try {
      screen.render(
        <svg
          data-testid="icon"
          role="img"
          ariaLabel="Reactor status"
          source={ICON}
          style={{ width: 32, height: 32 }}
        />
      )

      expect(screen.getByRole("img", { name: "Reactor status" })).toBe(
        screen.getByTestId("icon")
      )
      expect(screen.queryByRole("graphics-document")).toBeNull()
    } finally {
      screen.unmount()
    }
  })

  it("projects an explicit role and name from <code>", () => {
    const screen = createTestRoot()

    try {
      screen.render(
        <code
          data-testid="sample"
          role="region"
          ariaLabel="Reactor sample"
          code="const power = 1"
          language="typescript"
        />
      )

      expect(screen.getByRole("region", { name: "Reactor sample" })).toBe(
        screen.getByTestId("sample")
      )
    } finally {
      screen.unmount()
    }
  })

  it("projects an explicit role and name from <diff>", () => {
    const screen = createTestRoot()

    try {
      screen.render(
        <diff data-testid="changes" role="region" ariaLabel="Pending changes" patch={PATCH} />
      )

      expect(screen.getByRole("region", { name: "Pending changes" })).toBe(
        screen.getByTestId("changes")
      )
    } finally {
      screen.unmount()
    }
  })

  it("projects an explicit role and name from an empty <diff>", () => {
    const screen = createTestRoot()

    try {
      screen.render(
        <diff data-testid="changes" role="region" ariaLabel="Pending changes" patch="" />
      )

      expect(screen.getByRole("region", { name: "Pending changes" })).toBe(
        screen.getByTestId("changes")
      )
    } finally {
      screen.unmount()
    }
  })

  it("projects an explicit role and name from <markdown>", () => {
    const screen = createTestRoot()

    try {
      screen.render(
        <markdown
          data-testid="notes"
          role="article"
          ariaLabel="Release notes"
          source="A paragraph"
        />
      )

      expect(screen.getByRole("article", { name: "Release notes" })).toBe(
        screen.getByTestId("notes")
      )
    } finally {
      screen.unmount()
    }
  })

  it("projects the dialog role a popover needs from <anchored>", () => {
    const screen = createTestRoot()

    try {
      screen.render(
        <div style={{ width: 800, height: 500 }}>
          <anchored
            data-testid="popover"
            role="dialog"
            ariaLabel="Confirm shutdown"
            position={{ x: 300, y: 200 }}
            style={{ width: 240, height: 100, backgroundColor: "#1e1e2e" }}
          >
            <text>Shut the reactor down?</text>
          </anchored>
        </div>
      )

      expect(screen.getByRole("dialog", { name: "Confirm shutdown" })).toBe(
        screen.getByTestId("popover")
      )
    } finally {
      screen.unmount()
    }
  })

  it("keeps ariaHidden custom elements out of the accessibility tree", () => {
    const screen = createTestRoot()

    try {
      screen.render(
        <div>
          <canvas role="img" ariaLabel="Throughput chart" ariaHidden width={120} height={80} />
          <svg source={ICON} ariaHidden style={{ width: 32, height: 32 }} />
          <code code="const power = 1" role="region" ariaLabel="Sample" ariaHidden />
          <markdown source="A paragraph" role="article" ariaLabel="Notes" ariaHidden />
        </div>
      )

      expect(screen.queryByRole("img")).toBeNull()
      expect(screen.queryByRole("graphics-document")).toBeNull()
      expect(screen.queryByRole("region")).toBeNull()
      expect(screen.queryByRole("article")).toBeNull()
    } finally {
      screen.unmount()
    }
  })
})
