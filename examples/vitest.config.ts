import { applyMacCpuThrottleFromEnv } from '@gpuix/react';
import { defineConfig } from 'vitest/config';

applyMacCpuThrottleFromEnv();

// These drive real input into a live window, or need the only visible window,
// so they run one file at a time.
const serial = [
  'menu-fallback.test.ts',
  'live-click.test.ts',
  'live-scroll-wheel.test.ts',
  'windows-accessibility.test.tsx',
];
const perf = ['*.perf.test.{ts,tsx}'];

export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "examples",
          include: ['*.test.{ts,tsx}'],
          exclude: [...serial, ...perf],
        },
      },
      {
        extends: true,
        test: {
          name: "serial",
          include: serial,
          fileParallelism: false,
        },
      },
      {
        extends: true,
        test: {
          name: "perf",
          include: perf,
        },
      },
    ],
  },
});
