import { configDefaults, defineConfig } from "vitest/config";

// The canvas WPT harness is a conformance ledger, run on its own with
// `bun run canvas:wpt`.
const wpt = ["src/__tests__/canvas-wpt.test.tsx"];

export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "react",
          exclude: [...configDefaults.exclude, ...wpt],
        },
      },
      {
        extends: true,
        test: {
          name: "wpt",
          include: wpt,
        },
      },
    ],
  },
});
