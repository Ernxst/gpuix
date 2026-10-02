import { configDefaults, defineConfig } from "vitest/config";
import type { TestUserConfig } from "vitest/node";

// The canvas WPT harness is a conformance ledger, run on its own with
// `bun run canvas:wpt`.
const wpt = ["src/__tests__/canvas-wpt.test.tsx"];

// CI splits the suite across runners. The shard comes from the environment so
// that turbo can hash it without changing the build's hash, which arguments
// after `--` would do. Vitest types `shard` as a CLI option, so it is spread in.
const shard: Pick<TestUserConfig, "shard"> = { shard: process.env.VITEST_SHARD };

export default defineConfig({
  test: {
    ...shard,
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
