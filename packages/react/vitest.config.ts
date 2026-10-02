import { configDefaults, defineConfig } from "vitest/config";
import type { TestUserConfig } from "vitest/node";

// The canvas WPT harness is a conformance ledger, run on its own with
// `bun run canvas:wpt`.
const wpt = ["src/__tests__/canvas-wpt.test.tsx"];

// These construct TestGpuixRenderer, which the Linux addon leaves out because
// wgpu cannot read a rendered image back yet.
const needsTestRenderer = [
  "baseline-layout.test.tsx",
  "border-box-sizing.test.tsx",
  "bun-preload-hover-group.test.ts",
  "code.test.tsx",
  "diff-native.test.tsx",
  "frame-clock.test.tsx",
  "globals.test.tsx",
  "grid-layout.test.tsx",
  "highlight.test.tsx",
  "intrinsic-and-viewport-lengths.test.tsx",
  "markdown.test.tsx",
  "resolved-style.test.tsx",
  "satisfactory-focus-within-repro.test.tsx",
  "scroll-percentage-layout.test.tsx",
  "selection-layout.test.tsx",
  "selection.test.tsx",
  "showcase.test.tsx",
  "spacing-percentage-layout.test.tsx",
  "style-coverage.test.tsx",
  "testing-per-file-isolation.test.tsx",
  "virtual-list.test.tsx",
].map((file) => `src/__tests__/${file}`);
const unsupported = process.platform === "linux" ? needsTestRenderer : [];

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
          exclude: [...configDefaults.exclude, ...wpt, ...unsupported],
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
