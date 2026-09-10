import { latestAttachedContainer } from "./reconciler/event-registry.js"
import type { NativeRenderer } from "./types/host.js"

/**
 * `TestRenderer`'s in-memory clipboard backdoor (`testing.ts`). Detected by
 * duck typing rather than importing `TestRenderer` here, since this module
 * has no dependency on the testing entry otherwise.
 */
interface TestClipboardBackdoor {
  getClipboardText(): string | null
  setClipboardText(text: string | null): void
}

function testClipboardOf(native: NativeRenderer): TestClipboardBackdoor | undefined {
  const candidate = native as Partial<TestClipboardBackdoor>
  return typeof candidate.getClipboardText === "function" &&
    typeof candidate.setClipboardText === "function"
    ? (candidate as TestClipboardBackdoor)
    : undefined
}

function mountedNative(): NativeRenderer {
  const container = latestAttachedContainer()
  if (!container) throw new Error("No GPUIX root is mounted")
  return container.native
}

/**
 * Programmatic clipboard access, shaped like the browser's
 * `navigator.clipboard` (text only — no images, no HTML fragments). Reaches
 * the most recently attached GPUIX root; rejects when none is mounted.
 *
 * `@gpuix/react/globals` installs this object as `navigator.clipboard` when
 * that property is absent — see `./globals.js`.
 */
export const clipboard = {
  /** Write plain text to the platform clipboard. */
  async writeText(text: string): Promise<void> {
    const native = mountedNative()
    const test = testClipboardOf(native)
    if (test) {
      test.setClipboardText(text)
      return
    }
    native.writeClipboardText?.(text)
  },

  /**
   * Read plain text from the platform clipboard. Resolves `""` when the
   * clipboard holds no text, as the browser's `navigator.clipboard.readText`
   * does.
   */
  async readText(): Promise<string> {
    const native = mountedNative()
    const test = testClipboardOf(native)
    if (test) return test.getClipboardText() ?? ""
    return native.readClipboardText?.() ?? ""
  },
}
