import { defineConfig } from "vite"
import { gpuix } from "@gpuix/plugins/vite"

export default defineConfig({
  appType: "custom",
  plugins: [gpuix({ entry: "app.tsx" })],
})
