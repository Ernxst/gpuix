import { create as createGPU, globals } from "../../probes/node-webgpu/node_modules/webgpu/index.js"

Object.assign(globalThis, globals)

export function create(flags) {
  return createGPU(flags.length === 0 ? ["backend=metal"] : flags)
}
