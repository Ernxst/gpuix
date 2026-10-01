import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: ["./{packages,examples}/*/vitest.config.ts"],
    coverage: {
      provider: "istanbul",
      include: ["**/src/**/*.{ts,js,mjs}"],
      exclude: ["**/*.d.ts"],
    },
  },
});
