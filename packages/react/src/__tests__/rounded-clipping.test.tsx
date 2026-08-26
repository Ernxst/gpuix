import fs from "fs"
import path from "path"
import React from "react"
import { beforeAll, describe, it } from "vitest"
import { createTestRoot, isNativeTestRendererAvailable } from "../testing.js"
import { expectScreenshotsEqual, SHOTS_DIR } from "./test-utils.js"

const describeNative = isNativeTestRendererAvailable() ? describe : describe.skip

beforeAll(() => {
  fs.mkdirSync(SHOTS_DIR, { recursive: true })
})

type Radius = "uniform" | "top-right" | "none"

function RoundedClip({ radius, child }: { radius: Radius; child: boolean }) {
  const radiusStyle =
    radius === "uniform"
      ? { borderRadius: 28 }
      : radius === "top-right"
        ? { borderTopRightRadius: 28 }
        : { borderRadius: 0 }

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        padding: 40,
        backgroundColor: "#17191f",
      }}
    >
      <div
        style={{
          position: "relative",
          width: 96,
          height: 96,
          ...radiusStyle,
          ...(child
            ? { overflow: "hidden" as const }
            : { backgroundColor: "#5b8cff" }),
        }}
      >
        {child ? (
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: 120,
              height: 120,
              backgroundColor: "#5b8cff",
            }}
          />
        ) : null}
      </div>
    </div>
  )
}

function expectClipMatchesPaintedRadius(name: string, radius: Radius) {
  const clippedPath = path.join(SHOTS_DIR, `${name}-clipped-child.png`)
  const referencePath = path.join(SHOTS_DIR, `${name}-painted-radius.png`)

  const clipped = createTestRoot()
  clipped.render(<RoundedClip radius={radius} child />)
  clipped.renderer.captureScreenshot(clippedPath)

  const reference = createTestRoot()
  reference.render(<RoundedClip radius={radius} child={false} />)
  reference.renderer.captureScreenshot(referencePath)

  expectScreenshotsEqual(clippedPath, referencePath)
}

describeNative("rounded overflow clipping", () => {
  it("clips an oversized child to a uniform border radius", () => {
    expectClipMatchesPaintedRadius("overflow-uniform-radius", "uniform")
  })

  it("clips an oversized child to a per-corner border radius", () => {
    expectClipMatchesPaintedRadius("overflow-top-right-radius", "top-right")
  })

  it("keeps radius-zero overflow clipping rectangular", () => {
    expectClipMatchesPaintedRadius("overflow-zero-radius", "none")
  })
})
