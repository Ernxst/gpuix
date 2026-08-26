/// GPU-backed coverage for the unified <img> source model.

import fs from "fs"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import React from "react"
import {
  createTestRoot,
  isNativeTestRendererAvailable,
  TestRenderer,
} from "../testing"
import type { ImageMimeType, ImageSource } from "../types/host"
import { bufferSimilarity, isCI } from "./test-utils"

const describeNative = isNativeTestRendererAvailable() ? describe : describe.skip

const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAACAAAAAYEAIAAABEobQgAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRP///////wlY99wAAAAHdElNRQfqCBoKIR2W0ZKSAAAAJXRFWHRkYXRlOmNyZWF0ZQAyMDI2LTA4LTI2VDEwOjMzOjI5KzAwOjAwyAamDgAAACV0RVh0ZGF0ZTptb2RpZnkAMjAyNi0wOC0yNlQxMDozMzoyOSswMDowMLlbHrIAAAAodEVYdGRhdGU6dGltZXN0YW1wADIwMjYtMDgtMjZUMTA6MzM6MjkrMDA6MDDuTj9tAAAB+klEQVRYw2NUUQkPP3qUYcgCpoF2wKgHBtoBI94DLORpk/8k4PV2lu8OzefnvTzj1MQvL5HZx6/w7s8Ty4+3hbi2r7j1Rjdis/t1ScPtD4U+7BBOpp0HGIkvhdj7WH79calmcdy/6am/vebW8yHE6Nq47bqr4eZWlv2ufmI/S/9wsOwaAA+wd7P8+OO2rirab7KLzBl+jXefSbXmieHHa0L8Qd1Lt+Xu+Fn8h41lD7U8QFQeqP7vuGfTC/KcDgEy5/m13n2sZnLcu+k5tZxOlAfk3wt4vJ3r766567w/5Zb5O2luPx8k/1nA6+0sOnnAd4fm8/Oe1LIMbuYL6plJwAOe0Wqil5dR1wOeUWoil5fTyQMyx/nV3n2jrgcoyUske+CJ88cHQszU9cAT84+3hLjp5IHtc289002grge2z7/1QjeWTh7Y7HFd0nAbdT2w2fO6hOF2OnngIf+H7cKpG49c9zFcRbllG/dd9zRc91Dgww7hFDp5AAJaf+538JOlJO0+sf54R4ij9e9+Jz8pajkdAkhpC/Ww/PzjWs3guHfTc39XzR3nA4nRtfHgdW/DNa2/9zv4Sf8s/sNOvUYEyR5ABvLvBTzezkFpjZ7gV3v37Yn9x3tCrNvn3Hqmm7DZ47qk4faHAh+2Uy/BUM0DgwcM+Q7NqAcGGgAAPwXJOwU9zvkAAAAASUVORK5CYII=",
  "base64"
)
const JPEG_BYTES = Buffer.from(
  "/9j//gAQTGF2YzYyLjI4LjEwMgD/2wBDAAgEBAQEBAUFBQUFBQYGBgYGBgYGBgYGBgYHBwcICAgHBwcGBgcHCAgICAkJCQgICAgJCQoKCgwMCwsODg4RERT/xAB6AAEBAQEBAAAAAAAAAAAAAAAGAAMEBwEBAAMBAQAAAAAAAAAAAAAAAwABBAYFEAACAgEDAwQDAQEAAAAAAAABAgMEABEhBRMSMQdxkUEGUWEygREAAgEDBAEEAgMBAAAAAAAAAgEDEQUEIRIGADFhIhMHQXFRMxQy/8AAEQgAGAAgAwEiAAIRAAMRAP/aAAwDAQACEQMRAD8AKxxyTSJHGjSO7BERAWZmY6BVUbkk7ADfEMXpb+WS1Ov0qsb6ais84E5+FMQP8aUEfeXpbFUl/K4uvp3pWnesD9zAAfIiMjD9Ea56dj/ZX2XeeLXiC2WyDGTUEeRNNkxlJ8m8iSjjHcKQpD7j81dFSnQ41xnDuuGeTlHI/eUYBGSHbtS9xOj110Xin774ncp2uPsyVrULwTRHtkjcaMp8/BG4I2I3G2Z4w9YYqi8nxsiaCy9eUTAeemrjosfcmUa/pcH51HFL2XI+PW+6lD/nLJiZHHrQTAyjLbXXYRCyCuu1rvl3XBVtuGRiI/kURJIvy0xRKtPyk6F690p3LNC1DarSNDNC4eN18qw99iPogggjYjTFkXrDya1OyTjaslnTQTCWRIvdoe0k/wB0lUYPyy71xTj3IyhK62+HLKH+sy3gYqtdm6MgJg3qwbY+nZhXW421GsXIOFH/ANJUYt+K0JNJ+q1708ty17m70t27L1JpNBsO1UUf5RFGyqo8D/p1JJzmyyzbBBBiwRwQRhDFEAxxxxihAAFUERFaJJLToSSHKZHIRGZNkRE6sm/Lb/l9/9k=",
  "base64"
)
const WEBP_BYTES = Buffer.from(
  "UklGRpYAAABXRUJQVlA4TIkAAAAvH8AFADegJpIUNvmBMvU4QBFqGkmBs+U5+IASB+hASRtJkH9hi1fDGvgOH5j/+MXAS889Jc+ezBjYRLatJiQABXDqVNHBqfn61/A+g4CI/itw20bxMcMzAi9DtZ2tVPoBKGUWkDOU+BgkknFwBtHIm0Qz7xRdPKgzdbd6mfrd6n9R/pv6X30JAQA=",
  "base64"
)
const SVG_FIXTURE = [
  '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="140" viewBox="0 0 240 140">',
  '<rect width="240" height="140" fill="#1e2d59"/>',
  '<rect x="16" y="16" width="208" height="108" rx="14" fill="#5ca9ff"/>',
  '<circle cx="68" cy="70" r="24" fill="#ffd166"/>',
  '<path d="M116 52h84v18h-84z" fill="currentColor"/>',
  "</svg>",
].join("")
const SVG_BYTES = Buffer.from(SVG_FIXTURE)

const FIXTURES = [
  { name: "png", mimeType: "image/png" as const, bytes: PNG_BYTES },
  { name: "jpeg", mimeType: "image/jpeg" as const, bytes: JPEG_BYTES },
  { name: "webp", mimeType: "image/webp" as const, bytes: WEBP_BYTES },
  { name: "svg", mimeType: "image/svg+xml" as const, bytes: SVG_BYTES },
]
const FIXTURE_PATHS = new Map(
  FIXTURES.map(({ name }) => [name, `/tmp/gpuix-image-source-${name}.${name === "jpeg" ? "jpg" : name}`])
)
const ETAG = '"gpuix-image-v1"'

let server: Server
let serverPort = 0
let conditionalRequestCount = 0
let blockedRequestCount = 0
let retryRequestCount = 0
let slowRequestCount = 0
let slowResponseCloseCount = 0
const slowResponseTimers = new Set<ReturnType<typeof setTimeout>>()

function sourceFrame(source?: ImageSource, tint?: "currentColor") {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#101522",
        color: "#38d996",
      }}
    >
      {source ? (
        <img
          src={source}
          tint={tint}
          objectFit="contain"
          style={{ width: 320, height: 190 }}
        />
      ) : (
        <div style={{ width: 320, height: 190 }} />
      )}
    </div>
  )
}

async function captureLoadedSource(source: ImageSource, name: string, tint?: "currentColor") {
  const baseline = createTestRoot({ allowPrivateNetworkImages: true })
  baseline.render(sourceFrame())
  const baselinePath = `/tmp/gpuix-image-${name}-baseline.png`
  baseline.renderer.captureScreenshot(baselinePath)
  const baselineBytes = fs.readFileSync(baselinePath)

  const testRoot = createTestRoot({ allowPrivateNetworkImages: true })
  testRoot.render(sourceFrame(source, tint))
  const screenshotPath = `/tmp/gpuix-image-${name}.png`

  for (let attempt = 0; attempt < 100; attempt++) {
    testRoot.renderer.flush()
    testRoot.renderer.captureScreenshot(screenshotPath)
    const paintedText = testRoot.renderer.getPaintedText().join("\n")
    const changed = bufferSimilarity(baselineBytes, fs.readFileSync(screenshotPath)) < 0.99
    if (changed && !paintedText.includes("img:")) return screenshotPath
    await new Promise((resolve) => setTimeout(resolve, 20))
  }

  throw new Error(`image ${name} did not paint: ${testRoot.renderer.getPaintedText().join(" | ")}`)
}

describeNative("custom element: img", () => {
  beforeAll(async () => {
    for (const fixture of FIXTURES) {
      fs.writeFileSync(FIXTURE_PATHS.get(fixture.name)!, fixture.bytes)
    }
    server = createServer((request, response) => {
      const pathname = request.url ?? "/"
      if (pathname === "/missing") {
        response.writeHead(404).end("not here")
        return
      }
      if (pathname === "/unsupported") {
        response.writeHead(200, { "content-type": "text/plain" }).end("plain text")
        return
      }
      if (pathname === "/decode-error") {
        response.writeHead(200, { "content-type": "image/png" }).end("not a PNG")
        return
      }
      if (pathname === "/over-limit") {
        response.writeHead(200, {
          "content-type": "image/png",
          "content-length": String(10 * 1024 * 1024 + 1),
        }).end(PNG_BYTES)
        return
      }
      if (pathname.startsWith("/blocked")) {
        blockedRequestCount++
        response.writeHead(200, { "content-type": "image/png" }).end(PNG_BYTES)
        return
      }
      if (pathname.startsWith("/redact")) {
        response.writeHead(403).end("top-secret-response-body")
        return
      }
      if (pathname.startsWith("/retry")) {
        retryRequestCount++
        if (retryRequestCount === 1) {
          response.writeHead(503).end("transient-secret-body")
        } else {
          response.writeHead(200, { "content-type": "image/png", etag: ETAG }).end(PNG_BYTES)
        }
        return
      }
      if (pathname.startsWith("/slow")) {
        slowRequestCount++
        response.writeHead(200, { "content-type": "image/png" })
        response.flushHeaders()
        response.write(PNG_BYTES.subarray(0, 8))
        const timer = setTimeout(() => response.end(PNG_BYTES.subarray(8)), 30_000)
        slowResponseTimers.add(timer)
        response.on("close", () => {
          clearTimeout(timer)
          slowResponseTimers.delete(timer)
          slowResponseCloseCount++
        })
        return
      }

      const name = pathname.slice(1)
      const fixture = FIXTURES.find((candidate) => candidate.name === name)
      if (!fixture) {
        response.writeHead(404).end("not found")
        return
      }
      if (request.headers["if-none-match"] === ETAG) {
        conditionalRequestCount++
        response.writeHead(304, { etag: ETAG }).end()
        return
      }
      response
        .writeHead(200, { "content-type": fixture.mimeType, etag: ETAG })
        .end(fixture.bytes)
    })
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve)
    })
    serverPort = (server.address() as AddressInfo).port
  })

  afterAll(async () => {
    for (const timer of slowResponseTimers) clearTimeout(timer)
    slowResponseTimers.clear()
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
  })

  beforeEach(() => {
    conditionalRequestCount = 0
    blockedRequestCount = 0
    retryRequestCount = 0
    slowRequestCount = 0
    slowResponseCloseCount = 0
  })

  it("serialises Buffer-backed data sources through the custom-prop pipeline", () => {
    const testRoot = createTestRoot()
    const source: ImageSource = {
      kind: "data",
      mimeType: "image/webp",
      bytes: WEBP_BYTES,
    }
    testRoot.render(<img src={source} style={{ width: 32, height: 24 }} />)

    expect(testRoot.renderer.findByType("img")[0]?.customProps?.src).toEqual({
      kind: "data",
      mimeType: "image/webp",
      bytes: Array.from(WEBP_BYTES),
    })
  })

  it("reports malformed direct and batched sources with element, property, and value", () => {
    const direct = new TestRenderer()
    direct.createElement(41, "img")
    direct.setCustomProp(41, "testId", JSON.stringify("direct-image"))
    direct.setCustomProp(41, "src", JSON.stringify("/tmp/ambiguous.png"))
    expect(direct.drainStyleDiagnostics()[0]).toMatchObject({
      elementId: 41,
      elementType: "img",
      testId: "direct-image",
      property: "src",
      value: '"/tmp/ambiguous.png"',
    })

    const batched = new TestRenderer()
    batched.applyBatch(
      JSON.stringify([
        ["createElement", 73, "img"],
        ["setCustomPropValue", 73, "src", { kind: "url", url: "file:///tmp/a.png" }],
        ["setCustomPropValue", 73, "testId", "batch-image"],
        ["setRoot", 73],
      ])
    )
    const diagnostic = batched.drainStyleDiagnostics()[0]
    expect(diagnostic).toMatchObject({
      elementId: 73,
      elementType: "img",
      testId: "batch-image",
      property: "src",
    })
    expect(diagnostic.message).toContain('<img testId="batch-image">')
    expect(diagnostic.message).toContain("file:///tmp/a.png")
  })

  it("GPU-renders PNG, JPEG, WebP, and SVG path sources", async () => {
    for (const fixture of FIXTURES) {
      const screenshot = await captureLoadedSource(
        { kind: "path", path: FIXTURE_PATHS.get(fixture.name)! },
        `path-${fixture.name}`
      )
      expect(fs.statSync(screenshot).size).toBeGreaterThan(0)
    }
  }, 20_000)

  it("GPU-renders PNG, JPEG, WebP, and SVG URL sources through the local server", async () => {
    for (const fixture of FIXTURES) {
      const screenshot = await captureLoadedSource(
        { kind: "url", url: `http://127.0.0.1:${serverPort}/${fixture.name}` },
        `url-${fixture.name}`
      )
      expect(fs.statSync(screenshot).size).toBeGreaterThan(0)
    }
  }, 20_000)

  it("GPU-renders PNG, JPEG, WebP, and SVG in-memory sources", async () => {
    for (const fixture of FIXTURES) {
      const screenshot = await captureLoadedSource(
        { kind: "data", mimeType: fixture.mimeType, bytes: fixture.bytes },
        `data-${fixture.name}`
      )
      expect(fs.statSync(screenshot).size).toBeGreaterThan(0)
    }
  }, 20_000)

  it("preserves authored SVG colours by default and explicitly resolves inherited currentColor", async () => {
    const source: ImageSource = {
      kind: "data",
      mimeType: "image/svg+xml",
      bytes: SVG_BYTES,
    }
    const authored = await captureLoadedSource(source, "svg-authored")
    const tinted = await captureLoadedSource(source, "svg-current-color", "currentColor")

    expect(fs.existsSync(authored)).toBe(true)
    expect(fs.existsSync(tinted)).toBe(true)
    if (!isCI) {
      expect(bufferSimilarity(fs.readFileSync(authored), fs.readFileSync(tinted))).toBeLessThan(0.99)
    }
  }, 15_000)

  it("revalidates URL cache entries and uses a 304 response", async () => {
    const source: ImageSource = {
      kind: "url",
      url: `http://127.0.0.1:${serverPort}/svg`,
    }
    await captureLoadedSource(source, "url-cache-first")
    await captureLoadedSource(source, "url-cache-same-key")
    expect(conditionalRequestCount).toBeGreaterThan(0)
  }, 15_000)

  it("denies loopback URL images by default before opening a connection", async () => {
    const testRoot = createTestRoot()
    testRoot.render(
      sourceFrame({
        kind: "url",
        url: `http://127.0.0.1:${serverPort}/blocked?token=secret`,
      })
    )
    for (let frame = 0; frame < 20; frame++) {
      testRoot.renderer.flush()
      if (testRoot.renderer.getPaintedText().join(" ").includes("private network")) break
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    const painted = testRoot.renderer.getPaintedText().join(" ")
    expect(painted).toContain("allowPrivateNetworkImages")
    expect(painted).not.toContain("token")
    expect(painted).not.toContain("secret")
    expect(blockedRequestCount).toBe(0)
  })

  it("retries a transient failure after the bounded failure TTL", async () => {
    const testRoot = createTestRoot({ allowPrivateNetworkImages: true })
    testRoot.render(
      sourceFrame({
        kind: "url",
        url: `http://127.0.0.1:${serverPort}/retry`,
      })
    )
    for (let frame = 0; frame < 100; frame++) {
      testRoot.renderer.flush()
      if (testRoot.renderer.getPaintedText().join(" ").includes("503")) break
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    expect(retryRequestCount).toBe(1)
    expect(testRoot.renderer.getPaintedText().join(" ")).toContain("503")
    const failureScreenshot = "/tmp/gpuix-image-retry-failure.png"
    testRoot.renderer.captureScreenshot(failureScreenshot)

    testRoot.renderer.advanceAsyncClock(1_100)
    const successScreenshot = "/tmp/gpuix-image-retry-success.png"
    for (let frame = 0; frame < 100; frame++) {
      testRoot.renderer.flush()
      testRoot.renderer.captureScreenshot(successScreenshot)
      if (
        retryRequestCount >= 2 &&
        !testRoot.renderer.getPaintedText().join(" ").includes("img:")
      ) {
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    expect(retryRequestCount).toBeGreaterThanOrEqual(2)
    expect(testRoot.renderer.getPaintedText().join(" ")).not.toContain("img:")
    expect(
      bufferSimilarity(
        fs.readFileSync(failureScreenshot),
        fs.readFileSync(successScreenshot)
      )
    ).toBeLessThan(0.99)
  })

  it("redacts URL secrets and never paints response bodies", async () => {
    const testRoot = createTestRoot({ allowPrivateNetworkImages: true })
    testRoot.render(
      sourceFrame({
        kind: "url",
        url: `http://127.0.0.1:${serverPort}/redact?token=query-secret`,
      })
    )
    for (let frame = 0; frame < 30; frame++) {
      testRoot.renderer.flush()
      if (testRoot.renderer.getPaintedText().join(" ").includes("403")) break
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    const painted = testRoot.renderer.getPaintedText().join(" ")
    expect(painted).toContain("403")
    expect(painted).not.toContain("token")
    expect(painted).not.toContain("query-secret")
    expect(painted).not.toContain("top-secret-response-body")
  })

  it("cancels an in-flight URL body when its image unmounts", async () => {
    const testRoot = createTestRoot({ allowPrivateNetworkImages: true })
    testRoot.render(
      sourceFrame({
        kind: "url",
        url: `http://127.0.0.1:${serverPort}/slow`,
      })
    )
    for (let frame = 0; frame < 50 && slowRequestCount < 1; frame++) {
      testRoot.renderer.flush()
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    expect(slowRequestCount).toBe(1)

    testRoot.unmount()
    testRoot.renderer.flush()
    for (let attempt = 0; attempt < 50 && slowResponseCloseCount < 1; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    expect(slowResponseCloseCount).toBe(1)
  })

  it("keeps URL status, MIME, size, and decode failures recoverable in the GPU renderer", async () => {
    const cases = [
      { path: "missing", diagnostic: "404" },
      { path: "unsupported", diagnostic: "text/plain" },
      { path: "over-limit", diagnostic: "10 MiB" },
      { path: "decode-error", diagnostic: "image decoder" },
    ]

    for (const failure of cases) {
      const testRoot = createTestRoot({ allowPrivateNetworkImages: true })
      testRoot.render(
        sourceFrame({
          kind: "url",
          url: `http://127.0.0.1:${serverPort}/${failure.path}`,
        })
      )
      for (let frame = 0; frame < 20; frame++) {
        expect(() => testRoot.renderer.flush()).not.toThrow()
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      const painted = testRoot.renderer.getPaintedText().join(" ")
      expect(painted).toContain("img: failed to load")
      expect(painted).toContain(failure.diagnostic)

      const screenshot = `/tmp/gpuix-image-error-${failure.path}.png`
      expect(() => testRoot.renderer.captureScreenshot(screenshot)).not.toThrow()
      expect(fs.statSync(screenshot).size).toBeGreaterThan(0)
    }
  })

  it("warns through React for malformed source values", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const testRoot = createTestRoot()
    testRoot.render(
      <img
        testId="bad-image"
        src={{ kind: "data", mimeType: "text/plain" as ImageMimeType, bytes: [1] }}
      />
    )
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('<img testId="bad-image">'))
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("text/plain"))
  })
})

describeNative("custom element: svg", () => {
  it("renders raw monochrome SVG source with the inherited style color", () => {
    const testRoot = createTestRoot()
    testRoot.render(
      <div style={{ color: "#5ca9ff" }}>
        <svg source={SVG_FIXTURE} style={{ width: 240, height: 140 }} />
      </div>
    )

    const screenshot = "/tmp/gpuix-svg-icon.png"
    testRoot.renderer.captureScreenshot(screenshot)
    expect(fs.statSync(screenshot).size).toBeGreaterThan(0)
  })

  it("uses the light default icon colour on a dark surface", () => {
    const baseline = createTestRoot()
    baseline.render(<div style={{ width: "100%", height: "100%", backgroundColor: "#101522" }} />)
    const baselinePath = "/tmp/gpuix-svg-default-baseline.png"
    baseline.renderer.captureScreenshot(baselinePath)

    const icon = createTestRoot()
    icon.render(
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#101522",
        }}
      >
        <svg
          source={'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect x="4" y="4" width="24" height="24" rx="4" fill="#000"/></svg>'}
          style={{ width: 96, height: 96 }}
        />
      </div>
    )
    const iconPath = "/tmp/gpuix-svg-default-light.png"
    icon.renderer.captureScreenshot(iconPath)
    expect(bufferSimilarity(fs.readFileSync(baselinePath), fs.readFileSync(iconPath))).toBeLessThan(
      0.99
    )
  })
})
