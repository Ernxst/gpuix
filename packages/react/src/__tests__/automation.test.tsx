/// In-process Playwright-like automation against the real GPU test renderer.

import fs from "fs"
import os from "os"
import path from "path"
import React, { useState } from "react"
import { describe, expect, it, vi } from "vitest"
import {
  browserRendererAsTest,
  connectTest,
  type LiveAutomationRenderer,
} from "../automation/index.js"
import { createRenderer } from "../reconciler/renderer.js"
import { createTestRoot, isNativeTestRendererAvailable, TestRenderer } from "../testing.js"
import type {
  AccessibilityRole,
  GpuixSyntheticEvent,
  RendererCapabilities,
} from "../types/host.js"

const SUPPORTED_ACCESSIBILITY_ROLES = [
  "alert",
  "alertdialog",
  "application",
  "article",
  "banner",
  "blockquote",
  "button",
  "caption",
  "cell",
  "checkbox",
  "code",
  "columnheader",
  "combobox",
  "comment",
  "complementary",
  "contentinfo",
  "definition",
  "deletion",
  "dialog",
  "document",
  "emphasis",
  "feed",
  "figure",
  "form",
  "generic",
  "grid",
  "gridcell",
  "group",
  "heading",
  "img",
  "insertion",
  "link",
  "list",
  "listbox",
  "listitem",
  "log",
  "main",
  "mark",
  "marquee",
  "math",
  "menu",
  "menubar",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "meter",
  "navigation",
  "none",
  "note",
  "option",
  "paragraph",
  "presentation",
  "progressbar",
  "radio",
  "radiogroup",
  "region",
  "row",
  "rowgroup",
  "rowheader",
  "scrollbar",
  "search",
  "searchbox",
  "sectionfooter",
  "sectionheader",
  "separator",
  "slider",
  "spinbutton",
  "status",
  "strong",
  "suggestion",
  "switch",
  "tab",
  "table",
  "tablist",
  "tabpanel",
  "term",
  "textbox",
  "time",
  "timer",
  "toolbar",
  "tooltip",
  "tree",
  "treegrid",
  "treeitem",
  "graphics-document",
  "graphics-object",
  "graphics-symbol",
  "doc-abstract",
  "doc-acknowledgments",
  "doc-afterword",
  "doc-appendix",
  "doc-backlink",
  "doc-biblioentry",
  "doc-bibliography",
  "doc-biblioref",
  "doc-chapter",
  "doc-colophon",
  "doc-conclusion",
  "doc-cover",
  "doc-credit",
  "doc-credits",
  "doc-dedication",
  "doc-endnote",
  "doc-endnotes",
  "doc-epigraph",
  "doc-epilogue",
  "doc-errata",
  "doc-example",
  "doc-footnote",
  "doc-foreword",
  "doc-glossary",
  "doc-glossref",
  "doc-index",
  "doc-introduction",
  "doc-noteref",
  "doc-notice",
  "doc-pagebreak",
  "doc-pagefooter",
  "doc-pageheader",
  "doc-pagelist",
  "doc-part",
  "doc-preface",
  "doc-prologue",
  "doc-pullquote",
  "doc-qna",
  "doc-subtitle",
  "doc-tip",
  "doc-toc",
] as const satisfies readonly AccessibilityRole[]

const describeNative = isNativeTestRendererAvailable() ? describe : describe.skip

function Counter() {
  const [count, setCount] = useState(0)
  return (
    <div style={{ width: 400, height: 200 }}>
      <div
        testId="inc"
        style={{ width: 200, height: 80 }}
        onClick={() => setCount((value) => value + 1)}
      >
        <text>{`Count: ${count}`}</text>
      </div>
    </div>
  )
}

describeNative("automation", () => {
  it("reads the active live native frame clock", () => {
    const renderer = createRenderer()
    const platform = process.platform === "darwin" ? "macos" : "windows"

    expect(renderer.capabilities()).toMatchObject({
      platform,
      frameClock:
        platform === "macos"
          ? { kind: "timer", requiresTick: true, externalFrame: true }
          : { kind: "timer", requiresTick: false, externalFrame: false },
      window: { activation: true, activate: platform === "macos", resize: true, multiple: false },
      images: { privateNetwork: true },
      automation: {
        click: true,
        hover: true,
        drag: true,
        scrollWheel: true,
        keyboard: "native",
        screenshot: true,
        screenshotFormats: ["png"],
        clock: true,
        tree: true,
      },
    })

    if (platform === "macos") {
      expect(renderer.setFrameRequestHandler(() => {})).toBe(true)
      expect(renderer.capabilities().frameClock.kind).toBe("display-link")
      renderer.setFrameRequestHandler(null)
      expect(renderer.capabilities().frameClock.kind).toBe("timer")
    }
  })

  it("reads offscreen renderer capabilities separately from the display clock", () => {
    const renderer = new TestRenderer()
    try {
      expect(renderer.capabilities()).toMatchObject({
        platform: process.platform === "darwin" ? "macos" : "windows",
        frameClock: { kind: "manual", requiresTick: false, externalFrame: false },
        window: { activation: true, activate: false, resize: true, multiple: false },
        images: { privateNetwork: true },
        automation: {
          hover: true,
          drag: true,
          scrollWheel: true,
          screenshot: true,
          screenshotFormats: ["png"],
        },
      })
      try {
        renderer.activateWindow()
        throw new Error("Expected offscreen activation to be unsupported")
      } catch (error) {
        expect(error).toMatchObject({
          name: "UnsupportedCapabilityError",
          code: "ERR_GPUX_UNSUPPORTED_CAPABILITY",
          capability: "window.activate",
        })
      }
    } finally {
      renderer.dispose()
    }
  })

  it("preserves identity attributes for native automation and synthetic events", async () => {
    const attributes: Array<string | null> = []
    const { render, renderer } = createTestRoot()

    render(
      <div
        id="site-state"
        data-testid="hover-underline"
        data-state="ready"
        onClick={(event) => {
          attributes.push(
            event.currentTarget.getAttribute("id"),
            event.currentTarget.getAttribute("data-testid"),
            event.currentTarget.getAttribute("data-state")
          )
        }}
        style={{ width: 200, height: 80 }}
      />
    )

    const heading = renderer.findByElementId("site-state")
    expect(heading).toMatchObject({
      authorId: "site-state",
      dataTestId: "hover-underline",
      customProps: { "data-testid": "hover-underline", "data-state": "ready" },
    })
    expect(renderer.findByTestId("hover-underline")).toMatchObject({
      id: heading?.id,
      type: "div",
    })
    expect(renderer.findByElementId("missing")).toBeUndefined()

    const app = await connectTest(renderer)
    await expect(app.call("getTree", {})).resolves.toMatchObject({
      tree: { authorId: "site-state" },
    })
    await expect(app.getByTestId("hover-underline").element()).resolves.toMatchObject({
      id: heading?.id,
      dataTestId: "hover-underline",
    })
    await app.close()

    renderer.nativeSimulateClick(100, 40)
    expect(attributes).toEqual(["site-state", "hover-underline", "ready"])
  })

  it("removes identity attributes instead of retaining a literal null value", () => {
    const { render, renderer } = createTestRoot()

    render(<div id="site" data-testid="row" />)
    expect(renderer.findByElementId("site")).toBeDefined()
    expect(renderer.findByTestId("row")).toBeDefined()

    render(<div />)
    expect(renderer.findByElementId("site")).toBeUndefined()
    expect(renderer.findByTestId("row")).toBeUndefined()
    expect(renderer.findByElementId("null")).toBeUndefined()
    expect(renderer.findByTestId("null")).toBeUndefined()
  })

  it("synthesizes button semantics, focus, and activation without author role or tabIndex", () => {
    const actions: string[] = []
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const { render, renderer } = createTestRoot({ strictStyles: false })

    render(
      <button
        id="save"
        ariaLabel="Save factory"
        style={{ width: 120, height: 50 }}
        onClick={() => actions.push("click")}
      />
    )

    const element = renderer.findByElementId("save")!
    const tree = renderer.getAccessibilityTree()
    const button = Object.values(tree.nodes).find(
      (node) => node.aria.role === "Button" && node.aria.label === "Save factory"
    )
    expect(button).toMatchObject({
      aria: {
        role: "Button",
        label: "Save factory",
        on_action: expect.arrayContaining(["Click", "Focus"]),
      },
    })
    expect(button?.aria.on_action).not.toEqual(expect.arrayContaining(["Increment", "Decrement"]))
    expect(tree.frame?.tab_stop_count).toBe(1)

    renderer.nativeSimulateClick(60, 25)
    expect(actions).toEqual(["click"])

    renderer.focusElement(element.id)
    renderer.nativeSimulateKeystrokes(element.id, "enter")
    expect(actions).toEqual(["click", "click"])

    renderer.nativeSimulateKeystrokes(element.id, "space")
    expect(actions).toEqual(["click", "click", "click"])

    renderer.nativeSimulateAccessibilityAction(button!.accesskit_id, "activate")
    expect(actions).toEqual(["click", "click", "click", "click"])

    render(
      <div>
        <button role="checkbox" ariaChecked={false} ariaLabel="Explicit checkbox role" />
        <button
          {...({ accessibilityRole: "checkbox" } as Record<string, string>)}
          ariaLabel="Unsupported role spelling"
        />
      </div>
    )
    const roleTree = renderer.getAccessibilityTree()
    const explicitRole = Object.values(roleTree.nodes).find(
      (node) => node.aria.label === "Explicit checkbox role"
    )!
    const unsupportedSpelling = Object.values(roleTree.nodes).find(
      (node) => node.aria.label === "Unsupported role spelling"
    )!
    expect(explicitRole.aria.role).toBe("CheckBox")
    expect(unsupportedSpelling.aria.role).toBe("Button")
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/<button> does not support accessibilityRole\. Use role instead\./)
    )

    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    const strict = createTestRoot({ strictStyles: true })
    strict.render(
      <button
        {...({ accessibilityRole: "checkbox" } as Record<string, string>)}
        ariaLabel="Strict unsupported role spelling"
      />
    )
    expect(error.mock.calls.flat()).toContainEqual(
      expect.objectContaining({
        name: "UnsupportedAccessibilityRolePropError",
        message: expect.stringContaining("Use role instead."),
      })
    )
    strict.unmount()
    error.mockRestore()
    warn.mockRestore()
  })

  it("routes AccessKit activate through the same click pipeline with or without an action handler", () => {
    const { render, renderer } = createTestRoot()
    const trace: string[] = []
    const record = (name: string, event: GpuixSyntheticEvent) => {
      trace.push(`${name}:${event.eventPhase}:${event.target.id}:${event.currentTarget.id}`)
      if (name === "target-bubble") event.preventDefault()
    }
    const app = (withActionHandler: boolean) => (
      <div
        testId="activation-parent"
        style={{ width: 240, height: 100 }}
        onClickCapture={(event) => record("parent-capture", event)}
        onClick={(event) => record("parent-bubble", event)}
      >
        <button
          testId="activation-target"
          role="button"
          ariaLabel="Run"
          style={{ width: 120, height: 50 }}
          onClickCapture={(event) => record("target-capture", event)}
          onClick={(event) => record("target-bubble", event)}
          {...(withActionHandler
            ? { onAccessibilityAction: () => trace.push("accessibility-action") }
            : {})}
        />
      </div>
    )

    render(app(false))
    const withoutHandlerNode = Object.values(renderer.getAccessibilityTree().nodes).find(
      (node) => node.aria.label === "Run"
    )!
    renderer.nativeSimulateAccessibilityAction(withoutHandlerNode.accesskit_id, "activate")
    const withoutHandler = [...trace]

    trace.length = 0
    render(app(true))
    const withHandlerNode = Object.values(renderer.getAccessibilityTree().nodes).find(
      (node) => node.aria.label === "Run"
    )!
    renderer.nativeSimulateAccessibilityAction(withHandlerNode.accesskit_id, "activate")

    expect(trace).toEqual(withoutHandler)
    expect(trace.map((entry) => entry.split(":")[0])).toEqual([
      "parent-capture",
      "target-capture",
      "target-bubble",
      "parent-bubble",
    ])
  })

  it.each([
    ["disabled", { disabled: true }],
    ["ariaDisabled", { ariaDisabled: true }],
  ] as const)("refuses pointer, keyboard, and AccessKit activation when %s", (_name, state) => {
    const seen: string[] = []
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const { render, renderer } = createTestRoot()

    render(
      <div style={{ width: 240, height: 100 }}>
        <button
          {...(state as Record<string, boolean>)}
          testId="disabled-control"
          ariaLabel="Unavailable"
          style={{ width: 120, height: 50 }}
          onClick={() => seen.push("click")}
          onAccessibilityAction={(event) =>
            seen.push(`a11y:${event.accessibilityAction ?? "missing"}`)
          }
        >
          <text>Unavailable</text>
        </button>
      </div>
    )

    const element = renderer.findByTestId("disabled-control")!
    const tree = renderer.getAccessibilityTree()
    const node = Object.values(tree.nodes).find((candidate) => candidate.aria.label === "Unavailable")!
    expect(node.aria.role).toBe("Button")
    expect(node.aria.disabled).toBe(true)
    expect(tree.frame?.tab_stop_count).toBe(_name === "ariaDisabled" ? 1 : 0)
    expect(node.aria.on_action ?? []).not.toContain("Click")
    if (_name === "ariaDisabled") {
      expect(node.aria.on_action ?? []).toContain("Focus")
    } else {
      expect(node.aria.on_action ?? []).not.toContain("Focus")
    }

    renderer.nativeSimulateClick(20, 20)
    renderer.nativeSimulateKeystrokes(element.id, "enter")
    renderer.nativeSimulateAccessibilityAction(node.accesskit_id, "activate")

    expect(seen).toEqual([])
    expect(warn.mock.calls.flat().join("\n")).not.toContain("requires an explicit supported role")
  })

  it("publishes semantics on text, input, and img hosts", () => {
    const { render, renderer } = createTestRoot()

    render(
      <div>
        <text role="heading" ariaLabel="Search heading" ariaLevel={2}>
          Search
        </text>
        <input role="textbox" ariaLabel="Recipe search" />
        <img
          role="img"
          ariaLabel="Recipe preview"
          src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1' height='1'/%3E"
        />
      </div>
    )

    const nodes = Object.values(renderer.getAccessibilityTree().nodes)
    const byLabel = (label: string) => nodes.find((node) => node.aria.label === label)
    expect(byLabel("Search heading")).toMatchObject({
      aria: { role: "Heading", label: "Search heading", level: 2 },
    })
    expect(byLabel("Recipe search")).toMatchObject({
      aria: { role: "TextInput", label: "Recipe search" },
    })
    const imageNodes = nodes.filter((node) => node.aria.role === "Image")
    expect(imageNodes).toHaveLength(1)
    expect(byLabel("Recipe preview")).toMatchObject({
      aria: { role: "Image", label: "Recipe preview" },
    })
  })

  it("gives <img> its implicit role and its alt name", () => {
    const { render, renderer } = createTestRoot()
    const src =
      "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1' height='1'/%3E"

    render(
      <div>
        <img src={src} alt="Recipe preview" />
        <img src={src} alt="Ignored alt" ariaLabel="Authored name" />
        <img src={src} />
        <img src={src} alt="" />
      </div>
    )

    const nodes = Object.values(renderer.getAccessibilityTree().nodes)
    const images = nodes.filter((node) => node.aria.role === "Image")
    // The decorative `alt=""` image is the only one without an image node.
    expect(images).toHaveLength(3)
    const labels = images.map((node) => node.aria.label)
    expect(labels).toContain("Recipe preview")
    expect(labels).toContain("Authored name")
    expect(labels).not.toContain("Ignored alt")
  })

  it("aliases supported aria props on built-in and custom hosts", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const { render, renderer } = createTestRoot({ strictStyles: true })

    render(
      <div>
        <div role="button" ariaLabel="Camel built-in" />
        <div role="button" aria-label="Hyphen built-in" />
        <img role="img" ariaLabel="Camel custom" />
        <img role="img" aria-label="Hyphen custom" />
        <div
          role="checkbox"
          ariaLabel="Camel checked built-in"
          ariaDescription="Built-in state"
          ariaChecked
          ariaDisabled
        />
        <div
          role="checkbox"
          aria-label="Hyphen checked built-in"
          aria-description="Built-in state"
          aria-checked
          aria-disabled
        />
        <input
          role="checkbox"
          ariaLabel="Camel checked custom"
          ariaDescription="Custom state"
          ariaChecked
          ariaDisabled
        />
        <input
          role="checkbox"
          aria-label="Hyphen checked custom"
          aria-description="Custom state"
          aria-checked
          aria-disabled
        />
        <div role="button" ariaLabel="Camel expanded built-in" ariaExpanded />
        <div role="button" aria-label="Hyphen expanded built-in" aria-expanded />
        <input role="button" ariaLabel="Camel expanded custom" ariaExpanded />
        <input role="button" aria-label="Hyphen expanded custom" aria-expanded />
        <div role="option" ariaLabel="Camel selected built-in" ariaSelected />
        <div role="option" aria-label="Hyphen selected built-in" aria-selected />
        <input role="option" ariaLabel="Camel selected custom" ariaSelected />
        <input role="option" aria-label="Hyphen selected custom" aria-selected />
        <div role="heading" ariaLabel="Camel level built-in" ariaLevel={3} />
        <div role="heading" aria-label="Hyphen level built-in" aria-level={3} />
        <input role="heading" ariaLabel="Camel level custom" ariaLevel={3} />
        <input role="heading" aria-label="Hyphen level custom" aria-level={3} />
        <div
          role="slider"
          ariaLabel="Camel value built-in"
          ariaValue="Medium"
          ariaValueMin={1}
          ariaValueMax={3}
          ariaValueNow={2}
        />
        <div
          role="slider"
          aria-label="Hyphen value built-in"
          aria-valuetext="Medium"
          aria-valuemin={1}
          aria-valuemax={3}
          aria-valuenow={2}
        />
        <input
          role="slider"
          ariaLabel="Camel value custom"
          ariaValue="Medium"
          ariaValueMin={1}
          ariaValueMax={3}
          ariaValueNow={2}
        />
        <input
          role="slider"
          aria-label="Hyphen value custom"
          aria-valuetext="Medium"
          aria-valuemin={1}
          aria-valuemax={3}
          aria-valuenow={2}
        />
        <div ariaHidden>
          <div role="button" ariaLabel="Camel hidden built-in" />
        </div>
        <div aria-hidden>
          <div role="button" ariaLabel="Hyphen hidden built-in" />
        </div>
        <img role="img" ariaLabel="Camel hidden custom" ariaHidden />
        <img role="img" aria-label="Hyphen hidden custom" aria-hidden />
      </div>
    )
    renderer.flush()
    renderer.drawPendingFrame()

    const nodes = Object.values(renderer.getAccessibilityTree().nodes)
    const byLabel = (label: string) => nodes.find((node) => node.aria.label === label)?.aria
    for (const [camel, hyphen, expected] of [
      ["Camel built-in", "Hyphen built-in", { role: "Button" }],
      ["Camel custom", "Hyphen custom", { role: "Image" }],
      [
        "Camel checked built-in",
        "Hyphen checked built-in",
        { role: "CheckBox", description: "Built-in state", toggled: "True", disabled: true },
      ],
      [
        "Camel checked custom",
        "Hyphen checked custom",
        { role: "CheckBox", description: "Custom state", toggled: "True", disabled: true },
      ],
      ["Camel expanded built-in", "Hyphen expanded built-in", { role: "Button", expanded: true }],
      ["Camel expanded custom", "Hyphen expanded custom", { role: "Button", expanded: true }],
      ["Camel selected built-in", "Hyphen selected built-in", { role: "ListBoxOption", selected: true }],
      ["Camel selected custom", "Hyphen selected custom", { role: "ListBoxOption", selected: true }],
      ["Camel level built-in", "Hyphen level built-in", { role: "Heading", level: 3 }],
      ["Camel level custom", "Hyphen level custom", { role: "Heading", level: 3 }],
      [
        "Camel value built-in",
        "Hyphen value built-in",
        { role: "Slider", value: "Medium", min_numeric_value: 1, max_numeric_value: 3, numeric_value: 2 },
      ],
      [
        "Camel value custom",
        "Hyphen value custom",
        { role: "Slider", value: "Medium", min_numeric_value: 1, max_numeric_value: 3, numeric_value: 2 },
      ],
    ] as const) {
      expect(byLabel(camel)).toMatchObject(expected)
      expect(byLabel(hyphen)).toMatchObject(expected)
    }
    expect(nodes.map((node) => node.aria.label)).not.toEqual(
      expect.arrayContaining([
        "Camel hidden built-in",
        "Hyphen hidden built-in",
        "Camel hidden custom",
        "Hyphen hidden custom",
      ])
    )
    expect(warn).not.toHaveBeenCalled()
  })

  it("publishes every ariaCurrent token as AccessKit current-item state", () => {
    const values = ["page", "step", "location", "date", "time", "true", "false"] as const
    const { render, renderer } = createTestRoot({ strictStyles: true })

    render(
      <div>
        {values.flatMap((current) => [
          <a key={`camel-${current}`} ariaLabel={`Camel ${current}`} ariaCurrent={current} />,
          <a
            key={`hyphen-${current}`}
            aria-label={`Hyphen ${current}`}
            aria-current={current}
          />,
        ])}
      </div>
    )
    renderer.flush()
    renderer.drawPendingFrame()

    const nodes = Object.values(renderer.getAccessibilityTree().nodes)
    const byLabel = (label: string) => nodes.find((node) => node.aria.label === label)?.aria
    for (const current of values) {
      const expected = `${current[0].toUpperCase()}${current.slice(1)}`
      expect(byLabel(`Camel ${current}`)).toMatchObject({ role: "Link", current: expected })
      expect(byLabel(`Hyphen ${current}`)).toMatchObject({ role: "Link", current: expected })
    }
  })

  it("warns once per instance for unsupported hyphenated aria props under strict mode", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const strict = createTestRoot({ strictStyles: true })
    strict.render(<div {...({ "aria-busy": "true" } as Record<string, string>)} />)
    strict.render(
      <div {...({ "aria-busy": "false" } as Record<string, string>)} />
    )
    strict.render(
      <div {...({ "aria-busy": "true" } as Record<string, string>)} />
    )
    expect(error).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/aria-busy.*no camelCase GPUIX accessibility prop/)
    )
    strict.unmount()
  })

  it("publishes flattened plain text and suppresses every hidden text funnel", () => {
    const { render, renderer } = createTestRoot()

    render(
      <div>
        <text>
          Readable <text>plain</text> text
        </text>
        <div ariaHidden>
          <text>Hidden retained text</text>
          <code code="hidden code" />
          <markdown source="Hidden markdown" />
          <diff
            patch={
              "diff --git a/file.txt b/file.txt\n--- a/file.txt\n+++ b/file.txt\n@@ -1 +1 @@\n-old\n+new"
            }
          />
        </div>
      </div>
    )
    renderer.flush()
    renderer.drawPendingFrame()
    const tree = renderer.getAccessibilityTree()

    const labels = Object.values(tree.nodes)
      .filter((node) => node.aria.role === "Label")
      .map((node) => node.aria.value)
    expect(labels).toEqual(["Readable plain text"])
    expect(tree.frame?.node_count).toBe(2)
  })

  it("keeps authored text in accessibility when pixels are transformed", () => {
    const { render, renderer } = createTestRoot()

    render(
      <div>
        <text style={{ color: "#ffffff", textTransform: "uppercase" }}>
          Built
        </text>
        <text style={{ color: "#ffffff", textTransform: "lowercase" }}>
          LOUD
        </text>
      </div>
    )
    renderer.flush()
    renderer.drawPendingFrame()

    const labels = Object.values(renderer.getAccessibilityTree().nodes)
      .filter((node) => node.aria.role === "Label")
      .map((node) => node.aria.value)
    expect(labels).toEqual(["Built", "LOUD"])
    expect(renderer.getPaintedText()).toEqual(["BUILT", "loud"])
  })

  it("gives a roled text host its flattened name without a duplicate Label", () => {
    const { render, renderer } = createTestRoot()

    render(
      <div>
        <text role="heading" ariaLevel={2}>
          Production <text>totals</text>
        </text>
        <text role="heading" ariaLevel={3} ariaLabel="Explicit totals name">
          Ignored contents
        </text>
      </div>
    )
    renderer.flush()
    renderer.drawPendingFrame()
    const tree = renderer.getAccessibilityTree()
    const nodes = Object.values(tree.nodes)

    expect(nodes.find((node) => node.aria.label === "Production totals")).toMatchObject({
      aria: { role: "Heading", label: "Production totals", level: 2 },
    })
    expect(nodes.find((node) => node.aria.label === "Explicit totals name")).toMatchObject({
      aria: { role: "Heading", label: "Explicit totals name", level: 3 },
    })
    expect(nodes.some((node) => node.aria.role === "Label")).toBe(false)
  })

  it.each([
    [
      "A: names a link wrapper from descendant text",
      <a role="link">
        <text>Coal Current</text>
      </a>,
      { role: "Link", label: "Coal Current" },
    ],
    [
      "B: keeps unroled text exposed as a Label",
      <div>
        <text>Coal Current</text>
      </div>,
      { role: "Label", value: "Coal Current" },
    ],
    [
      "C: names a roled text host from its contents",
      <text role="link">Coal Current</text>,
      { role: "Link", label: "Coal Current" },
    ],
    [
      "D: keeps an explicit link name",
      <a role="link" ariaLabel="Coal Current">
        <text>Coal Current</text>
      </a>,
      { role: "Link", label: "Coal Current" },
    ],
    [
      "E: names a button wrapper from descendant text",
      <div role="button">
        <text>Save</text>
      </div>,
      { role: "Button", label: "Save" },
    ],
  ] as const)("%s", (_name, contents, expected) => {
    const { render, renderer } = createTestRoot()

    render(<div>{contents}</div>)
    renderer.flush()
    renderer.drawPendingFrame()
    const nodes = Object.values(renderer.getAccessibilityTree().nodes)

    expect(nodes.find((node) => node.aria.role === expected.role)).toMatchObject({
      aria: expected,
    })
    expect(nodes.some((node) => node.aria.role === "Label")).toBe(expected.role === "Label")
  })

  it("keeps descendant text reachable for every accessibility role", () => {
    const { render, renderer } = createTestRoot()

    render(
      <div>
        {SUPPORTED_ACCESSIBILITY_ROLES.map((role) => {
          const contents = `contents:${role}`
          return (
            <div key={role} role={role}>
              <text>{contents}</text>
            </div>
          )
        })}
      </div>
    )
    renderer.flush()
    renderer.drawPendingFrame()
    const nodes = Object.values(renderer.getAccessibilityTree().nodes)
    const missing = SUPPORTED_ACCESSIBILITY_ROLES.filter((role) => {
      const contents = `contents:${role}`
      return !nodes.some(
        (node) => node.aria.label === contents || node.aria.value === contents
      )
    })

    expect(SUPPORTED_ACCESSIBILITY_ROLES).toHaveLength(128)
    expect(new Set(SUPPORTED_ACCESSIBILITY_ROLES).size).toBe(128)
    expect(missing).toEqual([])
  })

  it.each([
    ["textbox", "TextInput"],
    ["tooltip", "Tooltip"],
  ] as const)(
    "keeps %s contents as descendant text without deriving a name",
    (role, nativeRole) => {
      const { render, renderer } = createTestRoot()

      render(
        <div role={role}>
          <text>Hello</text>
        </div>
      )
      renderer.flush()
      renderer.drawPendingFrame()
      const nodes = Object.values(renderer.getAccessibilityTree().nodes)
      const roleNode = nodes.find((node) => node.aria.role === nativeRole)!

      expect(roleNode.aria).toMatchObject({ role: nativeRole })
      expect(roleNode.aria).not.toHaveProperty("label")
      expect(nodes.find((node) => node.aria.role === "Label")?.aria).toMatchObject({
        role: "Label",
        value: "Hello",
      })
    }
  )

  it("joins multiple descendant text runs with spaces in a contents-derived name", () => {
    const { render, renderer } = createTestRoot()

    render(
      <a role="link">
        <text>OVERVIEW</text>
        <text>5</text>
      </a>
    )
    renderer.flush()
    renderer.drawPendingFrame()
    const nodes = Object.values(renderer.getAccessibilityTree().nodes)

    expect(nodes.find((node) => node.aria.role === "Link")).toMatchObject({
      aria: { role: "Link", label: "OVERVIEW 5" },
    })
    expect(nodes.some((node) => node.aria.role === "Label")).toBe(false)
  })

  it("omits a child Label when link text matches its name", () => {
    const { render, renderer } = createTestRoot()

    render(
      <div>
        <a role="link" ariaLabel="Coal Current">
          <text>Coal Current</text>
        </a>
      </div>
    )
    renderer.flush()
    renderer.drawPendingFrame()
    const nodes = Object.values(renderer.getAccessibilityTree().nodes)

    expect(nodes.some((node) => node.aria.role === "Label")).toBe(false)
    expect(nodes.find((node) => node.aria.role === "Link")).toMatchObject({
      aria: { role: "Link", label: "Coal Current" },
    })
  })

  it("lets an explicit link name replace descendant text without emitting child Labels", () => {
    const { render, renderer } = createTestRoot()

    render(
      <div>
        <a role="link" ariaLabel="Overview, 5 sites, current page">
          <text>OVERVIEW</text>
          <text>5</text>
        </a>
      </div>
    )
    renderer.flush()
    renderer.drawPendingFrame()
    const nodes = Object.values(renderer.getAccessibilityTree().nodes)

    expect(nodes.find((node) => node.aria.role === "Link")).toMatchObject({
      aria: { role: "Link", label: "Overview, 5 sites, current page" },
    })
    expect(nodes.some((node) => node.aria.role === "Label")).toBe(false)
  })

  it("keeps unroled text exposed as a Label", () => {
    const { render, renderer } = createTestRoot()

    render(
      <div>
        <text>Standalone status</text>
      </div>
    )
    renderer.flush()
    renderer.drawPendingFrame()

    const labels = Object.values(renderer.getAccessibilityTree().nodes)
      .filter((node) => node.aria.role === "Label")
      .map((node) => node.aria.value)
    expect(labels).toEqual(["Standalone status"])
  })

  it("keeps a roled element nested inside a roled ancestor", () => {
    const { render, renderer } = createTestRoot()

    render(
      <div>
        <a role="link" ariaLabel="Factory overview">
          <text role="heading" ariaLevel={2}>
            Factory status
          </text>
        </a>
      </div>
    )
    renderer.flush()
    renderer.drawPendingFrame()
    const tree = renderer.getAccessibilityTree()
    const link = Object.entries(tree.nodes).find(([, node]) => node.aria.role === "Link")
    const heading = Object.entries(tree.nodes).find(([, node]) => node.aria.role === "Heading")

    expect(link?.[1]).toMatchObject({ aria: { role: "Link", label: "Factory overview" } })
    expect(heading?.[1]).toMatchObject({
      aria: { role: "Heading", label: "Factory status", level: 2 },
    })
    expect(link?.[1].children).toContain(heading?.[0])
    expect(Object.values(tree.nodes).some((node) => node.aria.role === "Label")).toBe(false)
  })

  it("emits one Label per native content string while leaving chrome inaccessible", () => {
    const { render, renderer } = createTestRoot()

    render(<code code={"first line\nsecond line"} showLineNumbers />)
    renderer.flush()
    renderer.drawPendingFrame()
    const tree = renderer.getAccessibilityTree()

    const labels = Object.values(tree.nodes)
      .filter((node) => node.aria.role === "Label")
      .map((node) => node.aria.value)
    expect(labels).toEqual(["first line", "second line"])
    expect(tree.frame?.node_count).toBe(3)
  })

  it("keeps a representative text-heavy tree linear", () => {
    const { render, renderer } = createTestRoot()

    render(
      <div>
        {Array.from({ length: 70 }, (_, index) => (
          <text key={index}>{`Factory metric ${index + 1}`}</text>
        ))}
      </div>
    )
    renderer.flush()
    renderer.drawPendingFrame()
    const tree = renderer.getAccessibilityTree()

    expect(tree.frame?.node_count).toBe(71)
    expect(
      Object.values(tree.nodes).filter((node) => node.aria.role === "Label")
    ).toHaveLength(70)
  })

  it("keeps accessibility reads and actions on the last explicit draw", () => {
    const clicks: string[] = []
    const { render, renderer } = createTestRoot()
    render(
      <button
        role="button"
        ariaLabel="Snapshot"
        style={{ width: 120, height: 50 }}
        onClick={() => clicks.push("click")}
      />
    )

    const first = renderer.getAccessibilityTree()
    const node = Object.values(first.nodes).find((candidate) => candidate.aria.label === "Snapshot")!
    const frameNumber = first.frame?.frame_number
    const readFrameNumber = () => renderer.getAccessibilityTree().frame?.frame_number
    expect(readFrameNumber()).toBe(frameNumber)

    renderer.nativeSimulateAccessibilityAction(node.accesskit_id, "activate")
    expect(clicks).toEqual(["click"])
    expect(readFrameNumber()).toBe(frameNumber)
  })

  it("publishes explicit roles, states, descriptions, and values", () => {
    const { render, renderer } = createTestRoot()

    render(
      <div>
        <div
          role="checkbox"
          ariaLabel="Include byproducts"
          ariaDescription="Adds secondary outputs"
          ariaChecked="mixed"
          disabled
        />
        <h2 role="heading" ariaLabel="Production" ariaLevel={2} />
        <a role="link" ariaLabel="Open recipe" ariaExpanded={false} />
        <div role="option" ariaLabel="Turbo motor" ariaSelected />
        <div
          role="slider"
          ariaLabel="Clock speed"
          ariaValue="42 percent"
          ariaValueMin={0}
          ariaValueMax={100}
          ariaValueNow={42}
        />
        <div role="spinbutton" ariaLabel="Machine count" ariaValueNow={8} />
      </div>
    )

    const nodes = Object.values(renderer.getAccessibilityTree().nodes)
    const byLabel = (label: string) => nodes.find((node) => node.aria.label === label)?.aria

    expect(byLabel("Include byproducts")).toMatchObject({
      role: "CheckBox",
      description: "Adds secondary outputs",
      toggled: "Mixed",
      disabled: true,
    })
    expect(byLabel("Production")).toMatchObject({ role: "Heading", level: 2 })
    expect(byLabel("Open recipe")).toMatchObject({
      role: "Link",
      expanded: false,
    })
    expect(byLabel("Turbo motor")).toMatchObject({ role: "ListBoxOption", selected: true })
    expect(byLabel("Clock speed")).toMatchObject({
      role: "Slider",
      value: "42 percent",
      min_numeric_value: 0,
      max_numeric_value: 100,
      numeric_value: 42,
    })
    expect(byLabel("Machine count")).toMatchObject({
      role: "SpinButton",
      numeric_value: 8,
    })
  })

  it("publishes table hierarchy and row, column, count, and span properties", () => {
    const { render, renderer } = createTestRoot()

    render(
      <div role="table" ariaLabel="Power ledger" ariaRowCount={3} ariaColCount={3}>
        <div role="rowgroup">
          <div role="row" ariaRowIndex={1}>
            <text role="columnheader" ariaLabel="Site" ariaColIndex={1} />
            <text
              role="columnheader"
              ariaLabel="Power"
              ariaColIndex={2}
              ariaColSpan={2}
            />
          </div>
          <div role="row" ariaRowIndex={2}>
            <text role="rowheader" ariaLabel="Alpha" ariaColIndex={1} />
            <text
              role="cell"
              ariaLabel="42 MW"
              ariaColIndex={2}
              ariaRowSpan={2}
              ariaColSpan={2}
            />
          </div>
          <div role="row" ariaRowIndex={3}>
            <text role="rowheader" ariaLabel="Beta" ariaColIndex={1} />
          </div>
        </div>
      </div>
    )

    const tree = renderer.getAccessibilityTree()
    const entries = Object.entries(tree.nodes)
    const table = entries.find(([, node]) => node.aria.role === "Table")!
    const rowGroup = entries.find(([, node]) => node.aria.role === "RowGroup")!
    const rows = entries.filter(([, node]) => node.aria.role === "Row")
    const headerRow = rows.find(([, node]) => node.aria.row_index === 1)!
    const alphaRow = rows.find(([, node]) => node.aria.row_index === 2)!
    const betaRow = rows.find(([, node]) => node.aria.row_index === 3)!

    expect(table[1].aria).toMatchObject({
      role: "Table",
      label: "Power ledger",
      row_count: 3,
      column_count: 3,
    })
    expect(table[1].children).toEqual([rowGroup[0]])
    expect(rowGroup[1].aria).toMatchObject({ role: "RowGroup" })
    expect(rowGroup[1].aria).not.toHaveProperty("label")
    expect(rowGroup[1].children).toEqual([headerRow[0], alphaRow[0], betaRow[0]])
    expect(headerRow[1].aria).toMatchObject({ role: "Row", row_index: 1 })
    expect(headerRow[1].aria).not.toHaveProperty("label")
    expect(headerRow[1].children?.map((key) => tree.nodes[key]?.aria)).toEqual([
      expect.objectContaining({ role: "ColumnHeader", label: "Site" }),
      expect.objectContaining({ role: "ColumnHeader", label: "Power" }),
    ])
    expect(alphaRow[1].aria).toMatchObject({ role: "Row", row_index: 2 })
    expect(alphaRow[1].aria).not.toHaveProperty("label")
    expect(alphaRow[1].children?.map((key) => tree.nodes[key]?.aria)).toEqual([
      expect.objectContaining({ role: "RowHeader", label: "Alpha" }),
      expect.objectContaining({ role: "Cell", label: "42 MW" }),
    ])
    expect(betaRow[1].aria).toMatchObject({ role: "Row", row_index: 3 })
    expect(betaRow[1].aria).not.toHaveProperty("label")
    expect(betaRow[1].children?.map((key) => tree.nodes[key]?.aria)).toEqual([
      expect.objectContaining({ role: "RowHeader", label: "Beta" }),
    ])
    expect(
      entries.find(([, node]) => node.aria.label === "Power")?.[1].aria
    ).toMatchObject({ column_index: 2, column_span: 2 })
    expect(
      entries.find(([, node]) => node.aria.label === "42 MW")?.[1].aria
    ).toMatchObject({ column_index: 2, row_span: 2, column_span: 2 })
  })

  it("derives names for row and cell wrappers but not their table", () => {
    const { render, renderer } = createTestRoot()

    render(
      <div role="table">
        <div role="row">
          <div role="cell">
            <text>Output</text>
          </div>
        </div>
      </div>
    )

    const nodes = Object.values(renderer.getAccessibilityTree().nodes)

    const table = nodes.find((node) => node.aria.role === "Table")!
    expect(table.aria).toMatchObject({ role: "Table" })
    expect(table.aria).not.toHaveProperty("label")
    expect(nodes.find((node) => node.aria.role === "Row")?.aria).toMatchObject({
      role: "Row",
      label: "Output",
    })
    expect(nodes.find((node) => node.aria.role === "Cell")?.aria).toMatchObject({
      role: "Cell",
      label: "Output",
    })
    expect(nodes.some((node) => node.aria.role === "Label")).toBe(false)
  })

  it("publishes author-named containers and preserves text under author-only roles", () => {
    const { render, renderer } = createTestRoot()

    render(
      <div>
        <ul role="list">
          <li role="listitem">
            <text>Online</text>
          </li>
          <li role="listitem">
            <text>Paused</text>
          </li>
        </ul>
        <section role="region" tabIndex={0} aria-label="Sites and routes">
          <text>Sites and routes</text>
        </section>
      </div>
    )

    const tree = renderer.getAccessibilityTree()
    const entries = Object.entries(tree.nodes)
    const list = entries.find(([, node]) => node.aria.role === "List")!
    const listItems = entries.filter(([, node]) => node.aria.role === "ListItem")
    const region = entries.find(([, node]) => node.aria.label === "Sites and routes")!

    expect(list[1].aria).toMatchObject({ role: "List" })
    expect(list[1].aria).not.toHaveProperty("label")
    expect(list[1].children).toEqual(listItems.map(([key]) => key))
    for (const [index, [, item]] of listItems.entries()) {
      expect(item.aria).toMatchObject({ role: "ListItem" })
      expect(item.aria).not.toHaveProperty("label")
      expect(item.children?.map((key) => tree.nodes[key]?.aria)).toEqual([
        expect.objectContaining({
          role: "Label",
          value: index === 0 ? "Online" : "Paused",
        }),
      ])
    }
    expect(region[1].aria).toMatchObject({ role: "Region", label: "Sites and routes" })
    expect(region[1].children?.map((key) => tree.nodes[key]?.aria)).toEqual([
      expect.objectContaining({ role: "Label", value: "Sites and routes" }),
    ])
    expect(renderer.drainStyleDiagnostics()).toEqual([])
  })

  it("publishes selected options inside their listbox container", () => {
    const { render, renderer } = createTestRoot()

    render(
      <div role="listbox" ariaLabel="Recipe">
        <text role="option" ariaSelected>
          Turbo motor
        </text>
        <text role="option" ariaSelected={false}>
          Cooling system
        </text>
      </div>
    )

    const tree = renderer.getAccessibilityTree()
    const entries = Object.entries(tree.nodes)
    const listbox = entries.find(([, node]) => node.aria.role === "ListBox")!

    expect(listbox[1].aria).toMatchObject({ role: "ListBox", label: "Recipe" })
    expect(listbox[1].children?.map((key) => tree.nodes[key]?.aria)).toEqual([
      expect.objectContaining({
        role: "ListBoxOption",
        label: "Turbo motor",
        selected: true,
      }),
      expect.objectContaining({
        role: "ListBoxOption",
        label: "Cooling system",
        selected: false,
      }),
    ])
  })

  it("dispatches value and focus actions and reflects semantic focus", () => {
    const actions: string[] = []
    const { render, renderer } = createTestRoot()

    render(
      <div
        id="machine-count"
        role="spinbutton"
        ariaLabel="Machine count"
        ariaValueNow={8}
        tabIndex={0}
        onAccessibilityAction={(event) => actions.push(event.accessibilityAction ?? "missing")}
      />
    )

    const before = renderer.getAccessibilityTree()
    const control = Object.values(before.nodes).find(
      (node) => node.aria.label === "Machine count"
    )!
    expect(control.aria.on_action).toEqual(
      expect.arrayContaining(["Increment", "Decrement", "Focus"])
    )

    renderer.nativeSimulateAccessibilityAction(control.accesskit_id, "increment")
    renderer.nativeSimulateAccessibilityAction(control.accesskit_id, "decrement")
    renderer.nativeSimulateAccessibilityAction(control.accesskit_id, "focus")
    expect(actions).toEqual(["increment", "decrement", "focus"])

    renderer.flush()
    const focused = renderer.getAccessibilityTree()
    const focusedEntry = Object.entries(focused.nodes).find(
      ([, node]) => node.accesskit_id === control.accesskit_id
    )
    expect(focused.gpui_focus).toBe(focusedEntry?.[0])
  })

  it("keeps semantic IDs stable across reorder and removes stale nodes", () => {
    const { render, renderer } = createTestRoot()
    const list = (labels: string[]) => (
      <div>
        {labels.map((label) => (
          <div key={label} role="button" ariaLabel={label} />
        ))}
      </div>
    )
    const semanticNodes = () =>
      Object.entries(renderer.getAccessibilityTree().nodes).filter(([, node]) =>
        ["Alpha", "Beta"].includes(node.aria.label ?? "")
      )

    render(list(["Alpha", "Beta"]))
    const initial = new Map(
      semanticNodes().map(([, node]) => [node.aria.label!, node.accesskit_id] as const)
    )

    render(list(["Beta", "Alpha"]))
    const reorderedTree = renderer.getAccessibilityTree()
    const reordered = new Map(
      Object.values(reorderedTree.nodes)
        .filter((node) => ["Alpha", "Beta"].includes(node.aria.label ?? ""))
        .map((node) => [node.aria.label!, node.accesskit_id] as const)
    )
    expect(reordered).toEqual(initial)
    const reorderedLabels = reorderedTree.nodes[reorderedTree.root!].children
      ?.map((key) => reorderedTree.nodes[key]?.aria.label)
      .filter((label): label is string => label === "Alpha" || label === "Beta")
    expect(reorderedLabels).toEqual(["Beta", "Alpha"])

    render(list(["Beta"]))
    const removed = new Map(
      semanticNodes().map(([, node]) => [node.aria.label!, node.accesskit_id] as const)
    )
    expect(removed).toEqual(new Map([["Beta", initial.get("Beta")!]]))
    expect(Object.values(renderer.getAccessibilityTree().nodes)).not.toContainEqual(
      expect.objectContaining({ accesskit_id: initial.get("Alpha") })
    )
  })

  it("suppresses an ariaHidden subtree from AccessKit without hiding its pixels", () => {
    const { render, renderer } = createTestRoot()
    render(
      <div>
        <div ariaHidden>
          <div role="button" ariaLabel="Decorative action" />
        </div>
        <div role="button" ariaLabel="Visible action" />
      </div>
    )

    const labels = Object.values(renderer.getAccessibilityTree().nodes).map(
      (node) => node.aria.label
    )
    expect(labels).toContain("Visible action")
    expect(labels).not.toContain("Decorative action")
  })

  it("publishes Booleanish ARIA states and HTML boolean disabled state", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const { render, renderer } = createTestRoot({ strictStyles: true })
    render(
      <div>
        <div role="button" ariaLabel="Hidden string" aria-hidden="true">
          <text>Hidden string content</text>
        </div>
        <div role="button" ariaLabel="Hidden boolean" ariaHidden>
          <text>Hidden boolean content</text>
        </div>
        <div role="button" ariaLabel="Visible false string" aria-hidden="false" />
        <div
          role="button"
          ariaLabel="Hidden uppercase string"
          {...({ "aria-hidden": "TRUE" } as Record<string, string>)}
        />
        <button ariaLabel="Expanded string" aria-expanded="true" />
        <button ariaLabel="Expanded boolean" ariaExpanded />
        <div role="option" ariaLabel="Selected string" aria-selected="true" />
        <div role="option" ariaLabel="Selected boolean" ariaSelected />
        <button ariaLabel="Aria disabled string" aria-disabled="true" />
        <button ariaLabel="Aria disabled boolean" ariaDisabled />
        <button ariaLabel="Disabled boolean true" disabled />
        <button ariaLabel="Disabled boolean false" disabled={false} />
        <button
          ariaLabel="Disabled true string"
          {...({ disabled: "true" } as Record<string, string>)}
        />
        <button
          ariaLabel="Disabled false string"
          {...({ disabled: "false" } as Record<string, string>)}
        />
        <button
          ariaLabel="Disabled empty string"
          {...({ disabled: "" } as Record<string, string>)}
        />
        <div
          role="button"
          ariaLabel="Malformed hidden"
          {...({ "aria-hidden": "yes" } as Record<string, string>)}
        />
      </div>
    )

    const nodes = Object.values(renderer.getAccessibilityTree().nodes)
    const byLabel = (label: string) => nodes.find((node) => node.aria.label === label)

    expect(byLabel("Hidden string")).toBeUndefined()
    expect(byLabel("Hidden boolean")).toBeUndefined()
    expect(byLabel("Visible false string")?.aria).toMatchObject({ role: "Button" })
    expect(byLabel("Hidden uppercase string")).toBeUndefined()
    expect(byLabel("Expanded string")?.aria).toMatchObject({ expanded: true })
    expect(byLabel("Expanded boolean")?.aria).toMatchObject({ expanded: true })
    expect(byLabel("Selected string")?.aria).toMatchObject({ selected: true })
    expect(byLabel("Selected boolean")?.aria).toMatchObject({ selected: true })
    expect(byLabel("Aria disabled string")?.aria).toMatchObject({ disabled: true })
    expect(byLabel("Aria disabled boolean")?.aria).toMatchObject({ disabled: true })
    expect(byLabel("Disabled boolean true")?.aria).toMatchObject({ disabled: true })
    expect(byLabel("Disabled boolean false")?.aria.disabled).not.toBe(true)
    expect(byLabel("Disabled true string")?.aria).toMatchObject({ disabled: true })
    expect(byLabel("Disabled false string")?.aria).toMatchObject({ disabled: true })
    expect(byLabel("Disabled empty string")?.aria).toMatchObject({ disabled: true })
    expect(byLabel("Malformed hidden")?.aria).toMatchObject({ role: "Button" })
    const diagnostics = warn.mock.calls.map(([message]) => String(message)).join("\n")
    for (const value of ["true", "false", "TRUE"]) {
      expect(diagnostics).not.toContain(`ariaHidden" rejected value "${value}"`)
    }
    for (const property of ["ariaExpanded", "ariaSelected", "ariaDisabled"]) {
      expect(diagnostics).not.toContain(`${property}" rejected value "true"`)
    }
    expect(diagnostics).not.toContain('disabled" rejected value "true"')
    expect(diagnostics).toContain('disabled" applied value "false" as true')
    expect(diagnostics).toContain('disabled" applied value "" as true')
    expect(diagnostics).toContain('ariaHidden" rejected value "yes"')
  })

  it("normalizes numeric and boolean data-testid props for lookup", () => {
    const { render, renderer } = createTestRoot()

    render(
      <div>
        <div data-testid={42} />
        <div data-testid />
      </div>
    )

    expect(renderer.findByTestId("42")?.dataTestId).toBe("42")
    expect(renderer.findByTestId("true")?.dataTestId).toBe("true")
  })

  it("clicks a testId locator and waits for text", async () => {
    const { render, renderer } = createTestRoot()
    render(<Counter />)
    const app = await connectTest(renderer)

    expect(await app.getByText("Count: 0").textContent()).toBe("Count: 0")
    await app.getByTestId("inc").click()
    await app.getByText("Count: 1").waitFor()
    expect(renderer.getAllText()).toEqual(["Count: 1"])
    await app.close()
  })

  it("captures review frames at frozen clock times", async () => {
    function Fade() {
      return (
        <div
          testId="box"
          style={{ width: 200, height: 80, backgroundColor: "#1e1e2e" }}
          motion={{
            initial: { opacity: 0 },
            animate: { opacity: 1 },
            transition: { duration: 0.3, ease: "linear" },
          }}
        >
          <text>box</text>
        </div>
      )
    }

    const { render, renderer } = createTestRoot()
    render(<Fade />)
    const app = await connectTest(renderer)
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gpuix-automation-"))
    const frames = await app.captureFrames(dir, [0, 300])
    expect(frames).toHaveLength(2)
    expect(fs.statSync(frames[0]).size).toBeGreaterThan(0)
    expect(fs.statSync(frames[1]).size).toBeGreaterThan(0)
    await app.close()
  })

  it("drags a locator through interpolated moves", async () => {
    const log: string[] = []

    function Draggable() {
      const [x, setX] = useState(20)
      const [origin, setOrigin] = useState<{ pointer: number; box: number } | null>(
        null
      )
      return (
        <div style={{ width: 600, height: 200, position: "relative" }}>
          <div
            testId="handle"
            style={{
              position: "absolute",
              left: x,
              top: 40,
              width: 80,
              height: 40,
              backgroundColor: "#3366ff",
            }}
            onMouseDown={(event) => {
              log.push("down")
              setOrigin({ pointer: event.x ?? 0, box: x })
            }}
            onMouseMove={(event) => {
              if (!origin) return
              log.push("move")
              setX(origin.box + (event.x ?? 0) - origin.pointer)
            }}
            onMouseUp={() => {
              log.push("up")
              setOrigin(null)
            }}
          >
            <text>{`x=${Math.round(x)}`}</text>
          </div>
        </div>
      )
    }

    const { render, renderer } = createTestRoot()
    render(<Draggable />)
    const app = await connectTest(renderer)

    await app.getByTestId("handle").dragBy(200, 0, { steps: 4 })

    expect(log).toEqual(["down", "move", "move", "move", "move", "up"])
    expect(renderer.getAllText()).toEqual(["x=220"])

    const bounds = await app.getByTestId("handle").bounds()
    expect(Math.round(bounds.x)).toBe(220)
    await app.close()
  })

  it("sends the button a click asks for", async () => {
    const seen: Array<{ button?: number; click?: boolean; aux?: boolean }> = []

    function Target() {
      return (
        <div
          testId="target"
          style={{ width: 200, height: 80, backgroundColor: "#101010" }}
          onMouseDown={(event) => seen.push({ button: event.button })}
          onClick={(event) => seen.push({ click: event.isRightClick })}
          onAuxClick={(event) => seen.push({ aux: event.isRightClick })}
        >
          <text>target</text>
        </div>
      )
    }

    const { render, renderer } = createTestRoot()
    render(<Target />)
    const app = await connectTest(renderer)

    await app.getByTestId("target").click()
    await app.getByTestId("target").click({ button: 2 })

    // `onClick` is the primary button only, like the DOM. A right click
    // reaches `onMouseDown` and `onAuxClick`.
    expect(seen).toEqual([
      { button: 0 },
      { click: false },
      { button: 2 },
      { aux: true },
    ])
    await app.close()
  })

  it("wheels over a locator and reports held modifiers", async () => {
    const seen: Array<{ deltaY: number; cmd: boolean }> = []

    function Surface() {
      return (
        <div
          testId="surface"
          style={{ width: 300, height: 200, backgroundColor: "#101010" }}
          onWheel={(event) =>
            seen.push({
              deltaY: event.deltaY ?? 0,
              cmd: event.modifiers?.cmd ?? false,
            })
          }
        >
          <text>surface</text>
        </div>
      )
    }

    const { render, renderer } = createTestRoot()
    render(<Surface />)
    const app = await connectTest(renderer)

    // wheel() takes platform deltas; the handler reads DOM deltas.
    await app.getByTestId("surface").wheel(0, -60)
    await app.getByTestId("surface").wheel(0, -60, { modifiers: "cmd" })

    expect(seen).toEqual([
      { deltaY: 60, cmd: false },
      { deltaY: 60, cmd: true },
    ])
    await app.close()
  })

  // Custom elements paint themselves, so they only appear in the bounds
  // registry if their builder attaches `automation::bounds_tracker`. Without
  // it, `click()` on an editor fails with "Element has no painted bounds" and
  // the only workaround is a hard-coded pixel coordinate.
  it("gives an input and a textarea painted bounds", async () => {
    function Form() {
      const [single, setSingle] = useState("one")
      const [multi, setMulti] = useState("two")
      return (
        <div style={{ display: "flex", flexDirection: "column", width: 400, height: 200 }}>
          <input
            testId="single"
            style={{ width: 300, height: 40 }}
            value={single}
            onChange={(event) => setSingle(event.value)}
          />
          <textarea
            testId="multi"
            style={{ width: 300, height: 60 }}
            value={multi}
            onChange={(event) => setMulti(event.value)}
          />
        </div>
      )
    }

    const { render, renderer } = createTestRoot()
    render(<Form />)
    const app = await connectTest(renderer)

    const single = await app.getByTestId("single").bounds()
    const multi = await app.getByTestId("multi").bounds()
    expect(single).not.toBeNull()
    expect(multi).not.toBeNull()
    expect(single!.width).toBeGreaterThan(0)
    expect(single!.height).toBeGreaterThan(0)
    // The textarea is laid out under the input, so its box must start lower.
    expect(multi!.y).toBeGreaterThan(single!.y)

    await app.close()
  })
})

describe("browser renderer capability adapter", () => {
  it("retains browser capabilities and omits unsupported screenshots from automation", async () => {
    const capabilities: RendererCapabilities = {
      platform: "browser",
      frameClock: { kind: "raf", requiresTick: false, externalFrame: false },
      window: { activation: false, activate: false, resize: true, multiple: false },
      images: { privateNetwork: false },
      automation: {
        click: true,
        hover: true,
        drag: true,
        scrollWheel: true,
        keyboard: "browser",
        screenshot: false,
        screenshotFormats: [],
        clock: true,
        tree: true,
      },
    }
    const renderer: LiveAutomationRenderer = {
      capabilities: () => capabilities,
      simulateClick() {},
      simulateMouseDown() {},
      simulateMouseUp() {},
      simulateMouseMove() {},
      simulateScrollWheel() {},
      focusElement() {},
      blur() {},
      scrollTo() {},
      getScrollOffset: () => null,
      getAllText: () => [],
      getPaintedText: () => [],
      getSelectedText: () => null,
      clearSelection() {},
      getAutomationTree: () => "{}",
      getElementBounds: () => null,
      clockPause: () => 0,
      clockSet: (nowMs) => nowMs,
      clockFastForward: (deltaMs) => deltaMs,
      clockResume: () => 0,
    }
    const adapter = browserRendererAsTest(renderer)
    expect(adapter.capabilities?.()).toEqual(capabilities)

    const app = await connectTest(adapter)
    const initialized = await app.call("initialize", {
      protocolVersion: 1,
      client: "browser-capability-test",
    })
    expect(initialized.capabilities).toEqual(["input", "clock", "tree"])
    await app.close()
  })
})
