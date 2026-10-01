import { readFileSync } from "node:fs"
import React from "react"
import { describe, expect, it } from "vitest"
import { createTestRoot, isNativeTestRendererAvailable } from "../testing.js"
import { decodePng } from "../testing-png.js"
import { SHOTS_DIR } from "./test-utils.js"

const focusColour = [0xff, 0xb0, 0x2e] as const

function countPixels(image: ReturnType<typeof decodePng>, bounds: { x: number; y: number; width: number; height: number }) {
  const scale = image.width / 240
  const left = Math.max(0, Math.floor(bounds.x * scale))
  const right = Math.min(image.width, Math.ceil((bounds.x + bounds.width) * scale))
  const top = Math.max(0, Math.floor(bounds.y * scale))
  const bottom = Math.min(image.height, Math.ceil((bounds.y + bounds.height) * scale))
  let count = 0
  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      const offset = (y * image.width + x) * 4
      if (
        image.data[offset] === focusColour[0] &&
        image.data[offset + 1] === focusColour[1] &&
        image.data[offset + 2] === focusColour[2] &&
        image.data[offset + 3] === 255
      ) count++
    }
  }
  return count
}

function expectHorizontalPixelRow(
  image: ReturnType<typeof decodePng>,
  bounds: { x: number; y: number; width: number; height: number },
  colour: readonly [number, number, number],
) {
  const scale = image.width / 240
  const left = Math.max(0, Math.floor(bounds.x * scale))
  const right = Math.min(image.width, Math.ceil((bounds.x + bounds.width) * scale))
  const y = Math.max(0, Math.min(image.height - 1, Math.floor((bounds.y + bounds.height / 2) * scale)))

  for (let x = left; x < right; x++) {
    const offset = (y * image.width + x) * 4
    expect(Array.from(image.data.slice(offset, offset + 4))).toEqual([...colour, 255])
  }
}

describe.skipIf(!isNativeTestRendererAvailable())("focused link underline", () => {
  it("paints the revealed underline with the focused link colour", async () => {
    const source = new URL("../../../plugins/src/css-modules.ts", import.meta.url).href
    const { transformGpuixCssModule } = await import(source)
    const styles = await transformGpuixCssModule(
      `.siteLink { position: relative; display: flex; align-items: center; gap: 8px; }
       .siteLink:focus-visible { outline-color: #ffb02e; outline-width: 2px; outline-offset: 0; }
       .underline { position: absolute; left: 0; right: 0; bottom: -2px; height: 1px; background: #afbab9; opacity: 0; pointer-events: none; }
       .siteLink:hover .underline,
       .siteLink:focus-visible .underline { opacity: 1; }`,
      "/fixture/site-link.module.css",
    )
    for (const style of Object.values(styles)) {
      Object.defineProperty(style, Symbol.for("gpuix.compiledStyle"), { value: true })
    }

    const root = createTestRoot({ width: 240, height: 100 })
    try {
      root.render(
        <>
          <button data-testid="start" type="button" />
          <div data-testid="frame" style={{ width: "max-content", paddingBottom: 2 }}>
            <a className={styles.siteLink} data-testid="link" href="/example" style={{ width: "max-content" }}>
              <text>Black Powder Works</text>
              <span aria-hidden={true} className={styles.underline} data-testid="underline" />
            </a>
          </div>
        </>,
      )

      await root.userEvent.tab()
      await root.userEvent.tab()

      const renderer = root.renderer
      const underline = renderer.findByTestId("underline")!
      expect(renderer.getResolvedStyle(underline.id)).toMatchObject({ opacity: 1 })
      const bounds = renderer.getElementBounds(underline.id)!
      const screenshot = `${SHOTS_DIR}/link-underline-focus.png`
      renderer.captureScreenshot(screenshot)
      const image = decodePng(readFileSync(screenshot), screenshot)
      expectHorizontalPixelRow(image, bounds, focusColour)
    } finally {
      root.unmount()
    }
  })

  it("paints the link text in its focused colour", async () => {
    const source = new URL("../../../plugins/src/css-modules.ts", import.meta.url).href
    const { transformGpuixCssModule } = await import(source)
    const styles = await transformGpuixCssModule(
      `.link { color: #afbab9; }
       .link:focus-visible { color: #ffb02e; }`,
      "/fixture/focused-link-text.module.css",
    )
    for (const style of Object.values(styles)) {
      Object.defineProperty(style, Symbol.for("gpuix.compiledStyle"), { value: true })
    }

    const root = createTestRoot({ width: 240, height: 100 })
    try {
      root.render(
        <>
          <button type="button"><text>Start</text></button>
          <a className={styles.link} data-testid="link" href="/example">
            <text data-testid="link-text">Focused text</text>
          </a>
        </>,
      )
      await root.userEvent.tab()
      await root.userEvent.tab()
      const link = root.renderer.findByTestId("link")!
      const text = root.renderer.findByTestId("link-text")!
      expect(root.renderer.getResolvedStyle(link.id)).toMatchObject({ color: "#ffb02e" })
      const bounds = root.renderer.getElementBounds(text.id)!
      const screenshot = `${SHOTS_DIR}/link-text-focus.png`
      root.renderer.captureScreenshot(screenshot)
      expect(countPixels(decodePng(readFileSync(screenshot), screenshot), bounds)).toBeGreaterThan(0)
    } finally {
      root.unmount()
    }
  })

  it.each(["hover", "active"] as const)("paints the revealed underline on :%s", async (state) => {
    const source = new URL("../../../plugins/src/css-modules.ts", import.meta.url).href
    const { transformGpuixCssModule } = await import(source)
    const styles = await transformGpuixCssModule(
      `.link { position: relative; display: flex; width: max-content; }
       .underline { position: absolute; left: 0; right: 0; bottom: -2px; height: 1px; background: #ffb02e; opacity: 0; }
       .link:hover .underline, .link:active .underline { opacity: 1; }`,
      `/fixture/link-underline-${state}.module.css`,
    )
    for (const style of Object.values(styles)) {
      Object.defineProperty(style, Symbol.for("gpuix.compiledStyle"), { value: true })
    }

    const root = createTestRoot({ width: 240, height: 100 })
    try {
      root.render(
        <a className={styles.link} data-testid="link" href="/example">
          <text>Hover and press</text>
          <span aria-hidden={true} className={styles.underline} data-testid="underline" />
        </a>,
      )
      const link = root.renderer.findByTestId("link")!
      const underline = root.renderer.findByTestId("underline")!
      const bounds = root.renderer.getElementBounds(link.id)!
      if (state === "hover") {
        root.renderer.nativeSimulateMouseMove(bounds.x + 4, bounds.y + 4)
      } else {
        root.renderer.nativeSimulateMouseMove(bounds.x + 4, bounds.y + 4)
        root.renderer.nativeSimulateMouseDown(bounds.x + 4, bounds.y + 4)
      }
      expect(root.renderer.getResolvedStyle(underline.id)).toMatchObject({ opacity: 1 })
      const underlineBounds = root.renderer.getElementBounds(underline.id)!
      const screenshot = `${SHOTS_DIR}/link-underline-${state}.png`
      root.renderer.captureScreenshot(screenshot)
      expectHorizontalPixelRow(decodePng(readFileSync(screenshot), screenshot), underlineBounds, focusColour)
    } finally {
      root.unmount()
    }
  })

  it("paints an underline coloured by an ancestor's focus state", async () => {
    const source = new URL("../../../plugins/src/css-modules.ts", import.meta.url).href
    const { transformGpuixCssModule } = await import(source)
    const styles = await transformGpuixCssModule(
      `.group { position: relative; display: flex; width: max-content; }
       .group:focus-visible .underline { background: #ffb02e; opacity: 1; }
       .underline { position: absolute; left: 0; right: 0; bottom: -2px; height: 1px; background: #afbab9; opacity: 0; }`,
      "/fixture/ancestor-focused-link-underline.module.css",
    )
    for (const style of Object.values(styles)) {
      Object.defineProperty(style, Symbol.for("gpuix.compiledStyle"), { value: true })
    }

    const root = createTestRoot({ width: 240, height: 100 })
    try {
      root.render(
        <>
          <button type="button"><text>Start</text></button>
          <div className={styles.group} data-testid="group" tabIndex={0}>
            <a href="/example"><text>Nested link</text></a>
            <span aria-hidden={true} className={styles.underline} data-testid="underline" />
          </div>
        </>,
      )
      await root.userEvent.tab()
      await root.userEvent.tab()
      const underline = root.renderer.findByTestId("underline")!
      expect(root.renderer.getResolvedStyle(underline.id)).toMatchObject({
        backgroundColor: "#ffb02e",
        opacity: 1,
      })
      const bounds = root.renderer.getElementBounds(underline.id)!
      const screenshot = `${SHOTS_DIR}/ancestor-focus-link-underline.png`
      root.renderer.captureScreenshot(screenshot)
      expectHorizontalPixelRow(decodePng(readFileSync(screenshot), screenshot), bounds, focusColour)
    } finally {
      root.unmount()
    }
  })
})
