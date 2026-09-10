/** The one-line `@gpuix/react/testing/vitest` wiring: importing it for its
 *  side effects alone extends `expect` with the matcher pack. */

import React from "react"
import { describe, expect, it } from "vitest"
import { createTestRoot, isNativeTestRendererAvailable } from "../testing.js"

// The only wiring this file does. No `expect.extend`, no `declare module`
// augmentation of its own — both come from the side effect of this import,
// exactly as a `setupFiles` entry would provide them.
import "../testing-vitest.js"

const describeNative = isNativeTestRendererAvailable() ? describe : describe.skip

describeNative("@gpuix/react/testing/vitest side-effect wiring", () => {
  it("extends expect with the matcher pack", () => {
    const screen = createTestRoot()

    try {
      screen.render(<div data-testid="row">Coal</div>)
      const row = screen.getByTestId("row")

      // Typechecks under tsconfig.test.json because the `declare module`
      // augmentation ran when `../testing-vitest.js` was imported above.
      expect(row).toBeVisible()
      expect(row).toBeInTheDocument()
    } finally {
      screen.unmount()
    }
  })
})
