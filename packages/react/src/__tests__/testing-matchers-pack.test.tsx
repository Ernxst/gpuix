/** The jest-dom-shaped matcher pack, wired the way a consumer wires it. */

import React, { useState } from "react"
import { describe, expect, it, vi } from "vitest"
import { createTestRoot, isNativeTestRendererAvailable } from "../testing.js"
import { gpuixMatchers, type GpuixMatchers } from "../testing-expect.js"
import type { InputPublicInstance } from "../types/host.js"

expect.extend(gpuixMatchers)

declare module "vitest" {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  interface Matchers<T = any> extends GpuixMatchers<T> {}
}

const describeNative = isNativeTestRendererAvailable() ? describe : describe.skip

describeNative("gpuix matcher pack", () => {
  it("asserts document membership and re-resolves after a rerender", () => {
    const screen = createTestRoot()

    try {
      screen.render(
        <div>
          <text data-testid="row">Coal</text>
        </div>
      )
      const row = screen.getByTestId("row")
      expect(row).toBeInTheDocument()

      screen.render(<div />)
      expect(row).not.toBeInTheDocument()
      expect(() => expect(row).toBeInTheDocument()).toThrowError(
        /is not in the renderer's tree/
      )
    } finally {
      screen.unmount()
    }
  })

  it("reports painted bounds, not CSS visibility", () => {
    const screen = createTestRoot()

    try {
      screen.render(
        <div style={{ display: "flex", width: 200, height: 100 }}>
          <text data-testid="shown" style={{ width: 100, height: 20 }}>
            Coal
          </text>
          <text data-testid="faded" style={{ width: 100, height: 20, opacity: 0 }}>
            Iron
          </text>
          <text data-testid="sr-only" visuallyHidden role="status">
            Copper
          </text>
        </div>
      )
      screen.renderer.flush()
      screen.renderer.drawPendingFrame()

      expect(screen.getByTestId("shown")).toBeVisible()
      // A visually hidden node is projected as an unpainted accessibility node,
      // so it is still in the tree and still has no bounds.
      expect(screen.getByTestId("sr-only")).toBeInTheDocument()
      expect(screen.getByTestId("sr-only")).not.toBeVisible()
      // The documented conflation, from the other side: a fully transparent
      // element still paints, so this calls it visible where a browser
      // would not.
      expect(screen.getByTestId("faded")).toBeVisible()

      expect(() => expect(screen.getByTestId("sr-only")).toBeVisible()).toThrowError(
        /painted no bounds/
      )
    } finally {
      screen.unmount()
    }
  })

  it("measures the painted box against the window, as an intersection ratio does", () => {
    const screen = createTestRoot({ width: 400, height: 300 })

    try {
      screen.render(
        <div style={{ width: 400, height: 900 }}>
          <div data-testid="flat" style={{ width: 100, height: 0 }} />
          <div data-testid="fully" style={{ width: 100, height: 50 }} />
          {/* 250 of its 500 rows are above the fold. */}
          <div data-testid="half" style={{ width: 100, height: 500 }} />
          <div data-testid="below" style={{ width: 100, height: 50 }} />
          <div data-testid="empty" style={{ width: 0, height: 0 }} />
          {/* 40 of its 100 columns are inside the left edge. */}
          <div
            data-testid="left"
            style={{ position: "absolute", left: -60, top: 10, width: 100, height: 50 }}
          />
        </div>
      )
      screen.renderer.flush()
      screen.renderer.drawPendingFrame()

      const fully = screen.getByTestId("fully")
      const half = screen.getByTestId("half")
      const below = screen.getByTestId("below")
      const left = screen.getByTestId("left")

      // Any painted part on screen is enough by default.
      expect(fully).toBeInViewport()
      expect(half).toBeInViewport()
      expect(left).toBeInViewport()
      expect(below).not.toBeInViewport()

      // `ratio` is the fraction of the element's own area, so the same element
      // passes and fails as the demand crosses what is on screen.
      expect(fully).toBeInViewport({ ratio: 1 })
      expect(half).toBeInViewport({ ratio: 0.5 })
      expect(half).not.toBeInViewport({ ratio: 0.51 })
      expect(half).not.toBeInViewport({ ratio: 1 })
      expect(left).toBeInViewport({ ratio: 0.4 })
      expect(left).not.toBeInViewport({ ratio: 0.5 })
      expect(below).not.toBeInViewport({ ratio: 0 })

      // The observer's rule for a target with no area: intersecting the
      // viewport — or merely touching its edge — is a ratio of 1, and being
      // outside it is 0. There is no area to take a fraction of.
      expect(screen.getByTestId("flat")).toBeInViewport()
      expect(screen.getByTestId("flat")).toBeInViewport({ ratio: 1 })
      expect(screen.getByTestId("empty")).not.toBeInViewport()

      expect(() => expect(below).toBeInViewport()).toThrowError(
        /be in the viewport[\s\S]*visible ratio 0\.000/
      )
      expect(() => expect(half).toBeInViewport({ ratio: 1 })).toThrowError(
        /be in the viewport with ratio 1[\s\S]*visible ratio 0\.500/
      )
      expect(() => expect(fully).not.toBeInViewport()).toThrowError(
        /not to be in the viewport[\s\S]*400x300 window, visible ratio 1\.000/
      )
    } finally {
      screen.unmount()
    }
  })

  it("follows an element scrolled into and out of the window", () => {
    const screen = createTestRoot({ width: 400, height: 300 })

    try {
      screen.render(
        <div style={{ width: 400, height: 300, overflow: "scroll" }}>
          {Array.from({ length: 20 }, (_, index) => (
            <div
              key={index}
              data-testid={`row-${index}`}
              style={{ width: 400, height: 100, flexShrink: 0 }}
            />
          ))}
        </div>
      )
      screen.renderer.flush()
      screen.renderer.drawPendingFrame()

      // Three 100px rows fit the 300px window exactly; the fourth is below it.
      expect(screen.getByTestId("row-0")).toBeInViewport({ ratio: 1 })
      expect(screen.getByTestId("row-2")).toBeInViewport({ ratio: 1 })
      expect(screen.getByTestId("row-4")).not.toBeInViewport()

      // A platform delta, where scrolling down is negative.
      screen.renderer.nativeSimulateScrollWheel(200, 150, 0, -250)
      screen.renderer.flush()
      screen.renderer.drawPendingFrame()

      // The claim the hand-rolled `getBoundingClientRect()` comparison was
      // making: scrolling moved a row on screen and took another off it.
      expect(screen.getByTestId("row-4")).toBeInViewport()
      expect(screen.getByTestId("row-0")).not.toBeInViewport()
      // Half of row 2 is left below the fold.
      expect(screen.getByTestId("row-2")).toBeInViewport({ ratio: 0.5 })
      expect(screen.getByTestId("row-2")).not.toBeInViewport({ ratio: 0.51 })
    } finally {
      screen.unmount()
    }
  })

  it("clips the ratio by every clipping ancestor, not by the window alone", () => {
    const screen = createTestRoot({ width: 400, height: 600 })

    try {
      screen.render(
        // The scroller is 100px tall at y=300, well inside a 600px window, so
        // a row it has clipped away still paints a box inside the window. An
        // `IntersectionObserver` reports that row as not intersecting, and a
        // bare `getBoundingClientRect()` comparison against the window size —
        // the thing this matcher replaces — would call it visible.
        <div style={{ width: 400, height: 600 }}>
          <div style={{ width: 400, height: 300, flexShrink: 0 }} />
          <div
            data-testid="scroller"
            style={{ width: 400, height: 100, overflow: "scroll", flexShrink: 0 }}
          >
            {Array.from({ length: 10 }, (_, index) => (
              <div
                key={index}
                data-testid={`row-${index}`}
                style={{ width: 400, height: 40, flexShrink: 0 }}
              />
            ))}
          </div>
          <div
            data-testid="hidden"
            style={{ width: 400, height: 50, overflow: "hidden", flexShrink: 0 }}
          >
            <div data-testid="hidden-child" style={{ width: 400, height: 200, flexShrink: 0 }} />
          </div>
          <div
            data-testid="open"
            style={{ width: 400, height: 20, overflow: "visible", flexShrink: 0 }}
          >
            <div data-testid="open-child" style={{ width: 400, height: 80, flexShrink: 0 }} />
          </div>
        </div>
      )
      screen.renderer.flush()
      screen.renderer.drawPendingFrame()

      // Two 40px rows fit the 100px scroller; the third straddles its bottom
      // edge and the rest are clipped away.
      expect(screen.getByTestId("row-0")).toBeInViewport({ ratio: 1 })
      expect(screen.getByTestId("row-1")).toBeInViewport({ ratio: 1 })

      const straddling = screen.getByTestId("row-2")
      expect(straddling).toBeInViewport()
      expect(straddling).toBeInViewport({ ratio: 0.5 })
      expect(straddling).not.toBeInViewport({ ratio: 0.51 })
      expect(straddling).not.toBeInViewport({ ratio: 1 })

      // Painted inside the window, clipped out of the scroller.
      const clipped = screen.getByTestId("row-3")
      expect(screen.renderer.getElementBounds(clipped.id)).toEqual([0, 420, 400, 40])
      expect(clipped).not.toBeInViewport()
      expect(screen.getByTestId("row-5")).not.toBeInViewport()

      // `hidden` clips as much as `scroll` does: 50 of the child's 200 rows
      // survive the mask.
      const hiddenChild = screen.getByTestId("hidden-child")
      expect(hiddenChild).toBeInViewport()
      expect(hiddenChild).toBeInViewport({ ratio: 0.25 })
      expect(hiddenChild).not.toBeInViewport({ ratio: 0.26 })

      // `visible` establishes no clip at all, so a child that overflows its
      // parent is judged against the window alone and is wholly in view.
      expect(screen.getByTestId("open-child")).toBeInViewport({ ratio: 1 })

      expect(() => expect(clipped).toBeInViewport()).toThrowError(
        /be in the viewport[\s\S]*visible ratio 0\.000/
      )
    } finally {
      screen.unmount()
    }
  })

  it("masks both axes when either overflow clips, as GPUI and CSS do", () => {
    const screen = createTestRoot({ width: 400, height: 600 })

    try {
      screen.render(
        <div style={{ width: 400, height: 600 }}>
          <div
            data-testid="sideways"
            style={{ width: 200, height: 100, overflowX: "scroll", flexShrink: 0 }}
          >
            <div data-testid="tall" style={{ width: 200, height: 300, flexShrink: 0 }} />
          </div>
        </div>
      )
      screen.renderer.flush()
      screen.renderer.drawPendingFrame()

      // Only the horizontal axis was asked to clip, and the child overflows
      // vertically — but a `visible` axis computes to `auto` once the other one
      // is not, so GPUI masks both and 100 of the child's 300 rows survive.
      const tall = screen.getByTestId("tall")
      expect(screen.renderer.getElementBounds(tall.id)).toEqual([0, 0, 200, 300])
      expect(tall).toBeInViewport()
      expect(tall).toBeInViewport({ ratio: 0.33 })
      expect(tall).not.toBeInViewport({ ratio: 0.34 })
      expect(tall).not.toBeInViewport({ ratio: 1 })
    } finally {
      screen.unmount()
    }
  })

  it("insets a clipping ancestor's mask by its visible border", () => {
    const screen = createTestRoot({ width: 400, height: 600 })

    try {
      screen.render(
        <div style={{ width: 400, height: 600 }}>
          {/* The border box is 200x100 and the content box 180x80, offset by
              the 10px border on every side. */}
          <div
            style={{
              width: 200,
              height: 100,
              overflow: "scroll",
              borderWidth: 10,
              borderColor: "#ff0000",
              flexShrink: 0,
            }}
          >
            <div data-testid="flush" style={{ width: 180, height: 80, flexShrink: 0 }} />
          </div>
          <div
            style={{
              width: 200,
              height: 100,
              overflow: "scroll",
              borderWidth: 10,
              borderColor: "#ff0000",
              flexShrink: 0,
            }}
          >
            <div data-testid="over-border" style={{ width: 190, height: 90, flexShrink: 0 }} />
          </div>
        </div>
      )
      screen.renderer.flush()
      screen.renderer.drawPendingFrame()

      // A child flush with the content box is wholly visible.
      const flush = screen.getByTestId("flush")
      expect(screen.renderer.getElementBounds(flush.id)).toEqual([10, 10, 180, 80])
      expect(flush).toBeInViewport({ ratio: 1 })

      // A child that reaches the border box's outer edge is clipped by the
      // border, not by the box: 180x80 of its 190x90 survives the mask. Judged
      // against the unindented box it would have been wholly visible.
      const overBorder = screen.getByTestId("over-border")
      expect(screen.renderer.getElementBounds(overBorder.id)).toEqual([10, 110, 190, 90])
      expect(overBorder).toBeInViewport({ ratio: 0.84 })
      expect(overBorder).not.toBeInViewport({ ratio: 0.85 })
      expect(overBorder).not.toBeInViewport({ ratio: 1 })
      expect(() => expect(overBorder).toBeInViewport({ ratio: 1 })).toThrowError(
        /be in the viewport with ratio 1[\s\S]*visible ratio 0\.842/
      )
    } finally {
      screen.unmount()
    }
  })

  it("lets an out-of-range ratio fail rather than validating it", () => {
    const screen = createTestRoot({ width: 400, height: 300 })

    try {
      screen.render(<div data-testid="panel" style={{ width: 100, height: 50 }} />)
      screen.renderer.flush()
      screen.renderer.drawPendingFrame()
      const panel = screen.getByTestId("panel")

      // vitest does not validate the option, and neither does this: a demand
      // above 1 is simply never met.
      expect(panel).not.toBeInViewport({ ratio: 1.5 })
      expect(() => expect(panel).toBeInViewport({ ratio: 1.5 })).toThrowError(
        /be in the viewport with ratio 1\.5[\s\S]*visible ratio 1\.000/
      )

      // Nor is a ratio that is not a number, and the message reads back the
      // demand the test made rather than the zero it would default to.
      expect(panel).not.toBeInViewport({ ratio: Number.NaN })
      expect(() => expect(panel).toBeInViewport({ ratio: Number.NaN })).toThrowError(
        /be in the viewport with ratio NaN/
      )
      // An explicit `ratio: 0` is the default demand, and says so.
      expect(() => expect(panel).not.toBeInViewport({ ratio: 0 })).toThrowError(
        /not to be in the viewport with ratio 0/
      )

      // A receiver that was never a TestElement still throws.
      expect(() => expect(null).toBeInViewport({ ratio: 1 })).toThrowError(
        /toBeInViewport expects a TestElement/
      )

      // The documented range answers throughout.
      expect(panel).toBeInViewport({ ratio: 0 })
      expect(panel).toBeInViewport({ ratio: 1 })
    } finally {
      screen.unmount()
    }
  })

  it("asserts the element's own disabled state, declared either way", () => {
    const screen = createTestRoot()

    try {
      screen.render(
        <div>
          <div data-testid="native" role="button" ariaLabel="Save" disabled />
          <div data-testid="aria" role="button" ariaLabel="Delete" ariaDisabled />
          <div data-testid="enabled" role="button" ariaLabel="Build" />
          <div data-testid="child-of-disabled" role="button" ariaLabel="Nested" />
        </div>
      )

      expect(screen.getByTestId("native")).toBeDisabled()
      expect(screen.getByTestId("aria")).toBeDisabled()
      expect(screen.getByTestId("enabled")).not.toBeDisabled()
      // No disabling container exists, so nothing is inherited.
      expect(screen.getByTestId("child-of-disabled")).not.toBeDisabled()

      expect(() => expect(screen.getByTestId("enabled")).toBeDisabled()).toThrowError(
        /is not disabled/
      )
    } finally {
      screen.unmount()
    }
  })

  it("reads enabled as the exact inverse of disabled", () => {
    const screen = createTestRoot()

    try {
      screen.render(
        <div>
          <div data-testid="native" role="button" ariaLabel="Save" disabled />
          <div data-testid="aria" role="button" ariaLabel="Delete" ariaDisabled />
          <div data-testid="enabled" role="button" ariaLabel="Build" />
          <div data-testid="plain" />
        </div>
      )

      // The form it replaces, said directly.
      expect(screen.getByTestId("enabled")).toBeEnabled()
      expect(screen.getByTestId("enabled")).not.toBeDisabled()
      expect(screen.getByTestId("native")).not.toBeEnabled()
      expect(screen.getByTestId("aria")).not.toBeEnabled()
      // Nothing declares disabled, so an element with no semantics at all is
      // enabled, exactly as a `<div>` is in a document.
      expect(screen.getByTestId("plain")).toBeEnabled()

      expect(() => expect(screen.getByTestId("native")).toBeEnabled()).toThrowError(
        /be enabled[\s\S]*is not enabled/
      )
      expect(() => expect(screen.getByTestId("enabled")).not.toBeEnabled()).toThrowError(
        /not to be enabled[\s\S]*is enabled/
      )
    } finally {
      screen.unmount()
    }
  })

  it("reads the checked state GPUI computed, for the roles that carry one", () => {
    const screen = createTestRoot()

    try {
      screen.render(
        <div>
          <div data-testid="on" role="checkbox" ariaLabel="Coal" ariaChecked />
          <div data-testid="off" role="checkbox" ariaLabel="Iron" ariaChecked={false} />
          <div data-testid="switch-on" role="switch" ariaLabel="Power" ariaChecked />
          <div data-testid="switch-off" role="switch" ariaLabel="Vent" ariaChecked={false} />
          <div data-testid="radio-on" role="radio" ariaLabel="Belt" ariaChecked />
          <div data-testid="radio-off" role="radio" ariaLabel="Pipe" ariaChecked={false} />
          <div data-testid="menu-on" role="menuitemcheckbox" ariaLabel="Grid" ariaChecked />
          <div data-testid="menu-off" role="menuitemcheckbox" ariaLabel="Ruler" ariaChecked={false} />
        </div>
      )

      expect(screen.getByTestId("on")).toBeChecked()
      expect(screen.getByTestId("off")).not.toBeChecked()
      expect(screen.getByTestId("switch-on")).toBeChecked()
      expect(screen.getByTestId("switch-off")).not.toBeChecked()
      // Every role WAI-ARIA gives `aria-checked` computes one here, so the
      // matcher answers for the whole set jest-dom answers for.
      expect(screen.getByTestId("radio-on")).toBeChecked()
      expect(screen.getByTestId("radio-off")).not.toBeChecked()
      expect(screen.getByTestId("menu-on")).toBeChecked()
      expect(screen.getByTestId("menu-off")).not.toBeChecked()

      // The state comes off the same accessibility node `getByRole` searches,
      // so the matcher and the query cannot disagree.
      expect(screen.getByRole("checkbox", { name: "Coal" })).toBeChecked()
      expect(screen.getByRole("radio", { name: "Belt" })).toBeChecked()
      expect(screen.getByRole("menuitemcheckbox", { name: "Ruler" })).not.toBeChecked()

      expect(() => expect(screen.getByTestId("off")).toBeChecked()).toThrowError(
        /be checked[\s\S]*is not checked/
      )
      expect(() => expect(screen.getByTestId("on")).not.toBeChecked()).toThrowError(
        /not to be checked[\s\S]*is checked/
      )
    } finally {
      screen.unmount()
    }
  })

  it("answers an element with no checked state in jest-dom's own words", () => {
    const screen = createTestRoot()

    try {
      screen.render(
        <div>
          <div data-testid="button" role="button" ariaLabel="Save" />
          <div data-testid="stateless" role="checkbox" ariaLabel="Copper" />
          <div data-testid="mixed" role="checkbox" ariaLabel="Steel" ariaChecked="mixed" />
          <div data-testid="plain" />
        </div>
      )

      // jest-dom's sentence, over jest-dom's role set, and jest-dom's control
      // flow: the assertion is not about a checked state, so it simply fails,
      // and the negated form passes.
      const refusal =
        'only elements with role="checkbox", role="menuitemcheckbox", role="menuitemradio", ' +
        'role="option", role="radio", role="switch" or role="treeitem" and a valid ' +
        "aria-checked attribute can be used with .toBeChecked(). Use .toHaveValue() instead"

      const button = screen.getByTestId("button")
      expect(button).not.toBeChecked()
      expect(() => expect(button).toBeChecked()).toThrowError(refusal)

      // A checkable element that declares no checked state has none to read,
      // which is what jest-dom means by "a valid aria-checked attribute".
      const stateless = screen.getByTestId("stateless")
      expect(stateless).not.toBeChecked()
      expect(() => expect(stateless).toBeChecked()).toThrowError(refusal)

      // An element that projects no accessibility node at all has no role.
      const plain = screen.getByTestId("plain")
      expect(plain).not.toBeChecked()
      expect(() => expect(plain).toBeChecked()).toThrowError(refusal)

      // "mixed" is not a checked state either, as in jest-dom.
      const mixed = screen.getByTestId("mixed")
      expect(mixed).not.toBeChecked()
      expect(() => expect(mixed).toBeChecked()).toThrowError(refusal)
    } finally {
      screen.unmount()
    }
  })

  it("asserts the third state of a tri-state checkbox", () => {
    const screen = createTestRoot()

    try {
      screen.render(
        <div>
          <div data-testid="mixed" role="checkbox" ariaLabel="Steel" ariaChecked="mixed" />
          <div data-testid="on" role="checkbox" ariaLabel="Coal" ariaChecked />
          <div data-testid="stateless" role="checkbox" ariaLabel="Copper" />
          <div data-testid="switch" role="switch" ariaLabel="Power" ariaChecked="mixed" />
          <div data-testid="radio" role="radio" ariaLabel="Belt" ariaChecked="mixed" />
        </div>
      )

      expect(screen.getByTestId("mixed")).toBePartiallyChecked()
      expect(screen.getByTestId("on")).not.toBePartiallyChecked()
      // A checkbox with no checked state is simply not partially checked; only
      // a role that carries no checked state at all is refused.
      expect(screen.getByTestId("stateless")).not.toBePartiallyChecked()

      // The two assertions are disjoint: `mixed` is not checked, and being
      // told so is what sends you here.
      expect(() => expect(screen.getByTestId("mixed")).toBeChecked()).toThrowError(
        "can be used with .toBeChecked()"
      )

      const refusal =
        'only elements with role="checkbox" and a valid aria-checked attribute can be used ' +
        "with .toBePartiallyChecked(). Use .toHaveValue() instead"
      // A switch is binary — WAI-ARIA computes its `mixed` as `false`, which
      // the renderer applies — so it is answered with the sentence, exactly as
      // jest-dom answers every role but checkbox.
      const binary = screen.getByTestId("switch")
      expect(binary).not.toBePartiallyChecked()
      expect(() => expect(binary).toBePartiallyChecked()).toThrowError(refusal)

      // A radio is binary too, and the renderer computes its `mixed` as
      // `false` — so it is neither partially checked nor checked, and the
      // false it computed is what `toBeChecked` reads.
      const radio = screen.getByTestId("radio")
      expect(radio).not.toBePartiallyChecked()
      expect(radio).not.toBeChecked()
      expect(() => expect(radio).toBePartiallyChecked()).toThrowError(refusal)
      expect(() => expect(radio).toBeChecked()).toThrowError(
        /be checked[\s\S]*is not checked/
      )

      expect(() => expect(screen.getByTestId("on")).toBePartiallyChecked()).toThrowError(
        /be partially checked[\s\S]*is not partially checked/
      )
      expect(() => expect(screen.getByTestId("mixed")).not.toBePartiallyChecked()).toThrowError(
        /not to be partially checked[\s\S]*is partially checked/
      )
    } finally {
      screen.unmount()
    }
  })

  it("calls an element empty only with no children and no text", () => {
    const screen = createTestRoot()

    try {
      screen.render(
        <div>
          <div data-testid="empty" />
          <div data-testid="holds-text">
            <text>Coal</text>
          </div>
          <div data-testid="holds-an-empty-child">
            <div />
          </div>
          <text data-testid="text-node">Iron</text>
          <text data-testid="blank-text">{" "}</text>
        </div>
      )

      expect(screen.getByTestId("empty")).toBeEmptyDOMElement()
      expect(screen.getByTestId("holds-text")).not.toBeEmptyDOMElement()
      expect(screen.getByTestId("text-node")).not.toBeEmptyDOMElement()
      // Whitespace is content, as it is in jest-dom.
      expect(screen.getByTestId("blank-text")).not.toBeEmptyDOMElement()
      // Stronger than the `toHaveTextContent(/^$/)` it replaces: this subtree
      // has no text at all, and is still not empty.
      expect(screen.getByTestId("holds-an-empty-child")).toHaveTextContent(/^$/)
      expect(screen.getByTestId("holds-an-empty-child")).not.toBeEmptyDOMElement()

      expect(() => expect(screen.getByTestId("holds-text")).toBeEmptyDOMElement()).toThrowError(
        /be an empty element[\s\S]*contains 1 child/
      )
    } finally {
      screen.unmount()
    }
  })

  it("counts the content prop of a host that renders from one", () => {
    const screen = createTestRoot()

    try {
      screen.render(
        <div>
          <code data-testid="code" code={"const x = 1\nconst y = 2"} language="ts" />
          <markdown data-testid="markdown" source="# Title" />
          <diff
            data-testid="diff"
            patch={
              "diff --git a/file.txt b/file.txt\n--- a/file.txt\n+++ b/file.txt\n@@ -1 +1 @@\n-old\n+new"
            }
          />
          <code data-testid="no-code" language="ts" />
          <markdown data-testid="blank-source" source="" />
        </div>
      )

      // All three paint their content from a prop and hold no children, so the
      // retained tree alone would call a screenful of text empty.
      expect(screen.getByTestId("code")).not.toBeEmptyDOMElement()
      expect(screen.getByTestId("markdown")).not.toBeEmptyDOMElement()
      expect(screen.getByTestId("diff")).not.toBeEmptyDOMElement()

      // No content prop, or an empty one, renders nothing and is empty.
      expect(screen.getByTestId("no-code")).toBeEmptyDOMElement()
      expect(screen.getByTestId("blank-source")).toBeEmptyDOMElement()

      expect(() => expect(screen.getByTestId("markdown")).toBeEmptyDOMElement()).toThrowError(
        /be an empty element[\s\S]*and source "# Title"/
      )
    } finally {
      screen.unmount()
    }
  })

  it("follows the window's keyboard focus, with or without a declared role", () => {
    const screen = createTestRoot()

    try {
      screen.render(
        <div style={{ width: 400, height: 120 }}>
          <input data-testid="search" value="" style={{ width: 200, height: 30 }} />
          <input data-testid="notes" value="" style={{ width: 200, height: 30 }} />
        </div>
      )

      const search = screen.getByTestId("search")
      const notes = screen.getByTestId("notes")
      screen.renderer.focusElement(search.id)

      // Neither input declares a role, so neither has an AccessKit node to be
      // found by; the window's own focus still answers.
      expect(search).toHaveFocus()
      expect(notes).not.toHaveFocus()

      screen.renderer.focusElement(notes.id)
      expect(notes).toHaveFocus()
      expect(() => expect(search).toHaveFocus()).toThrowError(/focus is on <input/)
    } finally {
      screen.unmount()
    }
  })

  it("matches text content by substring, regex, and predicate through one normalizer", () => {
    const screen = createTestRoot()

    try {
      screen.render(
        <div data-testid="panel">
          <text>{"  Iron   plate  "}</text>
          <text>{" x2"}</text>
        </div>
      )
      const panel = screen.getByTestId("panel")

      // jest-dom's rules: a bare string is a case-sensitive substring.
      expect(panel).toHaveTextContent("Iron plate")
      expect(panel).toHaveTextContent("plate x2")
      expect(panel).not.toHaveTextContent("iron plate")
      expect(panel).toHaveTextContent(/^Iron plate x2$/)
      expect(panel).toHaveTextContent((content) => content.endsWith("x2"))

      // The queries' normalization, and the options that change it.
      expect(panel).toHaveTextContent("Iron   plate", { collapseWhitespace: false })
      expect(panel).toHaveTextContent("IRON PLATE X2", {
        normalizer: (content) => content.trim().replace(/\s+/g, " ").toUpperCase(),
      })

      expect(() => expect(panel).toHaveTextContent("Copper")).toThrowError(
        /have text content "Copper"[\s\S]*text content "Iron plate x2"/
      )
    } finally {
      screen.unmount()
    }
  })

  it("separates the exact value from the matcher-based display value", () => {
    const screen = createTestRoot()

    try {
      screen.render(
        <div>
          <input data-testid="search" value="iron plate" placeholder="Search" />
          <div data-testid="panel" ariaLabel="Ledger" />
        </div>
      )
      const search = screen.getByTestId("search")

      expect(search).toHaveValue("iron plate")
      expect(search).not.toHaveValue("iron")
      expect(search).toHaveDisplayValue("iron plate")
      expect(search).toHaveDisplayValue(/^iron/)
      expect(search).toHaveDisplayValue("IRON", { exact: false })
      expect(search).not.toHaveDisplayValue("copper")

      // An element with no value prop fails both rather than matching "".
      expect(screen.getByTestId("panel")).not.toHaveValue("")
      expect(screen.getByTestId("panel")).not.toHaveDisplayValue("")
      expect(() => expect(screen.getByTestId("panel")).toHaveValue("")).toThrowError(
        /value is not declared/
      )
    } finally {
      screen.unmount()
    }
  })

  it("reads the value the user typed into an uncontrolled input", async () => {
    const screen = createTestRoot({ width: 400, height: 160 })

    try {
      screen.render(
        <div style={{ width: 400, height: 160 }}>
          <input data-testid="field" style={{ width: 300, height: 40 }} />
        </div>
      )
      const field = screen.getByTestId("field")

      await screen.userEvent.type(field, "hi")

      // The canonical RTL idiom. The typed text only ever lived in the native
      // editor, so a matcher reading the retained prop would fail here.
      expect(field).toHaveValue("hi")
      expect(field).toHaveDisplayValue("hi")
      expect(field).toHaveDisplayValue(/^h/)
      expect(field).not.toHaveValue("")
      // The declaration-flavoured surface is unchanged: no `value` prop was
      // ever written, and `semantics` still says so.
      expect(field.semantics?.value).toBeUndefined()
    } finally {
      screen.unmount()
    }
  })

  it("reads the value an imperative ref write put in the editor", () => {
    const screen = createTestRoot({ width: 400, height: 160 })
    const ref = React.createRef<InputPublicInstance>()

    try {
      screen.render(
        <div style={{ width: 400, height: 160 }}>
          <input
            ref={ref}
            data-testid="field"
            value="hello"
            style={{ width: 300, height: 40 }}
          />
        </div>
      )
      const field = screen.getByTestId("field")
      expect(field).toHaveValue("hello")

      ref.current!.value = "goodbye"

      expect(field).toHaveValue("goodbye")
      expect(field).toHaveDisplayValue("goodbye")
      expect(field).not.toHaveValue("hello")
      // `HTMLInputElement.value =` does not rewrite the attribute either.
      expect(field.semantics?.value).toBe("hello")
    } finally {
      screen.unmount()
    }
  })

  it("reports no value at all for an element that edits no text", () => {
    const screen = createTestRoot()

    try {
      screen.render(
        <div>
          <div data-testid="panel" role="button" ariaLabel="Ledger">
            <text>Ledger</text>
          </div>
        </div>
      )
      const panel = screen.getByTestId("panel")

      // A `<div>` has no editor and never declares a value, so both halves of
      // the read come back empty — and the matchers say "not declared" rather
      // than matching the "" an empty editor would have reported.
      expect(screen.renderer.getInputValue(panel.id)).toBeNull()

      // Nor is the native read even attempted: it costs a forced draw, and no
      // type but `<input>`/`<textarea>` has an editor it could return.
      const read = vi.spyOn(screen.renderer, "getInputValue")
      expect(panel).not.toHaveValue("")
      expect(read).not.toHaveBeenCalled()
      read.mockRestore()

      expect(panel).not.toHaveDisplayValue("")
      expect(() => expect(panel).toHaveDisplayValue(/.*/)).toThrowError(
        /value is not declared/
      )
    } finally {
      screen.unmount()
    }
  })

  it("falls back to the declared value for an input whose editor was never built", () => {
    const screen = createTestRoot({ width: 400, height: 200 })

    try {
      screen.render(
        <virtual-list overdraw={0} estimatedItemHeight={40} style={{ width: 400, height: 160 }}>
          {Array.from({ length: 60 }, (_, index) => (
            <div key={index} style={{ height: 40, flexShrink: 0 }}>
              <input
                data-testid={`row-${index}`}
                value={`row-${index}`}
                style={{ width: 300, height: 30 }}
              />
            </div>
          ))}
        </virtual-list>
      )
      screen.renderer.flush()
      screen.renderer.drawPendingFrame()

      // A row far below the viewport is retained but never rendered, so no
      // native editor exists to hold its text. This is the reachable fallback:
      // the declared prop is the only value there is, and it is the right one.
      const offscreen = screen.getByTestId("row-50")
      expect(screen.renderer.getInputValue(offscreen.id)).toBeNull()
      expect(offscreen).toHaveValue("row-50")
      expect(offscreen).toHaveDisplayValue("row-50")
      expect(offscreen).not.toHaveValue("")
    } finally {
      screen.unmount()
    }
  })

  it("reads the computed accessible name, not the raw ariaLabel prop", () => {
    const screen = createTestRoot()

    try {
      screen.render(
        <div>
          <div data-testid="save" role="button" ariaLabel="Save factory" />
          <div data-testid="named-by-contents" role="heading" ariaLevel={2}>
            <text>Build list</text>
          </div>
          <div data-testid="unroled" ariaLabel="Ignored without a role" />
        </div>
      )

      expect(screen.getByTestId("save")).toHaveAccessibleName()
      expect(screen.getByTestId("save")).toHaveAccessibleName("Save factory")
      expect(screen.getByTestId("save")).toHaveAccessibleName(/factory/)
      expect(screen.getByTestId("named-by-contents")).toHaveAccessibleName("Build list")

      // GPUI only projects a name where the element projects semantics, so an
      // ariaLabel with no role has no accessible name. The matcher reports the
      // computation rather than falling back to the prop.
      expect(screen.getByTestId("unroled")).not.toHaveAccessibleName()
      expect(() =>
        expect(screen.getByTestId("unroled")).toHaveAccessibleName("Ignored without a role")
      ).toThrowError(/accessible name ""/)
    } finally {
      screen.unmount()
    }
  })

  it("names a plain text node from the string it paints", () => {
    // A painted string is a static-text node, and AccessKit takes such a node's
    // name from its value rather than its label. Reading the label alone left
    // every `<span>Hello</span>` nameless here while a screen reader announced
    // it, and left the node with no element to be asserted against at all.
    const screen = createTestRoot()

    try {
      screen.render(
        <div>
          <span data-testid="span">Hello</span>
        </div>
      )

      const text = screen.getByRole("label", { name: "Hello" })
      expect(text).toHaveAccessibleName()
      expect(text).toHaveAccessibleName("Hello")
      expect(text).toHaveAccessibleName(/ell/)
    } finally {
      screen.unmount()
    }
  })

  it("reads the computed accessible description, references and all", () => {
    const screen = createTestRoot()

    try {
      screen.render(
        <div>
          <text id="signal">Throughput fell 12%</text>
          <text id="response">Rebalance the belt</text>
          <div
            data-testid="referenced"
            role="button"
            ariaLabel="Coal line"
            ariaDescribedBy="signal"
          />
          <div
            data-testid="joined"
            role="button"
            ariaLabel="Iron line"
            ariaDescribedBy="signal response"
          />
          <div
            data-testid="direct"
            role="button"
            ariaLabel="Copper line"
            ariaDescription="Throughput fell 12%"
          />
          <div
            data-testid="both"
            role="button"
            ariaLabel="Steel line"
            ariaDescription="Ignored beside a reference"
            ariaDescribedBy="response"
          />
        </div>
      )

      const referenced = screen.getByTestId("referenced")
      expect(referenced).toHaveAccessibleDescription()
      expect(referenced).toHaveAccessibleDescription("Throughput fell 12%")
      expect(referenced).toHaveAccessibleDescription(/fell/)
      expect(referenced).not.toHaveAccessibleDescription("Coal line")

      // Several references flatten into one description, joined with spaces in
      // the order they are written — the accname computation, not a list.
      expect(screen.getByTestId("joined")).toHaveAccessibleDescription(
        "Throughput fell 12% Rebalance the belt"
      )

      expect(screen.getByTestId("direct")).toHaveAccessibleDescription("Throughput fell 12%")

      // A reference wins over an ariaDescription written beside it.
      expect(screen.getByTestId("both")).toHaveAccessibleDescription("Rebalance the belt")
    } finally {
      screen.unmount()
    }
  })

  it("reports an absent accessible description rather than the raw prop", () => {
    const screen = createTestRoot()

    try {
      screen.render(
        <div>
          <div data-testid="undescribed" role="button" ariaLabel="Save factory" />
          <div data-testid="unroled" ariaDescription="Ignored without a role" />
        </div>
      )

      const undescribed = screen.getByTestId("undescribed")
      expect(undescribed).not.toHaveAccessibleDescription()
      expect(undescribed).not.toHaveAccessibleDescription("Save factory")
      expect(() => expect(undescribed).toHaveAccessibleDescription()).toThrowError(
        /accessible description ""/
      )

      // A role, explicit or implicit, is what gives an element a node of its
      // own for a description to sit on. This one has neither.
      expect(screen.getByTestId("unroled")).not.toHaveAccessibleDescription()
      expect(() =>
        expect(screen.getByTestId("unroled")).toHaveAccessibleDescription(
          "Ignored without a role"
        )
      ).toThrowError(/accessible description ""/)
    } finally {
      screen.unmount()
    }
  })

  it("reads the role the queries resolve, authored or implicit", () => {
    const screen = createTestRoot()

    try {
      screen.render(
        <div>
          <div data-testid="save" role="button" ariaLabel="Save" />
          <button data-testid="button" ariaLabel="Go" />
          <img
            data-testid="icon"
            alt="Cable"
            src="/assets/icons/items/desc-cable-c.png"
            style={{ width: 40, height: 40 }}
          />
          <a data-testid="docs" href="/docs">
            <text>Docs</text>
          </a>
          <div data-testid="heading" role="heading" ariaLevel={2}>
            <text>Build list</text>
          </div>
        </div>
      )

      const save = screen.getByTestId("save")
      expect(save).toHaveRole("button")
      expect(save).not.toHaveRole("link")
      expect(screen.getByTestId("heading")).toHaveRole("heading")

      // The role a host type implies, with no `role` attribute to show for it —
      // which is the pair `toHaveAttribute('role')` answers the other half of.
      const icon = screen.getByTestId("icon")
      expect(icon).toHaveRole("img")
      expect(icon).not.toHaveAttribute("role")
      expect(screen.getByTestId("button")).toHaveRole("button")
      expect(screen.getByTestId("docs")).toHaveRole("link")

      // The role resolution is the queries', so the two cannot disagree.
      expect(screen.getByRole("button", { name: "Save" })).toHaveRole("button")
      expect(screen.getByRole("img", { name: "Cable" })).toHaveRole("img")
      expect(screen.getByRole("link", { name: "Docs" })).toHaveRole("link")

      expect(() => expect(save).toHaveRole("link")).toThrowError(
        /have role "link"[\s\S]*role "button"/
      )
      expect(() => expect(save).not.toHaveRole("button")).toThrowError(
        /not to have role "button"[\s\S]*role "button"/
      )
    } finally {
      screen.unmount()
    }
  })

  it("answers with every role the element projects, and with none where it projects nothing", () => {
    const screen = createTestRoot()

    try {
      screen.render(
        <div>
          <text data-testid="status" role="status">
            Copper
          </text>
          <div data-testid="plain" />
          <input data-testid="field" value="" style={{ width: 100, height: 30 }} />
        </div>
      )

      // An element that both carries a role and paints text projects two nodes,
      // as `<p>Hi</p>` does in the DOM, and a role query finds it under either.
      const status = screen.getByTestId("status")
      expect(status).toHaveRole("status")
      expect(status).toHaveRole("label")
      expect(status).not.toHaveRole("alert")
      expect(screen.getByRole("status")).toBe(status)
      expect(screen.getByRole("label", { name: "Copper" })).toBe(status)

      // A role exists here only where the element projects accessibility
      // semantics. There is no `generic` to fall back to, and a plain `<input>`
      // is invisible to the accessibility tree — so `getByRole('textbox')` does
      // not find it either, and the two still agree.
      const plain = screen.getByTestId("plain")
      const field = screen.getByTestId("field")
      expect(plain).not.toHaveRole("generic")
      expect(field).not.toHaveRole("textbox")
      expect(screen.queryAllByRole("textbox")).toHaveLength(0)

      expect(() => expect(plain).toHaveRole("generic")).toThrowError(
        /have role "generic"[\s\S]*projects no accessibility node, so it has no role/
      )
      expect(() => expect(status).not.toHaveRole("status")).toThrowError(
        /not to have role "status"[\s\S]*roles "label", "status"/
      )
    } finally {
      screen.unmount()
    }
  })

  it("reads attributes by their DOM names, not by the props behind them", () => {
    const screen = createTestRoot()

    try {
      screen.render(
        <div id="panel" data-testid="panel" data-state="open">
          <img
            data-testid="icon"
            alt="Cable"
            src="/assets/icons/items/desc-cable-c.png"
            style={{ width: 40, height: 40 }}
          />
          <div data-testid="save" role="button" ariaLabel="Save" tabIndex={0} />
          <a data-testid="docs" href="/docs" target="_blank">
            <text>Docs</text>
          </a>
          <input data-testid="field" placeholder="Search" value="iron" />
        </div>
      )

      // The form this replaces: which file the image was given, said as a
      // matcher over the element rather than a read of how it was built.
      expect(screen.getByRole("img", { name: "Cable" })).toHaveAttribute(
        "src",
        "/assets/icons/items/desc-cable-c.png"
      )

      const panel = screen.getByTestId("panel")
      expect(panel).toHaveAttribute("id", "panel")
      expect(panel).toHaveAttribute("data-testid", "panel")
      // Name only asserts presence; name and value assert the value.
      expect(panel).toHaveAttribute("data-state")
      expect(panel).toHaveAttribute("data-state", "open")
      expect(panel).not.toHaveAttribute("data-state", "closed")
      expect(panel).not.toHaveAttribute("data-missing")

      const save = screen.getByTestId("save")
      // The DOM spelling answers, though the prop behind it is camelCase.
      expect(save).toHaveAttribute("aria-label", "Save")
      expect(save).toHaveAttribute("role", "button")
      // Attribute names are case-insensitive in a document, so both spellings
      // are one attribute — and its value is the text a document would hold.
      expect(save).toHaveAttribute("tabindex", "0")
      expect(save).toHaveAttribute("tabIndex", "0")

      // An HTML attribute on a type the renderer builds as a native div still
      // reaches the test surface, so the link's target is assertable.
      const docs = screen.getByTestId("docs")
      expect(docs).toHaveAttribute("href", "/docs")
      expect(docs).toHaveAttribute("target", "_blank")
      expect(docs).not.toHaveAttribute("rel")
      expect(() => expect(docs).not.toHaveAttribute("href")).toThrowError(
        /not to have attribute "href"[\s\S]*attribute "href" is "\/docs"/
      )

      // `role` is the authored one. An `<img>` has an implicit role that the
      // accessibility tree projects and a browser reports no attribute for.
      const icon = screen.getByTestId("icon")
      expect(icon).not.toHaveAttribute("role")
      expect(icon).toHaveAttribute("alt", "Cable")
      expect(screen.getByRole("img", { name: "Cable" })).toBe(icon)

      // `<input>` is not a type built as a native div, so it forwards every
      // prop and its attributes answer without being listed anywhere.
      const field = screen.getByTestId("field")
      expect(field).toHaveAttribute("placeholder", "Search")
      expect(field).toHaveAttribute("value", "iron")

      // The renderer's own bookkeeping is not an attribute. `activationKind`
      // records how the element activates and the authored role is the sibling
      // of the resolved one `role` already answers with; neither was written by
      // an author, so neither answers to a name.
      expect(docs).not.toHaveAttribute("activationKind")
      expect(docs).not.toHaveAttribute("activationkind")
      expect(save).not.toHaveAttribute("authoredRole")
      // Nor is a name that only `Object.prototype` would answer.
      expect(save).not.toHaveAttribute("constructor")
      expect(save).not.toHaveAttribute("toString")

      expect(() => expect(panel).toHaveAttribute("data-state", "closed")).toThrowError(
        /have attribute "data-state" with value "closed"[\s\S]*attribute "data-state" is "open"/
      )
      expect(() => expect(panel).toHaveAttribute("href")).toThrowError(
        /attribute "href" is not declared/
      )
    } finally {
      screen.unmount()
    }
  })

  it("serializes an attribute value the way a document does", () => {
    const screen = createTestRoot()

    try {
      screen.render(
        <div>
          <div data-testid="off" role="button" ariaLabel="Save" disabled={false} />
          <div
            data-testid="on"
            role="button"
            ariaLabel="Delete"
            disabled
            ariaDisabled
            data-ready={true}
          />
          <img
            data-testid="bytes"
            alt="Tile"
            src={{ kind: "url", url: "https://example.com/tile.png" }}
            style={{ width: 20, height: 20 }}
          />
        </div>
      )

      // A bare boolean attribute is present with an empty value, exactly as
      // `<button disabled>` is in HTML.
      const on = screen.getByTestId("on")
      expect(on).toHaveAttribute("disabled")
      expect(on).toHaveAttribute("disabled", "")
      // `aria-*` and `data-*` carry the words instead: they are enumerated
      // attributes in HTML, not boolean ones.
      expect(on).toHaveAttribute("aria-disabled", "true")
      expect(on).toHaveAttribute("data-ready", "true")

      // `false` declares no attribute at all, so there is nothing to read.
      const off = screen.getByTestId("off")
      expect(off).not.toHaveAttribute("disabled")
      expect(off).not.toHaveAttribute("disabled", "")
      expect(() => expect(off).toHaveAttribute("disabled")).toThrowError(
        /attribute "disabled" is not declared/
      )

      // An image source given as a desktop object has no text a document could
      // have held, so it answers presence and no value at all — rather than
      // matching the "[object Object]" a stringified one would produce.
      const bytes = screen.getByTestId("bytes")
      expect(bytes).toHaveAttribute("src")
      expect(bytes).not.toHaveAttribute("src", "https://example.com/tile.png")
      expect(bytes).not.toHaveAttribute("src", "[object Object]")
      expect(() =>
        expect(bytes).toHaveAttribute("src", "https://example.com/tile.png")
      ).toThrowError(/attribute "src" is declared with a value no document could hold/)
    } finally {
      screen.unmount()
    }
  })

  it("rejects an attribute name it could not answer honestly", () => {
    const screen = createTestRoot()

    try {
      screen.render(
        <div data-testid="panel">
          <input data-testid="field" autoFocus value="" />
        </div>
      )
      const panel = screen.getByTestId("panel")

      // Answering "absent" would read as a passing negative assertion about a
      // concept the fork does not have, so both forms throw.
      expect(() => expect(panel).toHaveAttribute("class")).toThrowError(
        /no class attribute/
      )
      expect(() => expect(panel).not.toHaveAttribute("className", "row")).toThrowError(
        /no class attribute/
      )

      // `autoFocus` is declared and acted on, but the tree lifts it onto the
      // element as a flag rather than keeping it as a prop, so this matcher
      // cannot see it — and says so instead of calling it absent.
      const field = screen.getByTestId("field")
      expect(() => expect(field).toHaveAttribute("autofocus")).toThrowError(
        /autoFocus is lifted onto the element/
      )
      expect(() => expect(field).not.toHaveAttribute("autoFocus")).toThrowError(
        /Assert the effect instead, with toHaveFocus/
      )

      // The receiver is checked before the name, so a bad receiver is reported
      // as one whatever name follows it.
      expect(() => expect(null).toHaveAttribute("class")).toThrowError(
        /toHaveAttribute expects a TestElement/
      )
      expect(() => expect(undefined).not.toHaveAttribute("autofocus")).toThrowError(
        /toHaveAttribute expects a TestElement/
      )
    } finally {
      screen.unmount()
    }
  })

  it("fails rather than throws for every matcher on an unmounted element", () => {
    const screen = createTestRoot()

    try {
      screen.render(
        <div style={{ display: "flex", width: 200, height: 100 }}>
          <input
            data-testid="field"
            ariaLabel="Amount"
            value="one"
            style={{ width: 100, height: 30 }}
          />
        </div>
      )
      const field = screen.getByTestId("field")
      screen.renderer.focusElement(field.id)
      expect(field).toBeVisible()
      expect(field).toHaveFocus()

      screen.render(<div style={{ display: "flex", width: 200, height: 100 }} />)

      // A removed node is exactly what the negated form is asked about, so it
      // must answer, not throw. Throwing made `.not.` unusable after unmount.
      expect(field).not.toBeInTheDocument()
      expect(field).not.toBeVisible()
      expect(field).not.toBeInViewport()
      expect(field).not.toBeDisabled()
      // Including the ones that would otherwise refuse this element: a removed
      // node is answered before its role is ever consulted.
      expect(field).not.toBeEnabled()
      expect(field).not.toBeChecked()
      expect(field).not.toBePartiallyChecked()
      expect(field).not.toBeEmptyDOMElement()
      expect(field).not.toHaveFocus()
      expect(field).not.toHaveTextContent("one")
      expect(field).not.toHaveValue("one")
      expect(field).not.toHaveDisplayValue("one")
      expect(field).not.toHaveAccessibleName()
      expect(field).not.toHaveRole("textbox")
      expect(field).not.toHaveAttribute("aria-label", "Amount")

      // The positive form fails, and says why.
      expect(() => expect(field).toBeVisible()).toThrowError(
        /is no longer in the renderer's tree/
      )
      expect(() => expect(field).toHaveValue("one")).toThrowError(
        /is no longer in the renderer's tree/
      )
    } finally {
      screen.unmount()
    }
  })

  it("rejects an empty string that could never fail", () => {
    const screen = createTestRoot()

    try {
      screen.render(<div data-testid="panel" />)
      const panel = screen.getByTestId("panel")

      // "" is a substring of everything, so the assertion is unfalsifiable.
      expect(() => expect(panel).toHaveTextContent("")).toThrowError(
        /empty string always matches/
      )
      expect(() => expect(panel).not.toHaveTextContent("")).toThrowError(
        /empty string always matches/
      )
      // The suggested alternative does work.
      expect(panel).toHaveTextContent(/^$/)
    } finally {
      screen.unmount()
    }
  })

  it("rejects a value that is not a test element", () => {
    expect(() => expect(null).toBeInTheDocument()).toThrowError(
      /toBeInTheDocument expects a TestElement/
    )
    expect(() => expect({ id: 1 }).toBeDisabled()).toThrowError(
      /toBeDisabled expects a TestElement/
    )
  })

  it("states absence directly on the null a query returns", () => {
    const screen = createTestRoot()

    try {
      screen.render(
        <div>
          <text data-testid="row">Coal</text>
        </div>
      )

      // The form the assertion exists for: a query that found nothing, said as
      // absence rather than as `toBeNull()` over the query's return value.
      expect(screen.queryByTestId("gone")).not.toBeInTheDocument()
      expect(screen.queryByText("gone")).not.toBeInTheDocument()
      expect(null).not.toBeInTheDocument()
      // A query that did find something is unaffected.
      expect(screen.queryByTestId("row")).toBeInTheDocument()

      // Only `null`, only negated, and only this matcher: everything else
      // still throws, because no assertion about it could mean anything.
      expect(() => expect(null).toBeInTheDocument()).toThrowError(
        /toBeInTheDocument expects a TestElement/
      )
      expect(() => expect(undefined).not.toBeInTheDocument()).toThrowError(
        /toBeInTheDocument expects a TestElement/
      )
      expect(() => expect(null).not.toBeVisible()).toThrowError(
        /toBeVisible expects a TestElement/
      )
      expect(() => expect(null).not.toHaveTextContent("Coal")).toThrowError(
        /toHaveTextContent expects a TestElement/
      )
    } finally {
      screen.unmount()
    }
  })

  it("tracks live state through the same captured element", () => {
    const screen = createTestRoot()

    try {
      function Editable() {
        const [value, setValue] = useState("one")
        return (
          <div style={{ width: 300, height: 80 }}>
            <div data-testid="bump" role="button" ariaLabel="Bump" onClick={() => setValue("two")}>
              <text>Bump</text>
            </div>
            <input data-testid="field" value={value} style={{ width: 200, height: 30 }} />
          </div>
        )
      }

      screen.render(<Editable />)
      const field = screen.getByTestId("field")
      expect(field).toHaveValue("one")

      screen.renderer.nativeSimulateClick(10, 10)
      expect(field).toHaveValue("two")
    } finally {
      screen.unmount()
    }
  })
})
