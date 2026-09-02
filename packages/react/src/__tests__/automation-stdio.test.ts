/// SSE stdin/stdout transport. Logs without a `data:` prefix cannot break it.

import { describe, expect, it } from "vitest"
import {
  connectTest,
  connectStdio,
  encodeSse,
  handleAutomationRequest,
  InProcessBackend,
  PROTOCOL_VERSION,
  SseBackend,
} from "../automation/index.js"
import {
  browserKeystrokeInit,
  type TestAutomationRenderer,
} from "../automation/client.js"

function fakeRenderer(): TestAutomationRenderer {
  let clicks = 0
  return {
    nativeSimulateClick() {
      clicks += 1
    },
    nativeSimulateMouseDown() {},
    nativeSimulateMouseUp() {},
    nativeSimulateMouseMove() {},
    nativeSimulateScrollWheel() {},
    getSynchronousScrollDrawCount: () => 0,
    simulateKeystrokes() {},
    nativeSimulateKeystrokes() {},
    nativeSimulateKeyDown() {},
    nativeSimulateKeyUp() {},
    scrollTo() {},
    getScrollOffset: () => null,
    getAllText: () => [`clicks:${clicks}`],
    getPaintedText: () => [`clicks:${clicks}`],
    getSelectedText: () => null,
    clearSelection() {},
    captureScreenshot() {},
    getAutomationTree: () =>
      JSON.stringify({
        id: 1,
        type: "div",
        dataTestId: "inc",
        bounds: { x: 0, y: 0, width: 40, height: 20 },
        children: [{ id: 2, type: "text", text: `clicks:${clicks}` }],
      }),
    getElementBounds: () => [0, 0, 40, 20],
    clockPause: () => 0,
    clockSet: (nowMs) => nowMs,
    clockFastForward: (deltaMs) => deltaMs,
    clockResume: () => 0,
  }
}

describe("automation stdio", () => {
  it("uses Testing Library matcher semantics for text and test IDs", async () => {
    const renderer = fakeRenderer()
    renderer.getAutomationTree = () =>
      JSON.stringify({
        id: 1,
        type: "div",
        dataTestId: "  inc  ",
        children: [
          { id: 2, type: "text", text: "  clicks:\n0  " },
          { id: 3, type: "div", dataTestId: "standard" },
        ],
      })
    const app = await connectTest(renderer)

    expect(await app.getByText("clicks: 0").count()).toBe(1)
    expect(await app.getByText("clicks").count()).toBe(0)
    expect(await app.getByText("CLICKS", { exact: false }).count()).toBe(1)
    expect(
      await app
        .getByText((content, element) => content === "clicks: 0" && element.id === 2)
        .count()
    ).toBe(1)
    expect(
      await app
        .getByText("CLICKS:0", {
          normalizer: (content) => content.trim().replace(/\s+/g, "").toUpperCase(),
        })
        .count()
    ).toBe(1)

    expect(await app.getByTestId("inc").count()).toBe(1)
    expect(await app.getByTestId("IN", { exact: false }).count()).toBe(1)
    expect(
      await app
        .getByTestId((content, element) => content === "inc" && element.id === 1)
        .count()
    ).toBe(1)

    // One test ID per node, resolved from `data-testid`.
    expect(await app.getByTestId("standard").count()).toBe(1)
    await app.close()
  })

  it("forwards platform scroll fields without advancing the renderer", async () => {
    const renderer = fakeRenderer()
    let received: unknown[] | undefined
    let synchronousDraws = 0
    renderer.nativeSimulateScrollWheel = (...args) => {
      received = args
      synchronousDraws += 1
    }
    renderer.getSynchronousScrollDrawCount = () => synchronousDraws
    const app = await connectTest(renderer)

    await app.call("scrollWheel", {
      x: 12,
      y: 24,
      deltaX: 0,
      deltaY: -2,
      phase: "started",
      deltaUnit: "lines",
      modifiers: { alt: true },
    })

    expect(received).toEqual([
      12,
      24,
      0,
      -2,
      { phase: "started", deltaUnit: "lines", modifiers: { alt: true } },
    ])
    expect(await app.call("getSynchronousScrollDrawCount", {})).toEqual({ count: 1 })
    await app.close()
  })

  it("preserves browser key characters and held state", () => {
    expect(browserKeystrokeInit("A")).toMatchObject({ key: "A" })
    expect(browserKeystrokeInit("-")).toMatchObject({ key: "-" })
    expect(browserKeystrokeInit("cmd-a", true)).toMatchObject({
      key: "a",
      metaKey: true,
      repeat: true,
    })
  })

  it("matches the desktop key value for shifted letters", () => {
    // Desktop reports "A" for shift-a (events.test.tsx locks that), so the
    // browser mirror must not report "a".
    expect(browserKeystrokeInit("shift-a")).toMatchObject({
      key: "A",
      shiftKey: true,
    })
    // Named keys and modifier combinations that produce no character keep the
    // unshifted name.
    expect(browserKeystrokeInit("shift-tab")).toMatchObject({ key: "Tab" })
    expect(browserKeystrokeInit("cmd-shift-a")).toMatchObject({ key: "a" })
  })

  it("round-trips through data: lines with log noise", async () => {
    const backend = new InProcessBackend(fakeRenderer())
    let listener: ((chunk: string) => void) | undefined
    const app = await connectStdio({
      write: (chunk) => {
        const raw = JSON.parse(chunk.replace(/^data: /, "").trim())
        void handleAutomationRequest(raw, backend).then((reply) => {
          listener?.(`[child] still starting\n${reply}`)
        })
      },
      feed: (fn) => {
        listener = fn
      },
    })

    await app.getByTestId("inc").click()
    expect(await app.getByText("clicks:1").textContent()).toBe("clicks:1")
    await app.close()
  })

  it("initialize handshake matches the protocol version", async () => {
    const backend = new InProcessBackend(fakeRenderer())
    const reply = await handleAutomationRequest(
      {
        id: 1,
        method: "initialize",
        params: { protocolVersion: PROTOCOL_VERSION, client: "test" },
      },
      backend
    )
    expect(reply.startsWith("data: ")).toBe(true)
    expect(reply).toContain('"protocolVersion":1')
  })

  it("encodeSse prefixes every protocol message", () => {
    expect(encodeSse({ id: 1, method: "blur", params: {} })).toMatch(
      /^data: \{/
    )
  })

  it("closes pending requests and the transport exactly once", async () => {
    let closes = 0
    const backend = new SseBackend(
      () => {},
      () => {},
      async () => {
        closes += 1
      }
    )
    const pending = backend.call("blur", {})
    const rejection = expect(pending).rejects.toMatchObject({ code: "Closed" })

    await backend.close()
    await rejection
    await backend.close()

    expect(closes).toBe(1)
  })

  it("enforces the same closed-session contract in process", async () => {
    const backend = new InProcessBackend(fakeRenderer())
    await backend.close()

    await expect(backend.call("blur", {})).rejects.toMatchObject({
      code: "Closed",
    })
  })

  it("rejects calls made after the session closes without writing", async () => {
    let writes = 0
    const backend = new SseBackend(
      () => {
        writes += 1
      },
      () => {}
    )
    await backend.close()

    const rejected = backend.call("blur", {}).then(
      () => undefined,
      (error: unknown) => error
    )
    expect(writes).toBe(0)
    await expect(rejected).resolves.toMatchObject({ code: "Closed" })
  })
})
