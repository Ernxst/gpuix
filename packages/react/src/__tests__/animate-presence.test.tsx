import { describe, expect, it } from "vitest"
import { AnimatePresence, motion } from "../index"
import { createTestRoot, hasNativeTestRenderer } from "../testing"

const describeNative = hasNativeTestRenderer ? describe : describe.skip

describeNative("AnimatePresence", () => {
  it("keeps an exiting motion.div until the exit target finishes", () => {
    const { render, renderer } = createTestRoot()

    function App({ show }: { show: boolean }) {
      return (
        <AnimatePresence>
          {show ? (
            <motion.div
              key="card"
              initial={false}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2, ease: "linear" }}
            >
              <text>Leaving</text>
            </motion.div>
          ) : null}
        </AnimatePresence>
      )
    }

    render(<App show />)
    expect(renderer.getAllText()).toEqual(["Leaving"])

    renderer.clockPause()
    render(<App show={false} />)
    expect(renderer.getAllText()).toEqual(["Leaving"])

    renderer.clockFastForward(100)
    renderer.dispatchNativeEvents()
    expect(renderer.getAllText()).toEqual(["Leaving"])

    renderer.clockFastForward(100)
    renderer.dispatchNativeEvents()
    expect(renderer.getAllText()).toEqual([])
  })

  it("skips enter when AnimatePresence initial is false", () => {
    const { render, renderer } = createTestRoot()

    renderer.clockPause()
    render(
      <AnimatePresence initial={false}>
        <motion.div
          key="card"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2, ease: "linear" }}
        >
          <text>Ready</text>
        </motion.div>
      </AnimatePresence>
    )

    expect(renderer.findByType("div")[0]?.customProps?.motion).toMatchObject({
      initial: false,
      animate: { opacity: 1 },
    })
  })
})

describe("AnimatePresence without native", () => {
  it("exports AnimatePresence next to motion", () => {
    expect(typeof AnimatePresence).toBe("function")
  })
})
