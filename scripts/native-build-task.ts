import { spawnSync } from "node:child_process";
import path from "node:path";

const root = path.resolve(import.meta.dir, "..");
const features = process.env.GPUX_NATIVE_FEATURES ?? "test-support";
const target = process.env.GPUX_NATIVE_TARGET;
const args = [
  "run",
  "--cwd",
  "packages/native",
  "napi",
  "build",
  "--platform",
  "--release",
  "--features",
  features,
];
if (target) args.push("--target", target);

const result = spawnSync("bun", args, { cwd: root, stdio: "inherit", env: process.env });
if (result.error || result.status !== 0) {
  throw result.error ?? new Error(`napi build failed with status ${result.status}`);
}
