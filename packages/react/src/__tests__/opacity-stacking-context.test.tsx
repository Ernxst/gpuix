import { readFileSync } from "node:fs"
import React from "react"
import { describe, expect, it } from "vitest"
import { createTestRoot, isNativeTestRendererAvailable } from "../testing.js"
import { decodePng } from "../testing-png.js"
import { SHOTS_DIR } from "./test-utils.js"

const SPLIT_COLOUR = [255, 176, 46, 255]
const TRANSLUCENT_SPLIT_COLOUR = [186, 133, 44, 255]

describe.skipIf(!isNativeTestRendererAvailable())("opacity stacking context", () => {
  async function captureSegmentPixel(
    fillStyle: React.CSSProperties = {},
    opacity?: number,
    containerDisplay: "flex" | "grid" = "flex",
  ): Promise<{ pixel: number[]; width: number; height: number }> {
    const source = new URL("../../../plugins/src/css-modules.ts", import.meta.url).href
    const { transformGpuixCssModule } = await import(source)
    const styles = await transformGpuixCssModule(
      `.track { display: flex; flex-direction: row; width: 240px; height: 10px; flex-shrink: 0; }
       .segment { display: flex; flex-direction: row; height: 10px; flex-shrink: 0; background: #ffb02e; }
       .translucent { composes: segment; opacity: ${opacity ?? 0.7}; }`,
      "/fixture/split.module.css",
    )
    for (const style of Object.values(styles)) {
      Object.defineProperty(style, Symbol.for("gpuix.compiledStyle"), { value: true })
    }

    const root = createTestRoot({ width: 1280, height: 800 })
    try {
      root.render(
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            width: 1280,
            height: 800,
            backgroundColor: "#1a2226",
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              flexGrow: 1,
              minHeight: 0,
              backgroundColor: "#1a2226",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                flexGrow: 1,
                minHeight: 0,
                position: "relative",
              }}
            >
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  flexGrow: 1,
                  height: 712,
                  minWidth: 0,
                  minHeight: 0,
                  overflowX: "scroll",
                  overflowY: "hidden",
                }}
              >
                <table
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    flexGrow: 1,
                    height: 712,
                    minWidth: "max-content",
                    minHeight: 0,
                  }}
                >
                  <tbody
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      flexGrow: 1,
                      height: 688,
                      minHeight: 0,
                      overflowX: "hidden",
                      overflowY: "scroll",
                    }}
                  >
                    <virtual-list
                      itemCount={1}
                      windowStart={0}
                      estimatedItemHeight={29}
                      style={{ width: 1280, height: 688, flexGrow: 1, minHeight: 0 }}
                    >
                      <div
                        style={{
                          paddingTop: 1,
                          backgroundColor: "#39444c",
                          display: "flex",
                          flexDirection: "row",
                          flexShrink: 0,
                        }}
                      >
                        <tr
                          style={{
                            display: "flex",
                            flexDirection: "row",
                            flexShrink: 0,
                            alignItems: "flex-start",
                            gap: 16,
                            minHeight: 28,
                            paddingLeft: 16,
                            paddingRight: 16,
                            backgroundColor: "#1a2226",
                          }}
                        >
                          <td
                            style={{
                              display: "flex",
                              flexDirection: "row",
                              flexGrow: 240,
                              flexShrink: 0,
                              flexBasis: 0,
                              alignItems: "center",
                              width: 240,
                              minWidth: 240,
                              maxWidth: 240,
                              minHeight: 28,
                              padding: 0,
                            }}
                          >
                            <span
                              role="img"
                              aria-label="Split: 100% Power generation"
                              className={styles.track}
                              style={{ display: containerDisplay }}
                            >
                              <span
                                data-testid="opacity-segment"
                                className={opacity === undefined ? styles.segment : styles.translucent}
                                style={{ width: "100%", ...fillStyle }}
                              />
                            </span>
                          </td>
                        </tr>
                      </div>
                    </virtual-list>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>,
      )

      const renderer = root.renderer
      const fill = renderer.findByTestId("opacity-segment")!
      const screenshot = `${SHOTS_DIR}/gpuix-opacity-stacking-context.png`
      renderer.captureScreenshot(screenshot)
      const image = decodePng(readFileSync(screenshot), screenshot)
      const { x, y, width, height } = renderer.getElementBounds(fill.id)!
      const scale = image.width / 1280
      const offset =
        (Math.floor((y + height / 2) * scale) * image.width +
          Math.floor((x + width / 2) * scale)) *
        4

      return {
        pixel: [...image.data.subarray(offset, offset + 4)],
        width,
        height,
      }
    } finally {
      root.unmount()
    }
  }

  it("paints an opacity context above its clipped row and virtual-list slot", async () => {
    const result = await captureSegmentPixel({}, 0.7)
    expect(result).toMatchObject({ width: 240, height: 10 })
    expect(result.pixel).toEqual(TRANSLUCENT_SPLIT_COLOUR)
  })

  it("keeps a nearly opaque segment visible in the clipped row", async () => {
    const result = await captureSegmentPixel({}, 0.99)
    expect(result).toMatchObject({ width: 240, height: 10 })
    expect(result.pixel).toEqual([253, 175, 46, 255])
  })

  it("keeps an unpositioned flex item with z-index above the clipped row", async () => {
    const result = await captureSegmentPixel({ zIndex: 0 })
    expect(result).toMatchObject({ width: 240, height: 10 })
    expect(result.pixel).toEqual(SPLIT_COLOUR)
  })

  it("keeps an unpositioned grid item with z-index above the clipped row", async () => {
    const result = await captureSegmentPixel({ zIndex: 0 }, undefined, "grid")
    expect(result).toMatchObject({ width: 240, height: 10 })
    expect(result.pixel).toEqual(SPLIT_COLOUR)
  })

  it("paints an explicit opacity of one in the clipped row", async () => {
    const result = await captureSegmentPixel({}, 1)
    expect(result).toMatchObject({ width: 240, height: 10 })
    expect(result.pixel).toEqual(SPLIT_COLOUR)
  })

  it("paints opacity when the flex item is positioned", async () => {
    const result = await captureSegmentPixel({ position: "relative" }, 0.7)
    expect(result).toMatchObject({ width: 240, height: 10 })
    expect(result.pixel).toEqual(TRANSLUCENT_SPLIT_COLOUR)
  })
})
