/// GPU-backed coverage for the unified <img> source model.

import fs from "fs"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import React from "react"
import {
  createTestRoot,
  isNativeTestRendererAvailable,
  TestRenderer,
} from "../testing"
import type { TestRoot } from "../testing"
import type { ElementBounds, ImageMimeType, ImageSource } from "../types/host"
import type { GpuixLoadEvent } from "../reconciler/synthetic-event"
import { handleGpuixEvent } from "../reconciler/event-registry"
import {
  bufferSimilarity,
  expectScreenshotsDiffer,
  expectScreenshotsEqual,
  isCI,
  SHOTS_DIR,
} from "./test-utils"

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

function dataUrl({ mimeType, bytes }: (typeof FIXTURES)[number]) {
  return `data:${mimeType};base64,${bytes.toString("base64")}`
}

function withNonCanonicalTrailingBits(bytes: Buffer) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
  const encoded = bytes.toString("base64")
  const index = encoded.lastIndexOf("=") - 1
  const value = alphabet.indexOf(encoded[index]!)
  return encoded.slice(0, index) + alphabet[value ^ 1]! + encoded.slice(index + 1)
}
const FIXTURE_PATHS = new Map(
  FIXTURES.map(({ name }) => [name, `${SHOTS_DIR}/gpuix-image-source-${name}.${name === "jpeg" ? "jpg" : name}`])
)
const ETAG = '"gpuix-image-v1"'

let server: Server
let serverPort = 0
let fixtureRequestCount = 0
let conditionalRequestCount = 0
let blockedRequestCount = 0
let retryRequestCount = 0
let slowRequestCount = 0
let slowResponseCloseCount = 0
const slowResponseTimers = new Set<ReturnType<typeof setTimeout>>()
const liveTestRoots = new Set<ReturnType<typeof createTestRoot>>()
const liveRenderers = new Set<TestRenderer>()

function createImageTestRoot(options?: Parameters<typeof createTestRoot>[0]) {
  const testRoot = createTestRoot(options)
  liveTestRoots.add(testRoot)
  return testRoot
}

function imgBounds(renderer: TestRoot["renderer"], testId: string) {
  const element = renderer.findByTestId(testId)
  expect(element, `missing testId ${testId}`).toBeDefined()
  const rect = renderer.getElementBounds(element!.id)
  expect(rect, `no painted bounds for ${testId}`).toEqual(
    expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) })
  )
  return rect!
}

function disposeImageTestRoot(testRoot: ReturnType<typeof createTestRoot>) {
  testRoot.unmount()
  liveTestRoots.delete(testRoot)
}

function createImageRenderer() {
  const renderer = new TestRenderer()
  liveRenderers.add(renderer)
  return renderer
}

afterEach(() => {
  for (const testRoot of liveTestRoots) testRoot.unmount()
  liveTestRoots.clear()
  for (const renderer of liveRenderers) renderer.dispose()
  liveRenderers.clear()
})

function sourceFrame(source?: ImageSource | string, tint?: "currentColor") {
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

async function captureLoadedSource(
  source: ImageSource | string,
  name: string,
  tint?: "currentColor"
) {
  const baseline = createImageTestRoot({ allowPrivateNetworkImages: true })
  baseline.render(sourceFrame())
  const baselinePath = `${SHOTS_DIR}/gpuix-image-${name}-baseline.png`
  baseline.renderer.captureScreenshot(baselinePath)
  const baselineBytes = fs.readFileSync(baselinePath)

  const testRoot = createImageTestRoot({ allowPrivateNetworkImages: true })
  testRoot.render(sourceFrame(source, tint))
  const screenshotPath = `${SHOTS_DIR}/gpuix-image-${name}.png`

  try {
    for (let attempt = 0; attempt < 100; attempt++) {
      testRoot.renderer.flush()
      testRoot.renderer.captureScreenshot(screenshotPath)
      const paintedText = testRoot.renderer.getPaintedText().join("\n")
      const changed = bufferSimilarity(baselineBytes, fs.readFileSync(screenshotPath)) < 0.99
      if (changed && !paintedText.includes("img:")) return screenshotPath
      await new Promise((resolve) => setTimeout(resolve, 20))
    }

    throw new Error(`image ${name} did not paint: ${testRoot.renderer.getPaintedText().join(" | ")}`)
  } finally {
    disposeImageTestRoot(testRoot)
    disposeImageTestRoot(baseline)
  }
}

async function waitForImageEvents(
  testRoot: ReturnType<typeof createTestRoot>,
  events: readonly GpuixLoadEvent[],
  count: number
) {
  for (let frame = 0; frame < 100 && events.length < count; frame++) {
    testRoot.renderer.flush()
    testRoot.renderer.dispatchNativeEvents()
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  expect(events).toHaveLength(count)
}

async function takeQueuedImageEvent(testRoot: ReturnType<typeof createTestRoot>) {
  for (let frame = 0; frame < 100; frame++) {
    testRoot.renderer.flush()
    const event = testRoot.renderer.drainEvents().find((candidate) => candidate.eventType === "load")
    if (event) return event
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error("image load did not reach the native event queue")
}

describeNative("custom element: img", { timeout: 28_000 }, () => {
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
      fixtureRequestCount++
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
    fixtureRequestCount = 0
    conditionalRequestCount = 0
    blockedRequestCount = 0
    retryRequestCount = 0
    slowRequestCount = 0
    slowResponseCloseCount = 0
  })

  it("serialises Buffer-backed data sources through the custom-prop pipeline", () => {
    const testRoot = createImageTestRoot()
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

  // Both batches are malformed the same way; what differs is whether the
  // element's identity metadata was interned before or after the bad `src`.
  it("reports a malformed source whether identity metadata precedes or follows it", () => {
    const identityFirst = createImageRenderer()
    identityFirst.applyBatch(
      JSON.stringify([
        ["createElement", 41, "img"],
        ["setCustomPropValue", 41, "data-testid", "identity-first"],
        ["setCustomPropValue", 41, "src", { kind: "path", url: "/tmp/a.png" }],
      ])
    )
    expect(identityFirst.drainStyleDiagnostics()[0]).toMatchObject({
      elementId: 41,
      elementType: "img",
      dataTestId: "identity-first",
      property: "src",
      value: '{"kind":"path","url":"/tmp/a.png"}',
    })

    const identityLast = createImageRenderer()
    identityLast.applyBatch(
      JSON.stringify([
        ["createElement", 73, "img"],
        ["setCustomPropValue", 73, "src", { kind: "url", url: "file:///tmp/a.png" }],
        ["setCustomPropValue", 73, "data-testid", "identity-last"],
        ["setRoot", 73],
      ])
    )
    const diagnostic = identityLast.drainStyleDiagnostics()[0]
    expect(diagnostic).toMatchObject({
      elementId: 73,
      elementType: "img",
      dataTestId: "identity-last",
      property: "src",
    })
    expect(diagnostic.message).toContain('<img data-testid="identity-last">')
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

  it("GPU-renders bare-string path and URL source sugar", async () => {
    const pathScreenshot = await captureLoadedSource(FIXTURE_PATHS.get("png")!, "string-path")
    const urlScreenshot = await captureLoadedSource(
      `http://127.0.0.1:${serverPort}/png`,
      "string-url"
    )
    expect(fs.statSync(pathScreenshot).size).toBeGreaterThan(0)
    expect(fs.statSync(urlScreenshot).size).toBeGreaterThan(0)
  }, 15_000)

  it("records plausible bounds for a painting image", async () => {
    const testRoot = createImageTestRoot()
    try {
      testRoot.render(
        sourceFrame({ kind: "data", mimeType: "image/png", bytes: PNG_BYTES })
      )
      const image = testRoot.renderer.findByType("img")[0]!
      let bounds: ElementBounds | null = null
      for (let frame = 0; frame < 100; frame++) {
        testRoot.renderer.flush()
        bounds = testRoot.renderer.getElementBounds(image.id)
        if (
          testRoot.renderer.getImageLoadState(image.id)?.status === "loaded" &&
          bounds != null
        ) {
          break
        }
        await new Promise((resolve) => setTimeout(resolve, 10))
      }

      expect(testRoot.renderer.getImageLoadState(image.id)).toMatchObject({ status: "loaded" })
      expect(bounds).toEqual(expect.objectContaining({ x: expect.any(Number), y: expect.any(Number), width: expect.any(Number), height: expect.any(Number) }))
      expect(bounds.width).toBeGreaterThan(300)
      expect(bounds.height).toBeGreaterThan(180)
    } finally {
      disposeImageTestRoot(testRoot)
    }
  })

  it("GPU-renders PNG, JPEG, WebP, and SVG in-memory sources", async () => {
    for (const fixture of FIXTURES) {
      const screenshot = await captureLoadedSource(
        { kind: "data", mimeType: fixture.mimeType, bytes: fixture.bytes },
        `data-${fixture.name}`
      )
      expect(fs.statSync(screenshot).size).toBeGreaterThan(0)
    }
  }, 20_000)

  it("GPU-renders PNG, JPEG, WebP, and SVG data URL sources", async () => {
    for (const fixture of FIXTURES) {
      const screenshot = await captureLoadedSource(dataUrl(fixture), `data-url-${fixture.name}`)
      expect(fs.statSync(screenshot).size).toBeGreaterThan(0)
    }
  }, 20_000)

  it("emits one browser-shaped load event for path, URL, and data sources", async () => {
    const sources: Array<{ name: string; source: ImageSource | string; privateNetwork?: true }> = [
      { name: "path", source: FIXTURE_PATHS.get("png")! },
      {
        name: "url",
        source: `http://127.0.0.1:${serverPort}/png`,
        privateNetwork: true,
      },
      {
        name: "data",
        source: { kind: "data", mimeType: "image/png", bytes: PNG_BYTES },
      },
    ]

    for (const { name, source, privateNetwork } of sources) {
      const testRoot = createImageTestRoot(
        privateNetwork ? { allowPrivateNetworkImages: true } : undefined
      )
      const events: GpuixLoadEvent[] = []
      try {
        testRoot.render(
          <img
            data-testid={`${name}-load-event`}
            src={source}
            style={{ width: 32, height: 24 }}
            onLoad={(event) => events.push(event)}
          />
        )
        await waitForImageEvents(testRoot, events, 1)

        const image = testRoot.renderer.findByTestId(`${name}-load-event`)!
        expect(events[0]).toMatchObject({
          type: "load",
          eventType: "load",
          bubbles: false,
          cancelable: false,
          target: { id: image.id },
          currentTarget: { id: image.id },
        })

        if (name === "data") {
          testRoot.render(
            <img
              data-testid={`${name}-load-event`}
              src={{ kind: "data", mimeType: "image/png", bytes: new Uint8Array(PNG_BYTES) }}
              style={{ width: 32, height: 24 }}
              onLoad={(event) => events.push(event)}
            />
          )
          testRoot.renderer.flush()
          testRoot.renderer.dispatchNativeEvents()
        }

        for (let frame = 0; frame < 3; frame++) {
          testRoot.renderer.flush()
          testRoot.renderer.dispatchNativeEvents()
        }
        expect(events).toHaveLength(1)
      } finally {
        disposeImageTestRoot(testRoot)
      }
    }
  })

  it("delivers delegated load capture and ancestor handlers without changing bubbles", async () => {
    const testRoot = createImageTestRoot()
    const events: GpuixLoadEvent[] = []
    const delivery: Array<{ listener: string; bubbles: boolean; phase: number }> = []
    const record = (listener: string) => (event: GpuixLoadEvent) => {
      delivery.push({ listener, bubbles: event.bubbles, phase: event.eventPhase })
    }
    try {
      testRoot.render(
        <div onLoadCapture={record("ancestor-capture")} onLoad={record("ancestor")}>
          <img
            src={{ kind: "data", mimeType: "image/png", bytes: PNG_BYTES }}
            style={{ width: 32, height: 24 }}
            onLoadCapture={record("image-capture")}
            onLoad={(event) => {
              events.push(event)
              record("image")(event)
            }}
          />
        </div>
      )
      await waitForImageEvents(testRoot, events, 1)
      expect(delivery).toEqual([
        { listener: "ancestor-capture", bubbles: false, phase: 1 },
        { listener: "image-capture", bubbles: false, phase: 2 },
        { listener: "image", bubbles: false, phase: 2 },
        { listener: "ancestor", bubbles: false, phase: 3 },
      ])
    } finally {
      disposeImageTestRoot(testRoot)
    }
  })

  it("starts image lifecycle delivery when only an ancestor observes it", async () => {
    const testRoot = createImageTestRoot()
    const events: GpuixLoadEvent[] = []
    const delivery: Array<{ listener: string; bubbles: boolean }> = []
    try {
      testRoot.render(
        <div
          onLoadCapture={(event) => delivery.push({ listener: "ancestor-capture", bubbles: event.bubbles })}
          onLoad={(event) => {
            events.push(event)
            delivery.push({ listener: "ancestor", bubbles: event.bubbles })
          }}
        >
          <img
            src={{ kind: "data", mimeType: "image/png", bytes: PNG_BYTES }}
            style={{ width: 32, height: 24 }}
          />
        </div>
      )
      await waitForImageEvents(testRoot, events, 1)
      expect(delivery).toEqual([
        { listener: "ancestor-capture", bubbles: false },
        { listener: "ancestor", bubbles: false },
      ])
    } finally {
      disposeImageTestRoot(testRoot)
    }
  })

  it("suppresses a lifecycle completion queued before src replacement", async () => {
    const testRoot = createImageTestRoot()
    const currentEvents: GpuixLoadEvent[] = []
    try {
      testRoot.render(
        <img
          src={{ kind: "data", mimeType: "image/png", bytes: PNG_BYTES }}
          style={{ width: 32, height: 24 }}
          onLoad={() => {
            throw new Error("a queued completion must not use the previous lifecycle")
          }}
        />
      )
      const queued = await takeQueuedImageEvent(testRoot)

      testRoot.render(
        <img
          src={{ kind: "data", mimeType: "image/jpeg", bytes: JPEG_BYTES }}
          style={{ width: 32, height: 24 }}
          onLoad={(event) => currentEvents.push(event)}
        />
      )
      handleGpuixEvent(queued, testRoot.renderer)
      expect(currentEvents).toEqual([])

      await waitForImageEvents(testRoot, currentEvents, 1)
      expect(currentEvents[0]?.type).toBe("load")
    } finally {
      disposeImageTestRoot(testRoot)
    }
  })

  it("delivers a queued completion after an equivalent bare and tagged path source", async () => {
    const testRoot = createImageTestRoot()
    const currentEvents: GpuixLoadEvent[] = []
    const path = FIXTURE_PATHS.get("png")!
    try {
      testRoot.render(
        <img
          src={path}
          style={{ width: 32, height: 24 }}
          onLoad={() => {
            throw new Error("the queued completion must resolve through the current handler")
          }}
        />
      )
      const queued = await takeQueuedImageEvent(testRoot)

      testRoot.render(
        <img
          src={{ kind: "path", path }}
          style={{ width: 32, height: 24 }}
          onLoad={(event) => currentEvents.push(event)}
        />
      )
      handleGpuixEvent(queued, testRoot.renderer)
      expect(currentEvents).toHaveLength(1)
      expect(currentEvents[0]?.type).toBe("load")
    } finally {
      disposeImageTestRoot(testRoot)
    }
  })

  it("suppresses a queued completion when tint changes the current image request", async () => {
    const testRoot = createImageTestRoot()
    const currentEvents: GpuixLoadEvent[] = []
    const source = { kind: "data" as const, mimeType: "image/svg+xml" as const, bytes: SVG_BYTES }
    try {
      testRoot.render(
        <img
          src={source}
          style={{ width: 32, height: 24, color: "#e96b67" }}
          onLoad={() => {
            throw new Error("a queued completion must not use the tinted lifecycle handler")
          }}
        />
      )
      const queued = await takeQueuedImageEvent(testRoot)

      testRoot.render(
        <img
          src={source}
          tint="currentColor"
          style={{ width: 32, height: 24, color: "#e96b67" }}
          onLoad={(event) => currentEvents.push(event)}
        />
      )
      handleGpuixEvent(queued, testRoot.renderer)
      expect(currentEvents).toEqual([])

      await waitForImageEvents(testRoot, currentEvents, 1)
      expect(currentEvents[0]?.type).toBe("load")
    } finally {
      disposeImageTestRoot(testRoot)
    }
  })

  it("follows Fetch metadata and forgiving-base64 rules for PNG data URLs", async () => {
    const sources = [
      `data:;base64,${PNG_BYTES.toString("base64")}`,
      `data:image/png;base64,${withNonCanonicalTrailingBits(PNG_BYTES)}`,
    ]
    for (const [index, source] of sources.entries()) {
      const screenshot = await captureLoadedSource(source, `data-url-fetch-${index}`)
      expect(fs.statSync(screenshot).size).toBeGreaterThan(0)
    }
  }, 15_000)

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

  it("paints a remounted URL image from the decoded cache without a second request", async () => {
    const testRoot = createImageTestRoot({ allowPrivateNetworkImages: true })
    const source: ImageSource = {
      kind: "url",
      url: `http://127.0.0.1:${serverPort}/png`,
    }
    try {
      testRoot.render(sourceFrame(source))
      for (let frame = 0; frame < 100; frame++) {
        testRoot.renderer.flush()
        const image = testRoot.renderer.findByType("img")[0]!
        if (testRoot.renderer.getImageLoadState(image.id)?.status === "loaded") break
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      expect(
        testRoot.renderer.getImageLoadState(testRoot.renderer.findByType("img")[0]!.id)
      ).toMatchObject({ status: "loaded" })

      testRoot.render(sourceFrame())
      testRoot.renderer.flush()
      testRoot.render(sourceFrame(source))
      testRoot.renderer.flush()

      const remounted = testRoot.renderer.findByType("img")[0]!
      expect(testRoot.renderer.getImageLoadState(remounted.id)).toMatchObject({
        status: "loaded",
      })
      expect(fixtureRequestCount).toBe(1)
      expect(testRoot.renderer.getPaintedText().join(" ")).not.toContain("img:")
    } finally {
      disposeImageTestRoot(testRoot)
    }
  })

  it("paints a remounted data image from the decoded cache", async () => {
    const testRoot = createImageTestRoot()
    const firstSource: ImageSource = {
      kind: "data",
      mimeType: "image/png",
      bytes: new Uint8Array(PNG_BYTES),
    }
    try {
      testRoot.render(sourceFrame(firstSource))
      for (let frame = 0; frame < 100; frame++) {
        testRoot.renderer.flush()
        const image = testRoot.renderer.findByType("img")[0]!
        if (testRoot.renderer.getImageLoadState(image.id)?.status === "loaded") break
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      const firstImage = testRoot.renderer.findByType("img")[0]!
      expect(testRoot.renderer.getImageLoadState(firstImage.id)).toMatchObject({
        status: "loaded",
      })

      testRoot.render(sourceFrame())
      testRoot.renderer.flush()
      const secondSource: ImageSource = {
        kind: "data",
        mimeType: "image/png",
        bytes: new Uint8Array(PNG_BYTES),
      }
      testRoot.render(sourceFrame(secondSource))
      testRoot.renderer.flush()

      const remounted = testRoot.renderer.findByType("img")[0]!
      expect(remounted.id).not.toBe(firstImage.id)
      expect(testRoot.renderer.getImageLoadState(remounted.id)).toMatchObject({
        status: "loaded",
      })
      expect(testRoot.renderer.getPaintedText().join(" ")).not.toContain("img:")
    } finally {
      disposeImageTestRoot(testRoot)
    }
  })

  it("paints a remounted data URL image from the decoded cache", async () => {
    const testRoot = createImageTestRoot()
    try {
      testRoot.render(sourceFrame(dataUrl(FIXTURES[0]!)))
      for (let frame = 0; frame < 100; frame++) {
        testRoot.renderer.flush()
        const image = testRoot.renderer.findByType("img")[0]!
        if (testRoot.renderer.getImageLoadState(image.id)?.status === "loaded") break
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      const firstImage = testRoot.renderer.findByType("img")[0]!
      expect(testRoot.renderer.getImageLoadState(firstImage.id)).toMatchObject({
        status: "loaded",
      })

      testRoot.render(sourceFrame())
      testRoot.renderer.flush()
      testRoot.render(sourceFrame(dataUrl(FIXTURES[0]!)))
      testRoot.renderer.flush()

      const remounted = testRoot.renderer.findByType("img")[0]!
      expect(remounted.id).not.toBe(firstImage.id)
      expect(testRoot.renderer.getImageLoadState(remounted.id)).toMatchObject({
        status: "loaded",
      })
      expect(testRoot.renderer.getPaintedText().join(" ")).not.toContain("img:")
    } finally {
      disposeImageTestRoot(testRoot)
    }
  })

  it("keeps a path image on screen past the five-minute deadline", async () => {
    const testRoot = createImageTestRoot()
    try {
      testRoot.render(sourceFrame({ kind: "path", path: FIXTURE_PATHS.get("png")! }))
      for (let frame = 0; frame < 100; frame++) {
        testRoot.renderer.flush()
        const image = testRoot.renderer.findByType("img")[0]!
        if (testRoot.renderer.getImageLoadState(image.id)?.status === "loaded") break
        await new Promise((resolve) => setTimeout(resolve, 10))
      }

      testRoot.renderer.advanceAsyncClock(5 * 60_000 + 1_000)
      testRoot.renderer.flush()
      testRoot.renderer.flush()
      testRoot.renderer.flush()

      const image = testRoot.renderer.findByType("img")[0]!
      expect(testRoot.renderer.getImageLoadState(image.id)).toMatchObject({
        status: "loaded",
      })
      expect(testRoot.renderer.getPaintedText().join(" ")).not.toContain("img:")
    } finally {
      disposeImageTestRoot(testRoot)
    }
  })

  it("denies sugared loopback URL images by default before opening a connection", async () => {
    const testRoot = createImageTestRoot()
    testRoot.render(
      sourceFrame(`http://127.0.0.1:${serverPort}/blocked?token=secret`)
    )
    for (let frame = 0; frame < 20; frame++) {
      testRoot.renderer.flush()
      const image = testRoot.renderer.findByType("img")[0]!
      if (testRoot.renderer.getImageLoadState(image.id)?.status === "error") break
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    const image = testRoot.renderer.findByType("img")[0]!
    expect(testRoot.renderer.getImageLoadState(image.id)).toMatchObject({
      status: "error",
      error: expect.stringContaining("allowPrivateNetworkImages"),
    })
    expect(blockedRequestCount).toBe(0)
  })

  it("exposes URL load failures through the test image state", async () => {
    const testRoot = createImageTestRoot({ allowPrivateNetworkImages: true })
    try {
      testRoot.render(sourceFrame(`http://127.0.0.1:${serverPort}/missing`))
      const image = testRoot.renderer.findByType("img")[0]!
      for (let frame = 0; frame < 20; frame++) {
        testRoot.renderer.flush()
        if (testRoot.renderer.getImageLoadState(image.id)?.status === "error") break
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      expect(testRoot.renderer.getImageLoadState(image.id)).toMatchObject({
        status: "error",
        error: expect.stringContaining("404"),
      })
    } finally {
      disposeImageTestRoot(testRoot)
    }
  })

  it("emits one error event when the current source fails to decode", async () => {
    const testRoot = createImageTestRoot({ allowPrivateNetworkImages: true })
    const events: GpuixLoadEvent[] = []
    try {
      testRoot.render(
        <img
          data-testid="decode-error-event"
          src={`http://127.0.0.1:${serverPort}/decode-error`}
          style={{ width: 32, height: 24 }}
          onError={(event) => events.push(event)}
        />
      )
      await waitForImageEvents(testRoot, events, 1)
      const image = testRoot.renderer.findByTestId("decode-error-event")!
      expect(events[0]).toMatchObject({
        type: "error",
        eventType: "error",
        bubbles: false,
        cancelable: false,
        target: { id: image.id },
        currentTarget: { id: image.id },
      })

      for (let frame = 0; frame < 3; frame++) {
        testRoot.renderer.flush()
        testRoot.renderer.dispatchNativeEvents()
      }
      expect(events).toHaveLength(1)
    } finally {
      disposeImageTestRoot(testRoot)
    }
  })

  it("retries a transient failure after the bounded failure TTL", async () => {
    const testRoot = createImageTestRoot({ allowPrivateNetworkImages: true })
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
    const failureScreenshot = `${SHOTS_DIR}/gpuix-image-retry-failure.png`
    testRoot.renderer.captureScreenshot(failureScreenshot)

    testRoot.renderer.advanceAsyncClock(1_100)
    const successScreenshot = `${SHOTS_DIR}/gpuix-image-retry-success.png`
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
    const testRoot = createImageTestRoot({ allowPrivateNetworkImages: true })
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
    const testRoot = createImageTestRoot({ allowPrivateNetworkImages: true })
    try {
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

      testRoot.render(null)
      for (let attempt = 0; attempt < 50 && slowResponseCloseCount < 1; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      expect(slowResponseCloseCount).toBe(1)
    } finally {
      disposeImageTestRoot(testRoot)
    }
  })

  it("suppresses completion from a replaced or unmounted source", async () => {
    const testRoot = createImageTestRoot({ allowPrivateNetworkImages: true })
    const events: GpuixLoadEvent[] = []
    const handlers = {
      onLoad: (event: GpuixLoadEvent) => events.push(event),
      onError: (event: GpuixLoadEvent) => events.push(event),
    }
    try {
      testRoot.render(
        <img
          src={`http://127.0.0.1:${serverPort}/slow?replace`}
          style={{ width: 32, height: 24 }}
          {...handlers}
        />
      )
      for (let frame = 0; frame < 50 && slowRequestCount < 1; frame++) {
        testRoot.renderer.flush()
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      expect(slowRequestCount).toBe(1)

      testRoot.render(
        <img
          src={{ kind: "data", mimeType: "image/png", bytes: PNG_BYTES }}
          style={{ width: 32, height: 24 }}
          {...handlers}
        />
      )
      await waitForImageEvents(testRoot, events, 1)
      expect(events[0]?.type).toBe("load")

      testRoot.render(null)
      for (let attempt = 0; attempt < 50 && slowResponseCloseCount < 1; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      expect(slowResponseCloseCount).toBe(1)
      for (let frame = 0; frame < 3; frame++) {
        testRoot.renderer.flush()
        testRoot.renderer.dispatchNativeEvents()
      }
      expect(events).toHaveLength(1)
    } finally {
      disposeImageTestRoot(testRoot)
    }
  })

  it("keeps URL status, MIME, size, and decode failures recoverable in the GPU renderer", async () => {
    const cases = [
      { path: "missing", diagnostic: "404" },
      { path: "unsupported", diagnostic: "text/plain" },
      { path: "over-limit", diagnostic: "10 MiB" },
      { path: "decode-error", diagnostic: "image decoder" },
    ]

    for (const failure of cases) {
      const testRoot = createImageTestRoot({ allowPrivateNetworkImages: true })
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

      const screenshot = `${SHOTS_DIR}/gpuix-image-error-${failure.path}.png`
      expect(() => testRoot.renderer.captureScreenshot(screenshot)).not.toThrow()
      expect(fs.statSync(screenshot).size).toBeGreaterThan(0)
      disposeImageTestRoot(testRoot)
    }
  })

  it("warns through React for malformed source values", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const testRoot = createImageTestRoot()
    testRoot.render(
      <img
        data-testid="bad-image"
        src={{ kind: "data", mimeType: "text/plain" as ImageMimeType, bytes: [1] }}
      />
    )
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('<img data-testid="bad-image">'))
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("text/plain"))
  })
})

describeNative("custom element: svg", () => {
  it("renders raw monochrome SVG source with the inherited style color", () => {
    const testRoot = createImageTestRoot()
    testRoot.render(
      <div style={{ color: "#5ca9ff" }}>
        <svg source={SVG_FIXTURE} style={{ width: 240, height: 140 }} />
      </div>
    )

    const screenshot = `${SHOTS_DIR}/gpuix-svg-icon.png`
    testRoot.renderer.captureScreenshot(screenshot)
    expect(fs.statSync(screenshot).size).toBeGreaterThan(0)
  })

  it("tints #000 and currentColor SVG icons from an ancestor color", () => {
    const testRoot = createImageTestRoot()
    const sources = {
      blackFill:
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect x="4" y="4" width="24" height="24" rx="4" fill="#000"/></svg>',
      currentColor:
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect x="4" y="4" width="24" height="24" rx="4" fill="currentColor"/></svg>',
    }

    function SvgProbe({ ancestorColor, source }: { ancestorColor: string; source: string }) {
      return (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "#10131d",
            color: ancestorColor,
          }}
        >
          <svg source={source} style={{ width: 160, height: 100 }} />
        </div>
      )
    }

    for (const [name, source] of Object.entries(sources)) {
      const redPath = `${SHOTS_DIR}/gpuix-svg-${name}-inherited-red.png`
      const bluePath = `${SHOTS_DIR}/gpuix-svg-${name}-inherited-blue.png`
      testRoot.render(<SvgProbe ancestorColor="#ff4d6d" source={source} />)
      testRoot.renderer.captureScreenshot(redPath)
      testRoot.render(<SvgProbe ancestorColor="#4da3ff" source={source} />)
      testRoot.renderer.captureScreenshot(bluePath)
      expectScreenshotsDiffer(redPath, bluePath)
    }
  })

  it("keeps SVG currentColor aligned with an ancestor hover colour", () => {
    const source =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect x="4" y="4" width="24" height="24" rx="4" fill="currentColor"/></svg>'
    const baseColor = "#fb7185"
    const hoverColor = "#60a5fa"
    const activeColor = "#4ade80"
    const focusColor = "#c084fc"

    function SvgCurrentColor({
      color,
      hoverColor,
      activeColor,
      focusColor,
    }: {
      color: string
      hoverColor?: string
      activeColor?: string
      focusColor?: string
    }) {
      return (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "#10131d",
          }}
        >
          <div
            data-testid="svg-current-color-state"
            tabIndex={0}
            style={{
              width: 160,
              height: 100,
              color,
              ...(hoverColor ? { hover: { color: hoverColor } } : {}),
              ...(activeColor ? { active: { color: activeColor } } : {}),
              ...(focusColor ? { focus: { color: focusColor } } : {}),
            }}
          >
            <svg source={source} style={{ width: 160, height: 100 }} />
          </div>
        </div>
      )
    }

    const interactive = createImageTestRoot()
    interactive.render(
      <SvgCurrentColor
        color={baseColor}
        hoverColor={hoverColor}
        activeColor={activeColor}
        focusColor={focusColor}
      />
    )
    const target = interactive.renderer.findByTestId("svg-current-color-state")!
    const { x, y, width, height } = interactive.renderer.getElementBounds(target.id)!
    const before = `${SHOTS_DIR}/gpuix-svg-current-color-hover-before.png`
    const hovered = `${SHOTS_DIR}/gpuix-svg-current-color-hover-after.png`
    const expected = `${SHOTS_DIR}/gpuix-svg-current-color-hover-expected.png`
    const active = `${SHOTS_DIR}/gpuix-svg-current-color-active.png`
    const activeExpected = `${SHOTS_DIR}/gpuix-svg-current-color-active-expected.png`
    const focused = `${SHOTS_DIR}/gpuix-svg-current-color-focus.png`
    const focusExpected = `${SHOTS_DIR}/gpuix-svg-current-color-focus-expected.png`

    interactive.renderer.nativeSimulateMouseMove(10, 10)
    interactive.renderer.captureScreenshot(before)
    interactive.renderer.nativeSimulateMouseMove(x + width / 2, y + height / 2)
    expect(interactive.renderer.getResolvedStyle(target.id)).toMatchObject({ color: hoverColor })
    interactive.renderer.captureScreenshot(hovered)

    const reference = createImageTestRoot()
    reference.render(<SvgCurrentColor color={hoverColor} />)
    reference.renderer.captureScreenshot(expected)

    expectScreenshotsDiffer(before, hovered)
    // Issue #52's diagnostic read and the GPU SVG paint must represent the
    // same resolved colour, not merely two different frames. macOS CI VMs
    // sometimes retain the previous interactive frame between captures.
    if (!isCI) expectScreenshotsEqual(hovered, expected)

    interactive.renderer.nativeSimulateMouseDown(x + width / 2, y + height / 2)
    expect(interactive.renderer.getResolvedStyle(target.id)).toMatchObject({ color: activeColor })
    interactive.renderer.captureScreenshot(active)
    const activeReference = createImageTestRoot()
    activeReference.render(<SvgCurrentColor color={activeColor} />)
    activeReference.renderer.captureScreenshot(activeExpected)
    if (!isCI) expectScreenshotsEqual(active, activeExpected)

    interactive.renderer.nativeSimulateMouseUp(x + width / 2, y + height / 2)
    interactive.renderer.nativeSimulateMouseMove(10, 10)
    interactive.renderer.focusElement(target.id)
    expect(interactive.renderer.getResolvedStyle(target.id)).toMatchObject({ color: focusColor })
    interactive.renderer.captureScreenshot(focused)
    const focusReference = createImageTestRoot()
    focusReference.render(<SvgCurrentColor color={focusColor} />)
    focusReference.renderer.captureScreenshot(focusExpected)
    if (!isCI) expectScreenshotsEqual(focused, focusExpected)
  }, 10_000)

  it("keeps SVG currentColor aligned with ancestor hoverWithin", () => {
    const source =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect x="4" y="4" width="24" height="24" rx="4" fill="currentColor"/></svg>'
    const baseColor = "#fb7185"
    const groupHoverColor = "#facc15"

    function GroupedSvg({ color }: { color: string }) {
      return (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "#10131d",
          }}
        >
          <div
            data-testid="svg-current-color-group"
            style={{
              hoverGroup: "svg-current-color-group",
              width: 180,
              height: 100,
              display: "flex",
              alignItems: "center",
            }}
          >
            <div style={{ width: 40, height: 100 }} />
            <div
              data-testid="svg-current-color-hover-within"
              style={{
                width: 140,
                height: 100,
                color,
                hoverWithin: { color: groupHoverColor },
              }}
            >
              <svg source={source} style={{ width: 140, height: 100 }} />
            </div>
          </div>
        </div>
      )
    }

    const interactive = createImageTestRoot()
    interactive.render(<GroupedSvg color={baseColor} />)
    const group = interactive.renderer.findByTestId("svg-current-color-group")!
    const target = interactive.renderer.findByTestId("svg-current-color-hover-within")!
    const { x, y, width, height } = interactive.renderer.getElementBounds(group.id)!
    interactive.renderer.nativeSimulateMouseMove(x + width / 8, y + height / 2)

    expect(interactive.renderer.getResolvedStyle(target.id)).toMatchObject({ color: groupHoverColor })
    const actual = `${SHOTS_DIR}/gpuix-svg-current-color-hover-within.png`
    const expected = `${SHOTS_DIR}/gpuix-svg-current-color-hover-within-expected.png`
    interactive.renderer.captureScreenshot(actual)

    const reference = createImageTestRoot()
    reference.render(<GroupedSvg color={groupHoverColor} />)
    reference.renderer.captureScreenshot(expected)
    if (!isCI) expectScreenshotsEqual(actual, expected)
  })

  it("updates SVG currentColor when it mounts under a stationary pointer", () => {
    const source =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect x="4" y="4" width="24" height="24" rx="4" fill="currentColor"/></svg>'
    const baseColor = "#fb7185"
    const hoverColor = "#60a5fa"

    function MountedSvg({ show, color }: { show: boolean; color: string }) {
      return (
        <div style={{ width: "100%", height: "100%", position: "relative", backgroundColor: "#10131d" }}>
          {show && (
            <div
              data-testid="svg-current-color-mounted"
              style={{
                position: "absolute",
                left: 40,
                top: 40,
                width: 120,
                height: 100,
                color,
                hover: { color: hoverColor },
              }}
            >
              <svg source={source} style={{ width: 120, height: 100 }} />
            </div>
          )}
        </div>
      )
    }

    const interactive = createImageTestRoot()
    interactive.render(<MountedSvg show={false} color={baseColor} />)
    interactive.renderer.nativeSimulateMouseMove(100, 90)
    interactive.render(<MountedSvg show color={baseColor} />)
    interactive.renderer.flush()

    const target = interactive.renderer.findByTestId("svg-current-color-mounted")!
    expect(interactive.renderer.getResolvedStyle(target.id)).toMatchObject({ color: hoverColor })
    const actual = `${SHOTS_DIR}/gpuix-svg-current-color-mounted-under-pointer.png`
    const expected = `${SHOTS_DIR}/gpuix-svg-current-color-mounted-under-pointer-expected.png`
    interactive.renderer.captureScreenshot(actual)

    const reference = createImageTestRoot()
    reference.render(<MountedSvg show color={hoverColor} />)
    reference.renderer.captureScreenshot(expected)
    if (!isCI) expectScreenshotsEqual(actual, expected)
  })

  it("does not tint an occluded SVG currentColor surface", () => {
    const source =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect x="4" y="4" width="24" height="24" rx="4" fill="currentColor"/></svg>'
    const baseColor = "#fb7185"
    const hoverColor = "#60a5fa"

    function OccludedSvg({ overlay, color }: { overlay: boolean; color: string }) {
      return (
        <div style={{ width: "100%", height: "100%", position: "relative", backgroundColor: "#10131d" }}>
          <div
            data-testid="svg-current-color-occluded"
            style={{
              position: "absolute",
              left: 40,
              top: 40,
              width: 120,
              height: 100,
              color,
              hover: { color: hoverColor },
            }}
          >
            <svg source={source} style={{ width: 120, height: 100 }} />
          </div>
          {overlay && (
            <div
              style={{
                position: "absolute",
                left: 40,
                top: 40,
                width: 120,
                height: 100,
                pointerEvents: "auto",
              }}
            />
          )}
        </div>
      )
    }

    const interactive = createImageTestRoot()
    interactive.render(<OccludedSvg overlay={false} color={baseColor} />)
    interactive.renderer.nativeSimulateMouseMove(100, 90)
    interactive.render(<OccludedSvg overlay color={baseColor} />)
    interactive.renderer.flush()

    const target = interactive.renderer.findByTestId("svg-current-color-occluded")!
    expect(interactive.renderer.getResolvedStyle(target.id)).toMatchObject({ color: baseColor })
    const actual = `${SHOTS_DIR}/gpuix-svg-current-color-occluded.png`
    const expected = `${SHOTS_DIR}/gpuix-svg-current-color-occluded-expected.png`
    interactive.renderer.captureScreenshot(actual)

    const reference = createImageTestRoot()
    reference.render(<OccludedSvg overlay color={baseColor} />)
    reference.renderer.captureScreenshot(expected)
    if (!isCI) expectScreenshotsEqual(actual, expected)
  })

  it("uses the light default icon colour on a dark surface", () => {
    const baseline = createImageTestRoot()
    baseline.render(<div style={{ width: "100%", height: "100%", backgroundColor: "#101522" }} />)
    const baselinePath = `${SHOTS_DIR}/gpuix-svg-default-baseline.png`
    baseline.renderer.captureScreenshot(baselinePath)

    const icon = createImageTestRoot()
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
    const iconPath = `${SHOTS_DIR}/gpuix-svg-default-light.png`
    icon.renderer.captureScreenshot(iconPath)
    expect(bufferSimilarity(fs.readFileSync(baselinePath), fs.readFileSync(iconPath))).toBeLessThan(
      0.99
    )
  })
})
