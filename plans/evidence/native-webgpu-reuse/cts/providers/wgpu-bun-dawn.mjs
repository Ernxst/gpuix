import {
  create as createGPU,
  globals,
} from "../../probes/wgpu-bun/node_modules/wgpu-bun/src/index.ts"

Object.assign(globalThis, globals)

export function create(flags) {
  return createGPU(flags.length === 0 ? ["backend=metal"] : flags)
}
