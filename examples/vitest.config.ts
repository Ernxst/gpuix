import { applyMacCpuThrottleFromEnv } from '@gpuix/react';
import { defineConfig } from 'vitest/config';

applyMacCpuThrottleFromEnv();

export default defineConfig({
  test: {
    projects: [
      {
        name: "perf"
      }
    ]
  }
});
